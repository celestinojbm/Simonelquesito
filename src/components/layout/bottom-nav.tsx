"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/components/cart/cart-context";

const items = [
  { href: "/", label: "Inicio", icon: "🏠" },
  { href: "/categorias", label: "Categorías", icon: "🗂️" },
  { href: "/ofertas", label: "Ofertas", icon: "🏷️" },
  { href: "/carrito", label: "Carrito", icon: "🛒" },
  { href: "/cuenta", label: "Cuenta", icon: "👤" },
];

/** Navegación inferior fija en móvil (touch targets ≥44px). */
export function BottomNav() {
  const pathname = usePathname();
  const { count } = useCart();
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-soft bg-cream pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  active ? "text-brand-dark" : "text-ink-soft"
                }`}
              >
                <span className="text-lg leading-none" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
                {item.href === "/carrito" && count > 0 && (
                  <span className="absolute top-1 right-1/2 translate-x-4 rounded-full bg-coral px-1.5 text-[10px] font-bold text-white">
                    {count}
                  </span>
                )}
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-brand" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
