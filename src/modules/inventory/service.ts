import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import {
  inventoryMovements,
  inventoryReservations,
  inventoryLocations,
  inventoryLots,
  productVariants,
  products,
} from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";

/**
 * Inventario por ledger:
 *   stock físico   = Σ inventory_movements.qty
 *   stock reservado = Σ reservas activas
 *   disponible      = físico − reservado
 * Nunca se edita un número final: cualquier corrección es un movimiento
 * de tipo "adjustment" (o "shrinkage") con motivo y autor.
 */

export async function getDefaultLocationId(tx: DbOrTx = db): Promise<string> {
  const loc = await tx.query.inventoryLocations.findFirst({
    where: eq(inventoryLocations.isDefault, true),
  });
  if (!loc) throw new Error("No hay ubicación de inventario por defecto (¿corriste el seed?)");
  return loc.id;
}

export async function getStock(variantId: string, tx: DbOrTx = db) {
  const [physical] = await tx
    .select({ qty: sql<number>`coalesce(sum(${inventoryMovements.qty}), 0)::int` })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.variantId, variantId));
  const [reserved] = await tx
    .select({ qty: sql<number>`coalesce(sum(${inventoryReservations.qty}), 0)::int` })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.variantId, variantId),
        eq(inventoryReservations.status, "active"),
      ),
    );
  const physicalQty = physical?.qty ?? 0;
  const reservedQty = reserved?.qty ?? 0;
  return { physical: physicalQty, reserved: reservedQty, available: physicalQty - reservedQty };
}

/**
 * Reserva stock para un pedido. Lanza si no hay disponible.
 * Se ejecuta dentro de la transacción del checkout con lock por variante
 * (SELECT ... FOR UPDATE sobre la variante) para evitar sobreventa concurrente.
 */
export async function reserveStock(
  tx: DbOrTx,
  params: { variantId: string; orderId: string; qty: number },
): Promise<void> {
  if (params.qty <= 0 || !Number.isInteger(params.qty)) {
    throw new Error("Cantidad de reserva inválida");
  }
  // Lock pesimista sobre la variante: serializa reservas concurrentes del mismo producto.
  await tx.execute(
    sql`SELECT id FROM product_variants WHERE id = ${params.variantId} FOR UPDATE`,
  );
  const stock = await getStock(params.variantId, tx);
  if (stock.available < params.qty) {
    const variant = await tx.query.productVariants.findFirst({
      where: eq(productVariants.id, params.variantId),
    });
    throw new InsufficientStockError(variant?.name ?? params.variantId, stock.available, params.qty);
  }
  await tx.insert(inventoryReservations).values({
    id: id("rsv"),
    variantId: params.variantId,
    orderId: params.orderId,
    qty: params.qty,
  });
}

export class InsufficientStockError extends Error {
  constructor(
    public variantName: string,
    public available: number,
    public requested: number,
  ) {
    super(`Stock insuficiente para ${variantName}: disponible ${available}, solicitado ${requested}`);
    this.name = "InsufficientStockError";
  }
}

/** Libera las reservas de un pedido (cancelación / fallo de pago). */
export async function releaseReservations(tx: DbOrTx, orderId: string): Promise<void> {
  await tx
    .update(inventoryReservations)
    .set({ status: "released", resolvedAt: new Date() })
    .where(
      and(
        eq(inventoryReservations.orderId, orderId),
        eq(inventoryReservations.status, "active"),
      ),
    );
}

/**
 * Consume stock por FEFO (First-Expired-First-Out): descuenta primero de los
 * lotes activos con vencimiento más próximo (`qty_remaining`), enlazando cada
 * movimiento a su lote. Si la variante no tiene lotes registrados (la
 * mayoría de productos no perecederos) o los lotes no alcanzan a cubrir la
 * cantidad, el remanente cae a un movimiento sin lote — comportamiento
 * idéntico al de antes de existir lotes.
 */
