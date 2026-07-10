import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isProductionRuntime,
  isDemoEnabled,
  isDemoSeedAllowed,
  assertDemoSeedAllowed,
  isDemoEmail,
  isLoginBlocked,
} from "@/lib/auth/demo";
import { resolveOwnerEmail, resolveOwnerName, validateOwnerPassword, resolveOwnerInput } from "@/db/create-owner";

// Fixtures SINTÉTICAS (no son contraseñas reales) para las reglas de validación.
const OK_PW = "Zt7#qwerbnmk"; // ≥12, min/may/díg/símbolo, no demo, no correo, no nombre

/**
 * Pruebas del guard P0. No tocan la base de datos: verifican el comportamiento
 * en modo producción vs. desarrollo controlando las variables de entorno con
 * `vi.stubEnv` (se restauran en afterEach). NO contienen contraseñas reales.
 */

afterEach(() => vi.unstubAllEnvs());

/** Fija un escenario de entorno para cada caso (undefined = variable ausente). */
function setEnv(env: { NODE_ENV?: string; VERCEL?: string; VERCEL_ENV?: string; DEMO_MODE?: string }) {
  vi.stubEnv("NODE_ENV", env.NODE_ENV);
  vi.stubEnv("VERCEL", env.VERCEL);
  vi.stubEnv("VERCEL_ENV", env.VERCEL_ENV);
  vi.stubEnv("DEMO_MODE", env.DEMO_MODE);
}

describe("isProductionRuntime", () => {
  it("es true con NODE_ENV=production", () => {
    setEnv({ NODE_ENV: "production" });
    expect(isProductionRuntime()).toBe(true);
  });
  it("es true con VERCEL_ENV=production", () => {
    setEnv({ NODE_ENV: "development", VERCEL_ENV: "production" });
    expect(isProductionRuntime()).toBe(true);
  });
  it("es true en cualquier runtime de Vercel (VERCEL=1, incluido preview)", () => {
    setEnv({ NODE_ENV: "development", VERCEL: "1", VERCEL_ENV: "preview" });
    expect(isProductionRuntime()).toBe(true);
  });
  it("es false en desarrollo/test", () => {
    setEnv({ NODE_ENV: "test" });
    expect(isProductionRuntime()).toBe(false);
  });
});

describe("isDemoEnabled / isDemoSeedAllowed (fail-closed)", () => {
  it("está APAGADO en producción aunque DEMO_MODE=true", () => {
    setEnv({ NODE_ENV: "production", DEMO_MODE: "true" });
    expect(isDemoEnabled()).toBe(false);
    expect(isDemoSeedAllowed()).toBe(false);
  });
  it("está APAGADO en Vercel aunque DEMO_MODE=true", () => {
    setEnv({ NODE_ENV: "development", VERCEL: "1", DEMO_MODE: "true" });
    expect(isDemoEnabled()).toBe(false);
  });
  it("está APAGADO por defecto en desarrollo (sin DEMO_MODE)", () => {
    setEnv({ NODE_ENV: "development" });
    expect(isDemoEnabled()).toBe(false);
    expect(isDemoSeedAllowed()).toBe(false);
  });
  it("solo se ENCIENDE con opt-in explícito fuera de producción", () => {
    setEnv({ NODE_ENV: "development", DEMO_MODE: "true" });
    expect(isDemoEnabled()).toBe(true);
    expect(isDemoSeedAllowed()).toBe(true);
  });
  it("DEMO_MODE con cualquier otro valor no lo activa", () => {
    setEnv({ NODE_ENV: "development", DEMO_MODE: "1" });
    expect(isDemoEnabled()).toBe(false);
  });
});

describe("assertDemoSeedAllowed (seed destructivo)", () => {
  it("LANZA en producción (NODE_ENV=production) aunque DEMO_MODE=true", () => {
    setEnv({ NODE_ENV: "production", DEMO_MODE: "true" });
    expect(() => assertDemoSeedAllowed()).toThrow(/DESHABILITADO/);
  });
  it("LANZA con VERCEL_ENV=production", () => {
    setEnv({ NODE_ENV: "development", VERCEL_ENV: "production", DEMO_MODE: "true" });
    expect(() => assertDemoSeedAllowed()).toThrow(/producción/i);
  });
  it("LANZA fuera de producción si falta DEMO_MODE=true", () => {
    setEnv({ NODE_ENV: "development" });
    expect(() => assertDemoSeedAllowed()).toThrow(/DEMO_MODE=true/);
  });
  it("NO lanza en desarrollo con DEMO_MODE=true", () => {
    setEnv({ NODE_ENV: "development", DEMO_MODE: "true" });
    expect(() => assertDemoSeedAllowed()).not.toThrow();
  });
});

describe("isDemoEmail (dominio EXACTO @marketcastilla.demo)", () => {
  it("reconoce el dominio demo exacto (normaliza mayúsculas/espacios)", () => {
    expect(isDemoEmail("owner@marketcastilla.demo")).toBe(true);
    expect(isDemoEmail("  CAJERO@MarketCastilla.Demo  ")).toBe(true);
  });
  it("no cae en coincidencias parciales / ataques de dominio", () => {
    expect(isDemoEmail("usuario@marketcastilla.demo.atacante.com")).toBe(false);
    expect(isDemoEmail("marketcastilla.demo@otrodominio.com")).toBe(false);
    expect(isDemoEmail("usuario@notmarketcastilla.demo")).toBe(false);
    expect(isDemoEmail("usuario@x.demo")).toBe(false);
    expect(isDemoEmail("sin-arroba")).toBe(false);
    expect(isDemoEmail("termina-en-arroba@")).toBe(false);
  });
  it("no marca correos reales", () => {
    expect(isDemoEmail("celestinojbm@gmail.com")).toBe(false);
    expect(isDemoEmail("dueno@simonelquesito.co")).toBe(false);
  });
});

