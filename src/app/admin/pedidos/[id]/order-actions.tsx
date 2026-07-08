"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminTransitionOrder, adminRecordWeight, adminAssignDriver } from "@/app/actions/admin";
import { useScaleWeight } from "@/components/scale/scale-panel";
import type { OrderStatus } from "@/modules/orders/state";

const PRIMARY: Partial<Record<OrderStatus, string>> = {
  confirmed: "✅ Confirmar pedido",
  preparing: "👩‍🍳 Pasar a preparación",
  ready: "📦 Marcar listo",
  out_for_delivery: "🛵 En camino",
  delivered: "🎉 Entregado (recogida)",
};

export function OrderActions({
  orderId,
  nextStatuses,
  statusLabels,
  drivers,
  canAssign,
}: {
  orderId: string;
  nextStatuses: OrderStatus[];
  statusLabels: Record<OrderStatus, string>;
  drivers: { id: string; label: string }[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? "");

  const doTransition = (to: OrderStatus) => {
    setError(null);
    startTransition(async () => {
      const result = await adminTransitionOrder(orderId, to);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  const doAssign = () => {
    if (!driverId) return;
    setError(null);
    startTransition(async () => {
      const result = await adminAssignDriver(orderId, driverId);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  const primaryActions = nextStatuses.filter((s) => PRIMARY[s] && s !== "assigned");
  const canCancel = nextStatuses.includes("cancelled");

  return (
    <section className="rounded-card border-2 border-brand bg-white p-4">
      <h2 className="mb-3 font-bold text-ink">Acciones</h2>
      <div className="flex flex-wrap gap-2">
        {primaryActions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => doTransition(s)}
            className="btn rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {PRIMARY[s] ?? statusLabels[s]}
          </button>
        ))}
        {canAssign && drivers.length > 0 && (
          <span className="flex items-center gap-2">
            <label htmlFor="driver" className="sr-only">Domiciliario</label>
            <select
              id="driver"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="rounded-full border border-brand-soft px-3 py-2 text-sm"
            >
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <button
              type="button"
              disabled={pending}
              onClick={doAssign}
              className="btn rounded-full bg-brand-dark px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              🛵 Asignar domiciliario
            </button>
          </span>
        )}
        {canCancel && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm("¿Cancelar este pedido? Se liberará el inventario reservado.")) {
                doTransition("cancelled");
              }
            }}
            className="btn rounded-full border-2 border-coral px-5 py-2.5 text-sm font-bold text-coral-dark hover:bg-coral/10 disabled:opacity-50"
          >
            🚫 Cancelar pedido
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm font-medium text-coral-dark">{error}</p>}
    </section>
  );
}

/** Registro del peso real por línea (preparador). */
export function WeightForm({ orderItemId }: { orderItemId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [grams, setGrams] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Última lectura de la balanza conectada (ScalePanel) — botón de un toque.
  const scaleGrams = useScaleWeight();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = parseInt(grams, 10);
        if (!Number.isInteger(value) || value <= 0) {
          setError("Gramos inválidos");
          return;
        }
        setError(null);
        startTransition(async () => {
          const result = await adminRecordWeight(orderItemId, value);
          if (!result.ok) setError(result.message);
          else router.refresh();
        });
      }}
      className="flex items-center gap-1"
    >
      <label className="sr-only" htmlFor={`w-${orderItemId}`}>Peso real en gramos</label>
      <input
        id={`w-${orderItemId}`}
        type="number"
        min={1}
        value={grams}
        onChange={(e) => setGrams(e.target.value)}
        placeholder="g reales"
        title="Peso real en gramos según la balanza (1 libra = 500 g)"
        className="w-24 rounded-lg border border-brand-soft px-2 py-1.5 text-sm"
      />
      {scaleGrams !== null && (
        <button
          type="button"
          onClick={() => setGrams(String(scaleGrams))}
          title="Tomar el peso actual de la balanza conectada"
          className="btn rounded-full border border-brand px-2 py-1.5 text-xs font-bold text-brand-dark"
        >
          ⚖️ {scaleGrams}g
        </button>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn rounded-full bg-sun px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-50"
      >
        Pesar
      </button>
      {error && <span className="text-xs text-coral-dark">{error}</span>}
    </form>
  );
}
