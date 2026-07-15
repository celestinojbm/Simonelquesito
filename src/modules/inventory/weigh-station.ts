/**
 * Servicio de la ESTACIÓN de balanza/escáner: registra entradas y salidas de
 * inventario de forma idempotente, transaccional y auditada, reutilizando el
 * ledger existente (`inventory_movements`), los lotes (`inventory_lots`), el
 * núcleo FEFO (`consumeByFefo`) y la auditoría (`audit_events`). NO cambia el
 * esquema.
 *
 * Garantías:
 *  - Fuentes operativas en este PR (#3A): SOLO `manual` y `simulated` (este
 *    último únicamente cuando el entorno lo habilita explícitamente). Las fuentes
 *    USB (`web_serial`/`web_usb`/`local_bridge`) quedan preparadas en el tipo pero
 *    el servicio las RECHAZA hasta la certificación física (PR #3B).
 *  - Idempotencia por `reference_id` (la clave del cliente) con advisory lock
 *    transaccional. Un reintento con la MISMA clave y los MISMOS datos devuelve
 *    el resultado ORIGINAL (no reconstruido con el input nuevo). Si la clave se
 *    reutiliza con datos distintos, se RECHAZA (detección de conflicto por
 *    fingerprint SHA-256 guardado en la auditoría).
 *  - Salida nunca deja stock negativo (valida disponible + lock pesimista de la
 *    variante) y consume lotes por FEFO cuando corresponde.
 *  - Entrada con lote/vencimiento crea lote + movimiento en la MISMA transacción.
 *  - Proveedor (referencia libre) y número de piezas se guardan en la auditoría.
 */
import { createHash } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, inventoryLots, inventoryMovements, productVariants, products } from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import {
  consumeByFefo,
  getDefaultLocationId,
  getStock,
  InsufficientStockError,
} from "./service";
import { STATION_REASONS, type ReasonMeta } from "./station-reasons";
import { isSimulatedScaleEnabled } from "@/modules/devices/scale/simulated-adapter";

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

/** Fuentes que PUEDEN registrar inventario en PR #3A. */
const OPERATIONAL_SOURCES: ReadonlySet<string> = new Set(["manual", "simulated"]);

type StationMovementType = ReasonMeta["type"];

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
  /** Referencia LIBRE del proveedor (no es un ID relacional). */
  supplierReference?: string | null;
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

/** Fingerprint determinista del request (para detectar reuso de clave con datos distintos). */
function fingerprint(input: StationMovementInput): string {
  const canonical = JSON.stringify({
    v: input.variantId,
    d: input.direction,
    q: input.quantityMinor,
    s: input.source,
    r: input.reasonCode,
    n: (input.note ?? "").trim(),
    l: (input.lotCode ?? "").trim(),
    e: input.expiresAt ? input.expiresAt.toISOString() : null,
    sup: (input.supplierReference ?? "").trim(),
    p: input.pieceCount ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function guardSource(source: StationSource): void {
  if (!VALID_SOURCES.includes(source)) throw new StationError("Fuente de peso no válida.");
  if (!OPERATIONAL_SOURCES.has(source)) {
    throw new StationError("La fuente USB todavía no está habilitada para registrar movimientos.");
  }
  if (source === "simulated" && !isSimulatedScaleEnabled()) {
    throw new StationError("El simulador de balanza no está habilitado en este entorno.");
  }
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
  guardSource(input.source);
  if (!Number.isInteger(input.quantityMinor) || input.quantityMinor <= 0) {
    throw new StationError("La cantidad debe ser un entero mayor que cero.");
  }
  if (input.pieceCount != null && (!Number.isInteger(input.pieceCount) || input.pieceCount < 0)) {
    throw new StationError("El número de piezas debe ser un entero no negativo.");
  }
  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8) throw new StationError("Clave de idempotencia inválida.");

  const referenceType = stationReferenceType(input.source);
  const fp = fingerprint(input);

  return db.transaction(async (tx): Promise<StationMovementResult> => {
    // Serializa reintentos concurrentes con la MISMA clave (namespaced por clave,
    // no por fuente: la clave es la unidad de idempotencia).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${STATION_LOCK_NS}::int4, hashtext(${key})::int4)`);

    // ¿Ya existe un movimiento de estación con esta clave? (cualquier fuente).
    const prior = await tx.query.inventoryMovements.findFirst({
      where: and(
        like(inventoryMovements.referenceType, "weigh_station_%"),
        eq(inventoryMovements.referenceId, key),
      ),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });

    if (prior) {
      // Recupera el evento de auditoría original de esta clave para comparar el
      // fingerprint y devolver el resultado ORIGINAL (no el input nuevo).
      const priorAudit = await tx.query.auditEvents.findFirst({
        where: and(
          eq(auditEvents.action, "inventory.station_movement"),
          sql`${auditEvents.after}->>'idempotencyKey' = ${key}`,
        ),
        orderBy: (a, { asc }) => [asc(a.createdAt)],
      });
      if (!priorAudit) throw new StationError("No se pudo verificar el movimiento previo.");
      const after = (priorAudit.after ?? {}) as Record<string, unknown>;
      const before = (priorAudit.before ?? {}) as Record<string, unknown>;
      if (after.fingerprint !== fp) {
        throw new StationError("La clave de idempotencia ya fue utilizada con otros datos.");
      }
      return {
        ok: true,
        duplicate: true,
        movementId: prior.id,
        lotId: prior.lotId,
        reasonCode: String(after.reasonCode ?? input.reasonCode),
        type: (after.type as StationMovementType) ?? meta.type,
        quantityMinor: Number(after.quantityMinor ?? input.quantityMinor),
        stockBefore: { physical: Number(before.physical ?? 0), available: Number(before.available ?? 0) },
        stockAfter: { physical: Number(after.physical ?? 0), available: Number(after.available ?? 0) },
      };
    }

    const variant = await tx.query.productVariants.findFirst({
      where: eq(productVariants.id, input.variantId),
    });
    if (!variant) throw new StationError("Producto (variante) no encontrado.");
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
        throw new InsufficientStockError(variant.name, before.available, input.quantityMinor);
      }
      const outType = meta.type;
      if (outType === "purchase_receipt" || outType === "return_in") {
        throw new StationError("Tipo de movimiento inválido para una salida.");
      }
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
        supplierReference: input.supplierReference?.trim() || null,
        pieceCount: input.pieceCount ?? null,
        note: input.note?.trim() || null,
        idempotencyKey: key,
        fingerprint: fp,
        movementId,
        lotId,
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
