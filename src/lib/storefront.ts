/**
 * Storefront (venta pública en línea) — decisión de INSTANCIA, FAIL-CLOSED.
 *
 * El storefront queda habilitado ÚNICAMENTE cuando `STOREFRONT_ENABLED` es
 * EXACTAMENTE la cadena "true". Cualquier otro caso lo deja DESHABILITADO
 * (admin-only): ausente, vacío, "false", "TRUE", "1", "yes" u otro valor.
 * No hay habilitación por fallback: si hay duda, se sirve solo la parte interna.
 *
 * Determinista y testeable: acepta el entorno como parámetro (por defecto
 * `process.env`). Se usa tanto en el middleware (gateo de rutas) como en pruebas.
 */
export function isStorefrontEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STOREFRONT_ENABLED === "true";
}
