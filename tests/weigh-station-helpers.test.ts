/**
 * Helpers PUROS de la estación de balanza: parseo/validación de peso y cantidad,
 * capacidades del navegador, y compuerta del simulador. Sin BD.
 */
import { describe, it, expect } from "vitest";
import {
  parseWeightToGrams,
  parseKgToGrams,
  parseGramsInput,
  finalizeGrams,
  isValidGrams,
  formatGramsAsKg,
} from "@/modules/devices/scale/weight";
import {
  parseQuantityMinor,
  saleUnitUsesScale,
  minorUnitLabel,
  formatQuantityMinor,
} from "@/modules/inventory/quantity";
import { computeScaleCapabilities, buildDiagnosticReport } from "@/modules/devices/scale/capabilities";
import { isSimulatedScaleEnabled, SimulatedScaleAdapter } from "@/modules/devices/scale/simulated-adapter";
import { ManualScaleAdapter } from "@/modules/devices/scale/manual-adapter";

describe("conversión de peso (kg/g → gramos enteros)", () => {
  it("1 kg → 1000 g", () => {
    expect(parseWeightToGrams("1", "kg")).toEqual({ ok: true, grams: 1000 });
  });
  it("1,25 kg → 1250 g (coma decimal)", () => {
    expect(parseKgToGrams("1,25")).toEqual({ ok: true, grams: 1250 });
  });
  it("1.250 kg → 1250 g (punto = decimal, regla documentada)", () => {
    expect(parseKgToGrams("1.250")).toEqual({ ok: true, grams: 1250 });
  });
  it("1,250 kg → 1250 g", () => {
    expect(parseKgToGrams("1,250")).toEqual({ ok: true, grams: 1250 });
  });
  it("350 g → 350 g", () => {
    expect(parseWeightToGrams("350", "g")).toEqual({ ok: true, grams: 350 });
  });
  it("más de 3 decimales en kg → rechazo", () => {
    expect(parseKgToGrams("1.2345").ok).toBe(false);
  });
  it("cero → rechazo", () => {
    expect(parseKgToGrams("0").ok).toBe(false);
    expect(parseGramsInput("0").ok).toBe(false);
  });
  it("negativo → rechazo", () => {
    expect(parseKgToGrams("-1").ok).toBe(false);
    expect(parseGramsInput("-5").ok).toBe(false);
  });
  it("texto / vacío → rechazo", () => {
    expect(parseKgToGrams("abc").ok).toBe(false);
    expect(parseGramsInput("").ok).toBe(false);
  });
  it("finalizeGrams rechaza NaN, Infinity y no-enteros", () => {
    expect(finalizeGrams(NaN).ok).toBe(false);
    expect(finalizeGrams(Infinity).ok).toBe(false);
    expect(finalizeGrams(12.5).ok).toBe(false);
    expect(isValidGrams(2500)).toBe(true);
    expect(isValidGrams(0)).toBe(false);
  });
  it("fuera de rango (>40 kg) → rechazo", () => {
    expect(parseKgToGrams("41").ok).toBe(false);
  });
  it("formatGramsAsKg usa coma decimal es-CO", () => {
    expect(formatGramsAsKg(1250)).toBe("1,25 kg");
  });
});

