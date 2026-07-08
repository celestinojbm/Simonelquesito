"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { driverPickUp, driverDeliver, driverIncident } from "@/app/actions/driver";

export function DeliveryCard(props: {
  orderId: string;
  number: string;
  status: string;
  contactName: string;
  contactPhone: string;
  addressLine: string;
  neighborhood: string;
  references: string | null;
  instructions: string | null;
  totalLabel: string;
  idCheckRequired: boolean;
  paymentOnDelivery: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [idChecked, setIdChecked] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [showIncident, setShowIncident] = useState(false);
  const [incidentNotes, setIncidentNotes] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.message ?? "Error");
      else router.refresh();
    });
  };

  const mapsQuery = encodeURIComponent(`${props.addressLine}, ${props.neighborhood}, Bogotá`);

  return (
    <li className="rounded-card border border-brand-soft bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-lg font-extrabold text-ink">{props.number}</p>
        <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand-dark">
          {props.status === "assigned" ? "Por recoger" : "En camino"}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium">{props.contactName} · {props.totalLabel}</p>
      <p className="text-sm text-ink-soft">{props.addressLine}, {props.neighborhood}</p>
      {props.references && <p className="text-xs text-ink-soft">📍 {props.references}</p>}
      {props.instructions && <p className="text-xs text-ink-soft">📝 {props.instructions}</p>}

      {props.idCheckRequired && (
        <p className="mt-2 rounded-lg bg-liquor-soft px-3 py-2 text-xs font-bold text-liquor">
          🔞 Pedido +18: verifica el documento de identidad ANTES de entregar. No dejar desatendido.
        </p>
      )}
      {props.paymentOnDelivery && (
        <p className="mt-2 rounded-lg bg-sun/30 px-3 py-2 text-xs font-bold text-ink">
          💰 Cobrar al entregar ({props.paymentOnDelivery === "cash_on_delivery" ? "efectivo" : props.paymentOnDelivery === "card_on_delivery" ? "datáfono" : "transferencia"})
        </p>
      )}

      {/* Contacto y navegación */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm font-semibold">
        <a href={`tel:${props.contactPhone}`} className="btn flex items-center justify-center rounded-full border border-brand-soft py-2.5 text-brand-dark">
          📞 Llamar
        </a>
        <a href={`https://wa.me/57${props.contactPhone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="btn flex items-center justify-center rounded-full border border-brand-soft py-2.5 text-brand-dark">
          💬 WhatsApp
        </a>
        <a href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`} target="_blank" rel="noopener noreferrer" className="btn flex items-center justify-center rounded-full border border-brand-soft py-2.5 text-brand-dark">
          🗺️ Mapa
        </a>
      </div>

      {/* Acción principal */}
      {props.status === "assigned" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => driverPickUp(props.orderId))}
          className="btn mt-3 w-full rounded-full bg-brand py-3 font-bold text-white disabled:opacity-50"
        >
          📦 Marcar recogido
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              driverDeliver({
                orderId: props.orderId,
                confirmationCode: code.trim(),
                idChecked,
                paymentReceivedMethod: props.paymentOnDelivery ? paymentMethod : undefined,
              }),
            );
          }}
          className="mt-3 space-y-2"
        >
          <label htmlFor={`code-${props.orderId}`} className="block text-sm font-medium">
            Código de confirmación del cliente
          </label>
          <input
            id={`code-${props.orderId}`}
            inputMode="numeric"
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="0000"
            className="w-full rounded-lg border border-brand-soft px-3 py-2.5 text-center text-xl tracking-[0.5em]"
          />
          {props.idCheckRequired && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} className="h-5 w-5 accent-[#8A5A18]" />
              Verifiqué el documento: es mayor de edad
            </label>
          )}
          {props.paymentOnDelivery && (
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} aria-label="Método de pago recibido" className="w-full rounded-lg border border-brand-soft px-3 py-2.5 text-sm">
              <option value="cash">Recibí efectivo</option>
              <option value="card">Pagó con datáfono</option>
              <option value="transfer">Pagó por transferencia</option>
            </select>
          )}
          <button type="submit" disabled={pending || code.length < 4} className="btn w-full rounded-full bg-brand py-3 font-bold text-white disabled:opacity-50">
            ✅ Marcar entregado
          </button>
        </form>
      )}

      {/* Incidencias */}
      {!showIncident ? (
        <button type="button" onClick={() => setShowIncident(true)} className="btn mt-2 w-full rounded-full border border-coral py-2.5 text-sm font-semibold text-coral-dark">
          ⚠️ Reportar incidencia
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!incidentNotes.trim()) return;
            run(() => driverIncident(props.orderId, "delivery_issue", incidentNotes.trim()));
            setShowIncident(false);
            setIncidentNotes("");
          }}
          className="mt-2 space-y-2"
        >
          <textarea
            value={incidentNotes}
            onChange={(e) => setIncidentNotes(e.target.value)}
            rows={2}
            placeholder="Ej.: cliente no responde, dirección errada…"
            className="w-full rounded-lg border border-coral/40 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn flex-1 rounded-full bg-coral py-2 text-sm font-bold text-white disabled:opacity-50">
              Enviar
            </button>
            <button type="button" onClick={() => setShowIncident(false)} className="btn rounded-full border border-brand-soft px-4 text-sm text-ink-soft">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="mt-2 text-sm font-medium text-coral-dark">{error}</p>}
    </li>
  );
}
