/**
 * Fiado sin cédula (registro simplificado del mostrador).
 *
 * `enrollInStoreAction` ya NO recibe `documentId`: un cliente nuevo se crea sin
 * documento (null) y uno existente conserva intacto el que ya tuviera (nunca se
 * sobrescribe). El fiado (cuenta de crédito, plan de cuotas y ledger) se sigue
 * creando. Además, guarda de UI a nivel de fuente: el formulario no muestra
 * "Cédula" ni el número de documento y pide solo nombre, celular y monto.
 *
 * Integración: usa la BD de desarrollo (efímera en CI). No usa datos productivos.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { getCreditStatus } from "@/modules/credit/service";

// revalidatePath necesita el contexto de request de Next (inexistente en un
// test node): lo neutralizamos para probar la lógica de la acción.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Sesión/permisos simulados: un owner de prueba pasa requirePermission sin
// depender de cookies ni de una sesión real.
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requirePermission: vi.fn(async () => ({
      id: "usr_test_fiado",
      email: "test@example.invalid",
      fullName: "Owner de prueba",
      role: "owner" as const,
    })),
  };
});

// Importado tras el mock (vi.mock se iza): usa el requirePermission simulado.
import { enrollInStoreAction } from "@/app/actions/fiado";

const PHONE_NEW = "3009991001"; // cliente nuevo → sin cédula
const PHONE_EXISTING = "3009991002"; // cliente preexistente con cédula
const EXISTING_ID = "cus_test_fiado_doc";
const EXISTING_DOC = "12345678";

async function wipeByLast10(last10: string) {
  const cust = sql`(select id from customers where right(regexp_replace(phone,'[^0-9]','','g'),10) = ${last10})`;
  const accts = sql`(select id from credit_accounts where customer_id in ${cust})`;
  await db.execute(sql`delete from credit_ledger where credit_account_id in ${accts}`);
  await db.execute(sql`delete from credit_installments where plan_id in (select id from credit_plans where credit_account_id in ${accts})`);
  await db.execute(sql`delete from credit_plans where credit_account_id in ${accts}`);
  await db.execute(sql`delete from credit_accounts where customer_id in ${cust}`);
  await db.execute(sql`delete from customers where id in ${cust}`);
}

beforeAll(async () => {
  await wipeByLast10(PHONE_NEW.slice(-10));
  await wipeByLast10(PHONE_EXISTING.slice(-10));
  // Cliente preexistente con una cédula ya almacenada.
  await db.insert(customers).values({
    id: EXISTING_ID,
    fullName: "Cliente Existente",
    phone: `57${PHONE_EXISTING}`,
    documentId: EXISTING_DOC,
  });
});

afterAll(async () => {
  await wipeByLast10(PHONE_NEW.slice(-10));
  await wipeByLast10(PHONE_EXISTING.slice(-10));
});

describe("enrollInStoreAction — registro sin cédula", () => {
  it("acepta una solicitud sin cédula y crea el fiado; cliente NUEVO queda con documentId null", async () => {
    const r = await enrollInStoreAction({ phone: PHONE_NEW, fullName: "Cliente Nuevo", amountCop: 50_000 });
    expect(r.ok).toBe(true);

    const c = await db.query.customers.findFirst({
      where: sql`right(regexp_replace(${customers.phone}, '[^0-9]', '', 'g'), 10) = ${PHONE_NEW.slice(-10)}`,
    });
    expect(c).toBeTruthy();
    expect(c!.documentId).toBeNull();

    // Fiado creado: saldo (ledger) y cuotas (plan) funcionando.
    const status = await getCreditStatus(c!.id);
    expect(status?.balance).toBe(50_000);
    expect((status?.pendingInstallments.length ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it("cliente EXISTENTE conserva su documentId (nunca se sobrescribe con null)", async () => {
    const before = await db.query.customers.findFirst({ where: eq(customers.id, EXISTING_ID) });
    expect(before!.documentId).toBe(EXISTING_DOC);

    const r = await enrollInStoreAction({ phone: PHONE_EXISTING, fullName: "Nombre Nuevo Ignorado", amountCop: 30_000 });
    expect(r.ok).toBe(true);

    const after = await db.query.customers.findFirst({ where: eq(customers.id, EXISTING_ID) });
    expect(after!.documentId).toBe(EXISTING_DOC); // intacto

    const status = await getCreditStatus(EXISTING_ID);
    expect(status?.balance).toBe(30_000);
    expect((status?.pendingInstallments.length ?? 0)).toBeGreaterThanOrEqual(1);
  });
});

describe("UI del formulario de Fiado (guarda de fuente)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/admin/fiado/fiado-console.tsx"), "utf8");

  it("no menciona 'Cédula' ni referencia documentId", () => {
    expect(src).not.toMatch(/Cédula/);
    expect(src).not.toContain("documentId");
    expect(src).not.toMatch(/CC \$\{/); // sin "CC {documento}" en la cartera
  });

  it("pide solo nombre, celular y monto", () => {
    expect(src).toContain('placeholder="Nombre completo"');
    expect(src).toContain('placeholder="Celular"');
    expect(src).toContain('placeholder="Monto a fiar"');
  });
});
