/**
 * El login (y las páginas legales) quedaron FUERA del shell público `(store)`:
 * viven en el grupo `(auth)` con un layout mínimo que NO monta chrome comercial.
 * Prueba estructural (no frágil, sin snapshots): verifica ubicación de archivos y
 * ausencia de componentes comerciales en el layout de autenticación.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const p = (rel: string) => path.join(root, rel);
const read = (rel: string) => readFileSync(p(rel), "utf8");

const COMMERCIAL_COMPONENTS = ["Header", "BottomNav", "WhatsAppFab", "SearchBar", "CartButton"];

describe("separación de /login del shell (store)", () => {
  it("login y legales se movieron a (auth) y ya no están en (store)", () => {
    for (const f of [
      "src/app/(auth)/login/page.tsx",
      "src/app/(auth)/login/login-form.tsx",
      "src/app/(auth)/layout.tsx",
      "src/app/(auth)/privacidad/page.tsx",
      "src/app/(auth)/terminos/page.tsx",
    ]) {
      expect(existsSync(p(f)), `debe existir ${f}`).toBe(true);
    }
    for (const f of [
      "src/app/(store)/login/page.tsx",
      "src/app/(store)/privacidad/page.tsx",
      "src/app/(store)/terminos/page.tsx",
    ]) {
      expect(existsSync(p(f)), `NO debe existir ${f}`).toBe(false);
    }
  });

  it("el layout (auth) NO monta ningún componente del chrome comercial", () => {
    const layout = read("src/app/(auth)/layout.tsx");
    for (const c of COMMERCIAL_COMPONENTS) {
      expect(layout.includes(c), `(auth)/layout no debe usar ${c}`).toBe(false);
    }
  });

  it("el layout (store) SÍ monta el chrome comercial (guardia de no-regresión)", () => {
    const layout = read("src/app/(store)/layout.tsx");
    for (const c of ["Header", "BottomNav", "WhatsAppFab"]) {
      expect(layout.includes(c), `(store)/layout debe seguir usando ${c}`).toBe(true);
    }
  });

  it("el login preserva LoginForm, el gateo demo y force-dynamic (P0 intacto)", () => {
    const page = read("src/app/(auth)/login/page.tsx");
    expect(page).toContain("LoginForm");
    expect(page).toContain("isDemoEnabled");
    expect(page).toContain('dynamic = "force-dynamic"');
  });
});
