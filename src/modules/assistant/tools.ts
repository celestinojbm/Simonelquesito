import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, waConversations } from "@/db/schema";
import { formatCop } from "@/lib/money";
import { GRAMS_PER_POUND } from "@/lib/format";
import { searchProducts } from "@/modules/catalog/service";
import { listActiveZones } from "@/modules/delivery/service";
import { placeOrder, CheckoutError } from "@/modules/orders/checkout";
import { publicBaseUrl } from "@/lib/base-url";

/**
 * Herramientas del asistente de WhatsApp. Cada una reutiliza el MISMO núcleo
 * de la tienda (catálogo, zonas, placeOrder): un pedido tomado por el bot
 * reserva inventario, entra al panel y cuenta para la comisión igual que uno
 * de la web. El asistente nunca calcula precios: los lee del sistema.
 */

export const ASSISTANT_TOOLS = [
  {
    name: "buscar_productos",
    description:
      "Busca productos en el catálogo de Market Castilla por nombre (tolera errores de ortografía y sinónimos). Devuelve variantes con su ID, precio y si se vende por libra. Úsala SIEMPRE antes de agregar algo a un pedido: nunca inventes productos ni precios.",
    input_schema: {
      type: "object" as const,
      properties: {
        consulta: { type: "string", description: "Texto a buscar, ej. 'tomate' o 'aceite'" },
      },
      required: ["consulta"],
    },
  },
  {
    name: "listar_zonas",
    description:
      "Lista las zonas de cobertura de domicilio con su tarifa, pedido mínimo y tiempo estimado. Úsala para validar el barrio del cliente antes de crear un pedido a domicilio.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "crear_pedido",
    description:
      "Crea el pedido REAL en el sistema (reserva inventario y entra al panel de la tienda). Llámala solo cuando el cliente haya confirmado explícitamente: productos y cantidades, domicilio o recogida, dirección + barrio (si es domicilio), nombre y método de pago. Para productos vendidos por peso la cantidad va en LIBRAS. Si incluye licor u otros restringidos, exige fecha de nacimiento y aceptación de términos.",
    input_schema: {
      type: "object" as const,
      properties: {
        items: {
          type: "array",
          description: "Líneas del pedido, usando variantId devuelto por buscar_productos",
          items: {
            type: "object",
            properties: {
              variantId: { type: "string" },
              cantidad: {
                type: "number",
                description:
                  "Unidades para productos por unidad/paquete; número de LIBRAS para productos por peso",
              },
              nota: { type: "string", description: "Nota opcional, ej. 'maduros'" },
            },
            required: ["variantId", "cantidad"],
          },
        },
        entrega: { type: "string", enum: ["domicilio", "recoger"] },
        nombre: { type: "string", description: "Nombre del cliente" },
        direccion: { type: "string", description: "Dirección completa (solo domicilio)" },
        barrio: { type: "string", description: "Barrio del cliente (solo domicilio)" },
        referencias: { type: "string", description: "Referencias de la dirección (opcional)" },
        metodoPago: {
          type: "string",
          enum: ["efectivo", "datafono", "transferencia", "nequi", "daviplata"],
          description: "Método de pago contra entrega / offline",
        },
        instrucciones: { type: "string", description: "Instrucciones adicionales (opcional)" },
        fechaNacimiento: {
          type: "string",
          description: "AAAA-MM-DD — obligatoria si el pedido incluye productos +18",
        },
        aceptaTerminosRestringidos: {
          type: "boolean",
          description: "true si el cliente aceptó las condiciones de venta de productos +18",
        },
      },
      required: ["items", "entrega", "nombre", "metodoPago"],
    },
  },
  {
    name: "consultar_pedido",
    description:
      "Consulta el estado de un pedido existente por su número (ej. MC-1023). Solo devuelve pedidos asociados al teléfono de esta conversación.",
    input_schema: {
      type: "object" as const,
      properties: {
        numero: { type: "string", description: "Número del pedido, ej. MC-1023" },
      },
      required: ["numero"],
    },
  },
  {
    name: "pasar_a_humano",
    description:
      "Transfiere la conversación a una persona del equipo de Market Castilla. Úsala cuando el cliente lo pida, cuando haya un reclamo, o cuando no puedas resolver algo con seguridad. Después de llamarla, despídete indicando que una persona continuará la atención.",
    input_schema: {
      type: "object" as const,
      properties: {
        motivo: { type: "string", description: "Motivo breve de la transferencia" },
      },
      required: ["motivo"],
    },
  },
];

