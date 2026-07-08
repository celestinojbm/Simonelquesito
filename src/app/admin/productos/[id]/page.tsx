import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, products, productVariants } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { BackLink } from "@/components/admin/back-link";
import { EditProductForm } from "./edit-product-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar producto · Admin" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("catalog.manage");
  const { id } = await params;

  const product = await db.query.products.findFirst({ where: eq(products.id, id) });
  if (!product) notFound();
  const variant = await db.query.productVariants.findFirst({
    where: eq(productVariants.productId, product.id),
    orderBy: asc(productVariants.id),
  });
  if (!variant) notFound();

  const cats = await db.query.categories.findMany({
    where: eq(categories.isActive, true),
    orderBy: asc(categories.sortOrder),
  });

  const [img] = await db
    .select({ id: productVariants.id, url: sql<string | null>`(select url from product_images pi where pi.product_id = ${product.id} order by pi.sort_order asc limit 1)`, iid: sql<string | null>`(select id from product_images pi where pi.product_id = ${product.id} order by pi.sort_order asc limit 1)` })
    .from(productVariants)
    .where(eq(productVariants.id, variant.id));
  const imageUrl = img?.url ? (img.url.startsWith("data:") ? `/api/images/${img.iid}` : img.url) : null;

  const isWeight = variant.soldByWeight;
  const restricted = (product.restrictedRuleKey === "liquor" || product.restrictedRuleKey === "cigarettes")
    ? product.restrictedRuleKey
    : "none";

  return (
    <div className="max-w-3xl">
      <BackLink href="/admin/productos" label="Productos" />
      <h1 className="mb-1 text-2xl font-extrabold text-ink">Editar: {product.name}</h1>
      <p className="mb-4 text-sm text-ink-soft">SKU {variant.sku ?? "—"} · el stock se ajusta en Inventario.</p>
      <EditProductForm
        categories={cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon }))}
        product={{
          id: product.id,
          variantId: variant.id,
          name: product.name,
          brand: product.brand,
          description: product.description,
          categoryId: product.categoryId,
          restricted,
          variantName: variant.name,
          soldByWeight: isWeight,
          // Mostrar el precio en la unidad que captura el usuario (por libra = ÷2).
          priceCop: isWeight ? Math.round(variant.priceCop / 2) : variant.priceCop,
          compareAtCop: variant.compareAtCop ? (isWeight ? Math.round(variant.compareAtCop / 2) : variant.compareAtCop) : null,
          costCop: variant.costCop ? (isWeight ? Math.round(variant.costCop / 2) : variant.costCop) : null,
          sku: variant.sku,
          barcode: variant.barcode,
          isPerishable: variant.isPerishable,
          isActive: product.isActive,
          imageUrl,
        }}
      />
    </div>
  );
}
