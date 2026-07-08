"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Pestañas de la sección Configuración:
 *  - «Parámetros» (llaves del negocio, /admin/configuracion)
 *  - «Portadas» (fondos y textos de la tienda, /admin/configuracion/fondos)
 *  - «Panel» (personalizar el propio panel, /admin/configuracion/panel)
 * Todas viven bajo el mismo ítem del menú. El <h1> oculto da encabezado accesible.
 */
export function ConfigTabs() {
  const pathname = usePathname();
  const current = pathname.startsWith("/admin/configuracion/fondos")
    ? "fondos"
    : pathname.startsWith("/admin/configuracion/panel")
      ? "panel"
      : "params";

  const label = current === "fondos" ? "Portadas" : current === "panel" ? "Panel" : "Parámetros";
  const tab = (active: boolean) =>
    `btn rounded-full px-4 py-2 text-sm font-semibold transition ${
      active ? "bg-brand text-white" : "text-ink-soft hover:bg-brand-soft"
    }`;

  return (
    <div>
      <h1 className="sr-only">Configuración — {label}</h1>
      <div className="inline-flex flex-wrap gap-1 rounded-full border border-brand-soft bg-white p-1" role="tablist" aria-label="Vista de configuración">
        <Link href="/admin/configuracion" role="tab" aria-selected={current === "params"} aria-current={current === "params" ? "page" : undefined} className={tab(current === "params")}>
          ⚙️ Parámetros
        </Link>
        <Link href="/admin/configuracion/fondos" role="tab" aria-selected={current === "fondos"} aria-current={current === "fondos" ? "page" : undefined} className={tab(current === "fondos")}>
          🖼️ Portadas
        </Link>
        <Link href="/admin/configuracion/panel" role="tab" aria-selected={current === "panel"} aria-current={current === "panel" ? "page" : undefined} className={tab(current === "panel")}>
          🖥️ Panel
        </Link>
      </div>
    </div>
  );
}
