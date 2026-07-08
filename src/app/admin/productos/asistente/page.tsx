import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { productAgentConfigured } from "@/modules/assistant/product-agent";
import { ProductAgent } from "./product-agent-ui";
import { BackLink } from "@/components/admin/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Asistente de productos · Admin" };

export default async function ProductAgentPage() {
  const cats = await db.query.categories.findMany({ orderBy: asc(categories.sortOrder) });
  return (
    <div className="max-w-2xl">
      <BackLink href="/admin/productos" label="Productos" />
      <h1 className="mb-1 text-2xl font-extrabold text-ink">🪄 Asistente de productos</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Tómale una foto al producto, díctalo o escríbelo. El asistente lo identifica, arma la ficha
        y busca una <strong>foto presentable</strong> del mismo producto (Open Food Facts, base
        abierta) para publicarla en el catálogo. Tú siempre revisas y confirmas antes de crear.
      </p>
      <ProductAgent
        configured={productAgentConfigured()}
        categories={cats.map((c) => ({ id: c.id, slug: c.slug, name: c.name, icon: c.icon }))}
      />
    </div>
  );
}
