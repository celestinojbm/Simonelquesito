import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { coupons, promotions } from "@/db/schema";
import { id } from "@/lib/ids";
import { applyBps } from "@/lib/money";

/**
 * Cupones y promociones. Reglas de dinero:
 * - El descuento se calcula SIEMPRE en servidor sobre precios de servidor.
 * - Los productos restringidos quedan fuera de la base del descuento cuando
 *   la promoción lo indica (default: fuera) — nunca se descuenta licor por ley.
 * - El canje (contadores de uso y gasto) ocurre DENTRO de la transacción del
 *   pedido: si el pedido falla, el cupón no se consume.
 *
 * Tipos soportados hoy: percent (bps), fixed (COP), free_delivery.
 * Los demás kinds del esquema (two_for_one, combo, category_percent) se
 * rechazan con mensaje honesto hasta implementarse.
 */

export type CouponQuote =
  | {
      valid: true;
      couponId: string;
      promotionId: string;
      kind: "percent" | "fixed" | "free_delivery";
      /** Descuento sobre productos (COP). Para free_delivery es 0: el
       *  descuento es la tarifa de envío y la aplica placeOrder. */
      discountCop: number;
      label: string;
    }
  | { valid: false; reason: string };

export async function quoteCoupon(
  params: {
    code: string;
    /** Total de productos NO restringidos (base del descuento). */
    eligibleItemsCop: number;
    /** Total de productos (para el mínimo de compra). */
    itemsTotalCop: number;
    customerId?: string | null;
  },
  tx: DbOrTx = db,
): Promise<CouponQuote> {
  const code = params.code.trim().toUpperCase();
  if (!code) return { valid: false, reason: "Escribe un código." };

  const coupon = await tx.query.coupons.findFirst({ where: eq(coupons.code, code) });
  if (!coupon) return { valid: false, reason: "Ese cupón no existe." };
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return { valid: false, reason: "Ese cupón ya venció." };
  }
  if (coupon.usedCount >= coupon.maxUses) {
    return { valid: false, reason: "Ese cupón ya se agotó." };
  }
  if (coupon.customerId && coupon.customerId !== params.customerId) {
    return { valid: false, reason: "Ese cupón es personal de otro cliente." };
  }

  const promo = await tx.query.promotions.findFirst({
    where: eq(promotions.id, coupon.promotionId),
  });
  if (!promo || !promo.isActive) return { valid: false, reason: "La promoción no está activa." };
  const now = new Date();
  if (promo.startsAt && promo.startsAt > now) return { valid: false, reason: "La promoción aún no empieza." };
  if (promo.endsAt && promo.endsAt < now) return { valid: false, reason: "La promoción ya terminó." };
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    return { valid: false, reason: "La promoción alcanzó su límite de usos." };
  }
  if (params.itemsTotalCop < promo.minPurchaseCop) {
    return {
      valid: false,
      reason: `Este cupón aplica para compras desde $${promo.minPurchaseCop.toLocaleString("es-CO")}.`,
    };
  }

  const base = promo.excludesRestricted ? params.eligibleItemsCop : params.itemsTotalCop;
  if (base <= 0 && promo.kind !== "free_delivery") {
    return { valid: false, reason: "El cupón no aplica a los productos del carrito." };
  }

  let discountCop = 0;
  if (promo.kind === "percent") {
    discountCop = applyBps(base, promo.value);
  } else if (promo.kind === "fixed") {
    discountCop = Math.min(promo.value, base);
  } else if (promo.kind === "free_delivery") {
    discountCop = 0; // lo aplica placeOrder sobre la tarifa real
  } else {
    return { valid: false, reason: "Este tipo de promoción aún no está disponible en línea." };
  }

  if (promo.budgetCop !== null && promo.spentCop + discountCop > promo.budgetCop) {
    return { valid: false, reason: "La promoción agotó su presupuesto." };
  }

  return {
    valid: true,
    couponId: coupon.id,
    promotionId: promo.id,
    kind: promo.kind as "percent" | "fixed" | "free_delivery",
    discountCop,
    label: promo.name,
  };
}

