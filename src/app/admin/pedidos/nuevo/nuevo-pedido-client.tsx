"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { posLookupAction, posSearchAction, type PosItem } from "@/app/actions/pos";
import { createInternalOrderAction } from "@/app/actions/internal-order";

type TicketLine = {
  variantId: string;
  name: string;
  soldByWeight: boolean;
  priceCop: number; // por unidad, o por kg/l si es de peso/volumen variable
  qty: number; // unidades, o gramos/ml si es de peso/volumen
  isRestricted: boolean;
};

const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;
const lineTotal = (l: TicketLine) =>
  l.soldByWeight ? Math.round((l.priceCop * l.qty) / 1000) : l.priceCop * l.qty;

const PAYMENT_METHODS = [
  { value: "cash_on_delivery", label: "💵 Efectivo (contraentrega)" },
  { value: "card_on_delivery", label: "💳 Datáfono (contraentrega)" },
  { value: "bank_transfer", label: "📲 Transferencia" },
  { value: "sandbox", label: "🔗 Link de pago (por adelantado)" },
] as const;

export function NuevoPedidoClient({ zones }: { zones: { id: string; name: string }[] }) {
  const [ticket, setTicket] = useState<TicketLine[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PosItem[]>([]);
  const [grams, setGrams] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [addressLine, setAddressLine] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [instructions, setInstructions] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]["value"]>("cash_on_delivery");
  const [dataConsent, setDataConsent] = useState(false);
  const [idemKey] = useState(() => crypto.randomUUID());

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastOrder, setLastOrder] = useState<{ number: string; totalCop: number; redirectUrl: string | null } | null>(null);

  const doSearch = async () => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    const r = await posSearchAction(q);
    if (r.ok) setResults(r.items);
  };
  useEffect(() => {
    const t = setTimeout(() => { void doSearch(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const addItem = (item: PosItem, qty: number) => {
    setTicket((t) => {
      const i = t.findIndex((l) => l.variantId === item.variantId && !l.soldByWeight);
      if (i >= 0 && !item.soldByWeight) return t.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l));
      return [...t, {
        variantId: item.variantId, name: `${item.productName} — ${item.variantName}`,
        soldByWeight: item.soldByWeight, priceCop: item.priceCop, qty, isRestricted: item.isRestricted,
      }];
    });
  };

  const addByCode = async (code: string) => {
    const r = await posLookupAction(code);
    if (r.ok && !r.item.soldByWeight) addItem(r.item, 1);
  };

  const addWeighed = (item: PosItem) => {
    const g = parseInt(grams, 10);
    if (!Number.isInteger(g) || g <= 0) { setMessage({ ok: false, text: "Digita los gramos/ml a vender." }); return; }
    addItem(item, g);
    setGrams(""); setResults([]); setSearch("");
  };

  const total = useMemo(() => ticket.reduce((acc, l) => acc + lineTotal(l), 0), [ticket]);

  const submit = () => {
    if (ticket.length === 0) { setMessage({ ok: false, text: "Agrega al menos un producto." }); return; }
    if (!contactName.trim() || contactPhone.trim().length < 7) {
      setMessage({ ok: false, text: "Nombre y teléfono del cliente son requeridos." });
      return;
    }
    if (fulfillment === "delivery" && (!zoneId || !addressLine.trim() || !neighborhood.trim())) {
      setMessage({ ok: false, text: "Para domicilio: zona, dirección y barrio son requeridos." });
      return;
    }
    if (!dataConsent) {
      setMessage({ ok: false, text: "Confirma que el cliente autorizó el tratamiento de sus datos." });
      return;
    }
    setBusy(true);
    setMessage(null);
    createInternalOrderAction({
      items: ticket.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      fulfillment,
      contactName,
      contactPhone,
      ...(fulfillment === "delivery" ? { zoneId, addressLine, neighborhood } : {}),
      instructions: instructions || undefined,
      paymentMethod,
      dataConsent,
      idempotencyKey: idemKey,
    })
      .then((r) => {
        if (r.ok) {
          setLastOrder({ number: r.number, totalCop: total, redirectUrl: r.redirectUrl });
          setTicket([]);
          setMessage({ ok: true, text: `Pedido ${r.number} creado.` });
        } else {
          setMessage({ ok: false, text: r.violations?.length ? `${r.message} (${r.violations.join("; ")})` : r.message });
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-4">
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm font-medium ${message.ok ? "bg-brand-soft text-brand-dark" : "bg-coral/15 text-coral-dark"}`}>
          {message.ok ? "✅ " : "⚠️ "}{message.text}
        </p>
      )}
      {lastOrder && (
        <div className="rounded-card border border-brand-soft bg-white p-4 text-sm">
          <p className="font-bold text-ink">Último pedido: {lastOrder.number} · {cop(lastOrder.totalCop)}</p>
          {lastOrder.redirectUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input readOnly value={lastOrder.redirectUrl} className="min-w-64 flex-1 rounded border border-brand-soft px-2 py-1 text-xs" />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(lastOrder.redirectUrl!)}
                className="btn rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-white"
              >
                Copiar link de pago
              </button>
            </div>
          )}
        </div>
      )}

      {/* Buscar productos */}
      <section className="space-y-2 rounded-card border border-brand-soft bg-white p-4">
        <h2 className="font-bold text-ink">🔍 Agregar productos</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addByCode(search.trim()); } }}
            placeholder="Nombre, SKU o código de barras…"
            className="min-w-52 flex-1 rounded-lg border border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand"
            aria-label="Buscar producto"
          />
          <input
            value={grams}
            onChange={(e) => setGrams(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Gramos/ml (si aplica)"
            inputMode="numeric"
            className="w-40 rounded-lg border border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand"
            aria-label="Gramos o mililitros para productos de peso variable"
          />
        </div>
        {results.length > 0 && (
          <ul className="divide-y divide-brand-soft rounded-lg border border-brand-soft">
            {results.map((r) => (
              <li key={r.variantId} className="flex items-center gap-3 p-2">
                {r.imageUrl ? (
                  <Image src={r.imageUrl} alt="" width={36} height={36} unoptimized className="h-9 w-9 shrink-0 rounded-lg border border-brand-soft bg-white object-cover" />
                ) : (
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft/50">🛒</span>
                )}
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold text-ink">{r.productName}</span>{" "}
                  <span className="text-xs text-ink-soft">
                    {r.variantName} · {r.soldByWeight ? `${cop(Math.round(r.priceCop / 2))}/lb` : cop(r.priceCop)}
                  </span>
                </span>
                {r.soldByWeight ? (
                  <button type="button" onClick={() => addWeighed(r)} className="btn rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white">
                    Agregar {grams ? `${grams} g` : "(digita gramos)"}
                  </button>
                ) : (
                  <button type="button" onClick={() => { addItem(r, 1); setResults([]); setSearch(""); }} className="btn rounded-full border border-brand px-4 py-1.5 text-xs font-bold text-brand-dark">
                    Agregar 1 und
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tiquete */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-2 font-bold text-ink">🧾 Pedido</h2>
        {ticket.length === 0 ? (
          <p className="py-3 text-center text-sm text-ink-soft">Sin productos aún.</p>
        ) : (
          <ul className="divide-y divide-brand-soft">
            {ticket.map((l, i) => (
              <li key={`${l.variantId}-${i}`} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{l.name}</span>
                  <span className="text-xs text-ink-soft">
                    {l.soldByWeight ? `${l.qty} g × ${cop(Math.round(l.priceCop / 2))}/lb` : `${l.qty} × ${cop(l.priceCop)}`}
                  </span>
                </span>
                <span className="w-20 text-right text-sm font-bold text-ink">{cop(lineTotal(l))}</span>
                <button type="button" onClick={() => setTicket((t) => t.filter((_, j) => j !== i))} className="btn rounded-full px-2 text-coral-dark hover:bg-coral/10" aria-label={`Eliminar ${l.name}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {ticket.length > 0 && (
          <p className="mt-2 flex items-baseline justify-between border-t border-brand-soft pt-2 text-lg font-extrabold text-ink">
            <span>Total</span><span>{cop(total)}</span>
          </p>
        )}
      </section>

      {/* Datos del cliente y entrega */}
      <section className="space-y-3 rounded-card border border-brand-soft bg-white p-4">
        <h2 className="font-bold text-ink">👤 Cliente y entrega</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nombre del cliente" className="rounded-lg border border-brand-soft px-3 py-2 text-sm" aria-label="Nombre del cliente" />
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Teléfono" className="rounded-lg border border-brand-soft px-3 py-2 text-sm" aria-label="Teléfono del cliente" />
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={fulfillment === "delivery"} onChange={() => setFulfillment("delivery")} /> Domicilio
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={fulfillment === "pickup"} onChange={() => setFulfillment("pickup")} /> Recogida en tienda
          </label>
        </div>
        {fulfillment === "delivery" && (
          <div className="grid gap-2 sm:grid-cols-3">
            <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="rounded-lg border border-brand-soft px-3 py-2 text-sm" aria-label="Zona de cobertura">
              {zones.length === 0 && <option value="">Sin zonas configuradas</option>}
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="Dirección" className="rounded-lg border border-brand-soft px-3 py-2 text-sm sm:col-span-2" aria-label="Dirección" />
            <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Barrio" className="rounded-lg border border-brand-soft px-3 py-2 text-sm" aria-label="Barrio" />
            <input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Indicaciones (opcional)" className="rounded-lg border border-brand-soft px-3 py-2 text-sm sm:col-span-2" aria-label="Indicaciones de entrega" />
          </div>
        )}
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)} className="rounded-lg border border-brand-soft px-3 py-2 text-sm" aria-label="Medio de pago">
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <label className="flex items-start gap-2 text-xs text-ink-soft">
          <input type="checkbox" checked={dataConsent} onChange={(e) => setDataConsent(e.target.checked)} className="mt-0.5" />
          El cliente autorizó el tratamiento de sus datos personales para procesar este pedido.
        </label>
        <button type="button" disabled={busy} onClick={submit} className="btn w-full rounded-full bg-brand py-3 font-bold text-white hover:bg-brand-dark disabled:opacity-50">
          {busy ? "Creando…" : `Crear pedido${ticket.length > 0 ? ` (${cop(total)})` : ""}`}
        </button>
      </section>
    </div>
  );
}
