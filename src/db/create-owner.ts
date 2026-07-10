/**
 * Bootstrap del PRIMER PROPIETARIO REAL (rol `owner`).
 *
 * Operación CONSERVADORA: NO es un upsert ni un reset de contraseña.
 *  - Caso A (el correo no existe, y no hay otro owner real activo): crea el owner.
 *  - Caso B (el correo ya existe como owner ACTIVO): no-op seguro (no modifica nada).
 *  - Caso C (el correo existe con otro rol): aborta, sin tocar la cuenta.
 *  - Caso D (el correo existe como owner INACTIVO): aborta (reactivar es aparte).
 *  - Caso E (ya existe otro owner real activo con correo distinto): aborta.
 * Las cuentas `@marketcastilla.demo` NO cuentan como propietarios reales.
 *
 * Requiere en el entorno: OWNER_EMAIL, OWNER_FULL_NAME, OWNER_PASSWORD.
 * NO lee stdin: si falta OWNER_PASSWORD, aborta con instrucciones (cargarla por
 * entrada oculta del shell — ver docs/RUNBOOK_P0_DEMO.md).
 */
import "./load-env";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { users } from "./schema";
import { hashPassword } from "@/lib/auth/password";
import { isDemoEmail } from "@/lib/auth/demo";
import { recordAudit } from "@/lib/audit";
import { id } from "@/lib/ids";

export type OwnerInput = { email: string; fullName: string; password: string };
export type BootstrapResult = { status: "created" | "exists"; email: string };

/** Clave fija para serializar el bootstrap con un advisory lock transaccional. */
const OWNER_BOOTSTRAP_LOCK = 4017421337;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Correo del propietario: normalizado, con formato válido y no-demo. */
export function resolveOwnerEmail(env: Record<string, string | undefined> = process.env): string {
  const email = String(env.OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!email) throw new Error("OWNER_EMAIL es obligatorio.");
  if (!EMAIL_RE.test(email)) throw new Error("OWNER_EMAIL no tiene un formato de correo válido.");
  if (isDemoEmail(email)) throw new Error("OWNER_EMAIL no puede ser una cuenta demo (@marketcastilla.demo).");
  return email;
}

/** Nombre real del propietario: obligatorio, entre 2 y 120 caracteres. */
export function resolveOwnerName(env: Record<string, string | undefined> = process.env): string {
  const name = String(env.OWNER_FULL_NAME ?? "").trim();
  if (name.length < 2 || name.length > 120) {
    throw new Error("OWNER_FULL_NAME es obligatorio y debe tener entre 2 y 120 caracteres.");
  }
  return name;
}

/**
 * Regla de contraseña (documentada): ≥12 caracteres con minúscula, mayúscula,
 * dígito y símbolo; distinta de `demo1234`; que no contenga el correo completo
 * ni sea igual al nombre normalizado. NUNCA incluye la contraseña en el error.
 */
export function validateOwnerPassword(password: string, ctx: { email: string; fullName: string }): void {
  if (password.length < 12) throw new Error("OWNER_PASSWORD débil: mínimo 12 caracteres.");
  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error("OWNER_PASSWORD débil: incluye minúscula, mayúscula, dígito y símbolo.");
  }
  const lower = password.toLowerCase();
  if (lower === "demo1234") throw new Error("OWNER_PASSWORD débil: no uses una credencial demo.");
  if (lower.includes(ctx.email.toLowerCase())) throw new Error("OWNER_PASSWORD débil: no debe contener el correo.");
  if (lower === ctx.fullName.trim().toLowerCase()) throw new Error("OWNER_PASSWORD débil: no debe ser igual al nombre.");
}

/**
 * Reúne y valida las credenciales del propietario desde el entorno. Exige que
 * OWNER_PASSWORD ya esté en el entorno (NO lee stdin). Toda la validación ocurre
 * ANTES de tocar la base de datos.
 */
export function resolveOwnerInput(env: Record<string, string | undefined> = process.env): OwnerInput {
  const email = resolveOwnerEmail(env);
  const fullName = resolveOwnerName(env);
  const password = env.OWNER_PASSWORD;
  if (password === undefined || password === "") {
    throw new Error(
      "OWNER_PASSWORD no está definido. Cárgalo por entrada oculta del shell y expórtalo, p. ej.:\n" +
        "  read -rsp 'Contraseña del propietario: ' OWNER_PASSWORD; echo; export OWNER_PASSWORD\n" +
        "No lo pongas delante del comando ni lo guardes en archivos.",
    );
  }
  validateOwnerPassword(password, { email, fullName });
  return { email, fullName, password };
}

