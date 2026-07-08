import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import {
  settingsSchemas,
  settingsDefaults,
  type SettingKey,
  type SettingValue,
} from "./keys";

/**
 * Lee una configuración validada. Si no existe en BD devuelve el default
 * documentado (y el seed la materializa para que sea editable).
 */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await db.query.settings.findFirst({
    where: and(eq(settings.key, key), isNull(settings.branchId)),
  });
  const raw = row ? row.value : settingsDefaults[key];
  return settingsSchemas[key].parse(raw) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  actor: { userId?: string; label: string },
): Promise<void> {
  const parsed = settingsSchemas[key].parse(value);
  await db.transaction(async (tx) => {
    const existing = await tx.query.settings.findFirst({
      where: and(eq(settings.key, key), isNull(settings.branchId)),
    });
    if (existing) {
      await tx
        .update(settings)
        .set({ value: parsed, updatedBy: actor.label, updatedAt: new Date() })
        .where(eq(settings.id, existing.id));
    } else {
      await tx.insert(settings).values({
        id: id("set"),
        key,
        value: parsed,
        updatedBy: actor.label,
      });
    }
    await recordAudit(tx, {
      action: "settings.update",
      entityType: "setting",
      entityId: key,
      actorUserId: actor.userId,
      actorLabel: actor.label,
      before: existing?.value,
      after: parsed,
    });
  });
}
