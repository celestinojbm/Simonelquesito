import { NextResponse } from "next/server";
import { isSandboxWebhookConfigured, SandboxPaymentProvider } from "@/modules/payments/sandbox";
import { processPaymentWebhook } from "@/modules/payments/service";

/**
 * Webhook de la pasarela sandbox.
 * Igual que un webhook real: firma HMAC verificada sobre el cuerpo crudo,
 * dedupe por event_id, y confirmación SOLO del lado del servidor.
 * Sin PAYMENT_WEBHOOK_SECRET configurado responde 503 (apagado, fail-closed)
 * ANTES de leer el cuerpo o tocar pagos/pedidos — no existe secreto por defecto.
 */
export async function POST(request: Request) {
  if (!isSandboxWebhookConfigured()) {
    return NextResponse.json({ error: "La pasarela sandbox no está configurada" }, { status: 503 });
  }

  const provider = new SandboxPaymentProvider();
  const rawBody = await request.text();
  const signature = request.headers.get("x-sandbox-signature");

  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let event;
  try {
    event = provider.parseWebhook(rawBody);
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const result = await processPaymentWebhook({
    provider: provider.name,
    externalEventId: event.externalEventId,
    providerRef: event.providerRef,
    status: event.status,
    rawPayload: JSON.parse(rawBody),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 422 });
  }
  return NextResponse.json({ received: true, duplicate: result.duplicate ?? false });
}
