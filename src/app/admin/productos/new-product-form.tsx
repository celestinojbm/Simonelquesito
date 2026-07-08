"use client";

import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminCreateProduct } from "@/app/actions/admin";
import { BarcodeScanner } from "./barcode-scanner";

type Category = { id: string; name: string; icon: string | null; nextSku: string | null };

/** Redimensiona la foto en el navegador (máx. 800 px, JPEG) → data-URI liviano. */
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

export function NewProductForm({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [saleType, setSaleType] = useState<"unit" | "pack" | "libra">("unit");
  const [variantName, setVariantName] = useState("");
  const [price, setPrice] = useState("");
  const [compareAt, setCompareAt] = useState("");
  const [cost, setCost] = useState("");
  const [sku, setSku] = useState("");
  const [skuTouched, setSkuTouched] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [stock, setStock] = useState("");
  const [restricted, setRestricted] = useState<"none" | "liquor" | "cigarettes">("none");
  const [perishable, setPerishable] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const isWeight = saleType === "libra";

  // SKU sugerido: consecutivo de la categoría elegida. Se rellena solo y se
  // actualiza tras cada alta (router.refresh trae el siguiente); si el
  // usuario escribe uno propio, se respeta hasta que borre el campo.
  useEffect(() => {
    if (skuTouched) return;
    const cat = categories.find((c) => c.id === categoryId);
    setSku(cat?.nextSku ?? "");
  }, [categoryId, categories, skuTouched]);

  const reset = () => {
    setName(""); setBrand(""); setDescription(""); setVariantName("");
    setPrice(""); setCompareAt(""); setCost(""); setSku(""); setSkuTouched(false); setBarcode("");
    setStock(""); setRestricted("none"); setPerishable(false); setPhoto(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const parsedPrice = parseInt(price.replace(/[.\s]/g, ""), 10);
    const parsedStock = parseInt(stock, 10);
    if (!name.trim() || !categoryId) { setMessage({ ok: false, text: "Completa nombre y categoría." }); return; }
    if (!Number.isInteger(parsedPrice) || parsedPrice <= 0) { setMessage({ ok: false, text: "Precio inválido." }); return; }
    if (!Number.isInteger(parsedStock) || parsedStock < 0) { setMessage({ ok: false, text: "Stock inicial inválido." }); return; }

    startTransition(async () => {
      const result = await adminCreateProduct({
        name: name.trim(),
        categoryId,
        brand: brand.trim() || undefined,
        description: description.trim() || undefined,
        variantName: variantName.trim() || undefined,
        saleType,
        priceCop: parsedPrice,
        compareAtCop: compareAt ? parseInt(compareAt.replace(/[.\s]/g, ""), 10) : undefined,
        costCop: cost ? parseInt(cost.replace(/[.\s]/g, ""), 10) : undefined,
        sku: sku.trim() || undefined,
        barcode: barcode.trim() || undefined,
        initialStock: parsedStock,
        restricted,
        isPerishable: perishable,
        photoDataUrl: photo ?? undefined,
      });
      if (result.ok) {
        setMessage({ ok: true, text: `✅ Producto creado. Ya está visible en la tienda (/producto/${result.slug}).` });
        reset();
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  };

  return (
    <section className="rounded-card border border-brand-soft bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <span className="font-bold text-ink">➕ Agregar producto</span>
        <span className="rounded-full border border-brand-soft px-3 py-1 text-xs font-semibold text-brand-dark">
          {open ? "▲ Recoger" : "▼ Abrir formulario"}
        </span>
      </button>

      {open && (
    <form onSubmit={submit} className="space-y-4 border-t border-brand-soft p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="np-name" className="mb-1 block text-sm font-medium">Nombre *</label>
          <input id="np-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Ej.: Lenteja La Garza 500 g" />
        </div>
        <div>
          <label htmlFor="np-cat" className="mb-1 block text-sm font-medium">Categoría *</label>
          <select id="np-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
            <option value="">Elige…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="np-brand" className="mb-1 block text-sm font-medium">Marca</label>
          <input id="np-brand" value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="np-desc" className="mb-1 block text-sm font-medium">Descripción</label>
          <textarea id="np-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
        </div>
      </div>

      <fieldset className="rounded-lg bg-brand-soft/50 p-3">
        <legend className="px-1 text-sm font-bold text-brand-dark">Venta y precio</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="np-type" className="mb-1 block text-sm font-medium">Se vende por</label>
            <select id="np-type" value={saleType} onChange={(e) => setSaleType(e.target.value as typeof saleType)} className={inputCls}>
              <option value="unit">Unidad</option>
              <option value="pack">Paquete</option>
              <option value="libra">Libra (peso variable)</option>
            </select>
          </div>
          <div>
            <label htmlFor="np-price" className="mb-1 block text-sm font-medium">
              {isWeight ? "Precio por libra (COP) *" : "Precio (COP) *"}
            </label>
            <input id="np-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder="Ej.: 4500" />
          </div>
          <div>
            <label htmlFor="np-stock" className="mb-1 block text-sm font-medium">
              {isWeight ? "Stock inicial (libras) *" : "Stock inicial (unidades) *"}
            </label>
            <input id="np-stock" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} className={inputCls} placeholder="Ej.: 40" />
          </div>
          <div>
            <label htmlFor="np-compare" className="mb-1 block text-sm font-medium">Precio tachado (oferta)</label>
            <input id="np-compare" inputMode="numeric" value={compareAt} onChange={(e) => setCompareAt(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="np-cost" className="mb-1 block text-sm font-medium">{isWeight ? "Costo por libra" : "Costo"}</label>
            <input id="np-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="np-variant" className="mb-1 block text-sm font-medium">Presentación</label>
            <input id="np-variant" value={variantName} onChange={(e) => setVariantName(e.target.value)} className={inputCls} placeholder={isWeight ? "Por libra" : "Unidad"} />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-lg bg-brand-soft/50 p-3">
        <legend className="px-1 text-sm font-bold text-brand-dark">Códigos</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="np-sku" className="mb-1 block text-sm font-medium">SKU / referencia interna</label>
            <input
              id="np-sku"
              value={sku}
              onChange={(e) => {
                setSku(e.target.value);
                // Si borra el campo vuelve la sugerencia automática.
                setSkuTouched(e.target.value.trim().length > 0);
              }}
              className={inputCls}
              placeholder="Se genera solo al elegir categoría"
            />
            {!skuTouched && sku && (
              <p className="mt-0.5 text-[11px] text-brand-dark">Sugerido automáticamente; puedes cambiarlo.</p>
            )}
          </div>
          <div>
            <label htmlFor="np-barcode" className="mb-1 block text-sm font-medium">Código de barras (EAN/UPC)</label>
            <input id="np-barcode" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputCls} placeholder="Escanéalo o dígitalo" />
          </div>
        </div>
        <div className="mt-2">
          <BarcodeScanner onDetected={setBarcode} />
        </div>
      </fieldset>

      <fieldset className="rounded-lg bg-brand-soft/50 p-3">
        <legend className="px-1 text-sm font-bold text-brand-dark">Foto</legend>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Foto del producto"
          onChange={async (e) => {
            setPhotoError(null);
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const dataUrl = await fileToDataUrl(file);
              if (dataUrl.length > 1_400_000) { setPhotoError("La foto es muy pesada; intenta de nuevo."); return; }
              setPhoto(dataUrl);
            } catch {
              setPhotoError("No se pudo procesar la imagen.");
            }
          }}
          className="w-full rounded-lg border border-brand-soft bg-white p-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:font-semibold file:text-white"
        />
        <p className="mt-1 text-xs text-ink-soft">Puedes tomarla con la cámara del celular; se optimiza sola.</p>
        {photoError && <p role="alert" className="text-xs font-medium text-coral-dark">{photoError}</p>}
        {photo && (
          <div className="mt-2 flex items-center gap-3">
            <Image src={photo} alt="Vista previa" width={96} height={96} unoptimized className="h-24 w-24 rounded-lg border border-brand-soft object-cover" />
            <button type="button" onClick={() => setPhoto(null)} className="btn rounded-full border border-brand-soft px-3 py-1.5 text-xs text-ink-soft">
              Quitar foto
            </button>
          </div>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="np-restricted" className="mb-1 block text-sm font-medium">Producto restringido (+18)</label>
          <select id="np-restricted" value={restricted} onChange={(e) => setRestricted(e.target.value as typeof restricted)} className={inputCls}>
            <option value="none">No</option>
            <option value="liquor">Sí — licor / cerveza</option>
            <option value="cigarettes">Sí — cigarrillos</option>
          </select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={perishable} onChange={(e) => setPerishable(e.target.checked)} className="h-5 w-5 accent-[#16A765]" />
          Es perecedero (frutas, panadería, refrigerado)
        </label>
      </div>

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm font-medium ${message.ok ? "bg-brand-soft text-brand-dark" : "bg-coral/10 text-coral-dark"}`}>
          {message.text}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn w-full rounded-full bg-brand py-3 font-bold text-white hover:bg-brand-dark disabled:opacity-50">
        {pending ? "Creando…" : "Crear producto"}
      </button>
    </form>
      )}
    </section>
  );
}
