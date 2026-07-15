/**
 * Adaptador SIMULADO de balanza — SOLO para desarrollo, pruebas y revisión
 * visual local. Nunca debe presentarse como una balanza real y NO debe usarse
 * en producción para generar pesos.
 *
 * Habilitación: requiere la variable de entorno EXPLÍCITA y NO SECRETA
 * `NEXT_PUBLIC_SCALE_SIMULATOR="true"`. Sin ella queda deshabilitado (el caso por
 * defecto en producción). La etiqueta visible es siempre "Simulador de desarrollo".
 */
import type { ScaleAdapter, ScaleReading, ScaleStatus } from "./types";
import { finalizeGrams } from "./weight";

/**
 * ¿El simulador está habilitado? Opt-in EXPLÍCITO por variable no secreta y
 * NUNCA en producción. Sirve tanto para la UI (mostrar/ocultar) como para el
 * guard del servidor (rechazar `source: "simulated"` no autorizado).
 */
export function isSimulatedScaleEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NEXT_PUBLIC_SCALE_SIMULATOR === "true" && env.NODE_ENV !== "production";
}

/** Secuencia determinista de pesos de muestra (gramos), para no usar aleatoriedad. */
const SAMPLE_GRAMS = [250, 500, 1000, 1250, 2500, 350, 12480, 750];

export class SimulatedScaleAdapter implements ScaleAdapter {
  readonly source = "simulated" as const;
  private listeners = new Set<(r: ScaleReading) => void>();
  private status: ScaleStatus = "disconnected";
  private i = 0;

  constructor(private readonly enabled: boolean = isSimulatedScaleEnabled()) {}

  getStatus(): ScaleStatus {
    return this.enabled ? this.status : "unsupported";
  }

  async connect(): Promise<void> {
    if (!this.enabled) {
      this.status = "unsupported";
      return;
    }
    this.status = "connected";
  }

  async disconnect(): Promise<void> {
    this.status = "disconnected";
    this.listeners.clear();
  }

  subscribe(listener: (r: ScaleReading) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Emite la siguiente lectura simulada de la secuencia determinista. */
  emitNext(at: string): ScaleReading | null {
    if (!this.enabled) return null;
    const grams = SAMPLE_GRAMS[this.i % SAMPLE_GRAMS.length]!;
    this.i += 1;
    const check = finalizeGrams(grams);
    if (!check.ok) return null;
    const reading: ScaleReading = {
      grams: check.grams,
      stable: true,
      source: "simulated",
      capturedAt: at,
      deviceLabel: "Simulador de desarrollo",
    };
    this.status = "reading";
    for (const l of this.listeners) l(reading);
    return reading;
  }
}
