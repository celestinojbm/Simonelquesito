"use client";

import { useRef, useState, useTransition } from "react";
import { simulateAssistantMessage, resetSimulatorConversation } from "@/app/actions/whatsapp";

type Bubble = { from: "cliente" | "bot" | "sistema"; text: string };

/**
 * Simulador del asistente: chatea con el MISMO cerebro que atenderá WhatsApp.
 * Ojo: los pedidos que confirmes aquí se crean de verdad en el panel.
 */
export function AssistantSimulator({ configured }: { configured: boolean }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollDown = () =>
    setTimeout(() => scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 50);

  const send = () => {
    const message = text.trim();
    if (!message || pending) return;
    setText("");
    setBubbles((b) => [...b, { from: "cliente", text: message }]);
    scrollDown();
    startTransition(async () => {
      const result = await simulateAssistantMessage(message);
      if (!result.ok) {
        setBubbles((b) => [...b, { from: "sistema", text: `⚠️ ${result.message}` }]);
      } else if (result.reply) {
        setBubbles((b) => [...b, { from: "bot", text: result.reply! }]);
        if (result.mode === "human") {
          setBubbles((b) => [
            ...b,
            { from: "sistema", text: "La conversación pasó a modo persona. Usa «Reiniciar» para volver a probar el bot." },
          ]);
        }
      } else {
        setBubbles((b) => [
          ...b,
          { from: "sistema", text: "La conversación está en modo persona: el bot no responde. Usa «Reiniciar»." },
        ]);
      }
      scrollDown();
    });
  };

  const reset = () => {
    startTransition(async () => {
      await resetSimulatorConversation();
      setBubbles([{ from: "sistema", text: "Simulador reiniciado: el bot vuelve a estar a cargo." }]);
    });
  };

  return (
    <div className="rounded-card border border-brand-soft bg-white">
      <div className="flex items-center justify-between border-b border-brand-soft px-4 py-3">
        <div>
          <p className="font-bold text-ink">🧪 Simulador del asistente</p>
          <p className="text-xs text-ink-soft">
            Mismo cerebro que WhatsApp. Los pedidos que confirmes aquí se crean de verdad.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="btn rounded-full border border-brand-soft px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-brand-soft"
        >
          ↺ Reiniciar
        </button>
      </div>

      {!configured && (
        <p className="mx-4 mt-3 rounded-lg bg-sun/40 px-3 py-2 text-xs text-ink">
          ⚠️ Falta <code>ANTHROPIC_API_KEY</code>: el bot responderá con el mensaje de
          transferencia a una persona. Configúrala para probar la IA.
        </p>
      )}

      <div ref={scrollRef} className="h-80 space-y-2 overflow-y-auto bg-[#efe7dd] p-4">
        {bubbles.length === 0 && (
          <p className="pt-24 text-center text-sm text-ink-soft">
            Escribe como si fueras un cliente: «Hola, ¿tienen tomate?»
          </p>
        )}
        {bubbles.map((b, i) => (
          <div
            key={i}
            className={
              b.from === "cliente"
                ? "ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-[#d9fdd3] px-3 py-2 text-sm whitespace-pre-wrap"
                : b.from === "bot"
                  ? "mr-auto max-w-[85%] rounded-xl rounded-bl-sm bg-white px-3 py-2 text-sm whitespace-pre-wrap"
                  : "mx-auto max-w-[90%] rounded-lg bg-sun/60 px-3 py-1.5 text-center text-xs text-ink"
            }
          >
            {b.text}
          </div>
        ))}
        {pending && (
          <div className="mr-auto max-w-[85%] rounded-xl bg-white px-3 py-2 text-sm text-ink-soft">
            escribiendo…
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-brand-soft p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Escribe un mensaje…"
          className="min-w-0 flex-1 rounded-full border border-brand-soft px-4 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !text.trim()}
          className="btn rounded-full bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
