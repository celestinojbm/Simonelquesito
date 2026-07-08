import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { memberships, membershipCharges, customers } from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { applyBps } from "@/lib/money";
import { getSetting } from "@/modules/config/service";

/**
 * Membresía premium. Reglas de dinero:
 * - Precio y beneficios viven en settings (premium.plan) — nunca en código.
 * - Cada cobro registra el reparto 50/50 con la agencia (acordado 2026-07)
 *   vía commission.subscriptionPctBps; la liquidación real llega con la
 *   pasarela (fase 3) — mientras tanto queda contabilizado por cobro.
 */

const PERIOD_DAYS = 30;

export async function getActiveMembership(customerId: string, tx: DbOrTx = db) {
  const m = await tx.query.memberships.findFirst({
    where: eq(memberships.customerId, customerId),
  });
  if (!m) return null;
  if (m.status === "cancelled") return null;
  // Vencida sin renovar → sin beneficios (el estado se actualiza al cobrar).
  if (m.currentPeriodEnd < new Date() && m.status !== "past_due") return null;
  return m.status === "active" && m.currentPeriodEnd >= new Date() ? m : null;
}

/**
 * Alta en tienda (mostrador) o activación manual del panel. El primer cobro
 * queda registrado según el método: efectivo/transferencia (pagado ya) o
 * store_credit (la mensualidad se suma al Fiado — lo hace el módulo credit).
 */
export async function activateMembership(params: {
  customerId: string;
  channel: "online" | "in_store";
  method: "cash" | "transfer" | "store_credit";
  actor: { userId?: string; label: string };
}) {
  const plan = await getSetting("premium.plan");
  const splitBps = await getSetting("commission.subscriptionPctBps");

  return db.transaction(async (tx) => {
    const customer = await tx.query.customers.findFirst({
      where: eq(customers.id, params.customerId),
    });
    if (!customer) throw new Error("Cliente no encontrado");

    const existing = await tx.query.memberships.findFirst({
      where: eq(memberships.customerId, params.customerId),
    });
    const now = new Date();
    const periodEnd = new Date(now.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000);

    let membershipId: string;
    if (existing) {
      if (existing.status === "active" && existing.currentPeriodEnd >= now) {
        throw new Error("Este cliente ya tiene la membresía activa.");
      }
      membershipId = existing.id;
      await tx
        .update(memberships)
        .set({
          status: "active",
          channel: params.channel,
          activatedBy: params.actor.label,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelledAt: null,
        })
        .where(eq(memberships.id, existing.id));
    } else {
      membershipId = id("mem");
      await tx.insert(memberships).values({
        id: membershipId,
        customerId: params.customerId,
        status: "active",
        channel: params.channel,
        activatedBy: params.actor.label,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      });
    }

    const chargeId = id("mch");
    const paidNow = params.method !== "store_credit";
    await tx.insert(membershipCharges).values({
      id: chargeId,
      membershipId,
      amountCop: plan.priceCopMonthly,
      agencySplitCop: applyBps(plan.priceCopMonthly, splitBps),
      status: paidNow ? "paid" : "pending", // pending → la salda el Fiado
      method: params.method,
      periodStart: now,
      periodEnd,
      paidAt: paidNow ? now : null,
    });

    await recordAudit(tx, {
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      action: "membership.activate",
      entityType: "membership",
      entityId: membershipId,
      after: { customerId: params.customerId, channel: params.channel, method: params.method, amountCop: plan.priceCopMonthly },
    });

    return { membershipId, chargeId, amountCop: plan.priceCopMonthly };
  });
}

export async function cancelMembership(customerId: string, actor: { userId?: string; label: string }) {
  await db.transaction(async (tx) => {
    const m = await tx.query.memberships.findFirst({ where: eq(memberships.customerId, customerId) });
    if (!m) throw new Error("Este cliente no tiene membresía");
    await tx
      .update(memberships)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(memberships.id, m.id));
    await recordAudit(tx, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      action: "membership.cancel",
      entityType: "membership",
      entityId: m.id,
    });
  });
}

/** Marca pagado un cobro pendiente (efectivo/transferencia recibidos). */
export async function settleMembershipCharge(chargeId: string, method: string, actor: { userId?: string; label: string }) {
  await db.transaction(async (tx) => {
    const charge = await tx.query.membershipCharges.findFirst({
      where: and(eq(membershipCharges.id, chargeId), eq(membershipCharges.status, "pending")),
    });
    if (!charge) throw new Error("Cobro no encontrado o ya saldado");
    await tx
      .update(membershipCharges)
      .set({ status: "paid", method, paidAt: new Date() })
      .where(eq(membershipCharges.id, chargeId));
    await recordAudit(tx, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      action: "membership.charge_paid",
      entityType: "membership_charge",
      entityId: chargeId,
      after: { method },
    });
  });
}
