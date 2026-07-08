"use server";

import { placeOrder, CheckoutError, type CheckoutInput } from "@/modules/orders/checkout";
import { InsufficientStockError } from "@/modules/inventory/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { customerForUser } from "@/modules/accounts/service";
import { getSetting } from "@/modules/config/service";

export type CheckoutActionResult =
  | { ok: true; orderId: string; number: string; redirectUrl: string | null }
  | { ok: false; message: string; violations?: string[] };

export async function checkoutAction(input: CheckoutInput): Promise<CheckoutActionResult> {
  if (!rateLimit(`checkout:${input.contactPhone}`, 8, 60_000)) {
    return { ok: false, message: "Demasiados intentos. Espera un momento e inténtalo de nuevo." };
  }
  try {
    // El vínculo con la cuenta se decide en el SERVIDOR (nunca desde el cliente).
    const user = await getSessionUser();
    const customer = user ? await customerForUser(user.id) : null;
    if (!customer && (await getSetting("accounts.requireForCheckout"))) {
      return { ok: false, message: "Para comprar necesitas ingresar con tu celular (menú Cuenta)." };
    }
    const result = await placeOrder({ ...input, customerId: customer?.id });
    const redirectUrl =
      "redirectUrl" in result.payment ? ((result.payment as { redirectUrl: string | null }).redirectUrl) : null;
    return {
      ok: true,
      orderId: result.orderId,
      number: result.number,
      // Solo las rutas internas (sandbox) llevan ?order=; una URL externa de
      // pasarela (Mercado Pago) ya trae sus propios parámetros y va tal cual.
      redirectUrl: redirectUrl
        ? redirectUrl.startsWith("/")
          ? `${redirectUrl}?order=${result.orderId}`
          : redirectUrl
        : null,
    };
  } catch (e) {
    if (e instanceof CheckoutError) {
      return { ok: false, message: e.message, violations: e.violations };
    }
    if (e instanceof InsufficientStockError) {
      return {
        ok: false,
        message: `No hay suficiente stock de ${e.variantName} (disponible: ${e.available}). Ajusta la cantidad en el carrito.`,
      };
    }
    console.error("checkoutAction error", e);
    return { ok: false, message: "No pudimos crear tu pedido. Inténtalo de nuevo." };
  }
}
