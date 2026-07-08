import { z } from "zod";

/**
 * Definición tipada de TODA la configuración del negocio.
 * Nada de esto se hardcodea: los valores viven en la tabla `settings`
 * y se editan desde Admin → Configuración (con auditoría).
 */

/** Horario semanal: por día, lista de ventanas "HH:MM-HH:MM". Vacío = cerrado. */
export const weeklyScheduleSchema = z.record(
  z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  z.array(z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)),
);
export type WeeklySchedule = z.infer<typeof weeklyScheduleSchema>;

export const restrictedRuleSchema = z.object({
  label: z.string(),
  /** Horario permitido de VENTA para esta clase de producto. */
  schedule: weeklyScheduleSchema,
  requiresAgeDeclaration: z.boolean(),
  requiresIdCheckOnDelivery: z.boolean(),
  /** Canales donde se permite: delivery, pickup. */
  allowedFulfillments: z.array(z.enum(["delivery", "pickup"])),
  /** Zonas excluidas (ids); vacío = todas permitidas. */
  excludedZoneIds: z.array(z.string()),
  minAge: z.number().int(),
});
export type RestrictedRule = z.infer<typeof restrictedRuleSchema>;

export const settingsSchemas = {
  /** Horarios por ámbito — separados como exige la operación. */
  "hours.store": weeklyScheduleSchema,
  "hours.delivery": weeklyScheduleSchema,
  "hours.pickup": weeklyScheduleSchema,

  /** Reglas por clase de producto restringido (licor, cigarrillos, ...). */
  "restricted.rules": z.record(z.string(), restrictedRuleSchema),

  /** Tolerancia de diferencia de peso antes de pedir aprobación (bps sobre el estimado). */
  "orders.weightTolerancePctBps": z.number().int().min(0),

  /** Umbral de envío gratis por defecto (COP). null = sin envío gratis global. */
  "delivery.freeFromCop": z.number().int().nullable(),

  /** Puntos otorgados por cada 1.000 COP netos de mercancía. */
  "loyalty.pointsPer1000Cop": z.number().int().min(0),

  /** Conceptos que forman la base de la comisión de agencia. */
  "commission.base": z.object({
    ratePctBps: z.number().int().min(0),
    includeDelivery: z.boolean(),
    includeTip: z.boolean(),
    includeTax: z.boolean(),
    deductGatewayFees: z.boolean(),
    deductMarketplaceFees: z.boolean(),
    deductDiscounts: z.boolean(),
    deductRefunds: z.boolean(),
    /** Canales atribuibles al sistema digital. */
    channels: z.array(z.string()),
  }),

  /** Sinónimos de búsqueda aprobados por el negocio. */
  "search.synonyms": z.record(z.string(), z.array(z.string())),

  /** Unidad libra habilitada (decisión del negocio). */
  "catalog.enablePoundUnit": z.boolean(),

  /** Datos de contacto del negocio (pendientes de completar). */
  "business.contact": z.object({
    whatsapp: z.string(),
    phone: z.string(),
    address: z.string(),
  }),

  /** Coordenadas del local — centran los mapas de entrega y seguimiento. */
  "business.location": z.object({
    lat: z.number(),
    lng: z.number(),
    /** true mientras el propietario no confirme el punto exacto en el panel. */
    approximate: z.boolean(),
  }),

  /** Exigir cuenta (teléfono verificado) para comprar en línea. */
  "accounts.requireForCheckout": z.boolean(),

  /** Plan premium: precio y beneficios (aprobado por el propietario). */
  "premium.plan": z.object({
    priceCopMonthly: z.number().int().nonnegative(),
    freeDelivery: z.boolean(),
    loyaltyMultiplier: z.number().int().min(1),
  }),

  /**
   * Reglas del Fiado Digital (crédito sin intereses, solo miembros premium).
   * TODOS los montos en COP enteros; editable desde el panel, nunca en código.
   */
  "credit.rules": z.object({
    /** Cupo inicial al activar el crédito. */
    initialLimitCop: z.number().int().positive(),
    /** Cupo máximo alcanzable con buen comportamiento. */
    maxLimitCop: z.number().int().positive(),
    /** Hasta este monto la compra va en UNA sola cuota (a 15 días). */
    singleInstallmentMaxCop: z.number().int().positive(),
    /** Número máximo de cuotas por compra. */
    maxInstallments: z.number().int().min(1).max(12),
    /** Frecuencias de cuota que el cliente puede elegir. */
    allowedFrequencies: z.array(z.enum(["weekly", "biweekly"])),
    /** Tope TOTAL de cartera en la calle (protege la caja del negocio). */
    portfolioCapCop: z.number().int().positive(),
    /** Pedidos pagados mínimos para habilitar crédito por el canal en línea
     *  (el alta en tienda física con aval del personal no lo requiere).
     *  0 = un cliente primerizo puede pedir a crédito (riesgo aceptado por
     *  el propietario), siempre que cumpla las verificaciones de abajo. */
    minPaidOrdersOnline: z.number().int().min(0),
    /** Verificaciones exigidas para abrir crédito por el canal en línea.
     *  Con .default para que las filas guardadas antes de esta versión
     *  sigan validando (getSetting rellena los faltantes). */
    onlineRequirePhoneVerified: z.boolean().default(true),
    onlineRequireEmailVerified: z.boolean().default(true),
    onlineRequireIdentityVerified: z.boolean().default(true),
  }),

  /** % de comisión de agencia sobre la MENSUALIDAD premium (bps: 5000 = 50%). */
  "commission.subscriptionPctBps": z.number().int().min(0).max(10000),

  /**
   * Personalización del panel administrativo (Nivel 1): menú lateral
   * (orden, ocultos y renombrados por ruta) y color del panel. Editable desde
   * Configuración → Panel; se aplica en el layout del admin.
   */
  "admin.panel": z.object({
    /** Rutas (href) en el orden deseado; las no listadas van al final. */
    navOrder: z.array(z.string()).default([]),
    /** Rutas ocultas del menú. */
    navHidden: z.array(z.string()).default([]),
    /** Renombrados por ruta (href → etiqueta). */
    navLabels: z.record(z.string(), z.string()).default({}),
    /** Color de fondo de la barra lateral (hex). null = color de marca. */
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
    /**
     * Dashboard configurable por rol (Nivel 2): rol → llaves de tarjetas
     * visibles en orden. Sin entrada para un rol = todas por defecto.
     */
    dashboard: z.record(z.string(), z.array(z.string())).default({}),
    /**
     * Bloques personalizados del inicio del panel (Nivel 3): lista ordenada de
     * bloques de contenido que el dueño arma (título, texto, botón, imagen,
     * separador). Se muestran arriba en el Dashboard.
     */
    blocks: z
      .array(
        z.object({
          id: z.string(),
          type: z.enum(["heading", "text", "button", "image", "divider", "links"]),
          text: z.string().max(300).optional(),
          href: z.string().max(300).optional(),
          url: z.string().max(500).optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
          /** Accesos rápidos (bloque "links"): fila de enlaces. */
          items: z.array(z.object({ label: z.string().max(60), href: z.string().max(300) })).max(12).optional(),
        }),
      )
      .max(40)
      .default([]),
  }),

  /**
   * Marca de la instancia (plantilla replicable): nombre, textos y paleta.
   * Los colores sobreescriben las variables CSS del tema en runtime — un
   * cliente nuevo se re-marca cambiando ESTA llave, sin tocar código.
   */
  branding: z.object({
    name: z.string().min(1),
    tagline: z.string(),
    slogan: z.string(),
    seoDescription: z.string(),
    /** Tipo de negocio de la instancia (informativo + presets del seed). */
    businessType: z.string(),
    colors: z.object({
      brand: z.string(),
      brandDark: z.string(),
      brandSoft: z.string(),
      coral: z.string(),
      coralDark: z.string(),
      sun: z.string(),
      cream: z.string(),
      ink: z.string(),
      inkSoft: z.string(),
      liquor: z.string(),
      liquorSoft: z.string(),
    }),
  }),
} as const;

