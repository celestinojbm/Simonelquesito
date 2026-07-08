import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleIncomingMessage } from "@/modules/assistant/service";

/**
 * Webhook de WhatsApp Business Cloud API (Meta).
 *
 * GET  → verificación inicial: Meta manda hub.challenge y hay que devolverlo
 *        si hub.verify_token coincide con WHATSAPP_WEBHOOK_VERIFY_TOKEN.
 * POST → mensajes entrantes, firmados con HMAC-SHA256 del cuerpo crudo
 *        (X-Hub-Signature-256, clave = WHATSAPP_APP_SECRET). Sin firma válida
 *        no se procesa nada.
 *
 * Siempre respondemos 200 rápido a eventos ya verificados: si Meta recibe
 * errores repetidos desactiva el webhook. El dedupe por wamid evita procesar
 * dos veces los reintentos.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Verificación inválida", { status: 403 });
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

type WebhookMessage = {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
};

type WebhookValue = {
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: WebhookMessage[];
};

export async function POST(req: Request) {
  const rawBody = await req.text();

  if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let payload: { entry?: { changes?: { field: string; value: WebhookValue }[] }[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      for (const message of value.messages ?? []) {
        // El MVP del bot atiende texto; otros tipos se registran y pasan a persona.
        const body =
          message.type === "text" && message.text?.body
            ? message.text.body
            : `[mensaje de tipo "${message.type}" no soportado por el bot]`;
        const profileName =
          value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null;
        try {
          await handleIncomingMessage({
            phone: message.from,
            profileName,
            body,
            waMessageId: message.id,
            deliver: true,
          });
        } catch (e) {
          // Nunca romper el 200: Meta reintentaría y duplicaría el procesamiento.
          console.error("[whatsapp webhook] Error procesando mensaje", e);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
