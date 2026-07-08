"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lector de balanza por puerto serial (Web Serial API — Chrome/Edge escritorio).
 * Pensado para liquidadoras colombianas con RS-232 (p. ej. BBG Market-30, que
 * trae el puerto y cable de fábrica) usando un adaptador USB-Serial.
 *
 * Parser genérico: la mayoría de liquidadoras emiten tramas ASCII con el peso
 * ("  1.234 kg", "ST,GS,+001.234kg", etc.). Se extrae el último número:
 * con decimales → kilogramos; entero grande → gramos.
 *
 * MODO DIAGNÓSTICO: muestra las tramas crudas (hex + texto). Si un modelo
 * habla distinto, se conecta, se mira la trama real y se ajusta el parser —
 * sin necesidad del manual.
 *
 * El peso estable se publica como evento global "mc-scale-weight" (gramos);
 * cualquier formulario (peso real de pedidos, POS futuro) puede escucharlo.
 */

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
};

declare global {
  interface Navigator {
    serial?: { requestPort: () => Promise<SerialPortLike> };
  }
}

export function publishScaleWeight(grams: number) {
  window.dispatchEvent(new CustomEvent("mc-scale-weight", { detail: { grams, at: Date.now() } }));
}

/** Hook para consumir la última lectura de la balanza (null si no hay). */
export function useScaleWeight(): number | null {
  const [grams, setGrams] = useState<number | null>(null);
  useEffect(() => {
    const handler = (e: Event) => setGrams((e as CustomEvent<{ grams: number }>).detail.grams);
    window.addEventListener("mc-scale-weight", handler);
    return () => window.removeEventListener("mc-scale-weight", handler);
  }, []);
  return grams;
}

const BAUD_OPTIONS = [9600, 4800, 2400, 19200, 38400];

export function ScalePanel() {
  const [supported, setSupported] = useState(false);
  const [connected, setConnected] = useState(false);
  const [baud, setBaud] = useState(9600);
  const [grams, setGrams] = useState<number | null>(null);
  const [diagnostic, setDiagnostic] = useState(false);
  const [rawFrames, setRawFrames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const portRef = useRef<SerialPortLike | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && !!navigator.serial);
  }, []);

  const disconnect = async () => {
    stopRef.current = true;
    try {
      await portRef.current?.close();
    } catch { /* ya cerrado */ }
    portRef.current = null;
    setConnected(false);
  };

  useEffect(() => () => { void disconnect(); }, []);

  const connect = async () => {
    setError(null);
    if (!navigator.serial) return;
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: baud });
      portRef.current = port;
      stopRef.current = false;
      setConnected(true);

      const decoder = new TextDecoder("ascii");
      let buffer = "";
      const reader = port.readable!.getReader();
      (async () => {
        try {
          while (!stopRef.current) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value?.length) continue;

            if (diagnostic) {
              const hex = Array.from(value).map((b) => b.toString(16).padStart(2, "0")).join(" ");
              const ascii = decoder.decode(value).replace(/[^\x20-\x7e]/g, "·");
              setRawFrames((f) => [...f.slice(-14), `${hex}  |  ${ascii}`]);
            }

            buffer = (buffer + decoder.decode(value)).slice(-200);
            // Último número de la trama: "1.234" (kg) o "1234" (g)
            const matches = buffer.match(/(\d{1,3}[.,]\d{1,3})|(\d{3,5})/g);
            if (matches?.length) {
              const raw = matches[matches.length - 1]!.replace(",", ".");
              const n = parseFloat(raw);
              const g = raw.includes(".") ? Math.round(n * 1000) : Math.round(n);
              if (g > 0 && g <= 40_000) {
                setGrams(g);
                publishScaleWeight(g);
              }
            }
          }
        } catch (e) {
          if (!stopRef.current) setError("Se perdió la conexión con la balanza.");
          console.error("[scale]", e);
        } finally {
          reader.releaseLock();
        }
      })();
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "NotFoundError"
          ? "No elegiste ningún puerto."
          : "No se pudo abrir el puerto. Revisa el adaptador USB-Serial y el baud rate.",
      );
    }
  };

  if (!supported) {
    return (
      <p className="rounded-lg bg-cream px-3 py-2 text-xs text-ink-soft">
        ⚖️ La lectura automática de balanza funciona en <strong>Chrome/Edge de escritorio</strong>{" "}
        (Web Serial) con un adaptador USB-Serial conectado a la balanza (RS-232). En este navegador,
        digita el peso manualmente.
      </p>
    );
  }

  return (
    <div className="rounded-card border border-brand-soft bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-ink">⚖️ Balanza</span>
        {connected ? (
          <>
            <span className="rounded-full bg-brand px-3 py-1 text-sm font-extrabold text-white">
              {grams !== null ? `${grams} g (${(grams / 500).toFixed(2)} lb)` : "esperando peso…"}
            </span>
            <button type="button" onClick={disconnect} className="btn rounded-full border border-brand-soft px-3 py-1 text-xs text-ink-soft">
              Desconectar
            </button>
          </>
        ) : (
          <>
            <select value={baud} onChange={(e) => setBaud(Number(e.target.value))} className="rounded-lg border border-brand-soft px-2 py-1 text-xs">
              {BAUD_OPTIONS.map((b) => <option key={b} value={b}>{b} baud</option>)}
            </select>
            <button type="button" onClick={connect} className="btn rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white">
              🔌 Conectar balanza
            </button>
          </>
        )}
        <label className="ml-auto flex items-center gap-1 text-xs text-ink-soft">
          <input type="checkbox" checked={diagnostic} onChange={(e) => { setDiagnostic(e.target.checked); setRawFrames([]); }} />
          modo diagnóstico
        </label>
      </div>
      {error && <p role="alert" className="mt-1 text-xs font-medium text-coral-dark">{error}</p>}
      {diagnostic && (
        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-ink p-2 text-[10px] leading-relaxed text-brand-soft">
          {rawFrames.length ? rawFrames.join("\n") : "Pon peso en la balanza para ver las tramas crudas…"}
        </pre>
      )}
    </div>
  );
}
