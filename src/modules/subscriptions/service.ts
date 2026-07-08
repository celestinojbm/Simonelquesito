import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, orderItems, orders, subscriptionItems, subscriptions } from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { getMessagingProvider } from "@/modules/messaging/service";
import { placeOrder } from "@/modules/orders/checkout";

/**
 * Canastas recurrentes (Fase 5 de la estrategia aprobada).
 * - La canasta es una LISTA; el pedido real se genera el día de entrega vía
 *   el cron (o "Generar ahora" del panel), pasando por placeOrder: reserva
 *   inventario, aplica beneficios premium y entra al panel como cualquier
 *   pedido (canal "subscription").
 * - Se cobra POR ENTREGA (contra entrega por ahora), nunca por adelantado.
 * - Idempotencia: la clave del pedido deriva de (suscripción, fecha objetivo);
 *   si el cron se repite, no se duplica el pedido.
 * - Si la generación falla (stock, cobertura), se registra el error, se avisa
 *   y la canasta salta a la SIGUIENTE fecha — nunca reintenta en bucle.
 */

export class SubscriptionError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Día de la semana (0-6) de una fecha en Bogotá. */
function bogotaDow(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", weekday: "short" })
      .format(date)
      .replace("Sun", "0").replace("Mon", "1").replace("Tue", "2").replace("Wed", "3")
      .replace("Thu", "4").replace("Fri", "5").replace("Sat", "6"),
  );
}

/** Próxima ocurrencia FUTURA del día elegido, a las 6:00 de Bogotá aprox. */
export function computeNextRunAt(deliveryDay: number, from = new Date()): Date {
  const start = new Date(from.getTime() + DAY_MS); // nunca hoy: mínimo mañana
  for (let i = 0; i < 8; i++) {
    const candidate = new Date(start.getTime() + i * DAY_MS);
    if (bogotaDow(candidate) === deliveryDay) {
      // Normaliza a las 06:00 de Bogotá (11:00 UTC) del día candidato.
      const ymd = candidate.toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });
      return new Date(`${ymd}T06:00:00-05:00`);
    }
  }
  throw new SubscriptionError("No se pudo calcular la próxima entrega.");
}

/** Crea una canasta copiando los renglones de un pedido existente. */
export async function createSubscriptionFromOrder(params: {
  orderId: string;
  customerId: string;
  frequency: "weekly" | "biweekly";
  deliveryDay: number;
  actorLabel: string;
}) {
  if (params.deliveryDay < 0 || params.deliveryDay > 6) {
    throw new SubscriptionError("Día de entrega inválido.");
  }
  const order = await db.query.orders.findFirst({ where: eq(orders.id, params.orderId) });
  if (!order) throw new SubscriptionError("Pedido no encontrado.");
  if (order.customerId !== params.customerId) {
    throw new SubscriptionError("El pedido no pertenece a esta cuenta.");
  }
  const items = await db.query.orderItems.findMany({
    where: eq(orderItems.orderId, params.orderId),
  });
  if (items.length === 0) throw new SubscriptionError("El pedido no tiene productos.");

  // El cobro recurrente en línea llega con la pasarela (fase 2); por ahora
  // toda canasta se paga AL RECIBIR, sea cual fuera el pago del pedido origen.
  const paymentMethod = "cash_on_delivery";

  return db.transaction(async (tx) => {
    const subId = id("sub");
    await tx.insert(subscriptions).values({
      id: subId,
      customerId: params.customerId,
      name: `Canasta ${params.frequency === "weekly" ? "semanal" : "quincenal"}`,
      frequency: params.frequency,
      deliveryDay: params.deliveryDay,
      fulfillment: order.fulfillment,
      addressLine: order.addressLine,
      neighborhood: order.neighborhood,
      zoneId: order.zoneId,
      addressReferences: order.addressReferences,
      deliveryLat: order.deliveryLat,
      deliveryLng: order.deliveryLng,
      paymentMethod,
      instructions: order.instructions,
      substitutionPref: order.substitutionPref,
      nextRunAt: computeNextRunAt(params.deliveryDay),
      createdBy: params.actorLabel,
    });
    for (const item of items) {
      await tx.insert(subscriptionItems).values({
        id: id("sbi"),
        subscriptionId: subId,
        variantId: item.variantId,
        qty: item.qty,
        note: item.note,
      });
    }
    await recordAudit(tx, {
      actorLabel: params.actorLabel,
      action: "subscription.create",
      entityType: "subscription",
      entityId: subId,
      after: { fromOrder: order.number, frequency: params.frequency, deliveryDay: params.deliveryDay },
    });
    return { subscriptionId: subId };
  });
}

export async function setSubscriptionStatus(params: {
  subscriptionId: string;
  status: "active" | "paused" | "cancelled";
  actorLabel: string;
}) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, params.subscriptionId),
  });
  if (!sub) throw new SubscriptionError("Canasta no encontrada.");
  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({
        status: params.status,
        // Al reactivar, la próxima entrega se recalcula hacia adelante.
        nextRunAt: params.status === "active" ? computeNextRunAt(sub.deliveryDay) : sub.nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, params.subscriptionId));
    await recordAudit(tx, {
      actorLabel: params.actorLabel,
      action: "subscription.status",
      entityType: "subscription",
      entityId: params.subscriptionId,
      after: { status: params.status },
    });
  });
}

