import { listFeatured } from "@/modules/catalog/service";
import { ProductCard } from "@/components/product-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ofertas" };

export default async function OffersPage() {
  const offers = await listFeatured({ onSale: true, limit: 24 });
  return (
    <div>
      <h1 className="mb-4 text-xl font-extrabold text-coral">🏷️ Ofertas del día</h1>
      {offers.length === 0 ? (
        <div className="rounded-card border border-brand-soft bg-white p-10 text-center text-ink-soft">
          <p className="text-3xl">🏷️</p>
          <p className="mt-2 font-medium">Hoy no hay ofertas activas. ¡Vuelve mañana!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {offers.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
