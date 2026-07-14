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

/**
 * Política de APIs en modo interno — ALLOWLIST fail-closed.
 *
 * Fuente única de verdad: la consume el middleware (gateo real) y la prueba de
 * inventario (tests/api-inventory-guard.test.ts), que falla si aparece un
 * `src/app/api/x/route.ts` nuevo sin clasificar aquí. Una API que no esté en
 * la allowlist responde 404 en modo interno — incluida cualquier API futura,
 * hasta que se audite y clasifique explícitamente.
 */

/** APIs permitidas en modo interno por coincidencia EXACTA de ruta. */
export const INTERNAL_ALLOWED_API_EXACT: readonly string[] = [
  // Internas autenticadas (sesión + rol/permiso dentro del handler):
  "/api/admin/pedidos-nuevos",
  "/api/driver/location",
  "/api/integrations/mercadopago/callback",
  // Webhooks firmados de proveedores reales (verifican firma o responden 401/403/503):
  "/api/webhooks/whatsapp",
  "/api/webhooks/voice",
  "/api/webhooks/payments/mercadopago",
];

/**
 * APIs de assets permitidas por PREFIJO con límite de segmento: se exige el
 * `/` separador (`/api/images/abc` pasa; `/api/imagesmaliciosa` no; el prefijo
 * pelado `/api/images` tampoco — no existe como ruta).
 */
export const INTERNAL_ALLOWED_API_PREFIXES: readonly string[] = ["/api/images", "/api/section-bg"];

/**
 * APIs del storefront conocidas y BLOQUEADAS en modo interno (patrones de ruta
 * tal como existen en `src/app/api/**`). No las usa el middleware — allí bloquea
 * la ausencia de allowlist —; documentan la clasificación para la prueba de
 * inventario: todo endpoint del repo debe estar en la allowlist o aquí.
 */
export const INTERNAL_BLOCKED_API_ROUTES: readonly string[] = [
  // Mapa del pedido para el cliente: su única página consumidora (/ubicacion/**)
  // queda bloqueada en modo interno.
  "/api/ubicacion/[token]",
  // Solo lo invoca la página /pago-sandbox/** (bloqueada en modo interno).
  "/api/webhooks/payments/sandbox",
];

/** ¿La ruta de API está permitida en modo interno? (fail-closed: default NO). */
export function isInternalApiAllowed(pathname: string): boolean {
  if (INTERNAL_ALLOWED_API_EXACT.includes(pathname)) return true;
  return INTERNAL_ALLOWED_API_PREFIXES.some((p) => pathname.startsWith(`${p}/`));
}
