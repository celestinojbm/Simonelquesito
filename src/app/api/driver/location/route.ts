import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { deliveries, drivers, orders } from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";

/**
 * El domiciliario reporta su posición mientras tiene entregas en camino.
 * Solo actualiza SUS entregas activas; la posición se publica al cliente
 * únicamente cuando el pedido está out_for_delivery (ver /api/ubicacion).
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "driver") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const driver = await db.query.drivers.findFirst({ where: eq(drivers.userId, user.id) });
  if (!driver) return NextResponse.json({ error: "Domiciliario no registrado" }, { status: 403 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Coordenadas inválidas" }, { status: 400 });
  }

  // Entregas activas de este domiciliario cuyos pedidos van en camino.
  const active = await db
    .select({ deliveryId: deliveries.id })
    .from(deliveries)
    .innerJoin(orders, eq(deliveries.orderId, orders.id))
    .where(and(eq(deliveries.driverId, driver.id), eq(orders.status, "out_for_delivery")));

  if (active.length > 0) {
    await db
      .update(deliveries)
      .set({ driverLat: body.lat, driverLng: body.lng, driverLocationAt: new Date() })
      .where(inArray(deliveries.id, active.map((a) => a.deliveryId)));
  }

  return NextResponse.json({ ok: true, tracking: active.length });
}
