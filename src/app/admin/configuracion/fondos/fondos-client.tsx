"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  setSectionBackgroundAction,
  removeSectionBackgroundAction,
  setSectionColorAction,
  removeSectionColorAction,
  setSectionStyleAction,
} from "@/app/actions/fondos";
import {
  SECTION_FONTS,
  SECTION_SIZES,
  fontStack,
  sizeRem,
  type SectionStyle,
} from "@/modules/config/section-style";

export type SectionRow = {
  key: string;
  label: string;
  icon: string;
  url: string | null;
  color: string | null;
  style: SectionStyle;
  pageUrl: string | null;
  allowImage: boolean;
  allowColor: boolean;
  allowStyle: boolean;
  allowSubtitle: boolean;
  allowPageBg: boolean;
  titlePlaceholder: string;
};

/**
 * Reduce la imagen EN EL NAVEGADOR antes de subirla: máx. 1600px del lado
 * mayor, JPEG q0.8. Así el data-URI que viaja al servidor es liviano y el
 * fondo carga rápido en la tienda. Devuelve null si algo falla o queda pesado.
 */
async function fileToDataUrl(file: File): Promise<string | null> {
  try {
    if (!file.type.startsWith("image/")) return null;
    const bitmap = await createImageBitmap(file);
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    return dataUrl.length > 3_400_000 ? null : dataUrl;
  } catch {
    return null;
  }
}

type Appearance = { url: string | null; color: string | null; style: SectionStyle; pageUrl: string | null };

