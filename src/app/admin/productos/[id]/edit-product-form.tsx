"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminUpdateProduct } from "@/app/actions/admin";

type Category = { id: string; name: string; icon: string | null };

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

export function EditProductForm({
  categories,
  product,
}: {
  categories: Category[];
  product: {
    id: string;
    variantId: string;
    name: string;
    brand: string | null;
    description: string | null;
    categoryId: string;
    restricted: "none" | "liquor" | "cigarettes";
    variantName: string;
    soldByWeight: boolean;
    priceCop: number; // ya en unidad de DISPLAY (por libra si es peso)
    compareAtCop: number | null;
    costCop: number | null;
    sku: string | null;
    barcode: string | null;
    isPerishable: boolean;
    isActive: boolean;
    imageUrl: string | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [name, setName] = useState(product.name);
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [brand, setBrand] = useState(product.brand ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [variantName, setVariantName] = useState(product.variantName);
  const [price, setPrice] = useState(String(product.priceCop));
  const [compareAt, setCompareAt] = useState(product.compareAtCop ? String(product.compareAtCop) : "");
  const [cost, setCost] = useState(product.costCop ? String(product.costCop) : "");
  const [sku, setSku] = useState(product.sku ?? "");
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [restricted, setRestricted] = useState(product.restricted);
  const [perishable, setPerishable] = useState(product.isPerishable);
  const [isActive, setIsActive] = useState(product.isActive);
  const [photo, setPhoto] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const isWeight = product.soldByWeight;
  // Solo las fotos reales (subidas) se pueden "quitar"; el ícono de categoría
  // (fallback) no cuenta como foto propia.
  const hasRealPhoto = product.imageUrl?.startsWith("/api/images/") ?? false;
  const previewSrc = removePhoto ? null : photo ?? product.imageUrl;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const parsedPrice = parseInt(price.replace(/[.\s]/g, ""), 10);
    if (!name.trim() || !categoryId) { setMessage({ ok: false, text: "Completa nombre y categoría." }); return; }
    if (!Number.isInteger(parsedPrice) || parsedPrice <= 0) { setMessage({ ok: false, text: "Precio inválido." }); return; }

    startTransition(async () => {
      const result = await adminUpdateProduct({
        productId: product.id,
        variantId: product.variantId,
        name: name.trim(),
        categoryId,
        brand: brand.trim() || undefined,
        description: description.trim() || undefined,
        variantName: variantName.trim() || undefined,
        priceCop: parsedPrice,
        compareAtCop: compareAt ? parseInt(compareAt.replace(/[.\s]/g, ""), 10) : undefined,
        costCop: cost ? parseInt(cost.replace(/[.\s]/g, ""), 10) : undefined,
        sku: sku.trim() || undefined,
        barcode: barcode.trim() || undefined,
        restricted,
        isPerishable: perishable,
        isActive,
        photoDataUrl: photo ?? undefined,
        removePhoto: removePhoto ? true : undefined,
      });
      if (result.ok) {
        setMessage({ ok: true, text: "✅ Cambios guardados." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-card border border-brand-soft bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="ep-name" className="mb-1 block text-sm font-medium">Nombre *</label>
          <input id="ep-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="ep-cat" className="mb-1 block text-sm font-medium">Categoría *</label>
          <select id="ep-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ep-brand" className="mb-1 block text-sm font-medium">Marca</label>
          <input id="ep-brand" value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ep-desc" className="mb-1 block text-sm font-medium">Descripción</label>
          <textarea id="ep-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
        </div>
      </div>

      <fieldset className="rounded-lg bg-brand-soft/50 p-3">
        <legend className="px-1 text-sm font-bold text-brand-dark">Precio {isWeight && "(por libra)"}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="ep-price" className="mb-1 block text-sm font-medium">{isWeight ? "Precio por libra *" : "Precio (COP) *"}</label>
            <input id="ep-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="ep-compare" className="mb-1 block text-sm font-medium">Precio tachado (oferta)</label>
            <input id="ep-compare" inputMode="numeric" value={compareAt} onChange={(e) => setCompareAt(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="ep-cost" className="mb-1 block text-sm font-medium">{isWeight ? "Costo por libra" : "Costo"}</label>
            <input id="ep-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="ep-variant" className="mb-1 block text-sm font-medium">Presentación</label>
            <input id="ep-variant" value={variantName} onChange={(e) => setVariantName(e.target.value)} className={inputCls} />
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">El stock se maneja en Inventario. Cambiar el precio guarda su historial (no se pisa el anterior).</p>
      </fieldset>

      <fieldset className="rounded-lg bg-brand-soft/50 p-3">
        <legend className="px-1 text-sm font-bold text-brand-dark">Códigos</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ep-sku" className="mb-1 block text-sm font-medium">SKU</label>
            <input id="ep-sku" value={sku} onChange={(e) => setSku(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="ep-barcode" className="mb-1 block text-sm font-medium">Código de barras</label>
            <input id="ep-barcode" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputCls} />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-lg bg-brand-soft/50 p-3">
        <legend className="px-1 text-sm font-bold text-brand-dark">Foto</legend>
        <div className="flex flex-wrap items-center gap-3">
          {previewSrc ? (
            <Image src={previewSrc} alt="Producto" width={80} height={80} unoptimized className="h-20 w-20 rounded-lg border border-brand-soft object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-brand-soft text-center text-[10px] leading-tight text-ink-soft">
              Sin foto<br />(ícono de categoría)
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Reemplazar foto"
            onChange={async (e) => {
              setPhotoError(null);
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const dataUrl = await fileToDataUrl(file);
                if (dataUrl.length > 1_400_000) { setPhotoError("La foto es muy pesada; intenta de nuevo."); return; }
                setPhoto(dataUrl);
                setRemovePhoto(false);
              } catch { setPhotoError("No se pudo procesar la imagen."); }
            }}
            className="rounded-lg border border-brand-soft bg-white p-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:font-semibold file:text-white"
          />
          {!removePhoto && (photo || hasRealPhoto) && (
            <button
              type="button"
              onClick={() => { setPhoto(null); setRemovePhoto(true); setPhotoError(null); }}
              className="btn rounded-full border border-coral/40 px-3 py-1.5 text-xs font-semibold text-coral-dark hover:bg-coral/10"
            >
              🗑️ Quitar foto
            </button>
          )}
          {removePhoto && (
            <button
              type="button"
              onClick={() => setRemovePhoto(false)}
              className="btn rounded-full border border-brand-soft px-3 py-1.5 text-xs text-ink-soft"
            >
              Restaurar
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-ink-soft">
          Para buscar una foto de catálogo usa «Completar fotos». Aquí puedes subir la tuya
          {(photo || hasRealPhoto || removePhoto) && " o quitar la actual (queda el ícono de la categoría)"}.
          {removePhoto && <span className="ml-1 font-semibold text-coral-dark">Se quitará al guardar.</span>}
        </p>
        {photoError && <p role="alert" className="text-xs font-medium text-coral-dark">{photoError}</p>}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ep-restricted" className="mb-1 block text-sm font-medium">Producto restringido (+18)</label>
          <select id="ep-restricted" value={restricted} onChange={(e) => setRestricted(e.target.value as typeof restricted)} className={inputCls}>
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

      <label className="flex items-center gap-2 rounded-lg border border-brand-soft p-3 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-5 w-5 accent-[#16A765]" />
        <span>
          <strong>Producto activo</strong> — visible en la tienda y en la caja.
          {!isActive && <span className="ml-1 font-semibold text-coral-dark">Desactivado: no aparece a los clientes.</span>}
        </span>
      </label>

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm font-medium ${message.ok ? "bg-brand-soft text-brand-dark" : "bg-coral/10 text-coral-dark"}`}>
          {message.text}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn w-full rounded-full bg-brand py-3 font-bold text-white hover:bg-brand-dark disabled:opacity-50">
        {pending ? "Guardando…" : "💾 Guardar cambios"}
      </button>
    </form>
  );
}
