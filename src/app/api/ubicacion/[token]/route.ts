import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { orders, deliveries } from "@/db/schema";
import { getSetting } from "@/modules/config/service";

/**
 * API pública del mapa del pedido, autenticada por el token aleatorio del
 * pedido (128 bits — imposible de adivinar). Expone solo lo necesario para
 * fijar la ubicación y seguir el domicilio; nunca datos de pago.
 */

export const dynamic = "force-dynamic";

const FINAL_STATES = ["delivered", "cancelled", "refunded", "failed"];

async function findOrder(token: string) {
  if (!token || token.length < 16) return null;
  return db.query.orders.findFirst({ where: eq(orders.locationToken, token) });
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await findOrder(token);
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });

  const [store, delivery] = await Promise.all([
    getSetting("business.location"),
    db.query.deliveries.findFirst({ where: eq(deliveries.orderId, order.id) }),
  ]);

  // La posición del domiciliario solo se comparte mientras va en camino.
  const driverVisible = order.status === "out_for_delivery" && delivery?.driverLat != null;

  return NextResponse.json({
    number: order.number,
    status: order.status,
    fulfillment: order.fulfillment,
    location:
      order.deliveryLat != null && order.deliveryLng != null
        ? { lat: order.deliveryLat, lng: order.deliveryLng }
        : null,
    canSetLocation: !FINAL_STATES.includes(order.status) && order.fulfillment === "delivery",
    store: { lat: store.lat, lng: store.lng },
    driver: driverVisible
      ? {
          lat: delivery!.driverLat,
          lng: delivery!.driverLng,
          at: delivery!.driverLocationAt?.toISOString() ?? null,
        }
      : null,
  });
}

const bodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await findOrder(token);
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (FINAL_STATES.includes(order.status)) {
    return NextResponse.json({ error: "El pedido ya no admite cambios de ubicación" }, { status: 409 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Coordenadas inválidas" }, { status: 400 });
  }

  await db
    .update(orders)
    .set({ deliveryLat: body.lat, deliveryLng: body.lng, updatedAt: new Date() })
    .where(eq(orders.id, order.id));

  return NextResponse.json({ ok: true });
}
