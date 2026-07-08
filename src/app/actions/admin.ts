"use server";

import { revalidatePath } from "next/cache";
import { and, eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  products,
  productVariants,
  productImages,
  prices,
  categories,
  inventoryMovements,
  orders,
} from "@/db/schema";
import { id } from "@/lib/ids";
import { skuPrefix, nextSku } from "@/lib/sku";
import { recordAudit } from "@/lib/audit";
import { getDefaultLocationId } from "@/modules/inventory/service";
import { requirePermission } from "@/lib/auth/session";
import { transitionOrder, type OrderStatus } from "@/modules/orders/state";
import { recordActualWeight } from "@/modules/orders/weight";
import { assignDriver } from "@/modules/delivery/service";
import { adjustStock, receiveLot, discardExpiredLot } from "@/modules/inventory/service";
import { CsvPosAdapter } from "@/modules/pos/csv-adapter";
import { notifyOrderEvent } from "@/modules/messaging/service";

type ActionResult = { ok: true } | { ok: false; message: string };

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
}

/**
 * «Recibir pedido»: el personal confirma que VIO el pedido nuevo. Detiene la
 * alarma del panel y queda auditado quién lo recibió y cuándo. No cambia el
 * estado del pedido (eso sigue en la máquina de estados).
 */
export async function acknowledgeOrderAction(orderId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("orders.manage");
    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!order) return { ok: false, message: "Pedido no encontrado" };
    if (order.acknowledgedAt) return { ok: true }; // idempotente: ya recibido
    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({ acknowledgedAt: new Date(), acknowledgedBy: `${user.role}:${user.email}` })
        .where(eq(orders.id, orderId));
      await recordAudit(tx, {
        action: "order.acknowledge",
        entityType: "order",
        entityId: orderId,
        actorUserId: user.id,
        actorLabel: `${user.role}:${user.email}`,
        after: { number: order.number },
      });
    });
    revalidatePath("/admin/pedidos");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function adminTransitionOrder(
  orderId: string,
  to: OrderStatus,
  reason?: string,
): Promise<ActionResult> {
  try {
    const user = await requirePermission(to === "cancelled" ? "orders.cancel" : "orders.manage");
    await db.transaction(async (tx) => {
      await transitionOrder(tx, {
        orderId,
        to,
        actorUserId: user.id,
        actorLabel: `${user.role}:${user.email}`,
        reason: reason ?? "Cambio manual desde el panel",
      });
      if (to === "preparing") await notifyOrderEvent(tx, orderId, "preparing");
      if (to === "ready") await notifyOrderEvent(tx, orderId, "ready");
    });
    revalidatePath(`/admin/pedidos/${orderId}`);
    revalidatePath("/admin/pedidos");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function adminRecordWeight(orderItemId: string, actualWeightG: number): Promise<ActionResult> {
  try {
    const user = await requirePermission("orders.adjust_weight");
    const result = await recordActualWeight({
      orderItemId,
      actualWeightG,
      actor: { userId: user.id, label: `${user.role}:${user.email}` },
    });
    revalidatePath("/admin/pedidos");
    return { ok: true, ...result };
  } catch (e) {
    return fail(e);
  }
}

export async function adminAssignDriver(orderId: string, driverId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("delivery.manage");
    await assignDriver({ orderId, driverId, actor: { userId: user.id, label: `${user.role}:${user.email}` } });
    revalidatePath(`/admin/pedidos/${orderId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function adminAdjustStock(
  variantId: string,
  qtyDelta: number,
  type: "adjustment" | "shrinkage" | "return_in",
  reason: string,
): Promise<ActionResult> {
  try {
    const user = await requirePermission("inventory.adjust");
    await adjustStock({ variantId, qtyDelta, type, reason, actor: { userId: user.id, label: `${user.role}:${user.email}` } });
    revalidatePath("/admin/inventario");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const receiveLotSchema = z.object({
  variantId: z.string().min(1),
  qty: z.number().int().positive(),
  lotCode: z.string().max(60).optional(),
  expiresAt: z.string().optional(), // "YYYY-MM-DD" del <input type="date">
});

/** Recibe mercancía CON lote/vencimiento (perecederos: embutidos, quesos...). */
export async function adminReceiveLot(input: {
  variantId: string;
  qty: number;
  lotCode?: string;
  expiresAt?: string;
}): Promise<ActionResult> {
  try {
    const user = await requirePermission("inventory.receive");
    const data = receiveLotSchema.parse(input);
    await receiveLot({
      variantId: data.variantId,
      qty: data.qty,
      lotCode: data.lotCode || null,
      expiresAt: data.expiresAt ? new Date(`${data.expiresAt}T00:00:00`) : null,
      actor: { userId: user.id, label: `${user.role}:${user.email}` },
    });
    revalidatePath("/admin/inventario");
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Datos inválidos" };
    return fail(e);
  }
}

/** Da de baja un lote vencido/dañado como merma auditada. */
export async function adminDiscardLot(lotId: string, reason: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("inventory.adjust");
    await discardExpiredLot({ lotId, reason, actor: { userId: user.id, label: `${user.role}:${user.email}` } });
    revalidatePath("/admin/inventario");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const createProductSchema = z.object({
  name: z.string().min(2, "Nombre requerido").max(120),
  categoryId: z.string().min(1, "Elige una categoría"),
  brand: z.string().max(60).optional(),
  description: z.string().max(500).optional(),
  variantName: z.string().max(60).optional(),
  /** unidad | paquete | libra (peso variable) */
  saleType: z.enum(["unit", "pack", "libra"]),
  /** Precio en COP: por unidad/paquete, o POR LIBRA si saleType = libra. */
  priceCop: z.number().int().positive("Precio inválido"),
  compareAtCop: z.number().int().positive().optional(),
  costCop: z.number().int().positive().optional(),
  sku: z.string().max(40).optional(),
  barcode: z.string().max(40).optional(),
  /** Stock inicial: unidades, o LIBRAS si saleType = libra. */
  initialStock: z.number().int().min(0),
  restricted: z.enum(["none", "liquor", "cigarettes"]),
  isPerishable: z.boolean().default(false),
  /** Foto como data-URI (JPEG redimensionado en el navegador), opcional. */
  photoDataUrl: z.string().startsWith("data:image/").max(1_500_000).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Alta manual de producto desde el panel (alternativa a la importación CSV).
 * Peso variable: el precio se captura POR LIBRA y se almacena por kilo (×2);
 * el stock se captura en libras y se almacena en gramos (×500).
 */
export async function adminCreateProduct(
  input: CreateProductInput,
): Promise<{ ok: true; slug: string } | { ok: false; message: string }> {
  try {
    const user = await requirePermission("catalog.manage");
    const data = createProductSchema.parse(input);

    const isWeight = data.saleType === "libra";
    const priceCop = isWeight ? data.priceCop * 2 : data.priceCop;
    const compareAtCop = data.compareAtCop ? (isWeight ? data.compareAtCop * 2 : data.compareAtCop) : null;
    const costCop = data.costCop ? (isWeight ? data.costCop * 2 : data.costCop) : null;
    const stockQty = isWeight ? data.initialStock * 500 : data.initialStock;

    const result = await db.transaction(async (tx) => {
      const category = await tx.query.categories.findFirst({
        where: eq(categories.id, data.categoryId),
      });
      if (!category) throw new Error("Categoría no encontrada");

      if (data.barcode) {
        const existing = await tx.query.productVariants.findFirst({
          where: eq(productVariants.barcode, data.barcode),
        });
        if (existing) {
          throw new Error(`Ya existe un producto con el código de barras ${data.barcode}`);
        }
      }

      // Slug único (añade sufijo si el nombre ya existe)
      const base = slugify(data.name) || "producto";
      let slug = base;
      for (let n = 2; ; n++) {
        const taken = await tx.query.products.findFirst({ where: eq(products.slug, slug) });
        if (!taken) break;
        slug = `${base}-${n}`;
      }

      const productId = id("prd");
      await tx.insert(products).values({
        id: productId,
        slug,
        name: data.name,
        description: data.description || null,
        categoryId: data.categoryId,
        brand: data.brand || null,
        isRestricted: data.restricted !== "none",
        restrictedRuleKey: data.restricted === "none" ? null : data.restricted,
      });

      await tx.insert(productImages).values({
        id: id("img"),
        productId,
        url: data.photoDataUrl ?? `/images/cat/${category.slug}.svg`,
        alt: data.name,
      });

      // SKU: si el campo llega vacío se genera el siguiente consecutivo de la
      // categoría (mismo formato del catálogo Treinta: ABA-001, ASE-014, …).
      let sku = data.sku || null;
      if (!sku) {
        const prefix = skuPrefix(category.name);
        const [row] = await tx
          .select({ max: sql<number | null>`max((substring(${productVariants.sku} from '[0-9]+$'))::int)` })
          .from(productVariants)
          .where(like(productVariants.sku, `${prefix}-%`));
        sku = nextSku(prefix, Number(row?.max ?? 0));
      }

      const variantId = id("var");
      await tx.insert(productVariants).values({
        id: variantId,
        productId,
        name: data.variantName || (isWeight ? "Por libra" : "Unidad"),
        sku,
        barcode: data.barcode || null,
        saleUnit: isWeight ? "kg" : data.saleType === "pack" ? "pack" : "unit",
        soldByWeight: isWeight,
        priceCop,
        compareAtCop,
        costCop,
        isPerishable: data.isPerishable,
      });
      await tx.insert(prices).values({ id: id("pri"), variantId, priceCop, createdBy: user.email });

      if (stockQty > 0) {
        await tx.insert(inventoryMovements).values({
          id: id("mov"),
          variantId,
          locationId: await getDefaultLocationId(tx),
          type: "initial",
          qty: stockQty,
          reason: "Alta manual desde el panel",
          referenceType: "manual",
          createdBy: user.email,
        });
      }

      await recordAudit(tx, {
        action: "catalog.product_created",
        entityType: "product",
        entityId: productId,
        actorUserId: user.id,
        actorLabel: `${user.role}:${user.email}`,
        after: { name: data.name, slug, priceCop, saleType: data.saleType, initialStock: data.initialStock },
      });

      return { slug };
    });

    revalidatePath("/admin/productos");
    revalidatePath("/");
    return { ok: true, slug: result.slug };
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, message: e.issues[0]?.message ?? "Datos inválidos" };
    }
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

const updateProductSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  name: z.string().min(2, "Nombre requerido").max(120),
  categoryId: z.string().min(1, "Elige una categoría"),
  brand: z.string().max(60).optional(),
  description: z.string().max(500).optional(),
  variantName: z.string().max(60).optional(),
  /** Precio en COP: por unidad/paquete, o POR LIBRA si la variante es por peso. */
  priceCop: z.number().int().positive("Precio inválido"),
  compareAtCop: z.number().int().positive().optional(),
  costCop: z.number().int().positive().optional(),
  sku: z.string().max(40).optional(),
  barcode: z.string().max(40).optional(),
  restricted: z.enum(["none", "liquor", "cigarettes"]),
  isPerishable: z.boolean().default(false),
  isActive: z.boolean().default(true),
  /** Nueva foto opcional (data-URI); si viene, reemplaza la imagen principal. */
  photoDataUrl: z.string().startsWith("data:image/").max(1_500_000).optional(),
  /** Eliminar la foto actual y volver al ícono de la categoría. */
  removePhoto: z.boolean().optional(),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/**
 * Edición de un producto y su variante principal desde el panel. El precio se
 * captura POR LIBRA para productos por peso y se almacena por kilo (×2), igual
 * que en el alta. Cambiar el precio agrega una fila al historial `prices`
 * (nunca se pisa el precio anterior). Todo queda auditado.
 */
export async function adminUpdateProduct(
  input: UpdateProductInput,
): Promise<{ ok: true; slug: string } | { ok: false; message: string }> {
  try {
    const user = await requirePermission("catalog.manage");
    const data = updateProductSchema.parse(input);

    const result = await db.transaction(async (tx) => {
      const product = await tx.query.products.findFirst({ where: eq(products.id, data.productId) });
      if (!product) throw new Error("Producto no encontrado");
      const variant = await tx.query.productVariants.findFirst({ where: eq(productVariants.id, data.variantId) });
      if (!variant || variant.productId !== product.id) throw new Error("Variante no encontrada");

      const isWeight = variant.soldByWeight;
      const priceCop = isWeight ? data.priceCop * 2 : data.priceCop;
      const compareAtCop = data.compareAtCop ? (isWeight ? data.compareAtCop * 2 : data.compareAtCop) : null;
      const costCop = data.costCop ? (isWeight ? data.costCop * 2 : data.costCop) : null;

      // Código de barras duplicado en OTRA variante.
      if (data.barcode) {
        const clash = await tx.query.productVariants.findFirst({
          where: and(eq(productVariants.barcode, data.barcode), sql`${productVariants.id} <> ${variant.id}`),
        });
        if (clash) throw new Error(`Otro producto ya usa el código de barras ${data.barcode}`);
      }

      await tx
        .update(products)
        .set({
          name: data.name,
          description: data.description || null,
          categoryId: data.categoryId,
          brand: data.brand || null,
          isRestricted: data.restricted !== "none",
          restrictedRuleKey: data.restricted === "none" ? null : data.restricted,
          isActive: data.isActive,
        })
        .where(eq(products.id, product.id));

      await tx
        .update(productVariants)
        .set({
          name: data.variantName || variant.name,
          sku: data.sku || variant.sku,
          barcode: data.barcode || null,
          priceCop,
          compareAtCop,
          costCop,
          isPerishable: data.isPerishable,
          isActive: data.isActive,
        })
        .where(eq(productVariants.id, variant.id));

      // Historial de precios inmutable: solo si cambió.
      if (priceCop !== variant.priceCop) {
        await tx.insert(prices).values({ id: id("pri"), variantId: variant.id, priceCop, createdBy: user.email });
      }

      // Foto nueva: reemplaza la principal (borra la anterior de esa posición).
      if (data.photoDataUrl) {
        await tx.delete(productImages).where(eq(productImages.productId, product.id));
        await tx.insert(productImages).values({
          id: id("img"),
          productId: product.id,
          url: data.photoDataUrl,
          alt: data.name,
          sortOrder: 0,
        });
      } else if (data.removePhoto) {
        // Eliminar la foto actual: vuelve al ícono de la categoría (fallback
        // que usa toda la app), como un producto sin foto propia.
        const category = await tx.query.categories.findFirst({ where: eq(categories.id, data.categoryId) });
        await tx.delete(productImages).where(eq(productImages.productId, product.id));
        await tx.insert(productImages).values({
          id: id("img"),
          productId: product.id,
          url: `/images/cat/${category?.slug ?? "otros"}.svg`,
          alt: data.name,
          sortOrder: 0,
        });
      }

      await recordAudit(tx, {
        action: "catalog.product_updated",
        entityType: "product",
        entityId: product.id,
        actorUserId: user.id,
        actorLabel: `${user.role}:${user.email}`,
        before: { name: product.name, priceCop: variant.priceCop, isActive: product.isActive },
        after: { name: data.name, priceCop, isActive: data.isActive },
      });

      return { slug: product.slug };
    });

    revalidatePath("/admin/productos");
    revalidatePath("/admin/inventario");
    revalidatePath(`/producto/${result.slug}`);
    revalidatePath("/");
    return { ok: true, slug: result.slug };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Datos inválidos" };
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}

/** Activa/desactiva un producto (y su variante) rápido desde la lista. */
export async function adminSetProductActive(productId: string, active: boolean): Promise<ActionResult> {
  try {
    const user = await requirePermission("catalog.manage");
    await db.transaction(async (tx) => {
      const product = await tx.query.products.findFirst({ where: eq(products.id, productId) });
      if (!product) throw new Error("Producto no encontrado");
      await tx.update(products).set({ isActive: active }).where(eq(products.id, productId));
      await tx.update(productVariants).set({ isActive: active }).where(eq(productVariants.productId, productId));
      await recordAudit(tx, {
        action: active ? "catalog.product_activated" : "catalog.product_deactivated",
        entityType: "product",
        entityId: productId,
        actorUserId: user.id,
        actorLabel: `${user.role}:${user.email}`,
        after: { isActive: active },
      });
    });
    revalidatePath("/admin/productos");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function adminImportCsv(formData: FormData): Promise<
  ActionResult | { ok: true; imported: number; updated: number; errors: { row: number; message: string }[] }
> {
  try {
    await requirePermission("pos.sync");
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, message: "Selecciona un archivo CSV" };
    if (file.size > 5 * 1024 * 1024) return { ok: false, message: "El archivo supera 5 MB" };
    const text = await file.text();
    const adapter = new CsvPosAdapter();
    const result = await adapter.importProducts(text);
    revalidatePath("/admin/inventario");
    return { ok: true, ...result };
  } catch (e) {
    return fail(e);
  }
}
