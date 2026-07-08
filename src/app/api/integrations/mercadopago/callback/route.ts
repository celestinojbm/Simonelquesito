import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { roleHas } from "@/lib/auth/permissions";
import { recordAudit } from "@/lib/audit";
import { db } from "@/db";
import { connectMpSeller, verifyMpOauthState } from "@/modules/payments/mercadopago";

/**
 * Callback OAuth de Mercado Pago: aquí vuelve el propietario después de
 * autorizar la cuenta del NEGOCIO. Exige sesión con integrations.manage
 * (mismo navegador que inició la vinculación) y un state firmado y fresco
 * (anti-CSRF). Los tokens quedan cifrados en integration_accounts.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const destination = (q: string) => NextResponse.redirect(new URL(`/admin/integraciones?mp=${q}`, url.origin));

  const user = await getSessionUser();
  if (!user || !roleHas(user.role, "integrations.manage")) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  if (url.searchParams.get("error")) {
    // El propietario canceló o MP rechazó la autorización.
    return destination("cancelado");
  }
  if (!verifyMpOauthState(url.searchParams.get("state"))) {
    return destination("estado_invalido");
  }
  const code = url.searchParams.get("code");
  if (!code) return destination("sin_codigo");

  try {
    const { collectorId, status } = await connectMpSeller(code);
    await recordAudit(db, {
      action: "integrations.mercadopago_connected",
      entityType: "integration",
      entityId: "mercado_pago",
      actorUserId: user.id,
      actorLabel: `${user.role}:${user.email}`,
      after: { collectorId, status },
    });
    return destination("conectado");
  } catch (e) {
    console.error("[mercadopago oauth] Error en el intercambio", e);
    return destination("error");
  }
}
