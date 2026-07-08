import Link from "next/link";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { coupons, promotions } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { formatCop } from "@/lib/format";
import {
  adminSetMarketingConsentAction,
  createPersonalCouponAction,
} from "@/app/actions/retencion";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retención · Admin" };

/**
 * Retención estilo Owner, funcional HOY (sin esperar aprobación de Meta):
 * - Recompra: clientes con historial (≥N pedidos) que no piden hace X días.
 * - Carritos abandonados: checkouts a medias o pagos fallidos recientes.
 * En ambos, un botón abre el WhatsApp del cliente con el mensaje ya escrito
 * (wa.me). Las campañas comerciales respetan el consentimiento de marketing:
 * a quien no lo autorizó, el mensaje sugerido es un saludo de servicio, sin
 * ofertas.
 */

const SOLD =
  "o.status in ('paid','confirmed','preparing','awaiting_substitution','weight_adjustment_pending','ready','assigned','out_for_delivery','delivered')";

const DAYS_PRESETS = [15, 21, 30, 45];
const MIN_PRESETS = [2, 3, 5];

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "";
const wa = (phone10: string, msg: string) =>
  `https://wa.me/57${phone10}?text=${encodeURIComponent(msg)}`;

function describePromo(kind: string, value: number): string {
  if (kind === "percent") return `${value / 100}% de descuento`;
  if (kind === "fixed") return `${formatCop(value)} de descuento`;
  if (kind === "free_delivery") return "domicilio gratis";
  return "un beneficio";
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long" });

export default async function RetencionPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; min?: string }>;
}) {
  await requirePermission("customers.manage");
  const sp = await searchParams;
  const days = Math.min(365, Math.max(3, Number(sp.dias) || 21));
  const minOrders = Math.min(20, Math.max(1, Number(sp.min) || 2));

  // Clientes para recompra: agrupados por los últimos 10 dígitos del teléfono
  // (igual que la analítica), con su consentimiento de marketing más reciente.
  const lapsed = (
    await db.execute<{
      phone10: string;
      nombre: string;
      pedidos: string;
      gastado: string;
      ultimo: string;
      dias: number;
      marketing: boolean;
      customerid: string | null;
    }>(
      sql`
        with sold as (
          select
            right(regexp_replace(o.contact_phone,'[^0-9]','','g'),10) as phone10,
            o.contact_name, o.total_cop, o.created_at
          from orders o
          where ${sql.raw(SOLD)}
            and length(right(regexp_replace(o.contact_phone,'[^0-9]','','g'),10)) = 10
        ),
        agg as (
          select phone10,
                 count(*) as pedidos,
                 sum(total_cop) as gastado,
                 max(created_at) as ultimo,
                 (array_agg(contact_name order by created_at desc))[1] as nombre
          from sold group by phone10
        ),
        mkt as (
          select distinct on (phone10) phone10, granted from (
            select right(regexp_replace(c.phone,'[^0-9]','','g'),10) as phone10,
                   cons.granted, cons.created_at
            from consents cons join customers c on c.id = cons.customer_id
            where cons.kind = 'marketing_whatsapp'
          ) s
          order by phone10, created_at desc
        ),
        cust as (
          -- Ficha del cliente por teléfono (independiente de si ya dio o no
          -- consentimiento): así el botón de baja/alta aparece para cualquier
          -- cliente con cuenta, no solo para quienes ya tienen un consent.
          select distinct on (phone10) phone10, customer_id from (
            select right(regexp_replace(phone,'[^0-9]','','g'),10) as phone10,
                   id as customer_id, created_at
            from customers
          ) x
          order by phone10, created_at desc
        )
        select a.phone10, a.nombre, a.pedidos, a.gastado, a.ultimo::text as ultimo,
               extract(day from now() - a.ultimo)::int as dias,
               coalesce(m.granted, false) as marketing,
               cu.customer_id as customerid
        from agg a
        left join mkt m using (phone10)
        left join cust cu using (phone10)
        where a.pedidos >= ${minOrders}
          and a.ultimo < now() - (${String(days)} || ' days')::interval
        order by a.gastado desc
        limit 100
      `,
    )
  ).rows;

  // Cupón PERSONAL más reciente por cliente (estilo Owner): si está vigente,
  // el mensaje lo usa en lugar del cupón de campaña; si ya lo canjeó, se
  // muestra el logro y se puede crear otro.
  const customerIds = [...new Set(lapsed.map((r) => r.customerid).filter((v): v is string => !!v))];
  type PersonalCoupon = {
    code: string;
    percent: number;
    expiresAt: Date | null;
    status: "activo" | "canjeado" | "vencido";
  };
  const personalByCustomer = new Map<string, PersonalCoupon>();
  if (customerIds.length > 0) {
    const rows = await db
      .select({
        customerId: coupons.customerId,
        code: coupons.code,
        usedCount: coupons.usedCount,
        maxUses: coupons.maxUses,
        expiresAt: coupons.expiresAt,
        value: promotions.value,
        isActive: promotions.isActive,
      })
      .from(coupons)
      .innerJoin(promotions, eq(coupons.promotionId, promotions.id))
      .where(inArray(coupons.customerId, customerIds));
    const now = Date.now();
    for (const c of rows) {
      const status: PersonalCoupon["status"] =
        c.usedCount >= c.maxUses
          ? "canjeado"
          : !c.isActive || (c.expiresAt && c.expiresAt.getTime() < now)
            ? "vencido"
            : "activo";
      const entry: PersonalCoupon = {
        code: c.code,
        percent: Math.round(c.value / 100),
        expiresAt: c.expiresAt,
        status,
      };
      // Preferencia: uno activo gana; si no hay activo, el canjeado; luego vencido.
      const prev = personalByCustomer.get(c.customerId!);
      const rank = { activo: 2, canjeado: 1, vencido: 0 } as const;
      if (!prev || rank[status] > rank[prev.status]) personalByCustomer.set(c.customerId!, entry);
    }
  }

  // Un cupón activo para sugerir en el mensaje (a quien autoriza marketing).
  const promoRows = (
    await db.execute<{ code: string; kind: string; value: number }>(
      sql`
        select c.code, p.kind, p.value
        from promotions p join coupons c on c.promotion_id = p.id
        where p.is_active
          and (p.starts_at is null or p.starts_at <= now())
          and (p.ends_at is null or p.ends_at >= now())
          and (p.max_uses is null or p.used_count < p.max_uses)
          and (p.budget_cop is null or p.spent_cop < p.budget_cop)
          and p.kind in ('percent','fixed','free_delivery')
        order by p.starts_at desc nulls last
        limit 1
      `,
    )
  ).rows;
  const promo = promoRows[0] ?? null;

  // Carritos abandonados / pagos fallidos recientes.
  const carts = (
    await db.execute<{
      id: string;
      number: string;
      contact_name: string;
      contact_phone: string;
      total_cop: number;
      status: string;
      created_at: string;
    }>(
      sql`
        select o.id, o.number, o.contact_name, o.contact_phone, o.total_cop, o.status,
               o.created_at::text as created_at
        from orders o
        where (o.status = 'pending_payment' and o.created_at < now() - interval '45 minutes')
           or (o.status = 'failed' and o.created_at > now() - interval '48 hours')
        order by o.created_at desc
        limit 50
      `,
    )
  ).rows;

  const withConsent = lapsed.filter((r) => r.marketing).length;

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-extrabold text-ink">💜 Retención</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Recupera clientes que dejaron de pedir y rescata carritos a medias — hoy mismo, con un mensaje
        de WhatsApp listo (el botón abre el chat con el texto escrito). Las ofertas solo se sugieren a
        quien autorizó recibir marketing; a los demás, un saludo de servicio.
      </p>

      {/* Controles */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-brand-soft bg-white p-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-soft uppercase">Inactivo hace</span>
          {DAYS_PRESETS.map((d) => (
            <Link
              key={d}
              href={`/admin/retencion?dias=${d}&min=${minOrders}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                days === d ? "bg-brand text-white" : "border border-brand-soft text-brand-dark hover:bg-brand-soft"
              }`}
            >
              {d} días
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-soft uppercase">Mínimo</span>
          {MIN_PRESETS.map((m) => (
            <Link
              key={m}
              href={`/admin/retencion?dias=${days}&min=${m}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                minOrders === m ? "bg-brand text-white" : "border border-brand-soft text-brand-dark hover:bg-brand-soft"
              }`}
            >
              {m}+ pedidos
            </Link>
          ))}
        </div>
      </div>

      {/* Recompra */}
      <section className="mb-6 rounded-card border border-brand-soft bg-white p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold text-ink">🔁 Para recompra ({lapsed.length})</h2>
          <span className="text-xs text-ink-soft">{withConsent} autorizan marketing</span>
        </div>
        <p className="mb-3 text-xs text-ink-soft">
          Clientes con {minOrders}+ pedidos que no compran hace {days}+ días, del más valioso al menos.
          {promo && (
            <>
              {" "}
              Cupón sugerido: <span className="font-mono font-semibold text-brand-dark">{promo.code}</span> (
              {describePromo(promo.kind, promo.value)}).
            </>
          )}
        </p>
        {lapsed.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft">
            Nadie cae en este filtro. Prueba con más días o menos pedidos mínimos.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-brand-soft text-xs text-ink-soft uppercase">
                <tr>
                  <th className="py-2 pr-3">Cliente</th>
                  <th className="py-2 pr-3">Pedidos</th>
                  <th className="py-2 pr-3">Gastado</th>
                  <th className="py-2 pr-3">Sin pedir</th>
                  <th className="py-2 pr-3">Marketing</th>
                  <th className="py-2 pr-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-soft">
                {lapsed.map((r) => {
                  const personal = r.customerid ? personalByCustomer.get(r.customerid) : undefined;
                  const personalActive = personal?.status === "activo" ? personal : null;
                  // Prioridad del mensaje: cupón personal vigente > cupón de campaña.
                  const promoLine = !r.marketing
                    ? ""
                    : personalActive
                      ? `Te dejamos un cupón SOLO para ti: ${personalActive.code} (${personalActive.percent}% de descuento${personalActive.expiresAt ? `, válido hasta el ${fmtDay(personalActive.expiresAt)}` : ""}). `
                      : promo
                        ? `Usa el código ${promo.code} y llévate ${describePromo(promo.kind, promo.value)}. `
                        : "";
                  const msg = r.marketing
                    ? `¡Hola ${firstName(r.nombre)}! 💜 En Market Castilla te extrañamos — hace ${r.dias} días que no pedías. ${promoLine}¿Te preparamos algo hoy? Contra entrega o para recoger 🛒`
                    : `¡Hola ${firstName(r.nombre)}! 👋 Te saludamos desde Market Castilla. Si necesitas algo del mercado, con gusto te ayudamos 🛒`;
                  return (
                    <tr key={r.phone10}>
                      <td className="py-2 pr-3">
                        <span className="font-semibold text-ink">{r.nombre || "Cliente"}</span>
                        <br />
                        <span className="text-xs text-ink-soft">{r.phone10}</span>
                      </td>
                      <td className="py-2 pr-3">{r.pedidos}</td>
                      <td className="py-2 pr-3">{formatCop(Number(r.gastado))}</td>
                      <td className="py-2 pr-3">{r.dias} días</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-col items-start gap-1">
                          {r.marketing ? (
                            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">✅ Autoriza</span>
                          ) : (
                            <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink-soft">⚪ Sin permiso</span>
                          )}
                          {/* Registrar la baja/alta que el cliente pidió por cualquier canal.
                              Aparece para cualquier cliente con ficha (customerId): el
                              consentimiento se ancla a ella. */}
                          {r.customerid && (
                            <form action={adminSetMarketingConsentAction}>
                              <input type="hidden" name="customerId" value={r.customerid} />
                              <input type="hidden" name="granted" value={r.marketing ? "false" : "true"} />
                              <button
                                type="submit"
                                className="text-[11px] text-ink-soft underline underline-offset-2 hover:text-coral-dark"
                              >
                                {r.marketing ? "🔕 Dar de baja" : "🔔 Activar ofertas"}
                              </button>
                            </form>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <a
                            href={wa(r.phone10, msg)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn inline-block rounded-full bg-[#25D366] px-3 py-1 text-xs font-bold text-white"
                          >
                            💬 Escribir
                          </a>
                          {/* Cupón personal (un solo uso, 7 días). Solo con
                              consentimiento: la oferta viaja por WhatsApp. */}
                          {r.marketing && r.customerid && (
                            personalActive ? (
                              <span
                                className="rounded-full bg-sun/30 px-2 py-0.5 font-mono text-[11px] font-semibold text-ink"
                                title={personalActive.expiresAt ? `Vence el ${fmtDay(personalActive.expiresAt)}` : undefined}
                              >
                                🎁 {personalActive.code}
                                {personalActive.expiresAt ? ` · vence ${fmtDay(personalActive.expiresAt)}` : ""}
                              </span>
                            ) : (
                              <form action={createPersonalCouponAction} className="flex items-center gap-1">
                                <input type="hidden" name="customerId" value={r.customerid} />
                                {personal?.status === "canjeado" && (
                                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand-dark" title={`Canjeó ${personal.code}`}>
                                    ✅ canjeó
                                  </span>
                                )}
                                <select
                                  name="percent"
                                  defaultValue="10"
                                  aria-label="Porcentaje del cupón personal"
                                  className="rounded border border-brand-soft bg-white px-1 py-0.5 text-[11px]"
                                >
                                  <option value="10">10%</option>
                                  <option value="15">15%</option>
                                  <option value="20">20%</option>
                                </select>
                                <button
                                  type="submit"
                                  className="btn rounded-full border border-brand px-2 py-0.5 text-[11px] font-bold text-brand-dark hover:bg-brand-soft"
                                >
                                  🎁 Cupón personal
                                </button>
                              </form>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Carritos abandonados */}
      <section className="rounded-card border border-sun bg-sun/15 p-4">
        <h2 className="font-bold text-ink">🛟 Carritos abandonados ({carts.length})</h2>
        <p className="mb-3 text-xs text-ink-soft">
          Checkouts que quedaron a medias (pago pendiente hace 45+ min) o pagos fallidos de las últimas
          48 horas. Un mensaje a tiempo recupera la venta.
        </p>
        {carts.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-soft">Sin carritos por rescatar ahora mismo. 🎉</p>
        ) : (
          <ul className="space-y-1.5">
            {carts.map((o) => {
              const phone10 = o.contact_phone.replace(/[^0-9]/g, "").slice(-10);
              const msg = `¡Hola ${firstName(o.contact_name)}! 👋 Vimos que tu pedido ${o.number} en Market Castilla quedó a medias (${formatCop(o.total_cop)}). ¿Te ayudamos a completarlo? También puedes pagar contra entrega si lo prefieres 🛵`;
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/admin/pedidos/${o.id}`} className="font-semibold text-brand-dark hover:underline">
                    {o.number}
                  </Link>
                  <span>{o.contact_name}</span>
                  <span className="text-ink-soft">{formatCop(o.total_cop)}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-ink-soft">
                    {o.status === "failed" ? "Pago fallido" : "Pago pendiente"}
                  </span>
                  {phone10.length === 10 && (
                    <a
                      href={wa(phone10, msg)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn ml-auto rounded-full bg-[#25D366] px-3 py-1 text-xs font-bold text-white"
                    >
                      💬 Rescatar por WhatsApp
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
