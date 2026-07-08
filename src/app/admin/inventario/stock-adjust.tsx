"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminAdjustStock } from "@/app/actions/admin";

export function StockAdjust({ variantId }: { variantId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [type, setType] = useState<"adjustment" | "shrinkage" | "return_in">("adjustment");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn rounded-full border border-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-brand-soft"
      >
        Ajustar
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const delta = parseInt(qty, 10);
        if (!Number.isInteger(delta) || delta === 0) { setError("Cantidad inválida"); return; }
        if (!reason.trim()) { setError("Motivo requerido"); return; }
        setError(null);
        startTransition(async () => {
          const result = await adminAdjustStock(variantId, delta, type, reason);
          if (!result.ok) setError(result.message);
          else { setOpen(false); setQty(""); setReason(""); router.refresh(); }
        });
      }}
      className="flex flex-wrap items-center gap-1"
    >
      <input
        type="number" value={qty} onChange={(e) => setQty(e.target.value)}
        placeholder="±cant." aria-label="Cantidad (positiva o negativa)"
        className="w-20 rounded border border-brand-soft px-2 py-1 text-xs"
      />
      <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Tipo" className="rounded border border-brand-soft px-1 py-1 text-xs">
        <option value="adjustment">Ajuste</option>
        <option value="shrinkage">Merma</option>
        <option value="return_in">Devolución</option>
      </select>
      <input
        type="text" value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo" aria-label="Motivo"
        className="w-28 rounded border border-brand-soft px-2 py-1 text-xs"
      />
      <button type="submit" disabled={pending} className="rounded bg-brand px-2 py-1 text-xs font-bold text-white disabled:opacity-50">✓</button>
      <button type="button" onClick={() => setOpen(false)} className="rounded px-1 py-1 text-xs text-ink-soft">✕</button>
      {error && <span className="w-full text-xs text-coral-dark">{error}</span>}
    </form>
  );
}
