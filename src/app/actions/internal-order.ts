"use server";

import { revalidatePath } from "next/cache";
import { placeOrder, CheckoutError, type CheckoutInput } from "@/modules/orders/checkout";
import { InsufficientStockError } from "@/modules/inventory/service";
import { requirePermission } from "@/lib/auth/session";

export type InternalOrderResult =
  | { ok: true; orderId: string; number: string; redirectUrl: string | null }
  | { ok: false; message: string; violations?: string[] };

/**
 * Crea un pedido interno (canal "manual"): staff toma el pedido por teléfono
 * o WhatsApp sin bot y lo registra desde Admin → Pedidos → Nuevo. Reutiliza
 * TAL CUAL el mismo `placeOrder` del checkout público — valida horario, zona,
 * restringidos y stock, y calcula todo en el servidor exactamente igual.
 */
export async function createInternalOrderAction(
  input: Omit<CheckoutInput, "channel">,
): Promise<InternalOrderResult> {
  try {
    await requirePermission("orders.manage");
    const result = await placeOrder({ ...input, channel: "manual" });
    revalidatePath("/admin/pedidos");
    const redirectUrl =
      "redirectUrl" in result.payment ? ((result.payment as { redirectUrl: string | null }).redirectUrl) : null;
    return { ok: true, orderId: result.orderId, number: result.number, redirectUrl };
  } catch (e) {
    if (e instanceof CheckoutError) {
      return { ok: false, message: e.message, violations: e.violations };
    }
    if (e instanceof InsufficientStockError) {
      return {
        ok: false,
        message: `No hay suficiente stock de ${e.variantName} (disponible: ${e.available}). Ajusta la cantidad.`,
      };
    }
    console.error("createInternalOrderAction error", e);
    return { ok: false, message: "No pudimos crear el pedido. Inténtalo de nuevo." };
  }
}
