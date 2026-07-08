"use client";

import Link from "next/link";
import Image from "next/image";
import { useCart, lineTotal } from "@/components/cart/cart-context";
import { formatCop, qtyLabel, qtyStep } from "@/lib/format";

export default function CartPage() {
  const { items, updateQty, updateNote, remove, totalCop, hasWeightItems } = useCart();

  if (items.length === 0) {
    return (
      <div className="rounded-card border border-brand-soft bg-white p-10 text-center text-ink-soft">
        <p className="text-4xl">🛒</p>
        <h1 className="mt-2 text-lg font-bold text-ink">Tu carrito está vacío</h1>
        <p className="mt-1 text-sm">Agrega frutas frescas, abarrotes y lo que necesites.</p>
        <Link href="/" className="btn mt-4 inline-block rounded-full bg-brand px-6 py-3 font-semibold text-white">
          Ir a comprar
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-extrabold text-ink">Tu carrito</h1>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.variantId} className="flex gap-3 rounded-card border border-brand-soft bg-white p-3">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-brand-soft">
              {item.imageUrl && <Image src={item.imageUrl} alt="" fill className="object-cover" sizes="80px" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/producto/${item.productSlug}`} className="font-semibold text-ink hover:underline">
                    {item.productName}
                  </Link>
                  <p className="text-xs text-ink-soft">{item.variantName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(item.variantId)}
                  aria-label={`Quitar ${item.productName}`}
                  className="min-h-0 rounded-full px-2 text-ink-soft hover:bg-brand-soft"
                >
                  ✕
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center rounded-full border border-brand-soft">
                  <button
                    type="button"
                    aria-label="Disminuir"
                    onClick={() => updateQty(item.variantId, item.qty - qtyStep(item.saleUnit))}
                    className="h-10 w-10 rounded-full font-bold text-brand-dark hover:bg-brand-soft"
                  >
                    −
                  </button>
                  <span className="min-w-[64px] text-center text-sm font-bold text-ink">
                    {qtyLabel(item.qty, item.saleUnit)}
                  </span>
                  <button
                    type="button"
                    aria-label="Aumentar"
                    onClick={() => updateQty(item.variantId, item.qty + qtyStep(item.saleUnit))}
                    className="h-10 w-10 rounded-full font-bold text-brand-dark hover:bg-brand-soft"
                  >
                    +
                  </button>
                </div>
                <p className="font-bold text-brand-dark">
                  {formatCop(lineTotal(item))}
                  {item.soldByWeight && <span className="ml-1 text-xs font-normal text-ink-soft">aprox.</span>}
                </p>
              </div>
              {item.soldByWeight && (
                <input
                  type="text"
                  value={item.note ?? ""}
                  onChange={(e) => updateNote(item.variantId, e.target.value)}
                  placeholder="Nota: ej. “aguacates maduros”"
                  maxLength={200}
                  className="mt-2 w-full rounded-lg border border-brand-soft px-3 py-2 text-sm"
                />
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-card border border-brand-soft bg-white p-4">
        <div className="flex items-center justify-between text-lg font-bold text-ink">
          <span>Total{hasWeightItems ? " estimado" : ""}</span>
          <span className="text-brand-dark">{formatCop(totalCop)}</span>
        </div>
        {hasWeightItems && (
          <p className="mt-1 text-xs text-ink-soft">
            ⚖️ Tu carrito tiene productos por peso: el valor final se ajusta con el peso real al preparar el pedido.
          </p>
        )}
        <p className="mt-1 text-xs text-ink-soft">El costo de envío se calcula en el checkout según tu zona.</p>
        <Link
          href="/checkout"
          className="btn mt-3 block w-full rounded-full bg-coral py-3 text-center font-bold text-white transition hover:bg-coral-dark"
        >
          Ir a pagar
        </Link>
      </div>
    </div>
  );
}
