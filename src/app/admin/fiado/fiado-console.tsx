"use client";

// Consola de Fiado (componente cliente del panel).
import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import {
  archiveCreditAccountAction,
  creditLimitAction,
  creditPaymentAction,
  creditPurchaseAction,
  creditStatusAction,
  enrollInStoreAction,
  restoreCreditAccountAction,
} from "@/app/actions/fiado";

type AccountRow = {
  customerId: string;
  name: string;
  phone: string;
  status: string;
  limitCop: number;
  balance: number;
  overdue: number;
  nextDue: string | null;
  channel: string;
  vouchedBy: string | null;
};

/** Cuenta eliminada de la cartera (historial de 90 días, restaurable). */
type ArchivedRow = {
  customerId: string;
  name: string;
  phone: string;
  archivedAt: string;
};

const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;
const inputCls = "w-full rounded-lg border border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand";

export function FiadoConsole({
  rules,
  accounts,
  archived,
}: {
  rules: { initialLimitCop: number; maxLimitCop: number; singleInstallmentMaxCop: number; maxInstallments: number };
  accounts: AccountRow[];
  archived: ArchivedRow[];
}) {
  const [pending, startTransition] = useTransition();
  // Éxito → toast (se auto-oculta); error → banner fijo (hay que leerlo/corregir).
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const toast = useToast();

  // Registrar fiado en mostrador (sin membresía: la premium es solo por app).
  const EMPTY_ENROLL = { phone: "", fullName: "", amountCop: "" };
  const [enroll, setEnroll] = useState(EMPTY_ENROLL);
  // Formularios por cuenta seleccionada
  const [purchase, setPurchase] = useState({ totalCop: "", frequency: "weekly" as "weekly" | "biweekly", note: "" });
  const [payment, setPayment] = useState({ amountCop: "", method: "cash" as "cash" | "transfer" });
  const [newLimit, setNewLimit] = useState("");

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

  const sel = accounts.find((a) => a.customerId === selected) ?? null;

  return (
    <div className="space-y-5">
      {errorMsg && (
        <p role="alert" className="rounded-lg bg-coral/15 px-3 py-2 text-sm font-medium text-coral-dark">
          ⚠️ {errorMsg}
        </p>
      )}

      {/* Registrar fiado en mostrador */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-3 font-bold text-ink">📒 Registrar fiado</h2>
        <div className="grid gap-2 md:grid-cols-3">
          <input placeholder="Nombre completo" value={enroll.fullName} onChange={(e) => setEnroll({ ...enroll, fullName: e.target.value })} className={inputCls} />
          <input placeholder="Celular" value={enroll.phone} onChange={(e) => setEnroll({ ...enroll, phone: e.target.value })} className={inputCls} />
          <input
            placeholder="Monto a fiar"
            inputMode="numeric"
            value={enroll.amountCop}
            onChange={(e) => setEnroll({ ...enroll, amountCop: e.target.value.replace(/[^0-9]/g, "") })}
            className={inputCls}
          />
        </div>
        <button
          type="button"
          disabled={
            pending ||
            enroll.fullName.trim().length < 2 ||
            !enroll.phone ||
            Number(enroll.amountCop) <= 0
          }
          onClick={() =>
            run(
              () => enrollInStoreAction({
                phone: enroll.phone,
                fullName: enroll.fullName,
                amountCop: Number(enroll.amountCop),
              }),
              "Fiado registrado con su plan de cuotas.",
              () => setEnroll(EMPTY_ENROLL),
            )
          }
          className="btn mt-3 rounded-full bg-brand px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? "Procesando…" : "Registrar fiado"}
        </button>
      </section>

      {/* Cartera */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h2 className="mb-1 font-bold text-ink">📒 Cartera</h2>
        <p className="mb-2 text-xs text-ink-soft">Toca un cliente para abrir sus acciones (fiado, abono, cupo).</p>
        {accounts.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-soft">Sin cuentas de fiado todavía. Da de alta al primer cliente arriba.</p>
        ) : (
          <ul className="divide-y divide-brand-soft">
            {accounts.map((a) => (
              <li key={a.customerId} className="py-2.5">
                <button
                  type="button"
                  onClick={() => setSelected(selected === a.customerId ? null : a.customerId)}
                  aria-expanded={selected === a.customerId}
                  className="btn flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-1 py-0.5 text-left hover:bg-brand-soft/40"
                >
                  <span
                    aria-hidden
                    className={`text-xs text-brand-dark transition-transform ${selected === a.customerId ? "rotate-90" : ""}`}
                  >
                    ▶
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{a.name}</span>{" "}
                    <span className="text-xs text-ink-soft">{a.phone}</span>
                  </span>
                  <span className="text-sm font-bold text-ink">{cop(a.balance)} <span className="font-normal text-ink-soft">/ {cop(a.limitCop)}</span></span>
                  {a.overdue > 0 && <span className="rounded-full bg-coral px-2 py-0.5 text-xs font-bold text-white">{a.overdue} vencida{a.overdue > 1 ? "s" : ""}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${a.status === "active" ? "bg-brand-soft text-brand-dark" : "bg-sun text-ink"}`}>
                    {a.status === "active" ? "activo" : a.status === "paused" ? "pausado" : "cerrado"}
                  </span>
                  <span className="hidden text-xs text-ink-soft sm:inline">{selected === a.customerId ? "▲ cerrar" : "▼ abrir"}</span>
                </button>

                {selected === a.customerId && sel && (
                  <div className="mt-3 grid gap-3 rounded-lg bg-cream p-3 md:grid-cols-3">
                    {/* Registrar fiado */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-ink uppercase">Registrar fiado</p>
                      <input placeholder={`Monto (≤ ${cop(Math.max(0, sel.limitCop - sel.balance))})`} inputMode="numeric" value={purchase.totalCop} onChange={(e) => setPurchase({ ...purchase, totalCop: e.target.value.replace(/[^0-9]/g, "") })} className={inputCls} />
                      <select value={purchase.frequency} onChange={(e) => setPurchase({ ...purchase, frequency: e.target.value as "weekly" | "biweekly" })} className={inputCls}>
                        <option value="weekly">Cuotas semanales</option>
                        <option value="biweekly">Cuotas quincenales</option>
                      </select>
                      <input placeholder="Nota (opcional)" value={purchase.note} onChange={(e) => setPurchase({ ...purchase, note: e.target.value })} className={inputCls} />
                      <p className="text-[11px] text-ink-soft">≤ {cop(rules.singleInstallmentMaxCop)} → cuota única a 15 días; más → hasta {rules.maxInstallments} cuotas.</p>
                      <button
                        type="button"
                        disabled={pending || !purchase.totalCop}
                        onClick={() => run(() => creditPurchaseAction({ customerId: sel.customerId, totalCop: Number(purchase.totalCop), frequency: purchase.frequency, note: purchase.note || undefined }), "Fiado registrado con su plan de cuotas.")}
                        className="btn w-full rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                      >
                        Registrar
                      </button>
                    </div>

                    {/* Abono */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-ink uppercase">Abono</p>
                      <input placeholder={`Monto (deuda ${cop(sel.balance)})`} inputMode="numeric" value={payment.amountCop} onChange={(e) => setPayment({ ...payment, amountCop: e.target.value.replace(/[^0-9]/g, "") })} className={inputCls} />
                      <select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value as "cash" | "transfer" })} className={inputCls}>
                        <option value="cash">Efectivo</option>
                        <option value="transfer">Transferencia</option>
                      </select>
                      <button
                        type="button"
                        disabled={pending || !payment.amountCop}
                        onClick={() => run(() => creditPaymentAction({ customerId: sel.customerId, amountCop: Number(payment.amountCop), method: payment.method }), "Abono registrado.")}
                        className="btn w-full rounded-full bg-brand-dark px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                      >
                        Abonar
                      </button>
                    </div>

                    {/* Cupo y estado */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-ink uppercase">Cupo y estado</p>
                      <input placeholder={`Nuevo cupo (máx ${cop(rules.maxLimitCop)})`} inputMode="numeric" value={newLimit} onChange={(e) => setNewLimit(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls} />
                      <button
                        type="button"
                        disabled={pending || !newLimit}
                        onClick={() => run(() => creditLimitAction(sel.customerId, Number(newLimit)), "Cupo actualizado (auditado).")}
                        className="btn w-full rounded-full border border-brand px-3 py-1.5 text-xs font-bold text-brand-dark disabled:opacity-50"
                      >
                        Cambiar cupo
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => creditStatusAction(sel.customerId, sel.status === "active" ? "paused" : "active", sel.status === "active" ? "Pausado desde el panel" : undefined),
                            sel.status === "active" ? "Cuenta pausada." : "Cuenta reactivada.",
                          )
                        }
                        className="btn w-full rounded-full border border-brand-soft px-3 py-1.5 text-xs font-semibold text-ink-soft"
                      >
                        {sel.status === "active" ? "⏸ Pausar cuenta" : "▶️ Reactivar cuenta"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        title={sel.balance > 0 ? "Solo se puede eliminar con deuda $0" : undefined}
                        onClick={() => {
                          if (sel.balance > 0) {
                            run(async () => ({ ok: false, message: `No se puede eliminar: debe ${cop(sel.balance)}. Registra el abono primero.` }), "");
                            return;
                          }
                          if (window.confirm(`¿Eliminar a ${sel.name} de la cartera? Quedará 90 días en el historial y se puede restaurar.`)) {
                            run(() => archiveCreditAccountAction(sel.customerId), "Cliente eliminado de la cartera (en historial 90 días).", () => setSelected(null));
                          }
                        }}
                        className="btn w-full rounded-full border border-coral/40 px-3 py-1.5 text-xs font-semibold text-coral-dark disabled:opacity-50"
                      >
                        🗑 Eliminar de la cartera
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Historial de eliminados (90 días, restaurables) */}
      {archived.length > 0 && (
        <section className="rounded-card border border-brand-soft bg-white p-4">
          <h2 className="mb-1 font-bold text-ink">🗄 Historial de eliminados</h2>
          <p className="mb-3 text-xs text-ink-soft">
            Cuentas eliminadas de la cartera. Se conservan aquí 90 días y se pueden restaurar; su
            historial contable queda siempre registrado en el ledger.
          </p>
          <ul className="divide-y divide-brand-soft">
            {archived.map((a) => (
              <li key={a.customerId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{a.name}</span>{" "}
                  <span className="text-xs text-ink-soft">{a.phone}</span>
                </span>
                <span className="text-xs text-ink-soft">
                  eliminado el {new Date(a.archivedAt).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => restoreCreditAccountAction(a.customerId), "Cuenta restaurada a la cartera.")}
                  className="btn rounded-full border border-brand px-4 py-1.5 text-xs font-bold text-brand-dark hover:bg-brand-soft"
                >
                  ↩️ Restaurar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
