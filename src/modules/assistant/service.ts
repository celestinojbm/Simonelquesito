import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, waConversations, waMessages } from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { recordMarketingConsent } from "@/modules/accounts/consent";
import { getMessagingProvider } from "@/modules/messaging/service";
import { runAssistantTurn, assistantConfigured, type ChatTurn } from "./brain";

/**
 * Orquestación de conversaciones de WhatsApp:
 * - registra entrantes/salientes en wa_messages (con dedupe por wamid),
 * - decide si responde el bot (modo "bot") o una persona (modo "human"),
 * - envía la respuesta por el MessagingProvider configurado.
 *
 * El simulador del panel usa exactamente este mismo flujo (sin enviar por la
 * API de Meta), así el propietario prueba el bot antes de tramitar la cuenta.
 */

const HISTORY_LIMIT = 24;

const FALLBACK_NO_AI =
  "¡Hola! Gracias por escribir a Market Castilla 🍊. En un momento una persona del equipo te atiende por este mismo chat.";

// Palabras clave de baja/alta de marketing (mensaje COMPLETO, para no
// dispararse en medio de una conversación). Se evitan los términos sueltos
// ambiguos del rubro ("baja"/"alta" solos = calidad baja/alta, o cancelar una
// canasta): solo "STOP" (universal) y frases explícitas cuentan. "no" a secas
// nunca cuenta.
const OPTOUT_RE =
  /^(stop|dar de baja|baja( de)? (ofertas|promociones|publicidad|marketing|la lista)|cancelar (ofertas|promociones|publicidad|suscripci[oó]n)|no m[aá]s (ofertas|promociones|publicidad|mensajes)|no quiero (ofertas|promociones|publicidad|mensajes)|no me (manden|env[ií]en|escriban)( m[aá]s)?( ofertas| promociones| publicidad| mensajes| nada)?)$/;
const OPTIN_RE =
  /^(alta( de)? (ofertas|promociones|marketing)|quiero (recibir )?(ofertas|promociones)|s[ií],? quiero (ofertas|promociones)|suscribir(me)?( a (ofertas|promociones))?)$/;

/** Detecta si el mensaje completo es una baja ("out") o alta ("in") de marketing. */
export function marketingKeyword(body: string): "in" | "out" | null {
  const norm = body
    .trim()
    .toLowerCase()
    .replace(/^[¡¿]+/g, "")
    .replace(/[.!¡¿?]+$/g, "")
    .replace(/\s+/g, " ");
  if (OPTOUT_RE.test(norm)) return "out";
  if (OPTIN_RE.test(norm)) return "in";
  return null;
}

export async function getOrCreateConversation(phone: string, profileName?: string | null) {
  const normalized = phone.replace(/[^0-9]/g, "");
  const existing = await db.query.waConversations.findFirst({
    where: eq(waConversations.phone, normalized),
  });
  if (existing) {
    if (profileName && profileName !== existing.profileName) {
      await db
        .update(waConversations)
        .set({ profileName })
        .where(eq(waConversations.id, existing.id));
    }
    return existing;
  }
  const conversationId = id("wac");
  await db.insert(waConversations).values({
    id: conversationId,
    phone: normalized,
    profileName: profileName ?? null,
  });
  return (await db.query.waConversations.findFirst({
    where: eq(waConversations.id, conversationId),
  }))!;
}

export async function setConversationMode(conversationId: string, mode: "bot" | "human") {
  await db.update(waConversations).set({ mode }).where(eq(waConversations.id, conversationId));
}

export async function listConversations() {
  return db.query.waConversations.findMany({
    orderBy: desc(waConversations.lastMessageAt),
    limit: 50,
  });
}

export async function listMessages(conversationId: string, limit = HISTORY_LIMIT) {
  const rows = await db.query.waMessages.findMany({
    where: eq(waMessages.conversationId, conversationId),
    orderBy: desc(waMessages.createdAt),
    limit,
  });
  return rows.reverse();
}

async function recordMessage(params: {
  conversationId: string;
  direction: "in" | "out";
  body: string;
  waMessageId?: string | null;
  meta?: Record<string, unknown>;
}) {
  await db.insert(waMessages).values({
    id: id("wam"),
    conversationId: params.conversationId,
    direction: params.direction,
    body: params.body,
    waMessageId: params.waMessageId ?? null,
    meta: params.meta ?? null,
  });
  await db
    .update(waConversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(waConversations.id, params.conversationId));
}

