import { asc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { orders, orderItems, orderStatusEvents, deliveries, drivers, users, payments } from "@/db/schema";
import { formatCop, qtyLabel } from "@/lib/format";
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, type OrderStatus } from "@/modules/orders/state";
import { OrderActions, WeightForm } from "./order-actions";
import { ScalePanel } from "@/components/scale/scale-panel";
import { ProductThumb } from "@/components/product-thumb";
import { ReceiveOrderButton } from "../receive-button";
import { BackLink } from "@/components/admin/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Detalle de pedido · Admin" };

const PREP_AREAS: Record<string, string> = {
  produce: "🥑 Frutas y verduras",
  grocery: "🌾 Abarrotes",
  refrigerated: "🧀 Refrigerados",
  beverages: "🥤 Bebidas",
  liquor: "🍺 Licores",
  cleaning: "🧼 Aseo",
  other: "📦 Otros",
};

export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await params;
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) notFound();

  const [items, events, delivery, payment, allDrivers] = await Promise.all([
    db.query.orderItems.findMany({ where: eq(orderItems.orderId, orderId) }),
    db.query.orderStatusEvents.findMany({ where: eq(orderStatusEvents.orderId, orderId), orderBy: asc(orderStatusEvents.createdAt) }),
    db.query.deliveries.findFirst({ where: eq(deliveries.orderId, orderId) }),
    db.query.payments.findFirst({ where: eq(payments.orderId, orderId) }),
    db.select({ id: drivers.id, name: users.fullName, vehicle: drivers.vehicle })
      .from(drivers)
      .innerJoin(users, eq(drivers.userId, users.id)),
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
  const nextStatuses = ORDER_TRANSITIONS[status] ?? [];
  const byArea = new Map<string, typeof items>();
  for (const item of items) {
    const list = byArea.get(item.prepArea) ?? [];
    list.push(item);
    byArea.set(item.prepArea, list);
  }

  return (
    <div className="max-w-4xl space-y-4">
      <BackLink href="/admin/pedidos" label="Pedidos" />
      {!order.acknowledgedAt && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card border-2 border-coral bg-sun/20 p-3">
          <span className="animate-pulse font-bold text-ink">🔔 Pedido nuevo sin recibir</span>
          <ReceiveOrderButton orderId={order.id} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold text-ink">
          Pedido {order.number}
          {order.hasRestrictedItems && <span className="ml-2 rounded-full bg-liquor px-2 py-0.5 align-middle text-xs font-bold text-white">+18 · verificar documento</span>}
        </h1>
        <span className="rounded-full bg-brand-soft px-4 py-1.5 font-bold text-brand-dark">
          {ORDER_STATUS_LABELS[status]}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Datos del cliente y entrega */}
        <section className="rounded-card border border-brand-soft bg-white p-4 text-sm">
          <h2 className="mb-2 font-bold text-ink">Cliente y entrega</h2>
          <dl className="space-y-1">
            <div><dt className="inline font-semibold">Nombre:</dt> <dd className="inline">{order.contactName}</dd></div>
            <div><dt className="inline font-semibold">Teléfono:</dt> <dd className="inline">{order.contactPhone}</dd></div>
            <div><dt className="inline font-semibold">Modalidad:</dt> <dd className="inline">{order.fulfillment === "delivery" ? "Domicilio" : "Recogida en tienda"}</dd></div>
            {order.addressLine && (
              <div><dt className="inline font-semibold">Dirección:</dt> <dd className="inline">{order.addressLine}, {order.neighborhood}</dd></div>
            )}
            {order.addressReferences && (
              <div><dt className="inline font-semibold">Referencias:</dt> <dd className="inline">{order.addressReferences}</dd></div>
            )}
            <div><dt className="inline font-semibold">Franja:</dt> <dd className="inline">{order.deliverySlot === "asap" ? "Lo antes posible" : order.deliverySlot}</dd></div>
            {order.instructions && (
              <div><dt className="inline font-semibold">Instrucciones:</dt> <dd className="inline">{order.instructions}</dd></div>
            )}
            <div>
              <dt className="inline font-semibold">Sustituciones:</dt>{" "}
              <dd className="inline">
                {{ no_substitution: "No sustituir", similar_product: "Producto similar", contact_me: "Contactar al cliente", up_to_price_limit: "Hasta un precio límite" }[order.substitutionPref]}
              </dd>
            </div>
          </dl>
        </section>

        {/* Pago */}
        <section className="rounded-card border border-brand-soft bg-white p-4 text-sm">
          <h2 className="mb-2 font-bold text-ink">Pago</h2>
          {payment ? (
            <dl className="space-y-1">
              <div><dt className="inline font-semibold">Método:</dt> <dd className="inline">{payment.method}</dd></div>
              <div><dt className="inline font-semibold">Estado:</dt> <dd className="inline font-bold">{payment.status}</dd></div>
              <div><dt className="inline font-semibold">Monto:</dt> <dd className="inline">{formatCop(payment.amountCop)}</dd></div>
              <div><dt className="inline font-semibold">Ref:</dt> <dd className="inline text-xs">{payment.providerRef}</dd></div>
            </dl>
          ) : (
            <p className="text-ink-soft">Sin registro de pago.</p>
          )}
          <dl className="mt-3 space-y-1 border-t border-brand-soft pt-2">
            <div className="flex justify-between"><dt>Productos</dt><dd>{formatCop(order.itemsTotalCop)}</dd></div>
            <div className="flex justify-between"><dt>Envío</dt><dd>{formatCop(order.deliveryFeeCop)}</dd></div>
            <div className="flex justify-between font-bold text-brand-dark"><dt>Total{order.isEstimatedTotal ? " (estimado)" : ""}</dt><dd>{formatCop(order.totalCop)}</dd></div>
          </dl>
          {delivery && (
            <p className="mt-2 rounded bg-sun/25 px-2 py-1 text-xs">
              Código de entrega: <strong className="tracking-widest">{delivery.confirmationCode}</strong>
            </p>
          )}
        </section>
      </div>

      {/* Vista de preparación agrupada por áreas */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-3 font-bold text-ink">Preparación por áreas</h2>
        {order.hasWeightItems && (
          <div className="mb-3">
            <ScalePanel />
          </div>
        )}
        <div className="space-y-4">
          {[...byArea.entries()].map(([area, areaItems]) => (
            <div key={area}>
              <h3 className="mb-1 text-sm font-bold text-brand-dark">{PREP_AREAS[area] ?? area}</h3>
              <ul className="divide-y divide-brand-soft rounded-lg border border-brand-soft text-sm">
                {areaItems.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductThumb {...thumbFor(item.variantId)} alt={item.nameSnapshot} size={36} />
                    <div>
                      <p className="font-medium">
                        {item.nameSnapshot}
                        {item.isRestricted && <span className="ml-1 text-xs font-bold text-liquor">+18</span>}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {qtyLabel(item.qty, item.saleUnitSnapshot)}
                        {item.note && ` · “${item.note}”`}
                        {item.actualWeightG !== null && ` · ✅ peso real ${item.actualWeightG} g`}
                      </p>
                    </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-brand-dark">
                        {formatCop(item.finalLineTotalCop ?? item.lineTotalCop)}
                      </span>
                      {(item.saleUnitSnapshot === "kg" || item.saleUnitSnapshot === "g" ||
                        (item.actualWeightG === null && order.hasWeightItems && ["preparing", "weight_adjustment_pending"].includes(status))) &&
                        ["preparing", "weight_adjustment_pending"].includes(status) && item.actualWeightG === null && (
                        <WeightForm orderItemId={item.id} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Acciones de estado y asignación */}
      <OrderActions
        orderId={order.id}
        nextStatuses={nextStatuses.filter((s) => !["paid", "delivered"].includes(s) || status === "ready" || status === "out_for_delivery")}
        statusLabels={ORDER_STATUS_LABELS}
        drivers={allDrivers.map((d) => ({ id: d.id, label: `${d.name} (${d.vehicle ?? "vehículo"})` }))}
        canAssign={status === "ready"}
      />

      {/* Historial */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-2 font-bold text-ink">Historial de estados</h2>
        <ol className="space-y-1 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-2">
              <span className="text-ink-soft">
                {e.createdAt.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span>
                {e.fromStatus ? `${ORDER_STATUS_LABELS[e.fromStatus as OrderStatus]} → ` : ""}
                <strong>{ORDER_STATUS_LABELS[e.toStatus as OrderStatus]}</strong>
              </span>
              <span className="text-ink-soft">por {e.actorLabel}</span>
              {e.reason && <span className="text-ink-soft">· {e.reason}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
