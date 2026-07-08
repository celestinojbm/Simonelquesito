"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminReceiveLot } from "@/app/actions/admin";

/** Recibe mercancía perecedera CON lote/vencimiento (FEFO). */
export function LotReceive({ variantId }: { variantId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn rounded-full border border-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-brand-soft"
      >
        + Lote
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = parseInt(qty, 10);
        if (!Number.isInteger(n) || n <= 0) { setError("Cantidad inválida"); return; }
        setError(null);
        startTransition(async () => {
          const result = await adminReceiveLot({
            variantId,
            qty: n,
            lotCode: lotCode.trim() || undefined,
            expiresAt: expiresAt || undefined,
          });
          if (!result.ok) setError(result.message);
          else { setOpen(false); setQty(""); setLotCode(""); setExpiresAt(""); router.refresh(); }
        });
      }}
      className="flex flex-wrap items-center gap-1"
    >
      <input
        type="number" value={qty} onChange={(e) => setQty(e.target.value)}
        placeholder="Cant." aria-label="Cantidad recibida"
        className="w-16 rounded border border-brand-soft px-2 py-1 text-xs"
      />
      <input
        type="text" value={lotCode} onChange={(e) => setLotCode(e.target.value)}
        placeholder="Lote (opc.)" aria-label="Código de lote"
        className="w-24 rounded border border-brand-soft px-2 py-1 text-xs"
      />
      <input
        type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
        aria-label="Fecha de vencimiento"
        className="rounded border border-brand-soft px-2 py-1 text-xs"
      />
      <button type="submit" disabled={pending} className="rounded bg-brand px-2 py-1 text-xs font-bold text-white disabled:opacity-50">✓</button>
      <button type="button" onClick={() => setOpen(false)} className="rounded px-1 py-1 text-xs text-ink-soft">✕</button>
      {error && <span className="w-full text-xs text-coral-dark">{error}</span>}
    </form>
  );
}
