/**
 * Market Castilla — Esquema de base de datos (PostgreSQL + Drizzle ORM).
 *
 * Reglas transversales:
 * - Dinero SIEMPRE en unidades enteras de COP (peso colombiano). Nunca float.
 * - Pesos/cantidades variables en gramos/mililitros enteros (qtyMinorUnits).
 * - El stock nunca se edita directamente: todo pasa por inventory_movements.
 * - Toda mutación crítica genera un registro en audit_events.
 */
import {
  pgTable,
  pgEnum,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  pgSequence,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Números de pedido legibles: MC-1001, MC-1002… */
export const orderNumberSeq = pgSequence("order_number_seq", { startWith: "1001" });

/* ============================= Enums ============================= */

export const roleEnum = pgEnum("role", [
  "customer",
  "cashier",
  "picker",
  "admin",
  "driver",
  "accountant", // solo lectura
  "tech_admin", // agencia: sin acceso a dinero/cuentas bancarias
  "owner",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "new",
  "pending_payment",
  "paid",
  "confirmed",
  "preparing",
  "awaiting_substitution",
  "weight_adjustment_pending",
  "ready",
  "assigned",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "refunded",
  "failed",
]);

export const fulfillmentEnum = pgEnum("fulfillment_type", ["delivery", "pickup"]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
  "refunded",
  "partially_refunded",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "sandbox",
  "wompi",
  "mercado_pago",
  "nequi",
  "daviplata",
  "bank_transfer",
  "cash_on_delivery",
  "card_on_delivery",
  "store_credit",
]);

export const unitEnum = pgEnum("sale_unit", [
  "unit",
  "pack",
  "kg",
  "g",
  "l",
  "ml",
  "lb", // habilitada solo si el negocio la activa en configuración
]);

export const movementTypeEnum = pgEnum("inventory_movement_type", [
  "purchase_receipt",
  "sale",
  "adjustment",
  "shrinkage", // merma
  "return_in",
  "return_out",
  "transfer",
  "initial",
]);

export const reservationStatusEnum = pgEnum("reservation_status", [
  "active",
  "consumed",
  "released",
]);

export const substitutionPrefEnum = pgEnum("substitution_preference", [
  "no_substitution",
  "similar_product",
  "contact_me",
  "up_to_price_limit",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "pending",
  "assigned",
  "picked_up",
  "delivered",
  "failed",
  "returned",
]);

export const salesChannelEnum = pgEnum("sales_channel", [
  "web_pwa",
  "whatsapp",
  "rappi",
  "didi",
  "social",
  "manual",
  "pos_physical",
  "subscription", // canastas recurrentes
]);

export const syncJobStatusEnum = pgEnum("sync_job_status", [
  "pending",
  "running",
  "completed",
  "completed_with_errors",
  "failed",
]);

export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "draft",
  "sent",
  "partially_received",
  "received",
  "cancelled",
]);

export const commissionPeriodStatusEnum = pgEnum("commission_period_status", [
  "open",
  "pending_approval",
  "approved",
  "closed",
]);

/* ========================= Núcleo del negocio ========================= */

export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name"), // pendiente de completar
  taxId: text("tax_id"), // NIT — pendiente de completar
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const branches = pgTable("branches", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  name: text("name").notNull(),
  addressLine: text("address_line"), // pendiente de completar
  neighborhood: text("neighborhood"),
  city: text("city").notNull().default("Bogotá"),
  timezone: text("timezone").notNull().default("America/Bogota"),
  isActive: boolean("is_active").notNull().default(true),
});

/**
 * Configuración clave-valor versionable. Aquí viven todos los parámetros
 * que NO deben estar hardcodeados: horarios, umbrales, tolerancias,
 * base de comisión, términos de búsqueda aprobados, etc.
 */
export const settings = pgTable(
  "settings",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id").references(() => branches.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("settings_branch_key_ux").on(t.branchId, t.key)],
);

/**
 * Imágenes de fondo por sección de la tienda del cliente (subidas desde el
 * panel). sectionKey = "home" para la portada, o el slug de la categoría.
 * La imagen vive como data-URI en la BD y se sirve por /api/section-bg/[key]
 * (mismo patrón que las fotos de producto; sin bucket externo).
 */
