import { desc } from "drizzle-orm";
import { db } from "@/db";
import { syncJobs } from "@/db/schema";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Importar POS · Admin" };

export default async function AdminImportPage() {
  const jobs = await db.query.syncJobs.findMany({ orderBy: desc(syncJobs.createdAt), limit: 10 });

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-extrabold text-ink">Importar desde el POS (Treinta)</h1>
      <p className="text-sm text-ink-soft">
        Exporta tu inventario desde Treinta a Excel, guárdalo como <strong>CSV</strong> con columnas{" "}
        <code className="rounded bg-brand-soft px-1">sku, codigo_barras, nombre, categoria, precio, costo, stock</code>{" "}
        y súbelo aquí. Los productos se crean o actualizan por SKU/código de barras y el stock se concilia
        con movimientos de ajuste auditados.
      </p>
      <ImportForm />

      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-2 font-bold text-ink">Sincronizaciones recientes</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-ink-soft">Aún no hay importaciones.</p>
        ) : (
          <ul className="divide-y divide-brand-soft text-sm">
            {jobs.map((j) => {
              const summary = j.summary as { imported?: number; updated?: number; totalRows?: number };
              const errs = j.errors as { row: number; message: string }[];
              return (
                <li key={j.id} className="py-2">
                  <p>
                    <strong>{j.kind}</strong> · {j.status} ·{" "}
                    <span className="text-ink-soft">
                      {j.createdAt.toLocaleString("es-CO", { timeZone: "America/Bogota" })}
                    </span>
                  </p>
                  <p className="text-xs text-ink-soft">
                    {summary.imported ?? 0} creados, {summary.updated ?? 0} actualizados de {summary.totalRows ?? 0} filas
                    {errs.length > 0 && ` · ${errs.length} errores`}
                  </p>
                  {errs.length > 0 && (
                    <ul className="mt-1 list-inside list-disc text-xs text-coral-dark">
                      {errs.slice(0, 5).map((e, i) => <li key={i}>Fila {e.row}: {e.message}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
