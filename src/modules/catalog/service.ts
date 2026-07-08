import { eq, and, asc, sql, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants, categories, productImages } from "@/db/schema";
import { getSetting } from "@/modules/config/service";

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  brand: string | null;
  isRestricted: boolean;
  restrictedRuleKey: string | null;
  categorySlug: string;
  categoryName: string;
  /** Ícono de la categoría — placeholder presentable cuando no hay foto. */
  categoryIcon: string | null;
  imageUrl: string | null;
  /** Atribución de la foto (ej. Open Food Facts CC-BY-SA) — exigida por licencia. */
  imageCredit: string | null;
  variants: {
    id: string;
    name: string;
    saleUnit: string;
    unitSize: number;
    soldByWeight: boolean;
    estimatedWeightG: number | null;
    priceCop: number;
    compareAtCop: number | null;
  }[];
};

async function hydrate(productRows: { p: typeof products.$inferSelect; c: typeof categories.$inferSelect }[]): Promise<CatalogProduct[]> {
  if (productRows.length === 0) return [];
  const ids = productRows.map((r) => r.p.id);
  const variants = await db.query.productVariants.findMany({
    where: and(
      sql`${productVariants.productId} in ${ids}`,
      eq(productVariants.isActive, true),
    ),
  });
  const images = await db.query.productImages.findMany({
    where: sql`${productImages.productId} in ${ids}`,
    orderBy: asc(productImages.sortOrder),
  });
  // Las fotos subidas desde el panel se guardan como data-URI en BD;
  // se sirven vía /api/images/[id] para que <Image> las acepte.
  const imageFor = (productId: string): { url: string; credit: string | null } | null => {
    const img = images.find((i) => i.productId === productId);
    if (!img) return null;
    return {
      url: img.url.startsWith("data:") ? `/api/images/${img.id}` : img.url,
      credit: img.credit,
    };
  };
  return productRows.map(({ p, c }) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    brand: p.brand,
    isRestricted: p.isRestricted,
    restrictedRuleKey: p.restrictedRuleKey,
    categorySlug: c.slug,
    categoryName: c.name,
    categoryIcon: c.icon,
    imageUrl: imageFor(p.id)?.url ?? null,
    imageCredit: imageFor(p.id)?.credit ?? null,
    variants: variants
      .filter((v) => v.productId === p.id)
      .map((v) => ({
        id: v.id,
        name: v.name,
        saleUnit: v.saleUnit,
        unitSize: v.unitSize,
        soldByWeight: v.soldByWeight,
        estimatedWeightG: v.estimatedWeightG,
        priceCop: v.priceCop,
        compareAtCop: v.compareAtCop,
      })),
  }));
}

export async function listCategories() {
  return db.query.categories.findMany({
    where: eq(categories.isActive, true),
    orderBy: asc(categories.sortOrder),
  });
}

export async function listProductsByCategory(categorySlug: string): Promise<CatalogProduct[]> {
  const rows = await db
    .select({ p: products, c: categories })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(categories.slug, categorySlug), eq(products.isActive, true)))
    .orderBy(asc(products.name));
  return hydrate(rows);
}

export async function getProductBySlug(slug: string): Promise<CatalogProduct | null> {
  const rows = await db
    .select({ p: products, c: categories })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.slug, slug), eq(products.isActive, true)))
    .limit(1);
  const result = await hydrate(rows);
  return result[0] ?? null;
}

export async function listFeatured(opts: { onSale?: boolean; limit?: number } = {}): Promise<CatalogProduct[]> {
  const limit = opts.limit ?? 8;
  if (opts.onSale) {
    const saleVariants = await db
      .select({ productId: productVariants.productId })
      .from(productVariants)
      .where(and(isNotNull(productVariants.compareAtCop), eq(productVariants.isActive, true)))
      .limit(limit);
    const ids = [...new Set(saleVariants.map((v) => v.productId))];
    if (ids.length === 0) return [];
    const rows = await db
      .select({ p: products, c: categories })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(and(sql`${products.id} in ${ids}`, eq(products.isActive, true)));
    return hydrate(rows);
  }
  const rows = await db
    .select({ p: products, c: categories })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.isActive, true))
    .orderBy(asc(products.createdAt))
    .limit(limit);
  return hydrate(rows);
}

/**
 * Búsqueda tolerante:
 * 1) expande sinónimos aprobados por el negocio (settings "search.synonyms"),
 * 2) normaliza acentos (unaccent-like en JS) y
 * 3) usa trigram similarity de PostgreSQL (pg_trgm) + ILIKE como respaldo,
 *    lo que absorbe errores ortográficos ("zanaoria" → zanahoria).
 */
export async function searchProducts(query: string): Promise<CatalogProduct[]> {
  const normalized = query
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (!normalized) return [];

  const synonyms = await getSetting("search.synonyms");
  const terms = new Set<string>([normalized]);
  for (const [canonical, alts] of Object.entries(synonyms)) {
    const all = [canonical, ...alts].map((t) =>
      t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
    );
    if (all.some((t) => normalized.includes(t) || t.includes(normalized))) {
      all.forEach((t) => terms.add(t));
    }
  }

  const termList = [...terms];
  const likeClauses = termList.map(
    (t) => sql`unaccent(lower(${products.name})) like ${"%" + t + "%"}`,
  );
  const trgmClauses = termList.map(
    (t) => sql`similarity(unaccent(lower(${products.name})), ${t}) > 0.25`,
  );
  const searchTermsClauses = termList.map(
    (t) => sql`exists (select 1 from jsonb_array_elements_text(${products.searchTerms}) st where unaccent(lower(st)) like ${"%" + t + "%"})`,
  );

  const rows = await db
    .select({ p: products, c: categories })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(products.isActive, true),
        sql`(${sql.join([...likeClauses, ...trgmClauses, ...searchTermsClauses], sql` OR `)})`,
      ),
    )
    .orderBy(sql`greatest(${sql.join(
      termList.map((t) => sql`similarity(unaccent(lower(${products.name})), ${t})`),
      sql`, `,
    )}) desc`)
    .limit(30);
  return hydrate(rows);
}
