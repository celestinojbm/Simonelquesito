"use client";

import { useState, useTransition } from "react";
import { setMarketingConsentAction } from "@/app/actions/account";
import { useToast } from "@/components/ui/toast";

/** Preferencia de marketing del cliente: activar/desactivar ofertas por WhatsApp. */
export function MarketingToggle({ initial }: { initial: boolean }) {
  const [granted, setGranted] = useState(initial);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const toggle = () => {
    const next = !granted;
    startTransition(async () => {
      const r = await setMarketingConsentAction(next);
      if (r.ok) {
        setGranted(r.granted);
        toast.ok(r.granted ? "Listo, te avisaremos de las ofertas 🎉" : "Hecho, no te enviaremos ofertas.");
      } else {
        toast.error(r.message);
      }
    });
  };

  return (
    <div className="rounded-card border border-brand-soft bg-white p-5">
      <h2 className="font-bold text-ink">Ofertas por WhatsApp</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {granted
          ? "Estás recibiendo promociones y novedades por WhatsApp."
          : "No recibes promociones por WhatsApp. Actívalas para enterarte de descuentos."}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={granted}
          aria-label="Recibir ofertas por WhatsApp"
          disabled={pending}
          onClick={toggle}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${granted ? "bg-brand" : "bg-ink/20"}`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${granted ? "left-[1.375rem]" : "left-0.5"}`}
          />
        </button>
        <span className="text-sm font-semibold text-ink">{granted ? "Activadas" : "Desactivadas"}</span>
      </div>
    </div>
  );
}
