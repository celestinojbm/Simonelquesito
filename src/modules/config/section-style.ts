/**
 * Personalización de texto y tipografía por sección (independiente de la BD,
 * se puede importar tanto del servidor como del cliente).
 *
 * - `title` / `subtitle`: texto a mostrar (acepta emojis y símbolos Unicode:
 *   🥑 ★ ✦ → 🎉…). Si es null/vacío, la sección usa su texto por defecto.
 * - `font`: clave de una fuente de la lista curada (sin descargas externas:
 *   son familias del sistema, cargan al instante y funcionan sin conexión).
 * - `titleSize`: clave de tamaño del título.
 * - `textColor`: color del texto (hex) que anula el contraste automático.
 */

export type SectionStyle = {
  title?: string | null;
  subtitle?: string | null;
  font?: string | null;
  titleSize?: string | null;
  textColor?: string | null;
};

export type FontOption = { key: string; label: string; stack: string };

/** Fuentes del sistema (sin depender de terceros; funcionan offline). */
export const SECTION_FONTS: FontOption[] = [
  { key: "default", label: "Predeterminada", stack: "" },
  { key: "rounded", label: "Redondeada", stack: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif" },
  { key: "serif", label: "Serif elegante", stack: "Georgia, 'Times New Roman', serif" },
  { key: "display", label: "Impacto", stack: "Impact, 'Haettenschweiler', 'Arial Narrow Bold', sans-serif" },
  { key: "mono", label: "Monoespaciada", stack: "ui-monospace, 'Courier New', monospace" },
  { key: "handwritten", label: "Manuscrita", stack: "'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive" },
];

export type SizeOption = { key: string; label: string; rem: string };

/** Tamaños del título (rem). Se aplican como font-size en línea. */
export const SECTION_SIZES: SizeOption[] = [
  { key: "sm", label: "Pequeño", rem: "1.25rem" },
  { key: "md", label: "Mediano", rem: "1.75rem" },
  { key: "lg", label: "Grande", rem: "2.25rem" },
  { key: "xl", label: "Enorme", rem: "3rem" },
];

export const SECTION_FONT_KEYS = SECTION_FONTS.map((f) => f.key);
export const SECTION_SIZE_KEYS = SECTION_SIZES.map((s) => s.key);

/**
 * Bloques de texto del inicio (solo título, sin fondo). La clave lleva prefijo
 * "block:" para no chocar con "home"/"page" ni con los slugs de categoría.
 */
export const HOME_BLOCKS: ReadonlyArray<{ key: string; label: string; defaultText: string; sub?: boolean }> = [
  { key: "block:cats", label: "Título «Categorías»", defaultText: "Categorías" },
  { key: "block:offers", label: "Título «Ofertas del día»", defaultText: "🏷️ Ofertas del día" },
  { key: "block:fresh", label: "Título «Frutas y verduras frescas»", defaultText: "🥑 Frutas y verduras frescas" },
  { key: "block:popular", label: "Título «Los favoritos del barrio»", defaultText: "Los favoritos del barrio" },
  { key: "block:freeship", label: "Insignia «Envío gratis»", defaultText: "🛵 Envío gratis desde" },
  { key: "block:liquor", label: "Título «Cervezas y licores»", defaultText: "🍺 Cervezas y licores (+18)" },
  { key: "block:neighborhood", label: "Sello «Comercio de barrio»", defaultText: "Comercio de barrio, servicio profesional.", sub: true },
];

export const HOME_BLOCK_KEYS = HOME_BLOCKS.map((b) => b.key);

/** Familia CSS de una fuente (null = usar la predeterminada de la app). */
export function fontStack(key: string | null | undefined): string | null {
  if (!key) return null;
  const f = SECTION_FONTS.find((x) => x.key === key);
  return f && f.stack ? f.stack : null;
}

/** font-size en rem de un tamaño (null = usar el tamaño por defecto). */
export function sizeRem(key: string | null | undefined): string | null {
  if (!key) return null;
  return SECTION_SIZES.find((x) => x.key === key)?.rem ?? null;
}

/** Limpia un estilo: recorta textos, descarta valores no válidos y vacíos. */
export function normalizeSectionStyle(input: SectionStyle): SectionStyle {
  const clean: SectionStyle = {};
  const title = input.title?.toString().trim();
  const subtitle = input.subtitle?.toString().trim();
  if (title) clean.title = title.slice(0, 120);
  if (subtitle) clean.subtitle = subtitle.slice(0, 200);
  if (input.font && SECTION_FONT_KEYS.includes(input.font) && input.font !== "default") clean.font = input.font;
  if (input.titleSize && SECTION_SIZE_KEYS.includes(input.titleSize)) clean.titleSize = input.titleSize;
  if (input.textColor && /^#[0-9a-fA-F]{6}$/.test(input.textColor)) clean.textColor = input.textColor.toLowerCase();
  return clean;
}

/** ¿El estilo tiene algún valor efectivo? */
export function hasSectionStyle(s: SectionStyle | null | undefined): boolean {
  return !!s && Object.values(s).some((v) => v != null && v !== "");
}
