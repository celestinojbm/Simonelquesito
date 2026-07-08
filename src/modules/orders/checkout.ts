import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  orders,
  orderItems,
  productVariants,
  products,
  categories,
  branches,
  customers,
  payments,
} from "@/db/schema";
import { id } from "@/lib/ids";
import { weightLineTotal, assertMoney } from "@/lib/money";
import { reserveStock } from "@/modules/inventory/service";
import { createPayment } from "@/modules/payments/service";
import { transitionOrder } from "./state";
import { getSetting } from "@/modules/config/service";
import type { SettingValue } from "@/modules/config/keys";
import { isScheduleOpen } from "@/modules/config/schedule";
import { checkRestricted } from "@/modules/restricted/engine";
import { quoteDelivery } from "@/modules/delivery/service";
import { notifyOrderEvent } from "@/modules/messaging/service";
import { quoteCoupon, redeemCoupon } from "@/modules/promotions/service";
import { recordMarketingConsent } from "@/modules/accounts/consent";

export const checkoutInputSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string(),
        /** Unidades para "unit"/"pack"; gramos o ml para peso/volumen. */
        qty: z.number().int().positive(),
        note: z.string().max(200).optional(),
      }),
    )
    .min(1, "El carrito está vacío"),
  fulfillment: z.enum(["delivery", "pickup"]),
  contactName: z.string().min(2, "Nombre requerido"),
  contactPhone: z.string().min(7, "Teléfono requerido"),
  addressLine: z.string().optional(),
  neighborhood: z.string().optional(),
  addressReferences: z.string().optional(),
  zoneId: z.string().optional(),
  deliverySlot: z.string().default("asap"),
  instructions: z.string().max(500).optional(),
  /** Punto exacto de entrega fijado en el mapa (opcional; WGS84). */
  deliveryLat: z.number().min(-90).max(90).optional(),
  deliveryLng: z.number().min(-180).max(180).optional(),
  substitutionPref: z
    .enum(["no_substitution", "similar_product", "contact_me", "up_to_price_limit"])
    .default("similar_product"),
  substitutionPriceLimitCop: z.number().int().positive().optional(),
  paymentMethod: z.enum([
    "sandbox",
    "mercado_pago",
    "nequi",
    "daviplata",
    "bank_transfer",
    "cash_on_delivery",
    "card_on_delivery",
    "store_credit",
  ]),
  /** Pago a crédito (store_credit): frecuencia elegida de las cuotas. */
  creditFrequency: z.enum(["weekly", "biweekly"]).default("biweekly"),
  /** Verificación de restringidos (si aplica). */
  declaredBirthDate: z.string().optional(),
  restrictedTermsAccepted: z.boolean().default(false),
  /** Consentimiento de datos (obligatorio) y marketing (opcional). */
  dataConsent: z.boolean(),
  marketingConsent: z.boolean().default(false),
  /** Idempotencia del checkout: la genera el cliente y se reusa en reintentos. */
  idempotencyKey: z.string().min(8),
  customerId: z.string().optional(),
  /**
   * Canal de venta: la web por defecto; el asistente pasa "whatsapp";
   * "manual" es un pedido interno tomado por el personal (teléfono/WhatsApp
   * sin bot) desde Admin → Pedidos → Nuevo.
   */
  channel: z.enum(["web_pwa", "whatsapp", "manual"]).default("web_pwa"),
  /** Cupón de descuento (opcional). Se valida y canjea en servidor. */
  couponCode: z.string().max(30).optional(),
});

// Forma de ENTRADA del schema: los campos con .default() son opcionales
// para quien llama (la web no manda channel; el bot no manda deliverySlot…).
export type CheckoutInput = z.input<typeof checkoutInputSchema>;

