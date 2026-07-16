/**
 * Contratos de la abstracción de BALANZA, independientes de la interfaz.
 *
 * Separación intencional (spec de la estación): UI ↔ parser ↔ transporte ↔
 * fuente del peso ↔ registro de inventario son capas distintas. Un `ScaleAdapter`
 * representa una FUENTE de peso; el registro de inventario NO depende de qué
 * adaptador produjo el gramaje.
 *
 * Estado de la integración física: la lectura automática real de la BBG
 * Marker-30 NO está certificada. Los adaptadores `web_serial`/`web_usb`/
 * `local_bridge` son contratos PREPARADOS (detección de capacidades + interfaz),
 * no una afirmación de que el dispositivo ya transmite peso.
 */

export type ScaleSource =
  | "manual"
  | "simulated"
  | "web_serial"
  | "web_usb"
  | "local_bridge";

export type ScaleStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected"
  | "reading"
  | "error";

export type ScaleReading = {
  /** Peso en GRAMOS enteros (unidad mínima del sistema). */
  grams: number;
  /** ¿La lectura está estable (no fluctuando)? */
  stable: boolean;
  source: ScaleSource;
  /** ISO-8601. */
  capturedAt: string;
  /** Trama cruda del dispositivo, si aplica (diagnóstico). */
  raw?: string;
  /** Etiqueta legible del dispositivo/fuente. */
  deviceLabel?: string;
};

export interface ScaleAdapter {
  readonly source: ScaleSource;
  getStatus(): ScaleStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Suscribe lecturas; devuelve una función para cancelar la suscripción. */
  subscribe(listener: (reading: ScaleReading) => void): () => void;
}

/** Etiquetas legibles por fuente (para historial y UI). */
export const SCALE_SOURCE_LABELS: Readonly<Record<ScaleSource, string>> = {
  manual: "Manual",
  simulated: "Simulador de desarrollo",
  web_serial: "USB Serial",
  web_usb: "WebUSB",
  local_bridge: "Bridge local",
};

/** Nombre legible de una fuente; cae a la clave cruda si es desconocida. */
export function scaleSourceLabel(source: string): string {
  return (SCALE_SOURCE_LABELS as Record<string, string>)[source] ?? source;
}
