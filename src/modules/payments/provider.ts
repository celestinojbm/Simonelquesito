/**
 * Capa PaymentProvider intercambiable.
 *
 * Implementaciones previstas:
 * - SandboxProvider (demo, incluida): simula la pasarela con webhooks firmados.
 * - WompiProvider / MercadoPagoProvider (fase 2): mismos contratos.
 * - Métodos offline (efectivo/datáfono/transferencia): se registran como
 *   pagos "pending" que confirma el personal al recibir.
 *
 * Regla de oro: el estado de un pago SOLO cambia por confirmación del
 * servidor (webhook verificado o acción de un rol autorizado), nunca por
 * lo que diga el navegador del cliente.
 */

export type CreatePaymentIntent = {
  orderId: string;
  amountCop: number;
  method: string;
  idempotencyKey: string;
  customerPhone: string;
};

export type PaymentIntentResult = {
  providerRef: string;
  /** URL a la que se envía al cliente (checkout de la pasarela). */
  redirectUrl: string | null;
};

export interface PaymentProvider {
  readonly name: string;
  createIntent(input: CreatePaymentIntent): Promise<PaymentIntentResult>;
  /** Verifica la firma de un webhook entrante. */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  /** Extrae del payload el evento normalizado. */
  parseWebhook(rawBody: string): {
    externalEventId: string;
    providerRef: string;
    status: "approved" | "rejected" | "expired";
  };
}
