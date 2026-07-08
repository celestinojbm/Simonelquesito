import { createHmac, timingSafeEqual } from "node:crypto";
import { handleVoiceTurn } from "@/modules/assistant/service";
import { getSetting } from "@/modules/config/service";

/**
 * Webhook de llamadas (Twilio Programmable Voice).
 *
 * Flujo: el número del bot recibe la llamada → Twilio hace POST aquí →
 * respondemos TwiML: saludo + <Gather input="speech"> (voz→texto en español).
 * Cada frase del cliente vuelve como SpeechResult, la procesa el MISMO
 * cerebro del bot de WhatsApp (modo voz) y la respuesta se locuta con <Say>.
 * Si el bot decide pasar a humano (o falla), la llamada se TRANSFIERE con
 * <Dial> al teléfono del negocio — el cliente nunca queda atrapado.
 *
 * Seguridad: se valida X-Twilio-Signature (HMAC-SHA1 de URL + parámetros,
 * clave TWILIO_AUTH_TOKEN). Sin el token configurado, el webhook responde 503.
 */

export const dynamic = "force-dynamic";

const VOICE = `voice="Polly.Lupe-Neural" language="es-US"`;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function twiml(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

/** Firma de Twilio: base64(HMAC-SHA1(token, url + claves ordenadas + valores)). */
function verifyTwilioSignature(url: string, params: URLSearchParams, header: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !header) return false;
  const sorted = [...params.keys()].sort();
  let payload = url;
  for (const key of sorted) payload += key + (params.get(key) ?? "");
  const expected = createHmac("sha1", token).update(payload, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

function gather(sayText: string): string {
  return (
    `<Gather input="speech" language="es-CO" speechTimeout="auto" action="/api/webhooks/voice" method="POST">` +
    `<Say ${VOICE}>${xmlEscape(sayText)}</Say>` +
    `</Gather>` +
    // Si el cliente no dice nada, se le insiste una vez y se re-escucha.
    `<Say ${VOICE}>¿Sigues ahí? Si necesitas algo más, dímelo.</Say>` +
    `<Redirect method="POST">/api/webhooks/voice</Redirect>`
  );
}

async function transferTwiml(sayText: string): Promise<string> {
  const contact = await getSetting("business.contact");
  const forward = (process.env.VOICE_FORWARD_PHONE ?? contact.phone).replace(/[^0-9+]/g, "");
  const e164 = forward.startsWith("+") ? forward : `+57${forward.replace(/^57/, "")}`;
  return (
    `<Say ${VOICE}>${xmlEscape(sayText)}</Say>` +
    `<Dial>${xmlEscape(e164)}</Dial>` +
    `<Say ${VOICE}>No fue posible comunicarte en este momento. Escríbenos por WhatsApp y te atendemos. Hasta pronto.</Say>`
  );
}

export async function POST(req: Request) {
  if (!process.env.TWILIO_AUTH_TOKEN) {
    return new Response("Bot de voz no configurado (falta TWILIO_AUTH_TOKEN)", { status: 503 });
  }

  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);

  // Twilio firma la URL pública exacta configurada en la consola.
  const url = new URL(req.url);
  const publicUrl = `https://${req.headers.get("host") ?? url.host}${url.pathname}${url.search}`;
  if (!verifyTwilioSignature(publicUrl, params, req.headers.get("x-twilio-signature"))) {
    return new Response("Firma inválida", { status: 401 });
  }

  const from = (params.get("From") ?? "").replace(/[^0-9]/g, "");
  const speech = (params.get("SpeechResult") ?? "").trim();

  if (!from) return twiml(`<Say ${VOICE}>No pudimos identificar la llamada. Hasta pronto.</Say><Hangup/>`);

  // Primera vuelta (sin voz aún): saludo y a escuchar.
  if (!speech) {
    const branding = await getSetting("branding");
    return twiml(
      gather(
        `¡Hola! Te comunicas con ${branding.name}. Soy el asistente virtual: puedo tomar tu pedido a domicilio o darte información. ¿En qué te ayudo?`,
      ),
    );
  }

  try {
    const result = await handleVoiceTurn({ phone: from, speech });
    if (result.transfer) return twiml(await transferTwiml(result.reply));
    return twiml(gather(result.reply));
  } catch (e) {
    console.error("[voice webhook] Error", e);
    return twiml(
      await transferTwiml("Tuve un inconveniente técnico. Te comunico con una persona del equipo."),
    );
  }
}
