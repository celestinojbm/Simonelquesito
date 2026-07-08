/**
 * Presets por TIPO DE NEGOCIO — plantilla replicable.
 *
 * Un cliente nuevo se aprovisiona eligiendo un preset (BUSINESS_PRESET al
 * correr el seed): categorías, reglas de productos restringidos y unidades.
 * El motor es el mismo para todos; solo cambian los datos. Los presets NO
 * traen productos demo (cada negocio importa su catálogo real por CSV o con
 * el asistente de foto/voz); "minimarket" es la excepción histórica.
 */

import type { SettingValue } from "@/modules/config/keys";

export type CategoryPreset = {
  id: string;
  slug: string;
  name: string;
  icon: string;
  prepArea: string;
  sort: number;
  restricted?: boolean;
  restrictedRuleKey?: string;
};

export type BusinessPreset = {
  label: string;
  categories: CategoryPreset[];
  restrictedRules: SettingValue<"restricted.rules">;
  enablePoundUnit: boolean;
  brandingDefaults: Partial<SettingValue<"branding">> & { businessType: string };
};

const allWeek = (window: string) => ({
  mon: [window], tue: [window], wed: [window], thu: [window],
  fri: [window], sat: [window], sun: [window],
});

type RestrictedRule = SettingValue<"restricted.rules">[string];

const LIQUOR_RULE: RestrictedRule = {
  label: "Licores y cervezas",
  schedule: allWeek("10:00-22:00"),
  requiresAgeDeclaration: true,
  requiresIdCheckOnDelivery: true,
  allowedFulfillments: ["delivery", "pickup"],
  excludedZoneIds: [],
  minAge: 18,
};

const CIGARETTES_RULE: RestrictedRule = {
  label: "Cigarrillos",
  schedule: allWeek("08:00-20:00"),
  requiresAgeDeclaration: true,
  requiresIdCheckOnDelivery: true,
  allowedFulfillments: ["delivery", "pickup"],
  excludedZoneIds: [],
  minAge: 18,
};

