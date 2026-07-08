"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Pestañas de la sección Dashboard: «Resumen» (foto de hoy, /admin) y
 * «Analítica» (histórico con filtros, /admin/analitica). Ambas viven bajo el
 * mismo ítem del menú lateral. El <h1> visualmente oculto da un encabezado
 * accesible por página.
 */
export function DashboardTabs() {
  const pathname = usePathname();
  const onAnalitica = pathname.startsWith("/admin/analitica");

  const tab = (active: boolean) =>
    `btn rounded-full px-4 py-2 text-sm font-semibold transition ${
      active ? "bg-brand text-white" : "text-ink-soft hover:bg-brand-soft"
    }`;

  return (
    <div>
      <h1 className="sr-only">Panel — {onAnalitica ? "Analítica" : "Resumen"}</h1>
      <div className="inline-flex gap-1 rounded-full border border-brand-soft bg-white p-1" role="tablist" aria-label="Vista del panel">
        <Link href="/admin" role="tab" aria-selected={!onAnalitica} aria-current={!onAnalitica ? "page" : undefined} className={tab(!onAnalitica)}>
          📊 Resumen
        </Link>
        <Link href="/admin/analitica" role="tab" aria-selected={onAnalitica} aria-current={onAnalitica ? "page" : undefined} className={tab(onAnalitica)}>
          📈 Analítica
        </Link>
      </div>
    </div>
  );
}
