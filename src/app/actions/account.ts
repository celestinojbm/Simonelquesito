"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rateLimit } from "@/lib/auth/rate-limit";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth/session";
import {
  AccountError,
  customerForUser,
  normalizePhone,
  requestLoginCode,
  verifyLoginCode,
} from "@/modules/accounts/service";
import { getMarketingConsent, recordMarketingConsent } from "@/modules/accounts/consent";

/** Acciones públicas de registro/ingreso de clientes por teléfono. */

export type RequestCodeResult =
  | { ok: true; delivery: string }
  | { ok: false; message: string };

export async function requestCodeAction(rawPhone: string): Promise<RequestCodeResult> {
  try {
    const phone = normalizePhone(z.string().min(7).max(20).parse(rawPhone));
    // Anti-abuso: 3 códigos por número cada 10 min.
    if (!rateLimit(`otp:${phone}`, 3, 10 * 60_000)) {
      return { ok: false, message: "Ya pedimos varios códigos a este número. Espera unos minutos." };
    }
    const { delivery } = await requestLoginCode(phone);
    return { ok: true, delivery };
  } catch (e) {
    if (e instanceof AccountError) return { ok: false, message: e.message };
    console.error("requestCodeAction", e);
    return { ok: false, message: "No pudimos enviar el código. Inténtalo de nuevo." };
  }
}

export type VerifyCodeResult =
  | { ok: true; isNew: boolean }
  | { ok: false; message: string; needsName?: boolean };

export async function verifyCodeAction(input: {
  phone: string;
  code: string;
  fullName?: string;
}): Promise<VerifyCodeResult> {
  try {
    const parsed = z
      .object({
        phone: z.string().min(7).max(20),
        code: z.string().min(4).max(8),
        fullName: z.string().max(80).optional(),
      })
      .parse(input);
    const phone = normalizePhone(parsed.phone);
    if (!rateLimit(`otp-verify:${phone}`, 10, 10 * 60_000)) {
      return { ok: false, message: "Demasiados intentos. Espera unos minutos." };
    }
    return await verifyLoginCode({
      rawPhone: phone,
      code: parsed.code,
      fullName: parsed.fullName,
    });
  } catch (e) {
    if (e instanceof AccountError) return { ok: false, message: e.message };
    console.error("verifyCodeAction", e);
    return { ok: false, message: "No pudimos verificar el código. Inténtalo de nuevo." };
  }
}

export type ConsentResult = { ok: true; granted: boolean } | { ok: false; message: string };

/**
 * El propio cliente activa o desactiva el recibir ofertas por WhatsApp desde
 * "Mi cuenta". Se registra como un consent nuevo (source "profile"): así puede
 * optar por salir (o volver a entrar) cuando quiera, y la retención lo respeta.
 */
export async function setMarketingConsentAction(granted: boolean): Promise<ConsentResult> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, message: "Inicia sesión para cambiar tus preferencias." };
    const customer = await customerForUser(user.id);
    if (!customer) return { ok: false, message: "No encontramos tu ficha de cliente." };
    const value = z.boolean().parse(granted);
    await recordMarketingConsent(db, { customerId: customer.id, granted: value, source: "profile" });
    await recordAudit(db, {
      action: value ? "consent.marketing_granted" : "consent.marketing_revoked",
      entityType: "customer",
      entityId: customer.id,
      actorUserId: user.id,
      actorLabel: `customer:${customer.phone}`,
      after: { kind: "marketing_whatsapp", granted: value, source: "profile" },
    });
    revalidatePath("/cuenta");
    return { ok: true, granted: value };
  } catch (e) {
    console.error("setMarketingConsentAction", e);
    return { ok: false, message: "No pudimos guardar tu preferencia. Inténtalo de nuevo." };
  }
}

/** Estado actual del consentimiento de marketing del cliente en sesión. */
export async function getMyMarketingConsent(): Promise<boolean> {
  const user = await getSessionUser();
  if (!user) return false;
  const customer = await customerForUser(user.id);
  return customer ? getMarketingConsent(customer.id) : false;
}
