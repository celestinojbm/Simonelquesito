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
 * Política de APIs en modo interno — ALLOWLIST fail-closed por PATRONES REALES.
 *
 * FUENTE ÚNICA DE VERDAD: cada patrón corresponde 1:1 a un
 * `src/app/api/**\/route.ts` existente y aparece UNA sola vez con su
 * clasificación. La consumen el middleware (gateo real) y la prueba de
 * inventario (tests/api-inventory-guard.test.ts), que exige igualdad exacta
 * entre los endpoints del repo y estas claves: un route.ts nuevo —incluso
 * anidado bajo /api/images/**— rompe la suite hasta clasificarse aquí, y una
 * clasificación sin ruta real también. No hay prefijos amplios ni catch-all
 * implícito: un patrón `[...slug]` requiere soporte explícito (hoy no existe
 * y la guardia lo rechaza).
 */
export const INTERNAL_API_POLICY: Readonly<Record<string, "allowed" | "blocked">> = {
  // Internas autenticadas (sesión + rol/permiso dentro del handler):
  "/api/admin/pedidos-nuevos": "allowed",
  "/api/driver/location": "allowed",
  "/api/integrations/mercadopago/callback": "allowed",
  // Webhooks firmados de proveedores reales (verifican firma o responden 401/403/503):
  "/api/webhooks/whatsapp": "allowed",
  "/api/webhooks/voice": "allowed",
  "/api/webhooks/payments/mercadopago": "allowed",
  // Assets necesarios para el panel/POS (solo imágenes, sin PII ni contacto):
  "/api/images/[id]": "allowed",
  "/api/section-bg/[key]": "allowed",
  // Storefront: bloqueadas en modo interno.
  // Mapa del pedido para el cliente — su única consumidora (/ubicacion/**) está bloqueada:
  "/api/ubicacion/[token]": "blocked",
  // Solo lo invoca la página /pago-sandbox/** (bloqueada en modo interno):
  "/api/webhooks/payments/sandbox": "blocked",
};

/** Segmento dinámico SIMPLE de Next: `[id]`, `[key]`, `[token]`… (NO catch-all). */
const SIMPLE_DYNAMIC_SEGMENT = /^\[[^\][.]+\]$/;

/**
 * Matcher determinista de patrones de ruta:
 * - un segmento estático coincide solo consigo mismo;
 * - `[param]` coincide con EXACTAMENTE un segmento no vacío;
 * - misma cantidad de segmentos (ni de más ni de menos);
 * - un catch-all (`[...slug]`) NUNCA coincide: requeriría soporte explícito.
 */
export function matchesApiPattern(pathname: string, pattern: string): boolean {
  const pathSegments = pathname.split("/");
  const patternSegments = pattern.split("/");
  if (pathSegments.length !== patternSegments.length) return false;
  return patternSegments.every((pat, i) => {
    if (SIMPLE_DYNAMIC_SEGMENT.test(pat)) return pathSegments[i] !== "";
    if (pat.startsWith("[")) return false; // catch-all/optional: sin soporte ⇒ fail-closed
    return pathSegments[i] === pat;
  });
}

/** ¿La ruta de API está permitida en modo interno? (fail-closed: default NO). */
export function isInternalApiAllowed(pathname: string): boolean {
  return Object.entries(INTERNAL_API_POLICY).some(
    ([pattern, verdict]) => verdict === "allowed" && matchesApiPattern(pathname, pattern),
  );
}
