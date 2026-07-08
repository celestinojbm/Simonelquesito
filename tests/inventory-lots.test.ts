/**
 * Lotes/vencimiento (FEFO): recepción con lote, consumo por vencimiento más
 * próximo primero, descarte de un lote específico y alerta de próximos a
 * vencer. Usa la BD de desarrollo sembrada (mismo patrón que los demás tests
 * de integración).
 */
import { describe, it, expect } from "vitest";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { productVariants, inventoryLots } from "@/db/schema";
import {
  receiveLot,
  discardExpiredLot,
  listExpiringLots,
  adjustStock,
  getStock,
} from "@/modules/inventory/service";

const ACTOR = { userId: undefined, label: "test" };

async function variantBySku(sku: string) {
  const v = await db.query.productVariants.findFirst({ where: eq(productVariants.sku, sku) });
  if (!v) throw new Error(`Falta el seed: variante ${sku}`);
  return v;
}

const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

describe("lotes de inventario (FEFO)", () => {
  it("consume primero el lote con vencimiento más próximo", async () => {
    // REF-002: producto refrigerado por peso (gramos) — como el jamón/queso
    // de una salsamentaria.
    const variant = await variantBySku("REF-002");

    // Aísla el test de lotes que pudiera haber dejado una corrida anterior
    // (la BD de desarrollo se comparte entre corridas, igual que el resto de
    // la suite): sin esto, el orden de consumo por vencimiento pasaría por
    // lotes ajenos al test y las aserciones de reparto dejarían de ser
    // deterministas.
    const preexisting = await db.query.inventoryLots.findMany({
      where: and(eq(inventoryLots.variantId, variant.id), gt(inventoryLots.qtyRemaining, 0)),
    });
    for (const lot of preexisting) {
      await discardExpiredLot({ lotId: lot.id, reason: "limpieza de test", actor: ACTOR });
    }

    const before = await getStock(variant.id);

    const soon = await receiveLot({
      variantId: variant.id,
      qty: 500,
      lotCode: "LOTE-PRONTO",
      expiresAt: daysFromNow(2),
      actor: ACTOR,
    });
    const later = await receiveLot({
      variantId: variant.id,
      qty: 500,
      lotCode: "LOTE-LEJOS",
      expiresAt: daysFromNow(20),
      actor: ACTOR,
    });

    const afterReceive = await getStock(variant.id);
    expect(afterReceive.physical).toBe(before.physical + 1000);

    // Consumir 700 g: debe agotar el lote próximo (500) y tomar 200 del lejano.
    await adjustStock({
      variantId: variant.id,
      qtyDelta: -700,
      type: "shrinkage",
      reason: "prueba FEFO",
      actor: ACTOR,
    });

    const lotSoon = await db.query.inventoryLots.findFirst({ where: eq(inventoryLots.id, soon.lotId) });
    const lotLater = await db.query.inventoryLots.findFirst({ where: eq(inventoryLots.id, later.lotId) });
    expect(lotSoon?.qtyRemaining).toBe(0); // agotado primero por ser el más próximo a vencer
    expect(lotLater?.qtyRemaining).toBe(300); // 500 - 200

    const afterConsume = await getStock(variant.id);
    expect(afterConsume.physical).toBe(before.physical + 1000 - 700);
  });

  it("un producto sin lotes se ajusta igual que antes (movimiento sin lote)", async () => {
    const variant = await variantBySku("ABA-004"); // sin lotes registrados
    const before = await getStock(variant.id);
    await adjustStock({
      variantId: variant.id,
      qtyDelta: -2,
      type: "shrinkage",
      reason: "prueba sin lotes",
      actor: ACTOR,
    });
    const after = await getStock(variant.id);
    expect(after.physical).toBe(before.physical - 2);
  });

  it("da de baja un lote específico como merma, sin tocar otros lotes de la misma variante", async () => {
    const variant = await variantBySku("REF-001");
    const good = await receiveLot({ variantId: variant.id, qty: 10, expiresAt: daysFromNow(15), actor: ACTOR });
    const bad = await receiveLot({ variantId: variant.id, qty: 4, expiresAt: daysFromNow(1), actor: ACTOR });

    await discardExpiredLot({ lotId: bad.lotId, reason: "vencido en bodega", actor: ACTOR });

    const badLot = await db.query.inventoryLots.findFirst({ where: eq(inventoryLots.id, bad.lotId) });
    const goodLot = await db.query.inventoryLots.findFirst({ where: eq(inventoryLots.id, good.lotId) });
    expect(badLot?.qtyRemaining).toBe(0);
    expect(goodLot?.qtyRemaining).toBe(10); // intacto

    // Doble descarte del mismo lote falla (ya no tiene existencia).
    await expect(
      discardExpiredLot({ lotId: bad.lotId, reason: "otra vez", actor: ACTOR }),
    ).rejects.toThrow();
  });

  it("lista lotes que vencen dentro del rango, y excluye los lejanos", async () => {
    const variant = await variantBySku("PAN-001");
    const near = await receiveLot({
      variantId: variant.id,
      qty: 5,
      lotCode: "PAN-CERCA",
      expiresAt: daysFromNow(1),
      actor: ACTOR,
    });
    await receiveLot({
      variantId: variant.id,
      qty: 5,
      lotCode: "PAN-LEJOS",
      expiresAt: daysFromNow(60),
      actor: ACTOR,
    });

    const expiring = await listExpiringLots(5);
    const ids = expiring.map((l) => l.lotId);
    expect(ids).toContain(near.lotId);
    expect(expiring.find((l) => l.lotId === near.lotId)?.qtyRemaining).toBe(5);
    // El lote lejano (60 días) no debe aparecer en una ventana de 5 días.
    const farLot = expiring.find((l) => l.lotCode === "PAN-LEJOS");
    expect(farLot).toBeUndefined();
  });
});
