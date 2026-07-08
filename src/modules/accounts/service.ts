import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, notifications, users, verificationCodes } from "@/db/schema";
import { id } from "@/lib/ids";
import { createSession } from "@/lib/auth/session";
import { getMessagingProvider } from "@/modules/messaging/service";

/**
 * Cuentas de cliente basadas en TELÉFONO + código de verificación.
 * El teléfono es la identidad del cliente en todo el sistema (web, bot de
 * WhatsApp y tienda física): un solo historial, direcciones y —próximamente—
 * membresía premium y cupo de Fiado Digital.
 *
 * Se reutiliza la infraestructura de auth existente: cada cliente obtiene un
 * registro en `users` (rol customer, correo sintético único derivado del
 * teléfono, contraseña inutilizable) y la sesión es la misma de siempre.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

export class AccountError extends Error {}

/** Normaliza a formato 57XXXXXXXXXX (celulares colombianos de 10 dígitos). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (/^3\d{9}$/.test(digits)) return `57${digits}`;
  if (/^57(3\d{9})$/.test(digits)) return digits;
  throw new AccountError("Escribe un celular colombiano válido (10 dígitos, empieza por 3).");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Correo sintético único por teléfono — nunca se usa para enviar nada. */
function syntheticEmail(phone: string): string {
  return `cli-${phone}@clientes.marketcastilla.local`;
}

/**
 * Genera y envía el código de ingreso. Devuelve el estado del envío para que
 * la interfaz sea honesta: con el proveedor "console" (demo) el código no
 * viaja de verdad — queda registrado en el panel de mensajes.
 */
export async function requestLoginCode(rawPhone: string): Promise<{ delivery: string }> {
  const phone = normalizePhone(rawPhone);

  // Límite DURABLE contra abuso (el rate-limit en memoria se reinicia entre
  // instancias serverless): máximo 3 códigos por número cada 10 minutos,
  // contados contra la base de datos.
  const [recent] = await db
    .select({ n: sql<string>`count(*)` })
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.phone, phone),
        sql`${verificationCodes.createdAt} > now() - interval '10 minutes'`,
      ),
    );
  if (Number(recent?.n ?? 0) >= 3) {
    throw new AccountError("Ya enviamos varios códigos a este número. Espera unos minutos.");
  }

  const code = String(randomInt(100000, 1000000)); // 6 dígitos

  await db.insert(verificationCodes).values({
    id: id("vrf"),
    phone,
    codeHash: hashCode(code),
    purpose: "login",
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  const { getSetting } = await import("@/modules/config/service");
  const branding = await getSetting("branding");
  const body = `Tu código de ingreso a ${branding.name} es ${code}. Vence en 10 minutos. Si no lo pediste, ignora este mensaje.`;
  const provider = getMessagingProvider();
  const sent = await provider.send({ to: phone, template: "login_code", body });

  // Rastro en el panel de mensajes. En demo (simulado) se guarda el código
  // completo para poder probar; con canal real se enmascara — el personal
  // no debe poder leer códigos de ingreso vigentes de los clientes.
  await db.insert(notifications).values({
    id: id("ntf"),
    channel: "whatsapp",
    recipient: phone,
    template: "login_code",
    body: sent.status === "simulated" ? body : body.replace(/\d{6}/, "••••••"),
    status: sent.status,
  });
  return { delivery: sent.status };
}

/**
 * Verifica el código y crea la sesión. Si el cliente no existe, lo crea
 * (requiere nombre en ese caso). Vincula/reutiliza la ficha de `customers`
 * por teléfono para heredar historial de pedidos previos como invitado.
 */
export async function verifyLoginCode(params: {
  rawPhone: string;
  code: string;
  fullName?: string;
}): Promise<{ ok: true; isNew: boolean } | { ok: false; message: string; needsName?: boolean }> {
  const phone = normalizePhone(params.rawPhone);
  const code = params.code.replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, message: "El código es de 6 dígitos." };

  const row = await db.query.verificationCodes.findFirst({
    where: and(
      eq(verificationCodes.phone, phone),
      eq(verificationCodes.purpose, "login"),
      isNull(verificationCodes.consumedAt),
    ),
    orderBy: desc(verificationCodes.createdAt),
  });

  if (!row || row.expiresAt < new Date()) {
    return { ok: false, message: "El código venció o no existe. Pide uno nuevo." };
  }
  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, message: "Demasiados intentos con este código. Pide uno nuevo." };
  }

  if (hashCode(code) !== row.codeHash) {
    await db
      .update(verificationCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(verificationCodes.id, row.id));
    return { ok: false, message: "Código incorrecto. Revisa e inténtalo de nuevo." };
  }

  // ¿Cliente nuevo? Necesita nombre antes de crear la cuenta.
  const email = syntheticEmail(phone);
  const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) });
  const existingCustomer = await db.query.customers.findFirst({
    where: eq(customers.phone, phone),
  });
  const fullName =
    params.fullName?.trim() || existingUser?.fullName || existingCustomer?.fullName || "";
  if (!existingUser && !fullName) {
    // No se quema el código: el cliente vuelve con su nombre y el mismo código.
    return { ok: false, needsName: true, message: "Cuéntanos tu nombre para crear tu cuenta." };
  }

  await db
    .update(verificationCodes)
    .set({ consumedAt: new Date() })
    .where(eq(verificationCodes.id, row.id));

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    if (!existingUser.isActive) return { ok: false, message: "Esta cuenta está desactivada." };
  } else {
    userId = id("usr");
    await db.insert(users).values({
      id: userId,
      email,
      // Contraseña inutilizable: el ingreso de clientes es SOLO por código.
      passwordHash: `otp-only:${randomBytes(24).toString("hex")}`,
      fullName,
      role: "customer",
      phone,
    });
  }

  if (existingCustomer) {
    if (!existingCustomer.userId) {
      await db.update(customers).set({ userId }).where(eq(customers.id, existingCustomer.id));
    }
  } else {
    await db.insert(customers).values({
      id: id("cus"),
      userId,
      fullName,
      phone,
    });
  }

  await createSession(userId);
  return { ok: true, isNew: !existingUser };
}

