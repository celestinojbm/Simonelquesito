"use client";

import { useState, useTransition } from "react";
import { subscribeFromOrderAction } from "@/app/actions/subscriptions";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Convierte este pedido en canasta recurrente (solo dueño del pedido). */
export function SubscribeBox({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<"weekly" | "biweekly">("weekly");
  const [deliveryDay, setDeliveryDay] = useState(6); // sábado, día de mercado
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (message?.ok) {
    return (
      <p className="rounded-card border border-brand bg-brand-soft p-3 text-sm font-medium text-brand-dark">
        🧺 ¡Canasta creada! Te llegará cada {frequency === "weekly" ? "semana" : "quincena"} el{" "}
        {DAYS[deliveryDay]?.toLowerCase()}. La administras desde <a href="/cuenta" className="underline">tu cuenta</a>.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn w-full rounded-card border border-brand bg-white p-3 text-sm font-bold text-brand-dark hover:bg-brand-soft"
      >
        🧺 Recibir este pedido cada semana o quincena
      </button>
    );
  }

  return (
    <div className="rounded-card border border-brand bg-white p-4">
      <p className="mb-2 text-sm font-bold text-ink">🧺 Tu canasta recurrente</p>
      <p className="mb-2 text-xs text-ink-soft">
        Estos mismos productos se convertirán en un pedido automático. Pagas al recibir, y puedes
        pausar o cancelar cuando quieras desde tu cuenta.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as "weekly" | "biweekly")}
          aria-label="Frecuencia"
          className="rounded-lg border border-brand-soft px-3 py-2 text-sm"
        >
          <option value="weekly">Cada semana</option>
          <option value="biweekly">Cada quincena</option>
        </select>
        <select
          value={deliveryDay}
          onChange={(e) => setDeliveryDay(Number(e.target.value))}
          aria-label="Día de entrega"
          className="rounded-lg border border-brand-soft px-3 py-2 text-sm"
        >
          {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const r = await subscribeFromOrderAction({ orderId, frequency, deliveryDay });
            setMessage(r.ok ? { ok: true, text: "" } : { ok: false, text: r.message });
          });
        }}
        className="btn mt-2 w-full rounded-full bg-brand px-4 py-2.5 font-bold text-white disabled:opacity-50"
      >
        {pending ? "Creando…" : "Crear mi canasta"}
      </button>
      {message && !message.ok && (
        <p role="alert" className="mt-1 text-xs font-medium text-coral-dark">{message.text}</p>
      )}
    </div>
  );
}
