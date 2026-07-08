import { randomUUID, randomBytes } from "node:crypto";

/** Id con prefijo legible: ord_a1b2..., pay_..., etc. */
export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Código numérico corto (prueba de entrega, confirmaciones). */
export function shortCode(digits = 4): string {
  const max = 10 ** digits;
  const n = randomBytes(4).readUInt32BE(0) % max;
  return n.toString().padStart(digits, "0");
}
