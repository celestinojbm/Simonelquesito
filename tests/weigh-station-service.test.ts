/**
 * Servicio de la estación de balanza (integración, BD efímera): entradas,
 * salidas, FEFO, sin stock negativo, idempotencia, auditoría, y consultas
 * (resolución por código/nombre e historial). No usa datos productivos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  categories,
  inventoryLots,
  inventoryMovements,
  productVariants,
  products,
} from "@/db/schema";
import { getStock } from "@/modules/inventory/service";
import { recordStationMovement, StationError } from "@/modules/inventory/weigh-station";
import {
  lookupStationItemByCode,
  searchStationItems,
  listRecentStationMovements,
} from "@/modules/inventory/weigh-station-queries";

const ACTOR = { userId: "usr_ws_test", label: "owner:ws@example.invalid" };
const CAT = "cat_ws_test";
const PROD = "prod_ws_test";
const V_WEIGHT = "var_ws_weight";
const V_FEFO = "var_ws_fefo";
const V_UNIT = "var_ws_unit";
const ALL_VARIANTS = [V_WEIGHT, V_FEFO, V_UNIT];

async function wipe() {
  for (const v of ALL_VARIANTS) {
    await db.execute(sql`delete from inventory_movements where variant_id = ${v}`);
    await db.execute(sql`delete from inventory_lots where variant_id = ${v}`);
    await db.execute(sql`delete from audit_events where entity_type = 'product_variant' and entity_id = ${v}`);
    await db.execute(sql`delete from product_variants where id = ${v}`);
  }
  await db.execute(sql`delete from products where id = ${PROD}`);
  await db.execute(sql`delete from categories where id = ${CAT}`);
}

beforeAll(async () => {
  await wipe();
  await db.insert(categories).values({ id: CAT, slug: "ws-test", name: "WS Test", icon: "🧀" });
  await db.insert(products).values({ id: PROD, slug: "ws-prod", name: "Queso de prueba estación", categoryId: CAT });
  await db.insert(productVariants).values([
    { id: V_WEIGHT, productId: PROD, name: "Granel", sku: "WS-KG-1", barcode: "7700000000011", saleUnit: "g", soldByWeight: true, isPerishable: true, priceCop: 14_000 },
    { id: V_FEFO, productId: PROD, name: "FEFO", sku: "WS-FEFO-1", saleUnit: "g", soldByWeight: true, isPerishable: true, priceCop: 12_000 },
    { id: V_UNIT, productId: PROD, name: "Unidad", sku: "WS-UN-1", barcode: "7700000000028", saleUnit: "unit", priceCop: 3_500 },
  ]);
});

afterAll(wipe);

function baseInput(over: Partial<Parameters<typeof recordStationMovement>[0]> & { idempotencyKey: string }) {
  return {
    variantId: V_WEIGHT,
    direction: "in" as const,
    quantityMinor: 1000,
    source: "manual" as const,
    reasonCode: "recepcion",
    actor: ACTOR,
    ...over,
  };
}

describe("entradas", () => {
  it("entrada de 2500 g crea movimiento positivo y sube el stock exactamente 2500", async () => {
    const r = await recordStationMovement(baseInput({ quantityMinor: 2500, idempotencyKey: "ws-in-2500-aaaa" }));
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(false);
    expect(r.stockAfter.physical - r.stockBefore.physical).toBe(2500);
    expect(r.type).toBe("purchase_receipt");
    const mv = await db.query.inventoryMovements.findFirst({ where: eq(inventoryMovements.id, r.movementId) });
    expect(mv?.qty).toBe(2500);
    expect(mv?.referenceType).toBe("weigh_station_manual");
    expect(mv?.referenceId).toBe("ws-in-2500-aaaa");
  });

  it("entrada con lote y vencimiento crea lote + movimiento juntos y conserva el vencimiento", async () => {
    const exp = new Date("2026-07-25T00:00:00.000Z");
    const r = await recordStationMovement(
      baseInput({ quantityMinor: 5000, lotCode: "L-2026-07", expiresAt: exp, idempotencyKey: "ws-lot-bbbb" }),
    );
    expect(r.lotId).toBeTruthy();
    const lot = await db.query.inventoryLots.findFirst({ where: eq(inventoryLots.id, r.lotId!) });
    expect(lot?.qtyReceived).toBe(5000);
    expect(lot?.qtyRemaining).toBe(5000);
    expect(lot?.lotCode).toBe("L-2026-07");
    expect(lot?.expiresAt?.toISOString()).toBe(exp.toISOString());
  });

  it("guarda proveedor y número de piezas en la auditoría", async () => {
    const r = await recordStationMovement(
      baseInput({ quantityMinor: 1000, supplierId: "sup_test", pieceCount: 4, note: "caja", idempotencyKey: "ws-aud-cccc" }),
    );
    expect(r.ok).toBe(true);
    const [aud] = await db
      .select({ after: auditEvents.after })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "inventory.station_movement"), eq(auditEvents.entityId, V_WEIGHT)))
      .orderBy(sql`${auditEvents.createdAt} desc`)
      .limit(1);
    expect(aud).toBeTruthy();
    const after = aud!.after as Record<string, unknown>;
    expect(after.supplierId).toBe("sup_test");
    expect(after.pieceCount).toBe(4);
  });

  it("entrada por unidad usa cantidad entera de unidades", async () => {
    const r = await recordStationMovement(
      baseInput({ variantId: V_UNIT, quantityMinor: 3, idempotencyKey: "ws-unit-dddd" }),
    );
    expect(r.stockAfter.physical - r.stockBefore.physical).toBe(3);
  });
});

describe("salidas", () => {
  it("salida de 750 g crea movimiento negativo y baja el stock exactamente 750", async () => {
    await recordStationMovement(baseInput({ quantityMinor: 5000, idempotencyKey: "ws-seed-out-eeee" }));
    const r = await recordStationMovement(
      baseInput({ direction: "out", reasonCode: "merma", quantityMinor: 750, idempotencyKey: "ws-out-750-ffff" }),
    );
    expect(r.stockBefore.physical - r.stockAfter.physical).toBe(750);
    expect(r.type).toBe("shrinkage");
  });

  it("salida superior al disponible se rechaza y NO deja stock negativo", async () => {
    const before = await getStock(V_UNIT);
    await expect(
      recordStationMovement(
        baseInput({ variantId: V_UNIT, direction: "out", reasonCode: "consumo_interno", quantityMinor: before.available + 100, idempotencyKey: "ws-neg-gggg" }),
      ),
    ).rejects.toThrow(/insuficiente/i);
    const after = await getStock(V_UNIT);
    expect(after.available).toBe(before.available);
  });

  it("devolución a proveedor usa el tipo return_out", async () => {
    await recordStationMovement(baseInput({ quantityMinor: 2000, idempotencyKey: "ws-seed-ro-hhhh" }));
    const r = await recordStationMovement(
      baseInput({ direction: "out", reasonCode: "devolucion_proveedor", quantityMinor: 500, idempotencyKey: "ws-ro-iiii" }),
    );
    expect(r.type).toBe("return_out");
  });

  it("un motivo que no corresponde a la dirección se rechaza", async () => {
    await expect(
      recordStationMovement(baseInput({ direction: "out", reasonCode: "recepcion", idempotencyKey: "ws-badreason-jjjj" })),
    ).rejects.toThrow(StationError);
  });
});

describe("FEFO", () => {
  it("consume primero el lote con vencimiento más próximo", async () => {
    // Lote A vence tarde; lote B vence pronto.
    const late = await recordStationMovement(
      baseInput({ variantId: V_FEFO, quantityMinor: 1000, lotCode: "A-late", expiresAt: new Date("2026-12-31T00:00:00.000Z"), idempotencyKey: "ws-fefo-A" }),
    );
    const soon = await recordStationMovement(
      baseInput({ variantId: V_FEFO, quantityMinor: 1000, lotCode: "B-soon", expiresAt: new Date("2026-08-01T00:00:00.000Z"), idempotencyKey: "ws-fefo-B" }),
    );
    // Salida de 1200 → consume todo B (1000) + 200 de A.
    await recordStationMovement(
      baseInput({ variantId: V_FEFO, direction: "out", reasonCode: "merma", quantityMinor: 1200, idempotencyKey: "ws-fefo-out" }),
    );
    const lotA = await db.query.inventoryLots.findFirst({ where: eq(inventoryLots.id, late.lotId!) });
    const lotB = await db.query.inventoryLots.findFirst({ where: eq(inventoryLots.id, soon.lotId!) });
    expect(lotB?.qtyRemaining).toBe(0); // el más próximo, consumido primero
    expect(lotA?.qtyRemaining).toBe(800);
  });
});

describe("idempotencia", () => {
  it("dos envíos con la misma clave crean UN solo movimiento; el reintento devuelve el previo", async () => {
    const input = baseInput({ variantId: V_UNIT, quantityMinor: 5, idempotencyKey: "ws-idem-kkkk" });
    const first = await recordStationMovement(input);
    expect(first.duplicate).toBe(false);
    const stockAfterFirst = (await getStock(V_UNIT)).physical;

    const second = await recordStationMovement(input);
    expect(second.duplicate).toBe(true);
    expect(second.movementId).toBe(first.movementId);
    const stockAfterSecond = (await getStock(V_UNIT)).physical;
    expect(stockAfterSecond).toBe(stockAfterFirst); // sin doble conteo

    const dupRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.referenceId, "ws-idem-kkkk"));
    expect(dupRows[0]?.n).toBe(1);
  });

  it("claves distintas crean movimientos distintos", async () => {
    await recordStationMovement(baseInput({ variantId: V_UNIT, quantityMinor: 1, idempotencyKey: "ws-idem-x1" }));
    await recordStationMovement(baseInput({ variantId: V_UNIT, quantityMinor: 1, idempotencyKey: "ws-idem-x2" }));
    const distinctRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(inventoryMovements)
      .where(sql`${inventoryMovements.referenceId} in ('ws-idem-x1','ws-idem-x2')`);
    expect(distinctRows[0]?.n).toBe(2);
  });
});

describe("consultas de la estación", () => {
  it("resuelve por barcode exacto y por SKU exacto", async () => {
    const byBarcode = await lookupStationItemByCode("7700000000011");
    expect(byBarcode?.variantId).toBe(V_WEIGHT);
    const bySku = await lookupStationItemByCode("ws-un-1"); // case-insensitive
    expect(bySku?.variantId).toBe(V_UNIT);
    expect(await lookupStationItemByCode("codigo-inexistente-xyz")).toBeNull();
  });

  it("busca por nombre (sin acentos) y devuelve stock", async () => {
    const items = await searchStationItems("queso prueba");
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((i) => typeof i.stock.available === "number")).toBe(true);
  });

  it("el historial lista solo movimientos de la estación con etiqueta de fuente legible", async () => {
    const rows = await listRecentStationMovements(10);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => ["Manual", "USB Serial", "WebUSB", "Bridge local", "Simulador de desarrollo"].includes(r.sourceLabel))).toBe(true);
  });
});
