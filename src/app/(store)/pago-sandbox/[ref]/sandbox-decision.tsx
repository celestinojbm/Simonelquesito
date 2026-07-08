"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { simulateGatewayDecision } from "@/app/actions/sandbox-payment";

export function SandboxDecision({ providerRef, orderId }: { providerRef: string; orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(decision);
    setError(null);
    const result = await simulateGatewayDecision(providerRef, decision);
    if (result.ok) {
      router.push(`/pedido/${orderId}`);
    } else {
      setError(result.message ?? "Error procesando el pago");
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 space-y-2">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => decide("approved")}
        className="btn w-full rounded-full bg-brand py-3 font-bold text-white hover:bg-brand-dark disabled:opacity-50"
      >
        {busy === "approved" ? "Procesando…" : "✅ Aprobar pago"}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => decide("rejected")}
        className="btn w-full rounded-full border-2 border-coral py-3 font-bold text-coral-dark hover:bg-coral/10 disabled:opacity-50"
      >
        {busy === "rejected" ? "Procesando…" : "❌ Rechazar pago"}
      </button>
      {error && <p role="alert" className="text-sm text-coral-dark">{error}</p>}
    </div>
  );
}
