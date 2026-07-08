"use client";

import Link from "next/link";
import { useState } from "react";
import { applyCatalogImageAction } from "@/app/actions/product-images";

/**
 * Búsqueda y descarga DESDE EL NAVEGADOR (la API de Open Food Facts permite
 * CORS *): así se usa la IP de la tienda —con su límite propio (~10
 * búsquedas/min)— y no la IP compartida del servidor (Vercel), que OFF
 * bloquea casi de inmediato por ser de datacenter. El servidor solo recibe
 * la foto YA elegida (data-URI) y la guarda con su atribución.
 */

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  barcode: string | null;
  query: string;
};

type Candidate = { imageUrl: string; productName: string; brand: string | null; via: "barcode" | "search" };

type RowState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "candidates"; candidates: Candidate[] }
  | { kind: "empty" }
  | { kind: "ratelimited" }
  | { kind: "applying" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const isOffImage = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)openfoodfacts\.org$/.test(u.hostname);
  } catch {
    return false;
  }
};

/** Busca candidatas en OFF desde el navegador. */
async function searchOff(row: ProductRow): Promise<{ candidates: Candidate[]; rateLimited: boolean }> {
  const candidates: Candidate[] = [];
  let rateLimited = false;

  if (row.barcode) {
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(row.barcode)}.json?fields=image_front_url,product_name,brands`,
      );
      if (res.ok) {
        const data = (await res.json()) as { product?: { image_front_url?: string; product_name?: string; brands?: string } };
        if (data.product?.image_front_url && isOffImage(data.product.image_front_url)) {
          candidates.push({
            imageUrl: data.product.image_front_url,
            productName: data.product.product_name ?? row.name,
            brand: data.product.brands ?? null,
            via: "barcode",
          });
        }
      }
    } catch { /* sigue con la búsqueda por nombre */ }
  }

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(row.query)}&search_simple=1&action=process&json=1&page_size=6&fields=image_front_url,product_name,brands`,
    );
    if (res.status === 503 || res.status === 429) {
      rateLimited = true;
    } else if (res.ok) {
      const data = (await res.json()) as { products?: { image_front_url?: string; product_name?: string; brands?: string }[] };
      for (const p of data.products ?? []) {
        if (!p.image_front_url || !isOffImage(p.image_front_url)) continue;
        if (candidates.some((c) => c.imageUrl === p.image_front_url)) continue;
        candidates.push({ imageUrl: p.image_front_url, productName: p.product_name ?? row.query, brand: p.brands ?? null, via: "search" });
        if (candidates.length >= 4) break;
      }
    }
  } catch {
    /* sin red: quedará "empty" o lo que haya del código de barras */
  }
  return { candidates, rateLimited };
}

/** Descarga la imagen elegida EN EL NAVEGADOR y la normaliza (≤800px JPEG). */
async function offImageToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    const bitmap = await createImageBitmap(blob);
    const MAX = 800;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return dataUrl.length > 1_400_000 ? null : dataUrl;
  } catch {
    return null;
  }
}

export function ImagenesClient({ products }: { products: ProductRow[] }) {
  const [state, setState] = useState<Record<string, RowState>>({});
  const set = (id: string, s: RowState) => setState((prev) => ({ ...prev, [id]: s }));

  const search = async (p: ProductRow) => {
    set(p.id, { kind: "searching" });
    const r = await searchOff(p);
    if (r.rateLimited && r.candidates.length === 0) return set(p.id, { kind: "ratelimited" });
    if (r.candidates.length === 0) return set(p.id, { kind: "empty" });
    set(p.id, { kind: "candidates", candidates: r.candidates });
  };

  const apply = async (p: ProductRow, c: Candidate) => {
    set(p.id, { kind: "applying" });
    const dataUrl = await offImageToDataUrl(c.imageUrl);
    if (!dataUrl) return set(p.id, { kind: "error", message: "No se pudo descargar la imagen. Reintenta." });
    const r = await applyCatalogImageAction({ productId: p.id, dataUrl, sourceUrl: c.imageUrl });
    if (!r.ok) return set(p.id, { kind: "error", message: r.message });
    // La fila queda con "Foto aplicada" (feedback claro); sale de la lista
    // en la próxima carga de la página.
    set(p.id, { kind: "done" });
  };

  return (
    <ul className="space-y-2">
      {products.map((p) => {
        const s = state[p.id] ?? { kind: "idle" };
        return (
          <li key={p.id} className="rounded-card border border-brand-soft bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-ink">{p.name}</span>{" "}
                <span className="text-xs text-ink-soft">
                  {p.brand ? `${p.brand} · ` : ""}{p.category}
                  {p.barcode && " · 📊 con código de barras"}
                </span>
              </span>

              {s.kind === "idle" && (
                <button
                  type="button"
                  onClick={() => void search(p)}
                  className="btn rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white"
                >
                  🔎 Buscar fotos
                </button>
              )}
              {s.kind === "searching" && <span className="text-xs text-ink-soft">Buscando en Open Food Facts…</span>}
              {s.kind === "applying" && <span className="text-xs text-ink-soft">Descargando y aplicando…</span>}
              {s.kind === "done" && <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand-dark">✅ Foto aplicada</span>}
              {s.kind === "empty" && (
                <span className="text-xs text-ink-soft">
                  Sin resultados con foto — toma una con el celular desde{" "}
                  <Link href="/admin/productos/asistente" className="font-semibold text-brand-dark underline">el asistente</Link>.
                </span>
              )}
              {s.kind === "ratelimited" && (
                <span className="text-xs font-medium text-coral-dark">
                  Open Food Facts limitó las búsquedas (~10 por minuto) — espera un momento.
                </span>
              )}
              {s.kind === "error" && <span className="text-xs font-medium text-coral-dark">⚠️ {s.message}</span>}
              {(s.kind === "empty" || s.kind === "ratelimited" || s.kind === "error") && (
                <button
                  type="button"
                  onClick={() => void search(p)}
                  className="btn rounded-full border border-brand-soft px-3 py-1 text-xs text-ink-soft"
                >
                  Reintentar
                </button>
              )}
            </div>

            {s.kind === "candidates" && (
              <div className="mt-3 flex flex-wrap gap-3">
                {s.candidates.map((c) => (
                  <figure key={c.imageUrl} className="w-36">
                    {/* Vista previa remota de OFF para ELEGIR; al aplicar se descarga
                        en el navegador y se guarda como foto propia. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.imageUrl}
                      alt={c.productName}
                      className="h-36 w-36 rounded-lg border border-brand-soft bg-white object-contain"
                      loading="lazy"
                    />
                    <figcaption className="mt-1 truncate text-[11px] text-ink-soft" title={`${c.productName}${c.brand ? ` · ${c.brand}` : ""}`}>
                      {c.via === "barcode" ? "📊 " : ""}{c.productName}{c.brand ? ` · ${c.brand}` : ""}
                    </figcaption>
                    <button
                      type="button"
                      onClick={() => void apply(p, c)}
                      className="btn mt-1 w-full rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-white"
                    >
                      Usar esta
                    </button>
                  </figure>
                ))}
                <button
                  type="button"
                  onClick={() => set(p.id, { kind: "idle" })}
                  className="btn self-start rounded-full border border-brand-soft px-3 py-1 text-xs text-ink-soft"
                >
                  Ninguna sirve
                </button>
              </div>
            )}
          </li>
        );
      })}
      {products.length === 0 && (
        <li className="rounded-card border border-brand-soft bg-white p-6 text-center text-sm text-ink-soft">
          🎉 Todo el catálogo tiene foto presentable.
        </li>
      )}
    </ul>
  );
}