export const sectionBackgrounds = pgTable(
  "section_backgrounds",
  {
    id: text("id").primaryKey(),
    sectionKey: text("section_key").notNull(),
    // Imagen (data-URI o ruta estática). Puede ser null si la sección solo
    // define un color de fondo.
    url: text("url"),
    // Color de fondo (hex #rrggbb). Se usa como fondo de la sección cuando no
    // hay imagen. La precedencia al mostrar es: imagen > color > diseño base.
    color: text("color"),
    // Texto y tipografía de la sección (título, subtítulo, fuente, tamaño,
    // color de texto). Ver SectionStyle en modules/config/section-style.
    style: jsonb("style").$type<Record<string, unknown>>(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("section_bg_key_ux").on(t.sectionKey)],
);

/* ========================= Usuarios y permisos ========================= */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: roleEnum("role").notNull().default("customer"),
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_ux").on(t.email)],
);

/** Permisos explícitos por rol (semilla en seed.ts, editable por el owner). */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    role: roleEnum("role").notNull(),
    permission: text("permission").notNull(),
  },
  (t) => [primaryKey({ columns: [t.role, t.permission] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_ix").on(t.userId)],
);

/**
 * Códigos de verificación por teléfono (ingreso/registro de clientes).
 * Se guarda el hash del código, nunca el código en claro. Expiran a los
 * 10 minutos y se queman al usarse o al exceder los intentos.
 */
export const verificationCodes = pgTable(
  "verification_codes",
  {
    id: text("id").primaryKey(),
    /** Teléfono normalizado: 57XXXXXXXXXX. */
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    /** login (por teléfono) | email_verify (por correo). */
    purpose: text("purpose").notNull().default("login"),
    /** Correo destino cuando purpose = email_verify (null para login). */
    email: text("email"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_codes_phone_ix").on(t.phone, t.createdAt)],
);

/* ============================= Clientes ============================= */

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id), // null = invitado
    fullName: text("full_name").notNull(),
    documentId: text("document_id"), // opcional
    phone: text("phone").notNull(),
    email: text("email"),
    /** Correo verificado por código (requisito del crédito en línea). */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    birthDate: text("birth_date"), // YYYY-MM-DD; usada para verificación de edad
    ageVerifiedAt: timestamp("age_verified_at", { withTimezone: true }),
    segments: jsonb("segments").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customers_phone_ix").on(t.phone)],
);

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    label: text("label").notNull().default("Casa"),
    addressLine: text("address_line").notNull(),
    neighborhood: text("neighborhood").notNull(),
    zoneId: text("zone_id"),
    references_: text("reference_notes"),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [index("customer_addresses_customer_ix").on(t.customerId)],
);

/** Consentimientos con evidencia auditable (marketing, edad, datos). */
export const consents = pgTable(
  "consents",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    kind: text("kind").notNull(), // marketing_whatsapp | age_terms | data_processing | ...
    granted: boolean("granted").notNull(),
    source: text("source").notNull(), // checkout | profile | import
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consents_customer_kind_ix").on(t.customerId, t.kind)],
);

/* ============================= Catálogo ============================= */

export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    /** Área de preparación: produce|grocery|refrigerated|beverages|liquor|cleaning|other */
    prepArea: text("prep_area").notNull().default("other"),
    isRestricted: boolean("is_restricted").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("categories_slug_ux").on(t.slug)],
);

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: text("category_id").notNull().references(() => categories.id),
    brand: text("brand"),
    /** Términos alternos aprobados por el negocio para búsqueda (sinónimos). */
    searchTerms: jsonb("search_terms").notNull().default(sql`'[]'::jsonb`),
    isRestricted: boolean("is_restricted").notNull().default(false),
    restrictedRuleKey: text("restricted_rule_key"), // ej. "liquor", "cigarettes"
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_slug_ux").on(t.slug),
    index("products_category_ix").on(t.categoryId),
  ],
);

