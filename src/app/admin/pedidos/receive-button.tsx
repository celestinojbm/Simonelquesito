"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeOrderAction } from "@/app/actions/admin";

/** «Recibir pedido»: confirma la recepción (auditada) y abre el detalle. */
export function ReceiveOrderButton({ orderId, small }: { orderId: string; small?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await acknowledgeOrderAction(orderId);
        if (r.ok) router.push(`/admin/pedidos/${orderId}`);
        else setBusy(false);
      }}
      className={`btn rounded-full bg-brand font-extrabold text-white hover:bg-brand-dark disabled:opacity-50 ${small ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm"}`}
    >
      {busy ? "Recibiendo…" : "✅ Recibir pedido"}
    </button>
  );
}
