"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import {
  activateOnlineCreditAction,
  requestEmailCodeAction,
  submitIdentityAction,
  verifyEmailCodeAction,
} from "@/app/actions/credit-online";

/** Redimensiona la foto de la cédula en el navegador → data-URI liviano. */
async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const MAX = 1000;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

type Step = { key: string; label: string; done: boolean };

const inputCls = "w-full rounded-lg border border-brand-soft bg-white px-3 py-2.5 text-sm focus:border-brand";
const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;

export function CreditoClient({
  initialEmail,
  emailVerified,
  identityStatus,
  requirements,
  hasAccount,
  premiumPriceCop,
}: {
  initialEmail: string;
  emailVerified: boolean;
  identityStatus: "none" | "pending" | "approved" | "rejected";
  identityRejectNote?: string | null;
  requirements: Step[];
  hasAccount: boolean;
  premiumPriceCop: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Éxito → toast (se auto-oculta); error → banner fijo (hay que leerlo/corregir).
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const toast = useToast();

  // Correo
  const [email, setEmail] = useState(initialEmail);
  const [emailSent, setEmailSent] = useState(false);
  const [code, setCode] = useState("");

  // Identidad
  const [documentId, setDocumentId] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => {
    setErrorMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.ok(r.message ?? "Listo.");
        after?.();
        router.refresh();
      } else {
        setErrorMsg(r.message ?? "Error.");
      }
    });
  };

  return (
    <div className="space-y-4">
      {errorMsg && (
        <p role="alert" className="rounded-lg bg-coral/15 px-3 py-2 text-sm font-medium text-coral-dark">
          ⚠️ {errorMsg}
        </p>
      )}

      {/* Checklist de requisitos */}
      <ul className="space-y-1.5 rounded-card border border-brand-soft bg-white p-4 text-sm">
        {requirements.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <span className={r.done ? "text-brand" : "text-ink-soft"}>{r.done ? "✅" : "⬜"}</span>
            <span className={r.done ? "text-ink" : "text-ink-soft"}>{r.label}</span>
          </li>
        ))}
      </ul>

      {/* Paso: verificar correo */}
      {!emailVerified && (
        <section className="rounded-card border border-brand-soft bg-white p-4">
          <h2 className="mb-2 font-bold text-ink">1) Verifica tu correo</h2>
          {!emailSent ? (
            <div className="flex flex-wrap items-end gap-2">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tucorreo@ejemplo.com" className={`${inputCls} max-w-72`} />
              <button
                type="button"
                disabled={pending || !email}
                onClick={() => run(() => requestEmailCodeAction(email), () => setEmailSent(true))}
                className="btn rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Enviar código
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Código de 6 dígitos" className={`${inputCls} max-w-40`} />
              <button
                type="button"
                disabled={pending || code.length !== 6}
                onClick={() => run(() => verifyEmailCodeAction(email, code))}
                className="btn rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Verificar
              </button>
              <button type="button" onClick={() => { setEmailSent(false); setCode(""); }} className="btn rounded-full border border-brand-soft px-4 py-2 text-xs text-ink-soft">
                Cambiar correo
              </button>
            </div>
          )}
        </section>
      )}

      {/* Paso: verificar identidad */}
      {emailVerified && identityStatus !== "approved" && (
        <section className="rounded-card border border-brand-soft bg-white p-4">
          <h2 className="mb-1 font-bold text-ink">2) Verifica tu identidad (mayor de 18)</h2>
          {identityStatus === "pending" ? (
            <p className="rounded-lg bg-sun/20 px-3 py-2 text-sm text-ink">
              ⏳ Tu cédula está en revisión. Te avisaremos cuando la aprobemos (normalmente el mismo día).
            </p>
          ) : (
            <>
              {identityStatus === "rejected" && (
                <p className="mb-2 rounded-lg bg-coral/15 px-3 py-2 text-sm text-coral-dark">
                  Tu envío anterior fue rechazado. Corrige y vuelve a enviar.
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={documentId} onChange={(e) => setDocumentId(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Número de cédula" inputMode="numeric" className={inputCls} />
                <label className="text-xs text-ink-soft">
                  Fecha de nacimiento
                  <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={inputCls} />
                </label>
              </div>
              <div className="mt-2">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label="Foto de la cédula"
                  onChange={async (e) => {
                    setPhotoError(null);
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const url = await fileToDataUrl(file);
                      if (url.length > 1_400_000) { setPhotoError("La foto es muy pesada; intenta de nuevo."); return; }
                      setPhoto(url);
                    } catch { setPhotoError("No se pudo procesar la imagen."); }
                  }}
                  className="w-full rounded-lg border border-brand-soft bg-white p-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:font-semibold file:text-white"
                />
                <p className="mt-1 text-xs text-ink-soft">Foto clara de la cédula por el frente. Solo la ve el personal de la tienda.</p>
                {photoError && <p role="alert" className="text-xs font-medium text-coral-dark">{photoError}</p>}
                {photo && <p className="mt-1 text-xs text-brand-dark">✓ Foto lista</p>}
              </div>
              <button
                type="button"
                disabled={pending || documentId.length < 5 || !birthDate || !photo}
                onClick={() => run(() => submitIdentityAction({ documentId, birthDate, frontImageUrl: photo! }))}
                className="btn mt-3 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Enviar a revisión
              </button>
            </>
          )}
        </section>
      )}

      {/* Paso final: activar */}
      {emailVerified && identityStatus === "approved" && !hasAccount && (
        <section className="rounded-card border-2 border-brand bg-white p-4">
          <h2 className="mb-1 font-bold text-ink">3) Activa tu membresía y tu cupo</h2>
          <p className="mb-3 text-sm text-ink-soft">
            La membresía premium ({cop(premiumPriceCop)}/mes) se cargará a tu Fiado como primera cuota,
            así puedes empezar a pedir a crédito sin pagar nada por adelantado.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => activateOnlineCreditAction())}
            className="btn rounded-full bg-brand px-6 py-3 font-bold text-white disabled:opacity-50"
          >
            {pending ? "Activando…" : `Activar premium y abrir mi cupo`}
          </button>
        </section>
      )}

      {hasAccount && (
        <section className="rounded-card border border-brand-soft bg-brand-soft/40 p-4 text-sm text-brand-dark">
          🎉 Tu cupo de Fiado está activo. Al finalizar tu compra, elige <strong>“Pagar a crédito (en cuotas)”</strong>.
        </section>
      )}
    </div>
  );
}
