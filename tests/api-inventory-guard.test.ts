/**
 * Guardia de INVENTARIO de APIs (modo interno, allowlist fail-closed).
 *
 * Descubre todos los `src/app/api/**\/route.ts` del repo y exige que cada
 * endpoint esté clasificado EXPLÍCITAMENTE en la fuente única de verdad
 * (src/lib/storefront.ts): o pasa la allowlist (`isInternalApiAllowed`) o
 * figura en `INTERNAL_BLOCKED_API_ROUTES`. Si mañana aparece un route.ts
 * nuevo sin clasificar, esta prueba FALLA — el middleware ya lo bloquea con
 * 404 (fail-closed), y aquí se obliga a auditarlo y clasificarlo.
 * También detecta clasificaciones obsoletas (entradas sin ruta real).
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import {
  INTERNAL_ALLOWED_API_EXACT,
  INTERNAL_ALLOWED_API_PREFIXES,
  INTERNAL_BLOCKED_API_ROUTES,
  isInternalApiAllowed,
} from "@/lib/storefront";

const API_ROOT = path.join(process.cwd(), "src/app/api");

/** Patrones de ruta reales: carpetas bajo src/app/api que contienen route.ts. */
function discoverApiRoutes(dir: string = API_ROOT, urlPath = "/api"): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      routes.push(...discoverApiRoutes(path.join(dir, entry.name), `${urlPath}/${entry.name}`));
    } else if (entry.isFile() && entry.name === "route.ts") {
      routes.push(urlPath);
    }
  }
  return routes.sort();
}

/** Ruta concreta de muestra: cada segmento dinámico [param] se vuelve "x". */
function samplePath(routePattern: string): string {
  return routePattern.replace(/\[[^\]]+\]/g, "x");
}

describe("inventario de APIs — todo endpoint clasificado (fail-closed)", () => {
  const discovered = discoverApiRoutes();

  it("existe al menos un endpoint (sanidad del descubrimiento)", () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  it.each(discovered)("%s está clasificado: allowlist o bloqueado explícito", (route) => {
    const allowed = isInternalApiAllowed(samplePath(route));
    const blocked = INTERNAL_BLOCKED_API_ROUTES.includes(route);
    expect(
      allowed || blocked,
      `Endpoint NUEVO sin clasificar: ${route}. Audítalo y añádelo a la allowlist ` +
        `(INTERNAL_ALLOWED_API_EXACT / INTERNAL_ALLOWED_API_PREFIXES) o a ` +
        `INTERNAL_BLOCKED_API_ROUTES en src/lib/storefront.ts. Mientras tanto el ` +
        `middleware lo bloquea con 404 en modo interno.`,
    ).toBe(true);
    // Nada puede estar en ambas listas a la vez (clasificación ambigua).
    expect(allowed && blocked, `${route} está permitido Y bloqueado a la vez`).toBe(false);
  });

  it("cada entrada EXACTA de la allowlist corresponde a una ruta real", () => {
    for (const entry of INTERNAL_ALLOWED_API_EXACT) {
      expect(discovered.includes(entry), `allowlist obsoleta: ${entry} no existe en src/app/api`).toBe(true);
    }
  });

  it("cada PREFIJO de la allowlist tiene al menos una ruta real debajo", () => {
    for (const prefix of INTERNAL_ALLOWED_API_PREFIXES) {
      const hits = discovered.filter((r) => r.startsWith(`${prefix}/`));
      expect(hits.length, `prefijo obsoleto en la allowlist: ${prefix}`).toBeGreaterThan(0);
    }
  });

  it("cada ruta BLOQUEADA declarada corresponde a una ruta real", () => {
    for (const entry of INTERNAL_BLOCKED_API_ROUTES) {
      expect(discovered.includes(entry), `bloqueo obsoleto: ${entry} no existe en src/app/api`).toBe(true);
    }
  });
});
