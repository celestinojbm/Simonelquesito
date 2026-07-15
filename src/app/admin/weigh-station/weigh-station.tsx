"use client";

/**
 * Estación de balanza y escáner (primer bloque del Dashboard). Identifica un
 * producto (escáner USB / código / búsqueda / cámara), captura peso o cantidad
 * (manual funcional; balanza USB preparada; simulador solo en desarrollo) y
 * registra una ENTRADA o SALIDA de inventario de forma idempotente. Las ventas
 * NO se registran aquí: van por Caja.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { ProductThumb } from "@/components/product-thumb";
import { BarcodeScanner } from "@/app/admin/productos/barcode-scanner";
import { ScalePanel, useScaleWeight } from "@/components/scale/scale-panel";
import {
  stationLookupAction,
  stationSearchAction,
  stationMovementAction,
} from "@/app/actions/weigh-station";
import type { StationItem } from "@/modules/inventory/weigh-station-queries";
import type { StationHistoryRow } from "@/modules/inventory/weigh-station-queries";
import { reasonsForDirection, reasonRequiresConfirm } from "@/modules/inventory/station-reasons";
import {
  parseQuantityMinor,
  saleUnitUsesScale,
  minorUnitLabel,
  formatQuantityMinor,
} from "@/modules/inventory/quantity";
import {
  detectScaleCapabilities,
  buildDiagnosticReport,
  type ScaleCapabilities,
} from "@/modules/devices/scale/capabilities";
import { isSimulatedScaleEnabled } from "@/modules/devices/scale/simulated-adapter";

type Direction = "in" | "out";
type WeightSource = "manual" | "web_serial" | "simulated";

const inputCls = "w-full rounded-lg border border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand";

function newKey(): string {
  const c = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${performance.now()}`;
  return `ws-${c}`;
}

export function WeighStation({
  recent,
  canReceive,
  canAdjust,
}: {
  recent: StationHistoryRow[];
  canReceive: boolean;
  canAdjust: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Identificación
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StationItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [item, setItem] = useState<StationItem | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  // Movimiento
  const [direction, setDirection] = useState<Direction>("in");
  const [reasonCode, setReasonCode] = useState("recepcion");
  const [weightSource, setWeightSource] = useState<WeightSource>("manual");
  const [weightValue, setWeightValue] = useState("");
  const [weightUnit, setWeightUnit] = useState<"kg" | "g">("kg");
  const [qtyValue, setQtyValue] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [pieceCount, setPieceCount] = useState("");
  const [note, setNote] = useState("");
  const [confirmArmed, setConfirmArmed] = useState(false);
  const keyRef = useRef<string>(newKey());

  // Balanza / diagnóstico
  const [caps, setCaps] = useState<ScaleCapabilities | null>(null);
  const [diagReport, setDiagReport] = useState<string | null>(null);
  const simEnabled = isSimulatedScaleEnabled();
  const serialWeight = useScaleWeight(); // última lectura del lector Web Serial (si conectado)

  useEffect(() => setCaps(detectScaleCapabilities()), []);
  useEffect(() => scanRef.current?.focus(), []);

  const usesScale = item ? saleUnitUsesScale(item.saleUnit) : false;
  const reasons = useMemo(() => reasonsForDirection(direction), [direction]);

  const focusScanner = useCallback(() => {
    window.setTimeout(() => scanRef.current?.focus(), 30);
  }, []);

  const resetForm = useCallback(() => {
    setWeightValue("");
    setQtyValue("");
    setLotCode("");
    setExpiresAt("");
    setSupplierId("");
    setPieceCount("");
    setNote("");
    setConfirmArmed(false);
    keyRef.current = newKey();
  }, []);

  const selectItem = useCallback(
    (it: StationItem) => {
      setItem(it);
      setResults([]);
      setQuery("");
      setNotFound(null);
      setError(null);
      setWeightSource(saleUnitUsesScale(it.saleUnit) ? "manual" : "manual");
      resetForm();
      focusScanner();
    },
    [resetForm, focusScanner],
  );

  const resolveCode = useCallback(
    (raw: string) => {
      const clean = raw.trim();
      if (!clean) return;
      setNotFound(null);
      startTransition(async () => {
        const r = await stationLookupAction(clean);
        if (r.ok) selectItem(r.item);
        else setNotFound(clean);
      });
    },
    [selectItem],
  );

  const runSearch = useCallback(() => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    setNotFound(null);
    startTransition(async () => {
      const r = await stationSearchAction(q);
      setSearching(false);
      setResults(r.ok ? r.items : []);
    });
  }, [query]);

  // Peso desde balanza USB (Web Serial) mientras la fuente elegida es USB.
  useEffect(() => {
    if (weightSource === "web_serial" && serialWeight && serialWeight > 0) {
      setWeightValue(String(serialWeight));
      setWeightUnit("g");
    }
  }, [serialWeight, weightSource]);

  // Cantidad resuelta (minor unit) según la unidad de venta.
  const parsed = useMemo(() => {
    if (!item) return null;
    if (usesScale) return parseQuantityMinor(weightValue, weightUnit);
    return parseQuantityMinor(qtyValue, item.saleUnit);
  }, [item, usesScale, weightValue, weightUnit, qtyValue]);

  const quantityMinor = parsed && parsed.ok ? parsed.minor : null;
  const source = weightSource === "manual" ? "manual" : weightSource === "simulated" ? "simulated" : "web_serial";
  const canRegister = direction === "in" ? canReceive : canAdjust;

  // Búsqueda que huele a "venta": recordar que va por Caja.
  const looksLikeSale = /venta|vender|factura|pos|caja/i.test(query);

  const ready =
    !!item &&
    !!quantityMinor &&
    !pending &&
    canRegister &&
    (direction === "in" || (item ? quantityMinor <= item.stock.available : false));

  const projectedAfter =
    item && quantityMinor != null
      ? direction === "in"
        ? item.stock.physical + quantityMinor
        : item.stock.physical - quantityMinor
      : null;

  const submit = useCallback(() => {
    if (!item || quantityMinor == null || !canRegister) return;
    setError(null);
    startTransition(async () => {
      const r = await stationMovementAction({
        variantId: item.variantId,
        direction,
        quantityMinor,
        source,
        reasonCode,
        note: note || undefined,
        lotCode: direction === "in" ? lotCode || undefined : undefined,
        expiresAt: direction === "in" && expiresAt ? expiresAt : undefined,
        supplierId: direction === "in" ? supplierId || undefined : undefined,
        pieceCount: direction === "in" && pieceCount ? Number(pieceCount) : undefined,
        idempotencyKey: keyRef.current,
      });
      if (r.ok) {
        toast.ok(
          r.result.duplicate
            ? "Este movimiento ya estaba registrado."
            : `${direction === "in" ? "Entrada" : "Salida"} registrada. Nuevo stock: ${formatQuantityMinor(r.result.stockAfter.physical, item.saleUnit)}.`,
        );
        // Refresca el item con el stock nuevo y limpia el peso (conserva modo).
        setItem((prev) => (prev ? { ...prev, stock: { ...prev.stock, physical: r.result.stockAfter.physical, available: r.result.stockAfter.available } } : prev));
        resetForm();
        focusScanner();
        router.refresh();
      } else {
        setError(r.message);
      }
    });
  }, [item, quantityMinor, canRegister, direction, source, reasonCode, note, lotCode, expiresAt, supplierId, pieceCount, toast, resetForm, focusScanner, router]);

  const onConfirmClick = () => {
    if (direction === "out" && reasonRequiresConfirm(reasonCode) && !confirmArmed) {
      setConfirmArmed(true);
      return;
    }
    submit();
  };

  const prepareDiagnostic = () => {
    const c = caps ?? detectScaleCapabilities();
    setCaps(c);
    setDiagReport(buildDiagnosticReport(c, { portSelected: false }));
  };

  return (
    <section aria-label="Estación de balanza y escáner" className="rounded-card border-2 border-brand bg-white p-4 shadow-sm md:p-5">
      <header className="mb-3">
        <h2 className="text-lg font-extrabold text-ink md:text-xl">⚖️ Estación de balanza y escáner</h2>
        <p className="text-sm text-ink-soft">Escanea un producto, registra su peso y actualiza el inventario.</p>
      </header>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-coral/15 px-3 py-2 text-sm font-medium text-coral-dark">⚠️ {error}</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* IZQUIERDA: producto y escáner */}
        <div className="space-y-3">
          <div>
            <label htmlFor="ws-scan" className="mb-1 block text-xs font-bold uppercase text-ink-soft">Escanea o escribe el código</label>
            <input
              id="ws-scan"
              ref={scanRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  resolveCode(code);
                  setCode("");
                }
              }}
              placeholder="Código de barras o SKU · Enter"
              className={inputCls}
              autoComplete="off"
              inputMode="text"
            />
          </div>

          {/* Cámara de respaldo: su propio botón abre/cierra con un solo clic. */}
          <BarcodeScanner onDetected={(c) => resolveCode(c)} />

          <div>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runSearch())}
                placeholder="Buscar por nombre, variante, SKU o código"
                className={inputCls}
              />
              <button type="button" onClick={runSearch} disabled={pending || query.trim().length < 2} className="btn shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                Buscar
              </button>
            </div>
            {searching && <p className="mt-1 text-xs text-ink-soft">Buscando…</p>}
            {results.length > 0 && (
              <ul className="mt-2 divide-y divide-brand-soft rounded-lg border border-brand-soft">
                {results.map((r) => (
                  <li key={r.variantId}>
                    <button type="button" onClick={() => selectItem(r)} className="btn flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-brand-soft/40">
                      <ProductThumb imageUrl={r.imageUrl} icon={r.categoryIcon} alt={r.productName} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{r.productName}</span>
                        <span className="block truncate text-xs text-ink-soft">{r.variantName} · {r.sku ?? "sin SKU"}</span>
                      </span>
                      <span className="text-xs font-bold text-ink">{formatQuantityMinor(r.stock.available, r.saleUnit)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {notFound && (
            <div className="rounded-lg bg-cream px-3 py-2 text-xs text-ink-soft">
              <p className="font-semibold text-ink">Producto no encontrado para «{notFound}».</p>
              <p>Búscalo por nombre arriba o créalo en <Link href="/admin/productos" className="font-semibold text-brand-dark underline">Productos</Link>. No se crean productos automáticamente.</p>
            </div>
          )}

          {item && (
            <div className="rounded-lg border border-brand-soft bg-cream/60 p-3">
              <div className="flex items-center gap-2">
                <ProductThumb imageUrl={item.imageUrl} icon={item.categoryIcon} alt={item.productName} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{item.productName}</p>
                  <p className="truncate text-xs text-ink-soft">{item.variantName} · {item.saleUnit}{item.soldByWeight ? " · por peso" : ""}</p>
                  <p className="truncate text-[11px] text-ink-soft">SKU {item.sku ?? "—"} · Cód {item.barcode ?? "—"}</p>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                <div><dt className="text-ink-soft">Físico</dt><dd className="font-bold text-ink">{formatQuantityMinor(item.stock.physical, item.saleUnit)}</dd></div>
                <div><dt className="text-ink-soft">Reservado</dt><dd className="font-bold text-ink">{formatQuantityMinor(item.stock.reserved, item.saleUnit)}</dd></div>
                <div><dt className="text-ink-soft">Disponible</dt><dd className="font-bold text-brand-dark">{formatQuantityMinor(item.stock.available, item.saleUnit)}</dd></div>
              </dl>
            </div>
          )}
        </div>

        {/* DERECHA: balanza, movimiento y confirmación */}
        <div className="space-y-3">
          {/* Tipo de movimiento */}
          <div className="grid grid-cols-2 gap-2">
            {(["in", "out"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => { setDirection(d); setReasonCode(reasonsForDirection(d)[0]!.code); setConfirmArmed(false); }}
                className={`btn rounded-lg py-2 text-sm font-bold ${direction === d ? (d === "in" ? "bg-brand text-white" : "bg-coral text-white") : "border border-brand-soft text-ink-soft"}`}
              >
                {d === "in" ? "⬇️ ENTRADA" : "⬆️ SALIDA"}
              </button>
            ))}
          </div>

          {!canRegister && (
            <p className="rounded-lg bg-sun/40 px-3 py-2 text-xs text-ink">
              Tu rol puede consultar pero no registrar {direction === "in" ? "entradas" : "salidas"} ({direction === "in" ? "inventory.receive" : "inventory.adjust"}).
            </p>
          )}

          {/* Motivo */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">Motivo</label>
            <select value={reasonCode} onChange={(e) => { setReasonCode(e.target.value); setConfirmArmed(false); }} className={inputCls}>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            {direction === "out" && looksLikeSale && (
              <p className="mt-1 rounded-lg bg-sun/40 px-3 py-2 text-xs text-ink">
                Las ventas se registran desde Caja para mantener pagos e inventario sincronizados.{" "}
                <Link href="/admin/caja" className="font-bold text-brand-dark underline">Ir a Caja</Link>
              </p>
            )}
          </div>

          {/* Captura de peso / cantidad */}
          {item ? (
            usesScale ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  <span className="mr-1 text-xs font-bold uppercase text-ink-soft">Origen del peso:</span>
                  {(["manual", "web_serial", ...(simEnabled ? (["simulated"] as const) : [])] as WeightSource[]).map((s) => (
                    <button key={s} type="button" onClick={() => setWeightSource(s)} className={`btn rounded-full px-3 py-1 text-xs font-semibold ${weightSource === s ? "bg-brand text-white" : "border border-brand-soft text-ink-soft"}`}>
                      {s === "manual" ? "Manual" : s === "web_serial" ? "Balanza USB" : "Simulador"}
                    </button>
                  ))}
                </div>

                {weightSource === "web_serial" && (
                  <div className="rounded-lg bg-cream px-3 py-2 text-xs text-ink-soft">
                    <p>Lector genérico por Web Serial. La lectura automática con la <strong>BBG Marker-30</strong> queda <strong>pendiente de una prueba física</strong>; mientras tanto usa el modo <strong>Manual</strong>. Conéctala abajo por un clic explícito.</p>
                    <div className="mt-2"><ScalePanel /></div>
                  </div>
                )}
                {weightSource === "simulated" && (
                  <p className="rounded-lg bg-sun/40 px-3 py-2 text-xs text-ink">Simulador de desarrollo — no usar en producción.</p>
                )}

                <div className="flex gap-2">
                  <input
                    value={weightValue}
                    onChange={(e) => setWeightValue(e.target.value.replace(/[^0-9.,]/g, ""))}
                    inputMode="decimal"
                    placeholder={`Peso (${weightUnit})`}
                    className={inputCls}
                  />
                  <select value={weightUnit} onChange={(e) => setWeightUnit(e.target.value as "kg" | "g")} className="shrink-0 rounded-lg border border-brand-soft px-2 py-2 text-sm">
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                  </select>
                </div>
                {weightValue && (
                  <p className="text-xs text-ink-soft">
                    {parsed && parsed.ok
                      ? `Equivalente interno: ${parsed.minor.toLocaleString("es-CO")} g · Origen: ${weightSource === "manual" ? "Manual" : weightSource === "web_serial" ? "Balanza USB" : "Simulador"}`
                      : (parsed && !parsed.ok ? parsed.error : "")}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">Cantidad ({minorUnitLabel(item.saleUnit)})</label>
                <input value={qtyValue} onChange={(e) => setQtyValue(e.target.value.replace(/[^0-9.,]/g, ""))} inputMode="numeric" placeholder="Cantidad" className={inputCls} />
                {qtyValue && parsed && !parsed.ok && <p className="mt-1 text-xs text-coral-dark">{parsed.error}</p>}
              </div>
            )
          ) : (
            <p className="rounded-lg bg-cream px-3 py-4 text-center text-sm text-ink-soft">Selecciona un producto para capturar su peso o cantidad.</p>
          )}

          {/* Campos opcionales de entrada */}
          {item && direction === "in" && (
            <div className="grid grid-cols-2 gap-2">
              <input value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Lote (opcional)" className={inputCls} />
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} title="Vencimiento (opcional)" />
              <input value={supplierId} onChange={(e) => setSupplierId(e.target.value)} placeholder="Proveedor (opcional)" className={inputCls} />
              <input value={pieceCount} onChange={(e) => setPieceCount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="N.º de piezas (opcional)" className={inputCls} />
            </div>
          )}
          {item && (
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" className={inputCls} maxLength={400} />
          )}

          {/* Resumen + confirmación */}
          {item && quantityMinor != null && (
            <div className="rounded-lg border border-brand-soft bg-white p-3 text-sm">
              <p className="mb-1 font-bold text-ink">Resumen</p>
              <ul className="space-y-0.5 text-xs text-ink-soft">
                <li>Producto: <span className="font-semibold text-ink">{item.productName} · {item.variantName}</span></li>
                <li>Operación: <span className="font-semibold text-ink">{direction === "in" ? "Entrada" : "Salida"} — {reasons.find((r) => r.code === reasonCode)?.label}</span></li>
                <li>Cantidad: <span className="font-semibold text-ink">{formatQuantityMinor(quantityMinor, item.saleUnit)}</span></li>
                {projectedAfter != null && <li>Stock estimado después: <span className="font-semibold text-ink">{formatQuantityMinor(Math.max(0, projectedAfter), item.saleUnit)}</span></li>}
              </ul>
              {direction === "out" && quantityMinor > item.stock.available && (
                <p className="mt-1 text-xs font-semibold text-coral-dark">Stock insuficiente: disponible {formatQuantityMinor(item.stock.available, item.saleUnit)}.</p>
              )}
              <button
                type="button"
                onClick={onConfirmClick}
                disabled={!ready}
                className={`btn mt-2 w-full rounded-full py-2.5 text-sm font-bold text-white disabled:opacity-50 ${direction === "in" ? "bg-brand" : "bg-coral"}`}
              >
                {pending ? "Procesando…" : confirmArmed ? "¿Seguro? Toca para confirmar" : direction === "in" ? "Confirmar entrada" : "Confirmar salida"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Diagnóstico de balanza USB */}
      <details className="mt-4 rounded-lg border border-brand-soft bg-cream/40 p-3">
        <summary className="cursor-pointer text-sm font-bold text-ink">Diagnóstico de balanza USB</summary>
        <div className="mt-2 space-y-1 text-xs text-ink-soft">
          {caps ? (
            <ul className="grid gap-0.5 sm:grid-cols-2">
              <li>Sistema: <strong>{caps.approxOs}</strong> · Navegador: <strong>{caps.approxBrowser}</strong></li>
              <li>Contexto seguro (HTTPS): <strong>{caps.secureContext ? "sí" : "no"}</strong></li>
              <li>Web Serial: <strong>{caps.webSerial ? "disponible" : "no disponible"}</strong></li>
              <li>WebUSB: <strong>{caps.webUsb ? "disponible" : "no disponible"}</strong></li>
              <li>Modo manual: <strong>disponible</strong></li>
            </ul>
          ) : <p>Detectando capacidades…</p>}
          <button type="button" onClick={prepareDiagnostic} className="btn mt-1 rounded-full border border-brand px-3 py-1 text-xs font-bold text-brand-dark">Preparar diagnóstico USB</button>
          {diagReport && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-ink p-2 text-[10px] leading-relaxed text-brand-soft">{diagReport}</pre>
          )}
        </div>
      </details>

      {/* Historial reciente */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">Últimos movimientos de balanza</h3>
          <Link href="/admin/inventario" className="text-xs font-semibold text-brand-dark underline">Ver inventario completo</Link>
        </div>
        {recent.length === 0 ? (
          <p className="rounded-lg bg-cream px-3 py-3 text-center text-xs text-ink-soft">Aún no hay movimientos registrados desde la estación.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-ink-soft">
                <tr className="border-b border-brand-soft">
                  <th className="py-1 pr-2 font-semibold">Hora</th>
                  <th className="py-1 pr-2 font-semibold">Producto</th>
                  <th className="py-1 pr-2 font-semibold">Mov.</th>
                  <th className="py-1 pr-2 font-semibold">Cantidad</th>
                  <th className="py-1 pr-2 font-semibold">Fuente</th>
                  <th className="py-1 pr-2 font-semibold">Motivo</th>
                  <th className="py-1 font-semibold">Usuario</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-brand-soft/60">
                    <td className="py-1 pr-2 text-ink-soft">{new Date(r.createdAt).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="py-1 pr-2 text-ink">{r.productName} <span className="text-ink-soft">· {r.variantName}</span></td>
                    <td className={`py-1 pr-2 font-semibold ${r.qty >= 0 ? "text-brand-dark" : "text-coral-dark"}`}>{r.qty >= 0 ? "Entrada" : "Salida"}</td>
                    <td className="py-1 pr-2 text-ink">{formatQuantityMinor(Math.abs(r.qty), r.saleUnit)}</td>
                    <td className="py-1 pr-2 text-ink-soft">{r.sourceLabel}</td>
                    <td className="py-1 pr-2 text-ink-soft">{r.reason ?? "—"}</td>
                    <td className="py-1 text-ink-soft">{r.createdBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
