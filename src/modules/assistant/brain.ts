import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "@/modules/config/service";
import { todayWindowsLabel } from "@/modules/config/schedule";
import { formatCop } from "@/lib/money";
import { ASSISTANT_TOOLS, runAssistantTool } from "./tools";

/**
 * Cerebro del asistente de pedidos: Claude con herramientas que llaman al
 * núcleo real de la tienda. El mismo cerebro atiende el webhook de WhatsApp
 * y el simulador del panel; más adelante también alimentará el bot de voz.
 *
 * Sin ANTHROPIC_API_KEY el asistente no responde con IA: devuelve null y el
 * llamador transfiere la conversación a una persona (nunca deja al cliente
 * sin respuesta ni finge ser humano).
 */

const MODEL = "claude-opus-4-8";
const MAX_TOOL_ROUNDS = 8;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type BrainReply = {
  text: string;
  handedToHuman: boolean;
  toolsUsed: string[];
};

export type AssistantMode = "chat" | "voice";

async function buildSystemPrompt(mode: AssistantMode): Promise<string> {
  const now = new Date();
  const [contact, deliveryHours, freeFrom, branding] = await Promise.all([
    getSetting("business.contact"),
    getSetting("hours.delivery"),
    getSetting("delivery.freeFromCop"),
    getSetting("branding"),
  ]);
  const hoursLabel = todayWindowsLabel(deliveryHours, now);
  const channelIntro =
    mode === "voice"
      ? `Atiendes LLAMADAS TELEFÓNICAS en español colombiano. Tu texto se convierte a VOZ, así que: frases cortas y claras, NADA de emojis, negritas, listas ni enlaces (nunca leas una URL en voz alta — si creas un pedido, di que el enlace del mapa le llega por WhatsApp). Di los precios de forma natural ("veintidós mil pesos"). Confirma repitiendo el pedido en voz alta antes de crearlo. Si el cliente no se entiende bien, pídele que repita con amabilidad.`
      : `Atiendes por WhatsApp en español colombiano, con calidez y frases cortas (es un chat, no un correo).`;
  return `Eres el asistente de pedidos de ${branding.name}, un ${branding.businessType} de barrio (${contact.address}). ${channelIntro}

DATOS DEL NEGOCIO
- Horario de domicilios hoy: ${hoursLabel}.
- Envío gratis desde ${freeFrom !== null ? formatCop(freeFrom) : "PENDIENTE"} en productos.
- Frutas y verduras se venden POR LIBRA (mínimo 1 libra). El total de esos productos es estimado: se ajusta con el peso real al alistar.
- Pago: efectivo, datáfono, transferencia, Nequi o Daviplata, contra entrega.

REGLAS INQUEBRANTABLES
1. NUNCA inventes productos, precios ni disponibilidad: usa siempre buscar_productos y responde solo con lo que devuelva.
2. Antes de crear_pedido confirma con el cliente el resumen completo: productos con cantidades, total aproximado, dirección + barrio (o recogida), nombre y método de pago. Solo llama a crear_pedido tras un "sí" explícito.
3. Productos +18 (licor, cigarrillos): solo se venden a mayores de edad, dentro del horario permitido, y en la entrega se verifica el documento. Pide fecha de nacimiento y aceptación de esas condiciones antes de incluirlos.
4. Si el cliente pide hablar con una persona, hay un reclamo, o algo se sale de tus herramientas, usa pasar_a_humano. Nunca dejes al cliente atrapado.
5. No pidas datos que no necesitas. No hables de temas ajenos a la tienda: redirige con amabilidad.
6. Nunca prometas tiempos de entrega exactos: da el rango de la zona.
7. Si el pedido queda creado, repite SIEMPRE el número de pedido (ej. MC-1023) y el total.

Identifícate como el asistente virtual de la tienda si te preguntan; no finjas ser una persona.`;
}

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export function assistantConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Corre un turno del asistente: recibe el historial (el último turno es el
 * mensaje entrante del cliente) y devuelve la respuesta final tras ejecutar
 * las herramientas que Claude decida usar.
 */
export async function runAssistantTurn(params: {
  history: ChatTurn[];
  conversationId: string;
  phone: string;
  mode?: AssistantMode;
}): Promise<BrainReply | null> {
  const client = getClient();
  if (!client) return null;

  const system = await buildSystemPrompt(params.mode ?? "chat");

  // El API exige turnos alternados empezando por "user": fusiona consecutivos.
  const merged: ChatTurn[] = [];
  for (const turn of params.history) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.content += `\n${turn.content}`;
    else merged.push({ ...turn });
  }
  while (merged.length > 0 && merged[0]!.role !== "user") merged.shift();
  if (merged.length === 0) return null;

  const messages: Anthropic.MessageParam[] = merged.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  const toolsUsed: string[] = [];
  let handedToHuman = false;

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        thinking: { type: "adaptive" },
        system,
        tools: ASSISTANT_TOOLS as Anthropic.Tool[],
        messages,
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return {
          text: text || "Disculpa, no logré procesar tu mensaje. ¿Puedes repetirlo?",
          handedToHuman,
          toolsUsed,
        };
      }

      // Ejecuta las herramientas y devuelve los resultados en el mismo turno.
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        toolsUsed.push(use.name);
        const outcome = await runAssistantTool(use.name, use.input as Record<string, unknown>, {
          conversationId: params.conversationId,
          phone: params.phone,
        });
        if (outcome.handedToHuman) handedToHuman = true;
        results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.result });
      }
      messages.push({ role: "user", content: results });
    }

    // Se agotaron las rondas de herramientas: cierre seguro.
    return {
      text: "Se me complicó completar esa solicitud. Ya le paso tu chat a una persona del equipo para que te ayude. 🙏",
      handedToHuman,
      toolsUsed,
    };
  } catch (e) {
    console.error("[assistant] Error llamando a Claude", e);
    return null;
  }
}
