import type { SettingValue } from "@/modules/config/keys";

/**
 * Bloques personalizados del inicio del panel (Nivel 3). El dueño los arma en
 * Configuración → Panel y se muestran arriba en el Dashboard. Tipos simples de
 * contenido (sin datos en vivo) para un diseñador seguro y sin dependencias.
 */

export type PanelBlock = SettingValue<"admin.panel">["blocks"][number];
export type BlockType = PanelBlock["type"];

export const BLOCK_TYPES: ReadonlyArray<{ type: BlockType; label: string; icon: string }> = [
  { type: "heading", label: "Título", icon: "🏷️" },
  { type: "text", label: "Texto", icon: "📝" },
  { type: "button", label: "Botón / enlace", icon: "🔘" },
  { type: "links", label: "Accesos rápidos", icon: "⚡" },
  { type: "image", label: "Imagen", icon: "🖼️" },
  { type: "divider", label: "Separador", icon: "➖" },
];

export function blockLabel(type: BlockType): string {
  return BLOCK_TYPES.find((b) => b.type === type)?.label ?? type;
}
