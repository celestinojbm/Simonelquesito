"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

/**
 * Avisos flotantes (toasts) para confirmaciones que se auto-ocultan. Uso:
 *   const toast = useToast();
 *   toast.ok("Guardado");   toast.error("No se pudo guardar");
 *
 * Regla del sistema: los toasts son para "salió bien / info pasajera". Lo que
 * hay que LEER o ATENDER (errores de formulario, alarma de pedido) sigue fijo.
 * Posición: abajo-centro, con espacio para no tapar el nav ni el botón de
 * WhatsApp del móvil. Región aria-live para lectores de pantalla.
 */

type ToastKind = "ok" | "error" | "info";
type Toast = { id: number; kind: ToastKind; text: string };

const ToastCtx = createContext<{ show: (text: string, kind?: ToastKind) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return {
    toast: ctx.show,
    ok: (text: string) => ctx.show(text, "ok"),
    error: (text: string) => ctx.show(text, "error"),
    info: (text: string) => ctx.show(text, "info"),
  };
}

const DURATION_MS = 5000;
const ERROR_DURATION_MS = 8000; // los errores se leen más despacio
const ICON: Record<ToastKind, string> = { ok: "✅", error: "⚠️", info: "ℹ️" };
const ACCENT: Record<ToastKind, string> = {
  ok: "border-l-brand",
  error: "border-l-coral",
  info: "border-l-brand-soft",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (text: string, kind: ToastKind = "ok") => {
      const id = (idRef.current += 1);
      setToasts((ts) => [...ts, { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === "error" ? ERROR_DURATION_MS : DURATION_MS);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-36 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-card border border-brand-soft border-l-4 bg-white px-4 py-3 text-sm font-medium text-ink shadow-lg ring-1 ring-black/5 ${ACCENT[t.kind]}`}
          >
            <span aria-hidden>{ICON[t.kind]}</span>
            <span className="flex-1">{t.text}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar aviso"
              className="-my-1 shrink-0 text-ink-soft hover:text-ink"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
