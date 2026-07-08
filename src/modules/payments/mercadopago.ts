import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationAccounts } from "@/db/schema";
import { id } from "@/lib/ids";
import { applyBps } from "@/lib/money";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { getSetting } from "@/modules/config/service";
import type { PaymentProvider, CreatePaymentIntent, PaymentIntentResult } from "./provider";

/**
 * Mercado Pago Colombia — Checkout Pro con SPLIT en la fuente (marketplace 1:1).
 *
 * Arquitectura del dinero:
 * - La agencia es la "aplicación" MP (MERCADOPAGO_CLIENT_ID/SECRET).
 * - El NEGOCIO (Diana) autoriza por OAuth: sus tokens quedan CIFRADOS en
 *   integration_accounts (kind "mercado_pago"). El dinero de cada venta entra
 *   a la cuenta del negocio.
 * - `marketplace_fee` (el % de settings commission.base.ratePctBps, editable
 *   por el owner) va automáticamente a la cuenta de la agencia.
 *
 * Reglas de oro (mismas del resto de la capa de pagos):
 * - El estado de un pago SOLO cambia por webhook verificado.
 * - La notificación de MP no trae el estado: se consulta a la API con el id
 *   y del pago consultado salen estado, external_reference y comisiones.
 *
 * Guía de puesta en marcha para el propietario: docs/MERCADOPAGO.md.
 */

const MP_API = "https://api.mercadopago.com";
export const MP_INTEGRATION_KIND = "mercado_pago";

/* ============================ Utilidades base ============================ */

export function appBaseUrl(): string {
  const explicit = process.env.APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

function oauthClient(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MERCADOPAGO_CLIENT_ID;
  const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Faltan MERCADOPAGO_CLIENT_ID / MERCADOPAGO_CLIENT_SECRET (la aplicación de la agencia en Mercado Pago).",
    );
  }
  return { clientId, clientSecret };
}

export function mpCallbackUrl(): string {
  return `${appBaseUrl()}/api/integrations/mercadopago/callback`;
}

/* ===================== Firma del webhook (x-signature) ===================== */

/**
 * Verifica la firma de una notificación de Mercado Pago.
 * Cabecera `x-signature: ts=<unix>,v1=<hmac>`; el manifiesto firmado es
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (cada parte solo si
 * existe; data.id alfanumérico va en minúsculas). HMAC-SHA256 con el secreto
 * del webhook configurado en el panel de desarrolladores de MP.
 */
