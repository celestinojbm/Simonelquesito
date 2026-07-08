import Link from "next/link";

/**
 * Botón «Atrás» para las páginas de detalle del panel (las que se abren
 * desde una lista). Enlace explícito al padre — más predecible que el
 * "atrás" del navegador, que podría llevar a cualquier parte.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="btn mb-3 inline-flex items-center gap-1.5 rounded-full border border-brand-soft bg-white px-4 py-1.5 text-sm font-semibold text-brand-dark hover:bg-brand-soft"
    >
      <span aria-hidden>←</span> {label}
    </Link>
  );
}
