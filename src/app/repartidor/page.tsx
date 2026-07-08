import Image from "next/image";
import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, drivers, orders, payments } from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { logoutAction } from "@/app/actions/auth";
import { formatCop } from "@/lib/format";
import { DeliveryCard } from "./delivery-card";
import { LocationReporter } from "./location-reporter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis entregas · Domiciliario" };

export default async function DriverPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "driver") redirect("/cuenta");

  const driver = await db.query.drivers.findFirst({ where: eq(drivers.userId, user.id) });
  const myDeliveries = driver
    ? await db
        .select({ delivery: deliveries, order: orders })
        .from(deliveries)
        .innerJoin(orders, eq(deliveries.orderId, orders.id))
        .where(eq(deliveries.driverId, driver.id))
        .orderBy(desc(deliveries.assignedAt))
        .limit(20)
    : [];

  const active = myDeliveries.filter((d) => ["assigned", "picked_up"].includes(d.delivery.status));
  const done = myDeliveries.filter((d) => !["assigned", "picked_up"].includes(d.delivery.status));

  const activePayments = active.length
    ? await db.query.payments.findMany({
        where: inArray(payments.orderId, active.map((d) => d.order.id)),
      })
    : [];
  const paymentByOrder = new Map(activePayments.map((p) => [p.orderId, p.method]));

  return (
    <div className="mx-auto max-w-md px-4 py-4">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Image src="/icons/logo.svg" alt="" width={36} height={36} />
          <div className="leading-tight">
            <p className="font-extrabold text-ink">Mis entregas</p>
            <p className="text-xs text-ink-soft">{user.fullName}</p>
          </div>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="btn rounded-full border border-brand-soft px-4 py-2 text-sm text-ink-soft">
            Salir
          </button>
        </form>
      </header>

      <LocationReporter activeCount={active.filter((d) => d.delivery.status === "picked_up").length} />

      {active.length === 0 ? (
        <p className="rounded-card border border-brand-soft bg-white p-8 text-center text-ink-soft">
          🛵 No tienes entregas asignadas ahora.
        </p>
      ) : (
        <ul className="space-y-3">
          {active.map(({ delivery, order }) => (
            <DeliveryCard
              key={delivery.id}
              orderId={order.id}
              number={order.number}
              status={delivery.status}
              contactName={order.contactName}
              contactPhone={order.contactPhone}
              addressLine={order.addressLine ?? ""}
              neighborhood={order.neighborhood ?? ""}
              references={order.addressReferences}
              instructions={order.instructions}
              totalLabel={formatCop(order.totalCop)}
              idCheckRequired={order.idCheckRequired}
              paymentOnDelivery={
                ["cash_on_delivery", "card_on_delivery", "bank_transfer"].includes(paymentByOrder.get(order.id) ?? "")
                  ? (paymentByOrder.get(order.id) ?? null)
                  : null
              }
            />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-bold text-ink-soft uppercase">Historial</h2>
          <ul className="space-y-1 text-sm">
            {done.map(({ delivery, order }) => (
              <li key={delivery.id} className="flex justify-between rounded-lg bg-white px-3 py-2">
                <span>{order.number} · {delivery.status === "delivered" ? "✅ entregado" : delivery.status}</span>
                <span className="text-ink-soft">{formatCop(order.totalCop)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
