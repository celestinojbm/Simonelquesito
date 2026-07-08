"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

/**
 * Escáner de códigos de barras con la cámara, basado en ZXing.
 * Decodifica los fotogramas en JavaScript, así que funciona en cualquier
 * navegador con cámara (Android/Chrome, iPhone/Safari 11+, escritorio) — sin
 * depender de la API nativa BarcodeDetector, que no existe en Safari ni en
 * Chrome de Windows. La librería se carga solo al abrir el escáner.
 *
 * Requisitos: origen seguro (HTTPS, ya cubierto en producción) y permiso de
 * cámara. El lector físico USB sigue funcionando escribiendo en el campo.
 */
export function BarcodeScanner({ onDetected }: { onDetected: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);

  const hasCamera =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStarting(true);
    setError(null);

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
        ]);
        const reader = new BrowserMultiFormatReader(hints);
        if (cancelled || !videoRef.current) return;

        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current,
          (result) => {
            if (result) {
              const code = result.getText().trim();
              if (code) {
                onDetected(code);
                controlsRef.current?.stop();
                setOpen(false);
              }
            }
          },
        );
        controlsRef.current = controls;
        if (cancelled) controls.stop();
        setStarting(false);
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Permiso de cámara denegado. Actívalo en el navegador para escanear."
            : "No se pudo iniciar la cámara. Digita el código o usa el lector USB.";
        setError(msg);
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onDetected]);

  if (!hasCamera) {
    return (
      <p className="text-xs text-ink-soft">
        📷 Este dispositivo no tiene cámara disponible; digita el código o usa el lector USB.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn rounded-full border border-brand px-4 py-2 text-sm font-semibold text-brand-dark hover:bg-brand-soft"
      >
        📷 Escanear con la cámara
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-card border-2 border-brand">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="h-56 w-full bg-ink object-cover" />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-coral/80" aria-hidden />
        {starting && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/60 text-sm text-white">
            Iniciando cámara…
          </div>
        )}
      </div>
      <p className="text-xs text-ink-soft">Apunta al código de barras; se captura solo.</p>
      {error && <p role="alert" className="text-xs font-medium text-coral-dark">{error}</p>}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="btn rounded-full border border-brand-soft px-4 py-2 text-sm text-ink-soft"
      >
        Cancelar
      </button>
    </div>
  );
}
