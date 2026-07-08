import { eq, and } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { deliveryZones, deliveries, drivers, orders } from "@/db/schema";
import { id, shortCode } from "@/lib/ids";
import { getSetting } from "@/modules/config/service";
import { transitionOrder } from "@/modules/orders/state";
import { notifyOrderEvent } from "@/modules/messaging/service";

export type DeliveryQuote =
  | { available: true; feeCop: number; etaMinutes: [number, number]; zoneName: string }
  | { available: false; reason: string };

/** Cotiza el envío para una zona: tarifa, mínimo, envío gratis, ETA. */
export async function quoteDelivery(params: {
  zoneId: string;
  itemsTotalCop: number;
}): Promise<DeliveryQuote> {
  const zone = await db.query.deliveryZones.findFirst({
    where: and(eq(deliveryZones.id, params.zoneId), eq(deliveryZones.isActive, true)),
  });
  if (!zone) return { available: false, reason: "Zona sin cobertura." };
  if (params.itemsTotalCop < zone.minOrderCop) {
    return {
      available: false,
      reason: `El pedido mínimo para tu zona es de $${zone.minOrderCop.toLocaleString("es-CO")}.`,
    };
  }
  const globalFreeFrom = await getSetting("delivery.freeFromCop");
  const freeFrom = zone.freeDeliveryFromCop ?? globalFreeFrom;
  const fee = freeFrom !== null && params.itemsTotalCop >= freeFrom ? 0 : zone.feeCop;
  return {
    available: true,
    feeCop: fee,
    etaMinutes: [zone.etaMinutesMin, zone.etaMinutesMax],
    zoneName: zone.name,
  };
}

export async function listActiveZones() {
  return db.query.deliveryZones.findMany({ where: eq(deliveryZones.isActive, true) });
}

/** Asigna un domiciliario a un pedido listo. Crea la entrega con código de confirmación. */
export async function assignDriver(params: {
  orderId: string;
  driverId: string;
  actor: { userId?: string; label: string };
}) {
  return db.transaction(async (tx) => {
    const driver = await tx.query.drivers.findFirst({ where: eq(drivers.id, params.driverId) });
    if (!driver) throw new Error("Domiciliario no encontrado");

    const existing = await tx.query.deliveries.findFirst({
      where: eq(deliveries.orderId, params.orderId),
    });
    if (existing) {
      await tx
        .update(deliveries)
        .set({ driverId: params.driverId, status: "assigned", assignedAt: new Date() })
        .where(eq(deliveries.id, existing.id));
    } else {
      await tx.insert(deliveries).values({
        id: id("dlv"),
        orderId: params.orderId,
        driverId: params.driverId,
        status: "assigned",
        confirmationCode: shortCode(4),
        assignedAt: new Date(),
      });
    }
    await transitionOrder(tx, {
      orderId: params.orderId,
      to: "assigned",
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      reason: "Domiciliario asignado",
    });
  });
}

/** El domiciliario marca recogido → pedido en camino. */
export async function markPickedUp(tx: DbOrTx, orderId: string, actorLabel: string) {
  await tx
    .update(deliveries)
    .set({ status: "picked_up", pickedUpAt: new Date() })
    .where(eq(deliveries.orderId, orderId));
  await transitionOrder(tx, {
    orderId,
    to: "out_for_delivery",
    actorLabel,
    reason: "Pedido recogido por el domiciliario",
  });
  await notifyOrderEvent(tx, orderId, "out_for_delivery");
}

/**
 * Entrega confirmada. Para pedidos restringidos exige haber marcado la
 * verificación de identidad; el código de confirmación es la prueba de entrega.
 */
export async function markDelivered(params: {
  orderId: string;
  confirmationCode: string;
  idChecked?: boolean;
  paymentReceivedMethod?: string;
  actor: { userId?: string; label: string };
}) {
  return db.transaction(async (tx) => {
    const delivery = await tx.query.deliveries.findFirst({
      where: eq(deliveries.orderId, params.orderId),
    });
    if (!delivery) throw new Error("Entrega no encontrada");
    if (delivery.confirmationCode !== params.confirmationCode) {
      throw new Error("Código de confirmación incorrecto");
    }
    const order = await tx.query.orders.findFirst({ where: eq(orders.id, params.orderId) });
    if (!order) throw new Error("Pedido no encontrado");
    if (order.idCheckRequired && !params.idChecked) {
      throw new Error("Este pedido contiene productos restringidos: verifica el documento de identidad antes de entregar.");
    }

    await tx
      .update(deliveries)
      .set({
        status: "delivered",
        deliveredAt: new Date(),
        paymentReceivedMethod: params.paymentReceivedMethod ?? null,
      })
      .where(eq(deliveries.id, delivery.id));

    if (order.idCheckRequired && params.idChecked) {
      await tx.update(orders).set({ idCheckedAt: new Date() }).where(eq(orders.id, order.id));
    }

    await transitionOrder(tx, {
      orderId: params.orderId,
      to: "delivered",
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      reason: "Entrega confirmada con código",
    });
    await notifyOrderEvent(tx, params.orderId, "delivered");
  });
}

/** Incidencia de entrega (cliente ausente, dirección errada, etc.). */
export async function reportDeliveryIncident(params: {
  orderId: string;
  kind: string;
  notes: string;
  actor: { userId?: string; label: string };
}) {
  return db.transaction(async (tx) => {
    const delivery = await tx.query.deliveries.findFirst({
      where: eq(deliveries.orderId, params.orderId),
    });
    if (!delivery) throw new Error("Entrega no encontrada");
    await tx
      .update(deliveries)
      .set({
        incidents: [
          ...(delivery.incidents as unknown[]),
          { at: new Date().toISOString(), kind: params.kind, notes: params.notes, by: params.actor.label },
        ],
      })
      .where(eq(deliveries.id, delivery.id));
  });
}
