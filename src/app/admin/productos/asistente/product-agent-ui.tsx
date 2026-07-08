"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { analyzeProductAction, findImageAction } from "@/app/actions/product-agent";
import { adminCreateProduct } from "@/app/actions/admin";
import type { ProductProposal } from "@/modules/assistant/product-agent";

type Category = { id: string; slug: string; name: string; icon: string | null };

/** Reconocimiento de voz del navegador (Chrome/Edge; es-CO). */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const MAX = 800;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

const inputCls = "w-full rounded-lg border border-brand-soft bg-white px-3 py-2.5 text-sm focus:border-brand";

export function ProductAgent({ configured, categories }: { configured: boolean; categories: Category[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [photo, setPhoto] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);

  // Propuesta editable tras el análisis
  const [proposal, setProposal] = useState<ProductProposal | null>(null);
  const [foundImage, setFoundImage] = useState<{ dataUrl: string; source: string } | null>(null);
  const [useFound, setUseFound] = useState(true);
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");

  const speechAvailable = typeof window !== "undefined" && !!getSpeechRecognition();

  const toggleVoice = () => {
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const recog = getSpeechRecognition();
    if (!recog) return;
    recog.lang = "es-CO";
    recog.interimResults = false;
    recog.onresult = (e) => {
      const phrase = Array.from({ length: e.results.length }, (_, i) => e.results[i]![0]!.transcript).join(" ");
      setText((t) => (t ? `${t} ${phrase}` : phrase));
    };
    recog.onend = () => setListening(false);
    recog.onerror = () => setListening(false);
    recogRef.current = recog;
    setListening(true);
    recog.start();
  };

  const analyze = () => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await analyzeProductAction({ imageDataUrl: photo ?? undefined, text: text || undefined });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setProposal(result.proposal);
      setFoundImage(result.foundImage);
      setUseFound(!!result.foundImage);
      setName(result.proposal.name);
      setBarcode(result.proposal.barcode ?? "");
      setPrice(result.proposal.priceCop ? String(result.proposal.priceCop) : "");
      const cat = categories.find((c) => c.slug === result.proposal.categorySlug);
      setCategoryId(cat?.id ?? "");
    });
  };

  const retryImage = () => {
    startTransition(async () => {
      const r = await findImageAction({ name, barcode: barcode || undefined });
      if (r.ok) {
        setFoundImage(r.foundImage);
        setUseFound(!!r.foundImage);
        if (!r.foundImage) setError("No encontré foto en la base abierta; quedará el ícono de categoría o tu foto.");
      }
    });
  };

  const create = () => {
    if (!proposal) return;
    setError(null);
    startTransition(async () => {
      const chosenPhoto = useFound && foundImage ? foundImage.dataUrl : (photo ?? undefined);
      const result = await adminCreateProduct({
        name,
        categoryId,
        brand: proposal.brand ?? undefined,
        description: proposal.description ?? undefined,
        saleType: proposal.saleType,
        priceCop: Number(price),
        sku: undefined,
        barcode: barcode || undefined,
        initialStock: Number(stock || 0),
        restricted: "none",
        isPerishable: proposal.saleType === "libra",
        photoDataUrl: chosenPhoto,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone(`✅ Producto creado: ${name}`);
      setProposal(null);
      setPhoto(null);
      setText("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {!configured && (
        <p className="rounded-lg bg-sun/40 px-3 py-2 text-sm text-ink">
          ⚠️ El agente necesita la IA configurada (ANTHROPIC_API_KEY). En producción ya está activa.
        </p>
      )}
      {done && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm font-medium text-brand-dark">{done}</p>}
      {error && <p role="alert" className="rounded-lg bg-coral/15 px-3 py-2 text-sm font-medium text-coral-dark">{error}</p>}

      {/* Entrada: foto + voz + texto */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-medium">📸 Foto del producto físico</p>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setPhoto(await fileToDataUrl(file));
                } catch {
                  setError("No se pudo procesar la imagen.");
                }
              }}
              className="w-full rounded-lg border border-brand-soft bg-white p-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:font-semibold file:text-white"
            />
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="Producto capturado" className="mt-2 h-28 rounded-lg object-cover" />
            )}
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">🗣️ Dictado o texto (opcional)</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='Ej.: "aceite diana de 250 a 3.500 pesos, quedan 20"'
              rows={3}
              className={inputCls}
            />
            {speechAvailable && (
              <button
                type="button"
                onClick={toggleVoice}
                className={`btn mt-1 rounded-full px-4 py-1.5 text-xs font-bold ${listening ? "bg-coral text-white" : "border border-brand text-brand-dark"}`}
              >
                {listening ? "⏹ Detener dictado" : "🎙️ Dictar"}
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={analyze}
          disabled={pending || (!photo && !text.trim())}
          className="btn mt-3 w-full rounded-full bg-brand px-4 py-2.5 font-bold text-white disabled:opacity-50"
        >
          {pending ? "Analizando…" : "🪄 Identificar producto"}
        </button>
      </section>

      {/* Propuesta editable */}
      {proposal && (
        <section className="rounded-card border border-brand bg-white p-4">
          <h2 className="mb-1 font-bold text-ink">
            Propuesta del asistente{" "}
            <span className={`rounded-full px-2 py-0.5 text-xs ${proposal.confidence === "alta" ? "bg-brand-soft text-brand-dark" : "bg-sun text-ink"}`}>
              confianza {proposal.confidence}
            </span>
          </h2>
          {proposal.notes && <p className="mb-2 text-xs text-ink-soft">💡 {proposal.notes}</p>}

          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium" htmlFor="pa-name">Nombre</label>
              <input id="pa-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium" htmlFor="pa-cat">Categoría</label>
              <select id="pa-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
                <option value="">Elige…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium" htmlFor="pa-price">
                Precio COP {proposal.saleType === "libra" ? "(por libra)" : ""}
              </label>
              <input id="pa-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium" htmlFor="pa-stock">
                Stock inicial {proposal.saleType === "libra" ? "(libras)" : "(unidades)"}
              </label>
              <input id="pa-stock" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium" htmlFor="pa-barcode">Código de barras</label>
              <input id="pa-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ""))} className={inputCls} />
            </div>
          </div>

          {/* Foto presentable encontrada */}
          <div className="mt-3 rounded-lg bg-cream p-3">
            <p className="text-sm font-medium">🖼️ Foto para publicar</p>
            {foundImage ? (
              <div className="mt-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={foundImage.dataUrl} alt="Foto presentable encontrada" className="h-24 rounded-lg bg-white object-contain" />
                <div className="text-xs text-ink-soft">
                  <p>Fuente: {foundImage.source}</p>
                  <label className="mt-1 flex items-center gap-2">
                    <input type="checkbox" checked={useFound} onChange={(e) => setUseFound(e.target.checked)} />
                    Usar esta foto {photo ? "(si no, se usa la tuya)" : "(si no, ícono de categoría)"}
                  </label>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-ink-soft">
                Sin foto encontrada aún.{" "}
                <button type="button" onClick={retryImage} disabled={pending} className="font-semibold text-brand-dark underline">
                  Buscar de nuevo
                </button>{" "}
                (usa el nombre/código de arriba). Si no aparece, se publica con tu foto o el ícono.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={create}
            disabled={pending || !name.trim() || !categoryId || !price}
            className="btn mt-3 w-full rounded-full bg-brand-dark px-4 py-2.5 font-bold text-white disabled:opacity-50"
          >
            {pending ? "Creando…" : "✅ Crear producto en el catálogo"}
          </button>
        </section>
      )}
    </div>
  );
}
