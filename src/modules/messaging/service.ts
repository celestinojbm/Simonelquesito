import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { notifications, orders } from "@/db/schema";
import { id } from "@/lib/ids";
import { formatCop } from "@/lib/money";

/**
 * Capa MessagingProvider.
 * - ConsoleMessagingProvider (demo): registra el mensaje en la tabla
 *   notifications con status "simulated" — visible en Admin → Mensajes.
 * - WhatsAppCloudProvider (fase 2): mismo contrato contra la API oficial
 *   de WhatsApp Business (requiere cuenta verificada de Meta; ver docs/INTEGRATIONS.md).
 *
 * Nunca se envían campañas a clientes sin consentimiento registrado
 * (tabla consents, kind "marketing_whatsapp").
 */

export interface MessagingProvider {
  readonly name: string;
  send(message: { to: string; template: string; body: string }): Promise<{ status: string }>;
}

class ConsoleMessagingProvider implements MessagingProvider {
  readonly name = "console";
  async send() {
    return { status: "simulated" };
  }
}

/**
 * WhatsApp Business Cloud API (Meta). Envía mensajes de texto libres —
 * válidos dentro de la ventana de 24 h abierta por el cliente; los mensajes
 * que inicia el negocio fuera de esa ventana requieren plantillas aprobadas.
 * Requiere WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN (ver
 * docs/WHATSAPP_ASSISTANT.md para el trámite en Meta).
 */
class WhatsAppCloudProvider implements MessagingProvider {
  readonly name = "whatsapp_cloud";
  async send(message: { to: string; template: string; body: string }) {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneNumberId || !token) {
      console.error("[whatsapp] Falta WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_ACCESS_TOKEN");
      return { status: "failed" };
    }
    // Normaliza al formato internacional sin "+" que exige la API.
    const to = message.to.replace(/[^0-9]/g, "").replace(/^0+/, "");
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: false, body: message.body },
        }),
      });
      if (!res.ok) {
        console.error("[whatsapp] Envío fallido", res.status, await res.text().catch(() => ""));
        return { status: "failed" };
      }
      return { status: "sent" };
    } catch (e) {
      console.error("[whatsapp] Error de red al enviar", e);
      return { status: "failed" };
    }
  }
}

export function getMessagingProvider(): MessagingProvider {
  const name = process.env.MESSAGING_PROVIDER ?? "console";
  if (name === "console") return new ConsoleMessagingProvider();
  if (name === "whatsapp_cloud") return new WhatsAppCloudProvider();
  throw new Error(`MESSAGING_PROVIDER desconocido: ${name}`);
}

type OrderEvent =
  | "order_created"
  | "payment_confirmed"
  | "preparing"
  | "substitution_request"
  | "weight_adjusted"
  | "ready"
  | "out_for_delivery"
  | "delivered";

function template(event: OrderEvent, o: { number: string; totalCop: number; contactName: string }): string {
  const total = formatCop(o.totalCop);
  switch (event) {
    case "order_created":
      return `¡Hola ${o.contactName}! 🛒 Recibimos tu pedido ${o.number} por ${total}. Te avisaremos cuando el pago esté confirmado.`;
    case "payment_confirmed":
      return `✅ Pago confirmado para tu pedido ${o.number}. Ya lo estamos alistando.`;
    case "preparing":
      return `👩‍🍳 Tu pedido ${o.number} está en preparación.`;
    case "substitution_request":
      return `🔄 Un producto de tu pedido ${o.number} no está disponible. Respóndenos para elegir un reemplazo.`;
    case "weight_adjusted":
      return `⚖️ Ajustamos el peso real de tu pedido ${o.number}. Nuevo total: ${total}.`;
    case "ready":
      return `📦 Tu pedido ${o.number} está listo.`;
    case "out_for_delivery":
      return `🛵 ¡Tu pedido ${o.number} va en camino! Ten a mano el código de confirmación.`;
    case "delivered":
      return `🎉 Pedido ${o.number} entregado. ¡Gracias por tu compra!`;
  }
}

/** Encola/simula el mensaje transaccional de un evento de pedido. */
export async function notifyOrderEvent(tx: DbOrTx, orderId: string, event: OrderEvent): Promise<void> {
  const order = await tx.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return;
  const provider = getMessagingProvider();
  const body = template(event, order);
  const result = await provider.send({ to: order.contactPhone, template: event, body });
  await tx.insert(notifications).values({
    id: id("ntf"),
    channel: "whatsapp",
    recipient: order.contactPhone,
    template: event,
    body,
    status: result.status,
    orderId,
    customerId: order.customerId,
  });
}
