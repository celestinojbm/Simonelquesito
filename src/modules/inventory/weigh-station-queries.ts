/**
 * Consultas de solo lectura de la estación de balanza: resolución de producto
 * (barcode/SKU exacto → nombre), y el historial de "últimos movimientos de
 * balanza". Reutiliza `getStock` (fuente de verdad del stock) y `normalizeSearch`.
 */
import { and, desc, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  inventoryMovements,
  productVariants,
  products,
} from "@/db/schema";
import { normalizeSearch } from "@/lib/search";
import { scaleSourceLabel } from "@/modules/devices/scale/types";
import { getStock } from "./service";

export type StationItem = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  barcode: string | null;
  saleUnit: string;
  soldByWeight: boolean;
  unitSize: number;
  estimatedWeightG: number | null;
  isPerishable: boolean;
  priceCop: number;
  imageId: string | null;
  imageUrl: string | null;
  categoryIcon: string | null;
  stock: { physical: number; reserved: number; available: number };
};

/** Columnas base del producto/variante (sin stock; el stock se añade aparte). */
const itemColumns = {
  variantId: productVariants.id,
  productId: products.id,
  productName: products.name,
  variantName: productVariants.name,
  sku: productVariants.sku,
  barcode: productVariants.barcode,
  saleUnit: productVariants.saleUnit,
  soldByWeight: productVariants.soldByWeight,
  unitSize: productVariants.unitSize,
  estimatedWeightG: productVariants.estimatedWeightG,
  isPerishable: productVariants.isPerishable,
  priceCop: productVariants.priceCop,
  categoryIcon: categories.icon,
  imageId: sql<string | null>`(select id from product_images pi where pi.product_id = ${products.id} order by pi.sort_order asc limit 1)`,
  imageUrl: sql<string | null>`(select url from product_images pi where pi.product_id = ${products.id} order by pi.sort_order asc limit 1)`,
};

const activeOnly = and(eq(products.isActive, true), eq(productVariants.isActive, true));

/** Imagen normalizada: data-URI → /api/images/:id; si no, la URL directa o null. */
function normalizeImage<T extends { imageId: string | null; imageUrl: string | null }>(row: T): T {
  if (row.imageUrl && row.imageUrl.startsWith("data:") && row.imageId) {
    return { ...row, imageUrl: `/api/images/${row.imageId}` };
  }
  return row;
}

async function withStock(row: Omit<StationItem, "stock">): Promise<StationItem> {
  const stock = await getStock(row.variantId);
  return { ...normalizeImage(row), stock };
}

/** Resuelve un código: barcode EXACTO o SKU EXACTO (case-insensitive). null si no. */
export async function lookupStationItemByCode(code: string): Promise<StationItem | null> {
  const clean = code.trim();
  if (!clean) return null;
  const [row] = await db
    .select(itemColumns)
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        activeOnly,
        sql`(${productVariants.barcode} = ${clean} or upper(${productVariants.sku}) = upper(${clean}))`,
      ),
    )
    .limit(1);
  return row ? withStock(row) : null;
}

/** Búsqueda por nombre/variante/SKU/barcode (sin acentos, multi-token). */
export async function searchStationItems(query: string): Promise<StationItem[]> {
  const tokens = normalizeSearch(query).split(" ").filter(Boolean).slice(0, 6);
  if (tokens.length === 0) return [];
  const clauses = tokens.map(
    (t) =>
      sql`(
        unaccent(lower(${products.name})) like ${"%" + t + "%"}
        or unaccent(lower(${productVariants.name})) like ${"%" + t + "%"}
        or lower(coalesce(${productVariants.sku}, '')) like ${"%" + t + "%"}
        or lower(coalesce(${productVariants.barcode}, '')) like ${"%" + t + "%"}
      )`,
  );
  const rows = await db
    .select(itemColumns)
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(activeOnly, ...clauses))
    .orderBy(products.name)
    .limit(8);
  return Promise.all(rows.map((r) => withStock(r)));
}

export type StationHistoryRow = {
  id: string;
  createdAt: string;
  productName: string;
  variantName: string;
  saleUnit: string;
  qty: number;
  type: string;
  sourceLabel: string;
  reason: string | null;
  createdBy: string | null;
};

/** Últimos movimientos de la estación (reference_type LIKE 'weigh_station_%'). */
export async function listRecentStationMovements(limit = 10): Promise<StationHistoryRow[]> {
  const rows = await db
    .select({
      id: inventoryMovements.id,
      createdAt: inventoryMovements.createdAt,
      productName: products.name,
      variantName: productVariants.name,
      saleUnit: productVariants.saleUnit,
      qty: inventoryMovements.qty,
      type: inventoryMovements.type,
      referenceType: inventoryMovements.referenceType,
      reason: inventoryMovements.reason,
      createdBy: inventoryMovements.createdBy,
    })
    .from(inventoryMovements)
    .innerJoin(productVariants, eq(inventoryMovements.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(like(inventoryMovements.referenceType, "weigh_station_%"))
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    productName: r.productName,
    variantName: r.variantName,
    saleUnit: r.saleUnit,
    qty: r.qty,
    type: r.type,
    sourceLabel: scaleSourceLabel((r.referenceType ?? "").replace(/^weigh_station_/, "")),
    reason: r.reason,
    createdBy: r.createdBy,
  }));
}
