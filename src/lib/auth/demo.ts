/**
 * Guardas del "modo demo" (hallazgo P0) — ÚNICA fuente de verdad, reutilizada
 * por login, validación de sesión, seed, scripts y pruebas.
 *
 * Regla: las cuentas de demostración (dominio exacto `@marketcastilla.demo`)
 * NUNCA deben poder crearse, autenticarse (ni con sesión previa) ni mostrarse
 * en la interfaz en producción.
 *
 * Diseño *fail-closed*: el modo demo solo se activa con un opt-in EXPLÍCITO
 * (`DEMO_MODE=true`) y JAMÁS en un runtime de producción, aunque la variable
 * esté puesta. Si la variable no está definida, el modo demo queda apagado.
 */

/**
 * ¿Estamos en un runtime de producción? Se considera producción si:
 * - `NODE_ENV=production`, o
 * - `VERCEL_ENV=production` (entorno de Vercel), o
 * - `VERCEL=1` (cualquier runtime de Vercel — incluido Preview, que comparte la
 *   base de producción: nunca queremos datos/cuentas demo ahí).
 */
export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL === "1"
  );
}

/**
 * ¿El modo demo está habilitado para ESTE runtime?
 * - Requiere opt-in explícito `DEMO_MODE=true` (exacto).
 * - Nunca se activa en producción, aunque `DEMO_MODE=true` (producción manda).
 * - Apagado por defecto (fail-closed).
 */
export function isDemoEnabled(): boolean {
  if (isProductionRuntime()) return false;
  return process.env.DEMO_MODE === "true";
}

/** ¿Se permite correr el seed DEMO (reset destructivo)? Igual criterio que el modo demo. */
export function isDemoSeedAllowed(): boolean {
  return isDemoEnabled();
}

/**
 * Lanza si NO se permite correr el seed demo. Debe llamarse ANTES de cualquier
 * acceso a la base o transacción destructiva. Producción siempre bloqueada;
 * fuera de producción se exige `DEMO_MODE=true`.
 */
export function assertDemoSeedAllowed(): void {
  if (isProductionRuntime()) {
    throw new Error(
      "db:seed está DESHABILITADO: es un RESET DEMO DESTRUCTIVO (borra todas las " +
        "tablas) y nunca corre en producción (NODE_ENV/VERCEL_ENV/VERCEL). " +
        "Para crear el propietario real usa: npm run owner:create",
    );
  }
  if (process.env.DEMO_MODE !== "true") {
    throw new Error(
      'db:seed está DESHABILITADO: es un RESET DEMO DESTRUCTIVO y requiere el ' +
        'opt-in explícito DEMO_MODE=true (solo desarrollo, CI o entornos demo ' +
        'descartables).',
    );
  }
}

/**
 * Dominios reservados EXACTOS para cuentas de demostración de este proyecto.
 * La comparación es contra el dominio completo (parte tras el último `@`), no
 * por sufijo, para no aceptar falsos positivos como
 * `x@marketcastilla.demo.atacante.com` o `x@notmarketcastilla.demo`.
 */
export const DEMO_EMAIL_DOMAINS = ["marketcastilla.demo"] as const;

/** Dominio de un correo, normalizado (minúsculas, sin espacios). `null` si no es válido. */
function emailDomain(email: string): string | null {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0 || at === e.length - 1) return null;
  return e.slice(at + 1);
}

/**
 * ¿El correo pertenece a una cuenta de demostración?
 * Regla EXACTA: el dominio (tras el último `@`) debe ser exactamente uno de
 * `DEMO_EMAIL_DOMAINS`. No hace coincidencias por sufijo ni por subcadena.
 */
export function isDemoEmail(email: string): boolean {
  const domain = emailDomain(email);
  return domain !== null && (DEMO_EMAIL_DOMAINS as readonly string[]).includes(domain);
}

/**
 * Bloqueo de autenticación (backend): una cuenta demo no puede autenticar salvo
 * que el modo demo esté habilitado (nunca en producción). Se aplica tanto en el
 * login como en la validación central de sesión, así una cookie ya emitida
 * tampoco autentica en producción.
 */
export function isLoginBlocked(email: string): boolean {
  return isDemoEmail(email) && !isDemoEnabled();
}
