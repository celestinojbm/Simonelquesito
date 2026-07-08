import type { Permission } from "@/lib/auth/permissions";
import type { SettingValue } from "@/modules/config/keys";

/**
 * Menú del panel administrativo. Lista base (semilla) y resolución con la
 * personalización guardada (orden, ocultos y renombrados) — Nivel 1 del panel
 * editable. La ruta de Configuración nunca se puede ocultar (para no perder el
 * acceso al propio editor).
 */

export type AdminNavItem = {
  href: string;
  label: string;
  icon: string;
  perm: Permission;
  activeFor?: string[];
};

export const CONFIG_HREF = "/admin/configuracion";

export const BASE_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "📊", perm: "reports.view", activeFor: ["/admin/analitica"] },
  { href: "/admin/caja", label: "Caja", icon: "🛒", perm: "orders.manage" },
  { href: "/admin/pedidos", label: "Pedidos", icon: "🧾", perm: "orders.view" },
  { href: "/admin/canastas", label: "Canastas", icon: "🧺", perm: "orders.manage" },
  { href: "/admin/productos", label: "Productos", icon: "🛍️", perm: "catalog.manage" },
  { href: "/admin/inventario", label: "Inventario", icon: "📦", perm: "inventory.view" },
  { href: "/admin/importar", label: "Importar POS", icon: "🔄", perm: "pos.sync" },
  { href: "/admin/mensajes", label: "Mensajes", icon: "💬", perm: "orders.view" },
  { href: "/admin/whatsapp", label: "Bot WhatsApp", icon: "🤖", perm: "orders.manage" },
  { href: "/admin/promociones", label: "Promociones", icon: "🎟️", perm: "coupons.manage" },
  { href: "/admin/retencion", label: "Retención", icon: "💜", perm: "customers.manage" },
  { href: "/admin/fiado", label: "Fiado & Premium", icon: "📒", perm: "customers.manage" },
  { href: "/admin/identidades", label: "Identidades", icon: "🪪", perm: "customers.manage" },
  { href: "/admin/comision", label: "Comisión digital", icon: "🧮", perm: "commission.view" },
  { href: "/admin/integraciones", label: "Integraciones", icon: "🔌", perm: "integrations.manage" },
  { href: CONFIG_HREF, label: "Configuración", icon: "⚙️", perm: "settings.view", activeFor: ["/admin/configuracion/fondos", "/admin/configuracion/panel"] },
  { href: "/admin/auditoria", label: "Auditoría", icon: "🛡️", perm: "audit.view" },
];

export type AdminPanelConfig = SettingValue<"admin.panel">;

/** Aplica la personalización (renombrar, ocultar, reordenar) a la lista base. */
export function resolveNav(cfg: AdminPanelConfig): AdminNavItem[] {
  const labels = cfg.navLabels ?? {};
  const hidden = new Set(cfg.navHidden ?? []);
  const order = cfg.navOrder ?? [];
  const rank = new Map(order.map((h, i) => [h, i] as const));
  const baseIndex = new Map(BASE_NAV.map((n, i) => [n.href, i] as const));

  return BASE_NAV.map((n) => ({ ...n, label: labels[n.href]?.trim() || n.label }))
    // Configuración jamás se oculta (evita quedar sin acceso al editor).
    .filter((n) => n.href === CONFIG_HREF || !hidden.has(n.href))
    .sort((a, b) => {
      const ra = rank.has(a.href) ? (rank.get(a.href) as number) : Infinity;
      const rb = rank.has(b.href) ? (rank.get(b.href) as number) : Infinity;
      if (ra !== rb) return ra - rb;
      return (baseIndex.get(a.href) ?? 0) - (baseIndex.get(b.href) ?? 0);
    });
}

/** ¿El texto sobre este color de fondo debe ser oscuro? (luminancia). */
export function accentTextIsDark(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}
