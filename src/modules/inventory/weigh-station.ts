/**
 * Servicio de la ESTACIÓN de balanza/escáner: registra entradas y salidas de
 * inventario de forma idempotente, transaccional y auditada, reutilizando el
 * ledger existente (`inventory_movements`), los lotes (`inventory_lots`), el
 * núcleo FEFO (`consumeByFefo`) y la auditoría (`audit_events`). NO cambia el
 * esquema.
 *
 * Garantías:
 *  - Idempotencia por `(reference_type, reference_id)`: `reference_type` codifica
 *    la fuente/estación (`weigh_station_<source>`) y `reference_id` es la clave de
 *    idempotencia del cliente. Un advisory lock transaccional serializa reintentos
 *    concurrentes; un reintento con la misma clave NO crea otro movimiento, ni
 *    duplica lote ni auditoría — devuelve el resultado previo.
 *  - Salida nunca deja stock negativo (valida disponible antes; lock pesimista de
 *    la variante) y consume lotes por FEFO cuando corresponde.
 *  - Entrada con lote/vencimiento crea lote + movimiento en la MISMA transacción.
 *  - Proveedor y número de piezas (sin columna propia) se guardan en la auditoría.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryLots, inventoryMovements, productVariants, products } from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import {
  consumeByFefo,
  getDefaultLocationId,
  getStock,
  InsufficientStockError,
} from "./service";
import { STATION_REASONS, type ReasonMeta, type StationMovementType } from "./station-reasons";

export { STATION_REASONS } from "./station-reasons";

/** Fuentes válidas del peso (coinciden con ScaleSource). */
export type StationSource = "manual" | "simulated" | "web_serial" | "web_usb" | "local_bridge";

const VALID_SOURCES: readonly StationSource[] = [
  "manual",
  "simulated",
  "web_serial",
  "web_usb",
  "local_bridge",
];

/** Prefijo de reference_type por fuente (permite filtrar el historial con LIKE). */
export function stationReferenceType(source: StationSource): string {
  return `weigh_station_${source}`;
}

/** Namespace de advisory lock exclusivo de la estación (distinto de otros locks). */
const STATION_LOCK_NS = 8125;

export class StationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StationError";
  }
}

export type StationMovementInput = {
  variantId: string;
  direction: "in" | "out";
  /** Cantidad en la unidad mínima (gramos / unidades / ml), entero positivo. */
  quantityMinor: number;
  source: StationSource;
  reasonCode: string;
  note?: string | null;
  lotCode?: string | null;
  expiresAt?: Date | null;
  supplierId?: string | null;
  pieceCount?: number | null;
  idempotencyKey: string;
  actor: { userId?: string; label: string };
};

export type StationStock = { physical: number; available: number };

export type StationMovementResult = {
  ok: true;
  duplicate: boolean;
  movementId: string;
  lotId: string | null;
  reasonCode: string;
  type: StationMovementType;
  quantityMinor: number;
  stockBefore: StationStock;
  stockAfter: StationStock;
};

function buildReason(meta: ReasonMeta, input: StationMovementInput): string {
  const parts = [`Estación: ${meta.label}`];
  if (input.note && input.note.trim()) parts.push(input.note.trim());
  return parts.join(" — ").slice(0, 400);
}

