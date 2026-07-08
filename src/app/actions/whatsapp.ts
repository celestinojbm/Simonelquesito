"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import {
  handleIncomingMessage,
  sendManualReply,
  setConversationMode,
} from "@/modules/assistant/service";

/**
 * Acciones del panel para el bot de WhatsApp: alternar bot/persona en una
 * conversación y el simulador (mismo cerebro que el webhook, sin enviar nada
 * por la API de Meta — pero los pedidos que arme SÍ se crean de verdad).
 */

export async function toggleConversationMode(
  conversationId: string,
  mode: "bot" | "human",
): Promise<{ ok: boolean }> {
  await requirePermission("orders.manage");
  await setConversationMode(conversationId, mode);
  revalidatePath("/admin/whatsapp");
  return { ok: true };
}

const replySchema = z.object({
  message: z.string().min(1).max(2000),
});

/** Respuesta escrita por una persona del equipo desde el panel. */
export async function replyToConversation(
  conversationId: string,
  message: string,
): Promise<{ ok: true; delivery: string } | { ok: false; message: string }> {
  try {
    const user = await requirePermission("orders.manage");
    const { message: body } = replySchema.parse({ message });
    const { delivery } = await sendManualReply(
      conversationId,
      body,
      `${user.role}:${user.email}`,
    );
    revalidatePath(`/admin/whatsapp/${conversationId}`);
    revalidatePath("/admin/whatsapp");
    return { ok: true, delivery };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

const simulateSchema = z.object({
  message: z.string().min(1).max(1000),
});

export type SimulateResult =
  | { ok: true; reply: string | null; mode: "bot" | "human" }
  | { ok: false; message: string };

/** Número ficticio del simulador: conversación de prueba visible en el panel. */
const SIMULATOR_PHONE = "5730000000000";

export async function simulateAssistantMessage(message: string): Promise<SimulateResult> {
  try {
    const user = await requirePermission("orders.manage");
    const { message: body } = simulateSchema.parse({ message });
    const result = await handleIncomingMessage({
      phone: SIMULATOR_PHONE,
      profileName: `Simulador (${user.email})`,
      body,
      deliver: false,
    });
    revalidatePath("/admin/whatsapp");
    if (!result.handled) return { ok: false, message: "Mensaje vacío o duplicado." };
    return { ok: true, reply: result.reply, mode: result.mode };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

/** Reactiva el bot en la conversación del simulador (tras un pase a humano). */
export async function resetSimulatorConversation(): Promise<{ ok: boolean }> {
  await requirePermission("orders.manage");
  const { getOrCreateConversation } = await import("@/modules/assistant/service");
  const conversation = await getOrCreateConversation(SIMULATOR_PHONE);
  await setConversationMode(conversation.id, "bot");
  revalidatePath("/admin/whatsapp");
  return { ok: true };
}
