"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { setSetting } from "@/modules/config/service";
import { settingsSchemas, type SettingKey } from "@/modules/config/keys";

/**
 * Edición de configuración desde el panel. La validación es el esquema Zod
 * de cada llave (la misma que usa el código) y todo cambio queda auditado
 * vía setSetting. Permiso: settings.manage (admin/owner; tech_admin según
 * la matriz — nunca toca llaves de dinero sin el owner por gobernanza).
 */
export async function updateSettingAction(
  key: string,
  jsonText: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const user = await requirePermission("settings.manage");
    if (!(key in settingsSchemas)) return { ok: false, message: `Llave desconocida: ${key}` };

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonText);
    } catch {
      return { ok: false, message: "El texto no es JSON válido (revisa comillas y comas)." };
    }

    const typedKey = key as SettingKey;
    const validated = settingsSchemas[typedKey].safeParse(parsedJson);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      return {
        ok: false,
        message: `Valor inválido${issue ? ` en "${issue.path.join(".")}": ${issue.message}` : ""}`,
      };
    }

    await setSetting(typedKey, validated.data as never, {
      userId: user.id,
      label: `${user.role}:${user.email}`,
    });
    revalidatePath("/admin/configuracion");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}
