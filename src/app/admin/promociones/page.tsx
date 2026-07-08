import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { coupons, promotions } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { PromocionesConsole } from "./promociones-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "Promociones · Admin" };

export default async function PromocionesPage() {
  await requirePermission("coupons.manage");

  // Cada promoción con su código de cupón (creamos una por código). El
  // descuento vive en la promoción; el código, en el cupón.
  const [rows, couponRows] = await Promise.all([
    db.select().from(promotions).orderBy(desc(promotions.isActive), desc(promotions.startsAt)),
    db.select({ code: coupons.code, promotionId: coupons.promotionId, id: coupons.id }).from(coupons).orderBy(asc(coupons.id)),
  ]);
  // Primer código por promoción (por id, estable).
  const codeByPromotion = new Map<string, string>();
  for (const c of couponRows) if (!codeByPromotion.has(c.promotionId)) codeByPromotion.set(c.promotionId, c.code);

  // "Activa" = misma definición que el badge del listado: vigente, con usos y
  // presupuesto disponibles (no basta con isActive + ventana de fechas).
  const now = new Date();
  const active = rows.filter(
    (r) =>
      r.isActive &&
      (!r.endsAt || r.endsAt >= now) &&
      (!r.startsAt || r.startsAt <= now) &&
      (r.maxUses === null || r.usedCount < r.maxUses) &&
      (r.budgetCop === null || r.spentCop < r.budgetCop),
  ).length;

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-extrabold text-ink">🎟️ Cupones y promociones</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Crea descuentos con su código, vigencia, mínimo de compra, tope de usos y presupuesto — sin
        tocar la base de datos. El descuento se calcula siempre en el servidor y el canje queda en la
        auditoría. Los licores y cigarrillos nunca entran en la base del descuento (por ley), salvo
        que lo desmarques.
      </p>

      <PromocionesConsole
        activeCount={active}
        promotions={rows.map((r) => ({
          id: r.id,
          name: r.name,
          code: codeByPromotion.get(r.id) ?? null,
          kind: r.kind as "percent" | "fixed" | "free_delivery" | "other",
          value: r.value,
          minPurchaseCop: r.minPurchaseCop,
          maxUses: r.maxUses,
          usedCount: r.usedCount,
          budgetCop: r.budgetCop,
          spentCop: r.spentCop,
          excludesRestricted: r.excludesRestricted,
          startsAt: r.startsAt ? r.startsAt.toISOString() : null,
          endsAt: r.endsAt ? r.endsAt.toISOString() : null,
          isActive: r.isActive,
        }))}
      />
    </div>
  );
}
