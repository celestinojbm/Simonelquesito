"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { customerSubscriptionStatusAction } from "@/app/actions/subscriptions";

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export type SubscriptionRow = {
  id: string;
  name: string;
  frequency: string;
  deliveryDay: number;
  status: string;
  nextRunAt: string; // ISO
  itemCount: number;
};

/** Lista de canastas del cliente con pausa/reactivación/cancelación. */
export function SubscriptionList({ subs }: { subs: SubscriptionRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const act = (id: string, status: "active" | "paused" | "cancelled") =>
    startTransition(async () => {
      await customerSubscriptionStatusAction(id, status);
      router.refresh();
    });

  return (
    <ul className="space-y-2">
      {subs.map((s) => (
        <li key={s.id} className="rounded-lg border border-brand-soft p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">🧺 {s.name}</span>
            <span className="text-xs text-ink-soft">
              {s.frequency === "weekly" ? "semanal" : "quincenal"} · {DAYS[s.deliveryDay]} · {s.itemCount} productos
            </span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${s.status === "active" ? "bg-brand-soft text-brand-dark" : "bg-sun text-ink"}`}>
              {s.status === "active" ? "activa" : s.status === "paused" ? "pausada" : "cancelada"}
            </span>
          </div>
          {s.status === "active" && (
            <p className="mt-1 text-xs text-ink-soft">
              Próxima entrega: {new Date(s.nextRunAt).toLocaleDateString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" })} · pagas al recibir
            </p>
          )}
          {s.status !== "cancelled" && (
            <div className="mt-2 flex gap-2">
              {s.status === "active" ? (
                <button type="button" disabled={pending} onClick={() => act(s.id, "paused")} className="btn rounded-full border border-brand-soft px-3 py-1 text-xs text-ink-soft">
                  ⏸ Pausar
                </button>
              ) : (
                <button type="button" disabled={pending} onClick={() => act(s.id, "active")} className="btn rounded-full bg-brand px-3 py-1 text-xs font-bold text-white">
                  ▶️ Reactivar
                </button>
              )}
              <button type="button" disabled={pending} onClick={() => act(s.id, "cancelled")} className="btn rounded-full border border-coral/40 px-3 py-1 text-xs text-coral-dark">
                Cancelar
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
