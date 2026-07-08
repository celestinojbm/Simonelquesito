import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getSetting } from "@/modules/config/service";
import { TrackingClient } from "./tracking-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ubicación y seguimiento · Market Castilla" };

/**
 * Página pública del pedido (por token compartido en WhatsApp/confirmación):
 * el cliente fija el punto exacto de entrega en el mapa y sigue el domicilio
 * en tiempo real. No requiere iniciar sesión ni expone datos de pago.
 */
export default async function LocationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16) notFound();
  const order = await db.query.orders.findFirst({ where: eq(orders.locationToken, token) });
  if (!order) notFound();
  const store = await getSetting("business.location");

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-extrabold text-ink">
        Pedido <span className="text-brand-dark">{order.number}</span>
      </h1>
      <p className="mb-4 text-sm text-ink-soft">
        {order.fulfillment === "delivery"
          ? "Fija el punto exacto de entrega y sigue tu domicilio en tiempo real."
          : "Tu pedido es para recoger en la tienda."}
      </p>
      <TrackingClient
        token={token}
        initialStatus={order.status}
        fulfillment={order.fulfillment}
        initialLocation={
          order.deliveryLat != null && order.deliveryLng != null
            ? { lat: order.deliveryLat, lng: order.deliveryLng }
            : null
        }
        store={{ lat: store.lat, lng: store.lng }}
      />
    </div>
  );
}
