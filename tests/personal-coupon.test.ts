/**
 * Cupón personal de recuperación: un solo uso, atado al cliente. Verifica el
 * formato del código, que solo el dueño puede cotizarlo, el % correcto y el
 * canje atómico. Usa la BD de desarrollo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/db";
import { coupons, customers, promotions } from "@/db/schema";
import { id } from "@/lib/ids";
import { createPersonalCoupon, quoteCoupon, redeemCoupon } from "@/modules/promotions/service";

const PHONE = "573001114455";
let customerId: string;
let created: Awaited<ReturnType<typeof createPersonalCoupon>>;

async function cleanup() {
  const rows = await db.select({ id: coupons.id, promotionId: coupons.promotionId }).from(coupons).where(like(coupons.code, "VUELVE%"));
  for (const r of rows) {
    await db.delete(coupons).where(eq(coupons.id, r.id));
    await db.delete(promotions).where(eq(promotions.id, r.promotionId));
  }
}

beforeAll(async () => {
  await cleanup();
  const existing = await db.query.customers.findFirst({ where: eq(customers.phone, PHONE) });
  customerId = existing?.id ?? id("cus");
  if (!existing) await db.insert(customers).values({ id: customerId, fullName: "Cupón Personal Test", phone: PHONE });
  created = await createPersonalCoupon({ customerId, percent: 10, validDays: 7 });
});

afterAll(cleanup);

describe("createPersonalCoupon", () => {
  it("genera un código legible y una vigencia de 7 días", () => {
    expect(created.code).toMatch(/^VUELVE10-[A-HJ-NP-Z2-9]{4}$/);
    const days = (created.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });
  it("la promoción es percent en bps con un solo uso y sin restringidos", async () => {
    const promo = await db.query.promotions.findFirst({ where: eq(promotions.id, created.promotionId) });
    expect(promo?.kind).toBe("percent");
    expect(promo?.value).toBe(1000); // 10% = 1000 bps
    expect(promo?.maxUses).toBe(1);
    expect(promo?.excludesRestricted).toBe(true);
  });
});

describe("quoteCoupon con cupón personal", () => {
  const base = { eligibleItemsCop: 50_000, itemsTotalCop: 50_000 };

  it("el dueño lo puede usar y el descuento es el 10%", async () => {
    const q = await quoteCoupon({ code: created.code, ...base, customerId });
    expect(q.valid).toBe(true);
    if (q.valid) expect(q.discountCop).toBe(5_000);
  });
  it("otro cliente NO puede usarlo", async () => {
    const q = await quoteCoupon({ code: created.code, ...base, customerId: "cus_otro" });
    expect(q.valid).toBe(false);
  });
  it("un invitado sin ficha tampoco", async () => {
    const q = await quoteCoupon({ code: created.code, ...base, customerId: null });
    expect(q.valid).toBe(false);
  });
  it("el canje es de UN solo uso (el segundo se rechaza)", async () => {
    const first = await db.transaction((tx) =>
      redeemCoupon(tx, { couponId: created.couponId, promotionId: created.promotionId, discountAppliedCop: 5_000 }),
    );
    expect(first).toBe(true);
    const second = await db.transaction((tx) =>
      redeemCoupon(tx, { couponId: created.couponId, promotionId: created.promotionId, discountAppliedCop: 5_000 }),
    );
    expect(second).toBe(false);
    const q = await quoteCoupon({ code: created.code, ...base, customerId });
    expect(q.valid).toBe(false); // agotado
  });
});
