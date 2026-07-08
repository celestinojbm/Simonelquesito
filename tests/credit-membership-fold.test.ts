/**
 * Fiado + membresía en la app: la mensualidad premium pendiente se SUMA a la
 * compra fiada y se reparte en LAS MISMAS cuotas (foldMembershipFee).
 * Ejemplo del negocio: fiar 50.000 sin membresía del mes → 59.900 en 4 cuotas
 * semanales. En tienda (sin fold) el fiado NO lleva membresía.
 * Usa la BD de desarrollo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  memberships,
  membershipCharges,
  creditPlans,
  creditInstallments,
} from "@/db/schema";
import { activateMembership } from "@/modules/premium/service";
import { openCreditAccount, createCreditPurchase, getCreditStatus } from "@/modules/credit/service";
import { getSetting } from "@/modules/config/service";

const ACTOR = { label: "test" };
const APP = "cus_fold_app";
const STORE = "cus_fold_store";
let feeCop = 0;

async function wipe(customerId: string) {
  await db.execute(sql`delete from credit_ledger where credit_account_id in (select id from credit_accounts where customer_id=${customerId})`);
  await db.execute(sql`delete from credit_installments where plan_id in (select cp.id from credit_plans cp join credit_accounts ca on ca.id=cp.credit_account_id where ca.customer_id=${customerId})`);
  await db.execute(sql`delete from credit_plans where credit_account_id in (select id from credit_accounts where customer_id=${customerId})`);
  await db.execute(sql`delete from credit_accounts where customer_id=${customerId}`);
  await db.execute(sql`delete from membership_charges where membership_id in (select id from memberships where customer_id=${customerId})`);
  await db.execute(sql`delete from memberships where customer_id=${customerId}`);
  await db.execute(sql`delete from customers where id=${customerId}`);
}

async function seed(customerId: string, phone: string) {
  await wipe(customerId);
  await db.insert(customers).values({ id: customerId, fullName: "Fold Test", phone, documentId: "111222333" });
  // Activa la membresía por store_credit → deja un cargo PENDIENTE (9.900).
  await activateMembership({ customerId, channel: "online", method: "store_credit", actor: ACTOR });
  // Abre el fiado; ya NO cobra la mensualidad aquí (se difiere a la compra).
  await openCreditAccount({ customerId, channel: "in_store", actor: ACTOR });
}

beforeAll(async () => {
  feeCop = (await getSetting("premium.plan")).priceCopMonthly; // 9.900 por defecto
  await seed(APP, "573009990001");
  await seed(STORE, "573009990002");
});

afterAll(async () => {
  await wipe(APP);
  await wipe(STORE);
});

describe("app: fiar 50.000 sin membresía del mes → 59.900 en 4 cuotas", () => {
  it("suma la mensualidad y reparte todo en las cuotas", async () => {
    const r = await createCreditPurchase({
      customerId: APP,
      totalCop: 50_000,
      frequency: "weekly",
      foldMembershipFee: true,
      actor: ACTOR,
    });
    expect(feeCop).toBe(9_900);
    expect(r.membershipFeeCop).toBe(9_900);
    expect(r.planTotalCop).toBe(59_900);
    expect(r.installments).toBe(4);

    // Deuda total = 59.900
    const status = await getCreditStatus(APP);
    expect(status?.balance).toBe(59_900);

    // Plan: 59.900 en 4 cuotas
    const plan = await db.query.creditPlans.findFirst({
      where: and(eq(creditPlans.creditAccountId, status!.account.id)),
    });
    expect(plan?.totalCop).toBe(59_900);
    expect(plan?.installmentsCount).toBe(4);
    expect(plan?.frequency).toBe("weekly");

    // 4 cuotas que suman 59.900 (última absorbe el redondeo)
    const cuotas = await db
      .select({ amountCop: creditInstallments.amountCop })
      .from(creditInstallments)
      .where(eq(creditInstallments.planId, plan!.id));
    expect(cuotas.length).toBe(4);
    expect(cuotas.reduce((s, c) => s + c.amountCop, 0)).toBe(59_900);
    expect(cuotas.every((c) => c.amountCop === 14_975)).toBe(true);

    // El cargo de la mensualidad quedó saldado (se cobró vía las cuotas)
    const [pend] = await db
      .select({ n: sql<string>`count(*)` })
      .from(membershipCharges)
      .innerJoin(memberships, eq(membershipCharges.membershipId, memberships.id))
      .where(and(eq(memberships.customerId, APP), eq(membershipCharges.status, "pending")));
    expect(Number(pend?.n ?? 0)).toBe(0);
  });
});

describe("tienda: fiar 50.000 → 50.000 sin membresía", () => {
  it("no suma mensualidad (foldMembershipFee ausente)", async () => {
    const r = await createCreditPurchase({
      customerId: STORE,
      totalCop: 50_000,
      frequency: "weekly",
      actor: ACTOR,
    });
    expect(r.membershipFeeCop).toBe(0);
    expect(r.planTotalCop).toBe(50_000);
    expect(r.installments).toBe(1); // 50.000 ≤ umbral de cuota única → 1 pago

    const status = await getCreditStatus(STORE);
    expect(status?.balance).toBe(50_000);

    // El cargo de la mensualidad sigue PENDIENTE (la tienda no lo toca)
    const [pend] = await db
      .select({ n: sql<string>`count(*)` })
      .from(membershipCharges)
      .innerJoin(memberships, eq(membershipCharges.membershipId, memberships.id))
      .where(and(eq(memberships.customerId, STORE), eq(membershipCharges.status, "pending")));
    expect(Number(pend?.n ?? 0)).toBe(1);
  });
});
