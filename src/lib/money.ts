/**
 * Dinero en COP como enteros. El peso colombiano opera sin centavos
 * en el comercio minorista: la unidad mínima usada es 1 COP.
 */

export function formatCop(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Aplica un porcentaje expresado en basis points (1000 bps = 10%). Redondeo half-up. */
export function applyBps(amountCop: number, bps: number): number {
  return Math.round((amountCop * bps) / 10000);
}

/**
 * Precio de una línea por peso: unitPrice está expresado por kg (o por litro),
 * qty en gramos (o ml). Redondeo half-up al peso entero.
 */
export function weightLineTotal(unitPricePerKgCop: number, qtyGrams: number): number {
  return Math.round((unitPricePerKgCop * qtyGrams) / 1000);
}

export function assertMoney(value: number, label = "monto"): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} inválido: debe ser un entero COP >= 0 (recibido ${value})`);
  }
}
