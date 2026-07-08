"use client";

import { useCart, type CartItem } from "@/components/cart/cart-context";
import { qtyStep, qtyLabel } from "@/lib/format";

/**
 * Botón añadir + selector de cantidad.
 * Para productos por peso el paso es de 250 g / 250 ml.
 */
export function AddToCart({ item, compact = false }: { item: Omit<CartItem, "qty"> & { qty: number }; compact?: boolean }) {
  const { items, add, updateQty } = useCart();
  const inCart = items.find((i) => i.variantId === item.variantId);
  const step = qtyStep(item.saleUnit);

  if (!inCart) {
    return (
      <button
        type="button"
        onClick={() => add({ ...item, qty: step })}
        className={`btn w-full rounded-full bg-brand font-semibold text-white transition hover:bg-brand-dark ${
          compact ? "py-2 text-sm" : "py-3"
        }`}
      >
        Agregar
      </button>
    );
  }

  return (
    <div className="flex w-full items-center justify-between rounded-full border-2 border-brand bg-brand-soft px-1 py-0.5">
      <button
        type="button"
        aria-label="Quitar uno"
        onClick={() => updateQty(item.variantId, inCart.qty - step)}
        className="h-10 w-10 rounded-full font-bold text-brand-dark hover:bg-white"
      >
        −
      </button>
      <span className="text-sm font-bold text-brand-dark" aria-live="polite">
        {qtyLabel(inCart.qty, item.saleUnit)}
      </span>
      <button
        type="button"
        aria-label="Agregar uno"
        onClick={() => updateQty(item.variantId, inCart.qty + step)}
        className="h-10 w-10 rounded-full font-bold text-brand-dark hover:bg-white"
      >
        +
      </button>
    </div>
  );
}
