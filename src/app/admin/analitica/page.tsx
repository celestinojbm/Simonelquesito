import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { formatCop } from "@/lib/format";
import { DashboardTabs } from "../dashboard-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analítica · Admin" };

/**
 * Analítica con periodo seleccionable: pestañas 7/15/30/90 días o rango
 * personalizado (?desde=YYYY-MM-DD&hasta=YYYY-MM-DD, máximo un año).
 * "Venta" = pedido que superó el pago (paid→delivered); cancelados/fallidos/
 * pendientes quedan fuera. Fechas y horas en zona de Bogotá (sin DST → -05:00).
 *
 * Gráficas: barras SVG de una sola serie (verde de marca validado contra la
 * superficie), texto en tinta, tooltip nativo por barra y tabla accesible.
 * Periodos largos (> 92 días) se agrupan por semana para que las barras
 * sigan siendo legibles.
 */

const SOLD = sql`o.status in ('paid','confirmed','preparing','awaiting_substitution','weight_adjustment_pending','ready','assigned','out_for_delivery','delivered')`;
const TZ = sql`(o.created_at at time zone 'America/Bogota')`;

const PRESETS = [1, 7, 15, 30, 90] as const;
const presetLabel = (p: number) => (p === 1 ? "Hoy" : `${p} días`);
const MAX_DAYS = 365;

const isYmd = (s: string | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const bogotaToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });

/** Suma días a una fecha YYYY-MM-DD (aritmética en UTC — sin sorpresas de TZ). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const fmtDate = (ymd: string, withYear = false) =>
  new Date(`${ymd}T12:00:00-05:00`).toLocaleDateString("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });

async function q<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

/** Barras verticales (una serie). Alto fijo; tooltip nativo por barra. */
function Bars({
  data,
  labelEvery = 1,
  formatValue,
  title,
}: {
  data: { label: string; value: number; hint: string }[];
  labelEvery?: number;
  formatValue: (v: number) => string;
  title: string;
}) {
  const W = 720;
  const H = 180;
  const PAD_B = 22;
  const PAD_T = 18;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length || 1;
  const gap = n > 60 ? 1 : 2;
  const bw = Math.max(2, Math.floor((W - gap * (n - 1)) / n));
  const maxIdx = data.findIndex((d) => d.value === max);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="w-full">
        {/* rejilla recesiva */}
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={PAD_T + (H - PAD_T - PAD_B) * (1 - f)} y2={PAD_T + (H - PAD_T - PAD_B) * (1 - f)} stroke="#e5e9e6" strokeWidth={1} />
        ))}
        {data.map((d, i) => {
          const h = Math.round(((H - PAD_T - PAD_B) * d.value) / max);
          const x = i * (bw + gap);
          const y = H - PAD_B - h;
          return (
            <g key={`${d.label}-${i}`}>
              <rect x={x} y={y} width={bw} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={Math.min(3, Math.floor(bw / 2))} fill="var(--color-brand)">
                <title>{d.hint}</title>
              </rect>
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize={10} fill="#4b5a52">
                  {d.label}
                </text>
              )}
              {i === maxIdx && d.value > 0 && (
                <text x={Math.min(Math.max(x + bw / 2, 24), W - 30)} y={Math.max(y - 5, 11)} textAnchor="middle" fontSize={11} fontWeight={700} fill="#17231d">
                  {formatValue(d.value)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="#c9d4cd" strokeWidth={1} />
      </svg>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-ink-soft">Ver datos en tabla</summary>
        <table className="mt-1 w-full text-xs">
          <thead><tr className="text-left text-ink-soft"><th className="py-0.5">Periodo</th><th>Valor</th></tr></thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${d.label}-${i}`}><td className="py-0.5">{d.hint.split(":")[0]}</td><td>{formatValue(d.value)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Filas con barra horizontal etiquetada (ranking). */
function BarRows({ rows, formatValue }: { rows: { name: string; value: number; extra?: string }[]; formatValue: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.name} className="text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="shrink-0 font-semibold text-ink">{formatValue(r.value)}{r.extra ? <span className="ml-1 font-normal text-ink-soft">({r.extra})</span> : null}</span>
          </div>
          <div className="mt-0.5 h-2 rounded-full bg-brand-soft">
            <div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, Math.round((r.value / max) * 100))}%` }} />
          </div>
        </li>
      ))}
      {rows.length === 0 && <li className="text-sm text-ink-soft">Sin datos en el periodo.</li>}
    </ul>
  );
}

