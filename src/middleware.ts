import { NextResponse, type NextRequest } from "next/server";
import { isInternalApiAllowed, isStorefrontEnabled } from "@/lib/storefront";

/**
 * Modo "sin storefront" (plantilla replicable): instancias internal-only
 * (p. ej. una salsamentaria sin venta pública) solo operan el sistema interno.
 * Es una decisión de INSTANCIA (como BUSINESS_PRESET), no una preferencia que
 * el dueño cambie seguido — por eso es env var de deploy, no `settings`: así
 * el gateo ocurre en el middleware sin depender de una consulta a BD en cada
 * request. El código de `(store)` NO se borra: sigue existiendo igual que en
 * la plantilla madre, solo se deja de servir. Reactivar venta pública más
 * adelante es cambiar esta variable, no traer código de vuelta.
 *
 * FAIL-CLOSED: el storefront se habilita SOLO con STOREFRONT_ENABLED === "true"
 * (ver src/lib/storefront.ts); ausente, vacío o cualquier otro valor ⇒ apagado.
 *
 * Con el storefront APAGADO, la única página pública es /login. Todo lo demás
 * (portada, catálogo, carrito, checkout, cuenta, /privacidad, /terminos y los
 * links transaccionales /pedido/**, /pago-sandbox/**, /ubicacion/**) redirige a
 * /login: esta instancia no comparte enlaces públicos con clientes, y las
 * páginas legales consumen datos de contacto heredados que no deben exponerse.
 *
 * APIs: /api/** se gatea por ALLOWLIST fail-closed (ver src/lib/storefront.ts,
 * fuente única de verdad compartida con la prueba de inventario). Solo pasan
 * las APIs auditadas: internas autenticadas por sesión, webhooks firmados de
 * proveedores reales y los assets /api/images/** y /api/section-bg/**.
 * CUALQUIER otra ruta /api/** — incluida una API nueva aún sin clasificar —
 * responde 404 en modo interno.
 */
const INTERNAL_PAGE_PREFIXES = ["/admin", "/repartidor"];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  // Fail-closed: solo se sirve el storefront cuando está EXPLÍCITAMENTE activo.
  if (isStorefrontEnabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;

  if (pathname === "/login") return NextResponse.next();

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    if (isInternalApiAllowed(pathname)) return NextResponse.next();
    // Fail-closed: toda API fuera de la allowlist (incluidas las del storefront
    // y cualquier endpoint nuevo sin clasificar) no existe en modo interno.
    return NextResponse.json({ error: "No disponible" }, { status: 404 });
  }

  if (matchesPrefix(pathname, INTERNAL_PAGE_PREFIXES)) return NextResponse.next();

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    // Todo menos assets estáticos e internals de Next — mismo patrón
    // recomendado por Next.js para middleware global.
    "/((?!_next/static|_next/image|favicon.ico|icons/|images/|manifest.webmanifest|sw.js).*)",
  ],
};
