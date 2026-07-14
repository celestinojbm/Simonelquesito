import { NextResponse, type NextRequest } from "next/server";
import { isStorefrontEnabled } from "@/lib/storefront";

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
 * APIs: /api/** NO se bloquea en bloque (el panel, el POS y el repartidor
 * dependen de APIs autenticadas por sesión, de assets como /api/images y de
 * webhooks firmados). Solo se bloquean fail-closed las APIs que existen
 * exclusivamente para la superficie pública del storefront:
 * - /api/ubicacion/** — mapa del pedido para el cliente; su única página
 *   consumidora (/ubicacion/**) queda bloqueada en modo interno.
 * - /api/webhooks/payments/sandbox — lo invoca únicamente la página
 *   /pago-sandbox/** (bloqueada); además su secreto tiene un fallback de demo
 *   conocido, así que no debe quedar accesible sin storefront.
 * Los webhooks REALES (whatsapp, voice, mercadopago) siguen accesibles: son de
 * proveedores externos y cada uno verifica firma/secreto o responde
 * 401/403/503 si no está configurado (fail-closed propio).
 */
const INTERNAL_PAGE_PREFIXES = ["/admin", "/repartidor"];
const INTERNAL_BLOCKED_API_PREFIXES = ["/api/ubicacion", "/api/webhooks/payments/sandbox"];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  // Fail-closed: solo se sirve el storefront cuando está EXPLÍCITAMENTE activo.
  if (isStorefrontEnabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;

  if (pathname === "/login") return NextResponse.next();

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    if (matchesPrefix(pathname, INTERNAL_BLOCKED_API_PREFIXES)) {
      // API exclusiva del storefront: en modo interno no existe (fail-closed).
      return NextResponse.json({ error: "No disponible" }, { status: 404 });
    }
    return NextResponse.next();
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
