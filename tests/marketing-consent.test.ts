/**
 * Opt-out / opt-in de marketing por WhatsApp (palabras clave) y su registro
 * en la tabla `consents` (ledger, el último gana). Usa la BD de desarrollo.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, consents } from "@/db/schema";
import { id } from "@/lib/ids";
import { handleIncomingMessage, marketingKeyword } from "@/modules/assistant/service";
import { getMarketingConsent } from "@/modules/accounts/consent";

const PHONE = "573001110022"; // últimos 10: 3001110022 (único para el test)
let customerId: string;

beforeAll(async () => {
  const existing = await db.query.customers.findFirst({ where: eq(customers.phone, PHONE) });
  customerId = existing?.id ?? id("cus");
  if (!existing) await db.insert(customers).values({ id: customerId, fullName: "OptOut Test", phone: PHONE });
  await db.delete(consents).where(and(eq(consents.customerId, customerId), eq(consents.kind, "marketing_whatsapp")));
});

describe("marketingKeyword", () => {
  it("detecta bajas", () => {
    for (const s of ["STOP", "stop", "¡STOP!", "No más ofertas", "no quiero promociones", "No me manden más", "dar de baja", "baja de ofertas", "cancelar ofertas"]) {
      expect(marketingKeyword(s)).toBe("out");
    }
  });
  it("detecta altas", () => {
    for (const s of ["ALTA de ofertas", "quiero ofertas", "quiero recibir promociones", "suscribirme", "sí quiero ofertas"]) {
      expect(marketingKeyword(s)).toBe("in");
    }
  });
  it("NO se dispara con palabras sueltas ambiguas ni en conversación normal", () => {
    for (const s of ["no", "hola", "baja", "alta", "BAJA", "ALTA", "calidad baja", "quiero 2 panes", "¿tienen leche?", "noooo qué rico", "cancelar mi pedido"]) {
      expect(marketingKeyword(s)).toBeNull();
    }
  });
});

describe("opt-out / opt-in por WhatsApp", () => {
  it("STOP revoca el consentimiento del cliente", async () => {
    const r = await handleIncomingMessage({ phone: PHONE, body: "STOP", deliver: false });
    expect(r.handled).toBe(true);
    expect(await getMarketingConsent(customerId)).toBe(false);
  });
  it("QUIERO OFERTAS reactiva el consentimiento", async () => {
    const r = await handleIncomingMessage({ phone: PHONE, body: "quiero ofertas", deliver: false });
    expect(r.handled).toBe(true);
    expect(await getMarketingConsent(customerId)).toBe(true);
  });
});
