import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import {
  creditAccounts,
  creditInstallments,
  creditLedger,
  creditPlans,
  customers,
  membershipCharges,
  memberships,
  orders,
  users,
} from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { getSetting } from "@/modules/config/service";
import type { SettingValue } from "@/modules/config/keys";

/**
 * Fiado Digital — el fiado de barrio formalizado, SIN intereses (nunca).
 *
 * Principios:
 * - La deuda es la SUMA del ledger inmutable (credit_ledger); jamás se edita.
 * - Reglas (cupos, umbral de cuota única, nº de cuotas, tope de cartera)
 *   viven en settings credit.rules — editables desde el panel.
 * - Elegibilidad: el fiado NO exige membresía (la premium es un beneficio
 *   aparte, solo por la app). El canal online pide teléfono/correo/identidad
 *   (según reglas) y opcionalmente N pedidos; en tienda basta el registro
 *   presencial del personal con la cédula verificada en mano, que queda
 *   auditado.
 * - Mora = se pausa el cupo. Sin intereses moratorios ni cargos escondidos.
 */

export class CreditError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Saldo actual (deuda) de una cuenta: suma del ledger. */
export async function creditBalance(creditAccountId: string, tx: DbOrTx = db): Promise<number> {
  const [row] = await tx
    .select({ balance: sql<string>`coalesce(sum(${creditLedger.amountCop}), 0)` })
    .from(creditLedger)
    .where(eq(creditLedger.creditAccountId, creditAccountId));
  return Number(row?.balance ?? 0);
}