/** Genera el pedido de UNA canasta (usado por el cron y por el panel). */
export async function runSubscription(subscriptionId: string, actorLabel: string) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  });
  if (!sub) throw new SubscriptionError("Canasta no encontrada.");
  if (sub.status !== "active") throw new SubscriptionError("La canasta no está activa.");

  const customer = await db.query.customers.findFirst({ where: eq(customers.id, sub.customerId) });
  if (!customer) throw new SubscriptionError("Cliente no encontrado.");
  const items = await db.query.subscriptionItems.findMany({
    where: eq(subscriptionItems.subscriptionId, subscriptionId),
  });
  if (items.length === 0) throw new SubscriptionError("La canasta está vacía.");

  const targetDate = sub.nextRunAt.toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });
  const stepDays = sub.frequency === "weekly" ? 7 : 14;
  const advance = () =>
    db
      .update(subscriptions)
      .set({ nextRunAt: new Date(sub.nextRunAt.getTime() + stepDays * DAY_MS), updatedAt: new Date() })
      .where(eq(subscriptions.id, subscriptionId));

  try {
    const result = await placeOrder({
      items: items.map((i) => ({ variantId: i.variantId, qty: i.qty, note: i.note ?? undefined })),
      fulfillment: sub.fulfillment,
      contactName: customer.fullName,
      contactPhone: customer.phone,
      addressLine: sub.addressLine ?? undefined,
      neighborhood: sub.neighborhood ?? undefined,
      zoneId: sub.zoneId ?? undefined,
      addressReferences: sub.addressReferences ?? undefined,
      deliveryLat: sub.deliveryLat ?? undefined,
      deliveryLng: sub.deliveryLng ?? undefined,
      deliverySlot: "asap",
      instructions: sub.instructions ? `🧺 Canasta recurrente. ${sub.instructions}` : "🧺 Canasta recurrente.",
      substitutionPref: sub.substitutionPref,
      paymentMethod: sub.paymentMethod as "cash_on_delivery",
      dataConsent: true,
      marketingConsent: false,
      restrictedTermsAccepted: false,
      customerId: sub.customerId,
      channel: "web_pwa", // el canal real se marca abajo (enum en schema)
      idempotencyKey: `sub-${subscriptionId}-${targetDate}`,
    });
    // Marca el canal correcto (placeOrder no expone "subscription" en su
    // entrada pública para no abrirlo a clientes; aquí es el sistema).
    await db.update(orders).set({ channel: "subscription" }).where(eq(orders.id, result.orderId));
    await db
      .update(subscriptions)
      .set({ lastOrderId: result.orderId, lastError: null })
      .where(eq(subscriptions.id, subscriptionId));
    await advance();

    const provider = getMessagingProvider();
    await provider.send({
      to: customer.phone,
      template: "subscription_order",
      body: `🧺 ¡Tu canasta va en camino de prepararse! Pedido ${result.number} por ${"$" + result.totalCop.toLocaleString("es-CO")}. Pagas al recibir. Si necesitas cambiar algo, escríbenos.`,
    });
    return { ok: true as const, orderId: result.orderId, number: result.number };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error generando el pedido";
    // Nunca reintentar en bucle: registra el error y salta a la siguiente fecha.
    await db
      .update(subscriptions)
      .set({ lastError: `${targetDate}: ${message}` })
      .where(eq(subscriptions.id, subscriptionId));
    await advance();
    return { ok: false as const, error: message };
  }
}

/** Corre todas las canastas vencidas + recordatorios de víspera. */
export async function runDueSubscriptions() {
  const due = await db.query.subscriptions.findMany({
    where: and(eq(subscriptions.status, "active"), lte(subscriptions.nextRunAt, new Date())),
    limit: 50,
  });
  const results: { id: string; ok: boolean; detail: string }[] = [];
  for (const sub of due) {
    const r = await runSubscription(sub.id, "cron");
    results.push({ id: sub.id, ok: r.ok, detail: r.ok ? r.number : r.error });
  }

  // Recordatorio de víspera (ventana 20–44 h antes de la entrega).
  const upcoming = await db
    .select({ sub: subscriptions, phone: customers.phone })
    .from(subscriptions)
    .innerJoin(customers, eq(subscriptions.customerId, customers.id))
    .where(
      and(
        eq(subscriptions.status, "active"),
        sql`${subscriptions.nextRunAt} between now() + interval '20 hours' and now() + interval '44 hours'`,
        sql`(${subscriptions.lastReminderAt} is null or ${subscriptions.lastReminderAt} < now() - interval '3 days')`,
      ),
    );
  const provider = getMessagingProvider();
  for (const { sub, phone } of upcoming) {
    await provider.send({
      to: phone,
      template: "subscription_reminder",
      body: "🧺 ¡Mañana llega tu canasta! Si quieres agregarle algo o cambiar la entrega, escríbenos por aquí.",
    });
    await db
      .update(subscriptions)
      .set({ lastReminderAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
  }

  return { generated: results, reminders: upcoming.length };
}
