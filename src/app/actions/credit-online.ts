"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import {
  AccountError,
  requestEmailCode,
  verifyEmailCode,
} from "@/modules/accounts/service";
import { submitIdentity } from "@/modules/accounts/identity";
import { activateMembership } from "@/modules/premium/service";
import { CreditError, openCreditAccount } from "@/modules/credit/service";

/**
 * Acciones del cliente para desbloquear el crédito en línea desde su cuenta:
 * verificar correo, enviar la cédula (18+) y —cumplidas las verificaciones—
 * activar la membresía y abrir el cupo de Fiado. La suscripción se carga al
 * fiado (primer cobro) para que un primerizo pueda empezar sin efectivo.
 */

type Result = { ok: true; message?: string } | { ok: false; message: string };

function fail(e: unknown): Result {
  if (e instanceof CreditError || e instanceof AccountError) return { ok: false, message: e.message };
  return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
}

/** Ficha del cliente en sesión (o error si no es un cliente logueado). */
async function requireCustomer() {
  const user = await getSessionUser();
  if (!user || user.role !== "customer") throw new AccountError("Inicia sesión con tu celular.");
  const customer = await db.query.customers.findFirst({ where: eq(customers.userId, user.id) });
  if (!customer) throw new AccountError("No encontramos tu ficha de cliente.");
  return { user, customer };
}

const refresh = () => revalidatePath("/cuenta/credito");

export async function requestEmailCodeAction(email: string): Promise<Result & { delivery?: string }> {
  try {
    const { customer } = await requireCustomer();
    const { delivery } = await requestEmailCode({
      customerId: customer.id,
      email: z.string().email("Correo inválido.").parse(email.trim().toLowerCase()),
    });
    return { ok: true, delivery, message: "Te enviamos un código a tu correo." };
  } catch (e) {
    return fail(e);
  }
}

export async function verifyEmailCodeAction(email: string, code: string): Promise<Result> {
  try {
    const { customer } = await requireCustomer();
    const r = await verifyEmailCode({ customerId: customer.id, email: email.trim().toLowerCase(), code });
    if (!r.ok) return { ok: false, message: r.message };
    refresh();
    return { ok: true, message: "Correo verificado." };
  } catch (e) {
    return fail(e);
  }
}

export async function submitIdentityAction(input: {
  documentId: string;
  birthDate: string;
  frontImageUrl: string;
}): Promise<Result> {
  try {
    const { customer } = await requireCustomer();
    const parsed = z
      .object({
        documentId: z.string().min(5).max(15),
        birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        frontImageUrl: z.string().startsWith("data:image/"),
      })
      .parse(input);
    await submitIdentity({ customerId: customer.id, ...parsed });
    refresh();
    return { ok: true, message: "Enviamos tu cédula a revisión. Te avisaremos al aprobarla." };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Activa la membresía premium y abre el cupo de Fiado en línea.
 * openCreditAccount valida las verificaciones (correo + identidad); si algo
 * falta, devuelve el motivo exacto. El fiado ya no exige membresía: la
 * mensualidad queda PENDIENTE y se suma a la primera compra fiada, repartida
 * en sus cuotas (ver createCreditPurchaseTx, foldMembershipFee).
 */
export async function activateOnlineCreditAction(): Promise<Result> {
  try {
    const { user, customer } = await requireCustomer();
    // Guard previo: no activamos la membresía (ni su cobro) si el cliente aún
    // no cumple las verificaciones que dependen de él (correo + identidad).
    const { getSetting } = await import("@/modules/config/service");
    const rules = await getSetting("credit.rules");
    if (rules.onlineRequireEmailVerified && !customer.emailVerifiedAt) {
      return { ok: false, message: "Primero verifica tu correo." };
    }
    if (rules.onlineRequireIdentityVerified && !customer.ageVerifiedAt) {
      return { ok: false, message: "Tu identidad aún no está aprobada por la tienda." };
    }
    const actor = { userId: user.id, label: `customer:${customer.phone}` };
    await activateMembership({ customerId: customer.id, channel: "online", method: "store_credit", actor });
    await openCreditAccount({ customerId: customer.id, channel: "online", actor });
    refresh();
    return { ok: true, message: "¡Listo! Tu cupo de Fiado está activo. La mensualidad se suma a tu primera compra fiada, repartida en sus cuotas." };
  } catch (e) {
    return fail(e);
  }
}