/**
 * Variante vendible. Todo precio y stock cuelga de aquí.
 * - saleUnit "unit"/"pack": qty en unidades enteras.
 * - saleUnit "kg"/"g"/"l"/"ml": qty en unidades mínimas (gramos / mililitros).
 * - soldByWeight: el precio final depende del peso real registrado al preparar.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id),
    name: text("name").notNull(), // "500 g", "Six pack", "Unidad"
    sku: text("sku"),
    barcode: text("barcode"), // EAN-13 / UPC-A
    saleUnit: unitEnum("sale_unit").notNull().default("unit"),
    /** Tamaño de la presentación en unidad mínima (g/ml) o 1 para unidad. */
    unitSize: integer("unit_size").notNull().default(1),
    soldByWeight: boolean("sold_by_weight").notNull().default(false),
    /** Peso estimado por unidad en gramos (para venta por unidad de peso variable). */
    estimatedWeightG: integer("estimated_weight_g"),
    priceCop: integer("price_cop").notNull(), // precio de venta actual (COP enteros)
    compareAtCop: integer("compare_at_cop"), // precio tachado para ofertas
    costCop: integer("cost_cop"), // costo promedio — visible solo para roles con permiso
    taxRatePct: integer("tax_rate_bps").notNull().default(0), // impuestos en basis points (1900 = 19%)
    isPerishable: boolean("is_perishable").notNull().default(false),
    physicalLocation: text("physical_location"), // "Pasillo 2, estante B"
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    index("variants_product_ix").on(t.productId),
    uniqueIndex("variants_sku_ux").on(t.sku),
    index("variants_barcode_ix").on(t.barcode),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id),
    url: text("url").notNull(),
    alt: text("alt"),
    /** Atribución de la fuente (ej. Open Food Facts, CC-BY-SA) — se muestra
     *  en la ficha del producto cuando existe, como exige la licencia. */
    credit: text("credit"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("product_images_product_ix").on(t.productId)],
);

/** Historial de precios: cada cambio crea una fila (auditable). */
export const prices = pgTable(
  "prices",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id").notNull().references(() => productVariants.id),
    priceCop: integer("price_cop").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdBy: text("created_by"),
  },
  (t) => [index("prices_variant_ix").on(t.variantId)],
);

/* ============================= Inventario ============================= */

export const inventoryLocations = pgTable("inventory_locations", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id),
  name: text("name").notNull(), // "Sala de ventas", "Bodega"
  isDefault: boolean("is_default").notNull().default(false),
});

/** Lotes para perecederos: FEFO, vencimientos, liquidación. */
export const inventoryLots = pgTable(
  "inventory_lots",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id").notNull().references(() => productVariants.id),
    locationId: text("location_id").notNull().references(() => inventoryLocations.id),
    lotCode: text("lot_code"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    qtyReceived: integer("qty_received").notNull(),
    qtyRemaining: integer("qty_remaining").notNull(),
  },
  (t) => [
    index("lots_variant_ix").on(t.variantId),
    index("lots_expiry_ix").on(t.expiresAt),
  ],
);

/**
 * Ledger de inventario: fuente de verdad del stock.
 * qty positivo = entrada; negativo = salida. Unidad = unidad de venta de la variante
 * (unidades para "unit", gramos para peso, ml para volumen).
 */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id").notNull().references(() => productVariants.id),
    locationId: text("location_id").notNull().references(() => inventoryLocations.id),
    lotId: text("lot_id").references(() => inventoryLots.id),
    type: movementTypeEnum("type").notNull(),
    qty: integer("qty").notNull(),
    reason: text("reason"),
    referenceType: text("reference_type"), // order | purchase_receipt | manual | sync
    referenceId: text("reference_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("movements_variant_ix").on(t.variantId),
    index("movements_ref_ix").on(t.referenceType, t.referenceId),
  ],
);

/** Reservas activas: stock disponible = ledger − reservas activas. */
export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id").notNull().references(() => productVariants.id),
    orderId: text("order_id").notNull(),
    qty: integer("qty").notNull(),
    status: reservationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("reservations_variant_status_ix").on(t.variantId, t.status),
    index("reservations_order_ix").on(t.orderId),
  ],
);

/* ======================== Proveedores y compras ======================== */

export const suppliers = pgTable("suppliers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  taxId: text("tax_id"),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
});

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    status: purchaseOrderStatusEnum("status").notNull().default("draft"),
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("purchase_orders_supplier_ix").on(t.supplierId)],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: text("id").primaryKey(),
    purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id),
    variantId: text("variant_id").notNull().references(() => productVariants.id),
    qtyOrdered: integer("qty_ordered").notNull(),
    unitCostCop: integer("unit_cost_cop").notNull(),
  },
  (t) => [index("po_items_po_ix").on(t.purchaseOrderId)],
);

/** El inventario aumenta SOLO al registrar la recepción, nunca al crear la orden. */
export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: text("id").primaryKey(),
    purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    receivedBy: text("received_by"),
    notes: text("notes"),
  },
  (t) => [index("receipts_po_ix").on(t.purchaseOrderId)],
);

