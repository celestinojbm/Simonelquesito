/**
 * Capa EmailProvider (misma filosofía que MessagingProvider de WhatsApp):
 * - ConsoleEmailProvider (demo): no envía; devuelve "simulated". El código de
 *   verificación queda visible en Admin → Mensajes para poder probar.
 * - ResendEmailProvider (real): usa la API HTTP de Resend cuando existen
 *   EMAIL_PROVIDER=resend, RESEND_API_KEY y EMAIL_FROM. Sin esas variables el
 *   sistema sigue funcionando en modo simulado — nada se rompe.
 *
 * El código de verificación es REAL en ambos casos (hash + expiración +
 * intentos); lo único que cambia es si el correo viaja de verdad.
 */

export interface EmailProvider {
  readonly name: string;
  send(message: { to: string; subject: string; body: string }): Promise<{ status: string }>;
}

class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  async send() {
    return { status: "simulated" };
  }
}

class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  async send(message: { to: string; subject: string; body: string }) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) {
      console.error("[email] Falta RESEND_API_KEY o EMAIL_FROM");
      return { status: "failed" };
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.body,
        }),
      });
      if (!res.ok) {
        console.error("[email] Envío fallido", res.status, await res.text().catch(() => ""));
        return { status: "failed" };
      }
      return { status: "sent" };
    } catch (e) {
      console.error("[email] Error de red al enviar", e);
      return { status: "failed" };
    }
  }
}

export function getEmailProvider(): EmailProvider {
  const name = process.env.EMAIL_PROVIDER ?? "console";
  if (name === "resend") return new ResendEmailProvider();
  return new ConsoleEmailProvider();
}