export function verifyMpSignature(params: {
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
  secret: string;
  /** Tolerancia del timestamp (anti-replay). Default 15 min; 0 = sin chequeo. */
  toleranceMs?: number;
  now?: number;
}): boolean {
  const header = params.signatureHeader;
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=", 2).map((s) => s.trim()) as [string, string]),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const tolerance = params.toleranceMs ?? 15 * 60 * 1000;
  if (tolerance > 0) {
    const at = Number(ts) * (ts.length <= 10 ? 1000 : 1);
    if (!Number.isFinite(at) || Math.abs((params.now ?? Date.now()) - at) > tolerance) return false;
  }

  let manifest = "";
  if (params.dataId) manifest += `id:${params.dataId.toLowerCase()};`;
  if (params.requestId) manifest += `request-id:${params.requestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac("sha256", params.secret).update(manifest).digest("hex");
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ===================== Mapeo de estados y comisiones ===================== */

/** Estados de MP → estados internos del webhook. null = ignorar (sigue pendiente / se maneja aparte). */
export function mpMapStatus(mpStatus: string): "approved" | "rejected" | "expired" | null {
  switch (mpStatus) {
    case "approved":
      return "approved";
    case "rejected":
    case "cancelled":
      return "rejected";
    case "expired":
      return "expired";
    default:
      // pending | in_process | authorized | in_mediation | refunded | charged_back
      return null;
  }
}

export type MpFeeInfo = { gatewayFeeCop: number; splitFeeCop: number };

/** Extrae del pago consultado la comisión de MP y el split de la agencia. */
export function mpExtractFees(payment: { fee_details?: { type?: string; amount?: number }[] }): MpFeeInfo {
  let gateway = 0;
  let split = 0;
  for (const f of payment.fee_details ?? []) {
    const amount = Math.round(Number(f.amount) || 0);
    if (f.type === "mercadopago_fee" || f.type === "financing_fee") gateway += amount;
    if (f.type === "application_fee" || f.type === "marketplace_fee") split += amount;
  }
  return { gatewayFeeCop: gateway, splitFeeCop: split };
}

/* ======================= Preferencia (Checkout Pro) ======================= */

export function buildPreferenceBody(params: {
  providerRef: string;
  orderId: string;
  amountCop: number;
  marketplaceFeeCop: number;
  baseUrl: string;
  businessName: string;
}) {
  const orderUrl = `${params.baseUrl}/pedido/${params.orderId}`;
  return {
    items: [
      {
        id: params.orderId,
        title: `Pedido ${params.businessName}`,
        quantity: 1,
        unit_price: params.amountCop,
        currency_id: "COP",
      },
    ],
    external_reference: params.providerRef,
    // Split 1:1: la comisión de la agencia se descuenta EN LA FUENTE.
    marketplace_fee: params.marketplaceFeeCop,
    notification_url: `${params.baseUrl}/api/webhooks/payments/mercadopago`,
    back_urls: { success: orderUrl, pending: orderUrl, failure: orderUrl },
    auto_return: "approved" as const,
    statement_descriptor: params.businessName.toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 22) || "MARKETCASTILLA",
  };
}

/* ================= Credenciales del vendedor (OAuth, cifradas) ================= */

type MpSellerCredentials = {
  accessToken: string;
  refreshToken: string | null;
  /** ISO; MP entrega expires_in en segundos (~180 días). */
  expiresAt: string;
  collectorId: number | null;
  publicKey: string | null;
};

export async function getMpIntegration() {
  return db.query.integrationAccounts.findFirst({
    where: eq(integrationAccounts.kind, MP_INTEGRATION_KIND),
  });
}

async function saveSellerCredentials(creds: MpSellerCredentials): Promise<void> {
  const encrypted = encryptSecret(JSON.stringify(creds));
  // status live/sandbox se infiere del token (TEST- = credenciales de prueba).
  const status = creds.accessToken.startsWith("TEST-") ? "sandbox" : "live";
  const config = {
    collectorId: creds.collectorId,
    publicKey: creds.publicKey,
    connectedAt: new Date().toISOString(),
    expiresAt: creds.expiresAt,
  };
  const existing = await getMpIntegration();
  if (existing) {
    await db
      .update(integrationAccounts)
      .set({ encryptedCredentials: encrypted, status, config })
      .where(eq(integrationAccounts.id, existing.id));
  } else {
    await db.insert(integrationAccounts).values({
      id: id("int"),
      kind: MP_INTEGRATION_KIND,
      name: "Mercado Pago (cuenta del negocio)",
      encryptedCredentials: encrypted,
      status,
      config,
    });
  }
}

export async function disconnectMpSeller(): Promise<void> {
  const existing = await getMpIntegration();
  if (!existing) return;
  await db
    .update(integrationAccounts)
    .set({ encryptedCredentials: null, status: "not_connected", config: { disconnectedAt: new Date().toISOString() } })
    .where(eq(integrationAccounts.id, existing.id));
}

/**
 * Access token vigente del negocio. Si está por vencer (< 7 días), se
 * refresca con el refresh_token y se re-cifra. Lanza un error claro si la
 * cuenta no está conectada.
 */
export async function getMpSellerAccessToken(): Promise<string> {
  const row = await getMpIntegration();
  if (!row?.encryptedCredentials) {
    throw new Error(
      "Mercado Pago no está conectado: el propietario debe vincular la cuenta del negocio en Admin → Integraciones.",
    );
  }
  const creds = JSON.parse(decryptSecret(row.encryptedCredentials)) as MpSellerCredentials;
  const msLeft = new Date(creds.expiresAt).getTime() - Date.now();
  if (msLeft > 7 * 24 * 60 * 60 * 1000 || !creds.refreshToken) return creds.accessToken;

  const refreshed = await mpOauthToken({ grant_type: "refresh_token", refresh_token: creds.refreshToken });
  await saveSellerCredentials(refreshed);
  return refreshed.accessToken;
}

/* ============================== OAuth (agencia ↔ negocio) ============================== */

/** URL a la que se manda al propietario para autorizar la cuenta MP del negocio. */
export function mpAuthorizationUrl(state: string): string {
  const { clientId } = oauthClient();
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    platform_id: "mp",
    state,
    redirect_uri: mpCallbackUrl(),
  });
  return `https://auth.mercadopago.com.co/authorization?${q.toString()}`;
}

