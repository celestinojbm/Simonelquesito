import Link from "next/link";
import type { PanelBlock } from "@/modules/admin/blocks";

/**
 * Muestra los bloques personalizados del inicio del panel (Nivel 3), en orden.
 * Tipos: título, texto, botón/enlace, imagen (por enlace) y separador. Es un
 * componente de servidor puro; el contenido lo define el dueño desde
 * Configuración → Panel.
 */
export function PanelBlocks({ blocks }: { blocks: PanelBlock[] }) {
  if (!blocks.length) return null;
  return (
    <section aria-label="Panel personalizado" className="flex flex-col gap-3 rounded-card border border-brand-soft bg-white p-4">
      {blocks.map((b) => {
        if (b.type === "divider") return <hr key={b.id} className="border-brand-soft" />;
        if (b.type === "heading") {
          return (
            <h2 key={b.id} className="text-lg font-extrabold text-ink" style={b.color ? { color: b.color } : undefined}>
              {b.text || "Título"}
            </h2>
          );
        }
        if (b.type === "text") {
          return <p key={b.id} className="text-sm text-ink-soft">{b.text}</p>;
        }
        if (b.type === "image") {
          if (!b.url) return null;
          // eslint-disable-next-line @next/next/no-img-element
          return <img key={b.id} src={b.url} alt={b.text || ""} className="max-h-64 w-full rounded-lg object-cover" />;
        }
        if (b.type === "links") {
          const items = (b.items ?? []).filter((it) => it.label && it.href);
          if (!items.length && !b.text) return null;
          return (
            <div key={b.id} className="flex flex-col gap-2">
              {b.text && <p className="text-sm font-bold text-ink">{b.text}</p>}
              <div className="flex flex-wrap gap-2">
                {items.map((it, k) =>
                  it.href.startsWith("/") ? (
                    <Link key={k} href={it.href} className="rounded-full border border-brand-soft bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand-dark hover:bg-brand hover:text-white">
                      {it.label}
                    </Link>
                  ) : (
                    <a key={k} href={it.href} target="_blank" rel="noopener noreferrer" className="rounded-full border border-brand-soft bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand-dark hover:bg-brand hover:text-white">
                      {it.label}
                    </a>
                  ),
                )}
              </div>
            </div>
          );
        }
        if (b.type === "button") {
          const label = b.text || "Ver más";
          const href = b.href || "#";
          const cls = "inline-block w-fit rounded-full px-4 py-2 text-sm font-bold text-white";
          const style = { backgroundColor: b.color || "var(--color-brand)" };
          return href.startsWith("/") ? (
            <Link key={b.id} href={href} className={cls} style={style}>{label}</Link>
          ) : (
            <a key={b.id} href={href} target="_blank" rel="noopener noreferrer" className={cls} style={style}>{label}</a>
          );
        }
        return null;
      })}
    </section>
  );
}
