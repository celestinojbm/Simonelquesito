"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { posLookupAction, posSaleAction, posSearchAction, type PosItem } from "@/app/actions/pos";
import { ScalePanel, useScaleWeight } from "@/components/scale/scale-panel";

/**
 * Cliente de la caja:
 * - Campo de escaneo SIEMPRE enfocado: la pistola USB actúa como teclado y
 *   remata con Enter → se busca el código y se agrega al tiquete (repetir el
 *   escaneo suma unidades).
 * - Pesados: se busca el producto por nombre y el peso llega SOLO desde la
 *   balanza conectada (Web Serial); también se puede digitar en gramos.
 * - «Registrar venta» crea el pedido pos_physical (pagado y entregado) con
 *   clave de idempotencia por tiquete.
 */

type TicketLine = {
  variantId: string;
  name: string;
  soldByWeight: boolean;
  priceCop: number; // por unidad, o por kg si es pesado
  qty: number; // unidades, o gramos si es pesado
  imageUrl: string | null;
  isRestricted: boolean;
};

const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;
const lineTotal = (l: TicketLine) =>
  l.soldByWeight ? Math.round((l.priceCop * l.qty) / 1000) : l.priceCop * l.qty;

export function CajaClient() {
  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scan, setScan] = useState("");
  const [ticket, setTicket] = useState<TicketLine[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [lastSale, setLastSale] = useState<{ number: string; totalCop: number } | null>(null);

  // Pesados
  const grams = useScaleWeight();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PosItem[]>([]);
  const [manualGrams, setManualGrams] = useState("");

  const focusScan = () => {
    setTimeout(() => scanRef.current?.focus(), 50);
  };
  useEffect(() => {
    focusScan();
  }, []);

  const addItem = (item: PosItem, qty: number) => {
    setTicket((t) => {
      const i = t.findIndex((l) => l.variantId === item.variantId && !l.soldByWeight);
      if (i >= 0 && !item.soldByWeight) {
        return t.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l));
      }
      return [
        ...t,
        {
          variantId: item.variantId,
          name: `${item.productName} — ${item.variantName}`,
          soldByWeight: item.soldByWeight,
          priceCop: item.priceCop,
          qty,
          imageUrl: item.imageUrl,
          isRestricted: item.isRestricted,
        },
      ];
    });
    setMessage(null);
  };

  const onScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim();
    setScan("");
    if (!code) return;
    const r = await posLookupAction(code);
    if (!r.ok) {
      setMessage({ ok: false, text: r.message });
    } else if (r.item.soldByWeight) {
      setMessage({ ok: false, text: `${r.item.productName} se vende por peso: pésalo abajo con la balanza.` });
      setSearch(r.item.productName);
      setResults([r.item]);
    } else {
      addItem(r.item, 1);
    }
    focusScan();
  };

  const doSearch = async (silent = false) => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    const r = await posSearchAction(q);
    if (r.ok) {
      setResults(r.items);
      if (!silent && r.items.length === 0) setMessage({ ok: false, text: `Nada llamado “${q}” en el catálogo.` });
    } else if (!silent) setMessage({ ok: false, text: r.message });
  };

  // Búsqueda EN VIVO: filtra mientras escribes (con una pequeña espera), sin
  // pulsar «Buscar». Silenciosa: no muestra avisos mientras tecleas.
  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => { void doSearch(true); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const addWeighed = (item: PosItem) => {
    const g = grams ?? parseInt(manualGrams, 10);
    if (!Number.isInteger(g) || g <= 0) {
      setMessage({ ok: false, text: "Sin peso: conecta la balanza (o digita los gramos) y vuelve a intentar." });
      return;
    }
    addItem(item, g);
    setManualGrams("");
    setResults([]);
    setSearch("");
    focusScan();
  };

  const total = useMemo(() => ticket.reduce((acc, l) => acc + lineTotal(l), 0), [ticket]);

  const registerSale = () => {
    setBusy(true);
    setMessage(null);
    posSaleAction({
      lines: ticket.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      method,
      idempotencyKey: idemKey,
    })
      .then((r) => {
        if (r.ok) {
          setLastSale({ number: r.number, totalCop: r.totalCop });
          setTicket([]);
          setIdemKey(crypto.randomUUID());
          setMessage({ ok: true, text: `Venta ${r.number} registrada: ${cop(r.totalCop)}.` });
        } else {
          setMessage({ ok: false, text: r.message });
        }
      })
      .finally(() => {
        setBusy(false);
        focusScan();
      });
  };

  return (
    <div className="space-y-4">
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm font-medium ${message.ok ? "bg-brand-soft text-brand-dark" : "bg-coral/15 text-coral-dark"}`}>
          {message.ok ? "✅ " : "⚠️ "}{message.text}
        </p>
      )}

      {/* Escaneo */}
      <form onSubmit={onScan} className="rounded-card border-2 border-brand bg-white p-4">
        <label htmlFor="pos-scan" className="mb-1 block text-sm font-bold text-ink">
          🔫 Escanear código (o digitarlo y Enter)
        </label>
        <input
          id="pos-scan"
          ref={scanRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          autoFocus
          autoComplete="off"
          inputMode="numeric"
          placeholder="Apunta la pistola y dispara…"
          className="w-full rounded-lg border border-brand-soft bg-white px-3 py-3 font-mono text-lg focus:border-brand"
        />
        <p className="mt-1 text-xs text-ink-soft">
          El mismo código dos veces suma unidades. También sirve el SKU (ABA-001).
        </p>
      </form>

      {/* Balanza + pesados */}
      <section className="space-y-2 rounded-card border border-brand-soft bg-white p-4">
        <h2 className="font-bold text-ink">⚖️ Pesados (fruver y granel)</h2>
        <ScalePanel />
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void doSearch(); } }}
            placeholder="Busca el producto: banano, tomate…"
            className="min-w-52 flex-1 rounded-lg border border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand"
            aria-label="Buscar producto pesado"
          />
          <button type="button" onClick={() => void doSearch()} className="btn rounded-full border border-brand px-4 py-2 text-sm font-bold text-brand-dark hover:bg-brand-soft">
            Buscar
          </button>
          <input
            value={manualGrams}
            onChange={(e) => setManualGrams(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Gramos a mano"
            inputMode="numeric"
            className="w-32 rounded-lg border border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand"
            aria-label="Gramos digitados a mano"
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
                  <button
                    type="button"
                    onClick={() => addWeighed(r)}
                    className="btn rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white"
                  >
                    Agregar {grams ? `${grams} g` : manualGrams ? `${manualGrams} g` : "(pesa primero)"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { addItem(r, 1); setResults([]); setSearch(""); focusScan(); }}
                    className="btn rounded-full border border-brand px-4 py-1.5 text-xs font-bold text-brand-dark"
                  >
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
        <h2 className="mb-2 font-bold text-ink">🧾 Tiquete</h2>
        {ticket.length === 0 ? (
          <p className="py-3 text-center text-sm text-ink-soft">
            Vacío. Escanea un producto o pesa uno para empezar.
            {lastSale && <span className="block pt-1 text-xs">Última venta: {lastSale.number} · {cop(lastSale.totalCop)}</span>}
          </p>
        ) : (
          <ul className="divide-y divide-brand-soft">
            {ticket.map((l, i) => (
              <li key={`${l.variantId}-${i}`} className="flex items-center gap-3 py-2">
                {l.imageUrl ? (
                  <Image src={l.imageUrl} alt="" width={36} height={36} unoptimized className="h-9 w-9 shrink-0 rounded-lg border border-brand-soft object-cover" />
                ) : (
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft/50">🛒</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {l.name} {l.isRestricted && <span className="text-xs font-bold text-liquor">+18</span>}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {l.soldByWeight
                      ? `${l.qty} g (${(l.qty / 500).toFixed(2)} lb) × ${cop(Math.round(l.priceCop / 2))}/lb`
                      : `${cop(l.priceCop)} c/u`}
                  </span>
                </span>
                {!l.soldByWeight && (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setTicket((t) => t.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}
                      className="btn h-7 w-7 rounded-full border border-brand-soft text-sm"
                      aria-label={`Quitar una unidad de ${l.name}`}
                    >
                      −
                    </button>
                    <span className="w-7 text-center text-sm font-bold">{l.qty}</span>
                    <button
                      type="button"
                      onClick={() => setTicket((t) => t.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}
                      className="btn h-7 w-7 rounded-full border border-brand-soft text-sm"
                      aria-label={`Sumar una unidad de ${l.name}`}
                    >
                      +
                    </button>
                  </span>
                )}
                <span className="w-20 text-right text-sm font-bold text-ink">{cop(lineTotal(l))}</span>
                <button
                  type="button"
                  onClick={() => setTicket((t) => t.filter((_, j) => j !== i))}
                  className="btn rounded-full px-2 text-coral-dark hover:bg-coral/10"
                  aria-label={`Eliminar ${l.name} del tiquete`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {ticket.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-brand-soft pt-3">
            <p className="flex items-baseline justify-between text-lg font-extrabold text-ink">
              <span>Total</span>
              <span>{cop(total)}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                className="rounded-lg border border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand"
                aria-label="Medio de pago"
              >
                <option value="cash">💵 Efectivo</option>
                <option value="card">💳 Datáfono</option>
                <option value="transfer">📲 Transferencia</option>
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={registerSale}
                className="btn flex-1 rounded-full bg-brand py-3 font-bold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {busy ? "Registrando…" : `Registrar venta (${cop(total)})`}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setTicket([]); setMessage(null); focusScan(); }}
                className="btn rounded-full border border-brand-soft px-4 py-2 text-sm text-ink-soft"
              >
                Vaciar
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