export const payables = pgTable(
  "payables",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    purchaseOrderId: text("purchase_order_id").references(() => purchaseOrders.id),
    invoiceNumber: text("invoice_number"),
    amountCop: integer("amount_cop").notNull(),
    paidCop: integer("paid_cop").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payables_supplier_ix").on(t.supplierId)],
);

/* ============================= Pedidos ============================= */

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    /** Número corto legible para el cliente y el mostrador: MC-1024 */
    number: text("number").notNull(),
    branchId: text("branch_id").notNull().references(() => branches.id),
    customerId: text("customer_id").references(() => customers.id),
    channel: salesChannelEnum("channel").notNull().default("web_pwa"),
    status: orderStatusEnum("status").notNull().default("new"),
    fulfillment: fulfillmentEnum("fulfillment").notNull().default("delivery"),

    // Entrega
    addressLine: text("address_line"),
    neighborhood: text("neighborhood"),
    zoneId: text("zone_id"),
    addressReferences: text("address_references"),
    contactPhone: text("contact_phone").notNull(),
    contactName: text("contact_name").notNull(),
    deliverySlot: text("delivery_slot"), // "asap" | "HH:MM-HH:MM"
    instructions: text("instructions"),
    /** Punto exacto de entrega fijado por el cliente en el mapa (WGS84). */
    deliveryLat: doublePrecision("delivery_lat"),
    deliveryLng: doublePrecision("delivery_lng"),
    /**
     * Token público del pedido: da acceso a la página de mapa/seguimiento
     * (fijar ubicación y ver el domicilio en tiempo real) sin iniciar sesión.
     * Se comparte por WhatsApp; no expone datos de pago.
     */
    locationToken: text("location_token"),

    // Sustituciones y peso
    substitutionPref: substitutionPrefEnum("substitution_pref").notNull().default("similar_product"),
    substitutionPriceLimitCop: integer("substitution_price_limit_cop"),
    hasWeightItems: boolean("has_weight_items").notNull().default(false),

    // Restringidos
    hasRestrictedItems: boolean("has_restricted_items").notNull().default(false),
    ageDeclaredBirthDate: text("age_declared_birth_date"),
    ageTermsAcceptedAt: timestamp("age_terms_accepted_at", { withTimezone: true }),
    idCheckRequired: boolean("id_check_required").notNull().default(false),
    idCheckedAt: timestamp("id_checked_at", { withTimezone: true }),

    // Totales (COP enteros). itemsTotal es estimado si hay peso variable.
    itemsTotalCop: integer("items_total_cop").notNull(),
    discountCop: integer("discount_cop").notNull().default(0),
    deliveryFeeCop: integer("delivery_fee_cop").notNull().default(0),
    taxCop: integer("tax_cop").notNull().default(0),
    tipCop: integer("tip_cop").notNull().default(0),
    totalCop: integer("total_cop").notNull(),
    isEstimatedTotal: boolean("is_estimated_total").notNull().default(false),

    couponCode: text("coupon_code"),
    /** Recepción del pedido por el personal (timbre del panel): la alarma
     *  suena hasta que alguien pulsa «Recibir pedido». POS nace recibido. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by"),
    loyaltyPointsUsed: integer("loyalty_points_used").notNull().default(0),
    marketplaceOrderId: text("marketplace_order_id"), // id externo (Rappi/DiDi)
    marketplaceCommissionCop: integer("marketplace_commission_cop").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_number_ux").on(t.number),
    uniqueIndex("orders_location_token_ux").on(t.locationToken),
    index("orders_status_ix").on(t.status),
    index("orders_customer_ix").on(t.customerId),
    index("orders_channel_created_ix").on(t.channel, t.createdAt),
    uniqueIndex("orders_marketplace_ux").on(t.channel, t.marketplaceOrderId),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id),
    variantId: text("variant_id").notNull().references(() => productVariants.id),
    nameSnapshot: text("name_snapshot").notNull(),
    /** Unidad de venta al momento de la compra (unit|pack|kg|g|l|ml|lb). */
    saleUnitSnapshot: text("sale_unit_snapshot").notNull().default("unit"),
    /** Cantidad pedida en unidad de venta (unidades, gramos o ml). */
    qty: integer("qty").notNull(),
    /** Peso real en gramos registrado por el preparador (peso variable). */
    actualWeightG: integer("actual_weight_g"),
    unitPriceCop: integer("unit_price_cop").notNull(), // por unidad o por kg según variante
    lineTotalCop: integer("line_total_cop").notNull(),
    /** Total recalculado tras pesar; null mientras no se pese. */
    finalLineTotalCop: integer("final_line_total_cop"),
    note: text("note"), // "aguacates maduros"
    isRestricted: boolean("is_restricted").notNull().default(false),
    prepArea: text("prep_area").notNull().default("other"),
  },
  (t) => [index("order_items_order_ix").on(t.orderId)],
);

