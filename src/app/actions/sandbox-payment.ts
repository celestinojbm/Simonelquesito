"use server";

import { headers } from "next/headers";
import { id } from "@/lib/ids";
import { signSandboxPayload } from "@/modules/payments/sandbox";

/**
 * Simula la decisión de la pasarela sandbox: construye el webhook, lo firma
 * con el secreto compartido y lo envía a NUESTRO endpoint público, exactamente
 * como lo haría el servidor de Wompi/Mercado Pago.
 */
export async function simulateGatewayDecision(
  providerRef: string,
  decision: "approved" | "rejected",
): Promise<{ ok: boolean; message?: string }> {
  const payload = JSON.stringify({
    event_id: id("evt"),
    provider_ref: providerRef,
    status: decision,
  });
  const signature = signSandboxPayload(payload);

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";

  const res = await fetch(`${proto}://${host}/api/webhooks/payments/sandbox`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sandbox-signature": signature },
    body: payload,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, message: body.error ?? `Webhook falló (${res.status})` };
  }
  return { ok: true };
}
