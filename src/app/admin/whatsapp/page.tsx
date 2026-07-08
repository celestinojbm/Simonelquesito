import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { waConversations, waMessages } from "@/db/schema";
import { assistantConfigured } from "@/modules/assistant/brain";
import { toggleConversationMode } from "@/app/actions/whatsapp";
import { AssistantSimulator } from "./simulator";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bot WhatsApp · Admin" };

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-brand" : "bg-coral"}`} />
      <span className="text-ink">{label}</span>
      <span className="ml-auto text-xs font-semibold text-ink-soft">{ok ? "Listo" : "Pendiente"}</span>
    </li>
  );
}

export default async function AdminWhatsAppPage() {
  const conversations = await db.query.waConversations.findMany({
    orderBy: desc(waConversations.lastMessageAt),
    limit: 30,
  });

  const lastMessages = new Map<string, string>();
  for (const c of conversations) {
    const last = await db.query.waMessages.findFirst({
      where: eq(waMessages.conversationId, c.id),
      orderBy: desc(waMessages.createdAt),
    });
    if (last) lastMessages.set(c.id, `${last.direction === "in" ? "→" : "←"} ${last.body}`);
  }

  const env = {
    ai: assistantConfigured(),
    phoneId: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    token: !!process.env.WHATSAPP_ACCESS_TOKEN,
    verify: !!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: !!process.env.WHATSAPP_APP_SECRET,
    provider: process.env.MESSAGING_PROVIDER === "whatsapp_cloud",
  };
  const metaReady = env.phoneId && env.token && env.verify && env.appSecret && env.provider;

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-extrabold text-ink">Bot de WhatsApp</h1>
      <p className="mb-5 text-sm text-ink-soft">
        Asistente con IA que atiende el chat del negocio: busca productos, arma el pedido en el
        sistema y pasa a una persona cuando hace falta. Pruébalo con el simulador sin necesidad de
        tener la cuenta de Meta activa.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <section className="rounded-card border border-brand-soft bg-white p-4">
            <h2 className="mb-3 font-bold text-ink">Estado de la integración</h2>
            <ul className="space-y-2">
              <StatusDot ok={env.ai} label="Motor de IA (ANTHROPIC_API_KEY)" />
              <StatusDot ok={env.phoneId} label="Número en Cloud API (WHATSAPP_PHONE_NUMBER_ID)" />
              <StatusDot ok={env.token} label="Token de acceso (WHATSAPP_ACCESS_TOKEN)" />
              <StatusDot ok={env.verify} label="Token de verificación del webhook" />
              <StatusDot ok={env.appSecret} label="Firma del webhook (WHATSAPP_APP_SECRET)" />
              <StatusDot ok={env.provider} label='Proveedor activo (MESSAGING_PROVIDER="whatsapp_cloud")' />
            </ul>
            <p className="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand-dark">
              {metaReady
                ? "✅ Integración con Meta configurada: el webhook /api/webhooks/whatsapp está atendiendo."
                : "El simulador funciona desde ya. Para conectar el número real hay que completar el trámite en Meta — checklist en docs/WHATSAPP_ASSISTANT.md."}
            </p>
          </section>

          <section className="rounded-card border border-brand-soft bg-white p-4">
            <h2 className="mb-3 font-bold text-ink">Conversaciones</h2>
            {conversations.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-soft">
                Aún no hay conversaciones. Prueba el simulador →
              </p>
            ) : (
              <ul className="divide-y divide-brand-soft">
                {conversations.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2.5">
                    <Link href={`/admin/whatsapp/${c.id}`} className="min-w-0 flex-1 hover:opacity-80">
                      <p className="truncate text-sm font-semibold text-ink">
                        {c.profileName ?? c.phone}
                        <span className="ml-2 text-xs font-normal text-ink-soft">{c.phone}</span>
                      </p>
                      <p className="truncate text-xs text-ink-soft">{lastMessages.get(c.id) ?? "—"}</p>
                    </Link>
                    <form
                      action={async () => {
                        "use server";
                        await toggleConversationMode(c.id, c.mode === "bot" ? "human" : "bot");
                      }}
                    >
                      <button
                        type="submit"
                        className={`btn rounded-full px-3 py-1 text-xs font-bold ${
                          c.mode === "bot"
                            ? "bg-brand-soft text-brand-dark"
                            : "bg-sun text-ink"
                        }`}
                        title="Cambiar quién atiende esta conversación"
                      >
                        {c.mode === "bot" ? "🤖 Bot" : "🙋 Persona"}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-ink-soft">
              «Bot» = el asistente responde solo. «Persona» = el bot se apaga y el equipo contesta
              entrando a la conversación (clic en el nombre) y escribiendo desde el panel.
            </p>
          </section>
        </div>

        <AssistantSimulator configured={env.ai} />
      </div>
    </div>
  );
}
