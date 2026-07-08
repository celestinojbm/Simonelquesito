"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewIdentityAction } from "@/app/actions/fiado";

type Row = {
  id: string;
  customerName: string;
  phone: string;
  documentId: string;
  birthDate: string;
  age: number;
  frontImageUrl: string;
  createdAt: string;
};

export function IdentidadesClient({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<string | null>(null);

  const act = (id: string, decision: "approved" | "rejected") => {
    setMsg(null);
    startTransition(async () => {
      const r = await reviewIdentityAction(id, decision, note[id]);
      setMsg(r.ok ? { ok: true, text: decision === "approved" ? "Identidad aprobada." : "Envío rechazado." } : { ok: false, text: r.message });
      if (r.ok) router.refresh();
    });
  };

  if (rows.length === 0) {
    return <p className="rounded-card border border-brand-soft bg-white p-6 text-center text-sm text-ink-soft">No hay cédulas pendientes de revisión.</p>;
  }

  return (
    <div className="space-y-3">
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.ok ? "bg-brand-soft text-brand-dark" : "bg-coral/15 text-coral-dark"}`}>
          {msg.ok ? "✅ " : "⚠️ "}{msg.text}
        </p>
      )}
      {rows.map((r) => (
        <div key={r.id} className="rounded-card border border-brand-soft bg-white p-4">
          <div className="flex flex-wrap gap-4">
            <button type="button" onClick={() => setZoom(r.frontImageUrl)} className="shrink-0" aria-label="Ampliar cédula">
              <Image src={r.frontImageUrl} alt="Cédula" width={160} height={100} unoptimized className="h-24 w-40 rounded-lg border border-brand-soft object-cover" />
            </button>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-ink">{r.customerName} <span className="font-normal text-ink-soft">· {r.phone}</span></p>
              <p className="text-ink-soft">Cédula: <span className="font-mono text-ink">{r.documentId}</span></p>
              <p className="text-ink-soft">Nacimiento: {r.birthDate} · <span className={r.age >= 18 ? "font-bold text-brand-dark" : "font-bold text-coral-dark"}>{r.age} años</span></p>
              <p className="text-xs text-ink-soft">Enviada: {new Date(r.createdAt).toLocaleString("es-CO", { timeZone: "America/Bogota" })}</p>
            </div>
          </div>
          <input
            value={note[r.id] ?? ""}
            onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
            placeholder="Nota (opcional, ej. motivo de rechazo)"
            className="mt-3 w-full rounded-lg border border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending || r.age < 18}
              onClick={() => act(r.id, "approved")}
              className="btn rounded-full bg-brand px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              ✅ Aprobar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => act(r.id, "rejected")}
              className="btn rounded-full border border-coral/40 px-5 py-2 text-sm font-semibold text-coral-dark disabled:opacity-50"
            >
              Rechazar
            </button>
            {r.age < 18 && <span className="self-center text-xs font-bold text-coral-dark">Menor de edad: no se puede aprobar.</span>}
          </div>
        </div>
      ))}

      {zoom && (
        <button
          type="button"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          aria-label="Cerrar"
        >
          <Image src={zoom} alt="Cédula ampliada" width={900} height={600} unoptimized className="max-h-full w-auto max-w-full rounded-lg" />
        </button>
      )}
    </div>
  );
}
