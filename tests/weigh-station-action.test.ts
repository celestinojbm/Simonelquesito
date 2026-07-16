/**
 * Server actions de la estación: gateo de permisos (entrada→inventory.receive,
 * salida→inventory.adjust, consulta→inventory.view), guard de "venta" (va por
 * Caja) y validación. BD efímera; requirePermission y next/cache simulados.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, productVariants, products } from "@/db/schema";
import type { Role } from "@/lib/auth/permissions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: vi.fn() }));

import { requirePermission } from "@/lib/auth/session";
import {
  stationMovementAction,
  stationLookupAction,
} from "@/app/actions/weigh-station";

const CAT = "cat_wsa";
const PROD = "prod_wsa";
const VAR = "var_wsa";

/** Configura qué permisos "tiene" el usuario simulado. */
function grant(perms: string[], role: Role = "admin") {
  vi.mocked(requirePermission).mockImplementation(async (perm: string) => {
    if (!perms.includes(perm)) throw new Error(`No autorizado (se requiere ${perm})`);
    return { id: "usr_wsa", email: "wsa@example.invalid", fullName: "WSA", role };
  });
}

async function wipe() {
  await db.execute(sql`delete from inventory_movements where variant_id = ${VAR}`);
  await db.execute(sql`delete from inventory_lots where variant_id = ${VAR}`);
  await db.execute(sql`delete from audit_events where entity_type='product_variant' and entity_id=${VAR}`);
  await db.execute(sql`delete from product_variants where id = ${VAR}`);
  await db.execute(sql`delete from products where id = ${PROD}`);
  await db.execute(sql`delete from categories where id = ${CAT}`);
}

beforeAll(async () => {
  await wipe();
  await db.insert(categories).values({ id: CAT, slug: "wsa", name: "WSA" });
  await db.insert(products).values({ id: PROD, slug: "wsa-prod", name: "Producto WSA", categoryId: CAT });
  await db.insert(productVariants).values({ id: VAR, productId: PROD, name: "Granel", sku: "WSA-1", barcode: "7700000000112", saleUnit: "g", soldByWeight: true, priceCop: 10_000 });
});

afterAll(wipe);

function movInput(over: Record<string, unknown> = {}) {
  return {
    variantId: VAR,
    direction: "in" as const,
    quantityMinor: 1000,
    source: "manual" as const,
    reasonCode: "recepcion",
    idempotencyKey: "wsa-default-key",
    ...over,
  };
}

describe("permisos", () => {
  it("entrada sin inventory.receive se rechaza", async () => {
    grant(["inventory.view", "inventory.adjust"]); // sin receive
    const r = await stationMovementAction(movInput({ idempotencyKey: "perm-in-noreceive" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/inventory\.receive/);
  });

  it("salida sin inventory.adjust se rechaza", async () => {
    grant(["inventory.view", "inventory.receive"]); // sin adjust
    const r = await stationMovementAction(movInput({ direction: "out", reasonCode: "merma", idempotencyKey: "perm-out-noadjust" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/inventory\.adjust/);
  });

  it("consulta sin inventory.view se rechaza", async () => {
    grant([]); // sin nada
    const r = await stationLookupAction("7700000000112");
    expect(r.ok).toBe(false);
  });

  it("usuario autorizado registra la entrada correctamente", async () => {
    grant(["inventory.view", "inventory.receive", "inventory.adjust"]);
    const r = await stationMovementAction(movInput({ quantityMinor: 2500, idempotencyKey: "perm-ok-entrada" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.stockAfter.physical - r.result.stockBefore.physical).toBe(2500);
  });
});

describe("guard de venta y validación", () => {
  it("un motivo 'venta' (inexistente) se rechaza — las ventas van por Caja", async () => {
    grant(["inventory.view", "inventory.receive", "inventory.adjust"]);
    const r = await stationMovementAction(movInput({ direction: "out", reasonCode: "venta", idempotencyKey: "guard-venta" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/motivo/i);
  });

  it("cantidad no positiva se rechaza por validación", async () => {
    grant(["inventory.view", "inventory.receive", "inventory.adjust"]);
    const r = await stationMovementAction(movInput({ quantityMinor: 0, idempotencyKey: "guard-qty" }));
    expect(r.ok).toBe(false);
  });

  it("resolución por código funciona con inventory.view", async () => {
    grant(["inventory.view"]);
    const r = await stationLookupAction("7700000000112");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.variantId).toBe(VAR);
  });
});
