"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestCodeAction, verifyCodeAction } from "@/app/actions/account";

/**
 * Ingreso/registro de clientes con teléfono + código de 6 dígitos.
 * Un solo componente reutilizable (página de cuenta y checkout).
 */
export function PhoneLogin({ title = "Ingresa con tu celular" }: { title?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const requestCode = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await requestCodeAction(phone);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setStep("code");
      setNotice(
        result.delivery === "sent"
          ? "Te enviamos un código de 6 dígitos por WhatsApp."
          : "⚠️ Modo demo: el envío de códigos aún no está activo (se activa con WhatsApp Business). El código quedó registrado en el panel de mensajes del administrador.",
      );
    });
  };

  const verify = () => {
    setError(null);
    startTransition(async () => {
      const result = await verifyCodeAction({ phone, code, fullName: fullName || undefined });
      if (result.ok) {
        router.refresh();
        return;
      }
      if (result.needsName) {
        setNeedsName(true);
        setNotice("¡Casi! Solo falta tu nombre para crear tu cuenta.");
        return;
      }
      setError(result.message);
    });
  };

  const inputCls =
    "w-full rounded-lg border border-brand-soft bg-white px-3 py-2.5 text-sm focus:border-brand";

  return (
    <div className="rounded-card border border-brand-soft bg-white p-5">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <p className="mt-1 mb-3 text-sm text-ink-soft">
        Tu número es tu cuenta: pedidos, direcciones y beneficios en un solo lugar.
      </p>

      {step === "phone" ? (
        <div className="space-y-2">
          <label htmlFor="phone-login" className="block text-sm font-medium">Celular</label>
          <input
            id="phone-login"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && phone.trim() && requestCode()}
            placeholder="300 123 4567"
            className={inputCls}
          />
          <button
            type="button"
            onClick={requestCode}
            disabled={pending || phone.replace(/[^0-9]/g, "").length < 10}
            className="btn w-full rounded-full bg-brand px-4 py-2.5 font-bold text-white disabled:opacity-50"
          >
            {pending ? "Enviando…" : "Enviarme el código"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-ink-soft">
            Código enviado al <strong>{phone}</strong>{" "}
            <button
              type="button"
              onClick={() => { setStep("phone"); setCode(""); setNeedsName(false); setNotice(null); setError(null); }}
              className="font-semibold text-brand-dark underline"
            >
              cambiar
            </button>
          </p>
          <label htmlFor="otp-code" className="block text-sm font-medium">Código de 6 dígitos</label>
          <input
            id="otp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="••••••"
            className={`${inputCls} text-center text-xl tracking-[0.5em]`}
          />
          {needsName && (
            <>
              <label htmlFor="new-name" className="block text-sm font-medium">Tu nombre</label>
              <input
                id="new-name"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nombre y apellido"
                className={inputCls}
              />
            </>
          )}
          <button
            type="button"
            onClick={verify}
            disabled={pending || code.length !== 6 || (needsName && fullName.trim().length < 2)}
            className="btn w-full rounded-full bg-brand px-4 py-2.5 font-bold text-white disabled:opacity-50"
          >
            {pending ? "Verificando…" : needsName ? "Crear mi cuenta" : "Ingresar"}
          </button>
          <button
            type="button"
            onClick={requestCode}
            disabled={pending}
            className="btn w-full rounded-full border border-brand-soft px-4 py-2 text-sm text-ink-soft"
          >
            Reenviar código
          </button>
        </div>
      )}

      {notice && <p className="mt-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand-dark">{notice}</p>}
      {error && <p role="alert" className="mt-2 text-sm font-medium text-coral-dark">{error}</p>}
    </div>
  );
}
