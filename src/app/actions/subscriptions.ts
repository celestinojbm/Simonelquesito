"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getSessionUser, requirePermission } from "@/lib/auth/session";
import { customerForUser } from "@/modules/accounts/service";
import {
  SubscriptionError,
  createSubscriptionFromOrder,
  runSubscription,
  setSubscriptionStatus,
} from "@/modules/subscriptions/service";

/** Acciones de canastas: el CLIENTE gestiona las suyas; el panel, todas. */

type Result = { ok: true } | { ok: false; message: string };
const fail = (e: unknown): Result => ({
  ok: false,
  message: e instanceof SubscriptionError || e instanceof Error ? e.message : "Error inesperado",
});

/** El cliente convierte un pedido suyo en canasta recurrente. */
export async function subscribeFromOrderAction(input: {
  orderId: string;
  frequency: "weekly" | "biweekly";
  deliveryDay: number;
}): Promise<Result> {
  try {
    const user = await getSessionUser();
    const customer = user ? await customerForUser(user.id) : null;
    if (!customer) return { ok: false, message: "Ingresa con tu celular para crear tu canasta." };
    const parsed = z
      .object({
        orderId: z.string(),
        frequency: z.enum(["weekly", "biweekly"]),
        deliveryDay: z.number().int().min(0).max(6),
      })
      .parse(input);
    await createSubscriptionFromOrder({
      ...parsed,
      customerId: customer.id,
      actorLabel: `customer:${customer.phone}`,
    });
    revalidatePath("/cuenta");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** El cliente pausa/reactiva/cancela SU canasta. */
export async function customerSubscriptionStatusAction(
  subscriptionId: string,
  status: "active" | "paused" | "cancelled",
): Promise<Result> {
  try {
    const user = await getSessionUser();
    const customer = user ? await customerForUser(user.id) : null;
    if (!customer) return { ok: false, message: "Sesión requerida." };
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
    });
    if (!sub || sub.customerId !== customer.id) {
      return { ok: false, message: "Canasta no encontrada en tu cuenta." };
    }
    await setSubscriptionStatus({
      subscriptionId,
      status,
      actorLabel: `customer:${customer.phone}`,
    });
    revalidatePath("/cuenta");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Panel: cambiar estado de cualquier canasta. */
export async function adminSubscriptionStatusAction(
  subscriptionId: string,
  status: "active" | "paused" | "cancelled",
): Promise<Result> {
  try {
    const user = await requirePermission("orders.manage");
    await setSubscriptionStatus({
      subscriptionId,
      status,
      actorLabel: `${user.role}:${user.email}`,
    });
    revalidatePath("/admin/canastas");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Panel: generar el pedido de una canasta AHORA (prueba/operación manual). */
export async function adminRunSubscriptionAction(
  subscriptionId: string,
): Promise<Result & { number?: string }> {
  try {
    const user = await requirePermission("orders.manage");
    const r = await runSubscription(subscriptionId, `${user.role}:${user.email}`);
    revalidatePath("/admin/canastas");
    if (!r.ok) return { ok: false, message: r.error };
    return { ok: true, number: r.number };
  } catch (e) {
    return fail(e);
  }
}
