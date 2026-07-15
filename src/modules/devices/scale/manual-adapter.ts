/**
 * Adaptador MANUAL de balanza: el peso lo escribe el operador. Está siempre
 * "conectado" (no depende de hardware) y es la fuente primaria y segura mientras
 * la lectura automática física no esté certificada. Nunca inventa pesos.
 */
import type { ScaleAdapter, ScaleReading, ScaleStatus } from "./types";
import { finalizeGrams } from "./weight";

export class ManualScaleAdapter implements ScaleAdapter {
  readonly source = "manual" as const;
  private listeners = new Set<(r: ScaleReading) => void>();

  getStatus(): ScaleStatus {
    return "connected";
  }

  async connect(): Promise<void> {
    /* Nada que abrir: el modo manual siempre está disponible. */
  }

  async disconnect(): Promise<void> {
    this.listeners.clear();
  }

  subscribe(listener: (r: ScaleReading) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Publica un peso escrito por el operador (ya validado como gramos enteros).
   * Devuelve la lectura publicada, o null si el peso no es válido (no publica).
   * @param at ISO-8601 del momento de captura (inyectable para pruebas).
   */
  push(grams: number, at: string): ScaleReading | null {
    const check = finalizeGrams(grams);
    if (!check.ok) return null;
    const reading: ScaleReading = {
      grams: check.grams,
      stable: true, // el peso manual es estable por definición
      source: "manual",
      capturedAt: at,
      deviceLabel: "Manual",
    };
    for (const l of this.listeners) l(reading);
    return reading;
  }
}
