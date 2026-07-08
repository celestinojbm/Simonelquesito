import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { getSetting } from "@/modules/config/service";
import { getOnlineCreditEligibility } from "@/modules/credit/service";
import { getIdentityStatus } from "@/modules/accounts/identity";
import { CreditoClient } from "./credito-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Crédito · Mi cuenta" };

export default async function CreditoPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "customer") redirect("/cuenta");
  const customer = await db.query.customers.findFirst({ where: eq(customers.userId, user.id) });
  if (!customer) redirect("/cuenta");

  const [eligibility, identity, plan] = await Promise.all([
    getOnlineCreditEligibility(customer.id),
    getIdentityStatus(customer.id),
    getSetting("premium.plan"),
  ]);

  const identityStatus: "none" | "pending" | "approved" | "rejected" = identity.verified
    ? "approved"
    : (identity.latest?.status as "pending" | "rejected" | undefined) ?? "none";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/cuenta" className="text-sm text-brand-dark hover:underline">← Mi cuenta</Link>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">Pedir a crédito (sin intereses)</h1>
        <p className="text-sm text-ink-soft">
          Compra ahora y paga en cuotas semanales o quincenales, sin intereses. Para tu seguridad y
          por ley (mayores de 18), necesitamos verificar tu correo y tu identidad una sola vez.
        </p>
      </div>

      <CreditoClient
        initialEmail={customer.email ?? ""}
        emailVerified={!!customer.emailVerifiedAt}
        identityStatus={identityStatus}
        identityRejectNote={identity.latest?.reviewNote}
        requirements={eligibility.requirements}
        hasAccount={eligibility.hasAccount}
        premiumPriceCop={plan.priceCopMonthly}
      />
    </div>
  );
}