async function mpOauthToken(
  grant: { grant_type: "authorization_code"; code: string } | { grant_type: "refresh_token"; refresh_token: string },
): Promise<MpSellerCredentials> {
  const { clientId, clientSecret } = oauthClient();
  const res = await fetch(`${MP_API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      ...(grant.grant_type === "authorization_code" ? { redirect_uri: mpCallbackUrl() } : {}),
      ...grant,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Mercado Pago rechazó el intercambio OAuth (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    user_id?: number;
    public_key?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 15_552_000) * 1000).toISOString(),
    collectorId: data.user_id ?? null,
    publicKey: data.public_key ?? null,
  };
}

/** Intercambia el `code` del callback y guarda las credenciales cifradas. */
export async function connectMpSeller(code: string): Promise<{ collectorId: number | null; status: string }> {
  const creds = await mpOauthToken({ grant_type: "authorization_code", code });
  await saveSellerCredentials(creds);
  return { collectorId: creds.collectorId, status: creds.accessToken.startsWith("TEST-") ? "sandbox" : "live" };
}

/* ========================= Estado anti-CSRF del OAuth ========================= */

function stateSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET no configurado");
  return s;
}

/** Estado firmado (HMAC) con vencimiento: evita callbacks forjados. */
export function mpOauthState(now = Date.now()): string {
  const ts = String(now);
  const mac = createHmac("sha256", stateSecret()).update(`mp-oauth:${ts}`).digest("hex").slice(0, 32);
  return `${ts}.${mac}`;
}

export function verifyMpOauthState(state: string | null, maxAgeMs = 30 * 60 * 1000, now = Date.now()): boolean {
  if (!state) return false;
  const [ts, mac] = state.split(".");
  if (!ts || !mac) return false;
  const expected = createHmac("sha256", stateSecret()).update(`mp-oauth:${ts}`).digest("hex").slice(0, 32);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return now - Number(ts) <= maxAgeMs && Number(ts) <= now + 60_000;
}

/* =========================== Consulta de pagos =========================== */

export type MpPayment = {
  id: number | string;
  status: string;
  external_reference?: string;
  transaction_amount?: number;
  fee_details?: { type?: string; amount?: number }[];
  payment_method_id?: string;
  payment_type_id?: string;
};

/** Consulta el pago a la API de MP (la notificación solo trae el id). */
export async function fetchMpPayment(paymentId: string): Promise<MpPayment> {
  const token = await getMpSellerAccessToken();
  const res = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`No se pudo consultar el pago ${paymentId} en Mercado Pago (${res.status}).`);
  }
  return (await res.json()) as MpPayment;
}

/* ============================ PaymentProvider ============================ */

export class MercadoPagoProvider implements PaymentProvider {
  readonly name = "mercado_pago";

  async createIntent(input: CreatePaymentIntent): Promise<PaymentIntentResult> {
    const providerRef = id("mp");
    const [token, commission, branding] = await Promise.all([
      getMpSellerAccessToken(),
      getSetting("commission.base"),
      getSetting("branding"),
    ]);
    const body = buildPreferenceBody({
      providerRef,
      orderId: input.orderId,
      amountCop: input.amountCop,
      marketplaceFeeCop: applyBps(input.amountCop, commission.ratePctBps),
      baseUrl: appBaseUrl(),
      businessName: branding.name,
    });
    const res = await fetch(`${MP_API}/checkout/preferences`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Mercado Pago rechazó la preferencia (${res.status}): ${detail.slice(0, 300)}`);
    }
    const pref = (await res.json()) as { id: string; init_point?: string; sandbox_init_point?: string };
    return { providerRef, redirectUrl: pref.init_point ?? pref.sandbox_init_point ?? null };
  }

  /**
   * La verificación real vive en la ruta del webhook (verifyMpSignature):
   * la firma de MP necesita data.id (query) y x-request-id, que no caben en
   * este contrato. Este método queda como negación segura.
   */
  verifyWebhookSignature(): boolean {
    return false;
  }

  parseWebhook(): never {
    throw new Error("El webhook de Mercado Pago se procesa en su propia ruta (requiere consultar la API).");
  }
}