/** Historial completo de transiciones de estado. */
export const orderStatusEvents = pgTable(
  "order_status_events",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id),
    fromStatus: orderStatusEnum("from_status"),
    toStatus: orderStatusEnum("to_status").notNull(),
    actorUserId: text("actor_user_id"),
    actorLabel: text("actor_label").notNull().default("system"),
    reason: text("reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order_ix").on(t.orderId)],
);

export const substitutions = pgTable(
  "substitutions",
  {
    id: text("id").primaryKey(),
    orderItemId: text("order_item_id").notNull().references(() => orderItems.id),
    originalVariantId: text("original_variant_id").notNull(),
    substituteVariantId: text("substitute_variant_id"),
    status: text("status").notNull().default("proposed"), // proposed|accepted|rejected|auto_applied
    priceDiffCop: integer("price_diff_cop").notNull().default(0),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("substitutions_item_ix").on(t.orderItemId)],
);

/* ============================= Pagos ============================= */

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id),
    provider: text("provider").notNull(), // sandbox | wompi | ...
    method: paymentMethodEnum("method").notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    amountCop: integer("amount_cop").notNull(),
    /** Clave de idempotencia generada por nuestro servidor. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** Referencia del proveedor externo. */
    providerRef: text("provider_ref"),
    /** Intentos y payloads de webhook para conciliación/auditoría. */
    attempts: jsonb("attempts").notNull().default(sql`'[]'::jsonb`),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_idempotency_ux").on(t.provider, t.idempotencyKey),
    index("payments_order_ix").on(t.orderId),
    index("payments_provider_ref_ix").on(t.providerRef),
  ],
);

/** Eventos de webhook procesados (dedupe por proveedor + id de evento). */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_events_ux").on(t.provider, t.externalEventId)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull().references(() => payments.id),
    amountCop: integer("amount_cop").notNull(),
    reason: text("reason").notNull(), // weight_diff | cancellation | complaint
    status: text("status").notNull().default("pending"), // pending|completed|failed
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("refunds_payment_ix").on(t.paymentId)],
);

/* ============================= Delivery ============================= */

export const deliveryZones = pgTable(
  "delivery_zones",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id").notNull().references(() => branches.id),
    name: text("name").notNull(),
    /** Lista de barrios cubiertos (MVP sin polígonos de mapa). */
    neighborhoods: jsonb("neighborhoods").notNull().default(sql`'[]'::jsonb`),
    feeCop: integer("fee_cop").notNull(),
    minOrderCop: integer("min_order_cop").notNull().default(0),
    freeDeliveryFromCop: integer("free_delivery_from_cop"),
    etaMinutesMin: integer("eta_minutes_min").notNull().default(30),
    etaMinutesMax: integer("eta_minutes_max").notNull().default(60),
    /** Capacidad de pedidos por franja horaria. */
    slotCapacity: integer("slot_capacity").notNull().default(10),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("zones_branch_ix").on(t.branchId)],
);

export const drivers = pgTable("drivers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  vehicle: text("vehicle"), // moto | bicicleta | a pie
  isAvailable: boolean("is_available").notNull().default(true),
});

export const deliveries = pgTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id),
    driverId: text("driver_id").references(() => drivers.id),
    status: deliveryStatusEnum("status").notNull().default("pending"),
    /** Código que el cliente entrega al domiciliario como prueba de entrega. */
    confirmationCode: text("confirmation_code").notNull(),
    proofPhotoUrl: text("proof_photo_url"),
    /** Método de pago recibido en puerta (contraentrega/datáfono). */
    paymentReceivedMethod: text("payment_received_method"),
    incidents: jsonb("incidents").notNull().default(sql`'[]'::jsonb`),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Última posición reportada por el domiciliario (seguimiento en vivo). */
    driverLat: doublePrecision("driver_lat"),
    driverLng: doublePrecision("driver_lng"),
    driverLocationAt: timestamp("driver_location_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("deliveries_order_ux").on(t.orderId),
    index("deliveries_driver_status_ix").on(t.driverId, t.status),
  ],
);

/* ===================== Promociones y fidelización ===================== */

