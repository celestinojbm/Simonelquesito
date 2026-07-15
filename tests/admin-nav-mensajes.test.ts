/**
 * "Mensajes" retirado del panel administrativo (ocultado, no eliminado).
 *
 * El ítem sale de BASE_NAV (y por tanto del sidebar, el menú móvil y el editor
 * de navegación); la navegación resuelta no lo incluye ni forzándolo por
 * `navOrder`; la URL directa `/admin/mensajes` redirige a `/admin` sin error. La
 * infraestructura de mensajería (tabla `notifications`, servicio, webhook de
 * WhatsApp) se conserva intacta.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { BASE_NAV, resolveNav, type AdminPanelConfig } from "@/modules/admin/nav";
import * as schema from "@/db/schema";

describe("Mensajes retirado del panel", () => {
  it("BASE_NAV no contiene /admin/mensajes", () => {
    expect(BASE_NAV.some((n) => n.href === "/admin/mensajes")).toBe(false);
  });

  it("la navegación resuelta no incluye Mensajes (ni forzándolo por navOrder)", () => {
    const cfg = { navOrder: ["/admin/mensajes", "/admin"] } as unknown as AdminPanelConfig;
    const resolved = resolveNav(cfg);
    expect(resolved.some((n) => n.href === "/admin/mensajes")).toBe(false);
  });

  it("/admin/mensajes redirige a /admin sin mostrar error", async () => {
    const page = (await import("@/app/admin/mensajes/page")).default as () => never;
    let thrown: unknown;
    try {
      page();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeTruthy();
    const info = String(
      (thrown as { digest?: string; message?: string })?.digest ??
        (thrown as { message?: string })?.message ??
        "",
    );
    // redirect() de Next lanza un error con el destino codificado en el digest.
    expect(info).toContain("NEXT_REDIRECT");
    expect(info).toContain("/admin");
  });

  it("la infraestructura de mensajería NO fue eliminada", () => {
    // Tabla notifications sigue en el esquema.
    expect(schema.notifications).toBeTruthy();
    // Servicio de mensajería y webhook de WhatsApp siguen presentes en el repo.
    expect(existsSync(path.join(process.cwd(), "src/modules/messaging/service.ts"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "src/app/api/webhooks/whatsapp/route.ts"))).toBe(true);
  });
});
