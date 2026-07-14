/**
 * Cierre del agujero de sesiones ya emitidas (P0). Usa la BD de desarrollo/CI.
 * Demuestra que una cookie de sesión VÁLIDA (no vencida, no revocada, usuario
 * activo) de una cuenta demo:
 *   - se acepta SOLO en un entorno demo explícitamente autorizado,
 *   - se RECHAZA en producción,
 * mientras que la sesión de un propietario real sigue funcionando en producción.
 *
 * Valida la capa CENTRAL `resolveSession` (la que usan páginas y server actions
 * vía getSessionUser), no el middleware visual.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { id } from "@/lib/ids";
import { resolveSession } from "@/lib/auth/session";

const DEMO_EMAIL = "p0-session-demo@marketcastilla.demo";
const REAL_EMAIL = "p0-session-real@salsatest.co";
const future = () => new Date(Date.now() + 3600_000);

let demoSessionId: string;
let realSessionId: string;

async function cleanup() {
  for (const email of [DEMO_EMAIL, REAL_EMAIL]) {
    const u = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (u) {
      await db.delete(sessions).where(eq(sessions.userId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    }
  }
}

beforeAll(async () => {
  await cleanup();
  const demoUserId = id("usr");
  const realUserId = id("usr");
  // Cuenta demo activa con sesión VÁLIDA (no vencida, no revocada).
  await db.insert(users).values({ id: demoUserId, email: DEMO_EMAIL, fullName: "Demo Sesión", role: "owner", passwordHash: "x", isActive: true });
  demoSessionId = id("ses");
  await db.insert(sessions).values({ id: demoSessionId, userId: demoUserId, expiresAt: future() });
  // Propietario REAL activo con sesión válida.
  await db.insert(users).values({ id: realUserId, email: REAL_EMAIL, fullName: "Dueño Real", role: "owner", passwordHash: "x", isActive: true });
  realSessionId = id("ses");
  await db.insert(sessions).values({ id: realSessionId, userId: realUserId, expiresAt: future() });
});
afterAll(cleanup);
afterEach(() => vi.unstubAllEnvs());

describe("resolveSession — cuenta demo con sesión válida", () => {
  it("se ACEPTA solo en entorno demo explícito (dev + DEMO_MODE=true)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("DEMO_MODE", "true");
    const u = await resolveSession(demoSessionId);
    expect(u?.email).toBe(DEMO_EMAIL);
  });

  it("se RECHAZA en producción (aunque la sesión sea válida y el usuario activo)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true"); // no debe importar: producción manda
    const u = await resolveSession(demoSessionId);
    expect(u).toBeNull();
  });

  it("se RECHAZA en desarrollo si el modo demo NO está activo", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("DEMO_MODE", undefined);
    const u = await resolveSession(demoSessionId);
    expect(u).toBeNull();
  });
});

describe("resolveSession — propietario real", () => {
  it("sigue funcionando en producción", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const u = await resolveSession(realSessionId);
    expect(u?.email).toBe(REAL_EMAIL);
    expect(u?.role).toBe("owner");
  });
});
