/**
 * Guardia de SCHEMA del bootstrap del propietario (P0).
 *
 * `owner:create` ya NO confía en el listener global del Pool ni en el search_path
 * del rol/entorno: fija el schema de destino con `SET LOCAL` (set_config con
 * is_local=true, parametrizado) DENTRO de la transacción y verifica, en esa misma
 * transacción, que `current_schema()` coincide y que existen `users` y
 * `audit_events`. Si algo no cuadra, aborta ANTES de cualquier escritura.
 *
 * Estas pruebas usan PostgreSQL LOCAL efímero (NUNCA producción, NUNCA Supabase):
 * crean schemas de prueba copiando la estructura real de `users`/`audit_events`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { bootstrapOwner, resolveOwnerSchema } from "@/db/create-owner";

const PW = "Zt7#qwerbnmk"; // fixture sintética (no es una contraseña real)
const D = "schematest.co"; // dominio real (no demo)

const OK = "bt_ok"; // users + audit_events
const NO_AUDIT = "bt_no_audit"; // solo users
const EMPTY = "bt_empty"; // schema sin tablas
const MISSING = "bt_missing_schema"; // nunca se crea

let SRC = "public"; // schema por defecto del entorno de pruebas

async function scalarRaw(text: string): Promise<number | string | null> {
  const r = await db.execute(sql.raw(text));
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return (row ? Object.values(row)[0] : null) as number | string | null;
}

async function cleanup(): Promise<void> {
  await db.execute(sql.raw(`delete from ${OK}.audit_events`));
  await db.execute(sql.raw(`delete from ${OK}.users`));
  await db.execute(sql.raw(`delete from ${NO_AUDIT}.users`));
  // En el schema por defecto (público): borra cualquier residuo por dominio.
  await db.execute(sql.raw(`delete from ${SRC}.audit_events where actor_label = 'system:owner-bootstrap' and (after->>'email') like '%@${D}'`));
  await db.execute(sql.raw(`delete from ${SRC}.users where email like '%@${D}'`));
}

beforeAll(async () => {
  const r = await db.execute(sql`select current_schema() as cs`);
  SRC = String((r.rows[0] as { cs: string }).cs);
  await db.execute(sql.raw(`drop schema if exists ${OK}, ${NO_AUDIT}, ${EMPTY}, ${MISSING} cascade`));
  // OK: copia estructural real de ambas tablas.
  await db.execute(sql.raw(`create schema ${OK}`));
  await db.execute(sql.raw(`create table ${OK}.users (like ${SRC}.users including all)`));
  await db.execute(sql.raw(`create table ${OK}.audit_events (like ${SRC}.audit_events including all)`));
  // NO_AUDIT: solo users (falta audit_events a propósito).
  await db.execute(sql.raw(`create schema ${NO_AUDIT}`));
  await db.execute(sql.raw(`create table ${NO_AUDIT}.users (like ${SRC}.users including all)`));
  // EMPTY: schema existente sin tablas.
  await db.execute(sql.raw(`create schema ${EMPTY}`));
  // MISSING: intencionalmente NO se crea.
});

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists ${OK}, ${NO_AUDIT}, ${EMPTY}, ${MISSING} cascade`));
});

describe("resolveOwnerSchema — validación pura (no toca la BD)", () => {
  it("1) DB_SEARCH_PATH ausente → aborta", () => {
    expect(() => resolveOwnerSchema({})).toThrow(/DB_SEARCH_PATH/);
  });
  it("2) vacío o solo espacios → aborta", () => {
    expect(() => resolveOwnerSchema({ DB_SEARCH_PATH: "" })).toThrow();
    expect(() => resolveOwnerSchema({ DB_SEARCH_PATH: "   " })).toThrow();
  });
  it("3) lista 'public,salsamentaria' → aborta", () => {
    expect(() => resolveOwnerSchema({ DB_SEARCH_PATH: "public,salsamentaria" })).toThrow(/inválido/i);
  });
  it("4) inyección / caracteres prohibidos → aborta", () => {
    expect(() => resolveOwnerSchema({ DB_SEARCH_PATH: "salsamentaria;DROP TABLE users" })).toThrow();
    expect(() => resolveOwnerSchema({ DB_SEARCH_PATH: 'sal"; drop' })).toThrow();
    expect(() => resolveOwnerSchema({ DB_SEARCH_PATH: "with.dot" })).toThrow();
    expect(() => resolveOwnerSchema({ DB_SEARCH_PATH: "has space" })).toThrow();
    expect(() => resolveOwnerSchema({ DB_SEARCH_PATH: "MixedCase" })).toThrow();
  });
  it("válido → aplica trim y devuelve un único identificador", () => {
    expect(resolveOwnerSchema({ DB_SEARCH_PATH: "salsamentaria" })).toBe("salsamentaria");
    expect(resolveOwnerSchema({ DB_SEARCH_PATH: "  salsamentaria  " })).toBe("salsamentaria");
    // `public` explícito SÍ es válido (lo prohibido es el *fallback* a public):
    expect(resolveOwnerSchema({ DB_SEARCH_PATH: "public" })).toBe("public");
  });
  it("no hay fallback a public cuando falta la variable", () => {
    // Sin la variable NO devuelve 'public' silenciosamente: lanza.
    expect(() => resolveOwnerSchema({ DB_SEARCH_PATH: undefined })).toThrow();
  });
});

describe("bootstrapOwner — fija y verifica el schema dentro de la transacción", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("5) schema inexistente → aborta sin escribir en ningún schema", async () => {
    const email = `no-schema@${D}`;
    await expect(bootstrapOwner({ email, fullName: "X", password: PW }, MISSING)).rejects.toThrow();
    expect(await scalarRaw(`select count(*)::int from ${SRC}.users where email = '${email}'`)).toBe(0);
    expect(await scalarRaw(`select count(*)::int from ${OK}.users where email = '${email}'`)).toBe(0);
  });

  it("6) schema existente SIN users → aborta sin escribir", async () => {
    const email = `empty-schema@${D}`;
    await expect(bootstrapOwner({ email, fullName: "X", password: PW }, EMPTY)).rejects.toThrow();
    expect(await scalarRaw(`select count(*)::int from ${SRC}.users where email = '${email}'`)).toBe(0);
  });

  it("7) schema con users pero SIN audit_events → aborta sin escribir el usuario", async () => {
    const email = `no-audit@${D}`;
    await expect(bootstrapOwner({ email, fullName: "X", password: PW }, NO_AUDIT)).rejects.toThrow();
    expect(await scalarRaw(`select count(*)::int from ${NO_AUDIT}.users where email = '${email}'`)).toBe(0);
  });

  it("12) si la verificación del schema falla, no hay NINGÚN cambio", async () => {
    const before = await scalarRaw(`select count(*)::int from ${NO_AUDIT}.users`);
    await expect(bootstrapOwner({ email: `x2@${D}`, fullName: "X", password: PW }, NO_AUDIT)).rejects.toThrow();
    const after = await scalarRaw(`select count(*)::int from ${NO_AUDIT}.users`);
    expect(after).toBe(before);
  });

  it("8-9-10-11) schema correcto: crea el owner y su auditoría en ESE schema; nada en public", async () => {
    const email = `ok-owner@${D}`;
    const r = await bootstrapOwner({ email, fullName: "Dueño OK", password: PW }, OK);
    expect(r).toEqual({ status: "created", email });
    // (9) usuario creado en el schema solicitado, como owner activo:
    expect(await scalarRaw(`select count(*)::int from ${OK}.users where email = '${email}' and role = 'owner' and is_active`)).toBe(1);
    // (10) evento de auditoría en el MISMO schema:
    expect(await scalarRaw(`select count(*)::int from ${OK}.audit_events where action = 'owner.bootstrap_created' and (after->>'email') = '${email}'`)).toBe(1);
    // (11) NADA en public:
    expect(await scalarRaw(`select count(*)::int from ${SRC}.users where email = '${email}'`)).toBe(0);
    expect(await scalarRaw(`select count(*)::int from ${SRC}.audit_events where (after->>'email') = '${email}'`)).toBe(0);
  });

  it("13) una conexión con search_path inicial 'public' funciona tras fijar el schema local", async () => {
    expect(String(await scalarRaw(`select current_schema()`))).toBe(SRC); // arranca en el schema por defecto
    const email = `after-public@${D}`;
    const r = await bootstrapOwner({ email, fullName: "Tras Public", password: PW }, OK);
    expect(r.status).toBe("created");
    expect(await scalarRaw(`select count(*)::int from ${OK}.users where email = '${email}'`)).toBe(1);
  });

  it("14) el search_path local NO persiste fuera de la transacción", async () => {
    await bootstrapOwner({ email: `local-only@${D}`, fullName: "Local", password: PW }, OK);
    // Tras la transacción del bootstrap, el search_path vuelve al de por defecto.
    expect(String(await scalarRaw(`select current_schema()`))).toBe(SRC);
  });

  it("15) los errores no incluyen DATABASE_URL, usuario, contraseña ni secretos", async () => {
    let msg = "";
    try {
      await bootstrapOwner({ email: `err@${D}`, fullName: "X", password: PW }, EMPTY);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toBe("");
    expect(msg.toLowerCase()).not.toContain("password");
    expect(msg).not.toContain(PW);
    expect(msg).not.toMatch(/postgres(ql)?:\/\//i); // no filtra cadena de conexión
    expect(msg).not.toContain(process.env.DATABASE_URL ?? "___sin_url___");
  });
});