/**
 * Crea el PRIMER propietario real o confirma (no-op) que ya existe, dentro de
 * una transacción con advisory lock. El lock + la re-verificación dentro de la
 * transacción evitan la carrera de que dos ejecuciones concurrentes creen dos
 * propietarios reales distintos (la 2ª espera, re-lee y ve al 1º ya creado).
 *
 * Identidad de correo CASE-INSENSITIVE: el índice de `users.email` es normal
 * (sensible a mayúsculas), así que se busca por `lower(email)` y se traen TODAS
 * las coincidencias (no `findFirst`) para no ocultar duplicados lógicos por
 * capitalización. La creación del usuario y su auditoría son ATÓMICAS (misma
 * transacción): si una falla, se revierte la otra.
 */
export async function bootstrapOwner(input: OwnerInput): Promise<BootstrapResult> {
  return db.transaction(async (tx) => {
    // Serializa el bootstrap: dos ejecuciones concurrentes no crean dos owners.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${OWNER_BOOTSTRAP_LOCK})`);

    // Coincidencias por identidad case-insensitive (SQL parametrizado, sin concatenar).
    const matches = await tx.select().from(users).where(sql`lower(${users.email}) = ${input.email}`);

    if (matches.length >= 2) {
      // Identidades ambiguas: dos o más filas equivalentes ignorando mayúsculas.
      throw new Error(
        "Existen dos o más cuentas con el mismo correo ignorando mayúsculas; requiere corrección manual. No se modifica ninguna.",
      );
    }

    if (matches.length === 1) {
      const existing = matches[0]!;
      if (existing.role === "owner" && existing.isActive) {
        return { status: "exists", email: input.email }; // Caso B: no-op seguro
      }
      if (existing.role === "owner" && !existing.isActive) {
        // Caso D: no reactivar automáticamente.
        throw new Error(
          "El correo ya existe como propietario INACTIVO. Reactivarlo requiere un procedimiento explícito aparte (fuera de este P0).",
        );
      }
      // Caso C: rol incompatible — no promover, no tocar.
      throw new Error("El correo pertenece a una cuenta existente con un rol incompatible; no se modifica.");
    }

    // Sin coincidencias: ¿ya hay OTRO propietario real activo (no demo)?
    const activeOwners = await tx
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.role, "owner"), eq(users.isActive, true)));
    if (activeOwners.some((o) => !isDemoEmail(o.email))) {
      // Caso E: ya hay un propietario real activo con correo distinto.
      throw new Error("Ya existe un propietario real activo; no se crea un segundo propietario.");
    }

    // Caso A: crear el primer propietario real + su auditoría (atómico).
    const userId = id("usr"); // ID generado ANTES del insert, reutilizado en la auditoría
    const passwordHash = await hashPassword(input.password);
    await tx.insert(users).values({
      id: userId,
      email: input.email,
      fullName: input.fullName,
      role: "owner",
      passwordHash,
    });
    await recordAudit(tx, {
      action: "owner.bootstrap_created",
      entityType: "user",
      entityId: userId,
      actorUserId: null,
      actorLabel: "system:owner-bootstrap",
      before: null,
      // Sin contraseña, hash, entorno, cadena de conexión ni tokens.
      after: { email: input.email, fullName: input.fullName, role: "owner", isActive: true },
    });
    return { status: "created", email: input.email };
  });
}

async function main() {
  const input = resolveOwnerInput();
  const res = await bootstrapOwner(input);
  if (res.status === "created") {
    console.log(`✔ Propietario real creado: ${res.email} (rol: owner, activo).`);
  } else {
    console.log(`= El propietario real ya existe: ${res.email}. No se modificó nada.`);
  }
  process.exit(0);
}

// Solo se ejecuta como script (no al importarlo en pruebas). El mensaje de error
// NUNCA incluye la contraseña.
if (process.argv[1]?.includes("create-owner")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : "Error al ejecutar el bootstrap del propietario.");
    process.exit(1);
  });
}