export function FondosClient({ sections }: { sections: SectionRow[] }) {
  const { ok, error } = useToast();
  const [state, setState] = useState<Record<string, Appearance>>(
    Object.fromEntries(sections.map((s) => [s.key, { url: s.url, color: s.color, style: s.style, pageUrl: s.pageUrl }])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const pageInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const patch = (key: string, a: Partial<Appearance>) =>
    setState((s) => {
      const prev = s[key] ?? { url: null, color: null, style: {}, pageUrl: null };
      return {
        ...s,
        [key]: {
          url: "url" in a ? (a.url ?? null) : prev.url,
          color: "color" in a ? (a.color ?? null) : prev.color,
          style: "style" in a ? (a.style ?? {}) : prev.style,
          pageUrl: "pageUrl" in a ? (a.pageUrl ?? null) : prev.pageUrl,
        },
      };
    });

  // Fondo de pantalla propio de la sección (clave pagebg:<key>).
  const onPickPage = async (key: string, file: File | undefined) => {
    if (!file) return;
    setBusy(key);
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!dataUrl) return void error("No se pudo procesar la imagen.");
      const r = await setSectionBackgroundAction({ sectionKey: `pagebg:${key}`, dataUrl });
      if (!r.ok) return void error(r.message);
      patch(key, { pageUrl: dataUrl });
      ok("Fondo de pantalla de la sección actualizado.");
    } finally {
      setBusy(null);
      const el = pageInputs.current[key];
      if (el) el.value = "";
    }
  };
  const onRemovePage = async (key: string) => {
    setBusy(key);
    try {
      const r = await removeSectionBackgroundAction(`pagebg:${key}`);
      if (!r.ok) return void error(r.message);
      patch(key, { pageUrl: null });
      ok("Fondo de pantalla de la sección eliminado.");
    } finally {
      setBusy(null);
    }
  };

  const onPick = async (key: string, file: File | undefined) => {
    if (!file) return;
    setBusy(key);
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!dataUrl) return void error("No se pudo procesar la imagen (¿muy grande o formato no válido?).");
      const r = await setSectionBackgroundAction({ sectionKey: key, dataUrl });
      if (!r.ok) return void error(r.message);
      patch(key, { url: dataUrl });
      ok("Imagen actualizada.");
    } finally {
      setBusy(null);
      const el = inputs.current[key];
      if (el) el.value = "";
    }
  };

  const onRemoveImage = async (key: string) => {
    setBusy(key);
    try {
      const r = await removeSectionBackgroundAction(key);
      if (!r.ok) return void error(r.message);
      patch(key, { url: null });
      ok("Imagen eliminada.");
    } finally {
      setBusy(null);
    }
  };

  const onSaveColor = async (key: string, color: string) => {
    setBusy(key);
    try {
      const r = await setSectionColorAction({ sectionKey: key, color });
      if (!r.ok) return void error(r.message);
      patch(key, { color });
      ok("Color aplicado.");
    } finally {
      setBusy(null);
    }
  };

  const onRemoveColor = async (key: string) => {
    setBusy(key);
    try {
      const r = await removeSectionColorAction(key);
      if (!r.ok) return void error(r.message);
      patch(key, { color: null });
      ok("Color quitado.");
    } finally {
      setBusy(null);
    }
  };

  const onSaveStyle = async (key: string, style: SectionStyle) => {
    setBusy(key);
    try {
      const r = await setSectionStyleAction({ sectionKey: key, style });
      if (!r.ok) return void error(r.message);
      patch(key, { style });
      ok("Texto y tipografía guardados.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {sections.map((s) => {
        const a = state[s.key] ?? { url: s.url, color: s.color, style: s.style, pageUrl: s.pageUrl };
        const isBusy = busy === s.key;
        // Texto/color de la vista previa según el estilo guardado.
        const previewTitle = a.style.title || `${s.icon} ${s.label}`;
        const previewColor = a.url ? "#ffffff" : a.style.textColor ?? readableTextOn(a.color);
        return (
          <li key={s.key} className="rounded-card border border-brand-soft bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-lg" aria-hidden>{s.icon}</span>
              <span className="font-semibold text-ink">{s.label}</span>
              {a.url ? (
                <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-dark">con imagen</span>
              ) : a.color ? (
                <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-dark">con color</span>
              ) : null}
            </div>

            {/* Vista previa: fondo (imagen/color) + el título con su tipografía. */}
            <div
              className="relative flex h-32 w-full items-end overflow-hidden rounded-lg border border-brand-soft"
              style={{ backgroundColor: a.color ?? "var(--color-brand-soft)" }}
            >
              {a.url && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-black/10" />
                </>
              )}
              {s.allowStyle || a.url || a.color ? (
                <span
                  className="relative m-3 truncate font-extrabold"
                  style={{
                    color: previewColor,
                    fontFamily: fontStack(a.style.font) ?? undefined,
                    textShadow: a.url ? "0 1px 2px rgba(0,0,0,.5)" : undefined,
                  }}
                >
                  {previewTitle}
                </span>
              ) : (
                <span className="m-auto text-xs text-ink-soft">Sin imagen ni color — diseño por defecto</span>
              )}
            </div>

            {/* Fondo: imagen */}
            {s.allowImage && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="btn cursor-pointer rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white">
                  {isBusy ? "Procesando…" : a.url ? "Cambiar imagen" : "Subir imagen"}
                  <input
                    ref={(el) => { inputs.current[s.key] = el; }}
                    type="file" accept="image/*" className="hidden" disabled={isBusy}
                    onChange={(e) => void onPick(s.key, e.target.files?.[0])}
                  />
                </label>
                {a.url && (
                  <button type="button" disabled={isBusy} onClick={() => void onRemoveImage(s.key)}
                    className="btn rounded-full border border-brand-soft px-3 py-1.5 text-xs text-ink-soft">
                    Quitar imagen
                  </button>
                )}
              </div>
            )}

            {/* Fondo: color (solo portada y categorías) */}
            {s.allowColor && (
              <ColorRow
                current={a.color} disabled={isBusy} hasImage={!!a.url}
                onSave={(c) => void onSaveColor(s.key, c)}
                onRemove={() => void onRemoveColor(s.key)}
              />
            )}

            {/* Texto y tipografía */}
            {s.allowStyle && (
              <StyleRow
                initial={a.style} disabled={isBusy}
                allowSubtitle={s.allowSubtitle} titlePlaceholder={s.titlePlaceholder}
                onSave={(st) => void onSaveStyle(s.key, st)}
              />
            )}

            {/* Fondo de pantalla propio de la sección (detrás de todo) */}
            {s.allowPageBg && (
              <div className="mt-2 border-t border-brand-soft pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ink">🖥️ Fondo de pantalla de esta sección</span>
                  {a.pageUrl && (
                    <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand-dark">activo</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-ink-soft">Va detrás de todo (como papel tapiz), solo en esta sección.</p>
                {a.pageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.pageUrl} alt="" className="mt-2 h-16 w-full rounded-lg border border-brand-soft object-cover" />
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="btn cursor-pointer rounded-full border border-brand px-3 py-1.5 text-xs font-bold text-brand-dark">
                    {isBusy ? "Procesando…" : a.pageUrl ? "Cambiar fondo" : "Subir fondo"}
                    <input
                      ref={(el) => { pageInputs.current[s.key] = el; }}
                      type="file" accept="image/*" className="hidden" disabled={isBusy}
                      onChange={(e) => void onPickPage(s.key, e.target.files?.[0])}
                    />
                  </label>
                  {a.pageUrl && (
                    <button type="button" disabled={isBusy} onClick={() => void onRemovePage(s.key)}
                      className="btn rounded-full border border-brand-soft px-3 py-1.5 text-xs text-ink-soft">Quitar</button>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Selector de color de fondo con "Guardar". */
function ColorRow({
  current, disabled, hasImage, onSave, onRemove,
}: { current: string | null; disabled: boolean; hasImage: boolean; onSave: (c: string) => void; onRemove: () => void }) {
  const [value, setValue] = useState(current ?? "#16a765");
  const changed = value.toLowerCase() !== (current ?? "").toLowerCase();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-brand-soft pt-2">
      <span className="text-xs text-ink-soft">Color de fondo:</span>
      <input type="color" value={value} disabled={disabled} onChange={(e) => setValue(e.target.value)}
        aria-label="Elegir color de fondo" className="h-7 w-10 cursor-pointer rounded border border-brand-soft bg-white p-0.5" />
      <button type="button" disabled={disabled || !changed} onClick={() => onSave(value)}
        className="btn rounded-full bg-brand px-3 py-1 text-xs font-bold text-white disabled:opacity-40">
        {current ? "Cambiar color" : "Aplicar color"}
      </button>
      {current && (
        <button type="button" disabled={disabled} onClick={onRemove}
          className="btn rounded-full border border-brand-soft px-3 py-1 text-xs text-ink-soft">Quitar color</button>
      )}
      {hasImage && current && (
        <span className="w-full text-[11px] text-ink-soft">Ahora se muestra la imagen; el color se usaría si la quitas.</span>
      )}
    </div>
  );
}

/** Editor de texto y tipografía de la sección. */
function StyleRow({
  initial, disabled, allowSubtitle, titlePlaceholder, onSave,
}: {
  initial: SectionStyle;
  disabled: boolean;
  allowSubtitle: boolean;
  titlePlaceholder: string;
  onSave: (s: SectionStyle) => void;
}) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [subtitle, setSubtitle] = useState(initial.subtitle ?? "");
  const [font, setFont] = useState(initial.font ?? "default");
  const [size, setSize] = useState(initial.titleSize ?? "");
  const [autoColor, setAutoColor] = useState(!initial.textColor);
  const [color, setColor] = useState(initial.textColor ?? "#ffffff");

  const save = () =>
    onSave({
      title: title.trim() || null,
      subtitle: allowSubtitle ? subtitle.trim() || null : null,
      font: font !== "default" ? font : null,
      titleSize: size || null,
      textColor: autoColor ? null : color,
    });

  return (
    <details className="mt-2 border-t border-brand-soft pt-2">
      <summary className="cursor-pointer text-xs font-semibold text-brand-dark">✍️ Texto y tipografía</summary>
      <div className="mt-2 space-y-2">
        <label className="block">
          <span className="text-[11px] text-ink-soft">Título (puedes pegar emojis 🥑 y símbolos ★ →)</span>
          <input value={title} disabled={disabled} maxLength={120} onChange={(e) => setTitle(e.target.value)}
            placeholder={titlePlaceholder}
            className="mt-0.5 w-full rounded-lg border border-brand-soft px-2 py-1.5 text-sm" />
        </label>
        {allowSubtitle && (
          <label className="block">
            <span className="text-[11px] text-ink-soft">Subtítulo (opcional)</span>
            <input value={subtitle} disabled={disabled} maxLength={200} onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Ej: Frescura y buen precio, a domicilio"
              className="mt-0.5 w-full rounded-lg border border-brand-soft px-2 py-1.5 text-sm" />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <label className="flex-1">
            <span className="text-[11px] text-ink-soft">Tipografía</span>
            <select value={font} disabled={disabled} onChange={(e) => setFont(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-brand-soft px-2 py-1.5 text-sm">
              {SECTION_FONTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <label className="flex-1">
            <span className="text-[11px] text-ink-soft">Tamaño del título</span>
            <select value={size} disabled={disabled} onChange={(e) => setSize(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-brand-soft px-2 py-1.5 text-sm">
              <option value="">Predeterminado</option>
              {SECTION_SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-ink-soft">
            <input type="checkbox" checked={autoColor} disabled={disabled} onChange={(e) => setAutoColor(e.target.checked)} />
            Color de texto automático
          </label>
          {!autoColor && (
            <input type="color" value={color} disabled={disabled} onChange={(e) => setColor(e.target.value)}
              aria-label="Color del texto" className="h-7 w-10 cursor-pointer rounded border border-brand-soft bg-white p-0.5" />
          )}
        </div>
        {/* Vista previa del título con la tipografía elegida */}
        <div className="rounded-lg bg-ink/5 p-2">
          <span className="text-[11px] text-ink-soft">Vista previa:</span>
          <p className="truncate font-extrabold"
            style={{ fontFamily: fontStack(font) ?? undefined, fontSize: sizeRem(size) ?? "1.5rem", color: autoColor ? "var(--color-ink)" : color }}>
            {title.trim() || "Título de ejemplo"}
          </p>
        </div>
        <button type="button" disabled={disabled} onClick={save}
          className="btn rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white">
          Guardar texto y estilo
        </button>
      </div>
    </details>
  );
}

/** Blanco o tinta según la luminancia del color, para que el texto contraste. */
function readableTextOn(hex: string | null): string {
  if (!hex) return "#17231d";
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#17231d";
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#17231d" : "#ffffff";
}
