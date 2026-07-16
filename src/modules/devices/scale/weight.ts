/**
 * Helpers PUROS de peso para la estación de balanza. Sin dependencias de BD, red
 * ni React: se usan en la UI (captura manual), en el servicio de inventario
 * (validación) y en las pruebas.
 *
 * Convención del sistema (ver src/db/schema.ts): el peso se almacena SIEMPRE en
 * GRAMOS ENTEROS. Nunca floats. `kg` y `g` comparten la misma unidad mínima
 * (gramos); `saleUnit` solo cambia la etiqueta/base de precio.
 *
 * Parseo de kilogramos — regla NO AMBIGUA y documentada:
 *   - En modo `kg`, tanto la coma como el punto se interpretan como separador
 *     DECIMAL (los usuarios colombianos escriben cualquiera). NO son separador
 *     de miles.
 *   - Ejemplos: "1,250 kg" == "1.250 kg" == 1.250 kg == 1250 g.
 *   - Máximo 3 decimales en kg (1 kg = 1000 g ⇒ 3 decimales = precisión de gramo
 *     exacta). Más de 3 decimales ⇒ RECHAZO (no representable como gramos enteros).
 */

export type WeightParse = { ok: true; grams: number } | { ok: false; error: string };

/** ≤ 40 kg: cota de seguridad (coincide con el lector serial existente). */
export const MAX_WEIGHT_GRAMS = 40_000;

/** Kilogramos: entero + hasta 3 decimales, coma o punto como separador decimal. */
const KG_RE = /^\d+(?:[.,]\d{1,3})?$/;
/** Gramos: entero puro. */
const GRAMS_RE = /^\d+$/;

/** Parsea kilogramos escritos a mano → gramos enteros. */
export function parseKgToGrams(input: string): WeightParse {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Ingresa un peso." };
  if (!KG_RE.test(trimmed)) {
    return { ok: false, error: "Peso en kg inválido (usa hasta 3 decimales, p. ej. 1,250)." };
  }
  const grams = Math.round(Number(trimmed.replace(",", ".")) * 1000);
  return finalizeGrams(grams);
}

/** Parsea gramos escritos a mano → gramos enteros. */
export function parseGramsInput(input: string): WeightParse {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Ingresa un peso." };
  if (!GRAMS_RE.test(trimmed)) return { ok: false, error: "El peso en gramos debe ser un entero." };
  return finalizeGrams(Number(trimmed));
}

/** Parsea un peso escrito a mano según la unidad elegida (`kg` | `g`). */
export function parseWeightToGrams(input: string, unit: "kg" | "g"): WeightParse {
  return unit === "kg" ? parseKgToGrams(input) : parseGramsInput(input);
}

/** Valida un valor ya en gramos (p. ej. venido de la balanza). */
export function finalizeGrams(grams: number): WeightParse {
  if (!Number.isFinite(grams)) return { ok: false, error: "Peso inválido." };
  if (!Number.isInteger(grams)) return { ok: false, error: "El peso debe ser un entero en gramos." };
  if (grams <= 0) return { ok: false, error: "El peso debe ser mayor que cero." };
  if (grams > MAX_WEIGHT_GRAMS) return { ok: false, error: "Peso fuera de rango (máx. 40 kg)." };
  return { ok: true, grams };
}

/** ¿Un número en gramos es válido para registrar? (finito, entero, > 0, ≤ máx). */
export function isValidGrams(grams: number): boolean {
  return finalizeGrams(grams).ok;
}

/** Formatea gramos como kilogramos con coma decimal es-CO (hasta 3 decimales). */
export function formatGramsAsKg(grams: number): string {
  return `${(grams / 1000).toLocaleString("es-CO", { maximumFractionDigits: 3 })} kg`;
}

/** Formatea gramos como "N g". */
export function formatGrams(grams: number): string {
  return `${grams.toLocaleString("es-CO")} g`;
}

/** Etiqueta legible: gramos y su equivalente en kg. */
export function formatWeight(grams: number): string {
  return `${formatGrams(grams)} (${formatGramsAsKg(grams)})`;
}
