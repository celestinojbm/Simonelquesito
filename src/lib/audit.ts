import { auditEvents } from "@/db/schema";
import type { DbOrTx } from "@/db";
import { id } from "./ids";

export async function recordAudit(
  tx: DbOrTx,
  params: {
    action: string;
    entityType: string;
    entityId: string;
    actorUserId?: string | null;
    actorLabel?: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await tx.insert(auditEvents).values({
    id: id("aud"),
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    actorUserId: params.actorUserId ?? null,
    actorLabel: params.actorLabel ?? "system",
    before: params.before ?? null,
    after: params.after ?? null,
  });
}
