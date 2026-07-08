"use server";

import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import {
  findPresentableImage,
  identifyProduct,
  productAgentConfigured,
  type ProductProposal,
} from "@/modules/assistant/product-agent";

/** Acciones del agente de alta de productos (foto / voz / chat). */

export type AnalyzeResult =
  | { ok: true; proposal: ProductProposal; foundImage: { dataUrl: string; source: string } | null }
  | { ok: false; message: string };

export async function analyzeProductAction(input: {
  imageDataUrl?: string;
  text?: string;
}): Promise<AnalyzeResult> {
  try {
    const user = await requirePermission("catalog.manage");
    if (!productAgentConfigured()) {
      return { ok: false, message: "El agente necesita ANTHROPIC_API_KEY configurada (ya está en producción)." };
    }
    if (!rateLimit(`product-agent:${user.id}`, 20, 10 * 60_000)) {
      return { ok: false, message: "Muchos análisis seguidos; espera un momento." };
    }
    const parsed = z
      .object({
        imageDataUrl: z.string().startsWith("data:image/").max(1_500_000).optional(),
        text: z.string().max(500).optional(),
      })
      .parse(input);

    const proposal = await identifyProduct(parsed);
    const foundImage = await findPresentableImage({ barcode: proposal.barcode, name: proposal.name });
    return { ok: true, proposal, foundImage };
  } catch (e) {
    console.error("analyzeProductAction", e);
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo analizar el producto." };
  }
}

/** Busca solo la foto presentable (cuando el tendero ya digitó los datos). */
export async function findImageAction(input: {
  name: string;
  barcode?: string;
}): Promise<{ ok: true; foundImage: { dataUrl: string; source: string } | null } | { ok: false; message: string }> {
  try {
    await requirePermission("catalog.manage");
    const parsed = z.object({ name: z.string().min(2).max(120), barcode: z.string().max(40).optional() }).parse(input);
    const foundImage = await findPresentableImage({ barcode: parsed.barcode ?? null, name: parsed.name });
    return { ok: true, foundImage };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error buscando la foto." };
  }
}
