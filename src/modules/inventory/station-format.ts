/**
 * Helpers PUROS de presentación/lógica de la estación (client-safe, sin BD ni
 * crypto): sanitización de la etiqueta del operador para el historial y clave de
 * confirmación de salidas sensibles. Se usan en la UI y en el servicio de
 * consulta, y se prueban de forma aislada.
 */

const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: "Propietario",
  admin: "Administrador",
  cashier: "Cajero",
  accountant: "Contador",
  picker: "Personal",
  driver: "Personal",
  tech_admin: "Personal",
  customer: "Cliente",
  system: "Sistema",
};

/**
 * Convierte un `actorLabel` interno (p. ej. "owner:persona@example.invalid") en
 * una etiqueta SANITIZADA para mostrar (rol, nunca el correo). Nunca devuelve un
 * correo ni el actor crudo.
 */
export function sanitizeActorLabel(actorLabel: string | null | undefined): string {
  if (!actorLabel) return "Sistema";
  const role = actorLabel.split(":")[0]?.trim().toLowerCase() ?? "";
  return ROLE_LABELS[role] ?? "Personal";
}

/**
 * Clave determinista de una confirmación de movimiento: si cualquiera de estos
 * campos cambia, una confirmación previa deja de ser válida.
 */
export function movementConfirmKey(fields: {
  variantId: string;
  direction: string;
  quantityMinor: number | null;
  reasonCode: string;
  source: string;
}): string {
  return [fields.variantId, fields.direction, fields.quantityMinor ?? "", fields.reasonCode, fields.source].join("|");
}
