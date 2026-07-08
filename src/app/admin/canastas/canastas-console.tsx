"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminRunSubscriptionAction,
  adminSubscriptionStatusAction,
} from "@/app/actions/subscriptions";

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

type Row = {
  id: string;
  name: string;
  customer: string;
  phone: string;
  frequency: string;
  deliveryDay: number;
  status: string;
  nextRunAt: string;
  lastError: string | null;
  itemCount: number;
};

export function CanastasConsole({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; number?: string }>, okText: (n?: string) => string) => {
    setMessage(null);
    startTransition(async () => {
      const r = await fn();
      setMessage(r.ok ? { ok: true, text: okText((r as { number?: string }).number) } : { ok: false, text: (r as { message: string }).message });
      router.refresh();
    });
  };

  if (rows.length === 0) {
    return (
      <p className="rounded-card border border-brand-soft bg-white p-8 text-center text-sm text-ink-soft">
        Sin canastas todavía. Se crean desde un pedido entregado (botón «Recibir este pedido cada semana»)
        con la sesión del cliente.
      </p>
    );
  }

  return (
    <div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mb-2 rounded-lg px-3 py-2 text-sm font-medium ${message.ok ? "bg-brand-soft text-brand-dark" : "bg-coral/15 text-coral-dark"}`}>
          {message.ok ? "✅ " : "⚠️ "}{message.text}
        </p>
      )}
      <ul className="divide-y divide-brand-soft rounded-card border border-brand-soft bg-white">
        {rows.map((r) => (
          <li key={r.id} className="p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-ink">🧺 {r.customer}</span>
              <span className="text-xs text-ink-soft">{r.phone} · {r.itemCount} productos</span>
              <span className="text-xs text-ink-soft">
                {r.frequency === "weekly" ? "semanal" : "quincenal"} · {DAYS[r.deliveryDay]}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.status === "active" ? "bg-brand-soft text-brand-dark" : r.status === "paused" ? "bg-sun text-ink" : "bg-ink/10 text-ink-soft"}`}>
                {r.status === "active" ? "activa" : r.status === "paused" ? "pausada" : "cancelada"}
              </span>
              {r.status === "active" && (
                <span className="text-xs text-ink-soft">
                  próxima: {new Date(r.nextRunAt).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short" })}
                </span>
              )}
              <span className="ml-auto flex gap-1.5">
                {r.status === "active" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => adminRunSubscriptionAction(r.id), (n) => `Pedido ${n} generado.`)}
                    className="btn rounded-full bg-brand px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                  >
                    ⚡ Generar ahora
                  </button>
                )}
                {r.status !== "cancelled" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => adminSubscriptionStatusAction(r.id, r.status === "active" ? "paused" : "active"), () => "Estado actualizado.")}
                    className="btn rounded-full border border-brand-soft px-3 py-1 text-xs text-ink-soft"
                  >
                    {r.status === "active" ? "⏸ Pausar" : "▶️ Reactivar"}
                  </button>
                )}
              </span>
            </div>
            {r.lastError && (
              <p className="mt-1 rounded bg-coral/10 px-2 py-1 text-xs text-coral-dark">
                Último intento fallido → {r.lastError} (la canasta saltó a la siguiente fecha)
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
