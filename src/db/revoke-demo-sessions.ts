/**
 * Revoca (idempotente) TODAS las sesiones activas de cuentas demo (`*.demo`).
 * No borra filas: marca `revoked_at`, así las sesiones dejan de ser válidas
 * (ver `getSessionUser` en `src/lib/auth/session.ts`, que exige `revoked_at IS
 * NULL`). Correr de nuevo no tiene efecto (ya están revocadas).
 *
 * Uso:  npm run demo:revoke-sessions
 * (Este script está PREPARADO; en producción se corre tras crear el owner real.)
 */
import "./load-env";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "./index";
import { sessions } from "./schema";
import { isDemoEmail } from "@/lib/auth/demo";

/** Revoca las sesiones activas de todas las cuentas demo. Devuelve cuántas revocó. */
export async function revokeDemoSessions(): Promise<number> {
  const all = await db.query.users.findMany();
  const demoUserIds = all.filter((u) => isDemoEmail(u.email)).map((u) => u.id);
  if (demoUserIds.length === 0) return 0;
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(inArray(sessions.userId, demoUserIds), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return revoked.length;
}

async function main() {
  const n = await revokeDemoSessions();
  console.log(`✔ Sesiones demo revocadas: ${n}.`);
  process.exit(0);
}

if (process.argv[1]?.includes("revoke-demo-sessions")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
