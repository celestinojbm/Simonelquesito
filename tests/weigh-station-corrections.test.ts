/**
 * Correcciones de seguridad de la estación (auditoría PR #3):
 *  #2 guard de fuentes en servidor · #3 idempotencia con detección de conflicto ·
 *  #4 historial una-fila-por-operación · #5 privacidad del operador ·
 *  #6 confirmación por snapshot · #7 concurrencia FEFO. BD efímera.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, inventoryLots, inventoryMovements, productVariants, products } from "@/db/schema";
import { getStock } from "@/modules/inventory/service";
import { recordStationMovement } from "@/modules/inventory/weigh-station";
import { listRecentStationMovements } from "@/modules/inventory/weigh-station-queries";
import { sanitizeActorLabel, movementConfirmKey } from "@/modules/inventory/station-format";

const ACTOR = { userId: "usr_corr", label: "owner:persona@example.invalid" };
const CAT = "cat_corr";
const PROD = "prod_corr";
const V_A = "var_corr_a";
const V_FEFO = "var_corr_fefo";
const V_CONC = "var_corr_conc";
const VARS = [V_A, V_FEFO, V_CONC];

async function wipe() {
  for (const v of VARS) {
    await db.execute(sql`delete from inventory_movements where variant_id = ${v}`);
    await db.execute(sql`delete from inventory_lots where variant_id = ${v}`);
    await db.execute(sql`delete from audit_events where entity_type='product_variant' and entity_id=${v}`);
    await db.execute(sql`delete from product_variants where id = ${v}`);
  }
  await db.execute(sql`delete from products where id = ${PROD}`);
  await db.execute(sql`delete from categories where id = ${CAT}`);
}

beforeAll(async () => {
  await wipe();
  await db.insert(categories).values({ id: CAT, slug: "corr", name: "Corr" });
  await db.insert(products).values({ id: PROD, slug: "corr-prod", name: "Producto correcciones", categoryId: CAT });
  await db.insert(productVariants).values([
    { id: V_A, productId: PROD, name: "A", saleUnit: "g", soldByWeight: true, priceCop: 10_000 },
    { id: V_FEFO, productId: PROD, name: "FEFO", saleUnit: "g", soldByWeight: true, isPerishable: true, priceCop: 10_000 },
    { id: V_CONC, productId: PROD, name: "Conc", saleUnit: "g", soldByWeight: true, priceCop: 10_000 },
  ]);
});

afterAll(wipe);

function base(over: Partial<Parameters<typeof recordStationMovement>[0]> & { idempotencyKey: string }) {
  return {
    variantId: V_A,
    direction: "in" as const,
    quantityMinor: 1000,
    source: "manual" as const,
    reasonCode: "recepcion",
    actor: ACTOR,
    ...over,
  };
}

describe("#2 guard de fuentes en servidor", () => {
  it("rechaza web_serial, web_usb y local_bridge para registrar", async () => {
    for (const source of ["web_serial", "web_usb", "local_bridge"] as const) {
      await expect(
        recordStationMovement(base({ source, idempotencyKey: `guard-${source}` })),
      ).rejects.toThrow(/USB todavía no está habilitada/i);
    }
  });
  it("rechaza el simulador cuando no está habilitado", async () => {
    // En el entorno de test NEXT_PUBLIC_SCALE_SIMULATOR no está en "true".
    await expect(
      recordStationMovement(base({ source: "simulated", idempotencyKey: "guard-sim" })),
    ).rejects.toThrow(/simulador/i);
  });
  it("permite manual", async () => {
    const r = await recordStationMovement(base({ idempotencyKey: "guard-manual-ok" }));
    expect(r.ok).toBe(true);
  });
});

describe("#3 idempotencia con detección de conflicto", () => {
  const KEY = "conflict-key-fixed-1";
  const original = () => base({ variantId: V_A, quantityMinor: 2500, idempotencyKey: KEY });

  it("primer envío registra; el reintento IDÉNTICO devuelve el resultado ORIGINAL", async () => {
    const first = await recordStationMovement(original());
    expect(first.duplicate).toBe(false);
    const physAfterFirst = (await getStock(V_A)).physical;

    const retry = await recordStationMovement(original());
    expect(retry.duplicate).toBe(true);
    expect(retry.quantityMinor).toBe(2500); // valor ORIGINAL, no el input nuevo
    expect(retry.stockAfter.physical).toBe(first.stockAfter.physical); // original, no el stock actual
    expect((await getStock(V_A)).physical).toBe(physAfterFirst); // sin doble conteo
  });

  it("la MISMA clave con datos distintos se RECHAZA", async () => {
    // distinta cantidad
    await expect(recordStationMovement(base({ variantId: V_A, quantityMinor: 3000, idempotencyKey: KEY }))).rejects.toThrow(/otros datos/i);
    // distinta dirección
    await expect(recordStationMovement(base({ variantId: V_A, direction: "out", reasonCode: "merma", quantityMinor: 2500, idempotencyKey: KEY }))).rejects.toThrow(/otros datos/i);
    // distinto motivo
    await expect(recordStationMovement(base({ variantId: V_A, quantityMinor: 2500, reasonCode: "correccion_positiva", idempotencyKey: KEY }))).rejects.toThrow(/otros datos/i);
    // distinto producto
    await expect(recordStationMovement(base({ variantId: V_CONC, quantityMinor: 2500, idempotencyKey: KEY }))).rejects.toThrow(/otros datos/i);
    // distinto lote
    await expect(recordStationMovement(base({ variantId: V_A, quantityMinor: 2500, lotCode: "L-OTRO", idempotencyKey: KEY }))).rejects.toThrow(/otros datos/i);
  });
});

describe("#4 historial: una fila por operación (salida FEFO multi-lote)", () => {
  it("dos lotes + salida de 1200 g → 2 fragmentos en el ledger, 1 operación en el historial", async () => {
    await recordStationMovement(base({ variantId: V_FEFO, quantityMinor: 1000, lotCode: "A", expiresAt: new Date("2026-12-31T00:00:00.000Z"), idempotencyKey: "hist-lote-a" }));
    await recordStationMovement(base({ variantId: V_FEFO, quantityMinor: 1000, lotCode: "B", expiresAt: new Date("2026-08-01T00:00:00.000Z"), idempotencyKey: "hist-lote-b" }));
    await recordStationMovement(base({ variantId: V_FEFO, direction: "out", reasonCode: "merma", quantityMinor: 1200, idempotencyKey: "hist-salida" }));

    // Ledger: la salida generó 2 fragmentos negativos (lote B completo + parte de A).
    const [frag] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.variantId, V_FEFO), sql`${inventoryMovements.qty} < 0`));
    expect(frag?.n).toBe(2);

    // Historial: una sola operación de salida con cantidad total 1200.
    const history = await listRecentStationMovements(20);
    const outs = history.filter((r) => r.productName === "Producto correcciones" && r.variantName === "FEFO" && r.qty < 0);
    expect(outs.length).toBe(1);
    expect(Math.abs(outs[0]!.qty)).toBe(1200);
  });
});

describe("#5 privacidad del operador", () => {
  it("sanitizeActorLabel no revela el correo", () => {
    const label = sanitizeActorLabel("owner:persona@example.invalid");
    expect(label).not.toContain("@");
    expect(label).not.toContain("persona@example.invalid");
    expect(label).toBe("Propietario");
    expect(sanitizeActorLabel(null)).toBe("Sistema");
    expect(sanitizeActorLabel("cashier:x@y.z")).toBe("Cajero");
  });
  it("el historial devuelve el operador sanitizado (sin correo)", async () => {
    await recordStationMovement(base({ variantId: V_A, quantityMinor: 100, idempotencyKey: "priv-operador" }));
    const history = await listRecentStationMovements(20);
    const row = history.find((r) => r.variantName === "A");
    expect(row).toBeTruthy();
    expect(row!.operator).not.toContain("@");
    expect(row!.operator).not.toContain("persona@example.invalid");
    expect(row!.operator).toBe("Propietario");
  });
});

describe("#6 confirmación por snapshot", () => {
  it("cambiar el peso invalida una confirmación previa", () => {
    const k500 = movementConfirmKey({ variantId: V_A, direction: "out", quantityMinor: 500, reasonCode: "merma", source: "manual" });
    const k5000 = movementConfirmKey({ variantId: V_A, direction: "out", quantityMinor: 5000, reasonCode: "merma", source: "manual" });
    expect(k500).not.toBe(k5000); // el snapshot armado para 500 no vale para 5000
    // mismo request → misma clave (idempotente para la confirmación)
    expect(k500).toBe(movementConfirmKey({ variantId: V_A, direction: "out", quantityMinor: 500, reasonCode: "merma", source: "manual" }));
  });
});

describe("#7 concurrencia FEFO", () => {
  it("dos salidas concurrentes no dejan stock negativo ni doble descuento", async () => {
    // Stock inicial 1000 g en un lote.
    await recordStationMovement(base({ variantId: V_CONC, quantityMinor: 1000, lotCode: "C", idempotencyKey: "conc-seed" }));
    const before = (await getStock(V_CONC)).physical;

    const out = (k: string) =>
      recordStationMovement(base({ variantId: V_CONC, direction: "out", reasonCode: "merma", quantityMinor: 600, idempotencyKey: k }));
    const results = await Promise.allSettled([out("conc-out-1"), out("conc-out-2")]);

    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    expect(ok).toBe(1); // solo una de las dos salidas de 600 cabe en 1000
    expect(failed).toBe(1);

    const after = (await getStock(V_CONC)).physical;
    expect(after).toBe(before - 600); // exactamente una deducción, sin negativo
    expect(after).toBeGreaterThanOrEqual(0);

    // El remanente de lotes coincide con el ledger (no hay actualización perdida).
    const [lotSum] = await db
      .select({ s: sql<number>`coalesce(sum(${inventoryLots.qtyRemaining}),0)::int` })
      .from(inventoryLots)
      .where(eq(inventoryLots.variantId, V_CONC));
    expect(lotSum?.s).toBe(400);
  });
});