export const promotions = pgTable("promotions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** percent | fixed | two_for_one | combo | category_percent | free_delivery */
  kind: text("kind").notNull(),
  value: integer("value").notNull().default(0), // % en bps o COP según kind
  categoryId: text("category_id").references(() => categories.id),
  productIds: jsonb("product_ids").notNull().default(sql`'[]'::jsonb`),
  excludedProductIds: jsonb("excluded_product_ids").notNull().default(sql`'[]'::jsonb`),
  minPurchaseCop: integer("min_purchase_cop").notNull().default(0),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  budgetCop: integer("budget_cop"),
  spentCop: integer("spent_cop").notNull().default(0),
  /** Ventana horaria opcional "HH:MM-HH:MM" para descuentos por horario. */
  timeWindow: text("time_window"),
  excludesRestricted: boolean("excludes_restricted").notNull().default(true),
  stackable: boolean("stackable").notNull().default(false),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
});

export const coupons = pgTable(
  "coupons",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    promotionId: text("promotion_id").notNull().references(() => promotions.id),
    customerId: text("customer_id").references(() => customers.id), // null = campaña
    maxUses: integer("max_uses").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("coupons_code_ux").on(t.code)],
);

export const loyaltyAccounts = pgTable(
  "loyalty_accounts",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    pointsBalance: integer("points_balance").notNull().default(0),
  },
  (t) => [uniqueIndex("loyalty_customer_ux").on(t.customerId)],
);

export const loyaltyTransactions = pgTable(
  "loyalty_transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => loyaltyAccounts.id),
    points: integer("points").notNull(), // + acumula, − redime
    reason: text("reason").notNull(),
    orderId: text("order_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("loyalty_tx_account_ix").on(t.accountId)],
);

/* ==================== Gastos, caja y notificaciones ==================== */

export const expenses = pgTable("expenses", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id),
  concept: text("concept").notNull(),
  amountCop: integer("amount_cop").notNull(),
  category: text("category").notNull().default("general"),
  incurredAt: timestamp("incurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
});

export const cashSessions = pgTable("cash_sessions", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id),
  openedBy: text("opened_by").notNull(),
  openingCop: integer("opening_cop").notNull(),
  closingCop: integer("closing_cop"),
  expectedCop: integer("expected_cop"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

/**
 * Mensajes salientes (WhatsApp/email). En demo el proveedor "console"
 * los deja en status "simulated" para inspección desde el panel.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    channel: text("channel").notNull().default("whatsapp"),
    recipient: text("recipient").notNull(),
    template: text("template").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("queued"), // queued|sent|simulated|failed
    orderId: text("order_id"),
    customerId: text("customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_order_ix").on(t.orderId)],
);

/**
 * Conversaciones de WhatsApp atendidas por el asistente (bot) o por una
 * persona. Una conversación por número de teléfono; el modo decide si el
 * bot responde o si queda en manos del personal.
 */
export const waConversations = pgTable(
  "wa_conversations",
  {
    id: text("id").primaryKey(),
    /** Número en formato internacional sin "+", ej. 573115009070. */
    phone: text("phone").notNull(),
    profileName: text("profile_name"),
    mode: text("mode").notNull().default("bot"), // bot | human
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wa_conversations_phone_ux").on(t.phone)],
);

export const waMessages = pgTable(
  "wa_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => waConversations.id),
    direction: text("direction").notNull(), // in | out
    body: text("body").notNull(),
    /** ID del mensaje en WhatsApp (wamid) — para no procesar duplicados. */
    waMessageId: text("wa_message_id"),
    /** Resumen de herramientas usadas / errores del asistente (diagnóstico). */
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wa_messages_conversation_ix").on(t.conversationId, t.createdAt),
    uniqueIndex("wa_messages_wamid_ux").on(t.waMessageId),
  ],
);

/* ==================== Canastas recurrentes ==================== */

/**
 * Suscripción de mercado ("canasta"): una lista de productos que se
 * convierte en un PEDIDO real cada semana/quincena en el día elegido.
 * Se cobra por entrega (contra entrega por ahora), nunca por adelantado.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    name: text("name").notNull().default("Mi canasta"),
    frequency: text("frequency").notNull(), // weekly | biweekly
    /** Día de entrega: 0=domingo … 6=sábado (hora de Bogotá). */
    deliveryDay: integer("delivery_day").notNull(),
    status: text("status").notNull().default("active"), // active | paused | cancelled
    fulfillment: fulfillmentEnum("fulfillment").notNull().default("delivery"),
    addressLine: text("address_line"),
    neighborhood: text("neighborhood"),
    zoneId: text("zone_id"),
    addressReferences: text("address_references"),
    deliveryLat: doublePrecision("delivery_lat"),
    deliveryLng: doublePrecision("delivery_lng"),
    paymentMethod: text("payment_method").notNull().default("cash_on_delivery"),
    instructions: text("instructions"),
    substitutionPref: substitutionPrefEnum("substitution_pref").notNull().default("similar_product"),
    /** Próxima generación del pedido (fecha objetivo, se corre por el cron). */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastOrderId: text("last_order_id"),
    /** Último error al generar (stock, zona, etc.) — visible en el panel. */
    lastError: text("last_error"),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscriptions_customer_ix").on(t.customerId),
    index("subscriptions_due_ix").on(t.status, t.nextRunAt),
  ],
);

