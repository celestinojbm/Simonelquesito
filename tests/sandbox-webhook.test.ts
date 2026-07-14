/**
 * Webhook sandbox — secreto OBLIGATORIO, sin fallback hardcodeado (P0.5).
 *
 * Sin `PAYMENT_WEBHOOK_SECRET` (ausente o vacío) el endpoint responde 503
 * ANTES de procesar nada (no se llama processPaymentWebhook, no se tocan
 * pagos/pedidos ni se registra el evento). Con secreto configurado se
 * conserva el comportamiento existente: firma HMAC + timingSafeEqual, 401
 * ante firma inválida y paso a processPaymentWebhook solo con firma válida.
 * Ningún error devuelve el valor del secreto.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/payments/sandbox/route";
import {
  isSandboxWebhookConfigured,
  signSandboxPayload,
  SandboxPaymentProvider,
} from "@/modules/payments/sandbox";
import * as paymentsService from "@/modules/payments/service";

const SECRET = "secreto-de-prueba-sandbox"; // fixture sintética, no productiva

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function makeRequest(body: string, signature?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== undefined) headers["x-sandbox-signature"] = signature;
  return new Request("http://localhost/api/webhooks/payments/sandbox", {
    method: "POST",
    headers,
    body,
  });
}

const VALID_PAYLOAD = JSON.stringify({ event_id: "evt_test1", provider_ref: "sbx_test1", status: "approved" });

describe("secreto ausente o vacío ⇒ 503 fail-closed, sin procesar nada", () => {
  it.each([
    ["ausente", undefined],
    ["vacío", ""],
    ["solo espacios", "   "],
  ])("PAYMENT_WEBHOOK_SECRET %s ⇒ 503 y processPaymentWebhook NO se llama", async (_label, value) => {
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", value);
    const spy = vi.spyOn(paymentsService, "processPaymentWebhook");
    const res = await POST(makeRequest(VALID_PAYLOAD, "cualquier-firma"));
    expect(res.status).toBe(503);
    expect(spy).not.toHaveBeenCalled();
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET);
    expect(text.toLowerCase()).not.toContain("sandbox-webhook-secret-demo");
  });

  it("isSandboxWebhookConfigured refleja el estado y signSandboxPayload falla claro sin secreto", () => {
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", undefined);
    expect(isSandboxWebhookConfigured()).toBe(false);
    expect(() => signSandboxPayload("x")).toThrow(/PAYMENT_WEBHOOK_SECRET/);
    try {
      signSandboxPayload("x");
    } catch (e) {
      expect((e as Error).message).not.toContain("sandbox-webhook-secret-demo");
    }
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", SECRET);
    expect(isSandboxWebhookConfigured()).toBe(true);
  });

  it("verifyWebhookSignature es fail-closed sin secreto (ninguna firma es válida)", () => {
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", SECRET);
    const goodSignature = signSandboxPayload(VALID_PAYLOAD); // firmada con el secreto de prueba
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", "");
    const provider = new SandboxPaymentProvider();
    expect(provider.verifyWebhookSignature(VALID_PAYLOAD, goodSignature)).toBe(false);
  });
});

describe("con secreto configurado ⇒ comportamiento existente", () => {
  it("firma inválida ⇒ 401 y processPaymentWebhook NO se llama; el error no filtra el secreto", async () => {
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", SECRET);
    const spy = vi.spyOn(paymentsService, "processPaymentWebhook");
    const res = await POST(makeRequest(VALID_PAYLOAD, "firma-invalida"));
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });

  it("sin cabecera de firma ⇒ 401", async () => {
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", SECRET);
    const res = await POST(makeRequest(VALID_PAYLOAD));
    expect(res.status).toBe(401);
  });

  it("firma válida + payload válido ⇒ pasa a processPaymentWebhook con los datos del evento", async () => {
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", SECRET);
    const spy = vi
      .spyOn(paymentsService, "processPaymentWebhook")
      .mockResolvedValueOnce({ ok: true, duplicate: false });
    const res = await POST(makeRequest(VALID_PAYLOAD, signSandboxPayload(VALID_PAYLOAD)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: false });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "sandbox",
        externalEventId: "evt_test1",
        providerRef: "sbx_test1",
        status: "approved",
      }),
    );
  });

  it("firma válida pero evento no aplicable ⇒ 422 (dedupe/validación existentes intactos)", async () => {
    vi.stubEnv("PAYMENT_WEBHOOK_SECRET", SECRET);
    vi.spyOn(paymentsService, "processPaymentWebhook").mockResolvedValueOnce({
      ok: false,
      message: "Pago no encontrado",
    });
    const res = await POST(makeRequest(VALID_PAYLOAD, signSandboxPayload(VALID_PAYLOAD)));
    expect(res.status).toBe(422);
  });
});
