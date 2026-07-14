import { NextResponse, type NextRequest } from "next/server";
import { isStorefrontEnabled } from "@/lib/storefront";

/**
 * Modo "sin storefront" (plantilla replicable): algunos clientes (p. ej. una
 * salsamentaria sin venta pública) solo operan `/admin` y `/repartidor`.
 * FAIL-CLOSED: el storefront se habilita SOLO con STOREFRONT_ENABLED === "true"
 * (ver src/lib/storefront.ts); ausente, vacío o cualquier otro valor ⇒ apagado.
 * Es una decisión de INSTANCIA (como BUSINESS_PRESET), no una preferencia que
 * el dueño cambie seguido — por eso es env var de deploy, no `settings`: así
 * el gateo ocurre en el middleware sin depender de una consulta a BD en cada
 * request. El código de `(store)` NO se borra: sigue existiendo igual que en
 * la plantilla madre, solo se deja de servir. Reactivar venta pública más
 * adelante es cambiar esta variable, no traer código de vuelta.
 *
 * Rutas SIEMPRE permitidas aunque el storefront esté apagado:
 * - /login: única puerta de entrada de TODOS los roles (staff incluido).
 * - /privacidad, /terminos: páginas legales, útiles aunque no haya venta
 *   pública (los datos del cliente se siguen tratando en pedidos internos).
 * - /pago-sandbox, /pedido: no son navegación de storefront — son links
 *   TRANSACCIONALES que el pedido interno le comparte al cliente (link de
 *   pago, seguimiento de SU pedido puntual), no una vitrina para navegar.
 */
const ALWAYS_ALLOWED_PATHS = new Set(["/login", "/privacidad", "/terminos"]);
const ALWAYS_ALLOWED_PREFIXES = ["/pago-sandbox/", "/pedido/"];
const STAFF_PREFIXES = ["/admin", "/api", "/repartidor"];

export function middleware(request: NextRequest) {
  // Fail-closed: solo se sirve el storefront cuando está EXPLÍCITAMENTE activo.
  if (isStorefrontEnabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const isStaffRoute = STAFF_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAlwaysAllowed =
    ALWAYS_ALLOWED_PATHS.has(pathname) || ALWAYS_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
  if (isStaffRoute || isAlwaysAllowed) return NextResponse.next();

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    // Todo menos assets estáticos e internals de Next — mismo patrón
    // recomendado por Next.js para middleware global.
    "/((?!_next/static|_next/image|favicon.ico|icons/|images/|manifest.webmanifest|sw.js).*)",
  ],
};
