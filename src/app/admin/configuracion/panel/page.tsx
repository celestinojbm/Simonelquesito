import { requirePermission } from "@/lib/auth/session";
import { getSetting } from "@/modules/config/service";
import { BASE_NAV, CONFIG_HREF } from "@/modules/admin/nav";
import { DASHBOARD_CARDS, DASHBOARD_ROLES } from "@/modules/admin/dashboard";
import { ConfigTabs } from "../config-tabs";
import { PanelClient, type NavRow } from "./panel-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Panel · Configuración" };

export default async function PanelCustomizePage() {
  await requirePermission("settings.manage");
  const cfg = await getSetting("admin.panel");

  // Ordena la lista base según navOrder (sin ocultar; el editor muestra todo).
  const rank = new Map((cfg.navOrder ?? []).map((h, i) => [h, i] as const));
  const baseIndex = new Map(BASE_NAV.map((n, i) => [n.href, i] as const));
  const ordered = [...BASE_NAV].sort((a, b) => {
    const ra = rank.has(a.href) ? (rank.get(a.href) as number) : Infinity;
    const rb = rank.has(b.href) ? (rank.get(b.href) as number) : Infinity;
    if (ra !== rb) return ra - rb;
    return (baseIndex.get(a.href) ?? 0) - (baseIndex.get(b.href) ?? 0);
  });

  const items: NavRow[] = ordered.map((n) => ({
    href: n.href,
    icon: n.icon,
    defaultLabel: n.label,
    label: cfg.navLabels?.[n.href] ?? "",
    hidden: (cfg.navHidden ?? []).includes(n.href),
    canHide: n.href !== CONFIG_HREF,
  }));

  return (
    <div className="max-w-3xl space-y-4">
      <ConfigTabs />
      <div>
        <h2 className="text-lg font-bold text-ink">🖥️ Personalizar el panel</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Cambia el <strong className="text-ink">menú lateral</strong> (renómbralo,
          reordénalo o esconde secciones) y el <strong className="text-ink">color
          del panel</strong>. Los cambios aplican para todo el equipo; cada
          sección solo aparece si el rol tiene permiso. «Configuración» no se
          puede ocultar (para no perder este editor).
        </p>
      </div>
      <PanelClient
        items={items}
        accent={cfg.accent}
        cards={DASHBOARD_CARDS.map((c) => ({ ...c }))}
        roles={DASHBOARD_ROLES.map((r) => ({ ...r }))}
        dashboard={cfg.dashboard ?? {}}
        blocks={cfg.blocks ?? []}
      />
    </div>
  );
}
