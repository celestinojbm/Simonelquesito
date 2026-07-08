import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, products, productVariants } from "@/db/schema";
import { formatCop } from "@/lib/format";
import { ProductThumb } from "@/components/product-thumb";
import { StockAdjust } from "./stock-adjust";
import { LotReceive } from "./lot-receive";
import { DiscardLotButton } from "./discard-lot-button";
import { listExpiringLots } from "@/modules/inventory/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventario · Admin" };

export default async function AdminInventoryPage() {
  const expiringLots = await listExpiringLots(5);
  const rows = await db
    .select({
      variantId: productVariants.id,
      productName: products.name,
      variantName: productVariants.name,
      categoryIcon: categories.icon,
      imageId: sql<string | null>`(select id from product_images pi where pi.product_id = ${products.id} order by pi.sort_order asc limit 1)`,
      imageUrl: sql<string | null>`(select url from product_images pi where pi.product_id = ${products.id} order by pi.sort_order asc limit 1)`,
      sku: productVariants.sku,
      saleUnit: productVariants.saleUnit,
      priceCop: productVariants.priceCop,
      physical: sql<number>`coalesce((select sum(m.qty) from inventory_movements m where m.variant_id = ${productVariants.id}), 0)::int`,
      reserved: sql<number>`coalesce((select sum(r.qty) from inventory_reservations r where r.variant_id = ${productVariants.id} and r.status = 'active'), 0)::int`,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(productVariants.isActive, true))
    .orderBy(products.name);

  const fmtQty = (qty: number, unit: string) =>
    unit === "kg" || unit === "g" ? `${(qty / 1000).toLocaleString("es-CO")} kg`
    : unit === "l" || unit === "ml" ? `${(qty / 1000).toLocaleString("es-CO")} L`
    : `${qty}`;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold text-ink">Inventario</h1>
      <p className="mb-4 text-sm text-ink-soft">
        El stock se calcula desde el <strong>ledger de movimientos</strong>: cualquier corrección crea un
        movimiento de ajuste auditado — nunca se edita el número directamente.
      </p>

      {expiringLots.length > 0 && (
        <section className="mb-4 rounded-card border border-sun bg-sun/15 p-4">
          <h2 className="font-bold text-ink">⏰ Lotes por vencer ({expiringLots.length})</h2>
          <p className="mb-2 text-xs text-ink-soft">
            Vencen en los próximos 5 días (o ya vencieron). El consumo por venta y merma descuenta
            primero de estos lotes (FEFO) — si sobra existencia al vencer, dale de baja aquí.
          </p>
          <ul className="space-y-1.5">
            {expiringLots.map((l) => {
              const expired = l.expiresAt ? l.expiresAt.getTime() < Date.now() : false;
              return (
                <li key={l.lotId} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-ink">{l.productName}</span>
                  <span className="text-xs text-ink-soft">{l.variantName}</span>
                  {l.lotCode && <span className="rounded-full bg-white px-2 py-0.5 text-xs">{l.lotCode}</span>}
                  <span className={`text-xs font-semibold ${expired ? "text-coral-dark" : "text-ink"}`}>
                    {expired ? "Vencido" : "Vence"}{" "}
                    {l.expiresAt?.toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
                  </span>
                  <span className="text-xs text-ink-soft">{l.qtyRemaining} und./g restantes</span>
                  <span className="ml-auto">
                    <DiscardLotButton lotId={l.lotId} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto rounded-card border border-brand-soft bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-brand-soft bg-brand-soft/50 text-xs text-ink-soft uppercase">
            <tr>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3 text-right">Precio</th>
              <th className="px-4 py-3 text-right">Físico</th>
              <th className="px-4 py-3 text-right">Reservado</th>
              <th className="px-4 py-3 text-right">Disponible</th>
              <th className="px-4 py-3">Ajustar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-soft">
            {rows.map((r) => {
              const available = r.physical - r.reserved;
              return (
                <tr key={r.variantId} className={available <= 0 ? "bg-coral/5" : undefined}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <ProductThumb
                        imageUrl={r.imageId && r.imageUrl ? (r.imageUrl.startsWith("data:") ? `/api/images/${r.imageId}` : r.imageUrl) : null}
                        icon={r.categoryIcon}
                        alt={r.productName}
                      />
                      <div className="min-w-0">
                        <p className="font-medium">{r.productName}</p>
                        <p className="text-xs text-ink-soft">{r.variantName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs">{r.sku ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{formatCop(r.priceCop)}</td>
                  <td className="px-4 py-2 text-right">{fmtQty(r.physical, r.saleUnit)}</td>
                  <td className="px-4 py-2 text-right text-ink-soft">{fmtQty(r.reserved, r.saleUnit)}</td>
                  <td className={`px-4 py-2 text-right font-bold ${available <= 0 ? "text-coral-dark" : "text-brand-dark"}`}>
                    {fmtQty(available, r.saleUnit)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      <StockAdjust variantId={r.variantId} />
                      <LotReceive variantId={r.variantId} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
