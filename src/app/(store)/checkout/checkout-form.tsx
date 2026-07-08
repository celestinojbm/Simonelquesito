"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCart, lineTotal } from "@/components/cart/cart-context";
import { formatCop } from "@/lib/format";
import { checkoutAction } from "@/app/actions/checkout";
import { previewCouponAction } from "@/app/actions/promotions";
import type { CouponQuote } from "@/modules/promotions/service";
import { MapPicker } from "@/components/map/map-picker";

type Zone = {
  id: string;
  name: string;
  neighborhoods: string[];
  feeCop: number;
  minOrderCop: number;
  etaMinutesMin: number;
  etaMinutesMax: number;
};

const formSchema = z.object({
  fulfillment: z.enum(["delivery", "pickup"]),
  contactName: z.string().min(2, "Escribe tu nombre"),
  contactPhone: z.string().min(7, "Escribe tu teléfono"),
  zoneId: z.string().optional(),
  neighborhood: z.string().optional(),
  addressLine: z.string().optional(),
  addressReferences: z.string().optional(),
  deliverySlot: z.string(),
  instructions: z.string().max(500).optional(),
  substitutionPref: z.enum(["no_substitution", "similar_product", "contact_me", "up_to_price_limit"]),
  paymentMethod: z.enum(["sandbox", "mercado_pago", "nequi", "daviplata", "bank_transfer", "cash_on_delivery", "card_on_delivery", "store_credit"]),
  creditFrequency: z.enum(["weekly", "biweekly"]),
  declaredBirthDate: z.string().optional(),
  restrictedTermsAccepted: z.boolean(),
  dataConsent: z.boolean().refine((v) => v, "Debes aceptar la política de datos"),
  marketingConsent: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

/** Métodos según el proveedor de pagos activo (lo decide el servidor). */
function paymentMethodsFor(onlineProvider: "sandbox" | "mercado_pago") {
  const online =
    onlineProvider === "mercado_pago"
      ? [{ value: "mercado_pago", label: "Pago en línea: tarjeta o PSE", hint: "Nequi vía PSE · Mercado Pago" }]
      : [
          { value: "sandbox", label: "Pago en línea (demo sandbox)", hint: "Simula Wompi/Mercado Pago" },
          { value: "nequi", label: "Nequi", hint: "Vía pasarela (demo: sandbox)" },
          { value: "daviplata", label: "Daviplata", hint: "Vía pasarela (demo: sandbox)" },
        ];
  return [
    ...online,
    { value: "cash_on_delivery", label: "Efectivo al recibir", hint: "" },
    { value: "card_on_delivery", label: "Datáfono al recibir", hint: "" },
    { value: "bank_transfer", label: "Transferencia bancaria", hint: "Te enviamos los datos" },
  ] as const;
}

export function CheckoutForm({
  zones,
  freeFromCop,
  storeLocation,
  defaultContact,
  credit,
  onlineProvider = "sandbox",
}: {
  zones: Zone[];
  freeFromCop: number | null;
  storeLocation: { lat: number; lng: number };
  defaultContact: { name: string; phone: string } | null;
  /** Cupo de Fiado del cliente en sesión (null si no aplica). */
  credit: { availableCop: number; overdue: boolean } | null;
  /** Pasarela en línea activa: cambia las opciones de pago mostradas. */
  onlineProvider?: "sandbox" | "mercado_pago";
}) {
  const PAYMENT_METHODS = paymentMethodsFor(onlineProvider);
  const router = useRouter();
  const { items, totalCop, hasWeightItems, hasRestrictedItems, clear } = useCart();
  const [mapPos, setMapPos] = useState<{ lat: number; lng: number } | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponQuote, setCouponQuote] = useState<CouponQuote | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [violations, setViolations] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fulfillment: "delivery",
      contactName: defaultContact?.name ?? "",
      contactPhone: defaultContact?.phone ?? "",
      deliverySlot: "asap",
      substitutionPref: "similar_product",
      paymentMethod: onlineProvider === "mercado_pago" ? "mercado_pago" : "sandbox",
      creditFrequency: "biweekly",
      restrictedTermsAccepted: false,
      dataConsent: false,
      marketingConsent: false,
    },
  });

  const fulfillment = watch("fulfillment");
  const zoneId = watch("zoneId");
  const paymentMethod = watch("paymentMethod");
  const zone = zones.find((z) => z.id === zoneId);
  const deliveryFee =
    fulfillment === "pickup" || !zone
      ? 0
      : freeFromCop !== null && totalCop >= freeFromCop
        ? 0
        : zone.feeCop;
  const belowMinimum = fulfillment === "delivery" && zone && totalCop < zone.minOrderCop;

  // Vista previa del cupón (el cobro real lo decide el servidor en placeOrder).
  const couponApplied = couponQuote?.valid ? couponQuote : null;
  const couponFreeDelivery = fulfillment === "delivery" && couponApplied?.kind === "free_delivery";
  const couponDiscount = couponApplied && couponApplied.kind !== "free_delivery" ? couponApplied.discountCop : 0;
  const effectiveDeliveryFee = couponFreeDelivery ? 0 : deliveryFee;

  if (items.length === 0 && !submitting) {
    return (
      <p className="rounded-card border border-brand-soft bg-white p-6 text-center text-ink-soft">
        Tu carrito está vacío. <Link href="/" className="font-semibold text-brand-dark underline">Volver a la tienda</Link>
      </p>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setViolations([]);
    setSubmitting(true);
    const result = await checkoutAction({
      items: items.map((i) => ({ variantId: i.variantId, qty: i.qty, note: i.note || undefined })),
      fulfillment: values.fulfillment,
      contactName: values.contactName,
      contactPhone: values.contactPhone,
      addressLine: values.addressLine,
      neighborhood: values.neighborhood,
      addressReferences: values.addressReferences,
      zoneId: values.zoneId,
      deliverySlot: values.deliverySlot,
      instructions: values.instructions,
      substitutionPref: values.substitutionPref,
      paymentMethod: values.paymentMethod,
      creditFrequency: values.creditFrequency,
      declaredBirthDate: values.declaredBirthDate || undefined,
      restrictedTermsAccepted: values.restrictedTermsAccepted,
      dataConsent: values.dataConsent,
      marketingConsent: values.marketingConsent,
      deliveryLat: values.fulfillment === "delivery" ? (mapPos?.lat ?? undefined) : undefined,
      deliveryLng: values.fulfillment === "delivery" ? (mapPos?.lng ?? undefined) : undefined,
      couponCode: couponApplied ? couponCode.trim() : undefined,
      idempotencyKey,
    });
    if (result.ok) {
      clear();
      const dest = result.redirectUrl ?? `/pedido/${result.orderId}`;
      // La pasarela real (Mercado Pago) es una URL externa: navegación completa.
      if (dest.startsWith("http")) window.location.assign(dest);
      else router.push(dest);
    } else {
      setServerError(result.message);
      setViolations(result.violations ?? []);
      setSubmitting(false);
    }
  });

  const inputCls =
    "w-full rounded-lg border border-brand-soft bg-white px-3 py-2.5 text-sm focus:border-brand";
  const sectionCls = "rounded-card border border-brand-soft bg-white p-4";

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {/* Entrega o recogida */}
      <fieldset className={sectionCls}>
        <legend className="mb-2 font-bold text-ink">¿Cómo lo recibes?</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className={`btn flex cursor-pointer items-center justify-center gap-2 rounded-card border-2 py-3 font-semibold ${fulfillment === "delivery" ? "border-brand bg-brand-soft text-brand-dark" : "border-brand-soft text-ink-soft"}`}>
            <input type="radio" value="delivery" {...register("fulfillment")} className="sr-only" />
            🛵 Domicilio
          </label>
          <label className={`btn flex cursor-pointer items-center justify-center gap-2 rounded-card border-2 py-3 font-semibold ${fulfillment === "pickup" ? "border-brand bg-brand-soft text-brand-dark" : "border-brand-soft text-ink-soft"}`}>
            <input type="radio" value="pickup" {...register("fulfillment")} className="sr-only" />
            🏪 Recojo en tienda
          </label>
        </div>
      </fieldset>

      {/* Contacto */}
      <fieldset className={sectionCls}>
        <legend className="mb-2 font-bold text-ink">Tus datos</legend>
        <div className="space-y-3">
          <div>
            <label htmlFor="contactName" className="mb-1 block text-sm font-medium">Nombre</label>
            <input id="contactName" {...register("contactName")} className={inputCls} autoComplete="name" />
            {errors.contactName && <p className="mt-1 text-xs text-coral-dark">{errors.contactName.message}</p>}
          </div>
          <div>
            <label htmlFor="contactPhone" className="mb-1 block text-sm font-medium">Teléfono / WhatsApp</label>
            <input id="contactPhone" type="tel" {...register("contactPhone")} className={inputCls} autoComplete="tel" />
            {errors.contactPhone && <p className="mt-1 text-xs text-coral-dark">{errors.contactPhone.message}</p>}
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-soft">Compra como invitado: no necesitas crear cuenta.</p>
      </fieldset>

      {/* Dirección */}
      {fulfillment === "delivery" && (
        <fieldset className={sectionCls}>
          <legend className="mb-2 font-bold text-ink">Dirección de entrega</legend>
          <div className="space-y-3">
            <div>
              <label htmlFor="zoneId" className="mb-1 block text-sm font-medium">Zona / barrio</label>
              <select id="zoneId" {...register("zoneId")} className={inputCls} defaultValue="">
                <option value="" disabled>Elige tu zona…</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} — envío {formatCop(z.feeCop)} · {z.etaMinutesMin}-{z.etaMinutesMax} min
                  </option>
                ))}
              </select>
            </div>
            {zone && (
              <div>
                <label htmlFor="neighborhood" className="mb-1 block text-sm font-medium">Barrio</label>
                <select id="neighborhood" {...register("neighborhood")} className={inputCls} defaultValue="">
                  <option value="" disabled>Elige tu barrio…</option>
                  {zone.neighborhoods.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="addressLine" className="mb-1 block text-sm font-medium">Dirección</label>
              <input id="addressLine" {...register("addressLine")} className={inputCls} placeholder="Cra 00 # 00-00, apto/casa" autoComplete="street-address" />
            </div>
            <div>
              <label htmlFor="addressReferences" className="mb-1 block text-sm font-medium">Referencias (opcional)</label>
              <input id="addressReferences" {...register("addressReferences")} className={inputCls} placeholder="Portería, torre, punto de referencia…" />
            </div>
            <div>
              <p className="mb-1 block text-sm font-medium">Punto exacto en el mapa (opcional)</p>
              <MapPicker center={storeLocation} value={mapPos} onChange={setMapPos} />
            </div>
            {belowMinimum && zone && (
              <p className="rounded-lg bg-sun/30 px-3 py-2 text-sm font-medium text-ink">
                El pedido mínimo para {zone.name} es {formatCop(zone.minOrderCop)}.
              </p>
            )}
          </div>
        </fieldset>
      )}

      {/* Horario y sustituciones */}
      <fieldset className={sectionCls}>
        <legend className="mb-2 font-bold text-ink">Entrega y sustituciones</legend>
        <div className="space-y-3">
          <div>
            <label htmlFor="deliverySlot" className="mb-1 block text-sm font-medium">¿Cuándo?</label>
            <select id="deliverySlot" {...register("deliverySlot")} className={inputCls}>
              <option value="asap">Lo antes posible</option>
              <option value="10:00-12:00">Hoy 10:00 – 12:00</option>
              <option value="12:00-14:00">Hoy 12:00 – 14:00</option>
              <option value="14:00-16:00">Hoy 14:00 – 16:00</option>
              <option value="16:00-18:00">Hoy 16:00 – 18:00</option>
              <option value="18:00-20:00">Hoy 18:00 – 20:00</option>
            </select>
          </div>
          <div>
            <label htmlFor="substitutionPref" className="mb-1 block text-sm font-medium">Si algo se agota…</label>
            <select id="substitutionPref" {...register("substitutionPref")} className={inputCls}>
              <option value="similar_product">Sustituir por un producto similar</option>
              <option value="contact_me">Contáctenme antes de sustituir</option>
              <option value="no_substitution">No sustituir (retirar del pedido)</option>
              <option value="up_to_price_limit">Sustituir hasta un precio similar</option>
            </select>
          </div>
          <div>
            <label htmlFor="instructions" className="mb-1 block text-sm font-medium">Instrucciones (opcional)</label>
            <textarea id="instructions" {...register("instructions")} rows={2} className={inputCls} placeholder="Ej.: timbre dañado, llamar al llegar" />
          </div>
        </div>
      </fieldset>

      {/* Verificación +18 */}
      {hasRestrictedItems && (
        <fieldset className="rounded-card border border-liquor/30 bg-liquor-soft p-4">
          <legend className="mb-2 font-bold text-liquor">Verificación de mayoría de edad</legend>
          <p className="mb-3 text-sm text-liquor">
            Tu pedido incluye productos para mayores de 18 años (licor/cigarrillos). La venta a menores
            está prohibida. El domiciliario verificará tu documento al entregar; no hay entrega desatendida.
          </p>
          <div className="space-y-3">
            <div>
              <label htmlFor="declaredBirthDate" className="mb-1 block text-sm font-medium text-liquor">Fecha de nacimiento</label>
              <input id="declaredBirthDate" type="date" {...register("declaredBirthDate")} className={inputCls} />
            </div>
            <label className="flex items-start gap-2 text-sm text-liquor">
              <input type="checkbox" {...register("restrictedTermsAccepted")} className="mt-1 h-5 w-5 accent-[#8A5A18]" />
              Declaro que soy mayor de 18 años y acepto que se verifique mi identidad en la entrega.
            </label>
          </div>
        </fieldset>
      )}

      {/* Pago */}
      <fieldset className={sectionCls}>
        <legend className="mb-2 font-bold text-ink">Medio de pago</legend>
        <div className="space-y-2">
          {/* Pagar a crédito: solo si el cliente tiene cupo de Fiado activo. */}
          {credit && !credit.overdue && credit.availableCop > 0 && (
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-brand px-3 py-2 has-[:checked]:bg-brand-soft">
              <input type="radio" value="store_credit" {...register("paymentMethod")} className="h-5 w-5 accent-[#16A765]" />
              <span className="text-sm font-medium">📒 Pagar a crédito (en cuotas, sin intereses)</span>
              <span className="ml-auto text-xs text-ink-soft">Cupo disp. ${credit.availableCop.toLocaleString("es-CO")}</span>
            </label>
          )}
          {credit?.overdue && (
            <p className="rounded-lg bg-coral/10 px-3 py-2 text-xs text-coral-dark">
              Tienes cuotas vencidas de tu Fiado: ponte al día para volver a pagar a crédito.
            </p>
          )}
          {PAYMENT_METHODS.map((m) => (
            <label key={m.value} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-brand-soft px-3 py-2 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" value={m.value} {...register("paymentMethod")} className="h-5 w-5 accent-[#16A765]" />
              <span className="text-sm font-medium">{m.label}</span>
              {m.hint && <span className="ml-auto text-xs text-ink-soft">{m.hint}</span>}
            </label>
          ))}
        </div>
        {paymentMethod === "store_credit" && (
          <div className="mt-3 rounded-lg bg-brand-soft/50 p-3">
            <p className="mb-1 text-sm font-semibold text-brand-dark">¿Cada cuánto pagas las cuotas?</p>
            <div className="flex gap-2">
              {(["weekly", "biweekly"] as const).map((f) => (
                <label key={f} className="flex cursor-pointer items-center gap-2 rounded-lg border border-brand-soft bg-white px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input type="radio" value={f} {...register("creditFrequency")} className="h-4 w-4 accent-[#16A765]" />
                  {f === "weekly" ? "Semanal" : "Quincenal"}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              Montos pequeños van en una sola cuota a 15 días. El detalle de tus cuotas queda en Mi cuenta.
            </p>
          </div>
        )}
      </fieldset>

      {/* Consentimientos */}
      <fieldset className={sectionCls}>
        <legend className="sr-only">Consentimientos</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...register("dataConsent")} className="mt-1 h-5 w-5 accent-[#16A765]" />
          Acepto el tratamiento de mis datos para gestionar este pedido (obligatorio).
        </label>
        {errors.dataConsent && <p className="mt-1 text-xs text-coral-dark">{errors.dataConsent.message}</p>}
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" {...register("marketingConsent")} className="mt-1 h-5 w-5 accent-[#16A765]" />
          Quiero recibir ofertas por WhatsApp (opcional, puedes darte de baja cuando quieras).
        </label>
      </fieldset>

      {/* Cupón */}
      <div className="rounded-card border border-brand-soft bg-white p-4">
        <label htmlFor="coupon" className="mb-1 block text-sm font-medium">¿Tienes un cupón?</label>
        <div className="flex gap-2">
          <input
            id="coupon"
            value={couponCode}
            onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponQuote(null); }}
            placeholder="Ej. BIENVENIDO10"
            className={`${inputCls} uppercase`}
          />
          <button
            type="button"
            disabled={checkingCoupon || !couponCode.trim()}
            onClick={() => {
              setCheckingCoupon(true);
              void (async () => {
                const eligible = items.filter((i) => !i.isRestricted).reduce((s, i) => s + lineTotal(i), 0);
                const quote = await previewCouponAction({
                  code: couponCode,
                  eligibleItemsCop: eligible,
                  itemsTotalCop: totalCop,
                });
                setCouponQuote(quote);
                setCheckingCoupon(false);
              })();
            }}
            className="btn shrink-0 rounded-full border border-brand px-4 py-2 text-sm font-bold text-brand-dark disabled:opacity-50"
          >
            {checkingCoupon ? "…" : "Aplicar"}
          </button>
        </div>
        {couponQuote && (
          couponQuote.valid ? (
            <p className="mt-1 text-sm font-medium text-brand-dark">
              ✅ {couponQuote.label}:{" "}
              {couponQuote.kind === "free_delivery" ? "envío gratis" : `−${formatCop(couponQuote.discountCop)}`}
            </p>
          ) : (
            <p role="alert" className="mt-1 text-sm text-coral-dark">{couponQuote.reason}</p>
          )
        )}
      </div>

      {/* Resumen */}
      <div className="rounded-card border-2 border-brand bg-white p-4">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt>Productos ({items.length})</dt><dd>{formatCop(totalCop)}</dd></div>
          <div className="flex justify-between">
            <dt>Envío</dt>
            <dd>
              {fulfillment === "pickup"
                ? "Gratis (recogida)"
                : couponFreeDelivery
                  ? "¡Gratis! (cupón)"
                  : zone
                    ? (deliveryFee === 0 ? "¡Gratis!" : formatCop(deliveryFee))
                    : "según zona"}
            </dd>
          </div>
          {couponDiscount > 0 && (
            <div className="flex justify-between text-brand-dark">
              <dt>Descuento (cupón)</dt>
              <dd>−{formatCop(couponDiscount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-brand-soft pt-2 text-base font-bold text-brand-dark">
            <dt>Total{hasWeightItems ? " estimado" : ""}</dt>
            <dd>{formatCop(Math.max(0, totalCop + effectiveDeliveryFee - couponDiscount))}</dd>
          </div>
        </dl>
        {hasWeightItems && (
          <p className="mt-2 text-xs text-ink-soft">⚖️ Incluye productos por peso: el valor final puede variar según el peso real.</p>
        )}
      </div>

      {serverError && (
        <div role="alert" className="rounded-card border border-coral bg-coral/10 p-4 text-sm text-coral-dark">
          <p className="font-semibold">{serverError}</p>
          {violations.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {violations.map((v) => <li key={v}>{v}</li>)}
            </ul>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !!belowMinimum}
        className="btn w-full rounded-full bg-coral py-4 text-lg font-bold text-white transition hover:bg-coral-dark disabled:opacity-50"
      >
        {submitting ? "Creando tu pedido…" : "Confirmar pedido"}
      </button>
    </form>
  );
}
