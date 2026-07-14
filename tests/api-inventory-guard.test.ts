/**
 * Guardia de INVENTARIO de APIs (modo interno) — ESTRICTA, por patrones reales.
 *
 * Descubre todos los `src/app/api/**\/route.ts` del repo y exige IGUALDAD
 * EXACTA con las claves de INTERNAL_API_POLICY (src/lib/storefront.ts, la
 * misma fuente que consume el middleware):
 *  - cada patrón descubierto aparece exactamente una vez en la política
 *    (un route.ts nuevo — incluso anidado bajo /api/images/** — rompe la
 *    suite hasta ser auditado y clasificado);
 *  - cada entrada de la política corresponde a un route.ts real (una ruta
 *    eliminada deja una clasificación obsoleta y rompe la suite);
 *  - ninguna ruta queda permitida y bloqueada a la vez (estructural: la
 *    política es un Record patrón → clasificación única);
 *  - los patrones catch-all ([...slug]) no tienen soporte: aparecer uno exige
 *    soporte explícito, mientras tanto la validación falla;
 *  - coherencia matcher↔política: la muestra concreta de cada patrón allowed
 *    pasa isInternalApiAllowed y la de cada blocked no.
 * Sin snapshots.
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { INTERNAL_API_POLICY, isInternalApiAllowed, matchesApiPattern } from "@/lib/storefront";

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

/** Ruta concreta de muestra: cada segmento dinámico simple [param] se vuelve "x". */
function samplePath(routePattern: string): string {
  return routePattern.replace(/\[[^\]]+\]/g, "x");
}

const discovered = discoverApiRoutes();
const policyPatterns = Object.keys(INTERNAL_API_POLICY).sort();

describe("inventario de APIs — igualdad exacta repo ↔ política", () => {
  it("existe al menos un endpoint (sanidad del descubrimiento)", () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  it.each(discovered)("%s está clasificado explícitamente en INTERNAL_API_POLICY", (route) => {
    expect(
      policyPatterns.includes(route),
      `Endpoint NUEVO sin clasificar: ${route}. Audítalo y añádelo a INTERNAL_API_POLICY ` +
        `(src/lib/storefront.ts) como "allowed" o "blocked". Mientras tanto el middleware ` +
        `lo bloquea con 404 en modo interno (ningún patrón lo permite).`,
    ).toBe(true);
  });

  it.each(policyPatterns)("%s (política) corresponde a un route.ts real", (pattern) => {
    expect(
      discovered.includes(pattern),
      `Clasificación OBSOLETA: ${pattern} no existe en src/app/api — elimínala de INTERNAL_API_POLICY.`,
    ).toBe(true);
  });

  it("igualdad exacta de conjuntos (sin extras en ningún lado)", () => {
    expect(discovered).toEqual(policyPatterns);
  });

  it("los patrones catch-all no tienen soporte: requieren trabajo explícito", () => {
    for (const pattern of [...policyPatterns, ...discovered]) {
      for (const seg of pattern.split("/")) {
        expect(
          seg.includes("..."),
          `Patrón catch-all sin soporte: ${pattern}. El matcher no lo cubre (fail-closed); ` +
            `añadir soporte explícito y sus pruebas antes de usarlo.`,
        ).toBe(false);
      }
    }
  });
});

describe("coherencia matcher ↔ política", () => {
  it.each(policyPatterns)("la muestra de %s respeta su clasificación", (pattern) => {
    const sample = samplePath(pattern);
    expect(matchesApiPattern(sample, pattern), `la muestra ${sample} debe casar con su patrón`).toBe(true);
    const allowed = isInternalApiAllowed(sample);
    expect(allowed, `muestra ${sample}`).toBe(INTERNAL_API_POLICY[pattern] === "allowed");
  });

  it("los dinámicos exigen exactamente UN segmento no vacío", () => {
    expect(matchesApiPattern("/api/images/abc", "/api/images/[id]")).toBe(true);
    expect(matchesApiPattern("/api/images", "/api/images/[id]")).toBe(false); // falta segmento
    expect(matchesApiPattern("/api/images/abc/extra", "/api/images/[id]")).toBe(false); // sobra
    expect(matchesApiPattern("/api/images/", "/api/images/[id]")).toBe(false); // vacío
    expect(matchesApiPattern("/api/imagesmaliciosa", "/api/images/[id]")).toBe(false);
  });

  it("los estáticos son exactos (sin sufijos ni catch-all implícito)", () => {
    expect(matchesApiPattern("/api/admin/pedidos-nuevos", "/api/admin/pedidos-nuevos")).toBe(true);
    expect(matchesApiPattern("/api/admin/pedidos-nuevos-extra", "/api/admin/pedidos-nuevos")).toBe(false);
    expect(matchesApiPattern("/api/admin/pedidos-nuevos/extra", "/api/admin/pedidos-nuevos")).toBe(false);
  });
});
