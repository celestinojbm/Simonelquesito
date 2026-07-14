import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { assertLocalDatabaseUrl } from "./assert-local-db";

const globalForDb = globalThis as unknown as { pool?: Pool };

/**
 * Construye la configuración de conexión.
 * En proveedores gestionados (Supabase, etc.) el certificado del pooler no está en
 * el almacén de CA de Node, así que se activa SSL sin verificación estricta de
 * la cadena (el tráfico sigue cifrado). Se quita `sslmode` de la cadena para que
 * el conector no imponga su propia verificación y gane esta configuración.
 */
function buildPoolConfig() {
  const raw = process.env.DATABASE_URL ?? "";
  const useSsl = /supabase\.|sslmode=|[?&]ssl=true/i.test(raw);
  let connectionString = raw.replace(/([?&])sslmode=[^&]*(&|$)/i, (_m, p1, p2) =>
    p2 === "&" ? p1 : "",
  );
  // Supabase + serverless: usar el pooler en MODO TRANSACCIÓN (puerto 6543).
  // En modo sesión (5432) cada cliente ocupa 1 de los 15 cupos y las instancias
  // congeladas de Vercel los agotan (EMAXCONNSESSION). El modo transacción
  // multiplexa miles de clientes sobre esos cupos. El search_path del esquema
  // aislado está fijado a nivel de ROL, así que funciona igual en ambos modos.
  // Escape: DB_FORCE_SESSION_POOLER=true restaura el puerto original.
  if (
    process.env.VERCEL &&
    process.env.DB_FORCE_SESSION_POOLER !== "true" &&
    connectionString.includes(".pooler.supabase.com:5432/")
  ) {
    connectionString = connectionString.replace(
      ".pooler.supabase.com:5432/",
      ".pooler.supabase.com:6543/",
    );
  }
  // En serverless (Vercel) cada instancia crea su propio pool y el pooler del
  // proveedor limita los clientes totales: pool pequeño y liberación rápida.
  // En local/CI se usa un pool más amplio para las pruebas.
  const isServerless = !!process.env.VERCEL;
  const max = Number(process.env.DB_POOL_MAX ?? (isServerless ? 2 : 10));
  return {
    connectionString,
    max,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  };
}

// Segunda barrera (defensa en profundidad): en NODE_ENV=test, cualquier suite
// que importe esta capa de BD debe apuntar a una base LOOPBACK explícita. Corre
// ANTES de crear el Pool; sin bypass. (La primera barrera es el setupFile de
// Vitest; las pruebas puras no importan este archivo y no se ven afectadas.)
if (process.env.NODE_ENV === "test") {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
}

const pool = globalForDb.pool ?? new Pool(buildPoolConfig());

// En despliegues sobre un esquema aislado (p. ej. Supabase compartido) se fija
// el search_path por conexión. En local queda sin definir y usa "public".
const searchPath = process.env.DB_SEARCH_PATH;
if (searchPath && !globalForDb.pool) {
  pool.on("connect", (client) => {
    client.query(`SET search_path TO ${searchPath}`).catch(() => {});
  });
}

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
export type Db = typeof db;
/** Transacción tipada — los módulos de dominio aceptan db o tx. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
