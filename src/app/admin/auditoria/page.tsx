import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Auditoría · Admin" };

export default async function AdminAuditPage() {
  const rows = await db.query.auditEvents.findMany({
    orderBy: desc(auditEvents.createdAt),
    limit: 100,
  });

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-extrabold text-ink">Auditoría</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Registro inmutable de cambios críticos: precios, inventario, reembolsos, configuración, comisión.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-card border border-brand-soft bg-white p-10 text-center text-ink-soft">Sin eventos aún.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-brand-soft bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-brand-soft bg-brand-soft/50 text-xs text-ink-soft uppercase">
              <tr>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Acción</th>
                <th className="px-4 py-3">Entidad</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Cambio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-soft align-top">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 text-xs whitespace-nowrap text-ink-soft">
                    {e.createdAt.toLocaleString("es-CO", { timeZone: "America/Bogota" })}
                  </td>
                  <td className="px-4 py-2 font-semibold text-brand-dark">{e.action}</td>
                  <td className="px-4 py-2 text-xs">{e.entityType}<br />{e.entityId}</td>
                  <td className="px-4 py-2 text-xs">{e.actorLabel}</td>
                  <td className="px-4 py-2">
                    <details>
                      <summary className="cursor-pointer text-xs text-ink-soft">ver</summary>
                      <pre className="mt-1 max-w-md overflow-x-auto rounded bg-ink/5 p-2 text-[11px]">
                        {JSON.stringify({ antes: e.before, despues: e.after }, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
