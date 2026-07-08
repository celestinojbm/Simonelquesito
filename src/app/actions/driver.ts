"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { drivers, deliveries } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { markPickedUp, markDelivered, reportDeliveryIncident } from "@/modules/delivery/service";

type ActionResult = { ok: true } | { ok: false; message: string };

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
}

/** Verifica que el pedido esté asignado AL domiciliario autenticado. */
async function requireOwnDelivery(orderId: string) {
  const user = await requirePermission("delivery.view_own");
  const driver = await db.query.drivers.findFirst({ where: eq(drivers.userId, user.id) });
  if (!driver) throw new Error("No tienes perfil de domiciliario");
  const delivery = await db.query.deliveries.findFirst({ where: eq(deliveries.orderId, orderId) });
  if (!delivery || delivery.driverId !== driver.id) {
    throw new Error("Este pedido no está asignado a ti");
  }
  return { user, driver, delivery };
}

export async function driverPickUp(orderId: string): Promise<ActionResult> {
  try {
    const { user } = await requireOwnDelivery(orderId);
    await db.transaction(async (tx) => {
      await markPickedUp(tx, orderId, `driver:${user.email}`);
    });
    revalidatePath("/repartidor");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function driverDeliver(params: {
  orderId: string;
  confirmationCode: string;
  idChecked: boolean;
  paymentReceivedMethod?: string;
}): Promise<ActionResult> {
  try {
    const { user } = await requireOwnDelivery(params.orderId);
    await markDelivered({
      orderId: params.orderId,
      confirmationCode: params.confirmationCode,
      idChecked: params.idChecked,
      paymentReceivedMethod: params.paymentReceivedMethod,
      actor: { userId: user.id, label: `driver:${user.email}` },
    });
    revalidatePath("/repartidor");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function driverIncident(orderId: string, kind: string, notes: string): Promise<ActionResult> {
  try {
    const { user } = await requireOwnDelivery(orderId);
    await reportDeliveryIncident({ orderId, kind, notes, actor: { userId: user.id, label: `driver:${user.email}` } });
    revalidatePath("/repartidor");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