/**
 * Respuesta manual de una persona del equipo desde el panel: se registra en
 * el hilo y se envía por el proveedor configurado. Es la vía de atención
 * humana cuando el número esté migrado a la Cloud API (sin app en el celular).
 */
export async function sendManualReply(conversationId: string, body: string, authorLabel: string) {
  const conversation = await db.query.waConversations.findFirst({
    where: eq(waConversations.id, conversationId),
  });
  if (!conversation) throw new Error("Conversación no encontrada");
  await recordMessage({
    conversationId,
    direction: "out",
    body,
    meta: { manual: true, by: authorLabel },
  });
  const provider = getMessagingProvider();
  const sent = await provider.send({
    to: conversation.phone,
    template: "manual_reply",
    body,
  });
  return { delivery: sent.status };
}

export type VoiceTurnResult = {
  reply: string;
  /** true → la llamada debe transferirse a una persona (Dial al negocio). */
  transfer: boolean;
};

/**
 * Un turno de LLAMADA: registra lo dicho por el cliente, corre el mismo
 * cerebro en modo voz y devuelve el texto a locutar. La conversación es la
 * misma que la de WhatsApp (por teléfono), así el contexto se comparte.
 */
export async function handleVoiceTurn(params: {
  phone: string;
  speech: string;
}): Promise<VoiceTurnResult> {
  const conversation = await getOrCreateConversation(params.phone);
  await recordMessage({
    conversationId: conversation.id,
    direction: "in",
    body: params.speech,
    meta: { via: "voice" },
  });

  const transferReply =
    "Con gusto te comunico con una persona del equipo. Un momento por favor.";

  if (conversation.mode !== "bot" || !assistantConfigured()) {
    await recordMessage({
      conversationId: conversation.id,
      direction: "out",
      body: transferReply,
      meta: { via: "voice", fallback: conversation.mode !== "bot" ? "human_mode" : "no_api_key" },
    });
    if (conversation.mode === "bot") await setConversationMode(conversation.id, "human");
    return { reply: transferReply, transfer: true };
  }

  const history = await listMessages(conversation.id);
  const turns: ChatTurn[] = history.map((m) => ({
    role: m.direction === "in" ? "user" : "assistant",
    content: m.body,
  }));

  const brain = await runAssistantTurn({
    history: turns,
    conversationId: conversation.id,
    phone: conversation.phone,
    mode: "voice",
  });

  if (!brain) {
    await recordMessage({
      conversationId: conversation.id,
      direction: "out",
      body: transferReply,
      meta: { via: "voice", fallback: "brain_error" },
    });
    await setConversationMode(conversation.id, "human");
    return { reply: transferReply, transfer: true };
  }

  await recordMessage({
    conversationId: conversation.id,
    direction: "out",
    body: brain.text,
    meta: { via: "voice", toolsUsed: brain.toolsUsed },
  });
  return { reply: brain.text, transfer: brain.handedToHuman };
}

export type IncomingResult =
  | { handled: true; reply: string | null; mode: "bot" | "human" }
  | { handled: false; reason: "duplicate" | "empty" };

/**
 * Procesa un mensaje entrante (del webhook o del simulador) y, si el bot está
 * a cargo, genera y registra la respuesta. `deliver: true` la envía además por
 * el MessagingProvider (WhatsApp real); el simulador usa `deliver: false`.
 */