export class CheckoutError extends Error {
  constructor(
    message: string,
    public violations: string[] = [],
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

/**
 * Checkout transaccional: valida horario, zona, restringidos y stock;
 * calcula TODOS los precios en el servidor (nunca confía en el navegador);
 * crea pedido + items + reservas + intento de pago de forma atómica.
 */
export async function placeOrder(input: CheckoutInput) {
  const data = checkoutInputSchema.parse(input);
  const now = new Date();

  if (!data.dataConsent) {
    throw new CheckoutError("Debes aceptar la política de tratamiento de datos.");
  }

  // 1) Horario del canal (configurable, no hardcodeado)
  const hours = await getSetting(data.fulfillment === "delivery" ? "hours.delivery" : "hours.pickup");
  if (!isScheduleOpen(hours, now)) {
    throw new CheckoutError(
      data.fulfillment === "delivery"
        ? "En este momento no hay servicio de domicilios. Consulta el horario en la portada."
        : "La tienda está cerrada en este momento.",
    );
  }

  // 2) Cargar variantes con producto/categoría (precio y flags desde BD)
  const variantIds = data.items.map((i) => i.variantId);
  const rows = await db
    .select({
      variant: productVariants,
      product: products,
      category: categories,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(sql`${productVariants.id} in ${variantIds}`);

  const byId = new Map(rows.map((r) => [r.variant.id, r]));
  for (const item of data.items) {
    const row = byId.get(item.variantId);
    if (!row || !row.variant.isActive || !row.product.isActive) {
      throw new CheckoutError("Uno de los productos del carrito ya no está disponible.");
    }
  }

  // 3) Reglas de restringidos
  const restrictedKeys = [
    ...new Set(
      data.items
        .map((i) => byId.get(i.variantId)!)
        .filter((r) => r.product.isRestricted)
        .map((r) => r.product.restrictedRuleKey ?? "liquor"),
    ),
  ];
  let idCheckRequired = false;
  if (restrictedKeys.length > 0) {
    const rules = await getSetting("restricted.rules");
    const check = checkRestricted({
      ruleKeys: restrictedKeys,
      rules,
      at: now,
      fulfillment: data.fulfillment,
      zoneId: data.zoneId ?? null,
      declaredBirthDate: data.declaredBirthDate ?? null,
      termsAccepted: data.restrictedTermsAccepted,
    });
    if (!check.allowed) {
      throw new CheckoutError("El pedido incluye productos restringidos que no cumplen las reglas.", check.violations);
    }
    idCheckRequired = check.requiresIdCheckOnDelivery;
  }

  // 4) Totales calculados en servidor
  let itemsTotal = 0;
  let hasWeightItems = false;
  const lines = data.items.map((item) => {
    const { variant, product, category } = byId.get(item.variantId)!;
    let lineTotal: number;
    if (variant.saleUnit === "kg" || variant.saleUnit === "g") {
      lineTotal = weightLineTotal(variant.priceCop, item.qty); // priceCop = por kg, qty en g
      hasWeightItems = hasWeightItems || variant.soldByWeight;
    } else if (variant.saleUnit === "l" || variant.saleUnit === "ml") {
      lineTotal = weightLineTotal(variant.priceCop, item.qty); // por litro, qty en ml
    } else {
      lineTotal = variant.priceCop * item.qty;
      if (variant.soldByWeight) hasWeightItems = true;
    }
    assertMoney(lineTotal, `línea ${product.name}`);
    itemsTotal += lineTotal;
    return {
      variantId: variant.id,
      nameSnapshot: `${product.name} — ${variant.name}`,
      saleUnitSnapshot: variant.saleUnit,
      qty: item.qty,
      unitPriceCop: variant.priceCop,
      lineTotalCop: lineTotal,
      note: item.note ?? null,
      isRestricted: product.isRestricted,
      prepArea: category.prepArea,
    };
  });

  // 5) Vínculo automático con la cuenta del cliente por teléfono: los
  // pedidos del bot de WhatsApp (y de invitados con cuenta) quedan en su
  // historial sin pasos extra. Se compara por los últimos 10 dígitos.
  // (Va antes del envío para poder aplicar beneficios premium.)
  let customerId = data.customerId ?? null;
  if (!customerId) {
    const last10 = data.contactPhone.replace(/[^0-9]/g, "").slice(-10);
    if (last10.length === 10) {
      const match = await db.query.customers.findFirst({
        where: sql`right(regexp_replace(${customers.phone}, '[^0-9]', '', 'g'), 10) = ${last10}`,
      });
      if (match) customerId = match.id;
    }
  }

  // 5.5) Envío (zona configurada) — solo delivery. Beneficio premium:
  // membresía activa + freeDelivery habilitado → domicilio gratis siempre.
  let deliveryFee = 0;
  if (data.fulfillment === "delivery") {
    if (!data.zoneId || !data.addressLine || !data.neighborhood) {
      throw new CheckoutError("Para domicilio se requiere dirección, barrio y zona de cobertura.");
    }
    const quote = await quoteDelivery({ zoneId: data.zoneId, itemsTotalCop: itemsTotal });
    if (!quote.available) {
      throw new CheckoutError(quote.reason ?? "Zona sin cobertura en este momento.");
    }
    deliveryFee = quote.feeCop;
    if (deliveryFee > 0 && customerId) {
      const [{ getActiveMembership }, plan] = await Promise.all([
        import("@/modules/premium/service"),
        getSetting("premium.plan"),
      ]);
      if (plan.freeDelivery && (await getActiveMembership(customerId))) {
        deliveryFee = 0;
      }
    }
  }

  // 5.7) Cupón (opcional): valida contra promociones. Base del descuento =
  // productos NO restringidos (por ley no se descuenta licor/cigarrillos).
  let discountCop = 0;
  let appliedCoupon: { couponId: string; promotionId: string; code: string } | null = null;
  if (data.couponCode?.trim()) {
    const eligibleItemsCop = lines
      .filter((l) => !l.isRestricted)
      .reduce((acc, l) => acc + l.lineTotalCop, 0);
    const quote = await quoteCoupon({
      code: data.couponCode,
      eligibleItemsCop,
      itemsTotalCop: itemsTotal,
      customerId,
    });
    if (!quote.valid) throw new CheckoutError(`Cupón no aplicado: ${quote.reason}`);
    if (quote.kind === "free_delivery") {
      deliveryFee = 0; // el "descuento" es la tarifa; no se suma dos veces
    } else {
      discountCop = Math.min(quote.discountCop, itemsTotal + deliveryFee);
    }
    appliedCoupon = {
      couponId: quote.couponId,
      promotionId: quote.promotionId,
      code: data.couponCode.trim().toUpperCase(),
    };
  }

  const total = itemsTotal + deliveryFee - discountCop;

  // 5.95) Idempotencia de TODO el checkout: si esta clave ya creó un pedido
  // (doble clic, reintento de red, re-ejecución del cron de canastas), se
  // devuelve ese pedido tal cual — jamás se duplica.
  const priorPayment = await db.query.payments.findFirst({
    where: eq(payments.idempotencyKey, data.idempotencyKey),
  });
  if (priorPayment) {
    const priorOrder = await db.query.orders.findFirst({
      where: eq(orders.id, priorPayment.orderId),
    });
    if (priorOrder) {
      // Reintento del mismo checkout con el pago aún pendiente: se devuelve la
      // MISMA URL de pago (sandbox se reconstruye; MP quedó en el intento).
      const priorAttempts = priorPayment.attempts as { redirectUrl?: string }[];
      const redirectUrl =
        priorPayment.status !== "pending"
          ? null
          : priorPayment.provider === "sandbox"
            ? `/pago-sandbox/${priorPayment.providerRef}`
            : (priorAttempts.find((a) => a?.redirectUrl)?.redirectUrl ?? null);
      return {
        orderId: priorOrder.id,
        number: priorOrder.number,
        totalCop: priorOrder.totalCop,
        payment: { ...priorPayment, redirectUrl },
        locationToken: priorOrder.locationToken,
      };
    }
  }

  // 6) Transacción: pedido + items + reservas + pago
  const branch = await db.query.branches.findFirst({ where: eq(branches.isActive, true) });
  if (!branch) throw new Error("No hay sucursal activa (¿corriste el seed?)");

  const isOnlinePayment = ["sandbox", "mercado_pago", "nequi", "daviplata"].includes(data.paymentMethod);
  const isCredit = data.paymentMethod === "store_credit";

  // Pago a crédito (Fiado): exige cuenta de crédito ACTIVA del cliente
  // (se abre antes desde /cuenta/credito, con las verificaciones). El plan de
  // cuotas se crea DENTRO de la transacción del pedido, así el cupo/mora se
  // validan atómicamente: si fallan, el pedido no se crea.
  let creditRules: SettingValue<"credit.rules"> | null = null;
  if (isCredit) {
    if (!customerId) {
      throw new CheckoutError("Para pagar a crédito inicia sesión y activa tu cupo en Mi cuenta → Crédito.");
    }
    const { getCreditStatus } = await import("@/modules/credit/service");
    const status = await getCreditStatus(customerId);
    if (!status) {
      throw new CheckoutError("No tienes un cupo de Fiado activo. Actívalo en Mi cuenta → Crédito.");
    }
    if (status.account.status !== "active") {
      throw new CheckoutError("Tu cupo de Fiado está pausado o cerrado. Ponte al día para volver a usarlo.");
    }
    if (status.overdueCount > 0) {
      throw new CheckoutError("Tienes cuotas vencidas: ponte al día antes de un nuevo pedido a crédito.");
    }
    creditRules = await getSetting("credit.rules");
  }

  const result = await db.transaction(async (tx) => {
    // Número corto secuencial legible
    const [seq] = await tx.execute<{ n: string }>(sql`SELECT nextval('order_number_seq') as n`).then(r => r.rows);
    const number = `MC-${seq!.n}`;

    const orderId = id("ord");
    // Token público para la página de mapa/seguimiento (compartible por chat).
    const locationToken = crypto.randomUUID().replace(/-/g, "");
    await tx.insert(orders).values({
      id: orderId,
      number,
      locationToken,
      deliveryLat: data.deliveryLat ?? null,
      deliveryLng: data.deliveryLng ?? null,
      branchId: branch.id,
      customerId,
      channel: data.channel,
      status: "new",
      fulfillment: data.fulfillment,
      addressLine: data.addressLine ?? null,
      neighborhood: data.neighborhood ?? null,
      zoneId: data.zoneId ?? null,
      addressReferences: data.addressReferences ?? null,
      contactPhone: data.contactPhone,
      contactName: data.contactName,
      deliverySlot: data.deliverySlot,
      instructions: data.instructions ?? null,
      substitutionPref: data.substitutionPref,
      substitutionPriceLimitCop: data.substitutionPriceLimitCop ?? null,
      hasWeightItems,
      hasRestrictedItems: restrictedKeys.length > 0,
      ageDeclaredBirthDate: data.declaredBirthDate ?? null,
      ageTermsAcceptedAt: data.restrictedTermsAccepted ? now : null,
      idCheckRequired,
      itemsTotalCop: itemsTotal,
      discountCop,
      deliveryFeeCop: deliveryFee,
      totalCop: total,
      isEstimatedTotal: hasWeightItems,
      couponCode: appliedCoupon?.code ?? null,
    });

    // Canje del cupón dentro de la transacción: si el pedido falla, no se
    // consume. El canje es atómico y condicional (ver redeemCoupon): bajo
    // concurrencia jamás se pasa del tope de usos ni del presupuesto.
    if (appliedCoupon) {
      const redeemed = await redeemCoupon(tx, {
        couponId: appliedCoupon.couponId,
        promotionId: appliedCoupon.promotionId,
        discountAppliedCop: discountCop,
      });
      if (!redeemed) {
        // Se agotó entre la cotización y el canje (carrera): abortamos el pedido
        // para no pasarnos del tope de usos/presupuesto de la promoción.
        throw new CheckoutError("El cupón se agotó justo antes de aplicarlo. Vuelve a intentar sin él.");
      }
    }

    // Consentimiento de marketing: se registra como evidencia auditable SOLO
    // cuando el cliente lo OTORGA explícitamente (casilla marcada) y el pedido
    // queda ligado a su cuenta. Nunca escribimos "granted=false" desde aquí:
    // un pedido del cron de canastas o del bot (que no preguntan y mandan
    // marketingConsent=false), o una casilla sin marcar en un pedido posterior,
    // NO deben revocar un opt-in vigente. La revocación tendrá su propio flujo
    // (source="profile"), no el checkout. La retención respeta este registro.
    if (customerId && data.marketingConsent) {
      await recordMarketingConsent(tx, {
        customerId,
        granted: true,
        source: "checkout",
        detail: { orderId, number },
      });
    }

    for (const line of lines) {
      await tx.insert(orderItems).values({ id: id("itm"), orderId, ...line });
      await reserveStock(tx, { variantId: line.variantId, orderId, qty: line.qty });
    }

    await transitionOrder(tx, {
      orderId,
      to: "pending_payment",
      actorLabel: "customer",
      reason: "Checkout completado",
    });

    const payment = await createPayment(tx, {
      orderId,
      amountCop: total,
      method: data.paymentMethod,
      customerPhone: data.contactPhone,
      idempotencyKey: data.idempotencyKey,
    });

    // Pago a crédito: crea el plan de cuotas ATÓMICAMENTE con el pedido. Si el
    // cupo/mora fallan, todo el pedido se revierte. El cobro de cada cuota se
    // gestiona desde el panel (automático cuando entre Mercado Pago).
    if (isCredit) {
      const { createCreditPurchaseTx } = await import("@/modules/credit/service");
      await createCreditPurchaseTx(
        tx,
        {
          customerId: customerId!,
          totalCop: total,
          frequency: data.creditFrequency,
          orderId,
          note: `Pedido en línea ${number}`,
          // Canal app/en línea: la mensualidad premium pendiente se suma a la
          // compra y se reparte en sus cuotas (en tienda no aplica).
          foldMembershipFee: true,
          actor: { label: "customer" },
        },
        creditRules!,
      );
    }

    // Métodos offline (efectivo/datáfono/transferencia) y crédito: el pedido
    // pasa directo a confirmado; el dinero se concilia al recibir / por cuotas.
    if (!isOnlinePayment) {
      await transitionOrder(tx, {
        orderId,
        to: "paid",
        actorLabel: "system",
        reason: isCredit
          ? "Pedido a crédito (Fiado): deuda registrada en el ledger"
          : "Pago contra entrega / offline — pendiente de conciliación",
      });
      await transitionOrder(tx, {
        orderId,
        to: "confirmed",
        actorLabel: "system",
        reason: isCredit ? "Confirmación automática (crédito)" : "Confirmación automática (pago offline)",
      });
    }

    await notifyOrderEvent(tx, orderId, "order_created");

    return { orderId, number, totalCop: total, payment, locationToken };
  });

  return result;
}
