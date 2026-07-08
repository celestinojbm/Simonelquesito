/**
 * Rate limiter en memoria (ventana deslizante simple) para el demo.
 * En producción: Redis/Upstash u otro almacén compartido entre instancias.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= maxAttempts) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}