/** Ficha de cliente de un usuario en sesión (o null si no es cliente). */
export async function customerForUser(userId: string) {
  return db.query.customers.findFirst({ where: eq(customers.userId, userId) });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Envía un código de verificación al correo del cliente (requisito del crédito
 * en línea). El código es real (hash + expiración + intentos); el envío usa el
 * EmailProvider configurado (simulado en demo — el código queda en el panel de
 * Mensajes para probar; real con Resend por variables de entorno).
 */
export async function requestEmailCode(params: {
  customerId: string;
  email: string;
}): Promise<{ delivery: string }> {
  const email = params.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new AccountError("Escribe un correo válido.");

  const [recent] = await db
    .select({ n: sql<string>`count(*)` })
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.email, email),
        eq(verificationCodes.purpose, "email_verify"),
        sql`${verificationCodes.createdAt} > now() - interval '10 minutes'`,
      ),
    );
  if (Number(recent?.n ?? 0) >= 3) {
    throw new AccountError("Ya enviamos varios códigos a este correo. Espera unos minutos.");
  }

  const customer = await db.query.customers.findFirst({ where: eq(customers.id, params.customerId) });
  if (!customer) throw new AccountError("Cliente no encontrado.");

  const code = String(randomInt(100000, 1000000));
  await db.insert(verificationCodes).values({
    id: id("vrf"),
    phone: customer.phone,
    email,
    codeHash: hashCode(code),
    purpose: "email_verify",
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  const { getSetting } = await import("@/modules/config/service");
  const { getEmailProvider } = await import("@/modules/messaging/email");
  const branding = await getSetting("branding");
  const body = `Tu código para verificar el correo en ${branding.name} es ${code}. Vence en 10 minutos.`;
  const provider = getEmailProvider();
  const sent = await provider.send({ to: email, subject: `Verifica tu correo · ${branding.name}`, body });

  await db.insert(notifications).values({
    id: id("ntf"),
    channel: "email",
    recipient: email,
    template: "email_verify",
    body: sent.status === "simulated" ? body : body.replace(/\d{6}/, "••••••"),
    status: sent.status,
  });
  return { delivery: sent.status };
}

/** Verifica el código de correo y marca el correo como verificado en la ficha. */
export async function verifyEmailCode(params: {
  customerId: string;
  email: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const email = params.email.trim().toLowerCase();
  const code = params.code.replace(/[^0-9]/g, "");
  if (code.length !== 6) return { ok: false, message: "El código es de 6 dígitos." };

  const row = await db.query.verificationCodes.findFirst({
    where: and(
      eq(verificationCodes.email, email),
      eq(verificationCodes.purpose, "email_verify"),
      isNull(verificationCodes.consumedAt),
    ),
    orderBy: desc(verificationCodes.createdAt),
  });
  if (!row || row.expiresAt < new Date()) {
    return { ok: false, message: "El código venció o no existe. Pide uno nuevo." };
  }
  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, message: "Demasiados intentos con este código. Pide uno nuevo." };
  }
  if (hashCode(code) !== row.codeHash) {
    await db.update(verificationCodes).set({ attempts: row.attempts + 1 }).where(eq(verificationCodes.id, row.id));
    return { ok: false, message: "Código incorrecto." };
  }

  await db.update(verificationCodes).set({ consumedAt: new Date() }).where(eq(verificationCodes.id, row.id));
  await db
    .update(customers)
    .set({ email, emailVerifiedAt: new Date() })
    .where(eq(customers.id, params.customerId));
  return { ok: true };
}
