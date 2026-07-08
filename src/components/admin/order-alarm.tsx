"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeOrderAction } from "@/app/actions/admin";

/**
 * Timbre de pedidos nuevos (como los sistemas de restaurante):
 * - Sondea /api/admin/pedidos-nuevos cada 10 s desde cualquier página del panel.
 * - Si hay pedidos sin recibir: banner fijo arriba + campana generada con
 *   Web Audio (sin archivos) que REPITE hasta que se reciban todos.
 * - «Recibir y ver» confirma la recepción (auditada) y abre el detalle.
 * - Los navegadores exigen un gesto del usuario para producir sonido: si el
 *   audio está bloqueado, el banner lo dice y el primer clic/tecla lo activa.
 */

type PendingOrder = {
  id: string;
  number: string;
  contactName: string;
  totalCop: number;
  channel: string;
  fulfillment: string;
  createdAt: string;
};

const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;
const CHANNEL_ES: Record<string, string> = {
  web_pwa: "Web", whatsapp: "WhatsApp", subscription: "Canasta", manual: "Manual",
};

export function OrderAlarm() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingOrder[]>([]);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const pendingRef = useRef(0);
  pendingRef.current = pending.length;

  // Campana: dos tonos (ding-dong) generados con osciladores.
  const ring = useCallback(() => {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!ctxRef.current) ctxRef.current = new Ctx();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") {
      void ctx.resume();
      if (ctx.state === "suspended") {
        setAudioBlocked(true);
        return;
      }
    }
    setAudioBlocked(false);
    const tone = (freq: number, at: number, dur = 0.35) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur + 0.05);
    };
    tone(880, 0);
    tone(660, 0.4);
    tone(880, 0.8);
  }, []);

  // Sondeo cada 10 s.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/admin/pedidos-nuevos", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean; orders?: PendingOrder[] };
        if (alive && data.ok) setPending(data.orders ?? []);
      } catch { /* red intermitente: reintenta en el próximo tick */ }
    };
    void poll();
    const t = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Suena SIN PARAR (cada 3 s) mientras haya pedidos sin recibir; el título
  // de la pestaña también parpadea para verlo desde otra ventana.
  useEffect(() => {
    if (pending.length === 0) {
      setAudioBlocked(false);
      return;
    }
    ring();
    const t = setInterval(() => { if (pendingRef.current > 0) ring(); }, 3_000);
    const baseTitle = document.title;
    let flip = false;
    const titleT = setInterval(() => {
      flip = !flip;
      document.title = flip ? `🔔 (${pendingRef.current}) Pedido nuevo` : baseTitle;
    }, 1_500);
    return () => {
      clearInterval(t);
      clearInterval(titleT);
      document.title = baseTitle;
    };
  }, [pending.length, ring]);

  // Si el navegador bloqueó el audio, el primer gesto lo desbloquea.
  useEffect(() => {
    if (!audioBlocked) return;
    const unlock = () => ring();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [audioBlocked, ring]);

  const receive = async (o: PendingOrder) => {
    setBusy(o.id);
    const r = await acknowledgeOrderAction(o.id);
    setBusy(null);
    if (r.ok) {
      setPending((p) => p.filter((x) => x.id !== o.id));
      router.push(`/admin/pedidos/${o.id}`);
    }
  };

  if (pending.length === 0) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 border-b-4 border-coral bg-ink px-4 py-3 text-white shadow-lg"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <p className="animate-pulse font-extrabold">
          🔔 {pending.length === 1 ? "¡Pedido nuevo!" : `¡${pending.length} pedidos nuevos!`}
          {audioBlocked && (
            <span className="ml-2 rounded bg-sun px-2 py-0.5 text-xs font-bold text-ink">
              toca la pantalla para activar el sonido
            </span>
          )}
        </p>
        <ul className="space-y-1.5">
          {pending.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-bold">{o.number}</span>
              <span>{o.contactName}</span>
              <span className="text-white/70">
                {CHANNEL_ES[o.channel] ?? o.channel} · {o.fulfillment === "delivery" ? "🛵 domicilio" : "🏪 recogida"} · {cop(o.totalCop)}
              </span>
              <button
                type="button"
                disabled={busy === o.id}
                onClick={() => void receive(o)}
                className="btn ml-auto rounded-full bg-brand px-4 py-1.5 text-xs font-extrabold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {busy === o.id ? "Recibiendo…" : "✅ Recibir y ver detalles"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
