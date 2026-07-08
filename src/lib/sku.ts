/**
 * SKU secuencial por categoría, con el mismo formato del catálogo importado
 * de Treinta: prefijo de 3 letras de la categoría + número de 3 dígitos
 * (ABA-001, ASE-014, …). Se usa para sugerirlo en el formulario y para
 * generarlo en el servidor cuando el campo queda vacío.
 */

/** Prefijo de 3 letras a partir del nombre de la categoría (sin tildes). */
export function skuPrefix(categoryName: string): string {
  const letters = categoryName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  return (letters.slice(0, 3) || "PRD").padEnd(3, "X");
}

/** Siguiente SKU dado el mayor consecutivo existente para el prefijo. */
export function nextSku(prefix: string, maxExisting: number): string {
  return `${prefix}-${String(maxExisting + 1).padStart(3, "0")}`;
}
