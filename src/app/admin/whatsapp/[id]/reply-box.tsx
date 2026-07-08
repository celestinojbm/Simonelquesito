"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { replyToConversation } from "@/app/actions/whatsapp";

/** Caja para que el equipo responda un chat directamente desde el panel. */
export function ReplyBox({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const send = () => {
    const message = text.trim();
    if (!message || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await replyToConversation(conversationId, message);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setText("");
      if (result.delivery === "failed") {
        setError("El mensaje quedó registrado pero WhatsApp no lo aceptó. Revisa las credenciales.");
      }
      router.refresh();
    });
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Responder como el equipo…"
          className="min-w-0 flex-1 rounded-full border border-brand-soft bg-white px-4 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !text.trim()}
          className="btn rounded-full bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? "Enviando…" : "Enviar"}
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs font-medium text-coral-dark">{error}</p>}
    </div>
  );
}
