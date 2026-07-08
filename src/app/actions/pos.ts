"use server";

import { eq, sql, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import { normalizeSearch } from "@/lib/search";
import { requirePermission } from "@/lib/auth/session";
import { registerPosSale, PosError } from "@/modules/pos/sale";

/**
 * Acciones de la Caja (tienda física). Permiso: orders.manage — lo tienen
 * cajeros, admin y propietario.
 */

export type PosItem = {
  variantId: string;
  productName: string;
  variantName: string;
  priceCop: number;
  saleUnit: string;
  soldByWeight: boolean;
  isRestricted: boolean;
  barcode: string | null;
  sku: string | null;
  imageUrl: string | null;
};

const itemSelect = {
  variantId: productVariants.id,
  productName: products.name,
  variantName: productVariants.name,
  priceCop: productVariants.priceCop,
  saleUnit: productVariants.saleUnit,
  soldByWeight: productVariants.soldByWeight,
  isRestricted: products.isRestricted,
  barcode: productVariants.barcode,
  sku: productVariants.sku,
  imageId: sql<string | null>`(select id from product_images pi where pi.product_id = ${products.id} order by pi.sort_order asc limit 1)`,
  imageUrl: sql<string | null>`(select url from product_images pi where pi.product_id = ${products.id} order by pi.sort_order asc limit 1)`,
};

/** Las fotos data-URI pesan mucho para viajar en la respuesta: van vía /api/images. */
function lightItem<T extends { imageId: string | null; imageUrl: string | null }>(row: T): Omit<T, "imageId"> {
  const { imageId, ...rest } = row;
  return {
    ...rest,
    imageUrl: imageId && row.imageUrl ? (row.imageUrl.startsWith("data:") ? `/api/images/${imageId}` : row.imageUrl) : null,
  };
}

const activeOnly = and(eq(products.isActive, true), eq(productVariants.isActive, true));

/** Busca por código de barras (lo que lee la pistola) o por SKU exacto. */
export async function posLookupAction(
  code: string,
): Promise<{ ok: true; item: PosItem } | { ok: false; message: string }> {
  try {
    await requirePermission("orders.manage");
    const clean = z.string().min(3).max(40).parse(code.trim());
    const [byCode] = await db
      .select(itemSelect)
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(activeOnly, sql`(${productVariants.barcode} = ${clean} or upper(${productVariants.sku}) = upper(${clean}))`))
      .limit(1);
    if (!byCode) return { ok: false, message: `Ningún producto con el código ${clean}.` };
    return { ok: true, item: lightItem(byCode) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

/** Búsqueda por nombre (para lo pesado en balanza: banano, tomate, …). */
export async function posSearchAction(
  query: string,
): Promise<{ ok: true; items: PosItem[] } | { ok: false; message: string }> {
  try {
    await requirePermission("orders.manage");
    const q = z.string().min(2).max(60).parse(query.trim());
    // Coincidencia parcial, sin acentos y por palabras en cualquier orden:
    // "lim verde" encuentra "Limón verde". unaccent está disponible en la BD.
    const tokens = normalizeSearch(q).split(" ").filter(Boolean).slice(0, 6);
    const tokenClauses = tokens.map(
      (t) => sql`unaccent(lower(${products.name})) like ${"%" + t + "%"}`,
    );
    const items = await db
      .select(itemSelect)
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(activeOnly, ...tokenClauses))
      .orderBy(products.name)
      .limit(8);
    return { ok: true, items: items.map(lightItem) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

/** Registra la venta del mostrador (pedido pos_physical pagado y entregado). */
export async function posSaleAction(input: {
  lines: { variantId: string; qty: number }[];
  method: "cash" | "card" | "transfer";
  idempotencyKey: string;
}): Promise<{ ok: true; number: string; totalCop: number } | { ok: false; message: string }> {
  try {
    const user = await requirePermission("orders.manage");
    const parsed = z
      .object({
        lines: z.array(z.object({ variantId: z.string(), qty: z.number().int().positive() })).min(1),
        method: z.enum(["cash", "card", "transfer"]),
        idempotencyKey: z.string().min(8),
      })
      .parse(input);
    const result = await registerPosSale({
      ...parsed,
      actor: { userId: user.id, label: `${user.role}:${user.email}` },
    });
    return { ok: true, number: result.number, totalCop: result.totalCop };
  } catch (e) {
    if (e instanceof PosError) return { ok: false, message: e.message };
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}
