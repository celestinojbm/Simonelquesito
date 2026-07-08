import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments, refunds, commissionPeriods } from "@/db/schema";
import { id } from "@/lib/ids";
import { applyBps } from "@/lib/money";
import { getSetting } from "@/modules/config/service";
import { recordAudit } from "@/lib/audit";
import type { SettingValue } from "@/modules/config/keys";

export type CommissionBaseConfig = SettingValue<"commission.base">;

export type OrderForCommission = {
  channel: string;
  status: string;
  itemsTotalCop: number;
  discountCop: number;
  deliveryFeeCop: number;
  taxCop: number;
  tipCop: number;
  gatewayFeeCop: number;
  marketplaceCommissionCop: number;
  refundedCop: number;
};

export type CommissionBreakdown = {
  ordersCount: number;
  grossSalesCop: number;
  discountsCop: number;
  cancellationsCop: number;
  refundsCop: number;
  taxesCop: number;
  deliveryCop: number;
  tipsCop: number;
  gatewayFeesCop: number;
  marketplaceFeesCop: number;
  netMerchandiseCop: number;
  ratePctBps: number;
  commissionCop: number;
  byChannel: Record<string, { orders: number; netCop: number }>;
};

/**
 * Cálculo transparente de la comisión de agencia.
 * La base es 100% configurable ("commission.base" en settings): qué canales
 * cuentan como venta digital y qué conceptos se suman o deducen.
 * El desglose completo se muestra siempre — nunca se oculta el cálculo.
 */
export function computeCommission(
  ordersIn: OrderForCommission[],
  config: CommissionBaseConfig,
): CommissionBreakdown {
  const attributable = ordersIn.filter(
    (o) => config.channels.includes(o.channel) && o.status === "delivered",
  );
  const cancelled = ordersIn.filter(
    (o) => config.channels.includes(o.channel) && (o.status === "cancelled" || o.status === "refunded"),
  );

  const sum = (fn: (o: OrderForCommission) => number) =>
    attributable.reduce((s, o) => s + fn(o), 0);

  const grossSales = sum((o) => o.itemsTotalCop);
  const discounts = sum((o) => o.discountCop);
  const taxes = sum((o) => o.taxCop);
  const delivery = sum((o) => o.deliveryFeeCop);
  const tips = sum((o) => o.tipCop);
  const gatewayFees = sum((o) => o.gatewayFeeCop);
  const marketplaceFees = sum((o) => o.marketplaceCommissionCop);
  const refundsTotal = sum((o) => o.refundedCop);
  const cancellations = cancelled.reduce((s, o) => s + o.itemsTotalCop, 0);

  let base = grossSales;
  if (config.deductDiscounts) base -= discounts;
  if (config.includeTax) base += taxes;
  if (config.includeDelivery) base += delivery;
  if (config.includeTip) base += tips;
  if (config.deductGatewayFees) base -= gatewayFees;
  if (config.deductMarketplaceFees) base -= marketplaceFees;
  if (config.deductRefunds) base -= refundsTotal;
  const netMerchandise = Math.max(0, base);

  const byChannel: Record<string, { orders: number; netCop: number }> = {};
  for (const o of attributable) {
    const entry = (byChannel[o.channel] ??= { orders: 0, netCop: 0 });
    entry.orders += 1;
    let n = o.itemsTotalCop;
    if (config.deductDiscounts) n -= o.discountCop;
    if (config.deductGatewayFees) n -= o.gatewayFeeCop;
    if (config.deductMarketplaceFees) n -= o.marketplaceCommissionCop;
    if (config.deductRefunds) n -= o.refundedCop;
    entry.netCop += n;
  }

  return {
    ordersCount: attributable.length,
    grossSalesCop: grossSales,
    discountsCop: discounts,
    cancellationsCop: cancellations,
    refundsCop: refundsTotal,
    taxesCop: taxes,
    deliveryCop: delivery,
    tipsCop: tips,
    gatewayFeesCop: gatewayFees,
    marketplaceFeesCop: marketplaceFees,
    netMerchandiseCop: netMerchandise,
    ratePctBps: config.ratePctBps,
    commissionCop: applyBps(netMerchandise, config.ratePctBps),
    byChannel,
  };
}

export type CommissionRangeBreakdown = CommissionBreakdown & {
  /** Comisión de agencia YA liquidada en la fuente (split de Mercado Pago). */
  splitSettledCop: number;
  splitOrdersCount: number;
  /** Lo que queda por liquidar manualmente (comisión − split ya cobrado). */
  commissionDueCop: number;
};