/** Alfabeto sin caracteres confundibles por WhatsApp (sin 0/O/1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomSuffix(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * Cupón PERSONAL de recuperación (estilo Owner): un descuento de un solo uso,
 * atado a la ficha del cliente (coupons.customerId) — nadie más puede usarlo
 * (quoteCoupon lo rechaza para otros). Crea su propia promoción con vigencia
 * corta; el código es corto y legible para mandarlo por WhatsApp.
 */
export async function createPersonalCoupon(params: {
  customerId: string;
  /** % entero (1–100). */
  percent: number;
  /** Días de vigencia desde hoy. */
  validDays: number;
  minPurchaseCop?: number;
}): Promise<{ code: string; expiresAt: Date; promotionId: string; couponId: string }> {
  const percent = Math.round(params.percent);
  if (percent < 1 || percent > 100) throw new Error("El porcentaje debe estar entre 1 y 100.");
  const validDays = Math.round(params.validDays);
  if (validDays < 1 || validDays > 90) throw new Error("La vigencia debe ser de 1 a 90 días.");

  const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);
  const promotionId = id("pro");
  const couponId = id("cpn");

  // El código lleva un sufijo aleatorio; si choca con uno existente (índice
  // único), se reintenta con otro sufijo.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `VUELVE${percent}-${randomSuffix(4)}`;
    try {
      await db.transaction(async (tx) => {
        await tx.insert(promotions).values({
          id: promotionId,
          name: `Cupón personal ${percent}% (recuperación)`,
          kind: "percent",
          value: percent * 100, // bps
          minPurchaseCop: params.minPurchaseCop ?? 0,
          maxUses: 1,
          excludesRestricted: true,
          endsAt: expiresAt,
          isActive: true,
        });
        await tx.insert(coupons).values({
          id: couponId,
          code,
          promotionId,
          customerId: params.customerId,
          maxUses: 1,
          expiresAt,
        });
      });
      return { code, expiresAt, promotionId, couponId };
    } catch (e) {
      const isUnique = e instanceof Error && /coupons_code_ux|duplicate key/i.test(e.message);
      if (!isUnique || attempt === 4) throw e;
    }
  }
  throw new Error("No se pudo generar un código único.");
}

/**
 * Canjea el cupón (contadores) — llamar DENTRO de la transacción del pedido.
 * El incremento es ATÓMICO y condicional: solo ocurre si todavía hay usos y
 * presupuesto. Así, bajo concurrencia, dos pedidos que cotizaron el mismo
 * cupón casi agotado no pueden pasarse del tope (el UPDATE no afecta filas).
 * Devuelve false si el cupón/promoción se agotó entre la cotización y el
 * canje: el llamador debe abortar la transacción del pedido.
 */
export async function redeemCoupon(
  tx: DbOrTx,
  params: { couponId: string; promotionId: string; discountAppliedCop: number },
): Promise<boolean> {
  const promo = await tx
    .update(promotions)
    .set({
      usedCount: sql`${promotions.usedCount} + 1`,
      spentCop: sql`${promotions.spentCop} + ${params.discountAppliedCop}`,
    })
    .where(
      and(
        eq(promotions.id, params.promotionId),
        sql`(${promotions.maxUses} is null or ${promotions.usedCount} < ${promotions.maxUses})`,
        sql`(${promotions.budgetCop} is null or ${promotions.spentCop} + ${params.discountAppliedCop} <= ${promotions.budgetCop})`,
      ),
    )
    .returning({ id: promotions.id });
  if (promo.length === 0) return false;

  const cpn = await tx
    .update(coupons)
    .set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(and(eq(coupons.id, params.couponId), sql`${coupons.usedCount} < ${coupons.maxUses}`))
    .returning({ id: coupons.id });
  return cpn.length > 0;
}
