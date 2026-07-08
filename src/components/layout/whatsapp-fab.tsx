"use client";

import { usePathname } from "next/navigation";
import { useCart, lineTotal } from "@/components/cart/cart-context";
import { formatCop, qtyLabel } from "@/lib/format";

/**
 * Botón flotante de pedido directo por WhatsApp.
 * Si hay productos en el carrito, arma un mensaje con la lista y el total;
 * si está vacío, abre un saludo para pedir por chat. Se oculta en el checkout
 * (allí el flujo es el formulario) y en las rutas que no son de tienda.
 */
export function WhatsAppFab({ phone, brandName }: { phone: string; brandName: string }) {
  const { items, totalCop, hasWeightItems } = useCart();
  const pathname = usePathname();

  if (!phone || phone === "PENDIENTE") return null;
  if (pathname.startsWith("/checkout") || pathname.startsWith("/pago-sandbox")) return null;

  let text: string;
  if (items.length > 0) {
    const lines = items
      .map((i) => `• ${i.productName} (${i.variantName}) — ${qtyLabel(i.qty, i.saleUnit)} · ${formatCop(lineTotal(i))}`)
      .join("\n");
    text =
      `¡Hola ${brandName}! 🛒 Quiero hacer este pedido:\n\n${lines}\n\n` +
      `Total${hasWeightItems ? " estimado" : ""}: ${formatCop(totalCop)}\n\n` +
      `Mi dirección y forma de pago son:`;
  } else {
    text = `¡Hola ${brandName}! 🛒 Quiero hacer un pedido a domicilio.`;
  }

  const href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Pedir por WhatsApp"
      className="fixed right-4 bottom-20 z-40 flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 font-bold text-white shadow-lg transition hover:brightness-95 md:bottom-6"
    >
      <svg viewBox="0 0 32 32" width="24" height="24" fill="currentColor" aria-hidden>
        <path d="M16 3C9 3 3.5 8.5 3.5 15.5c0 2.4.7 4.7 1.9 6.7L3 29l7-1.8c1.9 1 4 1.6 6 1.6 7 0 12.5-5.5 12.5-12.5S23 3 16 3zm0 22.8c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-4.1 1 1.1-4-.3-.4a10.3 10.3 0 01-1.6-5.6C5.5 9.7 10.2 5 16 5s10.5 4.7 10.5 10.5S21.8 25.8 16 25.8zm5.8-7.8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.4 8.4 0 01-2.5-1.5 9.3 9.3 0 01-1.7-2.1c-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.5s.1-.4 0-.6-.7-1.7-1-2.3c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.1 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.9-.8 2.1-1.5.3-.7.3-1.4.2-1.5s-.3-.2-.6-.3z"/>
      </svg>
      <span className="text-sm">Pedir por WhatsApp</span>
    </a>
  );
}
