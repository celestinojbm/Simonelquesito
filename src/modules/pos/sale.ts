import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orders,
  orderItems,
  payments,
  products,
  productVariants,
  categories,
  branches,
  inventoryMovements,
} from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { weightLineTotal, assertMoney } from "@/lib/money";
import { getDefaultLocationId, getStock, reserveStock } from "@/modules/inventory/service";
import { transitionOrder } from "@/modules/orders/state";

/**
 * Venta en mostrador (caja de la tienda física): el cajero escanea con la
 * pistola/escáner de mano y pesa en la balanza conectada; aquí se registra
 * como un pedido REAL con canal pos_physical, pagado en el acto y entregado
 * de inmediato — así el inventario, la analítica y la auditoría ven la
 * tienda física con la misma verdad que la tienda en línea.
 *
 * Inventario: si el sistema tiene menos existencia que lo vendido, manda la
 * realidad física (el producto está en la mano del cliente): se registra un
 * ajuste AUDITADO por la diferencia y la venta continúa. La discrepancia
 * queda visible en el ledger para revisarla, nunca se oculta.
 */

export class PosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosError";
  }
}

const METHOD_MAP = {
  cash: "cash_on_delivery",
  card: "card_on_delivery",
  transfer: "bank_transfer",
} as const;

export type PosMethod = keyof typeof METHOD_MAP;

export async function registerPosSale(input: {
  /** qty: unidades para unit/pack; GRAMOS para productos pesados. */
  lines: { variantId: string; qty: number }[];
  method: PosMethod;
  idempotencyKey: string;
  actor: { userId?: string; label: string };
}) {
  if (input.lines.length === 0) throw new PosError("El tiquete está vacío.");
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new PosError("Cantidad inválida en el tiquete.");
  }

  // Idempotencia de todo el tiquete: reintento (doble clic, red) devuelve la
  // misma venta sin duplicar movimientos.
  const prior = await db.query.payments.findFirst({
    where: eq(payments.idempotencyKey, input.idempotencyKey),
  });
  if (prior) {
    const priorOrder = await db.query.orders.findFirst({ where: eq(orders.id, prior.orderId) });
    if (priorOrder) {
      return { orderId: priorOrder.id, number: priorOrder.number, totalCop: priorOrder.totalCop, duplicate: true };
    }
  }

  const variantIds = input.lines.map((l) => l.variantId);
  const rows = await db
    .select({ variant: productVariants, product: products, category: categories })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(sql`${productVariants.id} in ${variantIds}`);
  const byId = new Map(rows.map((r) => [r.variant.id, r]));

  let itemsTotal = 0;
  let hasWeightItems = false;
  let hasRestrictedItems = false;
  const lines = input.lines.map((item) => {
    const row = byId.get(item.variantId);
    if (!row || !row.variant.isActive || !row.product.isActive) {
      throw new PosError("Uno de los productos ya no está activo en el catálogo.");
    }
    const { variant, product, category } = row;
    const byWeight = variant.saleUnit === "kg" || variant.saleUnit === "g" || variant.saleUnit === "l" || variant.saleUnit === "ml";
    const lineTotal = byWeight ? weightLineTotal(variant.priceCop, item.qty) : variant.priceCop * item.qty;
    assertMoney(lineTotal, `línea ${product.name}`);
    itemsTotal += lineTotal;
    hasWeightItems = hasWeightItems || variant.soldByWeight;
    hasRestrictedItems = hasRestrictedItems || product.isRestricted;
    return {
      variantId: variant.id,
      nameSnapshot: `${product.name} — ${variant.name}`,
      saleUnitSnapshot: variant.saleUnit,
      qty: item.qty,
      unitPriceCop: variant.priceCop,
      lineTotalCop: lineTotal,
      note: null,
      isRestricted: product.isRestricted,
      prepArea: category.prepArea,
    };
  });
  assertMoney(itemsTotal, "total del tiquete");

  const branch = await db.query.branches.findFirst({ where: eq(branches.isActive, true) });
  if (!branch) throw new Error("No hay sucursal activa (¿corriste el seed?)");

  return db.transaction(async (tx) => {
    const [seq] = await tx.execute<{ n: string }>(sql`SELECT nextval('order_number_seq') as n`).then((r) => r.rows);
    const number = `MC-${seq!.n}`;
    const orderId = id("ord");

    await tx.insert(orders).values({
      id: orderId,
      number,
      locationToken: crypto.randomUUID().replace(/-/g, ""),
      branchId: branch.id,
      customerId: null,
      channel: "pos_physical",
      status: "new",
      fulfillment: "pickup",
      contactPhone: "",
      contactName: "Venta en mostrador",
      deliverySlot: "asap",
      substitutionPref: "no_substitution",
      hasWeightItems,
      // Restringidos: la verificación de edad la hace el cajero EN PERSONA.
      hasRestrictedItems,
      idCheckRequired: false,
      itemsTotalCop: itemsTotal,
      discountCop: 0,
      deliveryFeeCop: 0,
      totalCop: itemsTotal,
      isEstimatedTotal: false,
      // Venta de mostrador: la creó el propio personal — no debe timbrar.
      acknowledgedAt: new Date(),
      acknowledgedBy: input.actor.label,
    });

    const locationId = await getDefaultLocationId(tx);
    for (const line of lines) {
      await tx.insert(orderItems).values({ id: id("itm"), orderId, ...line });

      // La realidad física manda: si el sistema tiene menos que lo vendido,
      // ajuste auditado por la diferencia antes de reservar.
      const stock = await getStock(line.variantId, tx);
      if (stock.available < line.qty) {
        const delta = line.qty - stock.available;
        await tx.insert(inventoryMovements).values({
          id: id("mov"),
          variantId: line.variantId,
          locationId,
          type: "adjustment",
          qty: delta,
          reason: `Ajuste automático en caja: existencia física confirmada al vender (faltaban ${delta})`,
          referenceType: "order",
          referenceId: orderId,
          createdBy: input.actor.label,
        });
        await recordAudit(tx, {
          action: "inventory.pos_auto_adjust",
          entityType: "product_variant",
          entityId: line.variantId,
          actorUserId: input.actor.userId,
          actorLabel: input.actor.label,
          before: { available: stock.available },
          after: { available: line.qty, delta, orderId },
        });
      }
      await reserveStock(tx, { variantId: line.variantId, orderId, qty: line.qty });
    }

    // Venta inmediata: la cadena completa queda en la línea de tiempo del
    // pedido y "delivered" consume las reservas (descuenta el ledger).
    for (const to of ["confirmed", "preparing", "ready", "delivered"] as const) {
      await transitionOrder(tx, {
        orderId,
        to,
        actorUserId: input.actor.userId,
        actorLabel: input.actor.label,
        reason: "Venta en mostrador (caja)",
      });
    }

    // Pago cobrado en el acto (efectivo / datáfono / transferencia).
    await tx.insert(payments).values({
      id: id("pay"),
      orderId,
      provider: "offline",
      method: METHOD_MAP[input.method],
      amountCop: itemsTotal,
      status: "approved",
      approvedAt: new Date(),
      idempotencyKey: input.idempotencyKey,
      providerRef: id("off"),
      attempts: [{ at: new Date().toISOString(), action: `pos_${input.method}` }],
    });

    await recordAudit(tx, {
      action: "pos.sale",
      entityType: "order",
      entityId: orderId,
      actorUserId: input.actor.userId,
      actorLabel: input.actor.label,
      after: { number, totalCop: itemsTotal, method: input.method, lines: lines.length },
    });

    return { orderId, number, totalCop: itemsTotal, duplicate: false };
  });
}
