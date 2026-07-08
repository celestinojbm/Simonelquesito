"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { coupons, promotions } from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { getSessionUser, requirePermission } from "@/lib/auth/session";
import { customerForUser } from "@/modules/accounts/service";
import { quoteCoupon, type CouponQuote } from "@/modules/promotions/service";

/**
 * Vista previa del cupón en el checkout. Es SOLO informativa: la validación
 * y el canje definitivos ocurren en placeOrder con precios del servidor.
 */
export async function previewCouponAction(input: {
  code: string;
  eligibleItemsCop: number;
  itemsTotalCop: number;
}): Promise<CouponQuote> {
  try {
    const parsed = z
      .object({
        code: z.string().min(1).max(30),
        eligibleItemsCop: z.number().int().min(0),
        itemsTotalCop: z.number().int().min(0),
      })
      .parse(input);
    const user = await getSessionUser();
    const customer = user ? await customerForUser(user.id) : null;
    return await quoteCoupon({ ...parsed, customerId: customer?.id ?? null });
  } catch {
    return { valid: false, reason: "No se pudo validar el cupón." };
  }
}

/* ===================== Panel de cupones y promociones =====================
 * Crear y gestionar promociones SIN tocar la base de datos. Permiso:
 * coupons.manage (admin / tech_admin / owner). El dinero se calcula siempre
 * en servidor; aquí solo se define la regla. Todo queda en auditoría.
 */

type Result = { ok: true } | { ok: false; message: string };

function fail(e: unknown): Result {
  return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
}

const refresh = () => revalidatePath("/admin/promociones");

/**
 * Bogotá no tiene horario de verano: siempre UTC-05:00. Un campo de fecha
 * (yyyy-mm-dd) se interpreta al inicio del día (desde) o al final del día
 * (hasta) en hora local, para que "válido hasta el 31" cubra todo el 31.
 */
function parseDate(value: string | undefined, endOfDay: boolean): Date | null {
  const v = value?.trim();
  if (!v) return null;
  const d = new Date(`${v}T${endOfDay ? "23:59:59" : "00:00:00"}-05:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Fecha inválida.");
  return d;
}

const createSchema = z
  .object({
    name: z.string().min(3, "Ponle un nombre a la promoción.").max(80),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,20}$/, "El código debe tener 3–20 letras o números, sin espacios."),
    kind: z.enum(["percent", "fixed", "free_delivery"]),
    /** percent: % entero (1–100). fixed: COP. free_delivery: ignorado. */
    value: z.number().int().min(0),
    minPurchaseCop: z.number().int().min(0).default(0),
    maxUses: z.number().int().min(1).nullable().default(null),
    budgetCop: z.number().int().min(0).nullable().default(null),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    excludesRestricted: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "percent" && (v.value < 1 || v.value > 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "El porcentaje debe estar entre 1 y 100.", path: ["value"] });
    }
    if (v.kind === "fixed" && v.value < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "El monto del descuento debe ser mayor a $0.", path: ["value"] });
    }
  });

export type CreatePromotionInput = z.input<typeof createSchema>;

/**
 * Crea una promoción con su código de cupón en un solo paso (patrón de la
 * campaña BIENVENIDO10). El % se guarda en puntos base; el monto fijo en COP.
 */
export async function createPromotionAction(input: CreatePromotionInput): Promise<Result> {
  try {
    const user = await requirePermission("coupons.manage");
    const data = createSchema.parse(input);

    const existing = await db.query.coupons.findFirst({ where: eq(coupons.code, data.code) });
    if (existing) return { ok: false, message: `El código ${data.code} ya existe. Elige otro.` };

    // percent → bps (10% = 1000). fixed → COP tal cual. free_delivery → 0.
    const value = data.kind === "percent" ? data.value * 100 : data.kind === "fixed" ? data.value : 0;
    const startsAt = parseDate(data.startsAt, false);
    const endsAt = parseDate(data.endsAt, true);
    if (startsAt && endsAt && startsAt > endsAt) {
      return { ok: false, message: "La fecha de inicio no puede ser posterior a la de fin." };
    }
    // El presupuesto solo tiene sentido para descuentos en dinero.
    const budgetCop = data.kind === "free_delivery" ? null : data.budgetCop;

    const promotionId = id("pro");
    const couponId = id("cpn");
    await db.transaction(async (tx) => {
      await tx.insert(promotions).values({
        id: promotionId,
        name: data.name,
        kind: data.kind,
        value,
        minPurchaseCop: data.minPurchaseCop,
        maxUses: data.maxUses,
        budgetCop,
        excludesRestricted: data.excludesRestricted,
        startsAt,
        endsAt,
        isActive: true,
      });
      await tx.insert(coupons).values({
        id: couponId,
        code: data.code,
        promotionId,
        // Código de campaña (no personal): el tope de la campaña vive en la
        // promoción; el del cupón se deja muy alto para no limitar de más.
        maxUses: data.maxUses ?? 1_000_000,
        expiresAt: endsAt,
      });
      await recordAudit(tx, {
        action: "coupons.created",
        entityType: "promotion",
        entityId: promotionId,
        actorUserId: user.id,
        actorLabel: `${user.role}:${user.email}`,
        after: { code: data.code, kind: data.kind, value, minPurchaseCop: data.minPurchaseCop, maxUses: data.maxUses, budgetCop },
      });
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Activa o pausa una promoción (sin borrar nada). */
export async function setPromotionActiveAction(promotionId: string, isActive: boolean): Promise<Result> {
  try {
    const user = await requirePermission("coupons.manage");
    const promo = await db.query.promotions.findFirst({ where: eq(promotions.id, promotionId) });
    if (!promo) return { ok: false, message: "La promoción no existe." };
    await db.transaction(async (tx) => {
      await tx.update(promotions).set({ isActive }).where(eq(promotions.id, promotionId));
      await recordAudit(tx, {
        action: isActive ? "coupons.activated" : "coupons.deactivated",
        entityType: "promotion",
        entityId: promotionId,
        actorUserId: user.id,
        actorLabel: `${user.role}:${user.email}`,
        before: { isActive: promo.isActive },
        after: { isActive },
      });
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
