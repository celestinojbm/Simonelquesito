/**
 * Interfaz POSProvider — capa de abstracción sobre el POS del negocio.
 *
 * Hoy el POS es Treinta, que NO ofrece API pública. Por eso:
 * - El MVP implementa CsvPosAdapter: importación/exportación por archivos
 *   (Excel exportado desde Treinta → CSV → este sistema, y viceversa).
 * - Si Treinta publica una API oficial, se implementa TreintaApiAdapter
 *   con este mismo contrato SIN reescribir la aplicación.
 * - Cambiar a otro POS = escribir otro adapter.
 *
 * Prohibiciones (ver docs/INTEGRATIONS.md):
 * - No se hace scraping de Treinta ni se automatiza su interfaz privada.
 * - No se guardan credenciales de Treinta en texto plano.
 */

export type PosProductRow = {
  sku: string | null;
  barcode: string | null;
  name: string;
  category: string;
  priceCop: number;
  costCop: number | null;
  stock: number | null;
};

export type ImportResult = {
  imported: number;
  updated: number;
  errors: { row: number; message: string }[];
};

export type SalesExportRow = {
  orderNumber: string;
  createdAt: string;
  channel: string;
  status: string;
  itemsTotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  paymentMethod: string;
};

export interface POSProvider {
  readonly name: string;
  /** Importa catálogo/precios/stock desde el POS (CSV en el MVP). */
  importProducts(source: string): Promise<ImportResult>;
  /** Exporta ventas digitales para registrarlas/conciliarlas en el POS. */
  exportSales(rows: SalesExportRow[]): Promise<string>;
}
