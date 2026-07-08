import { requirePermission } from "@/lib/auth/session";
import { listActiveZones } from "@/modules/delivery/service";
import { NuevoPedidoClient } from "./nuevo-pedido-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nuevo pedido interno · Admin" };

/**
 * Pedido interno: el personal lo toma por teléfono/WhatsApp (sin bot) y lo
 * registra aquí — mismo `placeOrder` del checkout público (horario, zona,
 * restringidos y stock validados en servidor), canal "manual".
 */
export default async function NuevoPedidoPage() {
  await requirePermission("orders.manage");
  const zones = await listActiveZones();
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">🧾 Nuevo pedido interno</h1>
        <p className="text-sm text-ink-soft">
          Para pedidos por teléfono o WhatsApp que un cliente no dejó por sí mismo. Se crea como
          pedido real (canal «manual») y sigue el mismo flujo que cualquier otro: reserva de
          inventario, pago (efectivo/transferencia o link) y — si es domicilio — asignación de
          domiciliario.
        </p>
      </div>
      <NuevoPedidoClient zones={zones.map((z) => ({ id: z.id, name: z.name }))} />
    </div>
  );
}
