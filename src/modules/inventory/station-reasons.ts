/**
 * Catálogo PURO de motivos de la estación (sin BD): compartido por el servicio
 * (mapeo a tipo de movimiento) y por la UI cliente (opciones del selector). Las
 * VENTAS no están aquí a propósito — se registran desde Caja.
 */

export type StationMovementType =
  | "purchase_receipt"
  | "return_in"
  | "adjustment"
  | "shrinkage"
  | "return_out";

export type ReasonMeta = {
  direction: "in" | "out";
  type: StationMovementType;
  label: string;
  /** Salidas sensibles exigen confirmación visual adicional. */
  requiresConfirm?: boolean;
};

export const STATION_REASONS: Readonly<Record<string, ReasonMeta>> = {
  // ENTRADAS
  recepcion: { direction: "in", type: "purchase_receipt", label: "Recepción de mercancía" },
  devolucion_cliente: { direction: "in", type: "return_in", label: "Devolución de cliente" },
  correccion_positiva: { direction: "in", type: "adjustment", label: "Corrección positiva" },
  // SALIDAS
  merma: { direction: "out", type: "shrinkage", label: "Merma", requiresConfirm: true },
  danado: { direction: "out", type: "shrinkage", label: "Producto dañado", requiresConfirm: true },
  vencido: { direction: "out", type: "shrinkage", label: "Producto vencido", requiresConfirm: true },
  consumo_interno: { direction: "out", type: "adjustment", label: "Consumo interno" },
  muestra: { direction: "out", type: "adjustment", label: "Muestra" },
  devolucion_proveedor: { direction: "out", type: "return_out", label: "Devolución a proveedor", requiresConfirm: true },
  correccion_negativa: { direction: "out", type: "adjustment", label: "Corrección negativa", requiresConfirm: true },
};

/** Opciones de motivo (código + etiqueta) para una dirección dada. */
export function reasonsForDirection(direction: "in" | "out"): Array<{ code: string; label: string }> {
  return Object.entries(STATION_REASONS)
    .filter(([, m]) => m.direction === direction)
    .map(([code, m]) => ({ code, label: m.label }));
}

/** ¿Este motivo (salida sensible) exige confirmación visual adicional? */
export function reasonRequiresConfirm(reasonCode: string): boolean {
  return !!STATION_REASONS[reasonCode]?.requiresConfirm;
}
