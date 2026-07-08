import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { payments, webhookEvents, orders, refunds } from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { assertMoney } from "@/lib/money";
import { getPaymentProvider } from "./sandbox";
import { transitionOrder } from "@/modules/orders/state";
import { notifyOrderEvent } from "@/modules/messaging/service";

/** Crea el intento de pago (dentro de la transacción del checkout). */
export async function createPayment(
  tx: DbOrTx,
  params: {
    orderId: string;
    amountCop: number;
    method: string;
    customerPhone: string;
    idempotencyKey: string;
  },
) {
  assertMoney(params.amountCop, "monto del pago");
  const provider = getPaymentProvider();
  const isOnline = ["sandbox", "wompi", "mercado_pago", "nequi", "daviplata"].includes(params.method);
  const providerName = isOnline ? provider.name : "offline";

  // Idempotencia: si ya existe un pago con esta clave, lo devolvemos tal cual
  // (protege contra doble clic / reintentos del cliente). OJO: se busca con
  // el MISMO nombre de proveedor con el que se inserta (los offline guardan
  // "offline", no el proveedor online activo).
  const existing = await tx.query.payments.findFirst({
    where: and(
      eq(payments.provider, providerName),
      eq(payments.idempotencyKey, params.idempotencyKey),
    ),
  });
  if (existing) return existing;
  const intent = isOnline
    ? await provider.createIntent({
        orderId: params.orderId,
        amountCop: params.amountCop,
        method: params.method,
        idempotencyKey: params.idempotencyKey,
        customerPhone: params.customerPhone,
      })
    : { providerRef: id("off"), redirectUrl: null };

  const [payment] = await tx
    .insert(payments)
    .values({
      id: id("pay"),
      orderId: params.orderId,
      provider: providerName,
      method: params.method as typeof payments.$inferInsert.method,
      amountCop: params.amountCop,
      idempotencyKey: params.idempotencyKey,
      providerRef: intent.providerRef,
      // El redirectUrl queda en el intento: un reintento idempotente del
      // checkout puede reenviar al cliente a la MISMA página de pago.
      attempts: [
        {
          at: new Date().toISOString(),
          action: "intent_created",
          ...(intent.redirectUrl ? { redirectUrl: intent.redirectUrl } : {}),
        },
      ],
    })
    .returning();
  return { ...payment!, redirectUrl: intent.redirectUrl };
}

/**
 * Procesa un webhook de pago YA verificado en la ruta (firma válida).
 * - Dedupe por (provider, event_id): un evento repetido no hace nada.
 * - Un pago ya aprobado no se re-aprueba (protección contra duplicados).
 */
export async function processPaymentWebhook(input: {
  provider: string;
  externalEventId: string;
  providerRef: string;
  status: "approved" | "rejected" | "expired";
  rawPayload: unknown;
  /** Comisiones reportadas por la pasarela (MP): quedan en el intento para
   *  conciliación y para el cálculo de la comisión digital. */
  feeInfo?: { gatewayFeeCop: number; splitFeeCop: number };
}): Promise<{ ok: boolean; duplicate?: boolean; message?: string }> {
  return db.transaction(async (tx) => {
    // Dedupe de eventos
    const dupe = await tx.query.webhookEvents.findFirst({
      where: and(
        eq(webhookEvents.provider, input.provider),
        eq(webhookEvents.externalEventId, input.externalEventId),
      ),
    });
    if (dupe) return { ok: true, duplicate: true };

    await tx.insert(webhookEvents).values({
      id: id("whe"),
      provider: input.provider,
      externalEventId: input.externalEventId,
      payload: input.rawPayload as object,
    });

    const payment = await tx.query.payments.findFirst({
      where: eq(payments.providerRef, input.providerRef),
    });
    if (!payment) return { ok: false, message: "Pago no encontrado para providerRef" };

    if (payment.status !== "pending") {
      // Estado final ya alcanzado: registramos el intento y no tocamos nada.
      await tx
        .update(payments)
        .set({
          attempts: [
            ...(payment.attempts as unknown[]),
            { at: new Date().toISOString(), action: `webhook_ignored_${input.status}` },
          ],
        })
        .where(eq(payments.id, payment.id));
      return { ok: true, duplicate: true };
    }

    const newStatus = input.status === "approved" ? "approved" : input.status;
    await tx
      .update(payments)
      .set({
        status: newStatus,
        approvedAt: input.status === "approved" ? new Date() : null,
        attempts: [
          ...(payment.attempts as unknown[]),
          { at: new Date().toISOString(), action: `webhook_${input.status}`, ...(input.feeInfo ?? {}) },
        ],
      })
      .where(eq(payments.id, payment.id));

    await recordAudit(tx, {
      action: `payment.${input.status}`,
      entityType: "payment",
      entityId: payment.id,
      actorLabel: `webhook:${input.provider}`,
      before: { status: payment.status },
      after: { status: newStatus },
    });

    const order = await tx.query.orders.findFirst({ where: eq(orders.id, payment.orderId) });
    if (order && order.status === "pending_payment") {
      if (input.status === "approved") {
        await transitionOrder(tx, {
          orderId: order.id,
          to: "paid",
          actorLabel: `webhook:${input.provider}`,
          reason: "Pago aprobado por la pasarela",
        });
        await notifyOrderEvent(tx, order.id, "payment_confirmed");
      } else {
        await transitionOrder(tx, {
          orderId: order.id,
          to: "failed",
          actorLabel: `webhook:${input.provider}`,
          reason: `Pago ${input.status === "rejected" ? "rechazado" : "expirado"}`,
        });
      }
    }

    return { ok: true };
  });
}

/** Reembolso (total o parcial, ej. diferencia de peso a favor del cliente). */
export async function createRefund(params: {
  paymentId: string;
  amountCop: number;
  reason: string;
  actor: { userId?: string; label: string };
}) {
  assertMoney(params.amountCop, "monto del reembolso");
  return db.transaction(async (tx) => {
    const payment = await tx.query.payments.findFirst({ where: eq(payments.id, params.paymentId) });
    if (!payment) throw new Error("Pago no encontrado");
    if (payment.status !== "approved" && payment.status !== "partially_refunded") {
      throw new Error("Solo se reembolsan pagos aprobados");
    }
    const existingRefunds = await tx.query.refunds.findMany({
      where: eq(refunds.paymentId, params.paymentId),
    });
    const refundedSoFar = existingRefunds.reduce((s, r) => s + r.amountCop, 0);
    if (refundedSoFar + params.amountCop > payment.amountCop) {
      throw new Error("El reembolso excede el monto pagado");
    }
    const [refund] = await tx
      .insert(refunds)
      .values({
        id: id("ref"),
        paymentId: params.paymentId,
        amountCop: params.amountCop,
        reason: params.reason,
        status: "completed", // sandbox: inmediato; proveedor real: pending → webhook
        createdBy: params.actor.label,
      })
      .returning();
    const fullyRefunded = refundedSoFar + params.amountCop >= payment.amountCop;
    await tx
      .update(payments)
      .set({ status: fullyRefunded ? "refunded" : "partially_refunded" })
      .where(eq(payments.id, payment.id));
    await recordAudit(tx, {
      action: "refund.create",
      entityType: "payment",
      entityId: payment.id,
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      after: { amountCop: params.amountCop, reason: params.reason },
    });
    return refund!;
  });
}