/** Registra un movimiento de la estación (entrada o salida) de forma idempotente. */
export async function recordStationMovement(
  input: StationMovementInput,
): Promise<StationMovementResult> {
  const meta = STATION_REASONS[input.reasonCode];
  if (!meta) throw new StationError("Motivo no válido.");
  if (meta.direction !== input.direction) {
    throw new StationError("El motivo no corresponde a la operación elegida.");
  }
  if (!VALID_SOURCES.includes(input.source)) throw new StationError("Fuente de peso no válida.");
  if (!Number.isInteger(input.quantityMinor) || input.quantityMinor <= 0) {
    throw new StationError("La cantidad debe ser un entero mayor que cero.");
  }
  if (input.pieceCount != null && (!Number.isInteger(input.pieceCount) || input.pieceCount < 0)) {
    throw new StationError("El número de piezas debe ser un entero no negativo.");
  }
  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8) throw new StationError("Clave de idempotencia inválida.");

  const referenceType = stationReferenceType(input.source);

  return db.transaction(async (tx): Promise<StationMovementResult> => {
    // Serializa reintentos concurrentes con la MISMA clave (namespaced).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${STATION_LOCK_NS}::int4, hashtext(${`${referenceType}|${key}`})::int4)`,
    );

    // Idempotencia: ¿ya existe un movimiento para esta (fuente, clave)?
    const prior = await tx.query.inventoryMovements.findFirst({
      where: and(
        eq(inventoryMovements.referenceType, referenceType),
        eq(inventoryMovements.referenceId, key),
      ),
    });

    const variant = await tx.query.productVariants.findFirst({
      where: eq(productVariants.id, input.variantId),
    });
    if (!variant) throw new StationError("Producto (variante) no encontrado.");

    if (prior) {
      // Reintento: no reinserta nada; devuelve el estado actual.
      const now = await getStock(input.variantId, tx);
      return {
        ok: true,
        duplicate: true,
        movementId: prior.id,
        lotId: prior.lotId,
        reasonCode: input.reasonCode,
        type: meta.type,
        quantityMinor: input.quantityMinor,
        stockBefore: { physical: now.physical, available: now.available },
        stockAfter: { physical: now.physical, available: now.available },
      };
    }

    const product = await tx.query.products.findFirst({ where: eq(products.id, variant.productId) });
    if (!variant.isActive || !product?.isActive) {
      throw new StationError("El producto está inactivo; actívalo antes de mover inventario.");
    }

    // Lock pesimista de la variante: serializa cambios de stock concurrentes.
    await tx.execute(sql`SELECT id FROM product_variants WHERE id = ${input.variantId} FOR UPDATE`);

    const before = await getStock(input.variantId, tx);
    const locationId = await getDefaultLocationId(tx);
    const reason = buildReason(meta, input);
    const createdBy = input.actor.label;

    let movementId: string;
    let lotId: string | null = null;

    if (input.direction === "in") {
      const wantsLot = !!(input.lotCode?.trim() || input.expiresAt);
      if (wantsLot) {
        lotId = id("lot");
        await tx.insert(inventoryLots).values({
          id: lotId,
          variantId: input.variantId,
          locationId,
          lotCode: input.lotCode?.trim() || null,
          expiresAt: input.expiresAt ?? null,
          qtyReceived: input.quantityMinor,
          qtyRemaining: input.quantityMinor,
        });
      }
      movementId = id("mov");
      await tx.insert(inventoryMovements).values({
        id: movementId,
        variantId: input.variantId,
        locationId,
        lotId,
        type: meta.type,
        qty: input.quantityMinor, // positivo = entrada
        reason,
        referenceType,
        referenceId: key,
        createdBy,
      });
    } else {
      // SALIDA: nunca dejar stock negativo.
      if (before.available < input.quantityMinor) {
        throw new InsufficientStockError(
          variant.name,
          before.available,
          input.quantityMinor,
        );
      }
      // Estrecha el tipo a los válidos de salida (los motivos de entrada nunca
      // llegan aquí por la validación de `direction` de arriba).
      const outType = meta.type;
      if (outType === "purchase_receipt" || outType === "return_in") {
        throw new StationError("Tipo de movimiento inválido para una salida.");
      }
      // Consume por FEFO (núcleo compartido) — inserta movimientos negativos.
      await consumeByFefo(tx, {
        variantId: input.variantId,
        locationId,
        qty: input.quantityMinor,
        type: outType,
        reason,
        referenceType,
        referenceId: key,
        createdBy,
      });
      const inserted = await tx.query.inventoryMovements.findFirst({
        where: and(
          eq(inventoryMovements.referenceType, referenceType),
          eq(inventoryMovements.referenceId, key),
        ),
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      });
      movementId = inserted?.id ?? id("mov");
    }

    const after = await getStock(input.variantId, tx);

    await recordAudit(tx, {
      action: "inventory.station_movement",
      entityType: "product_variant",
      entityId: input.variantId,
      actorUserId: input.actor.userId ?? null,
      actorLabel: input.actor.label,
      before: { physical: before.physical, available: before.available },
      after: {
        physical: after.physical,
        available: after.available,
        direction: input.direction,
        reasonCode: input.reasonCode,
        type: meta.type,
        source: input.source,
        quantityMinor: input.quantityMinor,
        lotCode: input.lotCode?.trim() || null,
        expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
        supplierId: input.supplierId ?? null,
        pieceCount: input.pieceCount ?? null,
        note: input.note?.trim() || null,
        idempotencyKey: key,
      },
    });

    return {
      ok: true,
      duplicate: false,
      movementId,
      lotId,
      reasonCode: input.reasonCode,
      type: meta.type,
      quantityMinor: input.quantityMinor,
      stockBefore: { physical: before.physical, available: before.available },
      stockAfter: { physical: after.physical, available: after.available },
    };
  });
}