async function consumeByFefo(
  tx: DbOrTx,
  params: {
    variantId: string;
    locationId: string;
    qty: number;
    type: "sale" | "shrinkage" | "adjustment";
    reason?: string;
    referenceType: string;
    referenceId: string;
    createdBy: string;
  },
): Promise<void> {
  let remaining = params.qty;
  const lots = await tx.query.inventoryLots.findMany({
    where: and(eq(inventoryLots.variantId, params.variantId), sql`${inventoryLots.qtyRemaining} > 0`),
    orderBy: [sql`${inventoryLots.expiresAt} asc nulls last`],
  });
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qtyRemaining, remaining);
    await tx
      .update(inventoryLots)
      .set({ qtyRemaining: lot.qtyRemaining - take })
      .where(eq(inventoryLots.id, lot.id));
    await tx.insert(inventoryMovements).values({
      id: id("mov"),
      variantId: params.variantId,
      locationId: params.locationId,
      lotId: lot.id,
      type: params.type,
      qty: -take,
      reason: params.reason ?? null,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      createdBy: params.createdBy,
    });
    remaining -= take;
  }
  if (remaining > 0) {
    await tx.insert(inventoryMovements).values({
      id: id("mov"),
      variantId: params.variantId,
      locationId: params.locationId,
      lotId: null,
      type: params.type,
      qty: -remaining,
      reason: params.reason ?? null,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      createdBy: params.createdBy,
    });
  }
}

/**
 * Consume las reservas al entregar: marca consumed y descuenta del ledger
 * (por FEFO si la variante tiene lotes) con movimientos de tipo "sale".
 */
export async function consumeReservations(
  tx: DbOrTx,
  orderId: string,
  actorLabel: string,
): Promise<void> {
  const reservations = await tx.query.inventoryReservations.findMany({
    where: and(
      eq(inventoryReservations.orderId, orderId),
      eq(inventoryReservations.status, "active"),
    ),
  });
  const locationId = await getDefaultLocationId(tx);
  for (const rsv of reservations) {
    await tx
      .update(inventoryReservations)
      .set({ status: "consumed", resolvedAt: new Date() })
      .where(eq(inventoryReservations.id, rsv.id));
    await consumeByFefo(tx, {
      variantId: rsv.variantId,
      locationId,
      qty: rsv.qty,
      type: "sale",
      referenceType: "order",
      referenceId: orderId,
      createdBy: actorLabel,
    });
  }
}

/**
 * Registra la recepción de mercancía CON lote (perecederos): crea el lote y
 * el movimiento `purchase_receipt` que lo respalda. El inventario aumenta
 * solo aquí, igual que cualquier otra entrada — nunca se edita a mano.
 */
export async function receiveLot(params: {
  variantId: string;
  qty: number;
  lotCode?: string | null;
  expiresAt?: Date | null;
  reason?: string;
  actor: { userId?: string; label: string };
}): Promise<{ lotId: string }> {
  if (!Number.isInteger(params.qty) || params.qty <= 0) {
    throw new Error("La cantidad recibida debe ser un entero positivo");
  }
  return db.transaction(async (tx) => {
    const locationId = await getDefaultLocationId(tx);
    const lotId = id("lot");
    await tx.insert(inventoryLots).values({
      id: lotId,
      variantId: params.variantId,
      locationId,
      lotCode: params.lotCode ?? null,
      expiresAt: params.expiresAt ?? null,
      qtyReceived: params.qty,
      qtyRemaining: params.qty,
    });
    await tx.insert(inventoryMovements).values({
      id: id("mov"),
      variantId: params.variantId,
      locationId,
      lotId,
      type: "purchase_receipt",
      qty: params.qty,
      reason: params.reason ?? "Recepción de mercancía con lote",
      referenceType: "manual",
      referenceId: lotId,
      createdBy: params.actor.label,
    });
    await recordAudit(tx, {
      action: "inventory.receive_lot",
      entityType: "inventory_lot",
      entityId: lotId,
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      after: {
        variantId: params.variantId,
        qty: params.qty,
        lotCode: params.lotCode ?? null,
        expiresAt: params.expiresAt?.toISOString() ?? null,
      },
    });
    return { lotId };
  });
}

/**
 * Da de baja TODA la existencia remanente de un lote específico (vencido o
 * dañado) como merma auditada. A diferencia del consumo por venta, aquí el
 * lote lo elige el operador (no el orden de vencimiento) porque es
 * precisamente ESE lote el que se está inspeccionando.
 */
