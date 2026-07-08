import { and, desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { consents } from "@/db/schema";
import { id } from "@/lib/ids";

/**
 * Consentimiento de marketing (WhatsApp). La tabla `consents` es un ledger
 * append-only con evidencia auditable: cada otorgamiento o revocación es una
 * fila nueva y "el último gana". Un solo escritor para todo el sistema
 * (checkout, cuenta del cliente, panel, y "STOP" por WhatsApp).
 */

export const MARKETING_KIND = "marketing_whatsapp";

/** Fuente del registro: dónde ocurrió la decisión del titular o su gestión. */
export type ConsentSource = "checkout" | "profile" | "admin" | "whatsapp";

/** Registra el consentimiento de marketing de un cliente (otorga o revoca). */
export async function recordMarketingConsent(
  tx: DbOrTx,
  params: { customerId: string; granted: boolean; source: ConsentSource; detail?: unknown },
): Promise<void> {
  await tx.insert(consents).values({
    id: id("cns"),
    customerId: params.customerId,
    kind: MARKETING_KIND,
    granted: params.granted,
    source: params.source,
    detail: params.detail ?? null,
  });
}

/** Último consentimiento de marketing del cliente (true = autoriza). */
export async function getMarketingConsent(customerId: string): Promise<boolean> {
  const row = await db.query.consents.findFirst({
    where: and(eq(consents.customerId, customerId), eq(consents.kind, MARKETING_KIND)),
    orderBy: desc(consents.createdAt),
  });
  return row?.granted ?? false;
}
