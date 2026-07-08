/**
 * Seed de demostración — instancia salsamentaria (plantilla marketcastilla).
 * Ejecutar: BUSINESS_PRESET=salsamentaria npm run db:seed (idempotente: limpia y recrea los datos demo)
 *
 * Cuentas demo (contraseña de todas: demo1234):
 *   owner@marketcastilla.demo       — Propietario
 *   admin@marketcastilla.demo       — Administrador
 *   cajero@marketcastilla.demo      — Cajero
 *   preparador@marketcastilla.demo  — Preparador de pedidos
 *   domiciliario@marketcastilla.demo— Domiciliario
 *   contador@marketcastilla.demo    — Contador (solo lectura)
 *   agencia@marketcastilla.demo     — Admin técnico/agencia
 *   cliente@marketcastilla.demo     — Cliente
 */
import "./load-env";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";
import { BUSINESS_PRESETS, getPreset } from "./presets";
import { hashPassword } from "@/lib/auth/password";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { settingsDefaults, settingsSchemas, type SettingKey } from "@/modules/config/keys";
import { id } from "@/lib/ids";

async function main() {
  console.log("→ Extensiones y secuencias…");
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS unaccent`);
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001`);

  console.log("→ Limpiando datos previos…");
  // Orden inverso de dependencias
  const tables = [
    s.commissionAdjustments, s.commissionPeriods, s.auditEvents,
    s.syncJobs, s.externalProductMappings, s.integrationAccounts,
    s.notifications, s.cashSessions, s.expenses,
    s.loyaltyTransactions, s.loyaltyAccounts, s.coupons, s.promotions,
    s.deliveries, s.drivers, s.deliveryZones,
    s.refunds, s.webhookEvents, s.payments,
    s.substitutions, s.orderStatusEvents, s.orderItems, s.orders,
    s.payables, s.purchaseReceipts, s.purchaseOrderItems, s.purchaseOrders, s.suppliers,
    s.inventoryReservations, s.inventoryMovements, s.inventoryLots, s.inventoryLocations,
    s.prices, s.productImages, s.productVariants, s.products, s.categories,
    s.consents, s.customerAddresses, s.customers,
    s.sessions, s.rolePermissions, s.users,
    s.settings, s.branches, s.businesses,
  ];
  for (const table of tables) await db.delete(table);

  console.log("→ Negocio y sucursal…");
  // Razón social, NIT y dirección son PENDIENTES (ver docs/PENDING_DATA.md
  // #2-3) — nunca se inventan ni se heredan de otro negocio de la plantilla.
  const businessId = "biz_salsamentaria";
  await db.insert(s.businesses).values({
    id: businessId,
    name: "Simón El Quesito",
    legalName: "PENDIENTE — razón social real",
    taxId: "PENDIENTE",
  });
  const branchId = "brn_principal";
  await db.insert(s.branches).values({
    id: branchId,
    businessId,
    name: "Simón El Quesito — Principal",
    addressLine: "PENDIENTE — dirección real del local",
    neighborhood: "PENDIENTE",
    city: "Bogotá",
  });

  console.log("→ Configuración editable (settings)…");
  for (const key of Object.keys(settingsDefaults) as SettingKey[]) {
    const value = settingsSchemas[key].parse(settingsDefaults[key]);
    await db.insert(s.settings).values({ id: id("set"), key, value, updatedBy: "seed" });
  }

  console.log("→ Permisos por rol…");
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permission of perms) {
      await db.insert(s.rolePermissions).values({
        role: role as (typeof s.roleEnum.enumValues)[number],
        permission,
      });
    }
  }

  console.log("→ Usuarios demo…");
  const password = await hashPassword("demo1234");
  const demoUsers = [
    { id: "usr_owner", email: "owner@marketcastilla.demo", fullName: "Propietario Demo", role: "owner" },
    { id: "usr_admin", email: "admin@marketcastilla.demo", fullName: "Administrador Demo", role: "admin" },
    { id: "usr_cashier", email: "cajero@marketcastilla.demo", fullName: "Cajero Demo", role: "cashier" },
    { id: "usr_picker", email: "preparador@marketcastilla.demo", fullName: "Preparador Demo", role: "picker" },
    { id: "usr_driver", email: "domiciliario@marketcastilla.demo", fullName: "Domiciliario Demo", role: "driver" },
    { id: "usr_accountant", email: "contador@marketcastilla.demo", fullName: "Contador Demo", role: "accountant" },
    { id: "usr_agency", email: "agencia@marketcastilla.demo", fullName: "Agencia Técnica Demo", role: "tech_admin" },
    { id: "usr_customer", email: "cliente@marketcastilla.demo", fullName: "Cliente Demo", role: "customer" },
  ] as const;
  for (const u of demoUsers) {
    await db.insert(s.users).values({ ...u, passwordHash: password });
  }
  await db.insert(s.drivers).values({ id: "drv_demo", userId: "usr_driver", vehicle: "moto" });

  const customerId = "cus_demo";
  await db.insert(s.customers).values({
    id: customerId,
    userId: "usr_customer",
    fullName: "Cliente Demo",
    phone: "3000000000",
    email: "cliente@marketcastilla.demo",
  });
  await db.insert(s.consents).values({
    id: id("cns"),
    customerId,
    kind: "data_processing",
    granted: true,
    source: "seed",
  });
  await db.insert(s.loyaltyAccounts).values({ id: id("loy"), customerId, pointsBalance: 0 });

  console.log("→ Zonas de entrega…");
  // Zona/barrios/tarifas DEMO heredados de la plantilla — PENDIENTES de
  // reemplazar por la cobertura real de este negocio (ver PENDING_DATA.md
  // #7). El id y los valores numéricos los usa el vertical slice de tests
  // heredado del motor compartido: no cambiarlos sin actualizar los tests.
  const zones = [
    {
      id: "zon_castilla",
      name: "Zona demo — PENDIENTE reemplazar con cobertura real",
      neighborhoods: ["PENDIENTE"],
      feeCop: 2000,
      minOrderCop: 10000,
      etaMin: 20,
      etaMax: 50,
    },
  ];
  for (const z of zones) {
    await db.insert(s.deliveryZones).values({
      id: z.id,
      branchId,
      name: z.name,
      neighborhoods: z.neighborhoods,
      feeCop: z.feeCop,
      minOrderCop: z.minOrderCop,
      etaMinutesMin: z.etaMin,
      etaMinutesMax: z.etaMax,
    });
  }

  console.log("→ Ubicación de inventario…");
  const locationId = "loc_sala";
  await db.insert(s.inventoryLocations).values({
    id: locationId,
    branchId,
    name: "Sala de ventas",
    isDefault: true,
  });

  // Plantilla replicable: el preset define categorías/reglas del tipo de
  // negocio (BUSINESS_PRESET=minimarket|fruver|farmacia|ferreteria|licoreria|salsamentaria).
  const { key: presetKey, preset } = getPreset(process.env.BUSINESS_PRESET);
  console.log(`→ Categorías (preset: ${presetKey} — ${preset.label})…`);
  for (const c of preset.categories) {
    await db.insert(s.categories).values({
      id: c.id, slug: c.slug, name: c.name, icon: c.icon,
      prepArea: c.prepArea, sortOrder: c.sort, isRestricted: c.restricted ?? false,
    });
  }
  // Reglas de restringidos y unidades del preset (sobre los defaults).
  await db.update(s.settings)
    .set({ value: preset.restrictedRules, updatedBy: `preset:${presetKey}` })
    .where(eq(s.settings.key, "restricted.rules"));
  await db.update(s.settings)
    .set({ value: preset.enablePoundUnit, updatedBy: `preset:${presetKey}` })
    .where(eq(s.settings.key, "catalog.enablePoundUnit"));
  await db.update(s.settings)
    .set({
      value: { ...settingsDefaults.branding, ...preset.brandingDefaults },
      updatedBy: `preset:${presetKey}`,
    })
    .where(eq(s.settings.key, "branding"));
  if (presetKey === "minimarket") {
    await seedDemoCatalog(locationId);
  } else {
    console.log("   (sin productos demo: el negocio importa su catálogo real)");
  }

  console.log("→ Cuenta de integración POS (CSV)…");
  await db.insert(s.integrationAccounts).values({
    id: id("int"),
    kind: "pos_treinta",
    name: "Treinta (importación/exportación CSV)",
    status: "not_connected",
    config: { mode: "csv", note: "Sin API pública; sincronización por archivos." },
  });

  console.log("✔ Seed completado.");
  console.log("  Cuentas demo (contraseña: demo1234):");
  for (const u of demoUsers) console.log(`    ${u.email} — ${u.role}`);
  process.exit(0);
}

