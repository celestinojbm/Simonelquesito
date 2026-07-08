import { NextResponse } from "next/server";
import { runDueSubscriptions } from "@/modules/subscriptions/service";

/**
 * Cron diario de canastas recurrentes (Vercel Cron, ver vercel.json:
 * corre a las 11:00 UTC = 6:00 a. m. de Bogotá).
 * - Genera los pedidos de las canastas cuya fecha llegó (idempotente).
 * - Envía el recordatorio de víspera ("mañana llega tu canasta").
 * Autenticación: Vercel envía `Authorization: Bearer ${CRON_SECRET}` cuando
 * la variable está configurada. Sin CRON_SECRET el endpoint queda apagado
 * (el panel tiene "Generar ahora" como vía manual).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Cron apagado: configura CRON_SECRET en Vercel." },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const result = await runDueSubscriptions();
  console.log("[cron canastas]", JSON.stringify(result));
  return NextResponse.json(result);
}
