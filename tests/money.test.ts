import { describe, it, expect } from "vitest";
import { applyBps, weightLineTotal, assertMoney } from "@/lib/money";
import { parseCsv } from "@/modules/pos/csv-adapter";

describe("dinero en enteros COP", () => {
  it("applyBps redondea half-up", () => {
    expect(applyBps(100_000, 1000)).toBe(10_000); // 10%
    expect(applyBps(3_333, 1000)).toBe(333);
    expect(applyBps(3_335, 1000)).toBe(334);
  });

  it("weightLineTotal calcula precio por gramos desde precio por kg", () => {
    expect(weightLineTotal(3_800, 1_000)).toBe(3_800); // 1 kg
    expect(weightLineTotal(3_800, 250)).toBe(950); // 250 g
    expect(weightLineTotal(4_500, 333)).toBe(1_499); // redondeo
  });

  it("assertMoney rechaza floats y negativos", () => {
    expect(() => assertMoney(10.5)).toThrow();
    expect(() => assertMoney(-1)).toThrow();
    expect(() => assertMoney(1000)).not.toThrow();
  });
});

describe("parseCsv", () => {
  it("parsea filas simples y con comillas", () => {
    const rows = parseCsv('sku,nombre,precio\nA1,"Arroz, blanco",4900\nA2,Aceite,12000\n');
    expect(rows).toEqual([
      ["sku", "nombre", "precio"],
      ["A1", "Arroz, blanco", "4900"],
      ["A2", "Aceite", "12000"],
    ]);
  });

  it("ignora filas vacías y soporta CRLF", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n\r\n");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });
});