export type SettingKey = keyof typeof settingsSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingsSchemas)[K]>;

/**
 * Valores por defecto del negocio HOY (operación real declarada):
 * local 07:00–23:00, domicilios 08:00–20:00. La ampliación a 24h se hace
 * únicamente cambiando estos valores desde el panel — nunca en código.
 */
const allWeek = (window: string): WeeklySchedule => ({
  mon: [window], tue: [window], wed: [window], thu: [window],
  fri: [window], sat: [window], sun: [window],
});

export const settingsDefaults: { [K in SettingKey]: SettingValue<K> } = {
  "hours.store": allWeek("07:00-23:00"),
  "hours.delivery": allWeek("08:00-22:00"),
  "hours.pickup": allWeek("07:00-23:00"),
  "restricted.rules": {
    liquor: {
      label: "Licores y cervezas",
      // Venta dentro del horario de domicilios. La operación 24 h de licores
      // ("próximamente") se activará SOLO cambiando este horario desde el panel,
      // previa validación legal del negocio.
      schedule: allWeek("10:00-22:00"),
      requiresAgeDeclaration: true,
      requiresIdCheckOnDelivery: true,
      allowedFulfillments: ["delivery", "pickup"],
      excludedZoneIds: [],
      minAge: 18,
    },
    cigarettes: {
      label: "Cigarrillos",
      schedule: allWeek("08:00-20:00"),
      requiresAgeDeclaration: true,
      requiresIdCheckOnDelivery: true,
      allowedFulfillments: ["delivery", "pickup"],
      excludedZoneIds: [],
      minAge: 18,
    },
  },
  "orders.weightTolerancePctBps": 1500, // 15% de diferencia dispara aprobación
  "delivery.freeFromCop": 20000,
  "loyalty.pointsPer1000Cop": 1,
  "commission.base": {
    ratePctBps: 1000, // 10%
    includeDelivery: false,
    includeTip: false,
    includeTax: false,
    deductGatewayFees: true,
    deductMarketplaceFees: true,
    deductDiscounts: true,
    deductRefunds: true,
    channels: ["web_pwa", "whatsapp", "rappi", "didi", "social", "subscription"],
  },
  "search.synonyms": {
    gaseosa: ["refresco", "soda"],
    papa: ["papas", "patata"],
    detergente: ["jabon para ropa", "jabón para ropa"],
    // "pola" para cerveza queda PENDIENTE de aprobación del negocio.
  },
  "catalog.enablePoundUnit": true, // el negocio vende por libras (1 lb = 500 g)
  "business.contact": {
    // WhatsApp en formato internacional (para enlaces wa.me): 57 + número.
    whatsapp: "573115009070",
    phone: "3115009070",
    address: "Cra 79 #10D-60, Bogotá",
  },
  "business.location": {
    // Punto exacto confirmado por el propietario (2026-07) en Google Maps.
    lat: 4.645013,
    lng: -74.139715,
    approximate: false,
  },
  // Apagado hasta que exista canal real para los códigos (WhatsApp API/SMS);
  // se enciende desde el panel — la compra como invitado sigue funcionando.
  "accounts.requireForCheckout": false,
  "premium.plan": {
    priceCopMonthly: 9900, // aprobado 2026-07; puede variar desde el panel
    freeDelivery: true,
    loyaltyMultiplier: 2,
  },
  "credit.rules": {
    initialLimitCop: 60_000,
    maxLimitCop: 200_000,
    singleInstallmentMaxCop: 50_000,
    maxInstallments: 4,
    allowedFrequencies: ["weekly", "biweekly"],
    // Tope inicial conservador de cartera total; el propietario lo ajusta
    // según su caja real desde el panel.
    portfolioCapCop: 1_500_000,
    // 0 = primerizo permitido (riesgo aceptado por el propietario 2026-07);
    // la garantía es la verificación de teléfono, correo e identidad (18+).
    minPaidOrdersOnline: 0,
    onlineRequirePhoneVerified: true,
    onlineRequireEmailVerified: true,
    onlineRequireIdentityVerified: true,
  },
  "commission.subscriptionPctBps": 5000, // 50/50 en suscripciones (acordado)
  "admin.panel": { navOrder: [], navHidden: [], navLabels: {}, accent: null, dashboard: {}, blocks: [] },
  branding: {
    name: "Market Castilla",
    tagline: "Tu mercado de barrio",
    slogan: "Frutas frescas, abarrotes y todo lo que necesitas cerca de ti.",
    seoDescription:
      "Minimarket de barrio en Bogotá: frutas y verduras frescas, abarrotes, bebidas y más, con entrega a domicilio.",
    businessType: "minimarket",
    colors: {
      brand: "#16a765",
      brandDark: "#12613f",
      brandSoft: "#e8f6ee",
      coral: "#f05a3c",
      coralDark: "#d24127",
      sun: "#f5c542",
      cream: "#fffdf7",
      ink: "#17231d",
      inkSoft: "#4b5a52",
      liquor: "#8a5a18",
      liquorSoft: "#f7edd8",
    },
  },
};
