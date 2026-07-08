import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, and, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { id } from "@/lib/ids";
import type { Role, Permission } from "./permissions";
import { roleHas } from "./permissions";

const COOKIE_NAME = "mc_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 días

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET no configurado");
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

function pack(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

function unpack(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const sessionId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(sessionId);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

export async function createSession(userId: string): Promise<void> {
  const sessionId = id("ses");
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  const store = await cookies();
  store.set(COOKIE_NAME, pack(sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const sessionId = unpack(token);
  if (!sessionId) return null;
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, sessionId),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.isActive) return null;
  return { id: row.userId, email: row.email, fullName: row.fullName, role: row.role as Role };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    const sessionId = unpack(token);
    if (sessionId) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
    }
  }
  store.delete(COOKIE_NAME);
}

/** Guard para páginas/acciones del panel: lanza si no hay permiso. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !roleHas(user.role, permission)) {
    throw new Error(`No autorizado (se requiere ${permission})`);
  }
  return user;
}
