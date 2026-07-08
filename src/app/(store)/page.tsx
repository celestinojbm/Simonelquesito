import type { CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { listCategories, listFeatured, listProductsByCategory } from "@/modules/catalog/service";
import { getSetting } from "@/modules/config/service";
import { isScheduleOpen } from "@/modules/config/schedule";
import { listSectionAppearances, sectionTextIsDark } from "@/modules/config/section-bg";
import { fontStack, sizeRem, type SectionStyle } from "@/modules/config/section-style";
import { PageWallpaper } from "./page-wallpaper";
import { ProductCard } from "@/components/product-card";
import { formatCop } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const now = new Date();
  const [categories, offers, fresh, popular, freeFrom, liquorRules, branding, appearances] = await Promise.all([
    listCategories(),
    listFeatured({ onSale: true, limit: 8 }),
    listProductsByCategory("frutas-verduras"),
    listFeatured({ limit: 8 }),
    getSetting("delivery.freeFromCop"),
    getSetting("restricted.rules"),
    getSetting("branding"),
    listSectionAppearances(),
  ]);
  const hero = appearances["home"] ?? { imageUrl: null, color: null, style: {} };
  const homePageBg = appearances["pagebg:home"]?.imageUrl ?? null;
  // Estilo (texto/tipografía) de un título de bloque del inicio.
  const blockStyle = (key: string): SectionStyle => appearances[key]?.style ?? {};
  const blockProps = (key: string, fallback: string, fallbackSub?: string) => {
    const s = blockStyle(key);
    return {
      text: s.title?.trim() || fallback,
      sub: s.subtitle?.trim() || fallbackSub,
      style: {
        fontFamily: fontStack(s.font) ?? undefined,
        fontSize: sizeRem(s.titleSize) ?? undefined,
        color: s.textColor ?? undefined,
      } as CSSProperties,
    };
  };
  const catsTitle = blockProps("block:cats", "Categorías");
  const offersTitle = blockProps("block:offers", "🏷️ Ofertas del día");
  const freshTitle = blockProps("block:fresh", "🥑 Frutas y verduras frescas");
  const popularTitle = blockProps("block:popular", "Los favoritos del barrio");
  const freeShip = blockProps("block:freeship", "🛵 Envío gratis desde");
  const liquorTitle = blockProps("block:liquor", "🍺 Cervezas y licores (+18)");
  const neighborhood = blockProps(
    "block:neighborhood",
    "Comercio de barrio, servicio profesional.",
    "Pedidos en línea, seguimiento en tiempo real y entrega en tu puerta según la zona.",
  );
  const heroBg = hero.imageUrl;
  const heroColor = !heroBg ? hero.color : null;
  const heroColorDark = heroColor ? sectionTextIsDark(heroColor) : false;
  // Texto y tipografía personalizables de la portada.
  const heroFont = fontStack(hero.style.font) ?? undefined;
  const heroTitleSize = sizeRem(hero.style.titleSize) ?? undefined;
  const heroTitle = hero.style.title?.trim() || null;
  const heroSubtitle = hero.style.subtitle?.trim() || branding.slogan;
  const heroTextColor = hero.style.textColor ?? undefined;
  const heroFreeShip = freeFrom !== null && (
    <p className="mt-2 inline-block rounded-full bg-sun px-3 py-1 text-sm font-bold text-ink" style={freeShip.style}>
      {freeShip.text} {formatCop(freeFrom)}
    </p>
  );
  const liquorOpen = liquorRules.liquor ? isScheduleOpen(liquorRules.liquor.schedule, now) : false;
  const beers = liquorOpen ? await listProductsByCategory("cervezas") : [];

  return (
    <div className="space-y-8">
      {/* Fondo de pantalla propio de la portada (encima del global). */}
      {homePageBg && <PageWallpaper url={homePageBg} />}
      {/* Hero: con foto de fondo (si el panel la configuró) o el diseño suave
          por defecto. Sobre la foto va un degradado oscuro para que el texto
          blanco se lea siempre. */}
      {heroBg ? (
        <section
          className="relative overflow-hidden rounded-card p-5 md:min-h-[220px] md:p-8"
          style={{ backgroundImage: `url(${heroBg})`, backgroundSize: "cover", backgroundPosition: "center", fontFamily: heroFont }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/45 to-black/20" />
          <div className="relative">
            <h1 className="text-2xl font-extrabold text-white drop-shadow md:text-3xl" style={{ fontSize: heroTitleSize, color: heroTextColor }}>
              {heroTitle ?? <>{branding.tagline}, <span className="text-sun">a domicilio</span></>}
            </h1>
            <p className="mt-1 text-sm text-white/90 drop-shadow md:text-base" style={{ color: heroTextColor }}>{heroSubtitle}</p>
            {heroFreeShip}
          </div>
        </section>
      ) : heroColor ? (
        <section
          className="rounded-card p-5 md:flex md:items-center md:justify-between"
          style={{ backgroundColor: heroColor, fontFamily: heroFont }}
        >
          <div>
            <h1 className={`text-2xl font-extrabold md:text-3xl ${heroColorDark ? "text-ink" : "text-white"}`} style={{ fontSize: heroTitleSize, color: heroTextColor }}>
              {heroTitle ?? <>{branding.tagline}, <span className={heroColorDark ? "text-coral" : "text-sun"}>a domicilio</span></>}
            </h1>
            <p className={`mt-1 text-sm md:text-base ${heroColorDark ? "text-ink-soft" : "text-white/90"}`} style={{ color: heroTextColor }}>{heroSubtitle}</p>
            {heroFreeShip}
          </div>
        </section>
      ) : (
        <section className="rounded-card bg-brand-soft p-5 md:flex md:items-center md:justify-between" style={{ fontFamily: heroFont }}>
          <div>
            <h1 className="text-2xl font-extrabold text-brand-dark md:text-3xl" style={{ fontSize: heroTitleSize, color: heroTextColor }}>
              {heroTitle ?? <>{branding.tagline}, <span className="text-coral">a domicilio</span></>}
            </h1>
            <p className="mt-1 text-sm text-ink-soft md:text-base" style={{ color: heroTextColor }}>{heroSubtitle}</p>
            {heroFreeShip}
          </div>
          {/* El pedido por WhatsApp se hace desde el botón flotante persistente. */}
        </section>
      )}

      {/* Categorías */}
      <section aria-labelledby="cats-title">
        <h2 id="cats-title" className="mb-3 text-lg font-bold text-ink" style={catsTitle.style}>{catsTitle.text}</h2>
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-11">
          {categories.map((c) => (
            <li key={c.id}>
              <Link
                href={`/categoria/${c.slug}`}
                className="relative flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-card border border-brand-soft bg-white p-2 text-center transition hover:shadow-md"
              >
                {c.isRestricted && (
                  <span
                    className="absolute top-1 right-1 rounded-full bg-liquor px-1.5 py-0.5 text-[9px] leading-none font-bold text-white"
                    title="Venta solo a mayores de 18 años"
                  >
                    +18
                  </span>
                )}
                <span className="text-2xl" aria-hidden>{c.icon}</span>
                <span className="text-[11px] leading-tight font-medium text-ink">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Ofertas del día */}
      {offers.length > 0 && (
        <section aria-labelledby="offers-title">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="offers-title" className="text-lg font-bold text-coral" style={offersTitle.style}>{offersTitle.text}</h2>
            <Link href="/ofertas" className="text-sm font-semibold text-brand-dark hover:underline">
              Ver todas →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {offers.slice(0, 4).map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* Frutas y verduras frescas */}
      <section aria-labelledby="fresh-title">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="fresh-title" className="text-lg font-bold text-brand-dark" style={freshTitle.style}>{freshTitle.text}</h2>
          <Link href="/categoria/frutas-verduras" className="text-sm font-semibold text-brand-dark hover:underline">
            Ver todas →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {fresh.slice(0, 4).map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      {/* Populares */}
      <section aria-labelledby="pop-title">
        <h2 id="pop-title" className="mb-3 text-lg font-bold text-ink" style={popularTitle.style}>{popularTitle.text}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {popular.slice(0, 8).map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      {/* Cervezas y licores — solo si el horario configurado lo permite */}
      {liquorOpen && beers.length > 0 && (
        <section aria-labelledby="liquor-title" className="rounded-card bg-liquor-soft p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="liquor-title" className="text-lg font-bold text-liquor" style={liquorTitle.style}>{liquorTitle.text}</h2>
            <Link href="/categoria/cervezas" className="text-sm font-semibold text-liquor hover:underline">
              Ver más →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {beers.slice(0, 4).map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
          <p className="mt-3 text-xs text-liquor">
            Venta exclusiva a mayores de 18 años. Se verifica documento en la entrega.
          </p>
          <p className="mt-1 inline-block rounded-full bg-liquor px-3 py-1 text-xs font-bold text-white">
            🌙 Próximamente: domicilios de licores 24 horas
          </p>
        </section>
      )}

      {/* Sello de barrio */}
      <section className="flex items-center gap-4 rounded-card border border-brand-soft bg-white p-4">
        <Image src="/icons/logo.svg" alt="" width={56} height={56} />
        <div className="text-sm text-ink-soft" style={{ fontFamily: neighborhood.style.fontFamily }}>
          <p className="font-semibold text-brand-dark" style={{ fontSize: neighborhood.style.fontSize, color: neighborhood.style.color }}>{neighborhood.text}</p>
          <p>{neighborhood.sub}</p>
        </div>
      </section>
    </div>
  );
}
