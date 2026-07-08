import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { logoutAction } from "@/app/actions/auth";
import { PhoneLogin } from "@/components/account/phone-login";
import { getActiveMembership } from "@/modules/premium/service";
import { getCreditStatus } from "@/modules/credit/service";
import { subscriptions, subscriptionItems } from "@/db/schema";
import { sql } from "drizzle-orm";
import { SubscriptionList } from "@/components/account/subscription-list";
import { MarketingToggle } from "@/components/account/marketing-toggle";
import { getMarketingConsent } from "@/modules/accounts/consent";

/** Canastas recurrentes del cliente. */
async function CustomerBaskets({ customerId }: { customerId: string }) {
  const subs = await db
    .select({
      id: subscriptions.id,
      name: subscriptions.name,
      frequency: subscriptions.frequency,
      deliveryDay: subscriptions.deliveryDay,
      status: subscriptions.status,
      nextRunAt: subscriptions.nextRunAt,
      itemCount: sql<number>`(select count(*) from ${subscriptionItems} si where si.subscription_id = ${subscriptions.id})::int`,
    })
    .from(subscriptions)
    .where(eq(subscriptions.customerId, customerId));
  if (subs.length === 0) return null;
  return (
    <div className="rounded-card border border-brand-soft bg-white p-5">
      <h2 className="mb-2 font-bold text-ink">Mis canastas</h2>
      <SubscriptionList
        subs={subs
          .filter((s) => s.status !== "cancelled")
          .map((s) => ({ ...s, nextRunAt: s.nextRunAt.toISOString() }))}
      />
    </div>
  );
}

/** Preferencia de marketing del cliente (activar/desactivar ofertas). */
async function CustomerMarketing({ customerId }: { customerId: string }) {
  const granted = await getMarketingConsent(customerId);
  return <MarketingToggle initial={granted} />;
}

/** Beneficios del cliente: membresía y estado del Fiado Digital. */
async function CustomerPerks({ customerId }: { customerId: string }) {
  const [membership, credit] = await Promise.all([
    getActiveMembership(customerId),
    getCreditStatus(customerId),
  ]);
  if (!membership && !credit) return null;
  return (
    <div className="rounded-card border border-brand-soft bg-white p-5">
      <h2 className="mb-2 font-bold text-ink">Mis beneficios</h2>
      <div className="space-y-2 text-sm">
        <p>
          {membership ? (
            <>⭐ <strong className="text-brand-dark">Premium activo</strong> — domicilio gratis en todos tus pedidos. Vence el {membership.currentPeriodEnd.toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}.</>
          ) : (
            <>Membresía premium: inactiva.</>
          )}
        </p>
        {credit && (
          <div className="rounded-lg bg-brand-soft p-3">
            <p className="font-semibold text-brand-dark">📒 Fiado Digital (sin intereses)</p>
            <p>
              Deuda: <strong>{formatCop(credit.balance)}</strong> · Disponible:{" "}
              <strong>{formatCop(credit.availableCop)}</strong> de {formatCop(credit.account.limitCop)}
            </p>
            {credit.pendingInstallments.length > 0 && (
              <p className="mt-1 text-xs text-ink-soft">
                Próxima cuota: {formatCop(credit.pendingInstallments[0]!.amountCop)} el{" "}
                {credit.pendingInstallments[0]!.dueDate.toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}
                {credit.overdueCount > 0 && (
                  <span className="ml-1 font-bold text-coral-dark">· {credit.overdueCount} vencida(s) — ponte al día en la tienda</span>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
import { formatCop } from "@/lib/format";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/modules/orders/state";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const user = await getSessionUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <PhoneLogin />
        <p className="text-center text-xs text-ink-soft">
          ¿Eres del equipo de la tienda?{" "}
          <Link href="/login" className="font-semibold text-brand-dark underline">
            Ingresa con tu correo
          </Link>
        </p>
      </div>
    );
  }

  const customer = await db.query.customers.findFirst({ where: eq(customers.userId, user.id) });
  const myOrders = customer
    ? await db.query.orders.findMany({
        where: eq(orders.customerId, customer.id),
        orderBy: desc(orders.createdAt),
        limit: 10,
      })
    : [];

  const staffRole = user.role !== "customer";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-card border border-brand-soft bg-white p-5">
        <h1 className="text-xl font-extrabold text-ink">Hola, {user.fullName}</h1>
        <p className="text-sm text-ink-soft">
          {user.role === "customer"
            ? `Celular: ${customer?.phone ?? "—"}`
            : `${user.email} · rol: ${user.role}`}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {staffRole && user.role !== "driver" && (
            <Link href="/admin" className="btn rounded-full bg-brand-dark px-5 py-2.5 text-sm font-bold text-white">
              Panel administrativo
            </Link>
          )}
          {user.role === "driver" && (
            <Link href="/repartidor" className="btn rounded-full bg-brand-dark px-5 py-2.5 text-sm font-bold text-white">
              Mis entregas
            </Link>
          )}
          <form action={logoutAction}>
            <button type="submit" className="btn rounded-full border-2 border-brand-soft px-5 py-2.5 text-sm font-bold text-ink-soft hover:bg-brand-soft">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>

      {user.role === "customer" && customer && (
        <div className="rounded-card border border-brand-soft bg-white p-5">
          <h2 className="font-bold text-ink">📒 Pedir a crédito (sin intereses)</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Compra ahora y paga en cuotas. Verifica tu correo e identidad (una sola vez) para activar tu cupo.
          </p>
          <Link href="/cuenta/credito" className="btn mt-2 inline-block rounded-full bg-brand px-5 py-2 text-sm font-bold text-white">
            Activar / ver mi crédito
          </Link>
        </div>
      )}

      {user.role === "customer" && customer && <CustomerPerks customerId={customer.id} />}

      {user.role === "customer" && customer && <CustomerBaskets customerId={customer.id} />}

      {user.role === "customer" && customer && <CustomerMarketing customerId={customer.id} />}

      {user.role === "customer" && (
        <div className="rounded-card border border-brand-soft bg-white p-5">
          <h2 className="mb-2 font-bold text-ink">Mis pedidos</h2>
          {myOrders.length === 0 ? (
            <p className="text-sm text-ink-soft">
              Aún no tienes pedidos asociados a tu cuenta. Los pedidos como invitado se consultan con el
              enlace de seguimiento.
            </p>
          ) : (
            <ul className="divide-y divide-brand-soft text-sm">
              {myOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2">
                  <span>
                    <Link href={`/pedido/${o.id}`} className="font-semibold text-brand-dark hover:underline">
                      {o.number}
                    </Link>{" "}
                    · {ORDER_STATUS_LABELS[o.status as OrderStatus]}
                  </span>
                  <span className="font-semibold">{formatCop(o.totalCop)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
