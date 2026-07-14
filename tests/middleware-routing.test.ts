/**
 * Gateo de rutas del middleware en modo interno (storefront deshabilitado):
 * la ÚNICA página pública es /login; /admin/** y /repartidor/** siguen
 * sirviéndose (su auth ocurre dentro de la app); todo lo demás — storefront,
 * /privacidad, /terminos, /pedido/**, /pago-sandbox/**, /ubicacion/** —
 * redirige a /login. Las APIs se gatean por ALLOWLIST fail-closed: solo pasan
 * las auditadas; cualquier otra /api/** (storefront, desconocidas o con
 * prefijo malicioso sin límite de segmento) responde 404. Con
 * STOREFRONT_ENABLED="true" nada se gatea.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

afterEach(() => vi.unstubAllEnvs());

function run(path: string) {
  return middleware(new NextRequest(new URL(`http://localhost${path}`)));
}
function isNext(res: Response) {
  return res.headers.get("x-middleware-next") === "1";
}
function redirectsToLogin(res: Response) {
  if (res.status !== 307 && res.status !== 308) return false;
  const loc = res.headers.get("location");
  return !!loc && new URL(loc).pathname === "/login";
}

const BLOCKED_PAGES = [
  "/",
  "/buscar",
  "/categorias",
  "/categoria/frutas",
  "/ofertas",
  "/producto/queso-costeno",
  "/carrito",
  "/checkout",
  "/cuenta",
  "/cuenta/credito",
  "/ubicacion/tok123",
  "/privacidad",
  "/terminos",
  "/pedido/abc",
  "/pago-sandbox/abc",
  "/administracion", // prefijo parcial: NO se cuela como /admin
];
const ALLOWED_PAGES = ["/login", "/admin", "/admin/inventario", "/repartidor", "/repartidor/ruta"];
const ALLOWED_APIS = [
  "/api/admin/pedidos-nuevos",
  "/api/driver/location",
  "/api/images/img_123",
  "/api/section-bg/page",
  "/api/integrations/mercadopago/callback",
  "/api/webhooks/whatsapp",
  "/api/webhooks/voice",
  "/api/webhooks/payments/mercadopago",
];
const BLOCKED_APIS = [
  // APIs del storefront clasificadas como bloqueadas:
  "/api/ubicacion/tok123",
  "/api/webhooks/payments/sandbox",
  // Fail-closed real: rutas desconocidas o futuras NO pasan sin clasificarse.
  "/api",
  "/api/desconocida",
  // Patrones dinámicos estrictos: ni faltan ni sobran segmentos.
  "/api/images",
  "/api/images/abc/extra",
  "/api/images/private/export",
  "/api/section-bg",
  "/api/section-bg/page/extra",
  // Límite de segmento: un prefijo "parecido" no se cuela.
  "/api/imagesmaliciosa",
  "/api/admin/pedidos-nuevos-extra",
];

// Modo interno con TODAS las variantes fail-closed exigidas.
const INTERNAL_VALUES: Array<[string, string | undefined]> = [
  ["ausente", undefined],
  ["vacía", ""],
  ["false", "false"],
  ["otro valor", "yes"],
];

describe.each(INTERNAL_VALUES)("middleware — modo interno (STOREFRONT_ENABLED %s)", (_label, value) => {
  function stub() {
    // stubEnv con undefined ELIMINA la variable (cubre el caso "ausente").
    vi.stubEnv("STOREFRONT_ENABLED", value);
  }
  it("solo /login, /admin/** y /repartidor/** se sirven como páginas", () => {
    stub();
    for (const p of ALLOWED_PAGES) expect(isNext(run(p)), `permitida ${p}`).toBe(true);
  });
  it("todo el resto de páginas (storefront, legales y links transaccionales) redirige a /login", () => {
    stub();
    for (const p of BLOCKED_PAGES) expect(redirectsToLogin(run(p)), `bloqueada ${p}`).toBe(true);
  });
  it("las APIs internas, de assets y webhooks reales pasan", () => {
    stub();
    for (const p of ALLOWED_APIS) expect(isNext(run(p)), `api permitida ${p}`).toBe(true);
  });
  it("toda API fuera de la allowlist responde 404 (fail-closed, sin redirect)", () => {
    stub();
    for (const p of BLOCKED_APIS) {
      const res = run(p);
      expect(res.status, `api bloqueada ${p}`).toBe(404);
    }
  });
});

describe("middleware — storefront HABILITADO (STOREFRONT_ENABLED='true')", () => {
  it("no gatea páginas: storefront, legales y links transaccionales funcionan", () => {
    vi.stubEnv("STOREFRONT_ENABLED", "true");
    for (const p of ["/", "/categorias", "/carrito", "/checkout", "/privacidad", "/terminos", "/pedido/abc", "/pago-sandbox/abc", "/ubicacion/tok123"]) {
      expect(isNext(run(p)), `habilitado ${p}`).toBe(true);
    }
  });
  it("no gatea ninguna API (comportamiento heredado íntegro, incluidas desconocidas)", () => {
    vi.stubEnv("STOREFRONT_ENABLED", "true");
    for (const p of [...BLOCKED_APIS, ...ALLOWED_APIS]) expect(isNext(run(p)), `api habilitada ${p}`).toBe(true);
  });
});
