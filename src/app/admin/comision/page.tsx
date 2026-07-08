import { computeCommissionForRange } from "@/modules/commission/service";
import { getSetting } from "@/modules/config/service";
import { formatCop } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comisión digital · Admin" };

const CHANNEL_LABELS: Record<string, string> = {
  web_pwa: "Web / PWA",
  whatsapp: "WhatsApp",
  rappi: "Rappi",
  didi: "DiDi",
  social: "Redes sociales",
  manual: "Pedido manual",
  pos_physical: "POS físico",
};

export default async function AdminCommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period = "month" } = await searchParams;
  const now = new Date();
  const start = new Date(now);
  if (period === "week") start.setDate(now.getDate() - 7);
  else if (period === "fortnight") start.setDate(now.getDate() - 15);
  else start.setDate(now.getDate() - 30);

  const [breakdown, config] = await Promise.all([
    computeCommissionForRange(start, now),
    getSetting("commission.base"),
  ]);

  const rows: [string, number, string?][] = [
    ["Venta bruta de mercancía (pedidos entregados)", breakdown.grossSalesCop],
    ["(−) Descuentos", -breakdown.discountsCop, config.deductDiscounts ? "se deduce" : "no se deduce"],
    ["Cancelaciones (informativo, fuera de la base)", -breakdown.cancellationsCop, "informativo"],
    ["(−) Reembolsos", -breakdown.refundsCop, config.deductRefunds ? "se deduce" : "no se deduce"],
    ["Impuestos", breakdown.taxesCop, config.includeTax ? "incluido" : "excluido"],
    ["Envío", breakdown.deliveryCop, config.includeDelivery ? "incluido" : "excluido"],
    ["Propinas", breakdown.tipsCop, config.includeTip ? "incluido" : "excluido"],
    ["(−) Comisión de pasarela", -breakdown.gatewayFeesCop, config.deductGatewayFees ? "se deduce" : "no se deduce"],
    ["(−) Comisión de marketplace", -breakdown.marketplaceFeesCop, config.deductMarketplaceFees ? "se deduce" : "no se deduce"],
  ];

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-extrabold text-ink">Comisión sobre ventas digitales</h1>
      <p className="text-sm text-ink-soft">
        Cálculo <strong>100% transparente y configurable</strong>. La base y el porcentaje se definen en
        Configuración (clave <code className="rounded bg-brand-soft px-1">commission.base</code>) y cada
        cierre de periodo requiere aprobación del propietario.
      </p>

      <nav className="flex gap-2 text-sm" aria-label="Periodo">
        {[["week", "Semanal"], ["fortnight", "Quincenal"], ["month", "Mensual"]].map(([key, label]) => (
          <a
            key={key}
            href={`/admin/comision?period=${key}`}
            className={`btn rounded-full px-4 py-2 font-semibold ${period === key ? "bg-brand text-white" : "border border-brand-soft text-ink-soft hover:bg-brand-soft"}`}
          >
            {label}
          </a>
        ))}
      </nav>

      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-2 font-bold text-ink">
          Desglose ({start.toLocaleDateString("es-CO")} — {now.toLocaleDateString("es-CO")})
        </h2>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-brand-soft">
            {rows.map(([label, value, note]) => (
              <tr key={label}>
                <td className="py-1.5">{label}{note && <span className="ml-1 text-xs text-ink-soft">({note})</span>}</td>
                <td className={`py-1.5 text-right font-medium ${value < 0 ? "text-coral-dark" : ""}`}>
                  {formatCop(value)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-brand">
              <td className="py-2 font-bold">Venta neta de mercancía (base de comisión)</td>
              <td className="py-2 text-right font-bold">{formatCop(breakdown.netMerchandiseCop)}</td>
            </tr>
            <tr>
              <td className="py-1.5">Porcentaje aplicable</td>
              <td className="py-1.5 text-right font-medium">{(breakdown.ratePctBps / 100).toFixed(2)}%</td>
            </tr>
            <tr className="bg-brand-soft/60">
              <td className="py-2 text-base font-extrabold text-brand-dark">Comisión resultante</td>
              <td className="py-2 text-right text-base font-extrabold text-brand-dark">
                {formatCop(breakdown.commissionCop)}
              </td>
            </tr>
            {/* Split de Mercado Pago: lo ya cobrado en la fuente no se
                vuelve a liquidar manualmente. */}
            {breakdown.splitSettledCop > 0 && (
              <>
                <tr>
                  <td className="py-1.5">
                    (−) Liquidada en la fuente (split Mercado Pago)
                    <span className="ml-1 text-xs text-ink-soft">({breakdown.splitOrdersCount} pedido{breakdown.splitOrdersCount === 1 ? "" : "s"})</span>
                  </td>
                  <td className="py-1.5 text-right font-medium text-coral-dark">{formatCop(-breakdown.splitSettledCop)}</td>
                </tr>
                <tr className="bg-sun/30">
                  <td className="py-2 font-extrabold">Por liquidar manualmente</td>
                  <td className="py-2 text-right font-extrabold">{formatCop(breakdown.commissionDueCop)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-soft">
          Pedidos atribuibles en el periodo: {breakdown.ordersCount} · Canales que forman la base:{" "}
          {config.channels.map((c) => CHANNEL_LABELS[c] ?? c).join(", ")}.
        </p>
      </section>

      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-2 font-bold text-ink">Por canal</h2>
        {Object.keys(breakdown.byChannel).length === 0 ? (
          <p className="text-sm text-ink-soft">Sin ventas digitales entregadas en el periodo.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-soft uppercase">
              <tr><th className="py-1">Canal</th><th className="py-1 text-right">Pedidos</th><th className="py-1 text-right">Venta neta</th></tr>
            </thead>
            <tbody className="divide-y divide-brand-soft">
              {Object.entries(breakdown.byChannel).map(([channel, data]) => (
                <tr key={channel}>
                  <td className="py-1.5">{CHANNEL_LABELS[channel] ?? channel}</td>
                  <td className="py-1.5 text-right">{data.orders}</td>
                  <td className="py-1.5 text-right font-medium">{formatCop(data.netCop)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
