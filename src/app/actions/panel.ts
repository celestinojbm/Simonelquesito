"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { setSetting } from "@/modules/config/service";
import { setSectionImage } from "@/modules/config/section-bg";
import { id } from "@/lib/ids";

/**
 * Guarda la personalización del panel administrativo (Nivel 1): orden del
 * menú, secciones ocultas, renombrados y color del panel. Permiso:
 * settings.manage. La escritura queda auditada (vía setSetting).
 */

type Result = { ok: true } | { ok: false; message: string };

export async function setAdminPanelAction(input: {
  navOrder: string[];
  navHidden: string[];
  navLabels: Record<string, string>;
  accent: string | null;
  dashboard: Record<string, string[]>;
  blocks: { id: string; type: string; text?: string; href?: string; url?: string; color?: string; items?: { label: string; href: string }[] }[];
}): Promise<Result> {
  try {
    const user = await requirePermission("settings.manage");
    const parsed = z
      .object({
        navOrder: z.array(z.string()).max(100),
        navHidden: z.array(z.string()).max(100),
        navLabels: z.record(z.string(), z.string().max(40)),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
        dashboard: z.record(z.string(), z.array(z.string()).max(50)),
        blocks: z
          .array(
            z.object({
              id: z.string(),
              type: z.enum(["heading", "text", "button", "image", "divider", "links"]),
              text: z.string().max(300).optional(),
              href: z.string().max(300).optional(),
              url: z.string().max(500).optional(),
              color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
              items: z.array(z.object({ label: z.string().max(60), href: z.string().max(300) })).max(12).optional(),
            }),
          )
          .max(40),
      })
      .parse(input);

    // Descarta renombrados vacíos (para no guardar basura).
    const navLabels: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.navLabels)) {
      const t = v.trim();
      if (t) navLabels[k] = t;
    }

    await setSetting(
      "admin.panel",
      { navOrder: parsed.navOrder, navHidden: parsed.navHidden, navLabels, accent: parsed.accent, dashboard: parsed.dashboard, blocks: parsed.blocks },
      { userId: user.id, label: `${user.role}:${user.email}` },
    );
    // El menú vive en el layout del admin: revalida toda esa rama.
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

/**
 * Sube una imagen para un bloque del panel. La guarda APARTE (en
 * section_backgrounds, servida por /api/section-bg) para no inflar la config
 * del panel; el bloque solo guarda la URL corta devuelta. Cada subida usa una
 * llave única (no se pisa la caché).
 */
export async function uploadPanelImageAction(
  dataUrl: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  try {
    const user = await requirePermission("settings.manage");
    const parsed = z.string().startsWith("data:image/").max(3_500_000).parse(dataUrl);
    const key = `panelblk:${id("img")}`;
    await setSectionImage(key, parsed, user.id);
    return { ok: true, url: `/api/section-bg/${encodeURIComponent(key)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}
