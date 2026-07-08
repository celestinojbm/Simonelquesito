"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";

type NavItem = { href: string; label: string; icon: string; activeFor?: string[] };

/** Clases de texto según el tono de la barra (oscura → texto claro; clara → texto oscuro). */
type Tone = "light" | "dark"; // color del texto: "light" = texto claro (barra oscura)

/**
 * Navegación del panel con resaltado de la sección activa. Coincidencia por
 * prefijo (una sub-página como /admin/productos/imagenes mantiene marcada
 * "Productos"); el Dashboard (/admin) coincide solo exacto para no quedar
 * activo en todas las rutas. `activeFor` añade rutas extra que también
 * activan el ítem (ej. Dashboard se activa en /admin/analitica).
 */
export function AdminNav({ items, tone = "light" }: { items: NavItem[]; tone?: Tone }) {
  const pathname = usePathname();

  const matches = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);

  const isActive = (item: NavItem) => matches(item.href) || (item.activeFor ?? []).some(matches);

  const dark = tone === "dark"; // barra clara → texto oscuro
  const idle = dark ? "font-medium text-ink-soft hover:bg-black/5 hover:text-ink" : "font-medium text-brand-soft hover:bg-white/10 hover:text-white";
  const activeCls = dark ? "bg-black/10 font-semibold text-ink shadow-inner" : "bg-white/15 font-semibold text-white shadow-inner";

  return (
    <nav aria-label="Panel" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
      {items.map((n) => {
        const active = isActive(n);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`btn flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${active ? activeCls : idle}`}
          >
            <span aria-hidden>{n.icon}</span> {n.label}
          </Link>
        );
      })}
      <form action={logoutAction} className="md:mt-4">
        <button
          type="submit"
          className={`btn flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${dark ? "text-ink-soft hover:bg-black/5" : "text-brand-soft hover:bg-white/10"}`}
        >
          🚪 Salir
        </button>
      </form>
    </nav>
  );
}
