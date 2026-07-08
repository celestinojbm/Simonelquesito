"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";

export type LoginResult = { ok: false; message: string } | never;

export async function loginAction(formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  // Mensaje genérico siempre: evita enumeración de cuentas.
  const generic = { ok: false as const, message: "Correo o contraseña incorrectos." };

  if (!rateLimit(`login:${email}`, 5, 60_000)) {
    return { ok: false, message: "Demasiados intentos. Espera un minuto." };
  }
  if (!email || !password) return generic;

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !user.isActive) return generic;
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return generic;

  await createSession(user.id);
  redirect(user.role === "driver" ? "/repartidor" : user.role === "customer" ? "/cuenta" : "/admin");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
