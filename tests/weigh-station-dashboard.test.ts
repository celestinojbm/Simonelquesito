/**
 * Ubicación de la estación en el Dashboard y reglas de la UI (guardas de fuente,
 * dado que el entorno de test es node y no renderiza componentes React):
 *  - la estación aparece ANTES de DashboardTabs y de PanelBlocks;
 *  - el modo manual está disponible y la balanza USB NO se afirma conectada;
 *  - "Venta" dirige a Caja (y no hay motivo de venta que cree movimiento);
 *  - el simulador está oculto por defecto (compuerta explícita).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STATION_REASONS, reasonsForDirection } from "@/modules/inventory/station-reasons";
import { isSimulatedScaleEnabled } from "@/modules/devices/scale/simulated-adapter";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("ubicación en el Dashboard", () => {
  const page = read("src/app/admin/page.tsx");
  it("la estación se monta antes de DashboardTabs y de PanelBlocks", () => {
    const station = page.indexOf("<WeighStation");
    const tabs = page.indexOf("<DashboardTabs");
    const blocks = page.indexOf("<PanelBlocks");
    expect(station).toBeGreaterThan(-1);
    expect(tabs).toBeGreaterThan(-1);
    expect(blocks).toBeGreaterThan(-1);
    expect(station).toBeLessThan(tabs);
    expect(station).toBeLessThan(blocks);
  });
});

describe("reglas de la UI de la estación", () => {
  const ui = read("src/app/admin/weigh-station/weigh-station.tsx");
  it("ofrece modo Manual y NO afirma FALSAMENTE que la Marker-30 esté lista", () => {
    expect(ui).toContain("Manual");
    // No debe haber una afirmación POSITIVA de conexión/certificación de la Marker-30.
    expect(ui).not.toMatch(/Marker-30 (ya |sí )?(está|queda) (conectada|certificada|lista)/i);
    // Sí debe estar el encuadre honesto de "pendiente".
    expect(ui.toLowerCase()).toMatch(/pendiente de (certificación|prueba)/);
  });
  it("#1 la balanza USB es solo diagnóstico: no usa useScaleWeight en el flujo operativo", () => {
    expect(ui).not.toContain("useScaleWeight");
    expect(ui).toContain("Conexión USB pendiente de certificación");
    // El tipo de fuente operativa de la UI es solo manual/simulated.
    expect(ui).toContain('type WeightSource = "manual" | "simulated"');
  });
  it("dirige las ventas a Caja", () => {
    expect(ui).toContain("Las ventas se registran desde Caja");
    expect(ui).toContain("/admin/caja");
  });
  it("el simulador se muestra solo si está habilitado explícitamente", () => {
    expect(ui).toContain("isSimulatedScaleEnabled");
  });
  it("#9 el proveedor es una referencia libre, no un supplierId", () => {
    expect(ui).toContain("supplierReference");
    expect(ui).not.toContain("supplierId");
  });
});

describe("motivos de la estación", () => {
  it("NO existe un motivo de venta (las ventas van por Caja)", () => {
    const codes = Object.keys(STATION_REASONS);
    expect(codes).not.toContain("venta");
    expect(codes).not.toContain("sale");
    // El tipo de movimiento de la estación nunca es "sale" (garantía de tipo).
    const types = Object.values(STATION_REASONS).map((m) => m.type as string);
    expect(types).not.toContain("sale");
  });
  it("las entradas y salidas tienen sus motivos correctos", () => {
    const inCodes = reasonsForDirection("in").map((r) => r.code);
    const outCodes = reasonsForDirection("out").map((r) => r.code);
    expect(inCodes).toContain("recepcion");
    expect(inCodes).toContain("devolucion_cliente");
    expect(outCodes).toContain("merma");
    expect(outCodes).toContain("devolucion_proveedor");
    // ningún motivo cruza de dirección
    expect(inCodes.every((c) => STATION_REASONS[c]!.direction === "in")).toBe(true);
    expect(outCodes.every((c) => STATION_REASONS[c]!.direction === "out")).toBe(true);
  });
  it("el simulador está deshabilitado en producción por defecto", () => {
    expect(isSimulatedScaleEnabled({})).toBe(false);
  });
});
