"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCop, unitPriceLabel } from "@/lib/format";
import { smartMatch } from "@/lib/search";
import { ProductThumb } from "@/components/product-thumb";
import { ProductRowActions } from "./product-row-actions";

export type ProductRow = {
  productId: string;
  slug: string;
  name: string;
  isActive: boolean;
  categoryName: string;
  categoryIcon: string | null;
  isRestricted: boolean;
  variantName: string;
  saleUnit: string;
  priceCop: number;
  sku: string | null;
  barcode: string | null;
  imageId: string | null;
  imageUrl: string | null;
};

/**
 * Lista de productos con búsqueda EN VIVO: filtra mientras escribes (sin botón
 * «Buscar»), ignorando mayúsculas/acentos y aceptando palabras parciales en
 * cualquier orden. Filtra sobre nombre, presentación, categoría, SKU y código
 * de barras.
 */
export function ProductsBrowser({ rows }: { rows: ProductRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim();
    if (!query) return rows;
    const matched = rows.filter((r) =>
      smartMatch(`${r.name} ${r.variantName} ${r.categoryName} ${r.sku ?? ""} ${r.barcode ?? ""}`, query),
    );
    // Al buscar, orden alfabético; sin buscar, respeta el orden del servidor.
    return [...matched].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [q, rows]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          placeholder="Escribe para buscar: nombre, SKU o código de barras…"
          className="min-w-64 flex-1 rounded-full border border-brand-soft bg-white px-4 py-2 text-sm focus:border-brand"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="btn rounded-full border border-brand-soft px-4 py-2 text-sm text-ink-soft"
          >
            Limpiar
          </button>
        )}
      </div>
      <p className="text-sm text-ink-soft">
        {q.trim()
          ? filtered.length === 0
            ? `Sin resultados para “${q.trim()}”.`
            : `${filtered.length} resultado${filtered.length === 1 ? "" : "s"} para “${q.trim()}”.`
          : `${rows.length} producto${rows.length === 1 ? "" : "s"}.`}
      </p>

      <section className="overflow-x-auto rounded-card border border-brand-soft bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-brand-soft bg-brand-soft/50 text-xs text-ink-soft uppercase">
            <tr>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Categoría</th>
              <th className="px-4 py-3">Códigos</th>
              <th className="px-4 py-3 text-right">Precio</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-soft">
            {filtered.map((r) => (
              <tr key={`${r.productId}-${r.variantName}`} className={`hover:bg-brand-soft/30 ${r.isActive ? "" : "bg-ink/5"}`}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    <ProductThumb
                      imageUrl={r.imageId && r.imageUrl ? (r.imageUrl.startsWith("data:") ? `/api/images/${r.imageId}` : r.imageUrl) : null}
                      icon={r.categoryIcon}
                      alt={r.name}
                      size={44}
                    />
                    <div className="min-w-0">
                      <Link href={`/producto/${r.slug}`} className="font-medium text-brand-dark hover:underline">
                        {r.name}
                      </Link>
                      {r.isRestricted && <span className="ml-1 text-xs font-bold text-liquor">+18</span>}
                      {!r.isActive && <span className="ml-1 rounded-full bg-ink/15 px-2 py-0.5 text-[10px] font-bold text-ink-soft">oculto</span>}
                      <p className="text-xs text-ink-soft">{r.variantName}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2 text-xs">{r.categoryIcon} {r.categoryName}</td>
                <td className="px-4 py-2 text-xs text-ink-soft">
                  {r.sku ?? "—"}{r.barcode ? ` · ${r.barcode}` : ""}
                </td>
                <td className="px-4 py-2 text-right font-semibold">
                  {r.saleUnit === "kg" || r.saleUnit === "g" ? unitPriceLabel(r.priceCop, r.saleUnit) : formatCop(r.priceCop)}
                </td>
                <td className="px-4 py-2">
                  <ProductRowActions productId={r.productId} isActive={r.isActive} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-ink-soft">
                  {q.trim() ? "Prueba con menos palabras o revisa el código." : "No hay productos todavía."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
