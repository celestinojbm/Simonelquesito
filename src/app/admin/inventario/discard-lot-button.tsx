"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminDiscardLot } from "@/app/actions/admin";

/** Da de baja TODA la existencia remanente de un lote (vencido/dañado) como merma. */
export function DiscardLotButton({ lotId }: { lotId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Vencido");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn rounded-full border border-coral px-3 py-1.5 text-xs font-semibold text-coral-dark hover:bg-coral/10"
      >
        Dar de baja
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) { setError("Motivo requerido"); return; }
        setError(null);
        startTransition(async () => {
          const result = await adminDiscardLot(lotId, reason);
          if (!result.ok) setError(result.message);
          else { setOpen(false); router.refresh(); }
        });
      }}
      className="flex flex-wrap items-center gap-1"
    >
      <input
        type="text" value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo" aria-label="Motivo del descarte"
        className="w-32 rounded border border-brand-soft px-2 py-1 text-xs"
      />
      <button type="submit" disabled={pending} className="rounded bg-coral px-2 py-1 text-xs font-bold text-white disabled:opacity-50">✓</button>
      <button type="button" onClick={() => setOpen(false)} className="rounded px-1 py-1 text-xs text-ink-soft">✕</button>
      {error && <span className="w-full text-xs text-coral-dark">{error}</span>}
    </form>
  );
}
