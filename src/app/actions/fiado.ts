"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { id } from "@/lib/ids";
import { requirePermission } from "@/lib/auth/session";
import { normalizePhone, AccountError } from "@/modules/accounts/service";
import { cancelMembership } from "@/modules/premium/service";
import {
  CreditError,
  adjustCreditLimit,
  archiveCreditAccount,
  createCreditPurchase,
  openCreditAccount,
  registerCreditPayment,
  restoreCreditAccount,
  setCreditAccountStatus,
} from "@/modules/credit/service";

/**
 * Acciones del panel Fiado & Premium (mostrador). Permiso: customers.manage
 * (admin/owner por defecto; el propietario puede extenderlo a cajeros desde
 * la matriz de permisos). TODO movimiento queda en auditoría.
 */

type Result = { ok: true } | { ok: false; message: string };

function fail(e: unknown): Result {
  if (e instanceof CreditError || e instanceof AccountError) return { ok: false, message: e.message };
  return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
}

const refresh = () => revalidatePath("/admin/fiado");

/**
 * Registrar fiado en mostrador: busca/crea la ficha del cliente por teléfono
 * (con cédula verificada en persona) y abre el Fiado con el registro del
 * personal. La membresía premium NO se toca aquí (se gestiona solo en la app).
 */
export async function enrollInStoreAction(input: {
  phone: string;
  fullName: string;
  documentId: string;
  amountCop: number;
  frequency?: "weekly" | "biweekly";
}): Promise<Result> {
  try {
    const user = await requirePermission("customers.manage");
    const parsed = z
      .object({
        phone: z.string().min(7),
        fullName: z.string().min(2).max(80),
        documentId: z.string().min(5).max(15),
        // Monto a fiar: obligatorio para registrar un fiado en el mostrador.
        amountCop: z.number().int().positive(),
        frequency: z.enum(["weekly", "biweekly"]).optional(),
      })
      .parse(input);
    const phone = normalizePhone(parsed.phone);
    const actor = { userId: user.id, label: `${user.role}:${user.email}` };

    // Ficha del cliente: reutiliza por teléfono o crea; registra la cédula.
    let customer = await db.query.customers.findFirst({
      where: sql`right(regexp_replace(${customers.phone}, '[^0-9]', '', 'g'), 10) = ${phone.slice(-10)}`,
    });
    if (customer) {
      await db
        .update(customers)
        .set({ documentId: parsed.documentId, fullName: customer.fullName || parsed.fullName })
        .where(eq(customers.id, customer.id));
    } else {
      const newId = id("cus");
      await db.insert(customers).values({
        id: newId,
        fullName: parsed.fullName,
        phone,
        documentId: parsed.documentId,
      });
      customer = (await db.query.customers.findFirst({ where: eq(customers.id, newId) }))!;
    }

    await openCreditAccount({ customerId: customer.id, channel: "in_store", actor });
    // Registra el fiado de una vez con su plan de cuotas. El mostrador no cobra
    // membresía (la premium es solo por app).
    await createCreditPurchase({
      customerId: customer.id,
      totalCop: parsed.amountCop,
      frequency: parsed.frequency ?? "weekly",
      actor,
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function creditPurchaseAction(input: {
  customerId: string;
  totalCop: number;
  frequency: "weekly" | "biweekly";
  installments?: number;
  note?: string;
}): Promise<Result> {
  try {
    const user = await requirePermission("customers.manage");
    await createCreditPurchase({
      ...z
        .object({
          customerId: z.string(),
          totalCop: z.number().int().positive(),
          frequency: z.enum(["weekly", "biweekly"]),
          installments: z.number().int().min(1).max(12).optional(),
          note: z.string().max(200).optional(),
        })
        .parse(input),
      actor: { userId: user.id, label: `${user.role}:${user.email}` },
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function creditPaymentAction(input: {
  customerId: string;
  amountCop: number;
  method: "cash" | "transfer";
}): Promise<Result> {
  try {
    const user = await requirePermission("customers.manage");
    await registerCreditPayment({
      ...z
        .object({
          customerId: z.string(),
          amountCop: z.number().int().positive(),
          method: z.enum(["cash", "transfer"]),
        })
        .parse(input),
      actor: { userId: user.id, label: `${user.role}:${user.email}` },
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function creditLimitAction(customerId: string, newLimitCop: number): Promise<Result> {
  try {
    const user = await requirePermission("customers.manage");
    await adjustCreditLimit({
      customerId,
      newLimitCop: z.number().int().min(0).parse(newLimitCop),
      actor: { userId: user.id, label: `${user.role}:${user.email}` },
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function creditStatusAction(
  customerId: string,
  status: "active" | "paused",
  reason?: string,
): Promise<Result> {
  try {
    const user = await requirePermission("customers.manage");
    await setCreditAccountStatus({
      customerId,
      status,
      reason,
      actor: { userId: user.id, label: `${user.role}:${user.email}` },
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Cancela la membresía premium de un cliente (acción de soporte). La
 * activación/reactivación de membresías se hace SOLO desde la app.
 */
export async function cancelMembershipAction(customerId: string): Promise<Result> {
  try {
    const user = await requirePermission("customers.manage");
    await cancelMembership(customerId, { userId: user.id, label: `${user.role}:${user.email}` });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Elimina la cuenta de la cartera (deuda $0); queda 90 días en el historial. */
export async function archiveCreditAccountAction(customerId: string): Promise<Result> {
  try {
    const user = await requirePermission("customers.manage");
    await archiveCreditAccount({ customerId, actor: { userId: user.id, label: `${user.role}:${user.email}` } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Restaura una cuenta desde el historial de eliminados. */
export async function restoreCreditAccountAction(customerId: string): Promise<Result> {
  try {
    const user = await requirePermission("customers.manage");
    await restoreCreditAccount({ customerId, actor: { userId: user.id, label: `${user.role}:${user.email}` } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Aprobar o rechazar una verificación de identidad enviada por un cliente. */
export async function reviewIdentityAction(
  verificationId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<Result> {
  try {
    const user = await requirePermission("customers.manage");
    const { reviewIdentity } = await import("@/modules/accounts/identity");
    await reviewIdentity({
      verificationId,
      decision: z.enum(["approved", "rejected"]).parse(decision),
      note: note?.trim() || undefined,
      actor: { userId: user.id, label: `${user.role}:${user.email}` },
    });
    revalidatePath("/admin/identidades");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
