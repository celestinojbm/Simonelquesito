import { requirePermission } from "@/lib/auth/session";
import { CajaClient } from "./caja-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Caja · Admin" };

/**
 * Caja de la tienda física: escáner de mano (teclado USB) + balanza por
 * puerto serial. Cada venta registrada es un pedido real con canal
 * pos_physical, pagado en el acto y entregado — inventario y analítica
 * quedan al día al instante.
 */
export default async function CajaPage() {
  await requirePermission("orders.manage");
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">🧾 Caja (tienda física)</h1>
        <p className="text-sm text-ink-soft">
          Escanea con la pistola (escribe como un teclado y termina con Enter), pesa en la balanza
          conectada y registra la venta. Descuenta inventario y aparece en la analítica como
          «Tienda física».
        </p>
      </div>
      <CajaClient />
    </div>
  );
}
