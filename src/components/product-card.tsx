import Link from "next/link";
import Image from "next/image";
import type { CatalogProduct } from "@/modules/catalog/service";
import { formatCop, unitPriceLabel } from "@/lib/format";
import { AddToCart } from "./add-to-cart";

export function ProductCard({ product }: { product: CatalogProduct }) {
  const variant = product.variants[0];
  if (!variant) return null;
  const onSale = variant.compareAtCop !== null && variant.compareAtCop > variant.priceCop;
  const liquor = product.restrictedRuleKey === "liquor";

  return (
    <article
      className={`relative flex flex-col overflow-hidden rounded-card border bg-white shadow-sm transition hover:shadow-md ${
        liquor ? "border-liquor/25" : "border-brand-soft"
      }`}
    >
      {onSale && (
        <span className="absolute top-2 left-2 z-10 rounded-full bg-coral px-2 py-0.5 text-xs font-bold text-white">
          Oferta
        </span>
      )}
      {product.isRestricted && (
        <span
          className="absolute top-2 right-2 z-10 rounded-full bg-liquor px-2 py-0.5 text-xs font-bold text-white"
          title="Venta solo a mayores de 18 años"
        >
          +18
        </span>
      )}
      <Link href={`/producto/${product.slug}`} className="block">
        <div className={`relative aspect-[4/3] ${liquor ? "bg-liquor-soft" : "bg-brand-soft"}`}>
          {product.imageUrl ? (
            <Image src={product.imageUrl} alt={product.name} fill className="object-cover" sizes="(max-width: 640px) 50vw, 220px" />
          ) : (
            // Sin foto: ícono grande de la categoría — presentable sin inventar imágenes.
            <span aria-hidden className="absolute inset-0 flex items-center justify-center text-5xl opacity-70">
              {product.categoryIcon ?? "🛒"}
            </span>
          )}
        </div>
        <div className="px-3 pt-2">
          <h3 className="line-clamp-2 min-h-[2.6em] text-sm font-semibold text-ink">{product.name}</h3>
          <p className="text-xs text-ink-soft">{variant.name}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-base font-bold text-brand-dark">
              {unitPriceLabel(variant.priceCop, variant.saleUnit)}
            </span>
            {onSale && (
              <span className="text-xs text-ink-soft line-through">{formatCop(variant.compareAtCop!)}</span>
            )}
          </p>
          {variant.soldByWeight && (
            <p className="text-[11px] text-ink-soft">⚖️ Precio final según peso real</p>
          )}
        </div>
      </Link>
      <div className="mt-auto p-3 pt-2">
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
          compact
        />
      </div>
    </article>
  );
}
