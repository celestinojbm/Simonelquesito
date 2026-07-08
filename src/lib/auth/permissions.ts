/**
 * Permisos explícitos por rol. La matriz se materializa en BD (role_permissions)
 * para que el propietario pueda ajustarla; este archivo define la semilla.
 *
 * Regla clave del contrato: tech_admin (agencia) NUNCA recibe permisos de
 * dinero (payouts, cuentas bancarias) — eso requiere al owner.
 */

export const PERMISSIONS = [
  "orders.view",
  "orders.manage", // confirmar, preparar, cambiar estado
  "orders.cancel",
  "orders.adjust_weight",
  "catalog.view",
  "catalog.manage",
  "prices.manage",
  "inventory.view",
  "inventory.adjust",
  "inventory.receive",
  "purchases.manage",
  "suppliers.manage",
  "customers.view",
  "customers.manage",
  "campaigns.manage",
  "coupons.manage",
  "delivery.view_own", // domiciliario: solo sus pedidos
  "delivery.manage",
  "payments.view",
  "payments.refund",
  "bank_accounts.manage", // SOLO owner
  "payouts.manage", // SOLO owner
  "reports.view",
  "commission.view",
  "commission.approve", // SOLO owner
  "settings.view",
  "settings.manage",
  "restricted_rules.manage",
  "users.manage",
  "integrations.manage",
  "audit.view",
  "pos.sync",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type Role =
  | "customer"
  | "cashier"
  | "picker"
  | "admin"
  | "driver"
  | "accountant"
  | "tech_admin"
  | "owner";

const READ_ONLY: Permission[] = [
  "orders.view",
  "catalog.view",
  "inventory.view",
  "customers.view",
  "payments.view",
  "reports.view",
  "commission.view",
  "settings.view",
  "audit.view",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  customer: [],
  cashier: ["orders.view", "orders.manage", "catalog.view", "inventory.view", "customers.view", "payments.view"],
  picker: ["orders.view", "orders.manage", "orders.adjust_weight", "catalog.view", "inventory.view"],
  driver: ["delivery.view_own"],
  accountant: READ_ONLY,
  admin: [
    "orders.view", "orders.manage", "orders.cancel", "orders.adjust_weight",
    "catalog.view", "catalog.manage", "prices.manage",
    "inventory.view", "inventory.adjust", "inventory.receive",
    "purchases.manage", "suppliers.manage",
    "customers.view", "customers.manage",
    "campaigns.manage", "coupons.manage",
    "delivery.manage", "payments.view", "payments.refund",
    "reports.view", "commission.view",
    "settings.view", "settings.manage", "restricted_rules.manage",
    "users.manage", "audit.view", "pos.sync",
  ],
  tech_admin: [
    // Agencia: todo lo técnico/operativo, NADA de dinero.
    "orders.view", "catalog.view", "catalog.manage",
    "inventory.view", "customers.view",
    "campaigns.manage", "coupons.manage",
    "reports.view", "commission.view",
    "settings.view", "settings.manage",
    "integrations.manage", "audit.view", "pos.sync",
  ],
  owner: [...PERMISSIONS],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
