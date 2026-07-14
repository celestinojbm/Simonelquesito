/**
 * Gateo de rutas del middleware en modo interno (storefront deshabilitado).
 * Rutas comerciales → redirigen a /login; login, legales, staff y links
 * transaccionales quedan permitidos. Con STOREFRONT_ENABLED="true" no gatea nada.
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

const COMMERCIAL = ["/", "/buscar", "/categorias", "/categoria/frutas", "/ofertas", "/producto/queso-costeno", "/carrito", "/checkout", "/cuenta", "/cuenta/credito", "/ubicacion/tok123"];
const ALLOWED = ["/login", "/privacidad", "/terminos", "/admin", "/admin/inventario", "/api/admin/x", "/repartidor", "/pedido/ord_1", "/pago-sandbox/ref_1"];

describe("middleware — storefront DESHABILITADO (variable ausente ⇒ fail-closed)", () => {
  it("todas las rutas comerciales redirigen a /login", () => {
    vi.stubEnv("STOREFRONT_ENABLED", ""); // ausente/vacío ⇒ apagado
    for (const p of COMMERCIAL) expect(redirectsToLogin(run(p)), `comercial ${p}`).toBe(true);
  });
  it("login, legales, staff y links transaccionales quedan permitidos", () => {
    vi.stubEnv("STOREFRONT_ENABLED", "false");
    for (const p of ALLOWED) expect(isNext(run(p)), `permitida ${p}`).toBe(true);
  });
  it("una ruta que solo comparte prefijo con staff NO se cuela (p. ej. /administracion)", () => {
    vi.stubEnv("STOREFRONT_ENABLED", "false");
    expect(redirectsToLogin(run("/administracion"))).toBe(true);
  });
});

describe("middleware — storefront HABILITADO (STOREFRONT_ENABLED='true')", () => {
  it("no gatea ninguna ruta comercial", () => {
    vi.stubEnv("STOREFRONT_ENABLED", "true");
    for (const p of ["/", "/categorias", "/carrito", "/checkout"]) expect(isNext(run(p)), `habilitado ${p}`).toBe(true);
  });
});
