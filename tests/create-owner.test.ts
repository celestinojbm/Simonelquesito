/**
 * Bootstrap del primer propietario real (P0) + identidad case-insensitive +
 * auditoría atómica + revocación de sesiones demo. Usa la BD de desarrollo/CI
 * (Postgres local efímero; NUNCA producción). Sin contraseñas reales (fixtures).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, sessions, users } from "@/db/schema";
import { id } from "@/lib/ids";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isDemoEmail } from "@/lib/auth/demo";
import * as audit from "@/lib/audit";
import { bootstrapOwner, type BootstrapResult } from "@/db/create-owner";
import { revokeDemoSessions } from "@/db/revoke-demo-sessions";

const D = "salsatest.co"; // dominio de prueba (real, no demo)
const PW1 = "Zt7#qwerbnmk"; // fixture sintética (no es una contraseña real)
const PW2 = "Kp2$asdfghjk";
const future = () => new Date(Date.now() + 3600_000);

async function cleanupAll() {
  const rows = await db.select({ id: users.id }).from(users).where(ilike(users.email, `%@${D}`));
  for (const r of rows) {
    await db.delete(sessions).where(eq(sessions.userId, r.id));
    await db.delete(auditEvents).where(eq(auditEvents.entityId, r.id));
    await db.delete(users).where(eq(users.id, r.id));
  }
}
async function eventsFor(entityId: string) {
  return db.select().from(auditEvents).where(and(eq(auditEvents.action, "owner.bootstrap_created"), eq(auditEvents.entityId, entityId)));
}
async function userByCi(email: string) {
  const rows = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  return rows;
}
beforeEach(cleanupAll);
afterEach(cleanupAll);

describe("bootstrapOwner — casos de creación/idempotencia/aborto", () => {
  it("1) correo inexistente crea un owner real (Caso A)", async () => {
    const email = `p0-new@${D}`;
    const r = await bootstrapOwner({ email, fullName: "Dueño Uno", password: PW1 });
    expect(r).toEqual({ status: "created", email });
    const u = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(u?.role).toBe("owner");
    expect(u?.isActive).toBe(true);
    expect(u?.fullName).toBe("Dueño Uno");
    expect(await verifyPassword(PW1, u!.passwordHash)).toBe(true);
  });

  it("2-4) segunda ejecución con el mismo owner activo es no-op (no cambia hash/nombre/rol/estado)", async () => {
    const email = `p0-noop@${D}`;
    const hash1 = await hashPassword(PW1);
    await db.insert(users).values({ id: id("usr"), email, fullName: "Nombre Original", role: "owner", passwordHash: hash1, isActive: true });
    const r = await bootstrapOwner({ email, fullName: "Otro Nombre", password: PW2 });
    expect(r.status).toBe("exists");
    const u = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(u?.passwordHash).toBe(hash1);
    expect(await verifyPassword(PW1, u!.passwordHash)).toBe(true);
    expect(await verifyPassword(PW2, u!.passwordHash)).toBe(false);
    expect(u?.fullName).toBe("Nombre Original");
    expect(u?.role).toBe("owner");
    expect(u?.isActive).toBe(true);
  });

  it("5) correo existente como admin aborta sin modificarlo (Caso C)", async () => {
    const email = `p0-admin@${D}`;
    const hash1 = await hashPassword(PW1);
    await db.insert(users).values({ id: id("usr"), email, fullName: "Admin X", role: "admin", passwordHash: hash1, isActive: true });
    await expect(bootstrapOwner({ email, fullName: "Hack", password: PW2 })).rejects.toThrow(/rol incompatible/i);
    const u = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(u?.role).toBe("admin");
    expect(u?.passwordHash).toBe(hash1);
    expect(u?.fullName).toBe("Admin X");
  });

  it("6) correo existente como cashier aborta sin modificarlo (Caso C)", async () => {
    const email = `p0-cashier@${D}`;
    const hash1 = await hashPassword(PW1);
    await db.insert(users).values({ id: id("usr"), email, fullName: "Caja Y", role: "cashier", passwordHash: hash1, isActive: true });
    await expect(bootstrapOwner({ email, fullName: "Hack", password: PW2 })).rejects.toThrow(/rol incompatible/i);
    const u = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(u?.role).toBe("cashier");
    expect(u?.passwordHash).toBe(hash1);
  });

  it("7) owner INACTIVO aborta y permanece inactivo (Caso D)", async () => {
    const email = `p0-inactive@${D}`;
    const hash1 = await hashPassword(PW1);
    await db.insert(users).values({ id: id("usr"), email, fullName: "Owner Off", role: "owner", passwordHash: hash1, isActive: false });
    await expect(bootstrapOwner({ email, fullName: "x", password: PW2 })).rejects.toThrow(/INACTIVO/i);
    const u = await db.query.users.findFirst({ where: eq(users.email, email) });
    expect(u?.isActive).toBe(false);
    expect(u?.passwordHash).toBe(hash1);
  });

  it("8) otro owner real activo con correo distinto bloquea la creación (Caso E)", async () => {
    await db.insert(users).values({ id: id("usr"), email: `p0-existing-owner@${D}`, fullName: "Dueño Existente", role: "owner", passwordHash: await hashPassword(PW1), isActive: true });
    const nuevo = `p0-second@${D}`;
    await expect(bootstrapOwner({ email: nuevo, fullName: "Segundo", password: PW2 })).rejects.toThrow(/propietario real activo/i);
    expect(await userByCi(nuevo)).toHaveLength(0);
  });

  it("9) un owner DEMO no bloquea la creación del primer owner real", async () => {
    const email = `p0-real-first@${D}`;
    const r = await bootstrapOwner({ email, fullName: "Primer Real", password: PW1 });
    expect(r.status).toBe("created");
  });

  it("13) dos intentos concurrentes no crean dos owners reales", async () => {
    const results = await Promise.allSettled([
      bootstrapOwner({ email: `p0-conc-a@${D}`, fullName: "Owner A", password: PW1 }),
      bootstrapOwner({ email: `p0-conc-b@${D}`, fullName: "Owner B", password: PW2 }),
    ]);
    const created = results.filter((r) => r.status === "fulfilled" && (r.value as BootstrapResult).status === "created");
    expect(created).toHaveLength(1);
    const owners = await db.select({ email: users.email }).from(users).where(and(eq(users.role, "owner"), eq(users.isActive, true)));
    expect(owners.filter((o) => !isDemoEmail(o.email))).toHaveLength(1);
  });
});

describe("bootstrapOwner — identidad de correo CASE-INSENSITIVE", () => {
  it("owner activo guardado con MAYÚSCULAS + input en minúsculas → no-op", async () => {
    const stored = `P0-Upper@Salsatest.CO`;
    const input = stored.toLowerCase();
    const hash1 = await hashPassword(PW1);
    await db.insert(users).values({ id: id("usr"), email: stored, fullName: "Dueño Mixto", role: "owner", passwordHash: hash1, isActive: true });
    const r = await bootstrapOwner({ email: input, fullName: "Otro", password: PW2 });
    expect(r.status).toBe("exists");
    // No se creó una segunda cuenta lógica con otra capitalización:
    expect(await userByCi(input)).toHaveLength(1);
    const u = (await userByCi(input))[0]!;
    expect(u.email).toBe(stored); // sin cambios
    expect(u.passwordHash).toBe(hash1);
    expect(u.fullName).toBe("Dueño Mixto");
    expect(u.role).toBe("owner");
    expect(u.isActive).toBe(true);
  });

  it("admin guardado con MAYÚSCULAS + input en minúsculas → aborta sin modificar", async () => {
    const stored = `P0-AdmUp@Salsatest.CO`;
    const hash1 = await hashPassword(PW1);
    await db.insert(users).values({ id: id("usr"), email: stored, fullName: "Admin Up", role: "admin", passwordHash: hash1, isActive: true });
    await expect(bootstrapOwner({ email: stored.toLowerCase(), fullName: "x", password: PW2 })).rejects.toThrow(/rol incompatible/i);
    const u = (await userByCi(stored))[0]!;
    expect(u.role).toBe("admin");
    expect(u.passwordHash).toBe(hash1);
    expect(u.fullName).toBe("Admin Up");
  });

  it("owner INACTIVO guardado con MAYÚSCULAS → aborta y permanece inactivo", async () => {
    const stored = `P0-OffUp@Salsatest.CO`;
    const hash1 = await hashPassword(PW1);
    await db.insert(users).values({ id: id("usr"), email: stored, fullName: "Off Up", role: "owner", passwordHash: hash1, isActive: false });
    await expect(bootstrapOwner({ email: stored.toLowerCase(), fullName: "x", password: PW2 })).rejects.toThrow(/INACTIVO/i);
    const u = (await userByCi(stored))[0]!;
    expect(u.isActive).toBe(false);
    expect(u.passwordHash).toBe(hash1);
  });

  it("dos filas equivalentes ignorando mayúsculas → aborta por ambigüedad y no modifica ninguna", async () => {
    const hashA = await hashPassword(PW1);
    const hashB = await hashPassword(PW2);
    await db.insert(users).values({ id: id("usr"), email: `Dup@Salsatest.CO`, fullName: "Dup Uno", role: "owner", passwordHash: hashA, isActive: true });
    await db.insert(users).values({ id: id("usr"), email: `dup@salsatest.co`, fullName: "Dup Dos", role: "admin", passwordHash: hashB, isActive: true });
    await expect(bootstrapOwner({ email: "dup@salsatest.co", fullName: "x", password: PW1 })).rejects.toThrow(/ambig|dos o más/i);
    const rows = await userByCi("dup@salsatest.co");
    expect(rows).toHaveLength(2); // ninguna creada ni borrada
    const byName = Object.fromEntries(rows.map((r) => [r.fullName, r]));
    expect(byName["Dup Uno"]!.passwordHash).toBe(hashA);
    expect(byName["Dup Uno"]!.role).toBe("owner");
    expect(byName["Dup Dos"]!.passwordHash).toBe(hashB);
    expect(byName["Dup Dos"]!.role).toBe("admin");
  });
});

describe("bootstrapOwner — auditoría atómica de creación", () => {
  it("1) una creación exitosa genera exactamente un evento; entityId coincide; after sin secretos", async () => {
    const email = `p0-audit@${D}`;
    await bootstrapOwner({ email, fullName: "Auditado", password: PW1 });
    const u = (await userByCi(email))[0]!;
    const evs = await eventsFor(u.id);
    expect(evs).toHaveLength(1);
    const ev = evs[0]!;
    expect(ev.entityType).toBe("user");
    expect(ev.entityId).toBe(u.id);
    expect(ev.actorLabel).toBe("system:owner-bootstrap");
    const after = ev.after as Record<string, unknown>;
    expect(after).toEqual({ email, fullName: "Auditado", role: "owner", isActive: true });
    const dump = JSON.stringify(ev).toLowerCase();
    expect(dump).not.toContain("password");
    expect(dump).not.toContain("passwordhash");
    expect(dump).not.toContain(u.passwordHash.toLowerCase());
  });

  it("2) una segunda ejecución no-op NO crea otro evento de creación", async () => {
    const email = `p0-audit-noop@${D}`;
    await bootstrapOwner({ email, fullName: "Uno", password: PW1 });
    const u = (await userByCi(email))[0]!;
    await bootstrapOwner({ email, fullName: "Dos", password: PW2 }); // no-op
    expect(await eventsFor(u.id)).toHaveLength(1);
  });

  it("3) casos rechazados (rol incompatible / inactivo / ambiguo) no crean evento de creación", async () => {
    const admin = `p0-audit-admin@${D}`;
    const adminId = id("usr");
    await db.insert(users).values({ id: adminId, email: admin, fullName: "Adm", role: "admin", passwordHash: await hashPassword(PW1), isActive: true });
    await expect(bootstrapOwner({ email: admin, fullName: "x", password: PW2 })).rejects.toThrow();
    expect(await eventsFor(adminId)).toHaveLength(0);

    const off = `p0-audit-off@${D}`;
    const offId = id("usr");
    await db.insert(users).values({ id: offId, email: off, fullName: "Off", role: "owner", passwordHash: await hashPassword(PW1), isActive: false });
    await expect(bootstrapOwner({ email: off, fullName: "x", password: PW2 })).rejects.toThrow();
    expect(await eventsFor(offId)).toHaveLength(0);
  });

  it("4) si la escritura de auditoría falla, se revierte la creación del usuario", async () => {
    const email = `p0-audit-rollback@${D}`;
    const spy = vi.spyOn(audit, "recordAudit").mockRejectedValueOnce(new Error("audit boom (test)"));
    await expect(bootstrapOwner({ email, fullName: "Rollback", password: PW1 })).rejects.toThrow(/audit boom/);
    spy.mockRestore();
    expect(await userByCi(email), "el usuario NO debe existir tras el rollback").toHaveLength(0);
  });
});

describe("revokeDemoSessions (limpieza operativa)", () => {
  it("revoca sesiones demo y deja intactas las de usuarios reales", async () => {
    const keepEmail = `p0-keep@${D}`;
    const keepId = id("usr");
    await db.insert(users).values({ id: keepId, email: keepEmail, fullName: "No Demo", role: "admin", passwordHash: "x", isActive: true });
    const keepSession = id("ses");
    await db.insert(sessions).values({ id: keepSession, userId: keepId, expiresAt: future() });

    const demo = await db.query.users.findFirst({ where: eq(users.email, "owner@marketcastilla.demo") });
    expect(demo, "el seed debe haber creado la cuenta demo").toBeTruthy();
    const demoSession = id("ses");
    await db.insert(sessions).values({ id: demoSession, userId: demo!.id, expiresAt: future() });

    const revoked = await revokeDemoSessions();
    expect(revoked).toBeGreaterThanOrEqual(1);

    const demoRow = await db.query.sessions.findFirst({ where: eq(sessions.id, demoSession) });
    expect(demoRow?.revokedAt, "la sesión demo debe quedar revocada").toBeTruthy();
    const keepRow = await db.query.sessions.findFirst({ where: eq(sessions.id, keepSession) });
    expect(keepRow?.revokedAt, "la sesión del usuario real NO debe tocarse").toBeNull();

    await db.delete(sessions).where(eq(sessions.id, demoSession));
  });
});
