import { desc, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { roleHas } from "@/lib/auth/permissions";

/**
 * Pedidos SIN RECIBIR (timbre del panel): el componente de alarma los sondea
 * cada pocos segundos y suena hasta que el personal pulsa «Recibir pedido».
 * Solo pedidos vivos (los cancelados/fallidos no timbran) de las últimas
 * 24 horas — un pedido viejo sin recibir no debe despertar la alarma días
 * después. Requiere sesión de staff con orders.view.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role === "customer" || user.role === "driver" || !roleHas(user.role, "orders.view")) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const rows = await db.query.orders.findMany({
    where: sql`${isNull(orders.acknowledgedAt)}
      and ${orders.status} in ('new','pending_payment','paid','confirmed','preparing')
      and ${orders.createdAt} > now() - interval '24 hours'`,
    orderBy: desc(orders.createdAt),
    limit: 20,
    columns: {
      id: true,
      number: true,
      contactName: true,
      totalCop: true,
      channel: true,
      fulfillment: true,
      createdAt: true,
    },
  });

  return Response.json(
    { ok: true, orders: rows },
    { headers: { "cache-control": "no-store" } },
  );
}
