import Link from "next/link";
import { and, eq, gte, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders, orderItems, productVariants, products, inventoryMovements, customers } from "@/db/schema";
import { formatCop } from "@/lib/format";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/modules/orders/state";
import { getSessionUser } from "@/lib/auth/session";
import { roleHas } from "@/lib/auth/permissions";
import { getSetting } from "@/modules/config/service";
import { dashboardCardsForRole } from "@/modules/admin/dashboard";
import { listExpiringLots } from "@/modules/inventory/service";
import { listRecentStationMovements } from "@/modules/inventory/weigh-station-queries";
import { DashboardTabs } from "./dashboard-tabs";
import { PanelBlocks } from "./panel-blocks";
import { WeighStation } from "./weigh-station/weigh-station";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · Admin" };

function startOfTodayBogota(): Date {
  const now = new Date();
  const bogota = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }));
  bogota.setHours(0, 0, 0, 0);
  const offset = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" })).getTime();
  return new Date(bogota.getTime() + offset);
}

export default async function AdminDashboard() {
  const today = startOfTodayBogota();

  const todayOrders = await db.query.orders.findMany({ where: gte(orders.createdAt, today) });
  const delivered = todayOrders.filter((o) => o.status === "delivered");
  // Ventas de hoy separadas por canal: tienda física (Caja, pos_physical) vs
  // en línea (web/WhatsApp). El total es la suma de ambas.
  const deliveredStore = delivered.filter((o) => o.channel === "pos_physical");
  const deliveredOnline = delivered.filter((o) => o.channel !== "pos_physical");
  const salesStore = deliveredStore.reduce((s, o) => s + o.totalCop, 0);
  const salesOnline = deliveredOnline.reduce((s, o) => s + o.totalCop, 0);
  const salesToday = salesStore + salesOnline;
  const avgTicket = delivered.length > 0 ? Math.round(salesToday / delivered.length) : 0;
  const activeStatuses: OrderStatus[] = ["paid", "confirmed", "preparing", "awaiting_substitution", "weight_adjustment_pending", "ready", "assigned", "out_for_delivery"];
  const active = todayOrders.filter((o) => activeStatuses.includes(o.status as OrderStatus));

  // Productos más vendidos hoy
  const topProducts = delivered.length
    ? await db
        .select({
          name: orderItems.nameSnapshot,
          qty: sql<number>`sum(${orderItems.qty})::int`,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, delivered.map((o) => o.id)))
        .groupBy(orderItems.nameSnapshot)
        .orderBy(sql`sum(${orderItems.qty}) desc`)
        .limit(5)
    : [];

  // Productos agotándose (stock físico bajo, solo variantes por unidad)
  const lowStock = await db
    .select({
      variantId: productVariants.id,
      name: products.name,
      variantName: productVariants.name,
      physical: sql<number>`coalesce(sum(${inventoryMovements.qty}), 0)::int`,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(inventoryMovements, eq(inventoryMovements.variantId, productVariants.id))
    .where(and(eq(productVariants.isActive, true), eq(productVariants.saleUnit, "unit")))
    .groupBy(productVariants.id, products.name, productVariants.name)
    .having(sql`coalesce(sum(${inventoryMovements.qty}), 0) < 15`)
    .orderBy(sql`coalesce(sum(${inventoryMovements.qty}), 0) asc`)
    .limit(6);

  // Lotes por vencer (FEFO) — perecederos: embutidos, quesos, carnes frías...
  const expiringLots = await listExpiringLots(5);

  const newCustomersToday = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(customers)
    .where(gte(customers.createdAt, today));

  const allCards: { key: string; label: string; value: string; sub?: string; accent: string }[] = [
    { key: "total", label: "Ventas totales hoy", value: formatCop(salesToday), sub: `${delivered.length} venta${delivered.length === 1 ? "" : "s"} (en línea + tienda)`, accent: "text-brand-dark" },
    { key: "online", label: "🛒 En línea hoy", value: formatCop(salesOnline), sub: `${deliveredOnline.length} pedido${deliveredOnline.length === 1 ? "" : "s"}`, accent: "text-brand-dark" },
    { key: "store", label: "🏪 Tienda física hoy", value: formatCop(salesStore), sub: `${deliveredStore.length} venta${deliveredStore.length === 1 ? "" : "s"} en Caja`, accent: "text-brand-dark" },
    { key: "active", label: "Pedidos activos", value: String(active.length), sub: "en preparación / camino", accent: "text-coral-dark" },
    { key: "ticket", label: "Ticket promedio hoy", value: delivered.length ? formatCop(avgTicket) : "—", accent: "text-ink" },
    { key: "new", label: "Clientes nuevos hoy", value: String(newCustomersToday[0]?.n ?? 0), accent: "text-ink" },
  ];

  // Tarjetas visibles y en orden según la configuración por rol (Nivel 2).
  const [user, panel, recentStation] = await Promise.all([
    getSessionUser(),
    getSetting("admin.panel"),
    listRecentStationMovements(10),
  ]);
  const byKey = new Map(allCards.map((c) => [c.key, c]));
  const cards = dashboardCardsForRole(panel.dashboard, user?.role ?? "owner", allCards.map((c) => c.key))
    .map((k) => byKey.get(k)!)
    .filter(Boolean);

  const role = user?.role ?? "owner";

  return (
    <div className="space-y-6">
      {/* Estación de balanza y escáner: primer elemento operativo del panel
          (no configurable/ocultable en esta primera versión). */}
      <WeighStation
        recent={recentStation}
        canReceive={roleHas(role, "inventory.receive")}
        canAdjust={roleHas(role, "inventory.adjust")}
      />

      <DashboardTabs />

      {/* Bloques personalizados del inicio (Nivel 3), configurados por el dueño. */}
      <PanelBlocks blocks={panel.blocks} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-card border border-brand-soft bg-white p-4">
            <p className="text-xs text-ink-soft">{c.label}</p>
            <p className={`mt-1 text-xl font-extrabold ${c.accent}`}>{c.value}</p>
            {c.sub && <p className="mt-0.5 text-[11px] text-ink-soft">{c.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-card border border-brand-soft bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold text-ink">Pedidos activos</h2>
            <Link href="/admin/pedidos" className="text-sm font-semibold text-brand-dark hover:underline">Ver todos →</Link>
          </div>
          {active.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-soft">Sin pedidos activos ahora mismo.</p>
          ) : (
            <ul className="divide-y divide-brand-soft text-sm">
              {active.slice(0, 8).map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2">
                  <Link href={`/admin/pedidos/${o.id}`} className="font-semibold text-brand-dark hover:underline">
                    {o.number}
                  </Link>
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-dark">
                    {ORDER_STATUS_LABELS[o.status as OrderStatus]}
                  </span>
                  <span className="font-semibold">{formatCop(o.totalCop)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-card border border-brand-soft bg-white p-4">
          <h2 className="mb-2 font-bold text-ink">Más vendidos hoy</h2>
          {topProducts.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-soft">Aún no hay ventas entregadas hoy.</p>
          ) : (
            <ol className="list-inside list-decimal space-y-1 text-sm">
              {topProducts.map((p) => (
                <li key={p.name}>
                  {p.name} <span className="text-ink-soft">({p.qty})</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-card border border-sun bg-sun/10 p-4 md:col-span-2">
          <h2 className="mb-2 font-bold text-ink">⚠️ Productos agotándose (menos de 15 und.)</h2>
          {lowStock.length === 0 ? (
            <p className="text-sm text-ink-soft">Todo con stock suficiente.</p>
          ) : (
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {lowStock.map((p) => (
                <li key={p.variantId} className="flex justify-between rounded bg-white px-3 py-1.5">
                  <span>{p.name} · {p.variantName}</span>
                  <strong className={p.physical <= 5 ? "text-coral-dark" : "text-ink"}>{p.physical} und.</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        {expiringLots.length > 0 && (
          <section className="rounded-card border border-sun bg-sun/10 p-4 md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-bold text-ink">⏰ Lotes por vencer ({expiringLots.length})</h2>
              <Link href="/admin/inventario" className="text-sm font-semibold text-brand-dark hover:underline">
                Ver inventario →
              </Link>
            </div>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {expiringLots.slice(0, 8).map((l) => (
                <li key={l.lotId} className="flex justify-between rounded bg-white px-3 py-1.5">
                  <span>{l.productName} · {l.variantName}{l.lotCode ? ` (${l.lotCode})` : ""}</span>
                  <strong className="text-coral-dark">
                    {l.expiresAt?.toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
                  </strong>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
