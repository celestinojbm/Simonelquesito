import { searchProducts } from "@/modules/catalog/service";
import { ProductCard } from "@/components/product-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Buscar" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const results = q ? await searchProducts(q) : [];

  return (
    <div>
      <h1 className="mb-4 text-xl font-extrabold text-ink">
        {q ? <>Resultados para “{q}”</> : "Buscar"}
      </h1>
      {q && results.length === 0 && (
        <div className="rounded-card border border-brand-soft bg-white p-10 text-center text-ink-soft">
          <p className="text-3xl">🔍</p>
          <p className="mt-2 font-medium">No encontramos “{q}”.</p>
          <p className="text-sm">Prueba con otro nombre: por ejemplo “gaseosa”, “papa” o “detergente”.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {results.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );
}
