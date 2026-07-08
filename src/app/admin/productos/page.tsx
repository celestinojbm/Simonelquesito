import Link from "next/link";
import { desc, eq, asc, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants, categories } from "@/db/schema";
import { skuPrefix, nextSku } from "@/lib/sku";
import { NewProductForm } from "./new-product-form";
import { ProductsBrowser, type ProductRow } from "./products-browser";

export const dynamic = "force-dynamic";
export const metadata = { title: "Productos · Admin" };

export default async function AdminProductsPage() {
  // Se cargan TODOS los productos (activos e inactivos) y el buscador filtra en
  // vivo en el navegador: coincidencia parcial, sin acentos y sin botón.
  const [cats, rows] = await Promise.all([
    db.query.categories.findMany({ where: eq(categories.isActive, true), orderBy: asc(categories.sortOrder) }),
    db
      .select({
        productId: products.id,
        slug: products.slug,
        name: products.name,
        isActive: products.isActive,
        categoryName: categories.name,
        categoryIcon: categories.icon,
        isRestricted: products.isRestricted,
        variantName: productVariants.name,
        saleUnit: productVariants.saleUnit,
        priceCop: productVariants.priceCop,
        sku: productVariants.sku,
        barcode: productVariants.barcode,
        imageId: sql<string | null>`(select id from product_images pi where pi.product_id = ${products.id} order by pi.sort_order asc limit 1)`,
        imageUrl: sql<string | null>`(select url from product_images pi where pi.product_id = ${products.id} order by pi.sort_order asc limit 1)`,
      })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .innerJoin(productVariants, eq(productVariants.productId, products.id))
      // Incluye inactivos: si no, un producto desactivado desaparecería y no
      // se podría volver a activar desde el panel.
      .orderBy(desc(products.createdAt)),
  ]);
  const productRows: ProductRow[] = rows;

  // Siguiente SKU sugerido por categoría (mismo consecutivo que usa el
  // servidor si el campo se deja vacío): se muestra prellenado en el alta.
  const nextSkuByCategory = new Map<string, string>();
  for (const c of cats) {
    const prefix = skuPrefix(c.name);
    const [row] = await db
      .select({ max: sql<number | null>`max((substring(${productVariants.sku} from '[0-9]+$'))::int)` })
      .from(productVariants)
      .where(like(productVariants.sku, `${prefix}-%`));
    nextSkuByCategory.set(c.id, nextSku(prefix, Number(row?.max ?? 0)));
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Productos</h1>
        <p className="text-sm text-ink-soft">
          Agrega artículos a mano (con foto y escáner de código de barras) o usa la{" "}
          <Link href="/admin/importar" className="font-semibold text-brand-dark underline">importación CSV desde Treinta</Link>.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href="/admin/productos/asistente"
            className="btn inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white"
          >
            🪄 Asistente: crear producto con foto, voz o texto
          </Link>
          <Link
            href="/admin/productos/imagenes"
            className="btn inline-block rounded-full border border-brand px-5 py-2.5 text-sm font-bold text-brand-dark hover:bg-brand-soft"
          >
            🖼 Completar fotos del catálogo
          </Link>
        </div>
      </div>

      <NewProductForm
        categories={cats.map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon,
          nextSku: nextSkuByCategory.get(c.id) ?? null,
        }))}
      />

      <ProductsBrowser rows={productRows} />
    </div>
  );
}
