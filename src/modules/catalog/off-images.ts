/**
 * Open Food Facts como fuente de fotos presentables del catálogo.
 *
 * Reglas de la casa:
 * - NUNCA se publica una foto automáticamente por búsqueda de nombre: la
 *   herramienta muestra candidatas y el personal elige (el nombre puede
 *   traer un producto parecido pero equivocado). Por código de barras la
 *   coincidencia es exacta y sí se usa directo (asistente de productos).
 * - Rate limit de OFF: búsqueda ≈10 req/min — la interfaz busca producto
 *   por producto, no en ráfaga.
 * - Licencia: las fotos de OFF son CC-BY-SA → se guarda la atribución en
 *   product_images.credit y se muestra en la ficha del producto.
 */

export const OFF_CREDIT = "Foto: Open Food Facts (CC-BY-SA)";

const OFF_HEADERS = {
  // Etiqueta de cortesía que pide Open Food Facts para identificar apps.
  "user-agent": "MarketCastilla-PWA/1.0 (tienda de barrio, Colombia)",
};

export type OffCandidate = {
  imageUrl: string;
  productName: string;
  brand: string | null;
  via: "barcode" | "search";
};

/** Solo se descargan imágenes de los dominios de Open Food Facts (anti-SSRF). */
export function isOffImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)openfoodfacts\.org$/.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Candidatas de foto para un producto: por código de barras (exacto) y/o por
 * búsqueda de nombre (hasta `limit`). No descarga nada — devuelve las URLs
 * para que el personal las vea y elija.
 */
export async function offImageCandidates(params: {
  barcode?: string | null;
  name: string;
  limit?: number;
}): Promise<{ candidates: OffCandidate[]; rateLimited: boolean }> {
  const limit = params.limit ?? 4;
  const candidates: OffCandidate[] = [];
  let rateLimited = false;

  try {
    if (params.barcode) {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(params.barcode)}.json?fields=image_front_url,product_name,brands`,
        { headers: OFF_HEADERS },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          product?: { image_front_url?: string; product_name?: string; brands?: string };
        };
        if (data.product?.image_front_url) {
          candidates.push({
            imageUrl: data.product.image_front_url,
            productName: data.product.product_name ?? params.name,
            brand: data.product.brands ?? null,
            via: "barcode",
          });
        }
      }
    }

    if (candidates.length < limit) {
      const q = encodeURIComponent(params.name);
      const res = await fetch(
        `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=${limit + 2}&fields=image_front_url,product_name,brands`,
        { headers: OFF_HEADERS },
      );
      if (res.status === 503 || res.status === 429) {
        rateLimited = true;
      } else if (res.ok) {
        const data = (await res.json()) as {
          products?: { image_front_url?: string; product_name?: string; brands?: string }[];
        };
        for (const p of data.products ?? []) {
          if (!p.image_front_url || !isOffImageUrl(p.image_front_url)) continue;
          if (candidates.some((c) => c.imageUrl === p.image_front_url)) continue;
          candidates.push({
            imageUrl: p.image_front_url,
            productName: p.product_name ?? params.name,
            brand: p.brands ?? null,
            via: "search",
          });
          if (candidates.length >= limit) break;
        }
      }
    }
  } catch {
    // Sin red / caída de OFF: se devuelve lo que haya (posiblemente vacío).
  }

  return { candidates, rateLimited };
}

/** Descarga una imagen de OFF y la convierte a data-URI (≤900 KB). */
export async function downloadOffImage(url: string): Promise<string | null> {
  if (!isOffImageUrl(url)) return null;
  try {
    const res = await fetch(url, { headers: OFF_HEADERS });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/image\/(jpeg|png|webp)/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 900_000) return null;
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
