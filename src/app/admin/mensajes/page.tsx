import { desc } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mensajes · Admin" };

export default async function AdminMessagesPage() {
  const rows = await db.query.notifications.findMany({
    orderBy: desc(notifications.createdAt),
    limit: 50,
  });

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-extrabold text-ink">Mensajes de WhatsApp</h1>
      <p className="mb-4 text-sm text-ink-soft">
        En modo demo el proveedor es <strong>simulado</strong>: los mensajes transaccionales se registran
        aquí en lugar de enviarse. Con WhatsApp Business API (fase 2) se envían de verdad con este mismo contenido.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-card border border-brand-soft bg-white p-10 text-center text-ink-soft">
          Aún no hay mensajes. Crea un pedido para ver las automatizaciones.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id} className="rounded-card border border-brand-soft bg-white p-3 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-brand-dark">{n.template}</span>
                <span>→ {n.recipient}</span>
                <span>· {n.status}</span>
                <span className="ml-auto">{n.createdAt.toLocaleString("es-CO", { timeZone: "America/Bogota" })}</span>
              </div>
              <p className="rounded-lg bg-[#e7f8ee] px-3 py-2">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