export const subscriptionItems = pgTable(
  "subscription_items",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id").notNull().references(() => subscriptions.id),
    variantId: text("variant_id").notNull().references(() => productVariants.id),
    /** Cantidad en unidad de venta (unidades, o GRAMOS si es por peso). */
    qty: integer("qty").notNull(),
    note: text("note"),
  },
  (t) => [index("subscription_items_sub_ix").on(t.subscriptionId)],
);

/* ==================== Premium y Fiado Digital ==================== */

/**
 * Membresía premium ($ configurable en settings premium.plan). Desbloquea
 * beneficios (domicilio gratis, crédito, puntos) mientras esté activa.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    status: text("status").notNull().default("active"), // active | past_due | cancelled
    /** Canal de activación: online | in_store (mostrador, con el personal). */
    channel: text("channel").notNull().default("in_store"),
    activatedBy: text("activated_by"), // rol:email del personal (alta en tienda)
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memberships_customer_ux").on(t.customerId)],
);

/** Cobros de la mensualidad premium (uno por periodo). */
export const membershipCharges = pgTable(
  "membership_charges",
  {
    id: text("id").primaryKey(),
    membershipId: text("membership_id").notNull().references(() => memberships.id),
    amountCop: integer("amount_cop").notNull(),
    /** Reparto 50/50 acordado: monto que corresponde a la agencia. */
    agencySplitCop: integer("agency_split_cop").notNull().default(0),
    status: text("status").notNull().default("pending"), // pending | paid | failed | waived
    /** cash | transfer | store_credit (va al fiado) | mercado_pago (fase 3) */
    method: text("method"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("membership_charges_membership_ix").on(t.membershipId, t.createdAt)],
);

/**
 * Cuenta de Fiado Digital: el "cuaderno del tendero" formalizado.
 * El saldo NUNCA se edita: es la suma del ledger (credit_ledger).
 */
/**
 * Verificación de identidad para el crédito en línea (mayores de 18 años):
 * el cliente sube su cédula y fecha de nacimiento; el personal la aprueba o
 * rechaza. Al aprobar se marca customers.age_verified_at. La imagen se guarda
 * como data-URI (igual que las fotos de producto) — nunca sale del sistema.
 */
export const identityVerifications = pgTable(
  "identity_verifications",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    documentId: text("document_id").notNull(),
    birthDate: text("birth_date").notNull(), // YYYY-MM-DD
    frontImageUrl: text("front_image_url").notNull(), // data-URI de la cédula
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    reviewNote: text("review_note"),
    reviewedBy: text("reviewed_by"), // rol:email del personal
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("identity_verifications_customer_ix").on(t.customerId, t.createdAt)],
);

