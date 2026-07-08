import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { orders, orderStatusEvents } from "@/db/schema";
import { id } from "@/lib/ids";
import { releaseReservations, consumeReservations } from "@/modules/inventory/service";

export type OrderStatus =
  | "new"
  | "pending_payment"
  | "paid"
  | "confirmed"
  | "preparing"
  | "awaiting_substitution"
  | "weight_adjustment_pending"
  | "ready"
  | "assigned"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "failed";

/** Transiciones válidas de la máquina de estados de pedidos. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["pending_payment", "confirmed", "cancelled"],
  pending_payment: ["paid", "failed", "cancelled"],
  paid: ["confirmed", "cancelled", "refunded"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["awaiting_substitution", "weight_adjustment_pending", "ready", "cancelled"],
  awaiting_substitution: ["preparing", "cancelled"],
  weight_adjustment_pending: ["preparing", "ready", "cancelled"],
  ready: ["assigned", "delivered", "cancelled"], // delivered directo = recogida en tienda
  assigned: ["out_for_delivery", "ready", "cancelled"],
  out_for_delivery: ["delivered", "ready", "cancelled"], // ready = devuelto al local
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
  failed: ["pending_payment", "cancelled"], // reintento de pago
};

export class InvalidTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Transición inválida de pedido: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/**
 * Única puerta de cambio de estado. Registra el evento con actor, motivo y
 * timestamps, y ejecuta los efectos de inventario:
 * - cancelled/failed → libera reservas.
 * - delivered → consume reservas y descuenta del ledger.
 */
export async function transitionOrder(
  tx: DbOrTx,
  params: {
    orderId: string;
    to: OrderStatus;
    actorUserId?: string;
    actorLabel: string;
    reason?: string;
    notes?: string;
  },
): Promise<void> {
  const order = await tx.query.orders.findFirst({ where: eq(orders.id, params.orderId) });
  if (!order) throw new Error("Pedido no encontrado");
  const from = order.status as OrderStatus;
  if (!ORDER_TRANSITIONS[from]?.includes(params.to)) {
    throw new InvalidTransitionError(from, params.to);
  }

  await tx
    .update(orders)
    .set({ status: params.to, updatedAt: new Date() })
    .where(eq(orders.id, params.orderId));

  await tx.insert(orderStatusEvents).values({
    id: id("oev"),
    orderId: params.orderId,
    fromStatus: from,
    toStatus: params.to,
    actorUserId: params.actorUserId ?? null,
    actorLabel: params.actorLabel,
    reason: params.reason ?? null,
    notes: params.notes ?? null,
  });

  if (params.to === "cancelled" || params.to === "failed") {
    await releaseReservations(tx, params.orderId);
  }
  if (params.to === "delivered") {
    await consumeReservations(tx, params.orderId, params.actorLabel);
  }
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Nuevo",
  pending_payment: "Pendiente de pago",
  paid: "Pagado",
  confirmed: "Confirmado",
  preparing: "En preparación",
  awaiting_substitution: "Esperando sustitución",
  weight_adjustment_pending: "Ajuste de peso pendiente",
  ready: "Listo",
  assigned: "Asignado a domiciliario",
  out_for_delivery: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  failed: "Fallido",
};
