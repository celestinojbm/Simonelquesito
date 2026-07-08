"use server";

import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, productImages } from "@/db/schema";
import { id } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { OFF_CREDIT, isOffImageUrl } from "@/modules/catalog/off-images";

/**
 * Guarda la foto de catálogo elegida por el personal. La búsqueda y la
 * descarga ocurren EN EL NAVEGADOR (la IP compartida de Vercel está
 * bloqueada por Open Food Facts al ser de datacenter); aquí solo llega la
 * imagen ya normalizada como data-URI, con la URL de origen para auditoría
 * y atribución CC-BY-SA. Permiso: catalog.manage.
 */
export async function applyCatalogImageAction(input: {
  productId: string;
  dataUrl: string;
  sourceUrl: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const user = await requirePermission("catalog.manage");
    const parsed = z
      .object({
        productId: z.string(),
        dataUrl: z.string().startsWith("data:image/").max(1_500_000),
        sourceUrl: z.string().url(),
      })
      .parse(input);
    if (!isOffImageUrl(parsed.sourceUrl)) {
      return { ok: false, message: "Solo se aceptan imágenes de openfoodfacts.org." };
    }
    const product = await db.query.products.findFirst({ where: eq(products.id, parsed.productId) });
    if (!product) return { ok: false, message: "Producto no encontrado." };

    await db.transaction(async (tx) => {
      // Reemplaza el ícono de categoría si es lo único que hay; la foto real
      // queda de primera (sort_order 0).
      await tx
        .delete(productImages)
        .where(and(eq(productImages.productId, product.id), like(productImages.url, "/images/cat/%")));
      await tx.insert(productImages).values({
        id: id("img"),
        productId: product.id,
        url: parsed.dataUrl,
        alt: product.name,
        credit: OFF_CREDIT,
        sortOrder: 0,
      });
      await recordAudit(tx, {
        action: "catalog.image_from_off",
        entityType: "product",
        entityId: product.id,
        actorUserId: user.id,
        actorLabel: `${user.role}:${user.email}`,
        after: { source: parsed.sourceUrl },
      });
    });

    // Sin revalidatePath a propósito: refrescaría la ruta actual y la fila
    // perdería el "✅ Foto aplicada". Lista y ficha son force-dynamic.
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error inesperado" };
  }
}
