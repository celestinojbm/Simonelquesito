/**
 * Test de integración del vertical slice completo (usa la BD de desarrollo,
 * requiere `npm run db:push && npm run db:seed` previos):
 *
 * pedido → reserva de inventario → webhook de pago firmado → confirmación →
 * preparación → peso real → listo → asignación → entrega con código →
 * descuento de inventario → comisión digital.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  productVariants,
  orders,
  deliveries,
  drivers,
  inventoryReservations,
  payments,
} from "@/db/schema";
import { placeOrder } from "@/modules/orders/checkout";
import { processPaymentWebhook } from "@/modules/payments/service";
import { transitionOrder, InvalidTransitionError } from "@/modules/orders/state";
import { recordActualWeight } from "@/modules/orders/weight";
import { assignDriver, markPickedUp, markDelivered } from "@/modules/delivery/service";
import { getStock } from "@/modules/inventory/service";
import { computeCommissionForRange } from "@/modules/commission/service";
import { setSetting } from "@/modules/config/service";

const ACTOR = { userId: undefined, label: "test" };
const FULL_DAY = {
  mon: ["00:00-23:59"], tue: ["00:00-23:59"], wed: ["00:00-23:59"],
  thu: ["00:00-23:59"], fri: ["00:00-23:59"], sat: ["00:00-23:59"], sun: ["00:00-23:59"],
};

async function variantBySku(sku: string) {
  const v = await db.query.productVariants.findFirst({ where: eq(productVariants.sku, sku) });
  if (!v) throw new Error(`Falta el seed: variante ${sku}`);
  return v;
}

function checkoutBase(idempotencyKey: string) {
  return {
    fulfillment: "delivery" as const,
    contactName: "Cliente Prueba",
    contactPhone: "3001234567",
    addressLine: "Calle de prueba 1-23",
    neighborhood: "Castilla",
    zoneId: "zon_castilla",
    deliverySlot: "asap",
    substitutionPref: "similar_product" as const,
    paymentMethod: "sandbox" as const,
    restrictedTermsAccepted: false,
    dataConsent: true,
    marketingConsent: false,
    idempotencyKey,
  };
}

beforeAll(async () => {
  // El test puede correr a cualquier hora: abrimos domicilios todo el día
  // vía CONFIGURACIÓN (exactamente como se haría para operar 24 h).
  await setSetting("hours.delivery", FULL_DAY, { label: "test" });
});

describe("vertical slice", () => {
  it("recorre el flujo completo de un pedido digital", async () => {
    const aceite = await variantBySku("ABA-003"); // unidad
    const banano = await variantBySku("FRU-001"); // por kg (gramos)

    const stockBefore = await getStock(aceite.id);
    const bananoBefore = await getStock(banano.id);

    // 1) Checkout
    const key = `test-${Date.now()}-${Math.random()}`;
    const result = await placeOrder({
      ...checkoutBase(key),
      items: [
        { variantId: aceite.id, qty: 2 },
        { variantId: banano.id, qty: 1000, note: "verdes por favor" }, // 1 kg estimado
      ],
    });
    expect(result.number).toMatch(/^MC-\d+$/);

    const order = await db.query.orders.findFirst({ where: eq(orders.id, result.orderId) });
    expect(order?.status).toBe("pending_payment");
    expect(order?.hasWeightItems).toBe(true);
    expect(order?.isEstimatedTotal).toBe(true);
    // Total servidor: 2×12900 + 1kg×3800 = 29.600 ≥ umbral de envío gratis (20.000)
    expect(order?.itemsTotalCop).toBe(2 * 12900 + 3800);
    expect(order?.deliveryFeeCop).toBe(0);

    // 2) Inventario reservado, disponible reducido, físico intacto
    const stockReserved = await getStock(aceite.id);
    expect(stockReserved.available).toBe(stockBefore.available - 2);
    expect(stockReserved.physical).toBe(stockBefore.physical);

    // 3) Webhook de pago aprobado (idempotente)
    const payment = await db.query.payments.findFirst({ where: eq(payments.orderId, result.orderId) });
    expect(payment?.status).toBe("pending");
    const eventId = `evt-${key}`;
    const webhook = {
      provider: "sandbox",
      externalEventId: eventId,
      providerRef: payment!.providerRef!,
      status: "approved" as const,
      rawPayload: {},
    };
    expect((await processPaymentWebhook(webhook)).ok).toBe(true);

    // Mismo evento repetido → duplicado, sin efectos
    const dup = await processPaymentWebhook(webhook);
    expect(dup.duplicate).toBe(true);

    // Evento distinto sobre un pago ya aprobado → ignorado (no re-aprueba)
    const dup2 = await processPaymentWebhook({ ...webhook, externalEventId: `${eventId}-b` });
    expect(dup2.duplicate).toBe(true);

    const paidOrder = await db.query.orders.findFirst({ where: eq(orders.id, result.orderId) });
    expect(paidOrder?.status).toBe("paid");

    // 4) Confirmación y preparación
    await db.transaction(async (tx) => {
      await transitionOrder(tx, { orderId: result.orderId, to: "confirmed", actorLabel: "test" });
      await transitionOrder(tx, { orderId: result.orderId, to: "preparing", actorLabel: "test" });
    });

    // 5) Peso real dentro de tolerancia (1.05 kg, +5% < 15%)
    const items = await db.query.orders
      .findFirst({ where: eq(orders.id, result.orderId) })
      .then(() =>
        db.query.orderItems.findMany({
          where: (t, { eq: eqOp }) => eqOp(t.orderId, result.orderId),
        }),
      );
    const bananoItem = items.find((i) => i.variantId === banano.id)!;
    const weightResult = await recordActualWeight({
      orderItemId: bananoItem.id,
      actualWeightG: 1050,
      actor: ACTOR,
    });
    expect(weightResult.needsApproval).toBe(false);
    expect(weightResult.finalLineTotalCop).toBe(Math.round((3800 * 1050) / 1000));

    const adjusted = await db.query.orders.findFirst({ where: eq(orders.id, result.orderId) });
    expect(adjusted?.totalCop).toBe(2 * 12900 + weightResult.finalLineTotalCop);
    expect(adjusted?.status).toBe("preparing"); // dentro de tolerancia: no requiere aprobación

    // 6) Listo → asignación → recogido → entregado con código
    await db.transaction(async (tx) => {
      await transitionOrder(tx, { orderId: result.orderId, to: "ready", actorLabel: "test" });
    });
    const driver = await db.query.drivers.findFirst({ where: eq(drivers.userId, "usr_driver") });
    await assignDriver({ orderId: result.orderId, driverId: driver!.id, actor: ACTOR });
    await db.transaction(async (tx) => {
      await markPickedUp(tx, result.orderId, "test");
    });

    const delivery = await db.query.deliveries.findFirst({ where: eq(deliveries.orderId, result.orderId) });
    // Código incorrecto rechazado
    await expect(
      markDelivered({ orderId: result.orderId, confirmationCode: "XXXX", actor: ACTOR }),
    ).rejects.toThrow(/Código/);
    await markDelivered({
      orderId: result.orderId,
      confirmationCode: delivery!.confirmationCode,
      actor: ACTOR,
    });

    const deliveredOrder = await db.query.orders.findFirst({ where: eq(orders.id, result.orderId) });
    expect(deliveredOrder?.status).toBe("delivered");

    // 7) Inventario descontado definitivamente y reservas consumidas
    const stockAfter = await getStock(aceite.id);
    expect(stockAfter.physical).toBe(stockBefore.physical - 2);
    expect(stockAfter.reserved).toBe(stockBefore.reserved);
    const bananoAfter = await getStock(banano.id);
    expect(bananoAfter.physical).toBe(bananoBefore.physical - 1000);

    const openReservations = await db.query.inventoryReservations.findMany({
      where: and(
        eq(inventoryReservations.orderId, result.orderId),
        eq(inventoryReservations.status, "active"),
      ),
    });
    expect(openReservations).toHaveLength(0);

    // 8) La venta digital entra en la base de comisión
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 60 * 1000);
    const breakdown = await computeCommissionForRange(start, end);
    expect(breakdown.ordersCount).toBeGreaterThanOrEqual(1);
    expect(breakdown.commissionCop).toBeGreaterThan(0);
  });

  it("cancelar libera las reservas y no descuenta inventario", async () => {
    const aceite = await variantBySku("ABA-003");
    const before = await getStock(aceite.id);

    const result = await placeOrder({
      ...checkoutBase(`test-cancel-${Date.now()}`),
      items: [{ variantId: aceite.id, qty: 3 }],
      paymentMethod: "cash_on_delivery",
    });
    expect((await getStock(aceite.id)).available).toBe(before.available - 3);

    await db.transaction(async (tx) => {
      await transitionOrder(tx, {
        orderId: result.orderId,
        to: "cancelled",
        actorLabel: "test",
        reason: "prueba",
      });
    });
    const after = await getStock(aceite.id);
    expect(after.available).toBe(before.available);
    expect(after.physical).toBe(before.physical);
  });

  it("impide vender por encima del stock disponible", async () => {
    const whisky = await variantBySku("LIC-004"); // stock bajo (8)
    await expect(
      placeOrder({
        ...checkoutBase(`test-oversell-${Date.now()}`),
        items: [{ variantId: whisky.id, qty: 9999 }],
        paymentMethod: "cash_on_delivery",
        declaredBirthDate: "1990-01-01",
        restrictedTermsAccepted: true,
      }),
    ).rejects.toThrow();
  });

  it("una diferencia de peso mayor a la tolerancia exige aprobación", async () => {
    const banano = await variantBySku("FRU-001");
    const result = await placeOrder({
      ...checkoutBase(`test-weight-${Date.now()}`),
      items: [{ variantId: banano.id, qty: 5000 }], // 5 kg (supera el mínimo de la zona)
      paymentMethod: "cash_on_delivery", // auto-confirma
    });
    await db.transaction(async (tx) => {
      await transitionOrder(tx, { orderId: result.orderId, to: "preparing", actorLabel: "test" });
    });
    const item = await db.query.orderItems.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.orderId, result.orderId),
    });
    // 7.5 kg reales sobre 5 kg estimados = +50% > tolerancia 15%
    const weight = await recordActualWeight({ orderItemId: item!.id, actualWeightG: 7500, actor: ACTOR });
    expect(weight.needsApproval).toBe(true);
    const order = await db.query.orders.findFirst({ where: eq(orders.id, result.orderId) });
    expect(order?.status).toBe("weight_adjustment_pending");
  });

  it("la máquina de estados rechaza transiciones inválidas", async () => {
    const aceite = await variantBySku("ABA-003");
    const result = await placeOrder({
      ...checkoutBase(`test-fsm-${Date.now()}`),
      items: [{ variantId: aceite.id, qty: 2 }],
    });
    // pending_payment → delivered no es válido
    await expect(
      db.transaction(async (tx) => {
        await transitionOrder(tx, { orderId: result.orderId, to: "delivered", actorLabel: "test" });
      }),
    ).rejects.toThrow(InvalidTransitionError);
  });
});
