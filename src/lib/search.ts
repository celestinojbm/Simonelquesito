/**
 * Búsqueda "inteligente" tolerante para filtrar en el navegador o el servidor:
 * ignora mayúsculas y acentos, y acepta palabras sueltas en cualquier orden y
 * parciales (no exige el nombre completo). Ej: "lim" o "verde limon" encuentran
 * "Limón Tahití". No corrige errores de tecleo (eso lo hace la búsqueda de la
 * tienda con trigramas); aquí buscamos rapidez y coincidencia parcial.
 */

/** Minúsculas, sin acentos, espacios colapsados. */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿El texto contiene TODAS las palabras de la consulta (en cualquier orden)? */
export function smartMatch(haystack: string, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const h = normalizeSearch(haystack);
  return q.split(" ").every((token) => h.includes(token));
}
