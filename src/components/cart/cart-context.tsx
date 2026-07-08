"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartItem = {
  variantId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  saleUnit: string;
  /** Unidades para unit/pack; gramos o ml para peso/volumen. */
  qty: number;
  unitPriceCop: number;
  soldByWeight: boolean;
  isRestricted: boolean;
  restrictedRuleKey: string | null;
  imageUrl: string | null;
  note?: string;
};

type CartContextValue = {
  items: CartItem[];
  add: (item: CartItem) => void;
  updateQty: (variantId: string, qty: number) => void;
  updateNote: (variantId: string, note: string) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  totalCop: number;
  count: number;
  hasWeightItems: boolean;
  hasRestrictedItems: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "mc_cart_v1";

export function lineTotal(item: CartItem): number {
  if (item.saleUnit === "kg" || item.saleUnit === "g" || item.saleUnit === "l" || item.saleUnit === "ml") {
    return Math.round((item.unitPriceCop * item.qty) / 1000);
  }
  return item.unitPriceCop * item.qty;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      /* carrito corrupto: se descarta */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, loaded]);

  const value = useMemo<CartContextValue>(() => {
    const totalCop = items.reduce((s, i) => s + lineTotal(i), 0);
    return {
      items,
      add: (item) =>
        setItems((prev) => {
          const existing = prev.find((i) => i.variantId === item.variantId);
          if (existing) {
            return prev.map((i) =>
              i.variantId === item.variantId ? { ...i, qty: i.qty + item.qty } : i,
            );
          }
          return [...prev, item];
        }),
      updateQty: (variantId, qty) =>
        setItems((prev) =>
          qty <= 0
            ? prev.filter((i) => i.variantId !== variantId)
            : prev.map((i) => (i.variantId === variantId ? { ...i, qty } : i)),
        ),
      updateNote: (variantId, note) =>
        setItems((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, note } : i))),
      remove: (variantId) => setItems((prev) => prev.filter((i) => i.variantId !== variantId)),
      clear: () => setItems([]),
      totalCop,
      count: items.length,
      hasWeightItems: items.some((i) => i.soldByWeight),
      hasRestrictedItems: items.some((i) => i.isRestricted),
    };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de <CartProvider>");
  return ctx;
}