export const BUSINESS_PRESETS: Record<string, BusinessPreset> = {
  /** Minimarket de barrio (preset original de Market Castilla). */
  minimarket: {
    label: "Minimarket de barrio",
    categories: [
      { id: "cat_frutas", slug: "frutas-verduras", name: "Frutas y verduras", icon: "🥑", prepArea: "produce", sort: 1 },
      { id: "cat_abarrotes", slug: "abarrotes", name: "Abarrotes", icon: "🌾", prepArea: "grocery", sort: 2 },
      { id: "cat_panaderia", slug: "panaderia", name: "Panadería", icon: "🥖", prepArea: "grocery", sort: 3 },
      { id: "cat_refrigerados", slug: "refrigerados", name: "Refrigerados", icon: "🧀", prepArea: "refrigerated", sort: 4 },
      { id: "cat_bebidas", slug: "bebidas", name: "Bebidas y gaseosas", icon: "🥤", prepArea: "beverages", sort: 5 },
      { id: "cat_snacks", slug: "snacks", name: "Snacks", icon: "🍿", prepArea: "grocery", sort: 6 },
      { id: "cat_cervezas", slug: "cervezas", name: "Cervezas", icon: "🍺", prepArea: "liquor", sort: 7, restricted: true, restrictedRuleKey: "liquor" },
      { id: "cat_licores", slug: "licores", name: "Licores", icon: "🥃", prepArea: "liquor", sort: 8, restricted: true, restrictedRuleKey: "liquor" },
      { id: "cat_cigarrillos", slug: "cigarrillos", name: "Cigarrillos", icon: "🚬", prepArea: "other", sort: 9, restricted: true, restrictedRuleKey: "cigarettes" },
      { id: "cat_aseo", slug: "aseo", name: "Aseo del hogar", icon: "🧼", prepArea: "cleaning", sort: 10 },
      { id: "cat_mascotas", slug: "mascotas", name: "Mascotas", icon: "🐾", prepArea: "grocery", sort: 11 },
    ],
    restrictedRules: { liquor: LIQUOR_RULE, cigarettes: CIGARETTES_RULE },
    enablePoundUnit: true,
    brandingDefaults: { businessType: "minimarket" },
  },

  /** Fruver / plaza: todo gira alrededor del peso. */
  fruver: {
    label: "Fruver (frutas y verduras)",
    categories: [
      { id: "cat_frutas", slug: "frutas", name: "Frutas", icon: "🍎", prepArea: "produce", sort: 1 },
      { id: "cat_verduras", slug: "verduras", name: "Verduras", icon: "🥬", prepArea: "produce", sort: 2 },
      { id: "cat_tuberculos", slug: "tuberculos", name: "Tubérculos", icon: "🥔", prepArea: "produce", sort: 3 },
      { id: "cat_hierbas", slug: "hierbas", name: "Hierbas y aromáticas", icon: "🌿", prepArea: "produce", sort: 4 },
      { id: "cat_huevos", slug: "huevos-lacteos", name: "Huevos y lácteos", icon: "🥚", prepArea: "refrigerated", sort: 5 },
      { id: "cat_granos", slug: "granos", name: "Granos y abarrotes", icon: "🌾", prepArea: "grocery", sort: 6 },
    ],
    restrictedRules: {},
    enablePoundUnit: true,
    brandingDefaults: { businessType: "fruver", tagline: "Frutas y verduras frescas" },
  },

  /** Farmacia / droguería: restringidos = medicamentos con fórmula. */
  farmacia: {
    label: "Farmacia / droguería",
    categories: [
      { id: "cat_venta_libre", slug: "venta-libre", name: "Venta libre", icon: "💊", prepArea: "grocery", sort: 1 },
      { id: "cat_formulados", slug: "formulados", name: "Con fórmula médica", icon: "📋", prepArea: "other", sort: 2, restricted: true, restrictedRuleKey: "prescription" },
      { id: "cat_cuidado", slug: "cuidado-personal", name: "Cuidado personal", icon: "🧴", prepArea: "grocery", sort: 3 },
      { id: "cat_bebes", slug: "bebes", name: "Bebés", icon: "🍼", prepArea: "grocery", sort: 4 },
      { id: "cat_vitaminas", slug: "vitaminas", name: "Vitaminas y suplementos", icon: "🍊", prepArea: "grocery", sort: 5 },
      { id: "cat_botiquin", slug: "botiquin", name: "Botiquín y primeros auxilios", icon: "🩹", prepArea: "grocery", sort: 6 },
    ],
    restrictedRules: {
      // El motor genérico exige verificación en la entrega: aquí la
      // "verificación" es la FÓRMULA MÉDICA (no la edad). La validez legal
      // de la venta la respalda el regente de farmacia del negocio.
      prescription: {
        label: "Medicamentos con fórmula médica",
        schedule: allWeek("00:00-24:00"),
        requiresAgeDeclaration: false,
        requiresIdCheckOnDelivery: true,
        allowedFulfillments: ["delivery", "pickup"],
        excludedZoneIds: [],
        minAge: 0,
      },
    },
    enablePoundUnit: false,
    brandingDefaults: { businessType: "farmacia", tagline: "Tu droguería de confianza" },
  },

  /** Ferretería de barrio. */
  ferreteria: {
    label: "Ferretería",
    categories: [
      { id: "cat_herramientas", slug: "herramientas", name: "Herramientas", icon: "🔨", prepArea: "grocery", sort: 1 },
      { id: "cat_electricos", slug: "electricos", name: "Eléctricos", icon: "💡", prepArea: "grocery", sort: 2 },
      { id: "cat_plomeria", slug: "plomeria", name: "Plomería", icon: "🚿", prepArea: "grocery", sort: 3 },
      { id: "cat_pinturas", slug: "pinturas", name: "Pinturas", icon: "🎨", prepArea: "grocery", sort: 4 },
      { id: "cat_tornilleria", slug: "tornilleria", name: "Tornillería y fijación", icon: "🔩", prepArea: "grocery", sort: 5 },
      { id: "cat_construccion", slug: "construccion", name: "Construcción", icon: "🧱", prepArea: "other", sort: 6 },
    ],
    restrictedRules: {},
    enablePoundUnit: false,
    brandingDefaults: { businessType: "ferretería", tagline: "Todo para tu obra" },
  },

  /** Licorera (todo el catálogo es restringido +18). */
  licoreria: {
    label: "Licorera",
    categories: [
      { id: "cat_cervezas", slug: "cervezas", name: "Cervezas", icon: "🍺", prepArea: "liquor", sort: 1, restricted: true, restrictedRuleKey: "liquor" },
      { id: "cat_aguardiente", slug: "aguardiente-ron", name: "Aguardiente y ron", icon: "🥃", prepArea: "liquor", sort: 2, restricted: true, restrictedRuleKey: "liquor" },
      { id: "cat_vinos", slug: "vinos", name: "Vinos y espumosos", icon: "🍷", prepArea: "liquor", sort: 3, restricted: true, restrictedRuleKey: "liquor" },
      { id: "cat_whisky", slug: "whisky-importados", name: "Whisky e importados", icon: "🥂", prepArea: "liquor", sort: 4, restricted: true, restrictedRuleKey: "liquor" },
      { id: "cat_mecato", slug: "mecato", name: "Mecato y acompañantes", icon: "🥜", prepArea: "grocery", sort: 5 },
      { id: "cat_cigarrillos", slug: "cigarrillos", name: "Cigarrillos", icon: "🚬", prepArea: "other", sort: 6, restricted: true, restrictedRuleKey: "cigarettes" },
    ],
    restrictedRules: { liquor: LIQUOR_RULE, cigarettes: CIGARETTES_RULE },
    enablePoundUnit: false,
    brandingDefaults: { businessType: "licorera", tagline: "Tus licores a domicilio" },
  },

  /**
   * Salsamentaria: embutidos, carnes frías y quesos con cola de minimarket.
   * Todo el núcleo se vende por peso (libra/kg) y es perecedero — depende del
   * seguimiento de lotes/vencimiento (FEFO) de `inventory_lots`.
   */
  salsamentaria: {
    label: "Salsamentaria",
    categories: [
      { id: "cat_embutidos", slug: "embutidos-carnes-frias", name: "Embutidos y carnes frías", icon: "🌭", prepArea: "refrigerated", sort: 1 },
      { id: "cat_quesos", slug: "quesos", name: "Quesos", icon: "🧀", prepArea: "refrigerated", sort: 2 },
      { id: "cat_charcuteria", slug: "charcuteria-encurtidos", name: "Charcutería y encurtidos", icon: "🫒", prepArea: "refrigerated", sort: 3 },
      { id: "cat_lacteos", slug: "lacteos-huevos", name: "Lácteos y huevos", icon: "🥚", prepArea: "refrigerated", sort: 4 },
      { id: "cat_congelados", slug: "congelados", name: "Congelados", icon: "🧊", prepArea: "refrigerated", sort: 5 },
      { id: "cat_panaderia", slug: "panaderia", name: "Panadería", icon: "🥖", prepArea: "grocery", sort: 6 },
      { id: "cat_abarrotes", slug: "abarrotes", name: "Abarrotes", icon: "🌾", prepArea: "grocery", sort: 7 },
      { id: "cat_bebidas", slug: "bebidas", name: "Bebidas", icon: "🥤", prepArea: "beverages", sort: 8 },
      { id: "cat_aseo", slug: "aseo", name: "Aseo del hogar", icon: "🧼", prepArea: "cleaning", sort: 9 },
    ],
    restrictedRules: {},
    enablePoundUnit: true,
    brandingDefaults: { businessType: "salsamentaria", tagline: "Embutidos, quesos y carnes frías de calidad" },
  },
};

export function getPreset(name: string | undefined): { key: string; preset: BusinessPreset } {
  const key = name && name in BUSINESS_PRESETS ? name : "minimarket";
  return { key, preset: BUSINESS_PRESETS[key]! };
}
