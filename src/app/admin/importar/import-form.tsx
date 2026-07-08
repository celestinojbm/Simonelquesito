"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminImportCsv } from "@/app/actions/admin";

export function ImportForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  return (
    <form
      action={(formData) => {
        setMessage(null);
        startTransition(async () => {
          const result = await adminImportCsv(formData);
          if (result.ok && "imported" in result) {
            setIsError(false);
            setMessage(`✅ Importación completada: ${result.imported} creados, ${result.updated} actualizados${result.errors.length ? `, ${result.errors.length} errores (ver historial)` : ""}.`);
            router.refresh();
          } else if (!result.ok) {
            setIsError(true);
            setMessage(result.message);
          }
        });
      }}
      className="rounded-card border border-brand-soft bg-white p-4"
    >
      <label htmlFor="file" className="mb-2 block text-sm font-medium">Archivo CSV</label>
      <input
        id="file" name="file" type="file" accept=".csv,text/csv" required
        className="w-full rounded-lg border border-brand-soft p-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:font-semibold file:text-white"
      />
      <button
        type="submit" disabled={pending}
        className="btn mt-3 rounded-full bg-brand px-6 py-2.5 font-bold text-white hover:bg-brand-dark disabled:opacity-50"
      >
        {pending ? "Importando…" : "Importar catálogo"}
      </button>
      {message && (
        <p role="status" className={`mt-2 text-sm font-medium ${isError ? "text-coral-dark" : "text-brand-dark"}`}>
          {message}
        </p>
      )}
    </form>
  );
}