export async function discardExpiredLot(params: {
  lotId: string;
  reason: string;
  actor: { userId?: string; label: string };
}): Promise<void> {
  if (!params.reason.trim()) throw new Error("Todo descarte de lote requiere un motivo");
  await db.transaction(async (tx) => {
    const lot = await tx.query.inventoryLots.findFirst({ where: eq(inventoryLots.id, params.lotId) });
    if (!lot) throw new Error("Lote no encontrado");
    if (lot.qtyRemaining <= 0) throw new Error("El lote ya no tiene existencia por dar de baja");
    const qty = lot.qtyRemaining;
    await tx.update(inventoryLots).set({ qtyRemaining: 0 }).where(eq(inventoryLots.id, lot.id));
    await tx.insert(inventoryMovements).values({
      id: id("mov"),
      variantId: lot.variantId,
      locationId: lot.locationId,
      lotId: lot.id,
      type: "shrinkage",
      qty: -qty,
      reason: params.reason,
      referenceType: "manual",
      referenceId: lot.id,
      createdBy: params.actor.label,
    });
    await recordAudit(tx, {
      action: "inventory.discard_lot",
      entityType: "inventory_lot",
      entityId: lot.id,
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      before: { qtyRemaining: qty },
      after: { qtyRemaining: 0, reason: params.reason },
    });
  });
}

/** Lotes con existencia y vencimiento dentro de N días (o ya vencidos) — alerta del dashboard. */
export async function listExpiringLots(withinDays = 5) {
  const threshold = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
  return db
    .select({
      lotId: inventoryLots.id,
      variantId: inventoryLots.variantId,
      productName: products.name,
      variantName: productVariants.name,
      lotCode: inventoryLots.lotCode,
      expiresAt: inventoryLots.expiresAt,
      qtyRemaining: inventoryLots.qtyRemaining,
    })
    .from(inventoryLots)
    .innerJoin(productVariants, eq(inventoryLots.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(
      and(
        sql`${inventoryLots.qtyRemaining} > 0`,
        sql`${inventoryLots.expiresAt} is not null`,
        sql`${inventoryLots.expiresAt} <= ${threshold}`,
      ),
    )
    .orderBy(sql`${inventoryLots.expiresAt} asc`);
}

/** Ajuste manual auditado (conteo físico, merma, corrección). */
export async function adjustStock(params: {
  variantId: string;
  qtyDelta: number;
  type: "adjustment" | "shrinkage" | "initial" | "return_in";
  reason: string;
  actor: { userId?: string; label: string };
}): Promise<void> {
  if (!Number.isInteger(params.qtyDelta) || params.qtyDelta === 0) {
    throw new Error("El ajuste debe ser un entero distinto de cero");
  }
  if (!params.reason.trim()) throw new Error("Todo ajuste requiere un motivo");
  await db.transaction(async (tx) => {
    const locationId = await getDefaultLocationId(tx);
    const before = await getStock(params.variantId, tx);
    // Salidas (merma, o ajuste negativo por conteo físico) se descuentan por
    // FEFO si la variante tiene lotes — así `qty_remaining` no se desincroniza
    // del ledger. Entradas (adjustment positivo, initial, return_in) no
    // tocan lotes: no traen fecha de vencimiento propia (para eso existe
    // `receiveLot`).
    if (params.qtyDelta < 0 && (params.type === "adjustment" || params.type === "shrinkage")) {
      await consumeByFefo(tx, {
        variantId: params.variantId,
        locationId,
        qty: -params.qtyDelta,
        type: params.type,
        reason: params.reason,
        referenceType: "manual",
        referenceId: params.variantId,
        createdBy: params.actor.label,
      });
    } else {
      await tx.insert(inventoryMovements).values({
        id: id("mov"),
        variantId: params.variantId,
        locationId,
        type: params.type,
        qty: params.qtyDelta,
        reason: params.reason,
        referenceType: "manual",
        createdBy: params.actor.label,
      });
    }
    await recordAudit(tx, {
      action: "inventory.adjust",
      entityType: "product_variant",
      entityId: params.variantId,
      actorUserId: params.actor.userId,
      actorLabel: params.actor.label,
      before: { physical: before.physical },
      after: { physical: before.physical + params.qtyDelta, reason: params.reason },
    });
  });
}
