"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { listCategories } from "@/modules/catalog/service";
import {
  setSectionImage,
  removeSectionImage,
  setSectionColor,
  removeSectionColor,
  setSectionStyle,
} from "@/modules/config/section-bg";
import { normalizeSectionStyle, SECTION_FONT_KEYS, SECTION_SIZE_KEYS, HOME_BLOCK_KEYS } from "@/modules/config/section-style";

/**
 * Apariencia por sección de la tienda del cliente: imagen de fondo y/o color.
 * El personal sube una imagen (el navegador la reduce ~1600px y la manda como
 * data-URI) o elige un color de fondo. Precedencia al mostrar: imagen > color
 * > diseño por defecto. Permiso: settings.manage. Todo queda en auditoría.
 */

type Result = { ok: true } | { ok: false; message: string };

/**
 * Llaves válidas: "page" (fondo de pantalla de toda la tienda), "home"
 * (portada) o el slug de una categoría existente.
 */
async function validSectionKeys(): Promise<Set<string>> {
  const cats = await listCategories();
  const slugs = cats.map((c) => c.slug);
  return new Set<string>([
    "page",
    "home",
    ...HOME_BLOCK_KEYS,
    ...slugs,
    // Fondo de pantalla por sección (detrás de todo): portada y categorías.
    "pagebg:home",
    ...slugs.map((s) => `pagebg:${s}`),
  ]);
}

/** Refresca el panel y las vistas de la tienda que muestran la sección. */
function refresh(sectionKey: string): void {
  revalidatePath("/admin/configuracion/fondos");
  const pageOf = sectionKey.startsWith("pagebg:") ? sectionKey.slice("pagebg:".length) : sectionKey;
  if (sectionKey === "page") {
    revalidatePath("/", "layout");
  } else if (pageOf === "home" || pageOf.startsWith("block:")) {
    revalidatePath("/");
  } else {
    revalidatePath(`/categoria/${pageOf}`);
  }
}

async function audit(action: string, sectionKey: string, actor: { id: string; role: string; email: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await recordAudit(tx, {
      action,
      entityType: "section_background",
      entityId: sectionKey,
      actorUserId: actor.id,
      actorLabel: `${actor.role}:${actor.email}`,
      after: { sectionKey },
    });
  });
}

export async function setSectionBackgroundAction(input: {
  sectionKey: string;
  dataUrl: string;
}): Promise<Result> {
  try {
    const user = await requirePermission("settings.manage");
    const parsed = z
      .object({
        sectionKey: z.string().min(1).max(60),
        // El cliente ya reduce la imagen; damos holgura pero acotamos el peso.
        dataUrl: z.string().startsWith("data:image/").max(3_500_000),
      })
      .parse(input);

    if (!(await validSectionKeys()).has(parsed.sectionKey)) {
      return { ok: false, message: "Sección no válida." };
    }
    await setSectionImage(parsed.sectionKey, parsed.dataUrl, user.id);
    await audit("section_bg.set_image", parsed.sectionKey, user);
    refresh(parsed.sectionKey);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function removeSectionBackgroundAction(sectionKey: string): Promise<Result> {
  try {
    const user = await requirePermission("settings.manage");
    const key = z.string().min(1).max(60).parse(sectionKey);
    await removeSectionImage(key, user.id);
    await audit("section_bg.remove_image", key, user);
    refresh(key);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function setSectionColorAction(input: {
  sectionKey: string;
  color: string;
}): Promise<Result> {
  try {
    const user = await requirePermission("settings.manage");
    const parsed = z
      .object({
        sectionKey: z.string().min(1).max(60),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color no válido (usa #rrggbb)"),
      })
      .parse(input);

    if (!(await validSectionKeys()).has(parsed.sectionKey)) {
      return { ok: false, message: "Sección no válida." };
    }
    await setSectionColor(parsed.sectionKey, parsed.color.toLowerCase(), user.id);
    await audit("section_bg.set_color", parsed.sectionKey, user);
    refresh(parsed.sectionKey);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function removeSectionColorAction(sectionKey: string): Promise<Result> {
  try {
    const user = await requirePermission("settings.manage");
    const key = z.string().min(1).max(60).parse(sectionKey);
    await removeSectionColor(key, user.id);
    await audit("section_bg.remove_color", key, user);
    refresh(key);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function setSectionStyleAction(input: {
  sectionKey: string;
  style: {
    title?: string | null;
    subtitle?: string | null;
    font?: string | null;
    titleSize?: string | null;
    textColor?: string | null;
  };
}): Promise<Result> {
  try {
    const user = await requirePermission("settings.manage");
    const parsed = z
      .object({
        sectionKey: z.string().min(1).max(60),
        style: z.object({
          title: z.string().max(120).nullish(),
          subtitle: z.string().max(200).nullish(),
          font: z.enum(SECTION_FONT_KEYS as [string, ...string[]]).nullish(),
          titleSize: z.enum(SECTION_SIZE_KEYS as [string, ...string[]]).nullish(),
          textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
        }),
      })
      .parse(input);

    if (!(await validSectionKeys()).has(parsed.sectionKey)) {
      return { ok: false, message: "Sección no válida." };
    }
    // Normaliza (recorta textos, descarta valores vacíos/ inválidos).
    await setSectionStyle(parsed.sectionKey, normalizeSectionStyle(parsed.style), user.id);
    await audit("section_bg.set_style", parsed.sectionKey, user);
    refresh(parsed.sectionKey);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}
