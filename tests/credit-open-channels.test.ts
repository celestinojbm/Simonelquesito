/**
 * Regresión del servicio COMPARTIDO `openCreditAccount` (este PR lo modifica).
 *
 * - Canal `in_store`: abre el Fiado SIN `documentId` (cédula ya no exigida en
 *   mostrador).
 * - Canal `online`: sigue RECHAZANDO la apertura cuando la verificación de
 *   identidad requerida no está completada (no se debilitó por el cambio del
 *   canal en tienda).
 *
 * Para aislar la verificación de identidad, el test fija temporalmente
 * `credit.rules` exigiendo SOLO identidad en línea y restaura el valor original
 * al terminar. Usa la BD efímera; no toca datos productivos.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { getSetting, setSetting } from "@/modules/config/service";
import { openCreditAccount, getCreditStatus } from "@/modules/credit/service";

// setSetting registra auditoría; no usa revalidatePath, pero neutralizamos
// next/cache por robustez ante cambios futuros.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const CUS_ONLINE = "cus_test_online_noid"; // sin identidad verificada
const CUS_STORE = "cus_test_store_nodoc"; // sin documentId
const ACTOR = { label: "test" };

let originalRules: Awaited<ReturnType<typeof getSetting<"credit.rules">>>;

async function wipe(id: string) {
  await db.execute(sql`delete from credit_ledger where credit_account_id in (select id from credit_accounts where customer_id = ${id})`);
  await db.execute(sql`delete from credit_installments where plan_id in (select cp.id from credit_plans cp join credit_accounts ca on ca.id = cp.credit_account_id where ca.customer_id = ${id})`);
  await db.execute(sql`delete from credit_plans where credit_account_id in (select id from credit_accounts where customer_id = ${id})`);
  await db.execute(sql`delete from credit_accounts where customer_id = ${id}`);
  await db.execute(sql`delete from customers where id = ${id}`);
}

beforeAll(async () => {
  originalRules = await getSetting("credit.rules");
  // Aísla la verificación de identidad en el canal online.
  await setSetting(
    "credit.rules",
    {
      ...originalRules,
      onlineRequirePhoneVerified: false,
      onlineRequireEmailVerified: false,
      onlineRequireIdentityVerified: true,
      minPaidOrdersOnline: 0,
    },
    ACTOR,
  );
  await wipe(CUS_ONLINE);
  await wipe(CUS_STORE);
  // Clientes sin identidad (ageVerifiedAt null) y sin documentId.
  await db.insert(customers).values({ id: CUS_ONLINE, fullName: "Sin Identidad", phone: "573009991003" });
  await db.insert(customers).values({ id: CUS_STORE, fullName: "Sin Documento", phone: "573009991004" });
});

afterAll(async () => {
  await setSetting("credit.rules", originalRules, ACTOR); // restaura reglas
  await wipe(CUS_ONLINE);
  await wipe(CUS_STORE);
});

describe("openCreditAccount — regresión de canales", () => {
  it("online: rechaza la apertura cuando falta la verificación de identidad", async () => {
    await expect(
      openCreditAccount({ customerId: CUS_ONLINE, channel: "online", actor: ACTOR }),
    ).rejects.toThrow(/identidad/i);
    // No se creó ninguna cuenta.
    expect(await getCreditStatus(CUS_ONLINE)).toBeNull();
  });

  it("in_store: abre el Fiado sin documentId", async () => {
    await openCreditAccount({ customerId: CUS_STORE, channel: "in_store", actor: ACTOR });
    const status = await getCreditStatus(CUS_STORE);
    expect(status).toBeTruthy();
    expect(status?.account.channel).toBe("in_store");
    // El cliente sigue sin documento (no se pidió ni se inventó).
    const c = await db.query.customers.findFirst({ where: sql`id = ${CUS_STORE}` });
    expect(c?.documentId ?? null).toBeNull();
  });
});