describe("cantidad por unidad de venta → minor unit", () => {
  it("kg/g → gramos; unit/pack → unidades; l/ml → ml", () => {
    expect(parseQuantityMinor("1,25", "kg")).toEqual({ ok: true, minor: 1250 });
    expect(parseQuantityMinor("350", "g")).toEqual({ ok: true, minor: 350 });
    expect(parseQuantityMinor("3", "unit")).toEqual({ ok: true, minor: 3 });
    expect(parseQuantityMinor("2", "pack")).toEqual({ ok: true, minor: 2 });
    expect(parseQuantityMinor("1,5", "l")).toEqual({ ok: true, minor: 1500 });
    expect(parseQuantityMinor("500", "ml")).toEqual({ ok: true, minor: 500 });
  });
  it("unit rechaza decimales", () => {
    expect(parseQuantityMinor("2,5", "unit").ok).toBe(false);
  });
  it("saleUnitUsesScale solo para kg/g", () => {
    expect(saleUnitUsesScale("kg")).toBe(true);
    expect(saleUnitUsesScale("g")).toBe(true);
    expect(saleUnitUsesScale("unit")).toBe(false);
    expect(saleUnitUsesScale("l")).toBe(false);
    expect(saleUnitUsesScale("ml")).toBe(false);
  });
  it("minorUnitLabel", () => {
    expect(minorUnitLabel("kg")).toBe("g");
    expect(minorUnitLabel("ml")).toBe("ml");
    expect(minorUnitLabel("unit")).toBe("und");
  });
  it("formatQuantityMinor legible", () => {
    expect(formatQuantityMinor(1250, "kg")).toContain("1,25 kg");
    expect(formatQuantityMinor(3, "unit")).toContain("3 und.");
  });
});

describe("capacidades del navegador y diagnóstico", () => {
  it("Web Serial/USB requieren contexto seguro", () => {
    const caps = computeScaleCapabilities({
      hasSerial: true,
      hasUsb: true,
      secureContext: true,
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120",
    });
    expect(caps.webSerial).toBe(true);
    expect(caps.webUsb).toBe(true);
    expect(caps.approxOs).toBe("Windows");
    expect(caps.approxBrowser).toBe("Chrome");
    expect(caps.manualAvailable).toBe(true);
  });
  it("sin contexto seguro, Web Serial/USB quedan en false aunque existan", () => {
    const caps = computeScaleCapabilities({ hasSerial: true, hasUsb: true, secureContext: false, userAgent: "x" });
    expect(caps.webSerial).toBe(false);
    expect(caps.webUsb).toBe(false);
  });
  it("el reporte es sanitizado y NO afirma lectura física", () => {
    const caps = computeScaleCapabilities({ hasSerial: false, hasUsb: false, secureContext: true, userAgent: "Linux" });
    const report = buildDiagnosticReport(caps, { portSelected: false });
    expect(report).toContain("BBG Marker-30");
    expect(report).toContain("Datos recibidos: pendiente de prueba física");
    expect(report).not.toMatch(/contraseñ|token|password/i);
  });
});

describe("simulador: compuerta explícita y etiqueta", () => {
  it("deshabilitado sin la variable explícita", () => {
    expect(isSimulatedScaleEnabled({})).toBe(false);
    expect(isSimulatedScaleEnabled({ NEXT_PUBLIC_SCALE_SIMULATOR: "false" })).toBe(false);
    expect(isSimulatedScaleEnabled({ NEXT_PUBLIC_SCALE_SIMULATOR: "true" })).toBe(true);
  });
  it("deshabilitado no emite lecturas y reporta unsupported", () => {
    const sim = new SimulatedScaleAdapter(false);
    expect(sim.getStatus()).toBe("unsupported");
    expect(sim.emitNext("2026-01-01T00:00:00.000Z")).toBeNull();
  });
  it("habilitado emite lecturas estables etiquetadas como simulador", () => {
    const sim = new SimulatedScaleAdapter(true);
    const r = sim.emitNext("2026-01-01T00:00:00.000Z");
    expect(r?.source).toBe("simulated");
    expect(r?.stable).toBe(true);
    expect(r?.deviceLabel).toBe("Simulador de desarrollo");
  });
});

describe("adaptador manual", () => {
  it("está conectado y publica pesos válidos; ignora inválidos", () => {
    const m = new ManualScaleAdapter();
    expect(m.getStatus()).toBe("connected");
    const seen: number[] = [];
    m.subscribe((r) => seen.push(r.grams));
    expect(m.push(2500, "2026-01-01T00:00:00.000Z")?.grams).toBe(2500);
    expect(m.push(0, "2026-01-01T00:00:00.000Z")).toBeNull();
    expect(m.push(-1, "2026-01-01T00:00:00.000Z")).toBeNull();
    expect(seen).toEqual([2500]);
  });
});
