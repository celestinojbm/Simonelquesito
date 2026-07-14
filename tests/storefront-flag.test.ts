/**
 * Flag del storefront (modo interno) — FAIL-CLOSED.
 * Habilitado SOLO con STOREFRONT_ENABLED === "true"; cualquier otro caso apaga.
 */
import { describe, expect, it } from "vitest";
import { isStorefrontEnabled } from "@/lib/storefront";

describe("isStorefrontEnabled — fail-closed", () => {
  it("habilita SOLO con la cadena exacta 'true'", () => {
    expect(isStorefrontEnabled({ STOREFRONT_ENABLED: "true" })).toBe(true);
  });
  it("variable ausente ⇒ deshabilitado", () => {
    expect(isStorefrontEnabled({})).toBe(false);
  });
  it("vacío ⇒ deshabilitado", () => {
    expect(isStorefrontEnabled({ STOREFRONT_ENABLED: "" })).toBe(false);
  });
  it("'false' ⇒ deshabilitado", () => {
    expect(isStorefrontEnabled({ STOREFRONT_ENABLED: "false" })).toBe(false);
  });
  it("cualquier otro valor ⇒ deshabilitado", () => {
    for (const v of ["TRUE", "True", "1", "yes", "on", " true ", "enabled", "0"]) {
      expect(isStorefrontEnabled({ STOREFRONT_ENABLED: v }), `valor ${JSON.stringify(v)}`).toBe(false);
    }
  });
});
