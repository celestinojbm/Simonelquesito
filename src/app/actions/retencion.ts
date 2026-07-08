"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { recordMarketingConsent } from "@/modules/accounts/consent";
import { createPersonalCoupon } from "@/modules/promotions/service";

/**
 * Panel de retención: el personal registra la baja (o alta) de marketing de un
 * cliente que lo pidió por cualquier canal ("no me manden más ofertas"). Se
 * escribe un consent nuevo (source "admin") — el listado lo respeta al instante.
 * Permiso: customers.manage.
 */
export async function adminSetMarketingConsentAction(formData: FormData): Promise<void> {
  const user = await requirePermission("customers.manage");
  const customerId = z.string().min(1).parse(formData.get("customerId"));
  const granted = formData.get("granted") === "true";

  const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
  if (!customer) return;

  await recordMarketingConsent(db, { customerId, granted, source: "admin" });
  await recordAudit(db, {
    action: granted ? "consent.marketing_granted" : "consent.marketing_revoked",
    entityType: "customer",
    entityId: customerId,
    actorUserId: user.id,
    actorLabel: `${user.role}:${user.email}`,
    after: { kind: "marketing_whatsapp", granted, source: "admin" },
  });
  revalidatePath("/admin/retencion");
}

/**
 * Cupón personal de recuperación (estilo Owner): un solo uso, atado al
 * cliente, vence en 7 días. El mensaje de WhatsApp del panel lo incluye
 * automáticamente. Permiso: coupons.manage (crear descuentos es distinto de
 * gestionar clientes).
 */
export async function createPersonalCouponAction(formData: FormData): Promise<void> {
  const user = await requirePermission("coupons.manage");
  const customerId = z.string().min(1).parse(formData.get("customerId"));
  const percent = z.coerce.number().int().refine((n) => [10, 15, 20].includes(n)).parse(formData.get("percent"));

  const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
  if (!customer) return;

  const { code, expiresAt, promotionId } = await createPersonalCoupon({
    customerId,
    percent,
    validDays: 7,
  });
  await recordAudit(db, {
    action: "coupons.personal_created",
    entityType: "promotion",
    entityId: promotionId,
    actorUserId: user.id,
    actorLabel: `${user.role}:${user.email}`,
    after: { code, percent, customerId, expiresAt: expiresAt.toISOString() },
  });
  revalidatePath("/admin/retencion");
}
