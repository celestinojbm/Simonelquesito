"use client";

import { useState, useTransition } from "react";
import { createPromotionAction, setPromotionActiveAction } from "@/app/actions/promotions";
import { useToast } from "@/components/ui/toast";

type PromotionRow = {
  id: string;
  name: string;
  code: string | null;
  kind: "percent" | "fixed" | "free_delivery" | "other";
  value: number;
  minPurchaseCop: number;
  maxUses: number | null;
  usedCount: number;
  budgetCop: number | null;
  spentCop: number;
  excludesRestricted: boolean;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
};

const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;
const inputCls = "w-full rounded-lg border border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand";

const KIND_LABEL: Record<string, string> = {
  percent: "Porcentaje",
  fixed: "Monto fijo",
  free_delivery: "Domicilio gratis",
  other: "Otro",
};

function describe(p: PromotionRow): string {
  if (p.kind === "percent") return `${p.value / 100}% de descuento`;
  if (p.kind === "fixed") return `${cop(p.value)} de descuento`;
  if (p.kind === "free_delivery") return "Domicilio gratis";
  return "—";
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", year: "numeric" }) : null;

const EMPTY = {
  name: "",
  code: "",
  kind: "percent" as "percent" | "fixed" | "free_delivery",
  value: "",
  minPurchaseCop: "",
  maxUses: "",
  budgetCop: "",
  startsAt: "",
  endsAt: "",
  excludesRestricted: true,
};

export function PromocionesConsole({
  promotions,
  activeCount,
}: {
  promotions: PromotionRow[];
  activeCount: number;
}) {
  const [pending, startTransition] = useTransition();
  // Éxito → toast (se auto-oculta); error → banner fijo (hay que leerlo/corregir).
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [copied, setCopied] = useState<string | null>(null);
  const toast = useToast();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, okText: string, onOk?: () => void) => {
    setErrorMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.ok(okText);
        onOk?.();
      } else {
        setErrorMsg((r as { message: string }).message);
      }
    });
  };

  const submit = () => {
    run(
      () =>
        createPromotionAction({
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          kind: form.kind,
          value: form.kind === "free_delivery" ? 0 : Number(form.value) || 0,
          minPurchaseCop: Number(form.minPurchaseCop) || 0,
          maxUses: form.maxUses.trim() ? Number(form.maxUses) : null,
          budgetCop: form.budgetCop.trim() ? Number(form.budgetCop) : null,
          startsAt: form.startsAt || undefined,
          endsAt: form.endsAt || undefined,
          excludesRestricted: form.excludesRestricted,
        }),
      `Promoción "${form.name.trim()}" creada con el código ${form.code.trim().toUpperCase()}.`,
      () => setForm(EMPTY),
    );
  };

  const copy = (code: string) => {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(code);
        setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
      },
      () => {},
    );
  };

  const now = Date.now();
  const status = (p: PromotionRow): { label: string; cls: string } => {
    if (!p.isActive) return { label: "Pausada", cls: "bg-ink/10 text-ink-soft" };
    if (p.startsAt && new Date(p.startsAt).getTime() > now) return { label: "Programada", cls: "bg-sun/40 text-ink" };
    if (p.endsAt && new Date(p.endsAt).getTime() < now) return { label: "Vencida", cls: "bg-coral/15 text-coral-dark" };
    if (p.maxUses !== null && p.usedCount >= p.maxUses) return { label: "Agotada", cls: "bg-coral/15 text-coral-dark" };
    if (p.budgetCop !== null && p.spentCop >= p.budgetCop) return { label: "Sin presupuesto", cls: "bg-coral/15 text-coral-dark" };
    return { label: "Activa", cls: "bg-brand text-white" };
  };

  return (
    <div className="space-y-5">
      {errorMsg && (
        <p role="alert" className="rounded-lg bg-coral/15 px-3 py-2 text-sm font-medium text-coral-dark">
          ⚠️ {errorMsg}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-card border border-brand-soft bg-white p-3">
          <p className="text-xs text-ink-soft uppercase">Promociones activas</p>
          <p className="text-lg font-extrabold text-ink">{activeCount}</p>
        </div>
        <div className="rounded-card border border-brand-soft bg-white p-3">
          <p className="text-xs text-ink-soft uppercase">Total creadas</p>
          <p className="text-lg font-extrabold text-ink">{promotions.length}</p>
        </div>
      </div>

      {/* Crear promoción */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="font-bold text-ink">➕ Nueva promoción</h2>
        <p className="mb-3 text-xs text-ink-soft">
          El cliente escribe el código en el checkout. El descuento se valida y aplica en el servidor.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-sm">
            <span className="text-xs text-ink-soft">Nombre</span>
            <input
              placeholder="Ej: Bienvenida 10%"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-ink-soft">Código del cupón</span>
            <input
              placeholder="BIENVENIDO10"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
              maxLength={20}
              className={`${inputCls} font-mono uppercase`}
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-ink-soft">Tipo de descuento</span>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
              className={inputCls}
            >
              <option value="percent">Porcentaje (%)</option>
              <option value="fixed">Monto fijo (COP)</option>
              <option value="free_delivery">Domicilio gratis</option>
            </select>
          </label>
          {form.kind !== "free_delivery" && (
            <label className="text-sm">
              <span className="text-xs text-ink-soft">
                {form.kind === "percent" ? "Porcentaje (1–100)" : "Monto del descuento (COP)"}
              </span>
              <input
                type="number"
                inputMode="numeric"
                placeholder={form.kind === "percent" ? "10" : "5000"}
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                className={inputCls}
              />
            </label>
          )}
          <label className="text-sm">
            <span className="text-xs text-ink-soft">Compra mínima (COP, opcional)</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="0"
              value={form.minPurchaseCop}
              onChange={(e) => setForm({ ...form, minPurchaseCop: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-ink-soft">Límite de usos (opcional)</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Ilimitado"
              value={form.maxUses}
              onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
              className={inputCls}
            />
          </label>
          {form.kind !== "free_delivery" && (
            <label className="text-sm">
              <span className="text-xs text-ink-soft">Presupuesto máx. (COP, opcional)</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="Sin tope"
                value={form.budgetCop}
                onChange={(e) => setForm({ ...form, budgetCop: e.target.value })}
                className={inputCls}
              />
            </label>
          )}
          <label className="text-sm">
            <span className="text-xs text-ink-soft">Válido desde (opcional)</span>
            <input
              type="date"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-ink-soft">Válido hasta (opcional)</span>
            <input
              type="date"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              className={inputCls}
            />
          </label>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.excludesRestricted}
            onChange={(e) => setForm({ ...form, excludesRestricted: e.target.checked })}
          />
          Excluir licores y cigarrillos de la base del descuento (recomendado)
        </label>
        <button
          type="button"
          disabled={pending || !form.name.trim() || !form.code.trim()}
          onClick={submit}
          className="btn mt-3 rounded-full bg-brand px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? "Creando…" : "Crear promoción"}
        </button>
      </section>

      {/* Listado */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-3 font-bold text-ink">📋 Promociones</h2>
        {promotions.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft">
            Aún no hay promociones. Crea la primera arriba.
          </p>
        ) : (
          <ul className="space-y-2">
            {promotions.map((p) => {
              const st = status(p);
              return (
                <li key={p.id} className="rounded-lg border border-brand-soft p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                    <span className="font-bold text-ink">{p.name}</span>
                    {p.code && (
                      <button
                        type="button"
                        onClick={() => copy(p.code!)}
                        title="Copiar código"
                        className="btn rounded-full border border-brand-soft px-2 py-0.5 font-mono text-xs text-brand-dark hover:bg-brand-soft"
                      >
                        {copied === p.code ? "✅ copiado" : `${p.code} ⧉`}
                      </button>
                    )}
                    <span className="text-sm text-ink-soft">
                      {describe(p)}
                      {p.kind !== "other" && KIND_LABEL[p.kind] ? "" : ` · ${KIND_LABEL[p.kind] ?? p.kind}`}
                    </span>
                    <div className="ml-auto">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => setPromotionActiveAction(p.id, !p.isActive),
                            p.isActive ? "Promoción pausada." : "Promoción activada.",
                          )
                        }
                        className={`btn rounded-full px-3 py-1 text-xs font-bold disabled:opacity-50 ${
                          p.isActive
                            ? "border border-coral text-coral-dark hover:bg-coral/10"
                            : "bg-brand text-white"
                        }`}
                      >
                        {p.isActive ? "Pausar" : "Activar"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                    {p.minPurchaseCop > 0 && <span>Mínimo {cop(p.minPurchaseCop)}</span>}
                    <span>
                      Usos: {p.usedCount}
                      {p.maxUses !== null ? ` / ${p.maxUses}` : " (ilimitado)"}
                    </span>
                    {p.budgetCop !== null && (
                      <span>
                        Presupuesto: {cop(p.spentCop)} / {cop(p.budgetCop)}
                      </span>
                    )}
                    {fmtDate(p.startsAt) && <span>Desde {fmtDate(p.startsAt)}</span>}
                    {fmtDate(p.endsAt) && <span>Hasta {fmtDate(p.endsAt)}</span>}
                    {p.kind !== "free_delivery" && !p.excludesRestricted && (
                      <span className="text-coral-dark">Incluye restringidos</span>
                    )}
                    {p.kind === "other" && (
                      <span className="text-coral-dark">Tipo no editable aquí (creado por otra vía)</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
