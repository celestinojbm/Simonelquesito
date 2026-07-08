import type { RestrictedRule } from "@/modules/config/keys";
import { isScheduleOpen } from "@/modules/config/schedule";

/**
 * Motor de productos restringidos. Evalúa reglas CONFIGURABLES (tabla settings,
 * clave "restricted.rules") — nunca hardcodeadas. Ninguna verificación técnica
 * de este módulo sustituye una validación legal; ver docs/SECURITY.md.
 */

export type RestrictedCheckInput = {
  ruleKeys: string[]; // claves de regla presentes en el carrito (ej. ["liquor"])
  rules: Record<string, RestrictedRule>;
  at: Date;
  fulfillment: "delivery" | "pickup";
  zoneId?: string | null;
  declaredBirthDate?: string | null; // YYYY-MM-DD
  termsAccepted?: boolean;
  timeZone?: string;
};

export type RestrictedCheckResult = {
  allowed: boolean;
  requiresIdCheckOnDelivery: boolean;
  violations: string[];
};

export function ageFromBirthDate(birthDate: string, at: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return null;
  const [, y, mo, d] = m;
  const birth = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(birth.getTime())) return null;
  let age = at.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    at.getMonth() < birth.getMonth() ||
    (at.getMonth() === birth.getMonth() && at.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function checkRestricted(input: RestrictedCheckInput): RestrictedCheckResult {
  const violations: string[] = [];
  let requiresIdCheck = false;

  for (const key of input.ruleKeys) {
    const rule = input.rules[key];
    if (!rule) {
      violations.push(`No existe regla configurada para "${key}"; venta bloqueada por precaución.`);
      continue;
    }

    if (!isScheduleOpen(rule.schedule, input.at, input.timeZone)) {
      violations.push(`${rule.label}: fuera del horario permitido de venta.`);
    }

    if (!rule.allowedFulfillments.includes(input.fulfillment)) {
      violations.push(`${rule.label}: no disponible para esta modalidad de entrega.`);
    }

    if (input.zoneId && rule.excludedZoneIds.includes(input.zoneId)) {
      violations.push(`${rule.label}: no disponible en tu zona.`);
    }

    if (rule.requiresAgeDeclaration) {
      if (!input.termsAccepted) {
        violations.push(`${rule.label}: debes aceptar las condiciones de venta a mayores de edad.`);
      }
      if (!input.declaredBirthDate) {
        violations.push(`${rule.label}: debes indicar tu fecha de nacimiento.`);
      } else {
        const age = ageFromBirthDate(input.declaredBirthDate, input.at);
        if (age === null) {
          violations.push(`${rule.label}: fecha de nacimiento inválida.`);
        } else if (age < rule.minAge) {
          violations.push(`${rule.label}: venta permitida solo a mayores de ${rule.minAge} años.`);
        }
      }
    }

    if (rule.requiresIdCheckOnDelivery) requiresIdCheck = true;
  }

  return {
    allowed: violations.length === 0,
    requiresIdCheckOnDelivery: requiresIdCheck,
    violations,
  };
}
