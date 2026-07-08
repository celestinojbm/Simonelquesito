import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { formatCop } from "@/lib/format";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/modules/orders/state";
import { ReceiveOrderButton } from "./receive-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pedidos · Admin" };

const STATUS_STYLE: Partial<Record<OrderStatus, string>> = {
  pending_payment: "bg-sun/30 text-ink",
  paid: "bg-brand-soft text-brand-dark",
  confirmed: "bg-brand-soft text-brand-dark",
  preparing: "bg-sun/40 text-ink",
  weight_adjustment_pending: "bg-sun/60 text-ink",
  ready: "bg-brand text-white",
  assigned: "bg-brand-dark text-white",
  out_for_delivery: "bg-brand-dark text-white",
  delivered: "bg-ink/10 text-ink-soft",
  cancelled: "bg-coral/15 text-coral-dark",
  failed: "bg-coral/15 text-coral-dark",
};

export default async function AdminOrdersPage() {
  const rows = await db.query.orders.findMany({ orderBy: desc(orders.createdAt), limit: 100 });

  // Pedidos por RESCATAR: quedaron esperando el pago hace más de 45 minutos
  // (checkout iniciado y no terminado) o fallaron en las últimas 48 horas.
  // Mientras la API de WhatsApp no esté activa, el rescate es manual con un
  // clic: abre el chat del cliente con el mensaje ya escrito.
  const now = Date.now();
  const rescuable = rows.filter((o) => {
    const ageMin = (now - o.createdAt.getTime()) / 60_000;
    if (o.status === "pending_payment" && ageMin > 45) return true;
    if (o.status === "failed" && ageMin < 48 * 60) return true;
    return false;
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-ink">Pedidos</h1>
        <Link href="/admin/pedidos/nuevo" className="btn rounded-full bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-dark">
          + Nuevo pedido
        </Link>
      </div>

      {rescuable.length > 0 && (
        <section className="mb-4 rounded-card border border-sun bg-sun/15 p-4">
          <h2 className="font-bold text-ink">🛟 Por rescatar ({rescuable.length})</h2>
          <p className="mb-2 text-xs text-ink-soft">
            Checkouts que quedaron a medias. Un mensaje a tiempo recupera la venta — el botón abre
            el WhatsApp del cliente con el texto listo.
          </p>
          <ul className="space-y-1.5">
            {rescuable.map((o) => {
              const phone = o.contactPhone.replace(/[^0-9]/g, "");
              const wa = `57${phone.slice(-10)}`;
              const msg = encodeURIComponent(
                `¡Hola ${o.contactName.split(" ")[0]}! 👋 Vimos que tu pedido ${o.number} en nuestra tienda quedó a medias (${formatCop(o.totalCop)}). ¿Te ayudamos a completarlo? También puedes pagar contra entrega si lo prefieres 🛵`,
              );
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/admin/pedidos/${o.id}`} className="font-semibold text-brand-dark hover:underline">
                    {o.number}
                  </Link>
                  <span>{o.contactName}</span>
                  <span className="text-ink-soft">{formatCop(o.totalCop)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[o.status as OrderStatus]}`}>
                    {ORDER_STATUS_LABELS[o.status as OrderStatus]}
                  </span>
                  <a
                    href={`https://wa.me/${wa}?text=${msg}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn ml-auto rounded-full bg-[#25D366] px-3 py-1 text-xs font-bold text-white"
                  >
                    💬 Rescatar por WhatsApp
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="rounded-card border border-brand-soft bg-white p-10 text-center text-ink-soft">
          Aún no hay pedidos. Crea uno desde la tienda para probar el flujo completo.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-brand-soft bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-brand-soft bg-brand-soft/50 text-xs text-ink-soft uppercase">
              <tr>
                <th className="px-4 py-3">Pedido</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Entrega</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Hora</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-soft">
              {rows.map((o) => (
                <tr key={o.id} className={o.acknowledgedAt ? "hover:bg-brand-soft/30" : "bg-sun/20 hover:bg-sun/30"}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/pedidos/${o.id}`} className="font-bold text-brand-dark hover:underline">
                      {o.number}
                    </Link>
                    {!o.acknowledgedAt && (
                      <span className="ml-1 animate-pulse rounded-full bg-coral px-2 py-0.5 text-[10px] font-extrabold text-white">
                        🔔 NUEVO
                      </span>
                    )}
                    {o.hasRestrictedItems && <span className="ml-1" title="Incluye +18">🔞</span>}
                    {o.hasWeightItems && <span className="ml-1" title="Incluye peso variable">⚖️</span>}
                    {!o.acknowledgedAt && (
                      <div className="mt-1">
                        <ReceiveOrderButton orderId={o.id} small />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{o.contactName}<br /><span className="text-xs text-ink-soft">{o.contactPhone}</span></td>
                  <td className="px-4 py-3">{o.channel}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_STYLE[o.status as OrderStatus] ?? "bg-brand-soft"}`}>
                      {ORDER_STATUS_LABELS[o.status as OrderStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3">{o.fulfillment === "delivery" ? `🛵 ${o.neighborhood ?? ""}` : "🏪 Recogida"}</td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {formatCop(o.totalCop)}
                    {o.isEstimatedTotal && <span className="text-xs text-ink-soft"> aprox.</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-soft">
                    {o.createdAt.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
