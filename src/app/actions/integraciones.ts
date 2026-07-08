"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { disconnectMpSeller } from "@/modules/payments/mercadopago";

/** Desconecta la cuenta de Mercado Pago del negocio (borra los tokens cifrados). */
export async function disconnectMercadoPagoAction(): Promise<void> {
  const user = await requirePermission("integrations.manage");
  await disconnectMpSeller();
  await recordAudit(db, {
    action: "integrations.mercadopago_disconnected",
    entityType: "integration",
    entityId: "mercado_pago",
    actorUserId: user.id,
    actorLabel: `${user.role}:${user.email}`,
  });
  revalidatePath("/admin/integraciones");
}
