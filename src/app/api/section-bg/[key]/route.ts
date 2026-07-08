import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sectionBackgrounds } from "@/db/schema";

/**
 * Sirve el fondo de una sección (portada o categoría) subido desde el panel.
 * La imagen vive como data-URI en la BD (sin bucket externo); esta ruta la
 * decodifica. La URL que la referencia lleva ?v=<updatedAt>, así que el
 * contenido de cada versión es inmutable y se cachea fuerte.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const row = await db.query.sectionBackgrounds.findFirst({
    where: eq(sectionBackgrounds.sectionKey, key),
  });
  if (!row || !row.url) return new Response("No encontrado", { status: 404 });

  const url = row.url;
  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/s.exec(url);
  if (!match) {
    // Ruta estática normal: redirigir a su URL pública.
    return Response.redirect(new URL(url, request.url), 302);
  }
  const [, mime, base64] = match;
  const buffer = Buffer.from(base64!, "base64");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": mime!,
      "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
    },
  });
}