describe("isLoginBlocked (bloqueo backend)", () => {
  it("BLOQUEA cuentas demo en producción", () => {
    setEnv({ NODE_ENV: "production" });
    expect(isLoginBlocked("owner@marketcastilla.demo")).toBe(true);
    expect(isLoginBlocked("admin@marketcastilla.demo")).toBe(true);
  });
  it("NO bloquea al propietario real en producción", () => {
    setEnv({ NODE_ENV: "production" });
    expect(isLoginBlocked("dueno@simonelquesito.co")).toBe(false);
    expect(isLoginBlocked("celestinojbm@gmail.com")).toBe(false);
  });
  it("BLOQUEA cuentas demo en desarrollo si el modo demo NO está activo", () => {
    setEnv({ NODE_ENV: "development" });
    expect(isLoginBlocked("owner@marketcastilla.demo")).toBe(true);
  });
  it("permite cuentas demo en desarrollo con modo demo activo", () => {
    setEnv({ NODE_ENV: "development", DEMO_MODE: "true" });
    expect(isLoginBlocked("owner@marketcastilla.demo")).toBe(false);
  });
});

describe("resolveOwnerEmail (propietario real)", () => {
  it("acepta y normaliza un correo real", () => {
    expect(resolveOwnerEmail({ OWNER_EMAIL: "Dueno@SimonElQuesito.CO" })).toBe("dueno@simonelquesito.co");
  });
  it("rechaza un correo demo", () => {
    expect(() => resolveOwnerEmail({ OWNER_EMAIL: "owner@marketcastilla.demo" })).toThrow(/demo/i);
  });
  it("rechaza correo faltante o con formato inválido", () => {
    expect(() => resolveOwnerEmail({})).toThrow(/OWNER_EMAIL/);
    expect(() => resolveOwnerEmail({ OWNER_EMAIL: "sin-arroba" })).toThrow(/formato/i);
    expect(() => resolveOwnerEmail({ OWNER_EMAIL: "a@b" })).toThrow(/formato/i);
  });
});

describe("resolveOwnerName (nombre real, requerido)", () => {
  it("normaliza y acepta un nombre válido", () => {
    expect(resolveOwnerName({ OWNER_FULL_NAME: "  Ana Pérez  " })).toBe("Ana Pérez");
  });
  it("rechaza vacío o demasiado corto/largo", () => {
    expect(() => resolveOwnerName({})).toThrow(/OWNER_FULL_NAME/);
    expect(() => resolveOwnerName({ OWNER_FULL_NAME: "A" })).toThrow(/OWNER_FULL_NAME/);
    expect(() => resolveOwnerName({ OWNER_FULL_NAME: "x".repeat(121) })).toThrow(/OWNER_FULL_NAME/);
  });
});

describe("validateOwnerPassword (sin contraseñas reales)", () => {
  const ctx = { email: "dueno@simonelquesito.co", fullName: "Ana Pérez" };
  it("rechaza vacía o corta", () => {
    expect(() => validateOwnerPassword("", ctx)).toThrow(/12 caracteres/);
    expect(() => validateOwnerPassword("Ab1!", ctx)).toThrow(/12 caracteres/);
  });
  it("rechaza si falta una clase (min/may/díg/símbolo)", () => {
    expect(() => validateOwnerPassword("abcdefghijkl", ctx)).toThrow(/minúscula/i);
    expect(() => validateOwnerPassword("Abcdefghijkl", ctx)).toThrow(/símbolo|dígito/i);
    expect(() => validateOwnerPassword("Abcdefghij12", ctx)).toThrow(/símbolo/i);
  });
  it("rechaza demo1234, contener el correo o ser igual al nombre", () => {
    expect(() => validateOwnerPassword("demo1234", ctx)).toThrow(/12 caracteres|demo/i);
    expect(() => validateOwnerPassword("A1!dueno@simonelquesito.co", ctx)).toThrow(/correo/i);
    expect(() => validateOwnerPassword("ana pérez", ctx)).toThrow(/12 caracteres|nombre/i);
  });
  it("acepta una contraseña que cumple la regla", () => {
    expect(() => validateOwnerPassword(OK_PW, ctx)).not.toThrow();
  });
});

describe("resolveOwnerInput (aborta antes de tocar la BD; no lee stdin)", () => {
  it("aborta si falta OWNER_PASSWORD, sin leer stdin", () => {
    expect(() =>
      resolveOwnerInput({ OWNER_EMAIL: "dueno@simonelquesito.co", OWNER_FULL_NAME: "Ana Pérez" }),
    ).toThrow(/OWNER_PASSWORD/);
  });
  it("aborta con contraseña débil (antes de la BD)", () => {
    expect(() =>
      resolveOwnerInput({ OWNER_EMAIL: "dueno@simonelquesito.co", OWNER_FULL_NAME: "Ana Pérez", OWNER_PASSWORD: "corta" }),
    ).toThrow(/OWNER_PASSWORD/);
  });
  it("rechaza correo demo antes que nada", () => {
    expect(() =>
      resolveOwnerInput({ OWNER_EMAIL: "owner@marketcastilla.demo", OWNER_FULL_NAME: "Ana Pérez", OWNER_PASSWORD: OK_PW }),
    ).toThrow(/demo/i);
  });
  it("devuelve la entrada válida y normalizada", () => {
    expect(
      resolveOwnerInput({ OWNER_EMAIL: "Dueno@SimonElQuesito.CO", OWNER_FULL_NAME: "  Ana Pérez  ", OWNER_PASSWORD: OK_PW }),
    ).toEqual({ email: "dueno@simonelquesito.co", fullName: "Ana Pérez", password: OK_PW });
  });
});
