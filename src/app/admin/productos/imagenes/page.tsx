import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { ImagenesClient } from "./imagenes-client";
import { BackLink } from "@/components/admin/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fotos del catálogo · Admin" };

/**
 * Completador de fotos del catálogo con Open Food Facts: lista los productos
 * sin foto presentable; el personal busca candidatas y ELIGE la correcta.
 * La búsqueda por nombre nunca publica sola (puede traer el producto
 * equivocado); por código de barras la coincidencia es exacta.
 */
export default async function ImagenesPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  await requirePermission("catalog.manage");
  const { pagina } = await searchParams;
  const page = Math.max(1, Number(pagina) || 1);
  const PER_PAGE = 20;

  // Sin foto presentable = sin imágenes o solo con el ícono de categoría.
  const noPhoto = sql`not exists (
    select 1 from product_images pi
    where pi.product_id = ${products.id} and pi.url not like '/images/cat/%'
  )`;

  const [{ total }] = (await db
    .select({ total: sql<string>`count(*)` })
    .from(products)
    .where(sql`${products.isActive} and ${noPhoto}`)) as [{ total: string }];

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      brand: products.brand,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      barcode: sql<string | null>`(select barcode from product_variants pv where pv.product_id = ${products.id} and pv.barcode is not null limit 1)`,
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(sql`${products.isActive} and ${noPhoto}`)
    .orderBy(asc(products.name))
    .limit(PER_PAGE)
    .offset((page - 1) * PER_PAGE);

  const totalN = Number(total);
  const pages = Math.max(1, Math.ceil(totalN / PER_PAGE));

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <BackLink href="/admin/productos" label="Productos" />
        <h1 className="mt-1 text-2xl font-extrabold text-ink">🖼 Fotos del catálogo</h1>
        <p className="text-sm text-ink-soft">
          <strong>{totalN}</strong> producto{totalN === 1 ? "" : "s"} sin foto presentable. Busca
          candidatas en Open Food Facts y elige la correcta — tú decides, nunca se publica sola.
          Las fotos elegidas llevan atribución a Open Food Facts (licencia CC-BY-SA). OFF limita
          las búsquedas (~10 por minuto): ve con calma, producto a producto.
        </p>
      </div>

      <ImagenesClient
        products={rows.map((r) => {
          // El nombre limpio busca mejor: sin gramajes ("x500g", "500 g", "1 L").
          const cleanName = r.name
            .replace(/\b\d+([.,]\d+)?\s*(g|gr|kg|ml|l|und|u|cc)\b/gi, "")
            .replace(/\s{2,}/g, " ")
            .trim();
          return {
            id: r.id,
            name: r.name,
            brand: r.brand,
            category: `${r.categoryIcon ?? ""} ${r.categoryName}`.trim(),
            barcode: r.barcode,
            query: `${cleanName}${r.brand && !cleanName.toLowerCase().includes(r.brand.toLowerCase()) ? ` ${r.brand}` : ""}`.trim() || r.name,
          };
        })}
      />

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-2 text-sm" aria-label="Páginas">
          {page > 1 && (
            <Link href={`/admin/productos/imagenes?pagina=${page - 1}`} className="rounded-full border border-brand-soft px-4 py-1.5 text-brand-dark hover:bg-brand-soft">
              ← Anterior
            </Link>
          )}
          <span className="text-ink-soft">Página {page} de {pages}</span>
          {page < pages && (
            <Link href={`/admin/productos/imagenes?pagina=${page + 1}`} className="rounded-full border border-brand-soft px-4 py-1.5 text-brand-dark hover:bg-brand-soft">
              Siguiente →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