export const creditAccounts = pgTable(
  "credit_accounts",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    status: text("status").notNull().default("active"), // active | paused | closed
    /** Cupo vigente en COP (editable desde el panel, con auditoría). */
    limitCop: integer("limit_cop").notNull(),
    /** Alta: online (historial) | in_store (aval presencial del personal). */
    channel: text("channel").notNull().default("in_store"),
    /** Quién avaló el alta en mostrador (rol:email) — queda auditado. */
    vouchedBy: text("vouched_by"),
    pausedReason: text("paused_reason"),
    /** Eliminada de la cartera (borrado suave): visible en el historial por
     *  90 días y restaurable; el ledger contable nunca se destruye. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("credit_accounts_customer_ux").on(t.customerId)],
);

/**
 * Plan de pago de una compra a crédito: cuota única (montos pequeños) o
 * hasta N cuotas semanales/quincenales, según settings credit.rules.
 */
export const creditPlans = pgTable(
  "credit_plans",
  {
    id: text("id").primaryKey(),
    creditAccountId: text("credit_account_id").notNull().references(() => creditAccounts.id),
    /** Pedido en línea asociado (null si la venta se registró en mostrador/POS). */
    orderId: text("order_id").references(() => orders.id),
    totalCop: integer("total_cop").notNull(),
    installmentsCount: integer("installments_count").notNull(),
    frequency: text("frequency").notNull(), // single | weekly | biweekly
    status: text("status").notNull().default("active"), // active | completed | defaulted
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_plans_account_ix").on(t.creditAccountId, t.createdAt)],
);

/** Cuotas del plan, con fecha de vencimiento. */
export const creditInstallments = pgTable(
  "credit_installments",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull().references(() => creditPlans.id),
    seq: integer("seq").notNull(), // 1..N
    amountCop: integer("amount_cop").notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"), // pending | paid
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("credit_installments_plan_ix").on(t.planId, t.seq),
    index("credit_installments_due_ix").on(t.status, t.dueDate),
  ],
);

/**
 * Ledger INMUTABLE del crédito (misma filosofía que el inventario):
 * la deuda solo cambia agregando movimientos, nunca editando.
 * Positivo aumenta la deuda (compra, mensualidad); negativo la reduce (pago).
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    creditAccountId: text("credit_account_id").notNull().references(() => creditAccounts.id),
    type: text("type").notNull(), // purchase | membership_fee | payment | adjustment
    amountCop: integer("amount_cop").notNull(), // con signo
    planId: text("plan_id").references(() => creditPlans.id),
    orderId: text("order_id").references(() => orders.id),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_ledger_account_ix").on(t.creditAccountId, t.createdAt)],
);

/* ==================== Integraciones y sincronización ==================== */

export const integrationAccounts = pgTable(
  "integration_accounts",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(), // pos_treinta | rappi | didi | wompi | whatsapp
    name: text("name").notNull(),
    /** Credenciales SIEMPRE cifradas (AES-GCM con clave de entorno); nunca texto plano. */
    encryptedCredentials: text("encrypted_credentials"),
    status: text("status").notNull().default("not_connected"), // not_connected|sandbox|live
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("integration_kind_ux").on(t.kind)],
);

/** Mapeo SKU interno ↔ producto externo (Rappi, DiDi, POS). */
export const externalProductMappings = pgTable(
  "external_product_mappings",
  {
    id: text("id").primaryKey(),
    integrationId: text("integration_id").notNull().references(() => integrationAccounts.id),
    variantId: text("variant_id").notNull().references(() => productVariants.id),
    externalId: text("external_id").notNull(),
    externalName: text("external_name"),
  },
  (t) => [
    uniqueIndex("ext_mapping_ux").on(t.integrationId, t.externalId),
    index("ext_mapping_variant_ix").on(t.variantId),
  ],
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(), // pos_import_products | pos_export_sales | ...
    status: syncJobStatusEnum("status").notNull().default("pending"),
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_jobs_kind_ix").on(t.kind, t.createdAt)],
);

/* ========================= Auditoría y comisión ========================= */

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    actorLabel: text("actor_label").notNull().default("system"),
    action: text("action").notNull(), // price.update | inventory.adjust | refund.create | ...
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_entity_ix").on(t.entityType, t.entityId),
    index("audit_action_ix").on(t.action, t.createdAt),
  ],
);

export const commissionPeriods = pgTable(
  "commission_periods",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(), // "2026-07 (mensual)"
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    status: commissionPeriodStatusEnum("status").notNull().default("open"),
    /** Snapshot inmutable del cálculo (base configurada + desglose por canal). */
    snapshot: jsonb("snapshot"),
    ratePctBps: integer("rate_pct_bps").notNull().default(1000), // 10.00% = 1000 bps
    commissionCop: bigint("commission_cop", { mode: "number" }),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("commission_period_ux").on(t.periodStart, t.periodEnd)],
);

export const commissionAdjustments = pgTable(
  "commission_adjustments",
  {
    id: text("id").primaryKey(),
    periodId: text("period_id").notNull().references(() => commissionPeriods.id),
    amountCop: integer("amount_cop").notNull(), // + a favor de agencia, − a favor del negocio
    reason: text("reason").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("commission_adj_period_ix").on(t.periodId)],
);