/** Cartera total en la calle (todas las cuentas). */
export async function portfolioOutstanding(tx: DbOrTx = db): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${creditLedger.amountCop}), 0)` })
    .from(creditLedger);
  return Number(row?.total ?? 0);
}

export async function getCreditStatus(customerId: string) {
  const account = await db.query.creditAccounts.findFirst({
    where: eq(creditAccounts.customerId, customerId),
  });
  if (!account) return null;
  const balance = await creditBalance(account.id);
  const pendingInstallments = await db
    .select({
      id: creditInstallments.id,
      seq: creditInstallments.seq,
      amountCop: creditInstallments.amountCop,
      dueDate: creditInstallments.dueDate,
      planId: creditInstallments.planId,
    })
    .from(creditInstallments)
    .innerJoin(creditPlans, eq(creditInstallments.planId, creditPlans.id))
    .where(and(eq(creditPlans.creditAccountId, account.id), eq(creditInstallments.status, "pending")))
    .orderBy(creditInstallments.dueDate);
  const overdue = pendingInstallments.filter((i) => i.dueDate < new Date());
  return {
    account,
    balance,
    availableCop: Math.max(0, account.limitCop - balance),
    pendingInstallments,
    overdueCount: overdue.length,
  };
}

/**
 * Elegibilidad del crédito EN LÍNEA para un cliente. Devuelve qué falta para
 * poder abrir/usar el Fiado por la tienda en línea, según credit.rules:
 * teléfono verificado (cuenta), correo verificado, identidad (18+) aprobada
 * y —si el propietario lo exige— N pedidos entregados. Nada bloquea al
 * primerizo si minPaidOrdersOnline = 0 (riesgo aceptado).
 */
export type OnlineCreditEligibility = {
  eligible: boolean;
  hasAccount: boolean;
  requirements: { key: string; label: string; done: boolean }[];
};

export async function getOnlineCreditEligibility(customerId: string): Promise<OnlineCreditEligibility> {
  const rules = await getSetting("credit.rules");
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
  const account = await db.query.creditAccounts.findFirst({
    where: eq(creditAccounts.customerId, customerId),
  });

  // Teléfono verificado = tiene cuenta de usuario (ingreso por código OTP).
  const hasUser = customer?.userId
    ? !!(await db.query.users.findFirst({ where: eq(users.id, customer.userId) }))
    : false;

  const [deliveredRow] = await db
    .select({ n: sql<string>`count(*)` })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), eq(orders.status, "delivered")));
  const delivered = Number(deliveredRow?.n ?? 0);

  const requirements: { key: string; label: string; done: boolean }[] = [];
  if (rules.onlineRequirePhoneVerified) {
    requirements.push({ key: "phone", label: "Cuenta con celular verificado", done: hasUser });
  }
  if (rules.onlineRequireEmailVerified) {
    requirements.push({ key: "email", label: "Correo verificado", done: !!customer?.emailVerifiedAt });
  }
  if (rules.onlineRequireIdentityVerified) {
    requirements.push({ key: "identity", label: "Identidad verificada (mayor de 18)", done: !!customer?.ageVerifiedAt });
  }
  if (rules.minPaidOrdersOnline > 0) {
    requirements.push({
      key: "orders",
      label: `${rules.minPaidOrdersOnline} pedidos entregados (lleva ${delivered})`,
      done: delivered >= rules.minPaidOrdersOnline,
    });
  }

  return {
    eligible: requirements.every((r) => r.done),
    hasAccount: !!account,
    requirements,
  };
}

/**
 * Suma al Fiado las mensualidades premium pendientes con método store_credit:
 * cada una genera su plan de UNA cuota a 15 días (toda deuda tiene fecha) y
 * el cobro queda saldado. Se usa en el alta de la cuenta y al REACTIVAR una
 * membresía cargándola al fiado.
 */
async function absorbPendingMembershipFees(
  tx: DbOrTx,
  params: { customerId: string; accountId: string; actorLabel: string },
): Promise<number> {
  const pendingFee = await tx
    .select({ id: membershipCharges.id, amountCop: membershipCharges.amountCop })
    .from(membershipCharges)
    .innerJoin(memberships, eq(membershipCharges.membershipId, memberships.id))
    .where(
      and(
        eq(memberships.customerId, params.customerId),
        eq(membershipCharges.status, "pending"),
        eq(membershipCharges.method, "store_credit"),
      ),
    );
  for (const fee of pendingFee) {
    const feePlanId = id("crp");
    await tx.insert(creditPlans).values({
      id: feePlanId,
      creditAccountId: params.accountId,
      totalCop: fee.amountCop,
      installmentsCount: 1,
      frequency: "single",
      note: "Mensualidad premium",
      createdBy: params.actorLabel,
    });
    await tx.insert(creditInstallments).values({
      id: id("cri"),
      planId: feePlanId,
      seq: 1,
      amountCop: fee.amountCop,
      dueDate: new Date(Date.now() + 15 * DAY_MS),
    });
    await tx.insert(creditLedger).values({
      id: id("crl"),
      creditAccountId: params.accountId,
      type: "membership_fee",
      amountCop: fee.amountCop,
      planId: feePlanId,
      note: "Mensualidad premium cargada al fiado",
      createdBy: params.actorLabel,
    });
    await tx
      .update(membershipCharges)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(membershipCharges.id, fee.id));
  }
  return pendingFee.reduce((s, f) => s + f.amountCop, 0);
}

/**
 * Carga al Fiado las mensualidades pendientes (reactivación de membresía con
 * método store_credit) — exige cuenta activa, sin mora y con cupo suficiente.
 */
export async function chargeMembershipFeeToCredit(params: {
  customerId: string;
  actor: { userId?: string; label: string };
}) {
  return db.transaction(async (tx) => {
    const account = await tx.query.creditAccounts.findFirst({
      where: eq(creditAccounts.customerId, params.customerId),
    });
    if (!account) {
      throw new CreditError("El cliente no tiene Fiado: cobra la mensualidad en efectivo o transferencia.");
    }
    if (account.status !== "active") {
      throw new CreditError("La cuenta de Fiado no está activa: cobra la mensualidad por otro medio.");
    }
    const [pending] = await tx
      .select({ total: sql<string>`coalesce(sum(${membershipCharges.amountCop}), 0)` })
      .from(membershipCharges)
      .innerJoin(memberships, eq(membershipCharges.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.customerId, params.customerId),
          eq(membershipCharges.status, "pending"),
          eq(membershipCharges.method, "store_credit"),
        ),
      );
    const feeTotal = Number(pending?.total ?? 0);
    const balance = await creditBalance(account.id, tx);
    if (balance + feeTotal > account.limitCop) {
      throw new CreditError(
        `El fiado no tiene cupo para la mensualidad (deuda $${balance.toLocaleString("es-CO")} de $${account.limitCop.toLocaleString("es-CO")}). Cóbrala por otro medio.`,
      );
    }
    const charged = await absorbPendingMembershipFees(tx, {
      customerId: params.customerId,
      accountId: account.id,
      actorLabel: params.actor.label,
    });
    await recordAudit(tx, {
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      action: "credit.membership_fee",
      entityType: "credit_account",
      entityId: account.id,
      after: { chargedCop: charged },
    });
    return { chargedCop: charged };
  });
}

/**
 * Alta de la cuenta de crédito.
 * - in_store: alta realizada por personal autorizado; no exige cédula.
 * - online: aplica las verificaciones configuradas de teléfono, correo,
 *   identidad y pedidos entregados.
 */
export async function openCreditAccount(params: {
  customerId: string;
  channel: "online" | "in_store";
  actor: { userId?: string; label: string };
}) {
  const rules = await getSetting("credit.rules");

  return db.transaction(async (tx) => {
    const customer = await tx.query.customers.findFirst({
      where: eq(customers.id, params.customerId),
    });
    if (!customer) throw new CreditError("Cliente no encontrado");

    // El Fiado NO exige membresía: la membresía premium es un beneficio aparte
    // (se gestiona solo en la app). El fiado se abre por sí solo.
    //
    // El registro en mostrador ya NO exige cédula: se abre solo con nombre,
    // celular y monto (ver enrollInStoreAction). Si el cliente ya tuviera un
    // documento almacenado, se conserva; no se solicita ni se exige aquí. El
    // canal en línea mantiene TODAS sus verificaciones (identidad incluida).
    if (params.channel === "online") {
      // Verificaciones del canal en línea: teléfono, correo e identidad (18+)
      // según credit.rules.
      if (rules.onlineRequirePhoneVerified && !customer.userId) {
        throw new CreditError("Necesitas una cuenta con tu celular verificado.");
      }
      if (rules.onlineRequireEmailVerified && !customer.emailVerifiedAt) {
        throw new CreditError("Verifica tu correo antes de abrir el crédito en línea.");
      }
      if (rules.onlineRequireIdentityVerified && !customer.ageVerifiedAt) {
        throw new CreditError("Falta verificar tu identidad (cédula, mayor de 18).");
      }
      if (rules.minPaidOrdersOnline > 0) {
        const [row] = await tx
          .select({ n: sql<string>`count(*)` })
          .from(orders)
          .where(and(eq(orders.customerId, params.customerId), eq(orders.status, "delivered")));
        if (Number(row?.n ?? 0) < rules.minPaidOrdersOnline) {
          throw new CreditError(
            `El canal en línea requiere ${rules.minPaidOrdersOnline} pedidos entregados (lleva ${row?.n ?? 0}).`,
          );
        }
      }
    }

    const existing = await tx.query.creditAccounts.findFirst({
      where: eq(creditAccounts.customerId, params.customerId),
    });
    if (existing?.archivedAt) {
      // Estaba eliminada de la cartera: el re-alta la RESTAURA (conserva su
      // historial contable) en lugar de crear una segunda cuenta.
      await tx
        .update(creditAccounts)
        .set({
          archivedAt: null,
          status: "active",
          pausedReason: null,
          vouchedBy: params.channel === "in_store" ? params.actor.label : existing.vouchedBy,
          updatedAt: new Date(),
        })
        .where(eq(creditAccounts.id, existing.id));
      await absorbPendingMembershipFees(tx, {
        customerId: params.customerId,
        accountId: existing.id,
        actorLabel: params.actor.label,
      });
      await recordAudit(tx, {
        actorUserId: params.actor.userId,
        actorLabel: params.actor.label,
        action: "credit.account_restore",
        entityType: "credit_account",
        entityId: existing.id,
        after: { customerId: params.customerId, via: "re-alta" },
      });
      return { accountId: existing.id, limitCop: existing.limitCop };
    }
    if (existing) throw new CreditError("Este cliente ya tiene cuenta de Fiado.");

    const accountId = id("cra");
    await tx.insert(creditAccounts).values({
      id: accountId,
      customerId: params.customerId,
      status: "active",
      limitCop: rules.initialLimitCop,
      channel: params.channel,
      vouchedBy: params.channel === "in_store" ? params.actor.label : null,
    });

    // La mensualidad premium pendiente (store_credit) NO se cobra al abrir la
    // cuenta: se DIFIERE y se suma a la primera compra fiada, dividida en sus
    // cuotas (ver createCreditPurchaseTx, foldMembershipFee). Así "fiar 50.000"
    // sin membresía = 59.900 en las mismas cuotas, no un cobro aparte.

    await recordAudit(tx, {
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      action: "credit.account_open",
      entityType: "credit_account",
      entityId: accountId,
      after: { customerId: params.customerId, channel: params.channel, limitCop: rules.initialLimitCop },
    });
    return { accountId, limitCop: rules.initialLimitCop };
  });
}

/**
 * Compra a crédito con su plan de cuotas. Valida cupo, tope de cartera,
 * mora y reglas de cuotas. `orderId` opcional (venta de mostrador se
 * registra por monto; la venta física se factura en el POS como siempre).
 */
export type CreditPurchaseParams = {
  customerId: string;
  totalCop: number;
  frequency: "weekly" | "biweekly";
  installments?: number;
  orderId?: string;
  note?: string;
  /**
   * Solo canal app/en línea: suma la mensualidad premium pendiente
   * (store_credit) al total de la compra y la reparte en LAS MISMAS cuotas
   * (ej. fiar 50.000 sin membresía → 59.900 en 4 semanales). En tienda queda
   * false: el fiado no lleva membresía.
   */
  foldMembershipFee?: boolean;
  actor: { userId?: string; label: string };
};

export async function createCreditPurchase(params: CreditPurchaseParams) {
  const rules = await getSetting("credit.rules");
  if (!Number.isInteger(params.totalCop) || params.totalCop <= 0) {
    throw new CreditError("Monto inválido.");
  }
  return db.transaction((tx) => createCreditPurchaseTx(tx, params, rules));
}

/**
 * Núcleo de la compra a crédito dentro de una transacción DADA — permite que
 * el checkout cree el pedido y su plan de cuotas de forma ATÓMICA: si el cupo
 * o la mora fallan, el pedido completo se revierte.
 */
export async function createCreditPurchaseTx(
  tx: DbOrTx,
  params: CreditPurchaseParams,
  rules: SettingValue<"credit.rules">,
) {
  if (!Number.isInteger(params.totalCop) || params.totalCop <= 0) {
    throw new CreditError("Monto inválido.");
  }
  {
    const account = await tx.query.creditAccounts.findFirst({
      where: eq(creditAccounts.customerId, params.customerId),
    });
    if (!account) throw new CreditError("El cliente no tiene cuenta de Fiado.");
    if (account.status !== "active") {
      throw new CreditError(`La cuenta está ${account.status === "paused" ? "pausada (mora u orden del negocio)" : "cerrada"}.`);
    }
    // El fiado ya no exige membresía. En el canal app, la mensualidad premium
    // pendiente se SUMA a esta compra y se reparte en sus cuotas.
    const feeRows = params.foldMembershipFee
      ? await tx
          .select({ id: membershipCharges.id, amountCop: membershipCharges.amountCop })
          .from(membershipCharges)
          .innerJoin(memberships, eq(membershipCharges.membershipId, memberships.id))
          .where(
            and(
              eq(memberships.customerId, params.customerId),
              eq(membershipCharges.status, "pending"),
              eq(membershipCharges.method, "store_credit"),
            ),
          )
      : [];
    const membershipFeeCop = feeRows.reduce((s, f) => s + f.amountCop, 0);
    const planTotalCop = params.totalCop + membershipFeeCop;

    // Mora: cuota vencida → no más crédito hasta ponerse al día.
    const [overdueRow] = await tx
      .select({ n: sql<string>`count(*)` })
      .from(creditInstallments)
      .innerJoin(creditPlans, eq(creditInstallments.planId, creditPlans.id))
      .where(
        and(
          eq(creditPlans.creditAccountId, account.id),
          eq(creditInstallments.status, "pending"),
          sql`${creditInstallments.dueDate} < now()`,
        ),
      );
    if (Number(overdueRow?.n ?? 0) > 0) {
      throw new CreditError("Tiene cuotas vencidas: debe ponerse al día antes de un nuevo fiado.");
    }

    const balance = await creditBalance(account.id, tx);
    if (balance + planTotalCop > account.limitCop) {
      const extra = membershipFeeCop > 0 ? ` (incluye mensualidad $${membershipFeeCop.toLocaleString("es-CO")})` : "";
      throw new CreditError(
        `Supera el cupo: deuda $${balance.toLocaleString("es-CO")} + fiado $${planTotalCop.toLocaleString("es-CO")}${extra} > cupo $${account.limitCop.toLocaleString("es-CO")}.`,
      );
    }
    const outstanding = await portfolioOutstanding(tx);
    if (outstanding + planTotalCop > rules.portfolioCapCop) {
      throw new CreditError(
        "Se alcanzó el tope total de cartera del negocio (ajustable en configuración).",
      );
    }
    if (!rules.allowedFrequencies.includes(params.frequency)) {
      throw new CreditError("Frecuencia de cuotas no permitida.");
    }

    // Cuotas sobre el TOTAL del fiado (compra + mensualidad si aplica): única a
    // 15 días para montos pequeños; si no, hasta el máximo de cuotas.
    const single = planTotalCop <= rules.singleInstallmentMaxCop;
    const count = single
      ? 1
      : Math.min(Math.max(params.installments ?? rules.maxInstallments, 2), rules.maxInstallments);

    const planNote = membershipFeeCop > 0
      ? `${params.note ? `${params.note} · ` : ""}incluye mensualidad premium ($${membershipFeeCop.toLocaleString("es-CO")})`
      : params.note ?? null;

    const planId = id("crp");
    await tx.insert(creditPlans).values({
      id: planId,
      creditAccountId: account.id,
      orderId: params.orderId ?? null,
      totalCop: planTotalCop,
      installmentsCount: count,
      frequency: single ? "single" : params.frequency,
      note: planNote,
      createdBy: params.actor.label,
    });

    const stepMs = single ? 15 * DAY_MS : (params.frequency === "weekly" ? 7 : 15) * DAY_MS;
    const base = Math.floor(planTotalCop / count);
    for (let i = 1; i <= count; i++) {
      // La última cuota absorbe el redondeo — la suma SIEMPRE cuadra exacta.
      const amount = i === count ? planTotalCop - base * (count - 1) : base;
      await tx.insert(creditInstallments).values({
        id: id("cri"),
        planId,
        seq: i,
        amountCop: amount,
        dueDate: new Date(Date.now() + stepMs * i),
      });
    }

    // Ledger: la compra y la mensualidad quedan como asientos separados (para
    // reportes) pero en el MISMO plan de cuotas.
    await tx.insert(creditLedger).values({
      id: id("crl"),
      creditAccountId: account.id,
      type: "purchase",
      amountCop: params.totalCop,
      planId,
      orderId: params.orderId ?? null,
      note: params.note ?? null,
      createdBy: params.actor.label,
    });
    if (membershipFeeCop > 0) {
      await tx.insert(creditLedger).values({
        id: id("crl"),
        creditAccountId: account.id,
        type: "membership_fee",
        amountCop: membershipFeeCop,
        planId,
        note: "Mensualidad premium (repartida en las cuotas del fiado)",
        createdBy: params.actor.label,
      });
      await tx
        .update(membershipCharges)
        .set({ status: "paid", paidAt: new Date() })
        .where(inArray(membershipCharges.id, feeRows.map((f) => f.id)));
    }

    await recordAudit(tx, {
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      action: "credit.purchase",
      entityType: "credit_plan",
      entityId: planId,
      after: { totalCop: params.totalCop, membershipFeeCop, planTotalCop, count, frequency: single ? "single" : params.frequency },
    });
    return { planId, installments: count, membershipFeeCop, planTotalCop };
  }
}

/**
 * Registra un abono (efectivo en tienda / transferencia). Reduce la deuda en
 * el ledger y salda cuotas pendientes en orden (las más antiguas primero).
 */
export async function registerCreditPayment(params: {
  customerId: string;
  amountCop: number;
  method: string; // cash | transfer
  actor: { userId?: string; label: string };
}) {
  if (!Number.isInteger(params.amountCop) || params.amountCop <= 0) {
    throw new CreditError("Monto de abono inválido.");
  }
  return db.transaction(async (tx) => {
    const account = await tx.query.creditAccounts.findFirst({
      where: eq(creditAccounts.customerId, params.customerId),
    });
    if (!account) throw new CreditError("El cliente no tiene cuenta de Fiado.");
    const balance = await creditBalance(account.id, tx);
    if (params.amountCop > balance) {
      throw new CreditError(
        `El abono ($${params.amountCop.toLocaleString("es-CO")}) supera la deuda ($${balance.toLocaleString("es-CO")}).`,
      );
    }

    await tx.insert(creditLedger).values({
      id: id("crl"),
      creditAccountId: account.id,
      type: "payment",
      amountCop: -params.amountCop,
      note: `Abono recibido (${params.method})`,
      createdBy: params.actor.label,
    });

    // Salda cuotas FIFO con el abono.
    let remaining = params.amountCop;
    const pending = await tx
      .select({ id: creditInstallments.id, amountCop: creditInstallments.amountCop })
      .from(creditInstallments)
      .innerJoin(creditPlans, eq(creditInstallments.planId, creditPlans.id))
      .where(and(eq(creditPlans.creditAccountId, account.id), eq(creditInstallments.status, "pending")))
      .orderBy(creditInstallments.dueDate, creditInstallments.seq);
    for (const inst of pending) {
      if (remaining < inst.amountCop) break;
      remaining -= inst.amountCop;
      await tx
        .update(creditInstallments)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(creditInstallments.id, inst.id));
    }

    // Planes cuyas cuotas quedaron todas pagas → completados.
    await tx.execute(sql`
      UPDATE credit_plans SET status = 'completed'
      WHERE credit_account_id = ${account.id} AND status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM credit_installments ci
          WHERE ci.plan_id = credit_plans.id AND ci.status = 'pending'
        )
    `);

    await recordAudit(tx, {
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      action: "credit.payment",
      entityType: "credit_account",
      entityId: account.id,
      after: { amountCop: params.amountCop, method: params.method },
    });
    return { newBalance: balance - params.amountCop };
  });
}

/** Ajusta el cupo de UNA cuenta (pedido explícito del propietario: editable). */
export async function adjustCreditLimit(params: {
  customerId: string;
  newLimitCop: number;
  actor: { userId?: string; label: string };
}) {
  const rules = await getSetting("credit.rules");
  if (!Number.isInteger(params.newLimitCop) || params.newLimitCop < 0) {
    throw new CreditError("Cupo inválido.");
  }
  if (params.newLimitCop > rules.maxLimitCop) {
    throw new CreditError(
      `El cupo máximo configurado es $${rules.maxLimitCop.toLocaleString("es-CO")} (ajustable en configuración → credit.rules).`,
    );
  }
  await db.transaction(async (tx) => {
    const account = await tx.query.creditAccounts.findFirst({
      where: eq(creditAccounts.customerId, params.customerId),
    });
    if (!account) throw new CreditError("El cliente no tiene cuenta de Fiado.");
    await tx
      .update(creditAccounts)
      .set({ limitCop: params.newLimitCop, updatedAt: new Date() })
      .where(eq(creditAccounts.id, account.id));
    await recordAudit(tx, {
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      action: "credit.limit_adjust",
      entityType: "credit_account",
      entityId: account.id,
      before: { limitCop: account.limitCop },
      after: { limitCop: params.newLimitCop },
    });
  });
}

/**
 * Elimina una cuenta de la CARTERA (borrado suave): exige deuda $0, queda en
 * el historial 90 días (restaurable) y luego desaparece de la interfaz. El
 * ledger contable nunca se destruye — respaldo ante cualquier reclamo.
 */
export async function archiveCreditAccount(params: {
  customerId: string;
  actor: { userId?: string; label: string };
}) {
  await db.transaction(async (tx) => {
    const account = await tx.query.creditAccounts.findFirst({
      where: eq(creditAccounts.customerId, params.customerId),
    });
    if (!account) throw new CreditError("El cliente no tiene cuenta de Fiado.");
    if (account.archivedAt) throw new CreditError("Esta cuenta ya está en el historial.");
    const balance = await creditBalance(account.id, tx);
    if (balance > 0) {
      throw new CreditError(
        `No se puede eliminar: tiene deuda de $${balance.toLocaleString("es-CO")}. Registra el abono primero.`,
      );
    }
    await tx
      .update(creditAccounts)
      .set({ archivedAt: new Date(), status: "closed", updatedAt: new Date() })
      .where(eq(creditAccounts.id, account.id));
    await recordAudit(tx, {
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      action: "credit.account_archive",
      entityType: "credit_account",
      entityId: account.id,
      after: { customerId: params.customerId },
    });
  });
}

/** Restaura una cuenta eliminada (dentro de los 90 días del historial). */
export async function restoreCreditAccount(params: {
  customerId: string;
  actor: { userId?: string; label: string };
}) {
  await db.transaction(async (tx) => {
    const account = await tx.query.creditAccounts.findFirst({
      where: eq(creditAccounts.customerId, params.customerId),
    });
    if (!account?.archivedAt) throw new CreditError("La cuenta no está en el historial.");
    await tx
      .update(creditAccounts)
      .set({ archivedAt: null, status: "active", pausedReason: null, updatedAt: new Date() })
      .where(eq(creditAccounts.id, account.id));
    await recordAudit(tx, {
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      action: "credit.account_restore",
      entityType: "credit_account",
      entityId: account.id,
      after: { customerId: params.customerId },
    });
  });
}

/** Pausa/reactiva una cuenta (mora o decisión del negocio). */
export async function setCreditAccountStatus(params: {
  customerId: string;
  status: "active" | "paused";
  reason?: string;
  actor: { userId?: string; label: string };
}) {
  await db.transaction(async (tx) => {
    const account = await tx.query.creditAccounts.findFirst({
      where: eq(creditAccounts.customerId, params.customerId),
    });
    if (!account) throw new CreditError("El cliente no tiene cuenta de Fiado.");
    await tx
      .update(creditAccounts)
      .set({ status: params.status, pausedReason: params.reason ?? null, updatedAt: new Date() })
      .where(eq(creditAccounts.id, account.id));
    await recordAudit(tx, {
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      action: "credit.status_change",
      entityType: "credit_account",
      entityId: account.id,
      after: { status: params.status, reason: params.reason },
    });
  });
}
