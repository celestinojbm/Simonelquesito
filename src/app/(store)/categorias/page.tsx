import Link from "next/link";
import { listCategories } from "@/modules/catalog/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Categorías" };

export default async function CategoriesPage() {
  const categories = await listCategories();
  return (
    <div>
      <h1 className="mb-4 text-xl font-extrabold text-ink">Categorías</h1>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {categories.map((c) => (
          <li key={c.id}>
            <Link
              href={`/categoria/${c.slug}`}
              className="relative flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-card border border-brand-soft bg-white p-4 text-center transition hover:shadow-md"
            >
              {c.isRestricted && (
                <span
                  className="absolute top-2 right-2 rounded-full bg-liquor px-2 py-0.5 text-[10px] leading-none font-bold text-white"
                  title="Venta solo a mayores de 18 años"
                >
                  +18
                </span>
              )}
              <span className="text-3xl" aria-hidden>{c.icon}</span>
              <span className="font-semibold text-ink">{c.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
