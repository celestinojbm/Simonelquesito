/**
 * Mercado Pago: piezas puras verificables SIN credenciales reales —
 * firma del webhook, mapeo de estados, extracción de comisiones, cuerpo de
 * la preferencia (split desde bps), state anti-CSRF y cifrado AES-GCM.
 */
import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  buildPreferenceBody,
  mpExtractFees,
  mpMapStatus,
  mpOauthState,
  verifyMpOauthState,
  verifyMpSignature,
} from "@/modules/payments/mercadopago";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { applyBps } from "@/lib/money";

const SECRET = "mp-webhook-secret-de-prueba";

function signedHeader(params: { dataId: string; requestId: string; ts: number; secret?: string }) {
  const manifest = `id:${params.dataId.toLowerCase()};request-id:${params.requestId};ts:${params.ts};`;
  const v1 = createHmac("sha256", params.secret ?? SECRET).update(manifest).digest("hex");
  return `ts=${params.ts},v1=${v1}`;
}

describe("verifyMpSignature", () => {
  const now = 1_800_000_000_000;
  const ts = Math.floor(now / 1000);
  const base = { dataId: "12345", requestId: "req-abc", secret: SECRET, now };

  it("acepta una firma válida", () => {
    const header = signedHeader({ dataId: "12345", requestId: "req-abc", ts });
    expect(verifyMpSignature({ ...base, signatureHeader: header })).toBe(true);
  });
  it("rechaza firma con secreto equivocado", () => {
    const header = signedHeader({ dataId: "12345", requestId: "req-abc", ts, secret: "otro" });
    expect(verifyMpSignature({ ...base, signatureHeader: header })).toBe(false);
  });
  it("rechaza data.id alterado", () => {
    const header = signedHeader({ dataId: "12345", requestId: "req-abc", ts });
    expect(verifyMpSignature({ ...base, dataId: "99999", signatureHeader: header })).toBe(false);
  });
  it("rechaza cabecera ausente o malformada", () => {
    expect(verifyMpSignature({ ...base, signatureHeader: null })).toBe(false);
    expect(verifyMpSignature({ ...base, signatureHeader: "v1=abc" })).toBe(false);
  });
  it("rechaza timestamps viejos (anti-replay) y acepta con tolerancia 0", () => {
    const oldTs = ts - 60 * 60; // 1 hora atrás
    const header = signedHeader({ dataId: "12345", requestId: "req-abc", ts: oldTs });
    expect(verifyMpSignature({ ...base, signatureHeader: header })).toBe(false);
    expect(verifyMpSignature({ ...base, signatureHeader: header, toleranceMs: 0 })).toBe(true);
  });
  it("data.id alfanumérico se firma en minúsculas", () => {
    const header = signedHeader({ dataId: "abc123", requestId: "req-abc", ts });
    expect(verifyMpSignature({ ...base, dataId: "ABC123", signatureHeader: header })).toBe(true);
  });
});

describe("mpMapStatus", () => {
  it("mapea estados finales", () => {
    expect(mpMapStatus("approved")).toBe("approved");
    expect(mpMapStatus("rejected")).toBe("rejected");
    expect(mpMapStatus("cancelled")).toBe("rejected");
    expect(mpMapStatus("expired")).toBe("expired");
  });
  it("ignora estados intermedios o gestionados aparte", () => {
    for (const s of ["pending", "in_process", "authorized", "in_mediation", "refunded", "charged_back"]) {
      expect(mpMapStatus(s)).toBeNull();
    }
  });
});

describe("mpExtractFees", () => {
  it("separa comisión de MP y split de agencia", () => {
    const fees = mpExtractFees({
      fee_details: [
        { type: "mercadopago_fee", amount: 1890 },
        { type: "application_fee", amount: 5000 },
      ],
    });
    expect(fees).toEqual({ gatewayFeeCop: 1890, splitFeeCop: 5000 });
  });
  it("sin fee_details devuelve ceros", () => {
    expect(mpExtractFees({})).toEqual({ gatewayFeeCop: 0, splitFeeCop: 0 });
  });
});

describe("buildPreferenceBody", () => {
  it("arma la preferencia con split, referencia y URLs correctas", () => {
    const amountCop = 50_000;
    const marketplaceFeeCop = applyBps(amountCop, 1000); // 10% = 5.000
    const body = buildPreferenceBody({
      providerRef: "mp_test123",
      orderId: "ord_abc",
      amountCop,
      marketplaceFeeCop,
      baseUrl: "https://marketcastilla.vercel.app",
      businessName: "Market Castilla",
    });
    expect(marketplaceFeeCop).toBe(5_000);
    expect(body.external_reference).toBe("mp_test123");
    expect(body.marketplace_fee).toBe(5_000);
    expect(body.items[0]).toMatchObject({ unit_price: 50_000, currency_id: "COP", quantity: 1 });
    expect(body.notification_url).toBe("https://marketcastilla.vercel.app/api/webhooks/payments/mercadopago");
    expect(body.back_urls.success).toBe("https://marketcastilla.vercel.app/pedido/ord_abc");
    expect(body.statement_descriptor.length).toBeLessThanOrEqual(22);
  });
});

describe("mpOauthState (anti-CSRF)", () => {
  it("un state recién emitido es válido y uno viejo no", () => {
    const now = Date.now();
    const state = mpOauthState(now);
    expect(verifyMpOauthState(state, 30 * 60 * 1000, now + 60_000)).toBe(true);
    expect(verifyMpOauthState(state, 30 * 60 * 1000, now + 31 * 60 * 1000)).toBe(false);
  });
  it("un state manipulado se rechaza", () => {
    const state = mpOauthState();
    const [ts] = state.split(".");
    expect(verifyMpOauthState(`${ts}.deadbeefdeadbeefdeadbeefdeadbeef`)).toBe(false);
    expect(verifyMpOauthState(null)).toBe(false);
  });
});

describe("cifrado de credenciales (AES-256-GCM)", () => {
  it("cifra y descifra; el texto cifrado no expone el secreto", () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = "a".repeat(64);
    const plain = JSON.stringify({ accessToken: "APP_USR-super-secreto" });
    const enc = encryptSecret(plain);
    expect(enc).not.toContain("super-secreto");
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });
  it("un texto cifrado alterado no descifra", () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = "a".repeat(64);
    const enc = encryptSecret("hola");
    const parts = enc.split(".");
    parts[3] = parts[3]!.slice(0, -2) + "zz";
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
