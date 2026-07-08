import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionItems, subscriptions } from "@/db/schema";
import { CanastasConsole } from "./canastas-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "Canastas · Admin" };

export default async function CanastasPage() {
  const rows = await db
    .select({
      sub: subscriptions,
      customerName: customers.fullName,
      customerPhone: customers.phone,
      itemCount: sql<number>`(select count(*) from ${subscriptionItems} si where si.subscription_id = ${subscriptions.id})::int`,
    })
    .from(subscriptions)
    .innerJoin(customers, eq(subscriptions.customerId, customers.id))
    .orderBy(desc(subscriptions.createdAt))
    .limit(100);

  const cronOn = !!process.env.CRON_SECRET;

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-extrabold text-ink">Canastas recurrentes</h1>
      <p className="mb-2 text-sm text-ink-soft">
        Cada canasta se convierte en un pedido real el día elegido (demanda predecible: sabes cuántos
        kilos comprar ANTES de ir a Abastos). Se paga al recibir. El cliente la crea desde un pedido
        entregado («Recibir este pedido cada semana») y la administra en su cuenta.
      </p>
      <p className={`mb-4 rounded-lg px-3 py-2 text-xs ${cronOn ? "bg-brand-soft text-brand-dark" : "bg-sun/40 text-ink"}`}>
        {cronOn
          ? "✅ Generación automática activa: todos los días 6:00 a. m. (cron)."
          : "⚠️ Generación automática apagada: configura CRON_SECRET en Vercel (docs). Mientras tanto usa «Generar ahora»."}
      </p>
      <CanastasConsole
        rows={rows.map((r) => ({
          id: r.sub.id,
          name: r.sub.name,
          customer: r.customerName,
          phone: r.customerPhone,
          frequency: r.sub.frequency,
          deliveryDay: r.sub.deliveryDay,
          status: r.sub.status,
          nextRunAt: r.sub.nextRunAt.toISOString(),
          lastError: r.sub.lastError,
          itemCount: r.itemCount,
        }))}
      />
    </div>
  );
}
