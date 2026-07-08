import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  creditAccounts,
  customers,
  memberships,
} from "@/db/schema";
import { getSetting } from "@/modules/config/service";
import { formatCop } from "@/lib/format";
import { FiadoConsoleClient } from "./fiado-console-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fiado & Premium · Admin" };

export default async function FiadoPage() {
  const rules = await getSetting("credit.rules");
  const plan = await getSetting("premium.plan");

  // Cuentas con su cliente, deuda (suma del ledger) y cuotas vencidas.
  const accounts = await db
    .select({
      account: creditAccounts,
      customer: customers,
      balance: sql<string>`coalesce((select sum(l.amount_cop) from credit_ledger l where l.credit_account_id = ${creditAccounts.id}), 0)`,
      overdue: sql<string>`coalesce((select count(*) from credit_installments ci join credit_plans cp on cp.id = ci.plan_id where cp.credit_account_id = ${creditAccounts.id} and ci.status = 'pending' and ci.due_date < now()), 0)`,
      nextDue: sql<string | null>`(select min(ci.due_date)::text from credit_installments ci join credit_plans cp on cp.id = ci.plan_id where cp.credit_account_id = ${creditAccounts.id} and ci.status = 'pending')`,
    })
    .from(creditAccounts)
    .innerJoin(customers, eq(creditAccounts.customerId, customers.id))
    .where(sql`${creditAccounts.archivedAt} is null`)
    .orderBy(desc(creditAccounts.createdAt));

  // Historial de eliminados: visibles y restaurables durante 90 días.
  const archived = await db
    .select({
      customerId: customers.id,
      name: customers.fullName,
      phone: customers.phone,
      archivedAt: creditAccounts.archivedAt,
    })
    .from(creditAccounts)
    .innerJoin(customers, eq(creditAccounts.customerId, customers.id))
    .where(sql`${creditAccounts.archivedAt} > now() - interval '90 days'`)
    .orderBy(desc(creditAccounts.archivedAt));

  const membershipRows = await db.query.memberships.findMany();
  const membershipByCustomer = new Map(membershipRows.map((m) => [m.customerId, m]));

  // Membresías de clientes SIN cuenta de fiado (ej. activadas desde la app):
  // deben ser visibles y gestionables desde este mismo panel.
  const membersOnly = await db
    .select({ membership: memberships, customer: customers })
    .from(memberships)
    .innerJoin(customers, eq(memberships.customerId, customers.id))
    .leftJoin(creditAccounts, eq(creditAccounts.customerId, customers.id))
    // Sin fiado VIGENTE: nunca tuvo cuenta o la suya está eliminada.
    .where(sql`${creditAccounts.id} is null or ${creditAccounts.archivedAt} is not null`)
    .orderBy(desc(memberships.createdAt));

  const outstanding = accounts.reduce((acc, a) => acc + Number(a.balance), 0);
  const overdueTotal = accounts.reduce((acc, a) => acc + Number(a.overdue), 0);
  const activeMembers = membershipRows.filter(
    (m) => m.status === "active" && m.currentPeriodEnd >= new Date(),
  ).length;

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-extrabold text-ink">Fiado Digital & Premium</h1>
      <p className="mb-4 text-sm text-ink-soft">
        El fiado de barrio, formalizado: crédito sin intereses con cupos y cuotas. Todo movimiento
        queda en el ledger inmutable y en la auditoría. Reglas editables en Configuración →{" "}
        <code>credit.rules</code>. La membresía premium ({formatCop(plan.priceCopMonthly)}/mes) es un
        beneficio aparte que se activa solo desde la app.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-card border border-brand-soft bg-white p-3">
          <p className="text-xs text-ink-soft uppercase">Cartera en la calle</p>
          <p className="text-lg font-extrabold text-ink">{formatCop(outstanding)}</p>
          <p className="text-[11px] text-ink-soft">tope {formatCop(rules.portfolioCapCop)}</p>
        </div>
        <div className="rounded-card border border-brand-soft bg-white p-3">
          <p className="text-xs text-ink-soft uppercase">Cuentas de fiado</p>
          <p className="text-lg font-extrabold text-ink">{accounts.length}</p>
        </div>
        <div className={`rounded-card border p-3 ${overdueTotal > 0 ? "border-coral bg-coral/10" : "border-brand-soft bg-white"}`}>
          <p className="text-xs text-ink-soft uppercase">Cuotas vencidas</p>
          <p className={`text-lg font-extrabold ${overdueTotal > 0 ? "text-coral-dark" : "text-ink"}`}>{overdueTotal}</p>
        </div>
        <div className="rounded-card border border-brand-soft bg-white p-3">
          <p className="text-xs text-ink-soft uppercase">Miembros premium</p>
          <p className="text-lg font-extrabold text-ink">{activeMembers}</p>
        </div>
      </div>

      <FiadoConsoleClient
        rules={{
          initialLimitCop: rules.initialLimitCop,
          maxLimitCop: rules.maxLimitCop,
          singleInstallmentMaxCop: rules.singleInstallmentMaxCop,
          maxInstallments: rules.maxInstallments,
        }}
        accounts={accounts.map((a) => ({
          customerId: a.customer.id,
          name: a.customer.fullName,
          phone: a.customer.phone,
          documentId: a.customer.documentId,
          status: a.account.status,
          limitCop: a.account.limitCop,
          balance: Number(a.balance),
          overdue: Number(a.overdue),
          nextDue: a.nextDue,
          channel: a.account.channel,
          vouchedBy: a.account.vouchedBy,
          membership: (() => {
            const m = membershipByCustomer.get(a.customer.id);
            if (!m) return "sin membresía";
            if (m.status === "active" && m.currentPeriodEnd >= new Date()) return "activa";
            return m.status === "cancelled" ? "cancelada" : "vencida";
          })(),
        }))}
        archived={archived.map((a) => ({
          customerId: a.customerId,
          name: a.name,
          phone: a.phone,
          archivedAt: a.archivedAt!.toISOString(),
        }))}
        members={membersOnly.map((m) => ({
          customerId: m.customer.id,
          name: m.customer.fullName,
          phone: m.customer.phone,
          membership:
            m.membership.status === "active" && m.membership.currentPeriodEnd >= new Date()
              ? "activa"
              : m.membership.status === "cancelled"
                ? "cancelada"
                : "vencida",
          channel: m.membership.channel,
          periodEnd: m.membership.currentPeriodEnd.toISOString(),
        }))}
      />
    </div>
  );
}
