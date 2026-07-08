import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { waConversations } from "@/db/schema";
import { listMessages } from "@/modules/assistant/service";
import { toggleConversationMode } from "@/app/actions/whatsapp";
import { ReplyBox } from "./reply-box";
import { BackLink } from "@/components/admin/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conversación · Bot WhatsApp · Admin" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversation = await db.query.waConversations.findFirst({
    where: eq(waConversations.id, id),
  });
  if (!conversation) notFound();

  const messages = await listMessages(conversation.id, 200);
  const deliveryReal = process.env.MESSAGING_PROVIDER === "whatsapp_cloud";

  return (
    <div className="max-w-2xl">
      <BackLink href="/admin/whatsapp" label="Bot WhatsApp" />
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">
            {conversation.profileName ?? conversation.phone}
          </h1>
          <p className="text-xs text-ink-soft">{conversation.phone}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await toggleConversationMode(
              conversation.id,
              conversation.mode === "bot" ? "human" : "bot",
            );
          }}
        >
          <button
            type="submit"
            className={`btn rounded-full px-4 py-1.5 text-sm font-bold ${
              conversation.mode === "bot" ? "bg-brand-soft text-brand-dark" : "bg-sun text-ink"
            }`}
          >
            {conversation.mode === "bot" ? "🤖 Atiende el bot" : "🙋 Atiende una persona"}
          </button>
        </form>
      </div>

      <div className="space-y-2 rounded-card bg-[#efe7dd] p-4">
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-soft">Sin mensajes todavía.</p>
        )}
        {messages.map((m) => {
          const manual = (m.meta as { manual?: boolean } | null)?.manual === true;
          return (
            <div key={m.id} className={m.direction === "in" ? "mr-auto max-w-[85%]" : "ml-auto max-w-[85%]"}>
              <div
                className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.direction === "in" ? "rounded-bl-sm bg-white" : "rounded-br-sm bg-[#d9fdd3]"
                }`}
              >
                {m.body}
              </div>
              <p className={`mt-0.5 text-[10px] text-ink-soft ${m.direction === "in" ? "" : "text-right"}`}>
                {m.direction === "in" ? "cliente" : manual ? "equipo" : "bot"} ·{" "}
                {m.createdAt.toLocaleString("es-CO", { timeZone: "America/Bogota" })}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        <ReplyBox conversationId={conversation.id} />
        {!deliveryReal && (
          <p className="mt-2 text-xs text-ink-soft">
            ℹ️ El proveedor actual es simulado: la respuesta queda registrada aquí pero no viaja a
            WhatsApp. Con <code>MESSAGING_PROVIDER=whatsapp_cloud</code> se envía de verdad.
          </p>
        )}
      </div>
    </div>
  );
}