const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  const today = bogotaToday();

  // Resolución del periodo: rango personalizado (validado y acotado a un año)
  // o pestaña predefinida (7/15/30/90; 30 por defecto).
  let desde: string;
  let hasta: string;
  let preset: number | null = null;
  if (isYmd(sp.desde) && isYmd(sp.hasta)) {
    hasta = sp.hasta > today ? today : sp.hasta;
    desde = sp.desde > hasta ? hasta : sp.desde;
    if (diffDays(desde, hasta) + 1 > MAX_DAYS) desde = addDays(hasta, -(MAX_DAYS - 1));
    const days = diffDays(desde, hasta) + 1;
    if (hasta === today && (PRESETS as readonly number[]).includes(days)) preset = days;
  } else {
    preset = (PRESETS as readonly number[]).includes(Number(sp.p)) ? Number(sp.p) : 30;
    hasta = today;
    desde = addDays(hasta, -(preset - 1));
  }
  const nDays = diffDays(desde, hasta) + 1;

  // Rango cerrado en Bogotá: [desde 00:00, hasta+1día 00:00)
  const fromTs = `${desde}T00:00:00-05:00`;
  const toTsExcl = `${addDays(hasta, 1)}T00:00:00-05:00`;
  const RANGE = sql`o.created_at >= ${fromTs}::timestamptz and o.created_at < ${toTsExcl}::timestamptz`;

  const [summary] = await q<{ ventas: string; pedidos: string; ticket: string; clientes: string }>(sql`
    select coalesce(sum(o.total_cop),0) as ventas, count(*) as pedidos,
           coalesce(avg(o.total_cop),0)::int as ticket,
           count(distinct right(regexp_replace(o.contact_phone,'[^0-9]','','g'),10)) as clientes
    from orders o
    where ${SOLD} and ${RANGE}
  `);

  const [repeat] = await q<{ recurrentes: string; total: string }>(sql`
    select count(*) filter (where n >= 2) as recurrentes, count(*) as total
    from (
      select right(regexp_replace(o.contact_phone,'[^0-9]','','g'),10) ph, count(*) n
      from orders o
      where ${SOLD} and ${RANGE}
      group by 1
    ) t
  `);

  const byDay = await q<{ dia: string; ventas: string; pedidos: string }>(sql`
    select to_char(${TZ}::date, 'YYYY-MM-DD') as dia, sum(o.total_cop) as ventas, count(*) as pedidos
    from orders o
    where ${SOLD} and ${RANGE}
    group by 1 order by 1
  `);

  const byHour = await q<{ hora: string; pedidos: string }>(sql`
    select extract(hour from ${TZ})::int as hora, count(*) as pedidos
    from orders o
    where ${SOLD} and ${RANGE}
    group by 1 order by 1
  `);

  const topProducts = await q<{ nombre: string; ingresos: string; unidades: string; porpeso: boolean }>(sql`
    select i.name_snapshot as nombre, sum(i.line_total_cop) as ingresos,
           sum(i.qty) as unidades, bool_or(i.sale_unit_snapshot in ('kg','g')) as porpeso
    from order_items i join orders o on o.id = i.order_id
    where ${SOLD} and ${RANGE}
    group by 1 order by 2 desc limit 10
  `);

  const byChannel = await q<{ canal: string; ventas: string; pedidos: string }>(sql`
    select o.channel as canal, sum(o.total_cop) as ventas, count(*) as pedidos
    from orders o
    where ${SOLD} and ${RANGE}
    group by 1 order by 2 desc
  `);

  const topCustomers = await q<{ nombre: string; ventas: string; pedidos: string }>(sql`
    select max(o.contact_name) as nombre, sum(o.total_cop) as ventas, count(*) as pedidos
    from orders o
    where ${SOLD} and ${RANGE}
    group by right(regexp_replace(o.contact_phone,'[^0-9]','','g'),10)
    order by 2 desc limit 5
  `);

  // Serie de ventas: diaria hasta ~3 meses; semanal (lunes a domingo) para
  // periodos largos, para que las barras sigan siendo legibles.
  const daily = nDays <= 92;
  const series: { label: string; value: number; hint: string }[] = [];
  if (daily) {
    for (let i = 0; i < nDays; i++) {
      const key = addDays(desde, i);
      const row = byDay.find((r) => r.dia === key);
      const dowIdx = new Date(`${key}T12:00:00-05:00`).getUTCDay();
      series.push({
        label: `${DOW[dowIdx]} ${key.slice(8)}`,
        value: Number(row?.ventas ?? 0),
        hint: `${DOW[dowIdx]} ${key.slice(8, 10)}/${key.slice(5, 7)}: ${formatCop(Number(row?.ventas ?? 0))} (${row?.pedidos ?? 0} pedidos)`,
      });
    }
  } else {
    const weekOf = (ymd: string) => {
      const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
      return addDays(ymd, -((dow + 6) % 7)); // lunes de esa semana
    };
    const weeks = new Map<string, { ventas: number; pedidos: number }>();
    for (let i = 0; i < nDays; i += 1) {
      const w = weekOf(addDays(desde, i));
      if (!weeks.has(w)) weeks.set(w, { ventas: 0, pedidos: 0 });
    }
    for (const r of byDay) {
      const w = weekOf(r.dia);
      const acc = weeks.get(w) ?? { ventas: 0, pedidos: 0 };
      acc.ventas += Number(r.ventas);
      acc.pedidos += Number(r.pedidos);
      weeks.set(w, acc);
    }
    for (const [w, acc] of [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      series.push({
        label: `${w.slice(8, 10)}/${w.slice(5, 7)}`,
        value: acc.ventas,
        hint: `Semana del ${w.slice(8, 10)}/${w.slice(5, 7)}: ${formatCop(acc.ventas)} (${acc.pedidos} pedidos)`,
      });
    }
  }
  const seriesLabelEvery = Math.max(1, Math.ceil(series.length / 13));

  const hours = Array.from({ length: 24 }, (_, h) => {
    const row = byHour.find((r) => Number(r.hora) === h);
    return { label: `${h}`, value: Number(row?.pedidos ?? 0), hint: `${h}:00 – ${h}:59: ${row?.pedidos ?? 0} pedidos` };
  });

  const CHANNEL_ES: Record<string, string> = {
    web_pwa: "Web (PWA)", whatsapp: "WhatsApp (bot)", subscription: "Canastas recurrentes",
    manual: "Manual", pos_physical: "Tienda física", rappi: "Rappi", didi: "DiDi", social: "Redes",
  };

  const pctRecompra = Number(repeat?.total ?? 0) > 0
    ? Math.round((Number(repeat!.recurrentes) / Number(repeat!.total)) * 100)
    : 0;

  const tabCls = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
      active ? "bg-brand text-white" : "border border-brand-soft bg-white text-ink-soft hover:border-brand hover:text-brand-dark"
    }`;

  return (
    <div className="max-w-4xl space-y-5">
      <DashboardTabs />
      <div>
        <p className="text-sm text-ink-soft">
          {nDays === 1 && hasta === today
            ? <>Hoy, {fmtDate(hasta, true)} · 1 día</>
            : <>Del {fmtDate(desde, desde.slice(0, 4) !== hasta.slice(0, 4))} al {fmtDate(hasta, true)} · {nDays} día{nDays === 1 ? "" : "s"}</>}
          {" "}(ventas = pedidos con pago superado; hora de Bogotá).
        </p>
      </div>

      {/* Selector de periodo: pestañas + rango personalizado (máx. un año) */}
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-brand-soft bg-white p-3">
        {PRESETS.map((p) => (
          <Link key={p} href={`/admin/analitica?p=${p}`} className={tabCls(preset === p)}>
            {presetLabel(p)}
          </Link>
        ))}
        <form method="get" action="/admin/analitica" className="ml-auto flex flex-wrap items-center gap-1.5">
          <label className="text-xs text-ink-soft" htmlFor="an-desde">Del</label>
          <input
            id="an-desde"
            type="date"
            name="desde"
            defaultValue={desde}
            max={today}
            required
            className="rounded-lg border border-brand-soft bg-white px-2 py-1 text-xs focus:border-brand"
          />
          <label className="text-xs text-ink-soft" htmlFor="an-hasta">al</label>
          <input
            id="an-hasta"
            type="date"
            name="hasta"
            defaultValue={hasta}
            max={today}
            required
            className="rounded-lg border border-brand-soft bg-white px-2 py-1 text-xs focus:border-brand"
          />
          <button type="submit" className={tabCls(preset === null)}>
            Aplicar
          </button>
          <span className="w-full text-right text-[10px] text-ink-soft sm:w-auto">máx. un año</span>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { k: "Ventas", v: formatCop(Number(summary?.ventas ?? 0)) },
          { k: "Pedidos", v: String(summary?.pedidos ?? 0) },
          { k: "Ticket promedio", v: formatCop(Number(summary?.ticket ?? 0)) },
          { k: "Clientes únicos", v: String(summary?.clientes ?? 0) },
          { k: "Recompra", v: `${pctRecompra}%` },
        ].map((t) => (
          <div key={t.k} className="rounded-card border border-brand-soft bg-white p-3">
            <p className="text-xs text-ink-soft uppercase">{t.k}</p>
            <p className="text-lg font-extrabold text-ink">{t.v}</p>
          </div>
        ))}
      </div>

      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-2 font-bold text-ink">Ventas por {daily ? "día" : "semana"}</h2>
        <Bars
          data={series}
          labelEvery={seriesLabelEvery}
          formatValue={formatCop}
          title={`Ventas por ${daily ? "día" : "semana"} en COP en el periodo seleccionado`}
        />
      </section>

      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-2 font-bold text-ink">Pedidos por hora del día</h2>
        <p className="mb-1 text-xs text-ink-soft">Para cuadrar turnos y compras: aquí se ven las horas pico del periodo.</p>
        <Bars data={hours} labelEvery={3} formatValue={(v) => `${v} pedidos`} title="Pedidos por hora del día en el periodo seleccionado" />
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-card border border-brand-soft bg-white p-4">
          <h2 className="mb-2 font-bold text-ink">Top 10 productos por ingresos</h2>
          <BarRows
            rows={topProducts.map((p) => ({
              name: p.nombre,
              value: Number(p.ingresos),
              extra: p.porpeso ? `${(Number(p.unidades) / 500).toFixed(1)} lb` : `${p.unidades} und`,
            }))}
            formatValue={formatCop}
          />
        </section>

        <section className="space-y-5">
          <div className="rounded-card border border-brand-soft bg-white p-4">
            <h2 className="mb-2 font-bold text-ink">Ventas por canal</h2>
            <BarRows
              rows={byChannel.map((c) => ({
                name: CHANNEL_ES[c.canal] ?? c.canal,
                value: Number(c.ventas),
                extra: `${c.pedidos} pedidos`,
              }))}
              formatValue={formatCop}
            />
          </div>
          <div className="rounded-card border border-brand-soft bg-white p-4">
            <h2 className="mb-2 font-bold text-ink">Mejores clientes</h2>
            <BarRows
              rows={topCustomers.map((c) => ({ name: c.nombre, value: Number(c.ventas), extra: `${c.pedidos} pedidos` }))}
              formatValue={formatCop}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