/** Catálogo de demostración — solo para el preset minimarket. */
async function seedDemoCatalog(locationId: string) {

  console.log("→ Productos y variantes…");
  type P = {
    slug: string; name: string; cat: string; brand?: string; desc?: string;
    restricted?: string; searchTerms?: string[];
    variants: {
      name: string; sku: string; price: number; compareAt?: number; cost?: number;
      saleUnit?: "unit" | "pack" | "kg" | "g" | "l" | "ml";
      soldByWeight?: boolean; estimatedWeightG?: number; perishable?: boolean; stock: number;
    }[];
  };
  const catalog: P[] = [
    // Frutas y verduras (peso variable)
    { slug: "banano", name: "Banano criollo", cat: "cat_frutas", desc: "Banano fresco. Puedes pedirlo verde o maduro en las notas.", searchTerms: ["platano bocadillo", "bananos"], variants: [
      { name: "Por libra", sku: "FRU-001", price: 3800, cost: 2500, saleUnit: "kg", soldByWeight: true, perishable: true, stock: 40000 },
    ]},
    { slug: "aguacate-hass", name: "Aguacate Hass", cat: "cat_frutas", desc: "Aguacate Hass. Indica en las notas si lo prefieres maduro.", variants: [
      { name: "Unidad (~250 g)", sku: "FRU-002", price: 3500, cost: 2200, soldByWeight: true, estimatedWeightG: 250, perishable: true, stock: 60 },
    ]},
    { slug: "papa-pastusa", name: "Papa pastusa", cat: "cat_frutas", searchTerms: ["papas", "patata"], variants: [
      { name: "Por libra", sku: "FRU-003", price: 3200, cost: 2000, saleUnit: "kg", soldByWeight: true, perishable: true, stock: 80000 },
    ]},
    { slug: "tomate-chonto", name: "Tomate chonto", cat: "cat_frutas", variants: [
      { name: "Por libra", sku: "FRU-004", price: 4500, cost: 3000, saleUnit: "kg", soldByWeight: true, perishable: true, stock: 35000 },
    ]},
    { slug: "cebolla-cabezona", name: "Cebolla cabezona", cat: "cat_frutas", variants: [
      { name: "Por libra", sku: "FRU-005", price: 3900, cost: 2600, saleUnit: "kg", soldByWeight: true, perishable: true, stock: 30000 },
    ]},
    { slug: "zanahoria", name: "Zanahoria", cat: "cat_frutas", variants: [
      { name: "Por libra", sku: "FRU-006", price: 3400, compareAt: 4000, cost: 2100, saleUnit: "kg", soldByWeight: true, perishable: true, stock: 25000 },
    ]},
    { slug: "limon-tahiti", name: "Limón Tahití", cat: "cat_frutas", variants: [
      { name: "Por libra", sku: "FRU-007", price: 4200, cost: 2800, saleUnit: "kg", soldByWeight: true, perishable: true, stock: 20000 },
    ]},
    { slug: "mango-tommy", name: "Mango Tommy", cat: "cat_frutas", variants: [
      { name: "Unidad (~400 g)", sku: "FRU-008", price: 3000, compareAt: 3800, cost: 1900, soldByWeight: true, estimatedWeightG: 400, perishable: true, stock: 45 },
    ]},
    // Abarrotes
    { slug: "arroz-diana-1kg", name: "Arroz Diana", cat: "cat_abarrotes", brand: "Diana", variants: [
      { name: "Bolsa 1 kg", sku: "ABA-001", price: 4900, cost: 3900, stock: 120 },
      { name: "Bolsa 5 kg", sku: "ABA-002", price: 23500, cost: 19000, stock: 40 },
    ]},
    { slug: "aceite-premier-1l", name: "Aceite Premier", cat: "cat_abarrotes", brand: "Premier", variants: [
      { name: "Botella 1 L", sku: "ABA-003", price: 12900, compareAt: 14500, cost: 10200, stock: 60 },
    ]},
    { slug: "panela-real", name: "Panela La Real", cat: "cat_abarrotes", variants: [
      { name: "Unidad 500 g", sku: "ABA-004", price: 3200, cost: 2300, stock: 90 },
    ]},
    { slug: "pasta-doria-spaghetti", name: "Spaghetti Doria", cat: "cat_abarrotes", brand: "Doria", variants: [
      { name: "Paquete 500 g", sku: "ABA-005", price: 4300, cost: 3200, stock: 75 },
    ]},
    { slug: "atun-vancamps", name: "Atún Van Camp's lomos en agua", cat: "cat_abarrotes", brand: "Van Camp's", variants: [
      { name: "Lata 160 g", sku: "ABA-006", price: 7800, cost: 6100, stock: 55 },
    ]},
    { slug: "huevos-aa", name: "Huevos AA", cat: "cat_abarrotes", variants: [
      { name: "Cubeta x30", sku: "ABA-007", price: 19500, cost: 16000, perishable: true, stock: 35 },
      { name: "Media docena", sku: "ABA-008", price: 4200, cost: 3400, perishable: true, stock: 50 },
    ]},
    // Panadería
    { slug: "pan-aliñado", name: "Pan aliñado", cat: "cat_panaderia", desc: "Horneado del día.", variants: [
      { name: "Unidad", sku: "PAN-001", price: 800, cost: 450, perishable: true, stock: 120 },
    ]},
    { slug: "mogolla-integral", name: "Mogolla integral", cat: "cat_panaderia", variants: [
      { name: "Unidad", sku: "PAN-002", price: 1000, cost: 600, perishable: true, stock: 80 },
    ]},
    // Refrigerados
    { slug: "leche-alqueria-1l", name: "Leche entera Alquería", cat: "cat_refrigerados", brand: "Alquería", variants: [
      { name: "Bolsa 1 L", sku: "REF-001", price: 4600, cost: 3800, perishable: true, stock: 90 },
    ]},
    { slug: "queso-campesino", name: "Queso campesino", cat: "cat_refrigerados", variants: [
      { name: "Por libra", sku: "REF-002", price: 14000, cost: 11000, saleUnit: "g", soldByWeight: true, perishable: true, stock: 12000 },
    ]},
    { slug: "yogurt-alpina-fresa", name: "Yogurt Alpina fresa", cat: "cat_refrigerados", brand: "Alpina", variants: [
      { name: "Vaso 200 g", sku: "REF-003", price: 3200, compareAt: 3800, cost: 2500, perishable: true, stock: 48 },
    ]},
    { slug: "mantequilla-rama", name: "Margarina Rama", cat: "cat_refrigerados", brand: "Rama", variants: [
      { name: "Barra 500 g", sku: "REF-004", price: 8900, cost: 7000, perishable: true, stock: 30 },
    ]},
    // Bebidas
    { slug: "coca-cola-15l", name: "Coca-Cola", cat: "cat_bebidas", brand: "Coca-Cola", searchTerms: ["gaseosa", "refresco"], variants: [
      { name: "Botella 1.5 L", sku: "BEB-001", price: 6500, cost: 5100, stock: 70 },
      { name: "Lata 330 ml", sku: "BEB-002", price: 2800, cost: 2100, stock: 110 },
    ]},
    { slug: "colombiana-15l", name: "Colombiana", cat: "cat_bebidas", brand: "Postobón", searchTerms: ["gaseosa", "refresco"], variants: [
      { name: "Botella 1.5 L", sku: "BEB-003", price: 5800, compareAt: 6400, cost: 4500, stock: 65 },
    ]},
    { slug: "agua-cristal-600", name: "Agua Cristal", cat: "cat_bebidas", brand: "Cristal", variants: [
      { name: "Botella 600 ml", sku: "BEB-004", price: 2200, cost: 1500, stock: 140 },
    ]},
    { slug: "jugo-hit-mora", name: "Jugo Hit mora", cat: "cat_bebidas", brand: "Postobón", variants: [
      { name: "Caja 1 L", sku: "BEB-005", price: 4800, cost: 3700, stock: 50 },
    ]},
    // Snacks
    { slug: "papas-margarita-pollo", name: "Papas Margarita pollo", cat: "cat_snacks", brand: "Margarita", searchTerms: ["mecato"], variants: [
      { name: "Bolsa 105 g", sku: "SNA-001", price: 4900, cost: 3800, stock: 85 },
    ]},
    { slug: "chocorramo", name: "Chocorramo", cat: "cat_snacks", brand: "Ramo", variants: [
      { name: "Unidad", sku: "SNA-002", price: 3000, cost: 2300, stock: 95 },
    ]},
    { slug: "mani-la-especial", name: "Maní La Especial", cat: "cat_snacks", brand: "La Especial", variants: [
      { name: "Bolsa 180 g", sku: "SNA-003", price: 7200, compareAt: 8000, cost: 5600, stock: 40 },
    ]},
    // Cervezas (restringido)
    { slug: "cerveza-aguila", name: "Cerveza Águila", cat: "cat_cervezas", brand: "Bavaria", restricted: "liquor", variants: [
      { name: "Lata 330 ml", sku: "CER-001", price: 3200, cost: 2500, stock: 150 },
      { name: "Six pack", sku: "CER-002", price: 18000, compareAt: 19200, cost: 14500, saleUnit: "pack", stock: 30 },
    ]},
    { slug: "cerveza-club-colombia", name: "Cerveza Club Colombia dorada", cat: "cat_cervezas", brand: "Bavaria", restricted: "liquor", variants: [
      { name: "Botella 330 ml", sku: "CER-003", price: 4000, cost: 3100, stock: 90 },
    ]},
    // Licores (restringido)
    { slug: "aguardiente-nectar-verde", name: "Aguardiente Néctar verde", cat: "cat_licores", restricted: "liquor", variants: [
      { name: "Botella 750 ml", sku: "LIC-001", price: 52000, cost: 43000, stock: 25 },
      { name: "Media 375 ml", sku: "LIC-002", price: 28000, cost: 23000, stock: 30 },
    ]},
    { slug: "ron-viejo-de-caldas", name: "Ron Viejo de Caldas 3 años", cat: "cat_licores", restricted: "liquor", variants: [
      { name: "Botella 750 ml", sku: "LIC-003", price: 68000, cost: 56000, stock: 18 },
    ]},
    { slug: "whisky-buchanans-12", name: "Whisky Buchanan's 12 años", cat: "cat_licores", brand: "Buchanan's", restricted: "liquor", desc: "Licor importado.", variants: [
      { name: "Botella 750 ml", sku: "LIC-004", price: 165000, cost: 138000, stock: 8 },
    ]},
    // Cigarrillos (restringido)
    { slug: "cigarrillos-marlboro", name: "Cigarrillos Marlboro", cat: "cat_cigarrillos", restricted: "cigarettes", variants: [
      { name: "Cajetilla x20", sku: "CIG-001", price: 12500, cost: 10500, stock: 40 },
    ]},
    // Aseo
    { slug: "detergente-fab-1kg", name: "Detergente Fab floral", cat: "cat_aseo", brand: "Fab", searchTerms: ["jabon para ropa", "jabón para ropa"], variants: [
      { name: "Bolsa 1 kg", sku: "ASE-001", price: 12800, compareAt: 14200, cost: 10000, stock: 45 },
    ]},
    { slug: "jabon-rey", name: "Jabón Rey", cat: "cat_aseo", variants: [
      { name: "Barra 300 g", sku: "ASE-002", price: 3400, cost: 2600, stock: 70 },
    ]},
    { slug: "papel-familia-x4", name: "Papel higiénico Familia", cat: "cat_aseo", brand: "Familia", variants: [
      { name: "Paquete x4", sku: "ASE-003", price: 9800, cost: 7800, saleUnit: "pack", stock: 55 },
    ]},
    { slug: "clorox-1l", name: "Blanqueador Clorox", cat: "cat_aseo", brand: "Clorox", variants: [
      { name: "Botella 1 L", sku: "ASE-004", price: 6900, cost: 5300, stock: 38 },
    ]},
    // Mascotas
    { slug: "dogourmet-2kg", name: "Concentrado Dogourmet carne", cat: "cat_mascotas", brand: "Dogourmet", variants: [
      { name: "Bolsa 2 kg", sku: "MAS-001", price: 24500, cost: 20000, stock: 22 },
    ]},
    { slug: "arena-gatos-5kg", name: "Arena para gatos", cat: "cat_mascotas", variants: [
      { name: "Bolsa 5 kg", sku: "MAS-002", price: 19900, compareAt: 22000, cost: 16000, stock: 15 },
    ]},
  ];

  for (const p of catalog) {
    const productId = id("prd");
    const catRow = BUSINESS_PRESETS.minimarket!.categories.find((c) => c.id === p.cat)!;
    await db.insert(s.products).values({
      id: productId,
      slug: p.slug,
      name: p.name,
      description: p.desc ?? null,
      categoryId: p.cat,
      brand: p.brand ?? null,
      searchTerms: p.searchTerms ?? [],
      isRestricted: !!p.restricted,
      restrictedRuleKey: p.restricted ?? null,
    });
    await db.insert(s.productImages).values({
      id: id("img"),
      productId,
      url: `/images/cat/${catRow.slug}.svg`,
      alt: p.name,
    });
    for (const v of p.variants) {
      const variantId = id("var");
      await db.insert(s.productVariants).values({
        id: variantId,
        productId,
        name: v.name,
        sku: v.sku,
        saleUnit: v.saleUnit ?? "unit",
        soldByWeight: v.soldByWeight ?? false,
        estimatedWeightG: v.estimatedWeightG ?? null,
        priceCop: v.price,
        compareAtCop: v.compareAt ?? null,
        costCop: v.cost ?? null,
        isPerishable: v.perishable ?? false,
      });
      await db.insert(s.prices).values({ id: id("pri"), variantId, priceCop: v.price, createdBy: "seed" });
      // Inventario inicial vía ledger (unidades, o gramos/ml para peso/volumen)
      await db.insert(s.inventoryMovements).values({
        id: id("mov"),
        variantId,
        locationId,
        type: "initial",
        qty: v.stock,
        reason: "Inventario inicial demo",
        referenceType: "manual",
        createdBy: "seed",
      });
    }
  }

  console.log("→ Promoción y cupón demo…");
  const promoId = id("pro");
  await db.insert(s.promotions).values({
    id: promoId,
    name: "Bienvenida primera compra",
    kind: "percent",
    value: 1000, // 10% en bps
    minPurchaseCop: 30000,
    maxUses: 100,
    excludesRestricted: true,
    isActive: true,
  });
  await db.insert(s.coupons).values({
    id: id("cpn"),
    code: "BIENVENIDO10",
    promotionId: promoId,
    maxUses: 100,
  });

  console.log("→ Proveedores demo…");
  await db.insert(s.suppliers).values([
    { id: id("sup"), name: "Distribuidora Abastos Bogotá", contactName: null, phone: null, notes: "PENDIENTE: datos reales del proveedor" },
    { id: id("sup"), name: "Bavaria — distribuidor local", contactName: null, phone: null, notes: "PENDIENTE: datos reales del proveedor" },
  ]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
