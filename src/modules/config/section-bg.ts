import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sectionBackgrounds } from "@/db/schema";
import { id } from "@/lib/ids";
import type { SectionStyle } from "./section-style";

/**
 * Apariencia por sección de la tienda del cliente: imagen de fondo y/o color.
 * La imagen se guarda como data-URI en la BD y se sirve por
 * /api/section-bg/[key] (con ?v=<updatedAt> para cachear fuerte y refrescar al
 * cambiar). El color es un hex #rrggbb. Precedencia al mostrar: imagen > color
 * > diseño por defecto. sectionKey: "page" (fondo de pantalla), "home"
 * (portada) o el slug de la categoría.
 */

export type SectionAppearance = { imageUrl: string | null; color: string | null; style: SectionStyle };

/**
 * ¿El texto sobre este color debe ser oscuro? Según la luminancia del color
 * (colores claros → texto oscuro; colores oscuros → texto blanco).
 */
export function sectionTextIsDark(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return true;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

function imageUrlFor(sectionKey: string, updatedAt: Date): string {
  return `/api/section-bg/${encodeURIComponent(sectionKey)}?v=${updatedAt.getTime()}`;
}

/** Solo la URL de la imagen (para el fondo de pantalla, que no usa color). */
export async function getSectionBackgroundUrl(sectionKey: string): Promise<string | null> {
  const row = await db.query.sectionBackgrounds.findFirst({
    where: eq(sectionBackgrounds.sectionKey, sectionKey),
  });
  if (!row || !row.url) return null;
  return imageUrlFor(sectionKey, row.updatedAt);
}

/** Imagen + color + estilo (texto/tipografía) de una sección. */
export async function getSectionAppearance(sectionKey: string): Promise<SectionAppearance> {
  const row = await db.query.sectionBackgrounds.findFirst({
    where: eq(sectionBackgrounds.sectionKey, sectionKey),
  });
  if (!row) return { imageUrl: null, color: null, style: {} };
  return {
    imageUrl: row.url ? imageUrlFor(sectionKey, row.updatedAt) : null,
    color: row.color,
    style: (row.style as SectionStyle) ?? {},
  };
}

/** Apariencia de todas las secciones configuradas (para el panel). */
export async function listSectionAppearances(): Promise<Record<string, SectionAppearance>> {
  const rows = await db.query.sectionBackgrounds.findMany();
  const out: Record<string, SectionAppearance> = {};
  for (const r of rows) {
    out[r.sectionKey] = {
      imageUrl: r.url ? imageUrlFor(r.sectionKey, r.updatedAt) : null,
      color: r.color,
      style: (r.style as SectionStyle) ?? {},
    };
  }
  return out;
}

/** Actualiza campos (imagen/color/estilo) de una sección, creando la fila si hace falta. */
async function upsertField(
  sectionKey: string,
  field: Partial<{ url: string | null; color: string | null; style: SectionStyle | null }>,
  updatedBy: string,
): Promise<void> {
  const existing = await db.query.sectionBackgrounds.findFirst({
    where: eq(sectionBackgrounds.sectionKey, sectionKey),
  });
  if (existing) {
    await db
      .update(sectionBackgrounds)
      .set({ ...field, updatedBy, updatedAt: new Date() })
      .where(eq(sectionBackgrounds.id, existing.id));
    // Si ya no queda imagen, ni color, ni estilo, elimina la fila.
    const url = "url" in field ? field.url : existing.url;
    const color = "color" in field ? field.color : existing.color;
    const style = ("style" in field ? field.style : (existing.style as SectionStyle)) ?? null;
    const hasStyle = !!style && Object.values(style).some((v) => v != null && v !== "");
    if (!url && !color && !hasStyle) {
      await db.delete(sectionBackgrounds).where(eq(sectionBackgrounds.id, existing.id));
    }
  } else if (field.url || field.color || (field.style && Object.keys(field.style).length > 0)) {
    await db.insert(sectionBackgrounds).values({
      id: id("sbg"),
      sectionKey,
      url: field.url ?? null,
      color: field.color ?? null,
      style: field.style ?? null,
      updatedBy,
    });
  }
}

export async function setSectionImage(sectionKey: string, url: string, updatedBy: string): Promise<void> {
  await upsertField(sectionKey, { url }, updatedBy);
}

export async function removeSectionImage(sectionKey: string, updatedBy: string): Promise<void> {
  await upsertField(sectionKey, { url: null }, updatedBy);
}

export async function setSectionColor(sectionKey: string, color: string, updatedBy: string): Promise<void> {
  await upsertField(sectionKey, { color }, updatedBy);
}

export async function removeSectionColor(sectionKey: string, updatedBy: string): Promise<void> {
  await upsertField(sectionKey, { color: null }, updatedBy);
}

/** Guarda el estilo (texto/tipografía) ya normalizado; {} lo borra. */
export async function setSectionStyle(sectionKey: string, style: SectionStyle, updatedBy: string): Promise<void> {
  const value = Object.keys(style).length > 0 ? style : null;
  await upsertField(sectionKey, { style: value }, updatedBy);
}
