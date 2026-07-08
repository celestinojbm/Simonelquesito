import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, orderItems, productVariants } from "@/db/schema";
import { weightLineTotal } from "@/lib/money";
import { getSetting } from "@/modules/config/service";
import { recordAudit } from "@/lib/audit";
import { transitionOrder } from "./state";

/**
 * Registro de peso real por el preparador.
 * Recalcula la línea y el total del pedido; si la diferencia supera la
 * tolerancia configurada, el pedido pasa a "weight_adjustment_pending"
 * (requiere aprobación del cliente vía WhatsApp o del admin).
 */
export async function recordActualWeight(params: {
  orderItemId: string;
  actualWeightG: number;
  actor: { userId?: string; label: string };
}) {
  if (!Number.isInteger(params.actualWeightG) || params.actualWeightG <= 0) {
    throw new Error("Peso real inválido (gramos enteros > 0)");
  }
  const toleranceBps = await getSetting("orders.weightTolerancePctBps");

  return db.transaction(async (tx) => {
    const item = await tx.query.orderItems.findFirst({
      where: eq(orderItems.id, params.orderItemId),
    });
    if (!item) throw new Error("Línea de pedido no encontrada");
    const variant = await tx.query.productVariants.findFirst({
      where: eq(productVariants.id, item.variantId),
    });
    if (!variant) throw new Error("Variante no encontrada");

    // Peso estimado original: qty en gramos (venta por peso) o
    // estimatedWeightG × unidades (venta por unidad de peso variable).
    const estimatedG =
      variant.saleUnit === "kg" || variant.saleUnit === "g"
        ? item.qty
        : (variant.estimatedWeightG ?? 0) * item.qty;

    const finalTotal =
      variant.saleUnit === "kg" || variant.saleUnit === "g"
        ? weightLineTotal(item.unitPriceCop, params.actualWeightG)
        : variant.estimatedWeightG
          ? weightLineTotal(
              Math.round((item.unitPriceCop * 1000) / variant.estimatedWeightG),
              params.actualWeightG,
            )
          : item.lineTotalCop;

    await tx
      .update(orderItems)
      .set({ actualWeightG: params.actualWeightG, finalLineTotalCop: finalTotal })
      .where(eq(orderItems.id, params.orderItemId));

    // Recalcular total del pedido con las líneas ya pesadas
    const allItems = await tx.query.orderItems.findMany({
      where: eq(orderItems.orderId, item.orderId),
    });
    const itemsTotal = allItems.reduce(
      (sum, it) =>
        sum + (it.id === params.orderItemId ? finalTotal : (it.finalLineTotalCop ?? it.lineTotalCop)),
      0,
    );
    const order = await tx.query.orders.findFirst({ where: eq(orders.id, item.orderId) });
    if (!order) throw new Error("Pedido no encontrado");
    const newTotal = itemsTotal - order.discountCop + order.deliveryFeeCop + order.tipCop;

    await tx
      .update(orders)
      .set({ itemsTotalCop: itemsTotal, totalCop: newTotal, updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    await recordAudit(tx, {
      action: "order.weight_recorded",
      entityType: "order_item",
      entityId: params.orderItemId,
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      before: { estimatedG, lineTotalCop: item.lineTotalCop },
      after: { actualWeightG: params.actualWeightG, finalLineTotalCop: finalTotal },
    });

    // ¿Supera la tolerancia? → aprobación requerida
    const diffBps =
      estimatedG > 0 ? Math.abs(params.actualWeightG - estimatedG) * 10000 / estimatedG : 0;
    const needsApproval = diffBps > toleranceBps;
    if (needsApproval && order.status === "preparing") {
      await transitionOrder(tx, {
        orderId: order.id,
        to: "weight_adjustment_pending",
        actorUserId: params.actor.userId,
        actorLabel: params.actor.label,
        reason: `Diferencia de peso ${(diffBps / 100).toFixed(1)}% supera tolerancia ${(toleranceBps / 100).toFixed(1)}%`,
      });
    }

    return {
      finalLineTotalCop: finalTotal,
      newOrderTotalCop: newTotal,
      needsApproval,
      diffPct: diffBps / 100,
    };
  });
}
