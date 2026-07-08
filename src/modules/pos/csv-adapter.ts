import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants, categories, syncJobs, inventoryMovements } from "@/db/schema";
import { id } from "@/lib/ids";
import { getDefaultLocationId, getStock } from "@/modules/inventory/service";
import type { POSProvider, ImportResult, SalesExportRow } from "./provider";

/**
 * Parser CSV mínimo (soporta comillas y comas embebidas).
 * Formato esperado (compatible con el Excel exportable de Treinta):
 *   sku,codigo_barras,nombre,categoria,precio,costo,stock
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export class CsvPosAdapter implements POSProvider {
  readonly name = "csv";

  /**
   * Importa productos desde CSV. Crea o actualiza por SKU/código de barras.
   * El stock del CSV se concilia contra el ledger creando un movimiento de
   * ajuste con la diferencia (nunca se pisa el número directamente).
   * Registra el resultado (y los errores fila a fila) en sync_jobs.
   */
  async importProducts(csvText: string): Promise<ImportResult> {
    const jobId = id("syn");
    await db.insert(syncJobs).values({
      id: jobId,
      kind: "pos_import_products",
      status: "running",
      startedAt: new Date(),
    });

    const rows = parseCsv(csvText);
    const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
    const idx = {
      sku: header.indexOf("sku"),
      barcode: header.indexOf("codigo_barras"),
      name: header.indexOf("nombre"),
      category: header.indexOf("categoria"),
      price: header.indexOf("precio"),
      cost: header.indexOf("costo"),
      stock: header.indexOf("stock"),
    };
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    let updated = 0;

    if (idx.name < 0 || idx.price < 0) {
      errors.push({ row: 0, message: "Cabecera inválida: se requieren columnas 'nombre' y 'precio'" });
    } else {
      for (let r = 1; r < rows.length; r++) {
        const cells = rows[r]!;
        const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
        try {
          const name = get(idx.name);
          const priceRaw = get(idx.price).replace(/[$.\s]/g, "").replace(",", "");
          const price = parseInt(priceRaw, 10);
          if (!name) throw new Error("Nombre vacío");
          if (!Number.isInteger(price) || price <= 0) throw new Error(`Precio inválido: "${get(idx.price)}"`);
          const sku = get(idx.sku) || null;
          const barcode = get(idx.barcode) || null;
          const categoryName = get(idx.category) || "Abarrotes";
          const costRaw = get(idx.cost).replace(/[$.\s]/g, "");
          const cost = costRaw ? parseInt(costRaw, 10) : null;
          const stockRaw = get(idx.stock);
          const stock = stockRaw ? parseInt(stockRaw, 10) : null;

          await db.transaction(async (tx) => {
            // categoría por nombre (crea si no existe)
            const catSlug = slugify(categoryName);
            let category = await tx.query.categories.findFirst({ where: eq(categories.slug, catSlug) });
            if (!category) {
              [category] = await tx
                .insert(categories)
                .values({ id: id("cat"), slug: catSlug, name: categoryName, sortOrder: 99 })
                .returning();
            }

            // variante existente por sku o barcode
            let variant = sku
              ? await tx.query.productVariants.findFirst({ where: eq(productVariants.sku, sku) })
              : barcode
                ? await tx.query.productVariants.findFirst({ where: eq(productVariants.barcode, barcode) })
                : undefined;

            if (variant) {
              await tx
                .update(productVariants)
                .set({ priceCop: price, costCop: cost ?? variant.costCop, barcode: barcode ?? variant.barcode })
                .where(eq(productVariants.id, variant.id));
              updated++;
            } else {
              const slug = slugify(name);
              let product = await tx.query.products.findFirst({ where: eq(products.slug, slug) });
              if (!product) {
                [product] = await tx
                  .insert(products)
                  .values({ id: id("prd"), slug, name, categoryId: category!.id })
                  .returning();
              }
              [variant] = await tx
                .insert(productVariants)
                .values({
                  id: id("var"),
                  productId: product!.id,
                  name: "Unidad",
                  sku,
                  barcode,
                  priceCop: price,
                  costCop: cost,
                })
                .returning();
              imported++;
            }

            // Conciliación de stock vía movimiento de ajuste
            if (stock !== null && Number.isInteger(stock)) {
              const current = await getStock(variant!.id, tx);
              const delta = stock - current.physical;
              if (delta !== 0) {
                await tx.insert(inventoryMovements).values({
                  id: id("mov"),
                  variantId: variant!.id,
                  locationId: await getDefaultLocationId(tx),
                  type: "adjustment",
                  qty: delta,
                  reason: "Conciliación importación POS (CSV)",
                  referenceType: "sync",
                  referenceId: jobId,
                  createdBy: "pos_import",
                });
              }
            }
          });
        } catch (e) {
          errors.push({ row: r + 1, message: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    await db
      .update(syncJobs)
      .set({
        status: errors.length === 0 ? "completed" : "completed_with_errors",
        summary: { imported, updated, totalRows: rows.length - 1 },
        errors,
        finishedAt: new Date(),
      })
      .where(eq(syncJobs.id, jobId));

    return { imported, updated, errors };
  }

  /** Exporta ventas digitales como CSV para registrar/conciliar en Treinta. */
  async exportSales(rows: SalesExportRow[]): Promise<string> {
    const header = "numero,fecha,canal,estado,subtotal,envio,total,metodo_pago";
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = rows.map((r) =>
      [r.orderNumber, r.createdAt, r.channel, r.status, r.itemsTotalCop, r.deliveryFeeCop, r.totalCop, r.paymentMethod]
        .map(esc)
        .join(","),
    );
    return [header, ...lines].join("\n");
  }
}
