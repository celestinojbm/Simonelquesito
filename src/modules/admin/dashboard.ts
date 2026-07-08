/**
 * Tarjetas del Dashboard y roles que lo ven — registro puro (servidor y panel).
 * La configuración por rol (qué tarjetas y en qué orden) vive en la llave de
 * settings `admin.panel` bajo `dashboard`.
 */

export const DASHBOARD_CARDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "total", label: "Ventas totales hoy" },
  { key: "online", label: "🛒 En línea hoy" },
  { key: "store", label: "🏪 Tienda física hoy" },
  { key: "active", label: "Pedidos activos" },
  { key: "ticket", label: "Ticket promedio hoy" },
  { key: "new", label: "Clientes nuevos hoy" },
];

export const DASHBOARD_CARD_KEYS = DASHBOARD_CARDS.map((c) => c.key);

/** Roles que pueden ver el Dashboard (tienen el permiso reports.view). */
export const DASHBOARD_ROLES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "owner", label: "Dueño" },
  { value: "admin", label: "Administrador" },
  { value: "accountant", label: "Contador" },
  { value: "tech_admin", label: "Agencia (técnico)" },
];

export type DashboardConfig = Record<string, string[]>; // rol → llaves visibles en orden

/**
 * Tarjetas visibles (en orden) para un rol. Sin configuración → todas en el
 * orden por defecto. Con configuración → solo las llaves listadas y válidas.
 */
export function dashboardCardsForRole(cfg: DashboardConfig, role: string, allKeys: string[]): string[] {
  const list = cfg?.[role];
  if (!list) return allKeys;
  return list.filter((k) => allKeys.includes(k));
}
