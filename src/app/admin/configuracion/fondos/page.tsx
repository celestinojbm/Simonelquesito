import { requirePermission } from "@/lib/auth/session";
import { listCategories } from "@/modules/catalog/service";
import { listSectionAppearances } from "@/modules/config/section-bg";
import { HOME_BLOCKS } from "@/modules/config/section-style";
import { ConfigTabs } from "../config-tabs";
import { FondosClient, type SectionRow } from "./fondos-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portadas · Configuración" };

export default async function FondosPage() {
  await requirePermission("settings.manage");

  const [categories, current] = await Promise.all([
    listCategories(),
    listSectionAppearances(),
  ]);

  // Capacidades por tipo de sección:
  //  - "page": solo imagen (fondo de toda la tienda).
  //  - portada/categorías (heroes): imagen + color + texto/tipografía + subtítulo.
  //  - bloques del inicio: solo texto/tipografía (sin fondo ni subtítulo).
  const hero = (key: string, label: string, icon: string, placeholder: string): SectionRow => ({
    key, label, icon,
    url: current[key]?.imageUrl ?? null,
    color: current[key]?.color ?? null,
    style: current[key]?.style ?? {},
    pageUrl: current[`pagebg:${key}`]?.imageUrl ?? null,
    allowImage: true, allowColor: true, allowStyle: true, allowSubtitle: true, allowPageBg: true,
    titlePlaceholder: placeholder,
  });

  const sections: SectionRow[] = [
    {
      key: "page", label: "Fondo de pantalla (toda la tienda)", icon: "🖼️",
      url: current["page"]?.imageUrl ?? null, color: null, style: {}, pageUrl: null,
      allowImage: true, allowColor: false, allowStyle: false, allowSubtitle: false, allowPageBg: false, titlePlaceholder: "",
    },
    hero("home", "Portada (inicio)", "🏠", "Ej: Tu mercado de barrio 🛒"),
    ...categories.map((c) => hero(c.slug, c.name, c.icon ?? "🏷️", `Ej: ${c.icon ?? ""} ${c.name}`.trim())),
    ...HOME_BLOCKS.map((b) => ({
      key: b.key, label: b.label, icon: "✍️",
      url: null, color: null, style: current[b.key]?.style ?? {}, pageUrl: null,
      allowImage: false, allowColor: false, allowStyle: true, allowSubtitle: b.sub ?? false, allowPageBg: false,
      titlePlaceholder: `Ej: ${b.defaultText}`,
    })),
  ];

  return (
    <div className="max-w-3xl space-y-4">
      <ConfigTabs />
      <div>
        <h2 className="text-lg font-bold text-ink">🖼️ Portadas</h2>
        <p className="mt-1 text-sm text-ink-soft">
          <strong className="text-ink">Fondo de pantalla</strong>: la imagen de
          toda la tienda (reemplaza el fondo crema, con un velo suave encima para
          que todo se lea). <strong className="text-ink">Portada</strong> y cada{" "}
          <strong className="text-ink">categoría</strong>: fondo (imagen o color)
          y también su <strong className="text-ink">texto, tipografía, tamaño,
          color y emojis</strong>. Escribe el título/subtítulo y pega los emojis o
          símbolos que quieras (🥑 ★ ✦ → 🎉). Precedencia del fondo: imagen &gt;
          color &gt; diseño por defecto. Las fotos se reducen antes de subir. Más
          abajo también puedes editar los <strong className="text-ink">títulos de
          los bloques del inicio</strong> (Categorías, Ofertas del día, etc.).
        </p>
      </div>
      <FondosClient sections={sections} />
    </div>
  );
}
