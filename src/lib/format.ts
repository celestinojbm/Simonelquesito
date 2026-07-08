/** Utilidades de formato compartidas cliente/servidor (sin dependencias de BD). */

export function formatCop(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Libra colombiana = 500 g. El cliente ve y elige LIBRAS; el sistema guarda
 * gramos (unidad mínima) y precios por kilo, así el inventario no cambia.
 */
export const GRAMS_PER_POUND = 500;

/** Etiqueta de cantidad según unidad de venta. */
export function qtyLabel(qty: number, saleUnit: string): string {
  switch (saleUnit) {
    case "kg":
    case "g": {
      const lb = qty / GRAMS_PER_POUND;
      const label = lb.toLocaleString("es-CO", { maximumFractionDigits: 1 });
      return `${label} ${lb === 1 ? "libra" : "libras"}`;
    }
    case "l":
    case "ml":
      return qty >= 1000 ? `${(qty / 1000).toLocaleString("es-CO")} L` : `${qty} ml`;
    case "pack":
      return `${qty} paq.`;
    default:
      return `${qty} und.`;
  }
}

/** Paso de incremento del selector: 1 libra para peso; 250 ml para volumen. */
export function qtyStep(saleUnit: string): number {
  if (saleUnit === "kg" || saleUnit === "g") return GRAMS_PER_POUND;
  if (saleUnit === "l" || saleUnit === "ml") return 250;
  return 1;
}

export function unitPriceLabel(priceCop: number, saleUnit: string): string {
  switch (saleUnit) {
    case "kg":
    case "g":
      // priceCop se almacena por kilo; se muestra por libra (÷2).
      return `${formatCop(Math.round(priceCop / 2))} / libra`;
    case "l":
    case "ml":
      return `${formatCop(priceCop)} / L`;
    default:
      return formatCop(priceCop);
  }
}
