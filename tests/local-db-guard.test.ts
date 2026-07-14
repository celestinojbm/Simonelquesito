/**
 * Guardia de base LOCAL (P0 seguridad de datos). Pruebas puras (no importan el
 * pool `db`) más una prueba que demuestra que el seed aborta ANTES de conectar
 * cuando el destino es remoto. Ninguna contraseña real.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { assertLocalDatabaseUrl, assertTestDatabaseIsLocal } from "@/db/assert-local-db";

afterEach(() => vi.unstubAllEnvs());

const ok = (u: string) => expect(() => assertLocalDatabaseUrl(u)).not.toThrow();
const bad = (u: string | undefined) => expect(() => assertLocalDatabaseUrl(u)).toThrow();

describe("assertLocalDatabaseUrl — hosts permitidos", () => {
  it("localhost", () => ok("postgres://u:p@localhost:5432/db"));
  it("127.0.0.1", () => ok("postgres://u:p@127.0.0.1:5432/db"));
  it("[::1]", () => ok("postgres://u:p@[::1]:5432/db"));
  it("puerto local no estándar", () => ok("postgres://u:p@127.0.0.1:5433/salsamentaria"));
});

describe("assertLocalDatabaseUrl — rechazos", () => {
  it("URL ausente (undefined)", () => bad(undefined));
  it("URL vacía", () => bad(""));
  it("URL mal formada", () => bad("no-es-una-url"));
  it("host Supabase", () => bad("postgres://u:p@db.abcdefgh.supabase.co:5432/postgres"));
  it("pooler Supabase", () => bad("postgres://postgres.ref:p@aws-1-us-east-1.pooler.supabase.com:6543/postgres"));
  it("host remoto genérico", () => bad("postgres://u:p@db.example.com:5432/x"));
  it("localhost.atacante.com", () => bad("postgres://u:p@localhost.atacante.com:5432/x"));
  it("127.0.0.1.atacante.com", () => bad("postgres://u:p@127.0.0.1.atacante.com:5432/x"));
});

describe("assertLocalDatabaseUrl — DETERMINISTA (no depende del entorno global)", () => {
  it("undefined rechaza SIEMPRE, aunque process.env.DATABASE_URL sea local", () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@127.0.0.1:5432/x");
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(); // no lee el env
  });
  it("una URL local explícita funciona, aunque process.env.DATABASE_URL sea remoto", () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.evil.supabase.co:5432/x");
    expect(() => assertLocalDatabaseUrl("postgres://u:p@localhost:5432/db")).not.toThrow();
  });
});

describe("assertLocalDatabaseUrl — protocolo PostgreSQL", () => {
  it("postgres:// permitido", () => ok("postgres://u:p@localhost:5432/db"));
  it("postgresql:// permitido", () => ok("postgresql://u:p@127.0.0.1:5432/db"));
  it("https:// rechazado", () => bad("https://localhost:5432/db"));
  it("file:// rechazado", () => bad("file://localhost/db"));
  it("protocolo desconocido rechazado", () => bad("mysql://u:p@localhost:5432/db"));
  it("el error de protocolo no filtra credenciales", () => {
    expect.assertions(2);
    try {
      assertLocalDatabaseUrl("https://admin:SUPERSECRETO@localhost:5432/db");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("SUPERSECRETO");
      expect(msg).not.toContain("admin");
    }
  });
});

describe("assertLocalDatabaseUrl — el error no filtra credenciales ni host completo", () => {
  it("oculta usuario/contraseña/subdominio y solo muestra host sanitizado", () => {
    expect.assertions(4);
    try {
      assertLocalDatabaseUrl("postgres://admin:SUPERSECRETO@aws-1-us-east-1.pooler.supabase.com:6543/postgres");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("SUPERSECRETO");
      expect(msg).not.toContain("admin");
      expect(msg).not.toContain("aws-1-us-east-1"); // subdominio enmascarado
      expect(msg).toContain("***.supabase.com");
    }
  });
});

describe("assertTestDatabaseIsLocal — independiente de NODE_ENV/DEMO_MODE", () => {
  const remote = "postgres://u:p@db.abcdefgh.supabase.co:5432/postgres";
  it("DEMO_MODE=true NO permite una base remota", () => {
    expect(() => assertTestDatabaseIsLocal({ DEMO_MODE: "true", DATABASE_URL: remote })).toThrow();
  });
  it("NODE_ENV=test NO permite una base remota", () => {
    expect(() => assertTestDatabaseIsLocal({ NODE_ENV: "test", DATABASE_URL: remote })).toThrow();
  });
  it("NODE_ENV=development NO permite una base remota", () => {
    expect(() => assertTestDatabaseIsLocal({ NODE_ENV: "development", DATABASE_URL: remote })).toThrow();
  });
  it("permite ausencia de DATABASE_URL (pruebas puras)", () => {
    expect(() => assertTestDatabaseIsLocal({})).not.toThrow();
  });
  it("permite loopback", () => {
    expect(() => assertTestDatabaseIsLocal({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/x" })).not.toThrow();
  });
});

const IMPORT_DB_SNIPPET =
  "import('@/db').then(()=>{console.log('INIT_REACHED');process.exit(0)}).catch(e=>{console.error('GUARD_ERR:'+(e&&e.message));process.exit(1)})";
function importDbLayer(env: Record<string, string | undefined>): { status: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", "-e", IMPORT_DB_SNIPPET], {
      env: env as NodeJS.ProcessEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

describe("src/db/index.ts — segunda barrera (subproceso, NODE_ENV=test)", () => {
  it("1) URL remota falla ANTES de crear conexión, sin filtrar la clave", () => {
    const r = importDbLayer({ ...process.env, NODE_ENV: "test", DATABASE_URL: "postgres://seooby:secretpw@db.abcdefgh.supabase.co:5432/x" });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/loopback/i);
    expect(r.out).not.toContain("secretpw"); // no filtra la contraseña
    expect(r.out).not.toMatch(/ECONNREFUSED|ENOTFOUND|getaddrinfo/); // no intentó conectar
  });
  it("2) sin DATABASE_URL falla", () => {
    const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test" };
    delete env.DATABASE_URL;
    const r = importDbLayer(env);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no está definida|loopback/i);
  });
  it("3) protocolo no PostgreSQL falla", () => {
    const r = importDbLayer({ ...process.env, NODE_ENV: "test", DATABASE_URL: "https://localhost:5432/x" });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/protocolo/i);
  });
  it("4) URL loopback válida alcanza la inicialización", () => {
    const r = importDbLayer({ ...process.env, NODE_ENV: "test", DATABASE_URL: "postgres://u:p@127.0.0.1:5432/x" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("INIT_REACHED");
  });
});

describe("seed con DATABASE_URL remota aborta antes de conectar", () => {
  it("db:seed remoto sale != 0 por la guardia, sin conectar y sin filtrar la clave", () => {
    let status = 0;
    let out = "";
    try {
      execFileSync("npx", ["tsx", "src/db/seed.ts"], {
        env: {
          ...process.env,
          DEMO_MODE: "true",
          DATABASE_URL: "postgres://seooby:secretpw@db.abcdefgh.supabase.co:5432/postgres",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? 1;
      out = (err.stdout ?? "") + (err.stderr ?? "");
    }
    expect(status).not.toBe(0);
    expect(out).toMatch(/loopback/i); // abortó por la guardia
    expect(out).not.toContain("secretpw"); // no filtró la contraseña
    expect(out).not.toMatch(/ECONNREFUSED|ENOTFOUND|getaddrinfo/); // no intentó conectar
  });
});