export async function handleIncomingMessage(params: {
  phone: string;
  profileName?: string | null;
  body: string;
  waMessageId?: string | null;
  deliver: boolean;
}): Promise<IncomingResult> {
  const body = params.body.trim();
  if (!body) return { handled: false, reason: "empty" };

  // Dedupe: Meta reintenta webhooks; el wamid es único.
  if (params.waMessageId) {
    const dup = await db.query.waMessages.findFirst({
      where: eq(waMessages.waMessageId, params.waMessageId),
    });
    if (dup) return { handled: false, reason: "duplicate" };
  }

  const conversation = await getOrCreateConversation(params.phone, params.profileName);
  await recordMessage({
    conversationId: conversation.id,
    direction: "in",
    body,
    waMessageId: params.waMessageId,
  });

  // Baja/alta de marketing por palabra clave (STOP / BAJA / ALTA…). Se atiende
  // SIEMPRE, aun en modo humano: la ley de habeas data exige un opt-out fácil.
  // Se ancla el consentimiento a la ficha del cliente (por los últimos 10
  // dígitos del teléfono); si no tiene ficha, igual confirmamos con cortesía.
  const kw = marketingKeyword(body);
  if (kw) {
    const last10 = conversation.phone.replace(/[^0-9]/g, "").slice(-10);
    const customer =
      last10.length === 10
        ? await db.query.customers.findFirst({
            where: sql`right(regexp_replace(${customers.phone}, '[^0-9]', '', 'g'), 10) = ${last10}`,
          })
        : null;
    if (customer) {
      await recordMarketingConsent(db, {
        customerId: customer.id,
        granted: kw === "in",
        source: "whatsapp",
        detail: { via: "keyword", message: body },
      });
    }
    // Se audita SIEMPRE (haya ficha o no): queda evidencia de la solicitud.
    // Si no hay ficha, se ancla al teléfono; el consent se registrará cuando
    // el cliente tenga cuenta.
    await recordAudit(db, {
      action: kw === "in" ? "consent.marketing_granted" : "consent.marketing_revoked",
      entityType: customer ? "customer" : "phone",
      entityId: customer?.id ?? conversation.phone,
      actorLabel: `customer:whatsapp:${conversation.phone}`,
      after: { kind: "marketing_whatsapp", granted: kw === "in", source: "whatsapp", matched: !!customer },
    });
    const reply =
      kw === "out"
        ? 'Listo ✅ No volverás a recibir ofertas ni promociones nuestras por WhatsApp. Si algún día quieres reactivarlas, escribe "QUIERO OFERTAS" o hazlo en Mi cuenta. Seguimos atentos para tus pedidos 🛒'
        : '¡Genial! 🎉 Volverás a recibir nuestras ofertas por WhatsApp. Escribe "STOP" cuando quieras dejar de recibirlas.';
    await recordMessage({
      conversationId: conversation.id,
      direction: "out",
      body: reply,
      meta: { marketingConsent: kw, matched: !!customer },
    });
    if (params.deliver) {
      const provider = getMessagingProvider();
      await provider.send({ to: conversation.phone, template: "marketing_consent", body: reply });
    }
    return { handled: true, reply, mode: conversation.mode === "bot" ? "bot" : "human" };
  }

  // En modo humano el bot no interviene: el mensaje queda registrado para el panel.
  if (conversation.mode !== "bot") {
    return { handled: true, reply: null, mode: "human" };
  }

  let replyText: string;
  let meta: Record<string, unknown> = {};
  let finalMode: "bot" | "human" = "bot";

  if (!assistantConfigured()) {
    // Sin IA configurada: respuesta honesta y transferencia a una persona.
    replyText = FALLBACK_NO_AI;
    meta = { fallback: "no_api_key" };
    finalMode = "human";
    await setConversationMode(conversation.id, "human");
  } else {
    const history = await listMessages(conversation.id);
    const turns: ChatTurn[] = history.map((m) => ({
      role: m.direction === "in" ? "user" : "assistant",
      content: m.body,
    }));

    const brain = await runAssistantTurn({
      history: turns,
      conversationId: conversation.id,
      phone: conversation.phone,
    });

    if (!brain) {
      replyText = FALLBACK_NO_AI;
      meta = { fallback: "brain_error" };
      finalMode = "human";
      await setConversationMode(conversation.id, "human");
    } else {
      replyText = brain.text;
      meta = { toolsUsed: brain.toolsUsed };
      if (brain.handedToHuman) finalMode = "human";
    }
  }

  await recordMessage({
    conversationId: conversation.id,
    direction: "out",
    body: replyText,
    meta,
  });

  if (params.deliver) {
    const provider = getMessagingProvider();
    await provider.send({ to: conversation.phone, template: "assistant_reply", body: replyText });
  }

  return { handled: true, reply: replyText, mode: finalMode };
}
