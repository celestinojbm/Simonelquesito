import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, identityVerifications } from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { AccountError } from "./service";

/**
 * Verificación de identidad para el crédito en línea (solo mayores de 18):
 * el cliente envía cédula + fecha de nacimiento + foto de la cédula; el
 * personal la aprueba o rechaza. Al aprobar se marca customers.age_verified_at
 * (y se copian cédula y fecha a la ficha). Todo queda auditado.
 */

/** Edad en años a partir de YYYY-MM-DD (hoy en zona de Bogotá, sin DST). */
export function ageFromBirthDate(birthDate: string, now = new Date()): number {
  const b = new Date(`${birthDate}T00:00:00-05:00`);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export async function getIdentityStatus(customerId: string) {
  const latest = await db.query.identityVerifications.findFirst({
    where: eq(identityVerifications.customerId, customerId),
    orderBy: desc(identityVerifications.createdAt),
  });
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
  return {
    verified: !!customer?.ageVerifiedAt,
    latest: latest ?? null,
  };
}

/** El cliente envía su cédula para revisión. Reemplaza cualquier envío previo pendiente. */
export async function submitIdentity(params: {
  customerId: string;
  documentId: string;
  birthDate: string;
  frontImageUrl: string;
}): Promise<{ id: string }> {
  const documentId = params.documentId.trim();
  if (documentId.length < 5 || documentId.length > 15) throw new AccountError("Cédula inválida.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.birthDate)) throw new AccountError("Fecha de nacimiento inválida.");
  if (ageFromBirthDate(params.birthDate) < 18) {
    throw new AccountError("El crédito es solo para mayores de 18 años.");
  }
  if (!params.frontImageUrl.startsWith("data:image/") || params.frontImageUrl.length > 1_500_000) {
    throw new AccountError("Adjunta una foto de la cédula (máximo ~1.5 MB).");
  }

  const customer = await db.query.customers.findFirst({ where: eq(customers.id, params.customerId) });
  if (!customer) throw new AccountError("Cliente no encontrado.");
  if (customer.ageVerifiedAt) throw new AccountError("Tu identidad ya está verificada.");

  // Reemplaza un envío pendiente anterior (reintento).
  const pending = await db.query.identityVerifications.findFirst({
    where: and(
      eq(identityVerifications.customerId, params.customerId),
      eq(identityVerifications.status, "pending"),
    ),
  });
  if (pending) {
    await db
      .update(identityVerifications)
      .set({ documentId, birthDate: params.birthDate, frontImageUrl: params.frontImageUrl, createdAt: new Date() })
      .where(eq(identityVerifications.id, pending.id));
    return { id: pending.id };
  }

  const rowId = id("idv");
  await db.insert(identityVerifications).values({
    id: rowId,
    customerId: params.customerId,
    documentId,
    birthDate: params.birthDate,
    frontImageUrl: params.frontImageUrl,
  });
  return { id: rowId };
}

/** El personal aprueba o rechaza una verificación de identidad. */
export async function reviewIdentity(params: {
  verificationId: string;
  decision: "approved" | "rejected";
  note?: string;
  actor: { userId?: string; label: string };
}): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await tx.query.identityVerifications.findFirst({
      where: eq(identityVerifications.id, params.verificationId),
    });
    if (!row) throw new AccountError("Verificación no encontrada.");
    if (row.status !== "pending") throw new AccountError("Esta verificación ya fue revisada.");

    await tx
      .update(identityVerifications)
      .set({
        status: params.decision,
        reviewNote: params.note ?? null,
        reviewedBy: params.actor.label,
        reviewedAt: new Date(),
      })
      .where(eq(identityVerifications.id, row.id));

    if (params.decision === "approved") {
      await tx
        .update(customers)
        .set({ documentId: row.documentId, birthDate: row.birthDate, ageVerifiedAt: new Date() })
        .where(eq(customers.id, row.customerId));
    }

    await recordAudit(tx, {
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      action: `identity.${params.decision}`,
      entityType: "customer",
      entityId: row.customerId,
      after: { verificationId: row.id, decision: params.decision },
    });
  });
}
