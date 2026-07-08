import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlug } from "@/modules/catalog/service";
import { getStock } from "@/modules/inventory/service";
import { formatCop, unitPriceLabel } from "@/lib/format";
import { AddToCart } from "@/components/add-to-cart";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const stocks = await Promise.all(product.variants.map((v) => getStock(v.id)));
  const liquor = product.restrictedRuleKey === "liquor";

  return (
    <div className="md:grid md:grid-cols-2 md:gap-8">
      <div className={`relative aspect-[4/3] overflow-hidden rounded-card ${liquor ? "bg-liquor-soft" : "bg-brand-soft"}`}>
        {product.imageUrl && (
          <Image src={product.imageUrl} alt={product.name} fill className="object-cover" sizes="(max-width: 768px) 100vw, 480px" priority />
        )}
        {product.isRestricted && (
          <span className="absolute top-3 right-3 rounded-full bg-liquor px-3 py-1 text-sm font-bold text-white">+18</span>
        )}
        {product.imageUrl && product.imageCredit && (
          <span className="absolute right-2 bottom-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-ink-soft">
            {product.imageCredit}
          </span>
        )}
      </div>

      <div className="mt-4 md:mt-0">
        <nav aria-label="Miga de pan" className="text-sm text-ink-soft">
          <Link href={`/categoria/${product.categorySlug}`} className="hover:underline">
            {product.categoryName}
          </Link>
        </nav>
        <h1 className="text-2xl font-extrabold text-ink">{product.name}</h1>
        {product.brand && <p className="text-sm text-ink-soft">{product.brand}</p>}
        {product.description && <p className="mt-2 text-sm text-ink-soft">{product.description}</p>}

        {product.isRestricted && (
          <p className="mt-3 rounded-card bg-liquor-soft px-4 py-3 text-sm font-medium text-liquor">
            Producto para mayores de 18 años. En el checkout te pediremos confirmar tu edad y
            mostraremos tu documento al momento de la entrega. Prohibido el expendio a menores.
          </p>
        )}

        <div className="mt-4 space-y-3">
          {product.variants.map((variant, i) => {
            const stock = stocks[i]!;
            const onSale = variant.compareAtCop !== null && variant.compareAtCop > variant.priceCop;
            const out = stock.available <= 0;
            return (
              <div key={variant.id} className="rounded-card border border-brand-soft bg-white p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{variant.name}</p>
                    <p className="flex items-baseline gap-2">
                      <span className="text-xl font-bold text-brand-dark">
                        {unitPriceLabel(variant.priceCop, variant.saleUnit)}
                      </span>
                      {onSale && (
                        <span className="text-sm text-ink-soft line-through">{formatCop(variant.compareAtCop!)}</span>
                      )}
                      {onSale && (
                        <span className="rounded-full bg-coral px-2 py-0.5 text-xs font-bold text-white">Oferta</span>
                      )}
                    </p>
                  </div>
                  {out ? (
                    <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold text-ink-soft">Agotado</span>
                  ) : stock.available < 10 && !variant.soldByWeight ? (
                    <span className="rounded-full bg-sun px-3 py-1 text-xs font-semibold text-ink">¡Últimas {stock.available}!</span>
                  ) : null}
                </div>
                {variant.soldByWeight && (
                  <p className="mt-1 text-xs text-ink-soft">
                    ⚖️ Producto por peso: el total en el checkout es <strong>aproximado</strong>. Pesamos tu
                    producto al preparar el pedido y ajustamos el valor final.
                    {variant.estimatedWeightG ? ` Peso estimado por unidad: ~${variant.estimatedWeightG} g.` : ""}
                  </p>
                )}
                {!out && (
                  <div className="mt-3">
                    <AddToCart
                      item={{
                        variantId: variant.id,
                        productSlug: product.slug,
                        productName: product.name,
                        variantName: variant.name,
                        saleUnit: variant.saleUnit,
                        qty: 0,
                        unitPriceCop: variant.priceCop,
                        soldByWeight: variant.soldByWeight,
                        isRestricted: product.isRestricted,
                        restrictedRuleKey: product.restrictedRuleKey,
                        imageUrl: product.imageUrl,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-card bg-brand-soft p-4 text-sm text-ink-soft">
          <p className="font-semibold text-brand-dark">Política de sustituciones</p>
          <p>
            Si un producto no está disponible, en el checkout eliges: no sustituir, aceptar un
            similar, que te contactemos, o sustituir hasta un precio límite.
          </p>
        </div>
      </div>
    </div>
  );
}
