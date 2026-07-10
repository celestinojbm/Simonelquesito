/**
 * Guardia de seguridad de datos (P0): impide que los seeds y las pruebas
 * apunten a una base de datos REMOTA (p. ej. producción / Supabase / poolers
 * gestionados). Solo se permiten bases LOOPBACK. No hay variable de bypass.
 *
 * Este módulo es PURO: no importa `./index` (no crea el pool), así que puede
 * ejecutarse ANTES de cualquier inicialización de la base. Los mensajes de error
 * NUNCA incluyen usuario, contraseña, query string ni la URL completa: como
 * máximo un host SANITIZADO.
 */

/** Únicos hosts permitidos (comparación EXACTA, no por subcadena). */
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Únicos protocolos permitidos. `URL.protocol` incluye los dos puntos. */
const ALLOWED_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

/** Host mostrable sin filtrar el ref del proyecto: enmascara los subdominios. */
function sanitizeHost(hostname: string): string {
  const h = hostname.replace(/^\[/, "").replace(/\]$/, "");
  const labels = h.split(".");
  const lastIsNumeric = /^\d+$/.test(labels[labels.length - 1] ?? "");
  // Dominio (última etiqueta no numérica): deja solo el dominio registrable.
  if (labels.length >= 2 && !lastIsNumeric) return `***.${labels.slice(-2).join(".")}`;
  // IP o host de una sola etiqueta: no se revela.
  return "***";
}

/**
 * Exige que `databaseUrl` sea una base LOOPBACK de PostgreSQL. Lanza (bloquea)
 * si falta, si está mal formada, si el protocolo no es `postgres:`/`postgresql:`,
 * o si el host no es exactamente localhost / 127.0.0.1 / ::1. La ausencia o la
 * ambigüedad se tratan como bloqueo.
 *
 * DETERMINISTA: NO tiene fallback implícito a `process.env`. Cada consumidor
 * pasa la URL explícitamente (p. ej. `assertLocalDatabaseUrl(process.env.DATABASE_URL)`),
 * así `assertLocalDatabaseUrl(undefined)` SIEMPRE rechaza.
 */
export function assertLocalDatabaseUrl(databaseUrl: string | undefined): void {
  if (!databaseUrl || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL no está definida: se requiere una base loopback (localhost/127.0.0.1/::1).");
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL está mal formada: no se puede validar el host; bloqueado por seguridad.");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `DATABASE_URL usa un protocolo no soportado (${url.protocol.replace(":", "")}); ` +
        "solo se aceptan postgres:// o postgresql://. Bloqueado por seguridad.",
    );
  }
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `DATABASE_URL apunta a un host no loopback (${sanitizeHost(url.hostname)}); solo se permiten ` +
        "localhost/127.0.0.1/::1. Rechazado por seguridad: Supabase, poolers gestionados y cualquier " +
        "host remoto quedan bloqueados (no hay bypass).",
    );
  }
}

/**
 * Guardia para el arranque de las PRUEBAS (setup de Vitest): si hay
 * `DATABASE_URL`, DEBE ser loopback; si no hay ninguna, se permite (pruebas
 * puras sin BD). NUNCA acepta silenciosamente una URL remota.
 */
export function assertTestDatabaseIsLocal(env: Record<string, string | undefined> = process.env): void {
  const url = env.DATABASE_URL;
  if (url && url.trim() !== "") assertLocalDatabaseUrl(url);
}