const PAYMENT_MAP = {
  efectivo: "cash_on_delivery",
  datafono: "card_on_delivery",
  transferencia: "bank_transfer",
  nequi: "nequi",
  daviplata: "daviplata",
} as const;

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

type ToolContext = {
  conversationId: string;
  phone: string;
};

/** Ejecuta una herramienta y devuelve el resultado como texto para el modelo. */
export async function runAssistantTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ result: string; handedToHuman?: boolean }> {
  switch (name) {
    case "buscar_productos": {
      const found = await searchProducts(String(input.consulta ?? ""));
      if (found.length === 0) {
        return { result: "Sin resultados. Prueba con otro nombre o pregunta al cliente por más detalles." };
      }
      const lines = found.slice(0, 10).map((p) => {
        const variants = p.variants
          .map((v) => {
            const byWeight = v.saleUnit === "kg" || v.saleUnit === "g";
            const price = byWeight
              ? `${formatCop(Math.round((v.priceCop * GRAMS_PER_POUND) / 1000))} por libra`
              : `${formatCop(v.priceCop)} c/u`;
            return `  - variantId=${v.id} | ${v.name} | ${price}${byWeight ? " | se pide en LIBRAS" : ""}${v.compareAtCop ? " | EN OFERTA" : ""}`;
          })
          .join("\n");
        return `${p.name}${p.isRestricted ? " (+18, restringido)" : ""} [${p.categoryName}]\n${variants}`;
      });
      return { result: lines.join("\n") };
    }

    case "listar_zonas": {
      const zones = await listActiveZones();
      if (zones.length === 0) return { result: "No hay zonas de cobertura configuradas." };
      const lines = zones.map(
        (z) =>
          `- ${z.name} (barrios: ${(z.neighborhoods as string[]).join(", ")}) | domicilio ${formatCop(z.feeCop)} | pedido mínimo ${formatCop(z.minOrderCop)} | ${z.etaMinutesMin}-${z.etaMinutesMax} min`,
      );
      return { result: lines.join("\n") };
    }

    case "crear_pedido": {
      try {
        const items = (input.items as { variantId: string; cantidad: number; nota?: string }[]) ?? [];
        if (items.length === 0) return { result: "ERROR: el pedido no tiene productos." };

        // Convierte libras→gramos para variantes por peso; valida contra el catálogo.
        const resolved = [];
        for (const item of items) {
          const variant = await db.query.productVariants.findFirst({
            where: (v, { eq: eqOp }) => eqOp(v.id, item.variantId),
          });
          if (!variant) return { result: `ERROR: variantId ${item.variantId} no existe. Usa buscar_productos.` };
          const byWeight = variant.saleUnit === "kg" || variant.saleUnit === "g";
          const qty = byWeight
            ? Math.round(item.cantidad * GRAMS_PER_POUND)
            : Math.round(item.cantidad);
          if (qty <= 0) return { result: `ERROR: cantidad inválida para ${variant.name}.` };
          resolved.push({ variantId: item.variantId, qty, note: item.nota });
        }

        const fulfillment = input.entrega === "domicilio" ? "delivery" : "pickup";

        // Empareja el barrio dicho por el cliente con una zona configurada.
        let zoneId: string | undefined;
        if (fulfillment === "delivery") {
          const barrio = normalize(String(input.barrio ?? ""));
          if (!barrio) return { result: "ERROR: falta el barrio para calcular la zona de domicilio." };
          const zones = await listActiveZones();
          const zone = zones.find((z) =>
            (z.neighborhoods as string[]).some(
              (n) => normalize(n).includes(barrio) || barrio.includes(normalize(n)),
            ) || normalize(z.name).includes(barrio) || barrio.includes(normalize(z.name)),
          );
          if (!zone) {
            const names = zones.map((z) => (z.neighborhoods as string[]).join(", ")).join("; ");
            return {
              result: `ERROR: el barrio "${input.barrio}" no está en las zonas de cobertura. Barrios cubiertos: ${names}. Pregunta al cliente si su barrio corresponde a alguno.`,
            };
          }
          zoneId = zone.id;
        }

        const metodo = PAYMENT_MAP[input.metodoPago as keyof typeof PAYMENT_MAP];
        if (!metodo) return { result: "ERROR: método de pago no válido." };

        const order = await placeOrder({
          items: resolved,
          channel: "whatsapp",
          fulfillment,
          contactName: String(input.nombre ?? ""),
          contactPhone: ctx.phone,
          addressLine: input.direccion ? String(input.direccion) : undefined,
          neighborhood: input.barrio ? String(input.barrio) : undefined,
          addressReferences: input.referencias ? String(input.referencias) : undefined,
          zoneId,
          deliverySlot: "asap",
          instructions: input.instrucciones ? String(input.instrucciones) : undefined,
          substitutionPref: "contact_me",
          paymentMethod: metodo,
          declaredBirthDate: input.fechaNacimiento ? String(input.fechaNacimiento) : undefined,
          restrictedTermsAccepted: input.aceptaTerminosRestringidos === true,
          dataConsent: true,
          marketingConsent: false,
          idempotencyKey: `wa-${crypto.randomUUID()}`,
        });
        const mapLink = `${publicBaseUrl()}/ubicacion/${order.locationToken}`;
        return {
          result: `PEDIDO CREADO: número ${order.number}, total ${formatCop(order.totalCop)} (incluye domicilio si aplica). Confírmale al cliente el número y el total, y COMPARTE este enlace tal cual (es personal del pedido): ${mapLink} — ahí puede fijar el punto exacto de entrega en el mapa y seguir el domicilio en tiempo real.`,
        };
      } catch (e) {
        if (e instanceof CheckoutError) {
          const detail = e.violations.length > 0 ? ` Detalles: ${e.violations.join(" | ")}` : "";
          return { result: `NO SE PUDO CREAR EL PEDIDO: ${e.message}${detail}` };
        }
        console.error("[assistant] crear_pedido falló", e);
        return { result: "NO SE PUDO CREAR EL PEDIDO por un error interno. Ofrece pasar a una persona." };
      }
    }

    case "consultar_pedido": {
      const raw = String(input.numero ?? "").toUpperCase().replace(/\s/g, "");
      const number = raw.startsWith("MC-") ? raw : `MC-${raw.replace(/[^0-9]/g, "")}`;
      const order = await db.query.orders.findFirst({
        where: and(eq(orders.number, number), eq(orders.contactPhone, ctx.phone)),
      });
      if (!order) {
        return {
          result: `No encuentro el pedido ${number} asociado a este número de WhatsApp. Verifica el número de pedido o pasa a una persona.`,
        };
      }
      const STATUS_ES: Record<string, string> = {
        new: "recibido",
        pending_payment: "esperando pago",
        paid: "pago confirmado",
        confirmed: "confirmado",
        preparing: "en preparación",
        awaiting_substitution: "esperando confirmación de un reemplazo",
        weight_adjustment_pending: "ajustando peso real",
        ready: "listo",
        assigned: "con domiciliario asignado",
        out_for_delivery: "en camino",
        delivered: "entregado",
        cancelled: "cancelado",
        refunded: "reembolsado",
        failed: "fallido",
      };
      return {
        result: `Pedido ${order.number}: estado "${STATUS_ES[order.status] ?? order.status}", total ${formatCop(order.totalCop)}${order.isEstimatedTotal ? " (estimado, se ajusta con el peso real)" : ""}.`,
      };
    }

    case "pasar_a_humano": {
      await db
        .update(waConversations)
        .set({ mode: "human" })
        .where(eq(waConversations.id, ctx.conversationId));
      return {
        result: `Conversación transferida al equipo (motivo: ${String(input.motivo ?? "sin motivo")}). Despídete indicando que una persona continuará por este mismo chat.`,
        handedToHuman: true,
      };
    }

    default:
      return { result: `Herramienta desconocida: ${name}` };
  }
}
