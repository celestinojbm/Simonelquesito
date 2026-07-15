/**
 * Punto de entrada de la abstracción de balanza (devices/scale).
 * Reexporta contratos, capacidades y adaptadores. La UI y el servicio importan
 * desde aquí para no acoplarse a los archivos internos.
 */
export type { ScaleAdapter, ScaleReading, ScaleSource, ScaleStatus } from "./types";
export { SCALE_SOURCE_LABELS, scaleSourceLabel } from "./types";
export {
  parseWeightToGrams,
  parseKgToGrams,
  parseGramsInput,
  finalizeGrams,
  isValidGrams,
  formatGrams,
  formatGramsAsKg,
  formatWeight,
  MAX_WEIGHT_GRAMS,
} from "./weight";
export type { WeightParse } from "./weight";
export {
  computeScaleCapabilities,
  detectScaleCapabilities,
  readScaleEnv,
  buildDiagnosticReport,
} from "./capabilities";
export type { ScaleCapabilities, ScaleEnvLike } from "./capabilities";
export { ManualScaleAdapter } from "./manual-adapter";
export { SimulatedScaleAdapter, isSimulatedScaleEnabled } from "./simulated-adapter";
