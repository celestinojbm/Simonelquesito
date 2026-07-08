"use client";

import Link from "next/link";
import { useCart } from "@/components/cart/cart-context";
import { formatCop } from "@/lib/format";

/** Botón de carrito persistente (visible en el header en todas las pantallas). */
export function CartButton() {
  const { count, totalCop } = useCart();
  return (
    <Link
      href="/carrito"
      className="btn relative flex shrink-0 items-center gap-2 rounded-full bg-cream px-4 py-2 font-semibold text-brand-dark shadow-sm transition hover:bg-brand-soft"
      aria-label={`Carrito: ${count} productos, total ${formatCop(totalCop)}`}
    >
      <span aria-hidden>🛒</span>
      <span className="hidden text-sm sm:inline">{formatCop(totalCop)}</span>
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-coral text-xs font-bold text-white">
          {count}
        </span>
      )}
    </Link>
  );
}
