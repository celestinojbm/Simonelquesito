import { createHmac, timingSafeEqual } from "node:crypto";
import { id } from "@/lib/ids";
import { MercadoPagoProvider } from "./mercadopago";
import type { PaymentProvider, CreatePaymentIntent, PaymentIntentResult } from "./provider";

/**
 * Proveedor sandbox para el demo: no mueve dinero.
 * El "checkout de la pasarela" es una pantalla local (/pago-sandbox/[ref])
 * donde se elige aprobar o rechazar; esa pantalla dispara un webhook firmado
 * contra nuestro propio endpoint, igual que haría Wompi/Mercado Pago.
 */

/**
 * El secreto del webhook sandbox es OBLIGATORIO: sin `PAYMENT_WEBHOOK_SECRET`
 * (ausente o vacío) la pasarela sandbox queda deshabilitada fail-closed.
 * NUNCA hay secreto predeterminado — un fallback hardcodeado en un repo
 * público permitiría a cualquiera firmar webhooks válidos. El mensaje de
 * error nunca incluye el valor del secreto.
 */
export function isSandboxWebhookConfigured(): boolean {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  return typeof secret === "string" && secret.trim() !== "";
}

function webhookSecret(): string {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error(
      "PAYMENT_WEBHOOK_SECRET no está configurado: la pasarela sandbox está deshabilitada (fail-closed).",
    );
  }
  return secret;
}

export function signSandboxPayload(rawBody: string): string {
  return createHmac("sha256", webhookSecret()).update(rawBody).digest("hex");
}

export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = "sandbox";

  async createIntent(_input: CreatePaymentIntent): Promise<PaymentIntentResult> {
    const providerRef = id("sbx");
    return {
      providerRef,
      redirectUrl: `/pago-sandbox/${providerRef}`,
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    // Fail-closed: sin secreto configurado NINGUNA firma es válida.
    if (!isSandboxWebhookConfigured()) return false;
    if (!signature) return false;
    const expected = signSandboxPayload(rawBody);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(rawBody: string) {
    const payload = JSON.parse(rawBody) as {
      event_id: string;
      provider_ref: string;
      status: "approved" | "rejected" | "expired";
    };
    if (!payload.event_id || !payload.provider_ref || !payload.status) {
      throw new Error("Webhook sandbox con payload incompleto");
    }
    return {
      externalEventId: payload.event_id,
      providerRef: payload.provider_ref,
      status: payload.status,
    };
  }
}

export function getPaymentProvider(): PaymentProvider {
  const name = process.env.PAYMENT_PROVIDER ?? "sandbox";
  switch (name) {
    case "sandbox":
      return new SandboxPaymentProvider();
    case "mercado_pago":
      return new MercadoPagoProvider();
    // case "wompi": return new WompiProvider();        // adapter previsto
    default:
      throw new Error(`PAYMENT_PROVIDER desconocido: ${name}`);
  }
}
