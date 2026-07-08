/**
 * Interfaz MarketplaceProvider — Rappi, DiDi y futuros marketplaces.
 *
 * IMPORTANTE: no existe todavía acceso oficial verificado a las APIs de
 * Rappi/DiDi para este negocio. Por política del proyecto NO se implementa
 * una integración falsa ni se automatizan interfaces privadas.
 *
 * Estado actual (MVP):
 * - ManualMarketplaceAdapter: los pedidos de marketplace se registran a mano
 *   (o por importación CSV) con canal "rappi"/"didi", id externo y comisión.
 *   El dedupe usa la clave única (channel, marketplace_order_id).
 * - Cuando el negocio obtenga acceso oficial (ver docs/INTEGRATIONS.md con
 *   requisitos de credenciales y aprobación), se implementa RappiApiAdapter
 *   con este mismo contrato, empezando por su sandbox.
 */

export type MarketplaceOrder = {
  externalOrderId: string;
  channel: "rappi" | "didi";
  items: { externalProductId: string; qty: number; unitPriceCop: number }[];
  customerName: string;
  customerPhone: string;
  addressLine: string;
  commissionCop: number;
};

export interface MarketplaceProvider {
  readonly name: string;
  /** Recibe/importa pedidos nuevos del marketplace. */
  pullOrders(): Promise<MarketplaceOrder[]>;
  /** Publica disponibilidad de productos mapeados. */
  pushAvailability(updates: { externalProductId: string; available: boolean }[]): Promise<void>;
}

export class ManualMarketplaceAdapter implements MarketplaceProvider {
  readonly name = "manual";
  async pullOrders(): Promise<MarketplaceOrder[]> {
    // Flujo operativo manual: los pedidos se registran desde el panel admin.
    return [];
  }
  async pushAvailability(): Promise<void> {
    // Sin API oficial no hay publicación automática; se gestiona en la app del marketplace.
  }
}
