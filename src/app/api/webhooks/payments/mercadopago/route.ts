import { NextResponse } from "next/server";
import {
  fetchMpPayment,
  mpExtractFees,
  mpMapStatus,
  verifyMpSignature,
} from "@/modules/payments/mercadopago";
import { processPaymentWebhook } from "@/modules/payments/service";

/**
 * Webhook de Mercado Pago (notificaciones de pago).
 *
 * - Firma verificada SIEMPRE (x-signature con el secreto del panel de MP);
 *   sin secreto configurado el endpoint responde 503 (apagado).
 * - La notificación solo trae el id: el estado real, el external_reference
 *   (nuestro providerRef) y las comisiones se consultan a la API de MP.
 * - Dedupe por (provider, `${paymentId}:${status}`): los reintentos de MP no
 *   duplican nada, pero una transición pending→approved sí se procesa.
 * - Respuesta 200 rápida en casos ignorables; 5xx solo cuando conviene que
 *   MP reintente (ej. fallo consultando la API).
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Mercado Pago no está configurado" }, { status: 503 });
  }

  const url = new URL(req.url);
  const rawBody = await req.text();
  let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    // MP puede mandar query-only en algunos formatos; el cuerpo vacío no es fatal.
  }

  const dataId = url.searchParams.get("data.id") ?? (body.data?.id != null ? String(body.data.id) : null);
  const type = url.searchParams.get("type") ?? body.type ?? null;

  const validSignature = verifyMpSignature({
    signatureHeader: req.headers.get("x-signature"),
    requestId: req.headers.get("x-request-id"),
    dataId,
    secret,
  });
  if (!validSignature) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  // Solo procesamos notificaciones de pago; lo demás se confirma sin acción.
  if (type !== "payment" || !dataId) {
    return NextResponse.json({ received: true, ignored: true });
  }

  let payment;
  try {
    payment = await fetchMpPayment(dataId);
  } catch (e) {
    // 502 → MP reintenta más tarde (la consulta falló, no el evento).
    console.error("[mercadopago webhook] Error consultando el pago", e);
    return NextResponse.json({ error: "No se pudo consultar el pago" }, { status: 502 });
  }

  const status = mpMapStatus(payment.status);
  if (!status || !payment.external_reference) {
    // pending/in_process/etc.: aún sin estado final; no hay nada que aplicar.
    return NextResponse.json({ received: true, ignored: true, mpStatus: payment.status });
  }

  const result = await processPaymentWebhook({
    provider: "mercado_pago",
    externalEventId: `${dataId}:${status}`,
    providerRef: payment.external_reference,
    status,
    feeInfo: status === "approved" ? mpExtractFees(payment) : undefined,
    rawPayload: {
      notification: { type, action: body.action ?? null, dataId },
      payment: {
        id: payment.id,
        status: payment.status,
        external_reference: payment.external_reference,
        transaction_amount: payment.transaction_amount,
        fee_details: payment.fee_details,
        payment_method_id: payment.payment_method_id,
        payment_type_id: payment.payment_type_id,
      },
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 422 });
  }
  return NextResponse.json({ received: true, duplicate: result.duplicate ?? false });
}
