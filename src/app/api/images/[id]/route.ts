import { eq } from "drizzle-orm";
import { db } from "@/db";
import { productImages } from "@/db/schema";

/**
 * Sirve las fotos de producto subidas desde el panel.
 * En el MVP la imagen vive en la BD como data-URI (sin depender de un bucket
 * externo); esta ruta la decodifica y la entrega con caché larga.
 * Producción a escala: mover a Supabase Storage / Vercel Blob (mismo contrato).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const image = await db.query.productImages.findFirst({ where: eq(productImages.id, id) });
  if (!image) return new Response("No encontrada", { status: 404 });

  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/s.exec(image.url);
  if (!match) {
    // Imagen estática normal: redirigir a su ruta pública.
    return Response.redirect(new URL(image.url, _request.url), 302);
  }
  const [, mime, base64] = match;
  const buffer = Buffer.from(base64!, "base64");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": mime!,
      "cache-control": "public, max-age=86400, s-maxage=604800",
    },
  });
}
