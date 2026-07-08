import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";

/**
 * Agente de alta de productos: el personal le toma una FOTO al producto
 * físico (o le dicta/escribe), el agente lo identifica con visión, propone
 * la ficha (nombre, marca, categoría, precio si se menciona) y busca una
 * FOTO PRESENTABLE del mismo producto para publicar en el catálogo.
 *
 * Fuente de fotos: Open Food Facts (base abierta de productos con imágenes
 * bajo licencia abierta, consultable por código de barras o nombre). No se
 * hace scraping de sitios de terceros: solo fuentes abiertas.
 */

const MODEL = "claude-opus-4-8";

export type ProductProposal = {
  name: string;
  brand: string | null;
  description: string | null;
  categorySlug: string;
  barcode: string | null;
  /** Precio en COP si el usuario lo mencionó (foto de etiqueta, voz o texto). */
  priceCop: number | null;
  saleType: "unit" | "pack" | "libra";
  confidence: "alta" | "media" | "baja";
  notes: string | null;
};

export function productAgentConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Identifica el producto a partir de foto y/o texto (dictado o escrito).
 * Devuelve una propuesta editable — el personal SIEMPRE confirma antes de crear.
 */
export async function identifyProduct(params: {
  imageDataUrl?: string;
  text?: string;
}): Promise<ProductProposal> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY: el agente de productos necesita la IA configurada.");
  if (!params.imageDataUrl && !params.text?.trim()) {
    throw new Error("Envía una foto del producto o descríbelo.");
  }

  const categories = await db.query.categories.findMany();
  const categoryList = categories.map((c) => `${c.slug} (${c.name})`).join(", ");

  const client = new Anthropic({ apiKey });

  const content: Anthropic.ContentBlockParam[] = [];
  if (params.imageDataUrl) {
    const match = params.imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!match) throw new Error("Formato de imagen no soportado (usa JPG/PNG).");
    content.push({
      type: "image",
      source: { type: "base64", media_type: match[1] as "image/jpeg" | "image/png" | "image/webp", data: match[2]! },
    });
  }
  content.push({
    type: "text",
    text: `Identifica este producto de tienda de barrio colombiana${params.text ? ` (el tendero dice: "${params.text}")` : ""}.

Devuelve SOLO un JSON válido con esta forma exacta:
{"name": "nombre comercial corto con presentación, ej. Aceite Diana 250ml", "brand": "marca o null", "description": "una frase de catálogo o null", "categorySlug": "uno de: ${categoryList}", "barcode": "dígitos si son visibles/mencionados o null", "priceCop": entero en pesos si se mencionó o es visible en etiqueta, si no null, "saleType": "unit" | "pack" | "libra" (libra SOLO para frutas/verduras a granel), "confidence": "alta"|"media"|"baja", "notes": "duda breve para el tendero o null"}

Reglas: NO inventes precio ni código de barras — null si no constan. Nombre en español, sin mayúsculas gritadas.`,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No pude identificar el producto. Intenta con mejor luz o descríbelo.");
  const raw = JSON.parse(jsonMatch[0]) as ProductProposal;

  const validSlugs = new Set(categories.map((c) => c.slug));
  return {
    name: String(raw.name ?? "").slice(0, 120),
    brand: raw.brand ? String(raw.brand).slice(0, 60) : null,
    description: raw.description ? String(raw.description).slice(0, 500) : null,
    categorySlug: validSlugs.has(raw.categorySlug) ? raw.categorySlug : "abarrotes",
    barcode: raw.barcode ? String(raw.barcode).replace(/\D/g, "").slice(0, 40) || null : null,
    priceCop: Number.isInteger(raw.priceCop) && (raw.priceCop as number) > 0 ? raw.priceCop : null,
    saleType: ["unit", "pack", "libra"].includes(raw.saleType) ? raw.saleType : "unit",
    confidence: ["alta", "media", "baja"].includes(raw.confidence) ? raw.confidence : "baja",
    notes: raw.notes ? String(raw.notes).slice(0, 200) : null,
  };
}

export type FoundImage = {
  dataUrl: string;
  source: string; // atribución (Open Food Facts)
};

const OFF_HEADERS = {
  // Etiqueta de cortesía que pide Open Food Facts para identificar apps.
  "user-agent": "MarketCastilla-PWA/1.0 (tienda de barrio, Colombia)",
};

async function downloadAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: OFF_HEADERS });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/image\/(jpeg|png|webp)/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 900_000) return null; // límite razonable para data-URI
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Busca una foto presentable del producto en Open Food Facts:
 * 1) por código de barras (exacto), 2) por nombre (mejor coincidencia).
 * Devuelve null si no hay — el catálogo usa el ícono de categoría.
 */
export async function findPresentableImage(params: {
  barcode?: string | null;
  name: string;
}): Promise<FoundImage | null> {
  try {
    if (params.barcode) {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(params.barcode)}.json?fields=image_front_url,product_name`,
        { headers: OFF_HEADERS },
      );
      if (res.ok) {
        const data = (await res.json()) as { status?: number; product?: { image_front_url?: string } };
        const url = data.product?.image_front_url;
        if (url) {
          const dataUrl = await downloadAsDataUrl(url);
          if (dataUrl) return { dataUrl, source: "Open Food Facts (por código de barras)" };
        }
      }
    }

    const q = encodeURIComponent(params.name);
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=5&fields=image_front_url,product_name`,
      { headers: OFF_HEADERS },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { products?: { image_front_url?: string; product_name?: string }[] };
    for (const p of data.products ?? []) {
      if (!p.image_front_url) continue;
      const dataUrl = await downloadAsDataUrl(p.image_front_url);
      if (dataUrl) return { dataUrl, source: `Open Food Facts (búsqueda: ${p.product_name ?? params.name})` };
    }
    return null;
  } catch {
    return null; // sin foto no se bloquea el alta: queda el ícono de categoría
  }
}
