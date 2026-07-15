"use server";

/**
 * Server actions de la ESTACIÓN de balanza/escáner.
 *  - Búsqueda/consulta de producto: permiso `inventory.view`.
 *  - Entrada de mercancía: permiso `inventory.receive`.
 *  - Salida de inventario: permiso `inventory.adjust`.
 *
 * La base de datos es la fuente de verdad: nada de precio, stock, unidad, rol ni
 * actor se toma del cliente. Las VENTAS no se registran aquí (van por Caja).
 * Los errores inesperados se devuelven genéricos (no se filtra SQL/Drizzle/stack).
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { InsufficientStockError } from "@/modules/inventory/service";
import {
  recordStationMovement,
  StationError,
  type StationMovementResult,
} from "@/modules/inventory/weigh-station";
import {
  lookupStationItemByCode,
  searchStationItems,
  type StationItem,
} from "@/modules/inventory/weigh-station-queries";

export type LookupResult =
  | { ok: true; item: StationItem }
  | { ok: false; message: string };

export type SearchResult =
  | { ok: true; items: StationItem[] }
  | { ok: false; message: string };

export type MovementActionResult =
  | { ok: true; result: StationMovementResult }
  | { ok: false; message: string };

const GENERIC_ERROR = "No se pudo completar la operación. Intenta nuevamente.";

/** Mensaje seguro: específico solo para errores conocidos; genérico para el resto. */
function toSafeMessage(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Datos inválidos";
  if (e instanceof StationError || e instanceof InsufficientStockError) return e.message;
  // Error de permisos (requirePermission lanza un Error con este prefijo conocido).
  if (e instanceof Error && e.message.startsWith("No autorizado")) return e.message;
  return GENERIC_ERROR;
}

/** Resuelve un código exacto (barcode o SKU). */
export async function stationLookupAction(code: string): Promise<LookupResult> {
  try {
    await requirePermission("inventory.view");
    const clean = z.string().min(1).max(64).parse(code.trim());
    const item = await lookupStationItemByCode(clean);
    if (!item) return { ok: false, message: `Producto no encontrado para el código ${clean}.` };
    return { ok: true, item };
  } catch (e) {
    return { ok: false, message: toSafeMessage(e) };
  }
}

/** Búsqueda por nombre/variante/SKU/barcode. */
export async function stationSearchAction(query: string): Promise<SearchResult> {
  try {
    await requirePermission("inventory.view");
    const clean = z.string().min(2).max(60).parse(query.trim());
    const items = await searchStationItems(clean);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, message: toSafeMessage(e) };
  }
}

const movementSchema = z.object({
  variantId: z.string().min(1),
  direction: z.enum(["in", "out"]),
  quantityMinor: z.number().int().positive(),
  source: z.enum(["manual", "simulated", "web_serial", "web_usb", "local_bridge"]),
  reasonCode: z.string().min(1).max(40),
  note: z.string().max(400).optional(),
  lotCode: z.string().max(60).optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").optional(),
  supplierReference: z.string().max(80).optional(),
  pieceCount: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(8).max(80),
});

/** Registra una entrada o salida de inventario desde la estación (idempotente). */
export async function stationMovementAction(
  input: z.input<typeof movementSchema>,
): Promise<MovementActionResult> {
  try {
    const data = movementSchema.parse(input);
    // Entrada exige inventory.receive; salida exige inventory.adjust.
    const user = await requirePermission(data.direction === "in" ? "inventory.receive" : "inventory.adjust");
    const result = await recordStationMovement({
      variantId: data.variantId,
      direction: data.direction,
      quantityMinor: data.quantityMinor,
      source: data.source,
      reasonCode: data.reasonCode,
      note: data.note || null,
      lotCode: data.lotCode || null,
      expiresAt: data.expiresAt ? new Date(`${data.expiresAt}T00:00:00`) : null,
      supplierReference: data.supplierReference || null,
      pieceCount: data.pieceCount ?? null,
      idempotencyKey: data.idempotencyKey,
      actor: { userId: user.id, label: `${user.role}:${user.email}` },
    });
    revalidatePath("/admin");
    revalidatePath("/admin/inventario");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: toSafeMessage(e) };
  }
}
