import Link from "next/link";
import { notFound } from "next/navigation";
import { listProductsByCategory, listCategories } from "@/modules/catalog/service";
import { ProductCard } from "@/components/product-card";
import { getSetting } from "@/modules/config/service";
import { isScheduleOpen, todayWindowsLabel } from "@/modules/config/schedule";
import { getSectionAppearance, getSectionBackgroundUrl, sectionTextIsDark } from "@/modules/config/section-bg";
import { fontStack, sizeRem } from "@/modules/config/section-style";
import { PageWallpaper } from "../../page-wallpaper";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const categories = await listCategories();
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const [products, hero, pageBg] = await Promise.all([
    listProductsByCategory(slug),
    getSectionAppearance(slug),
    getSectionBackgroundUrl(`pagebg:${slug}`),
  ]);
  const heroBg = hero.imageUrl;
  const heroColor = !heroBg ? hero.color : null;
  const heroColorDark = heroColor ? sectionTextIsDark(heroColor) : false;
  const heroFont = fontStack(hero.style.font) ?? undefined;
  const heroTitleSize = sizeRem(hero.style.titleSize) ?? undefined;
  const heroTitle = hero.style.title?.trim() || `${category.icon} ${category.name}`;
  const heroSubtitle = hero.style.subtitle?.trim() || null;
  const heroTextColor = hero.style.textColor ?? undefined;

  let restrictedBanner: string | null = null;
  if (category.isRestricted) {
    const rules = await getSetting("restricted.rules");
    const ruleKey = slug === "cigarrillos" ? "cigarettes" : "liquor";
    const rule = rules[ruleKey];
    if (rule) {
      const open = isScheduleOpen(rule.schedule, new Date());
      restrictedBanner = open
        ? `Venta solo a mayores de ${rule.minAge} años. Se verifica documento en la entrega.`
        : `Fuera del horario de venta permitido (hoy: ${todayWindowsLabel(rule.schedule, new Date())}). Puedes mirar el catálogo, pero no añadir estos productos ahora.`;
    }
  }

  return (
    <div>
      {/* Fondo de pantalla propio de esta categoría (encima del global). */}
      {pageBg && <PageWallpaper url={pageBg} />}
      {/* Miga de pan en una píldora clara para que se lea sobre cualquier fondo. */}
      <nav
        aria-label="Miga de pan"
        className="mb-3 inline-flex flex-wrap items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-sm font-medium text-ink shadow-sm ring-1 ring-black/5 backdrop-blur"
      >
        <Link href="/" className="font-semibold text-brand-dark hover:underline">Inicio</Link>
        <span className="text-ink-soft" aria-hidden>/</span>
        <Link href="/categorias" className="font-semibold text-brand-dark hover:underline">Categorías</Link>
        <span className="text-ink-soft" aria-hidden>/</span>
        <span className="text-ink">{category.name}</span>
      </nav>
      {heroBg ? (
        <div
          className="relative mb-4 overflow-hidden rounded-card p-4 md:min-h-[140px] md:p-6"
          style={{ backgroundImage: `url(${heroBg})`, backgroundSize: "cover", backgroundPosition: "center", fontFamily: heroFont }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/10" />
          <div className="relative flex h-full flex-col justify-end">
            <h1 className="text-2xl font-extrabold text-white drop-shadow md:text-3xl" style={{ fontSize: heroTitleSize, color: heroTextColor }}>
              {heroTitle}
            </h1>
            {heroSubtitle && <p className="mt-1 text-sm text-white/90 drop-shadow" style={{ color: heroTextColor }}>{heroSubtitle}</p>}
          </div>
        </div>
      ) : heroColor ? (
        <div
          className="mb-4 flex min-h-[92px] flex-col justify-end rounded-card p-4 md:min-h-[120px] md:p-6"
          style={{ backgroundColor: heroColor, fontFamily: heroFont }}
        >
          <h1 className={`text-2xl font-extrabold md:text-3xl ${heroColorDark ? "text-ink" : "text-white"}`} style={{ fontSize: heroTitleSize, color: heroTextColor }}>
            {heroTitle}
          </h1>
          {heroSubtitle && <p className={`mt-1 text-sm ${heroColorDark ? "text-ink-soft" : "text-white/90"}`} style={{ color: heroTextColor }}>{heroSubtitle}</p>}
        </div>
      ) : (
        <div className="mb-2" style={{ fontFamily: heroFont }}>
          <h1 className="text-xl font-extrabold text-ink" style={{ fontSize: heroTitleSize, color: heroTextColor }}>
            {heroTitle}
          </h1>
          {heroSubtitle && <p className="mt-1 text-sm text-ink-soft" style={{ color: heroTextColor }}>{heroSubtitle}</p>}
        </div>
      )}
      {restrictedBanner && (
        <p className="mb-4 rounded-card bg-liquor-soft px-4 py-3 text-sm font-medium text-liquor">
          {restrictedBanner}
        </p>
      )}
      {products.length === 0 ? (
        <div className="rounded-card border border-brand-soft bg-white p-10 text-center text-ink-soft">
          <p className="text-3xl">🧺</p>
          <p className="mt-2 font-medium">Aún no hay productos en esta categoría.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
