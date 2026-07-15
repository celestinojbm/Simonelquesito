/**
 * Cantidad de la estación por unidad de venta (`saleUnit`) → "minor unit" entera
 * del ledger de inventario (`inventory_movements.qty`). PURO, sin BD.
 *
 * Convención (ver src/db/schema.ts):
 *   - `unit` / `pack` / `lb` → UNIDADES enteras.
 *   - `kg` / `g`            → GRAMOS enteros (misma unidad mínima).
 *   - `l` / `ml`            → MILILITROS enteros.
 *
 * La balanza SOLO aplica a peso (`kg`/`g`). Para `unit`/`pack` se captura una
 * cantidad entera; para `l`/`ml` una cantidad manual (no se presenta como peso
 * capturado por balanza).
 */
import { parseWeightToGrams, type WeightParse } from "@/modules/devices/scale/weight";

export type SaleUnit = "unit" | "pack" | "kg" | "g" | "l" | "ml" | "lb";

export type QuantityParse = { ok: true; minor: number } | { ok: false; error: string };

/** ¿Esta unidad de venta se captura con la balanza? (solo peso: kg/g). */
export function saleUnitUsesScale(saleUnit: string): boolean {
  return saleUnit === "kg" || saleUnit === "g";
}

/** Etiqueta de la unidad mínima del ledger para esta unidad de venta. */
export function minorUnitLabel(saleUnit: string): "g" | "ml" | "und" {
  if (saleUnit === "kg" || saleUnit === "g") return "g";
  if (saleUnit === "l" || saleUnit === "ml") return "ml";
  return "und";
}

/** Litros/mililitros: entero + hasta 3 decimales para litros (coma o punto). */
const DECIMAL_RE = /^\d+(?:[.,]\d{1,3})?$/;
const INTEGER_RE = /^\d+$/;

function finalizeMinor(minor: number, noun: string): QuantityParse {
  if (!Number.isFinite(minor) || !Number.isInteger(minor)) {
    return { ok: false, error: `Cantidad inválida (${noun} enteros).` };
  }
  if (minor <= 0) return { ok: false, error: "La cantidad debe ser mayor que cero." };
  return { ok: true, minor };
}

/**
 * Parsea una cantidad escrita según `saleUnit` → minor unit entera.
 * Para kg/g delega en los helpers de peso; para l/ml acepta decimales (litros
 * ×1000 → ml); para unit/pack/lb exige un entero de unidades.
 */
export function parseQuantityMinor(input: string, saleUnit: string): QuantityParse {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Ingresa una cantidad." };

  if (saleUnit === "kg" || saleUnit === "g") {
    const w: WeightParse = parseWeightToGrams(trimmed, saleUnit);
    return w.ok ? { ok: true, minor: w.grams } : w;
  }

  if (saleUnit === "l" || saleUnit === "ml") {
    if (saleUnit === "l") {
      if (!DECIMAL_RE.test(trimmed)) return { ok: false, error: "Volumen en litros inválido (hasta 3 decimales)." };
      return finalizeMinor(Math.round(Number(trimmed.replace(",", ".")) * 1000), "ml");
    }
    if (!INTEGER_RE.test(trimmed)) return { ok: false, error: "El volumen en ml debe ser un entero." };
    return finalizeMinor(Number(trimmed), "ml");
  }

  // unit | pack | lb → unidades enteras.
  if (!INTEGER_RE.test(trimmed)) return { ok: false, error: "La cantidad debe ser un número entero de unidades." };
  return finalizeMinor(Number(trimmed), "unidades");
}

/** Formatea una cantidad minor según la unidad de venta, legible es-CO. */
export function formatQuantityMinor(minor: number, saleUnit: string): string {
  if (saleUnit === "kg" || saleUnit === "g") {
    const kg = (minor / 1000).toLocaleString("es-CO", { maximumFractionDigits: 3 });
    return `${minor.toLocaleString("es-CO")} g (${kg} kg)`;
  }
  if (saleUnit === "l" || saleUnit === "ml") {
    const l = (minor / 1000).toLocaleString("es-CO", { maximumFractionDigits: 3 });
    return `${minor.toLocaleString("es-CO")} ml (${l} L)`;
  }
  return `${minor.toLocaleString("es-CO")} und.`;
}