/** Carga pedidos del rango con reembolsos agregados y calcula el desglose. */
export async function computeCommissionForRange(start: Date, end: Date): Promise<CommissionRangeBreakdown> {
  const config = await getSetting("commission.base");
  const rows = await db
    .select()
    .from(orders)
    .where(and(gte(orders.createdAt, start), lt(orders.createdAt, end)));

  const orderIds = rows.map((o) => o.id);
  const refundRows = orderIds.length
    ? await db
        .select({
          orderId: payments.orderId,
          amount: sql<number>`coalesce(sum(${refunds.amountCop}), 0)::int`,
        })
        .from(refunds)
        .innerJoin(payments, eq(refunds.paymentId, payments.id))
        .where(inArray(payments.orderId, orderIds))
        .groupBy(payments.orderId)
    : [];
  const refundByOrder = new Map(refundRows.map((r) => [r.orderId, r.amount]));

  // Comisiones reales reportadas por Mercado Pago (webhook): la comisión de la
  // pasarela deduce la base, y el split de agencia queda "liquidado en la
  // fuente" — se resta de lo que falta por cobrar manualmente.
  type FeeAttempt = { action?: string; gatewayFeeCop?: number; splitFeeCop?: number };
  const gatewayFeeByOrder = new Map<string, number>();
  const splitByOrder = new Map<string, number>();
  if (orderIds.length) {
    const payRows = await db
      .select({ orderId: payments.orderId, attempts: payments.attempts })
      .from(payments)
      .where(and(inArray(payments.orderId, orderIds), eq(payments.provider, "mercado_pago")));
    for (const p of payRows) {
      for (const a of (p.attempts as FeeAttempt[]) ?? []) {
        if (a?.action !== "webhook_approved") continue;
        if (a.gatewayFeeCop) gatewayFeeByOrder.set(p.orderId, (gatewayFeeByOrder.get(p.orderId) ?? 0) + a.gatewayFeeCop);
        if (a.splitFeeCop) splitByOrder.set(p.orderId, (splitByOrder.get(p.orderId) ?? 0) + a.splitFeeCop);
      }
    }
  }

  const breakdown = computeCommission(
    rows.map((o) => ({
      channel: o.channel,
      status: o.status,
      itemsTotalCop: o.itemsTotalCop,
      discountCop: o.discountCop,
      deliveryFeeCop: o.deliveryFeeCop,
      taxCop: o.taxCop,
      tipCop: o.tipCop,
      gatewayFeeCop: gatewayFeeByOrder.get(o.id) ?? 0,
      marketplaceCommissionCop: o.marketplaceCommissionCop,
      refundedCop: refundByOrder.get(o.id) ?? 0,
    })),
    config,
  );

  // Split contabilizado SOLO sobre pedidos atribuibles a la comisión
  // (entregados y de canal digital), igual que la base.
  let splitSettledCop = 0;
  let splitOrdersCount = 0;
  for (const o of rows) {
    if (o.status !== "delivered" || !config.channels.includes(o.channel)) continue;
    const settled = splitByOrder.get(o.id) ?? 0;
    if (settled > 0) {
      splitSettledCop += settled;
      splitOrdersCount += 1;
    }
  }

  return {
    ...breakdown,
    splitSettledCop,
    splitOrdersCount,
    commissionDueCop: Math.max(0, breakdown.commissionCop - splitSettledCop),
  };
}

/** Cierra un periodo con snapshot inmutable; requiere aprobación del owner después. */
export async function createCommissionPeriod(params: {
  label: string;
  start: Date;
  end: Date;
  actor: { userId?: string; label: string };
}) {
  const breakdown = await computeCommissionForRange(params.start, params.end);
  return db.transaction(async (tx) => {
    const [period] = await tx
      .insert(commissionPeriods)
      .values({
        id: id("cmp"),
        label: params.label,
        periodStart: params.start,
        periodEnd: params.end,
        status: "pending_approval",
        snapshot: breakdown,
        ratePctBps: breakdown.ratePctBps,
        commissionCop: breakdown.commissionCop,
      })
      .returning();
    await recordAudit(tx, {
      action: "commission.period_created",
      entityType: "commission_period",
      entityId: period!.id,
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      after: breakdown,
    });
    return period!;
  });
}
