import { eq, asc, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { orders, orderItems, orderStatusEvents, deliveries, payments } from "@/db/schema";
import { formatCop, qtyLabel } from "@/lib/format";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/modules/orders/state";
import { getSessionUser } from "@/lib/auth/session";
import { customerForUser } from "@/modules/accounts/service";
import { SubscribeBox } from "./subscribe-box";
import { ProductThumb } from "@/components/product-thumb";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seguimiento de pedido" };

const PROGRESS: OrderStatus[] = ["confirmed", "preparing", "ready", "out_for_delivery", "delivered"];

const STATUS_ICON: Partial<Record<OrderStatus, string>> = {
  new: "🆕", pending_payment: "⏳", paid: "💳", confirmed: "✅", preparing: "👩‍🍳",
  awaiting_substitution: "🔄", weight_adjustment_pending: "⚖️", ready: "📦",
  assigned: "🛵", out_for_delivery: "🛵", delivered: "🎉", cancelled: "🚫",
  refunded: "↩️", failed: "❌",
};

export default async function OrderTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await params;
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) notFound();

  const [items, events, delivery, payment] = await Promise.all([
    db.query.orderItems.findMany({ where: eq(orderItems.orderId, orderId) }),
    db.query.orderStatusEvents.findMany({
      where: eq(orderStatusEvents.orderId, orderId),
      orderBy: asc(orderStatusEvents.createdAt),
    }),
    db.query.deliveries.findFirst({ where: eq(deliveries.orderId, orderId) }),
    db.query.payments.findFirst({ where: eq(payments.orderId, orderId) }),
  ]);

  // Miniatura por ítem: variante → producto → primera imagen (o ícono).
  const variantIds = items.map((i) => i.variantId);
  const thumbs = variantIds.length
    ? await db.execute<{ variant_id: string; image_id: string | null; url: string | null; icon: string | null }>(sql`
        select pv.id as variant_id, pi.id as image_id, pi.url, c.icon
        from product_variants pv
        join products p on p.id = pv.product_id
        join categories c on c.id = p.category_id
        left join lateral (
          select id, url from product_images where product_id = p.id order by sort_order asc limit 1
        ) pi on true
        where pv.id in ${variantIds}`).then((r) => r.rows)
    : [];
  const thumbFor = (variantId: string) => {
    const t = thumbs.find((x) => x.variant_id === variantId);
    if (!t) return { imageUrl: null, icon: null };
    return {
      imageUrl: t.image_id && t.url ? (t.url.startsWith("data:") ? `/api/images/${t.image_id}` : t.url) : null,
      icon: t.icon,
    };
  };

  const status = order.status as OrderStatus;
  const progressIdx = PROGRESS.indexOf(status);
  const isFinalNegative = ["cancelled", "refunded", "failed"].includes(status);

  // Canasta recurrente: solo si el pedido pertenece al cliente en sesión.
  const user = await getSessionUser();
  const sessionCustomer = user ? await customerForUser(user.id) : null;
  const canSubscribe =
    !!sessionCustomer && order.customerId === sessionCustomer.id && status === "delivered";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-card border border-brand-soft bg-white p-5 text-center">
        <p className="text-sm text-ink-soft">Pedido</p>
        <h1 className="text-2xl font-extrabold text-ink">{order.number}</h1>
        <p className={`mt-2 inline-block rounded-full px-4 py-1.5 font-bold ${isFinalNegative ? "bg-coral/15 text-coral-dark" : "bg-brand-soft text-brand-dark"}`}>
          {STATUS_ICON[status]} {ORDER_STATUS_LABELS[status]}
        </p>

        {status === "pending_payment" && payment?.provider === "sandbox" && payment.providerRef && (
          <p className="mt-3">
            <Link href={`/pago-sandbox/${payment.providerRef}`} className="btn inline-block rounded-full bg-coral px-6 py-3 font-bold text-white">
              Completar el pago
            </Link>
          </p>
        )}

        {order.fulfillment === "delivery" && order.locationToken && !isFinalNegative && (
          <p className="mt-3">
            <Link
              href={`/ubicacion/${order.locationToken}`}
              className="btn inline-block rounded-full border border-brand px-4 py-2 text-sm font-bold text-brand-dark hover:bg-brand-soft"
            >
              🗺️ {order.deliveryLat != null ? "Ver el domicilio en el mapa" : "Fijar mi ubicación en el mapa"}
            </Link>
          </p>
        )}

        {/* Barra de progreso */}
        {!isFinalNegative && progressIdx >= 0 && (
          <ol className="mt-4 flex items-center justify-between gap-1" aria-label="Progreso del pedido">
            {PROGRESS.map((step, i) => (
              <li key={step} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                    i <= progressIdx ? "bg-brand text-white" : "bg-brand-soft text-ink-soft"
                  }`}
                  aria-hidden
                >
                  {i < progressIdx ? "✓" : i + 1}
                </span>
                <span className={`text-[10px] leading-tight ${i <= progressIdx ? "font-bold text-brand-dark" : "text-ink-soft"}`}>
                  {ORDER_STATUS_LABELS[step]}
                </span>
              </li>
            ))}
          </ol>
        )}

        {delivery && !isFinalNegative && status !== "delivered" && (
          <div className="mt-4 rounded-card bg-sun/25 p-3 text-sm">
            <p className="font-bold text-ink">Código de entrega: <span className="text-xl tracking-widest">{delivery.confirmationCode}</span></p>
            <p className="text-ink-soft">Dáselo al domiciliario al recibir tu pedido.</p>
          </div>
        )}

        {order.idCheckRequired && (
          <p className="mt-3 rounded-card bg-liquor-soft p-3 text-xs text-liquor">
            Este pedido incluye productos +18: ten tu documento de identidad a la mano para la entrega.
          </p>
        )}
      </div>

      {/* Items */}
      <div className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-2 font-bold text-ink">Productos</h2>
        <ul className="divide-y divide-brand-soft text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <ProductThumb {...thumbFor(item.variantId)} alt={item.nameSnapshot} size={36} />
              <div>
                <p className="font-medium">{item.nameSnapshot}</p>
                <p className="text-xs text-ink-soft">
                  {qtyLabel(item.qty, item.saleUnitSnapshot)}
                  {item.actualWeightG !== null && ` · peso real: ${item.actualWeightG} g`}
                  {item.note && ` · “${item.note}”`}
                </p>
              </div>
              </div>
              <p className="font-semibold text-brand-dark">
                {formatCop(item.finalLineTotalCop ?? item.lineTotalCop)}
                {item.finalLineTotalCop === null && order.hasWeightItems && item.actualWeightG === null && (
                  <span className="ml-1 text-xs font-normal text-ink-soft">aprox.</span>
                )}
              </p>
            </li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1 border-t border-brand-soft pt-2 text-sm">
          <div className="flex justify-between"><dt>Envío</dt><dd>{order.deliveryFeeCop === 0 ? "Gratis" : formatCop(order.deliveryFeeCop)}</dd></div>
          <div className="flex justify-between text-base font-bold text-brand-dark">
            <dt>Total{order.isEstimatedTotal ? " estimado" : ""}</dt>
            <dd>{formatCop(order.totalCop)}</dd>
          </div>
        </dl>
      </div>

      {/* Historial */}
      <div className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-2 font-bold text-ink">Historial</h2>
        <ol className="space-y-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="text-ink-soft">
                {e.createdAt.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" })}
              </span>
              <span>
                <strong>{ORDER_STATUS_LABELS[e.toStatus as OrderStatus]}</strong>
                {e.reason && <span className="text-ink-soft"> — {e.reason}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {canSubscribe && <SubscribeBox orderId={order.id} />}

      <p className="text-center text-sm text-ink-soft">
        ¿Dudas con tu pedido? Escríbenos por el botón de WhatsApp.
      </p>
    </div>
  );
}
