"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { setAdminPanelAction, uploadPanelImageAction } from "@/app/actions/panel";
import { BLOCK_TYPES, blockLabel, type PanelBlock, type BlockType } from "@/modules/admin/blocks";

/** Reduce una imagen en el navegador (≤1200px, JPEG) antes de subirla. */
async function panelImageToDataUrl(file: File): Promise<string | null> {
  try {
    if (!file.type.startsWith("image/")) return null;
    const bitmap = await createImageBitmap(file);
    const MAX = 1200;
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

export type NavRow = {
  href: string;
  icon: string;
  defaultLabel: string;
  label: string; // renombrado ("" = usar el predeterminado)
  hidden: boolean;
  canHide: boolean;
};

// Colores de panel probados (barra lateral). El texto se ajusta solo al tono.
const ACCENTS = [
  { hex: "#12613f", name: "Verde bosque" },
  { hex: "#1e3a8a", name: "Azul" },
  { hex: "#0f5f57", name: "Teal" },
  { hex: "#4c1d95", name: "Morado" },
  { hex: "#7f1d1d", name: "Vino" },
  { hex: "#1f2937", name: "Grafito" },
  { hex: "#92500a", name: "Ámbar oscuro" },
];

type Card = { key: string; label: string };
type Role = { value: string; label: string };

export function PanelClient({
  items: initial,
  accent: initialAccent,
  cards,
  roles,
  dashboard: initialDash,
  blocks: initialBlocks,
}: {
  items: NavRow[];
  accent: string | null;
  cards: Card[];
  roles: Role[];
  dashboard: Record<string, string[]>;
  blocks: PanelBlock[];
}) {
  const { ok, error } = useToast();
  const router = useRouter();
  const [items, setItems] = useState<NavRow[]>(initial);
  const [accent, setAccent] = useState<string | null>(initialAccent);
  const [saving, setSaving] = useState(false);

  // Bloques del inicio (Nivel 3): lista ordenada, con arrastrar-y-soltar.
  const [blocks, setBlocks] = useState<PanelBlock[]>(initialBlocks);
  const dragIx = useRef<number | null>(null);
  const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `blk_${Date.now()}_${blocks.length}`);
  const addBlock = (type: BlockType) => setBlocks((b) => [...b, { id: newId(), type }]);
  const patchBlock = (i: number, p: Partial<PanelBlock>) => setBlocks((b) => b.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const removeBlock = (i: number) => setBlocks((b) => b.filter((_, k) => k !== i));
  const moveBlock = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    setBlocks((b) => {
      const next = [...b];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it!);
      return next;
    });
  };
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const uploadBlockImage = async (i: number, file: File | undefined) => {
    if (!file) return;
    const blk = blocks[i];
    if (!blk) return;
    setUploadingId(blk.id);
    try {
      const dataUrl = await panelImageToDataUrl(file);
      if (!dataUrl) return void error("No se pudo procesar la imagen.");
      const r = await uploadPanelImageAction(dataUrl);
      if (!r.ok) return void error(r.message);
      patchBlock(i, { url: r.url });
      ok("Imagen subida.");
    } finally {
      setUploadingId(null);
    }
  };
  // Accesos rápidos (items del bloque "links").
  const setLinkItems = (i: number, items: { label: string; href: string }[]) => patchBlock(i, { items });

  // Dashboard por rol: config (rol → llaves visibles en orden) + filas del rol activo.
  const allKeys = cards.map((c) => c.key);
  const labelOf = (k: string) => cards.find((c) => c.key === k)?.label ?? k;
  const rowsForRole = (role: string, cfg: Record<string, string[]>): { key: string; visible: boolean }[] => {
    const list = cfg[role];
    if (!list) return cards.map((c) => ({ key: c.key, visible: true }));
    const seen = new Set(list.filter((k) => allKeys.includes(k)));
    return [
      ...list.filter((k) => allKeys.includes(k)).map((k) => ({ key: k, visible: true })),
      ...cards.filter((c) => !seen.has(c.key)).map((c) => ({ key: c.key, visible: false })),
    ];
  };
  const [dashCfg, setDashCfg] = useState<Record<string, string[]>>(initialDash);
  const [role, setRole] = useState<string>(roles[0]?.value ?? "owner");
  const [rows, setRows] = useState(() => rowsForRole(roles[0]?.value ?? "owner", initialDash));

  const isDefault = (rs: { key: string; visible: boolean }[]) =>
    rs.every((r, i) => r.visible && r.key === allKeys[i]);

  const commitRows = (newRows: { key: string; visible: boolean }[]) => {
    setRows(newRows);
    setDashCfg((prev) => {
      const next = { ...prev };
      if (isDefault(newRows)) delete next[role]; // "todas por defecto" = sin entrada
      else next[role] = newRows.filter((r) => r.visible).map((r) => r.key);
      return next;
    });
  };
  const selectRole = (r: string) => { setRole(r); setRows(rowsForRole(r, dashCfg)); };
  const moveCard = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    commitRows(next);
  };
  const toggleCard = (i: number) => commitRows(rows.map((r, k) => (k === i ? { ...r, visible: !r.visible } : r)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setItems(next);
  };
  const patch = (i: number, p: Partial<NavRow>) =>
    setItems((arr) => arr.map((it, k) => (k === i ? { ...it, ...p } : it)));

  const save = async () => {
    setSaving(true);
    try {
      const navLabels: Record<string, string> = {};
      for (const it of items) {
        const t = it.label.trim();
        if (t && t !== it.defaultLabel) navLabels[it.href] = t;
      }
      const r = await setAdminPanelAction({
        navOrder: items.map((it) => it.href),
        navHidden: items.filter((it) => it.hidden && it.canHide).map((it) => it.href),
        navLabels,
        accent,
        dashboard: dashCfg,
        blocks,
      });
      if (!r.ok) return void error(r.message);
      ok("Panel actualizado.");
      router.refresh(); // recarga el layout para ver el menú/color nuevos
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Color del panel */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h3 className="mb-1 font-bold text-ink">Color del panel</h3>
        <p className="mb-3 text-xs text-ink-soft">Cambia el color de la barra lateral. El texto se ajusta solo para que se lea.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAccent(null)}
            className={`btn rounded-full px-3 py-1.5 text-xs font-semibold ${accent === null ? "bg-brand text-white" : "border border-brand-soft text-ink-soft"}`}
          >
            Color de marca
          </button>
          {ACCENTS.map((a) => (
            <button
              key={a.hex}
              type="button"
              title={a.name}
              aria-label={a.name}
              onClick={() => setAccent(a.hex)}
              className="h-8 w-8 rounded-full border-2"
              style={{ backgroundColor: a.hex, borderColor: accent === a.hex ? "var(--color-ink)" : "var(--color-brand-soft)" }}
            />
          ))}
          <label className="ml-1 inline-flex items-center gap-1 text-xs text-ink-soft">
            Personalizado
            <input
              type="color"
              value={accent ?? "#12613f"}
              onChange={(e) => setAccent(e.target.value)}
              aria-label="Color personalizado del panel"
              className="h-8 w-10 cursor-pointer rounded border border-brand-soft bg-white p-0.5"
            />
          </label>
        </div>
      </section>

      {/* Menú lateral */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h3 className="mb-1 font-bold text-ink">Menú lateral</h3>
        <p className="mb-3 text-xs text-ink-soft">Reordena con ▲▼, esconde con el interruptor, o escribe un nombre nuevo.</p>
        <ul className="divide-y divide-brand-soft">
          {items.map((it, i) => (
            <li key={it.href} className="flex flex-wrap items-center gap-2 py-2">
              <div className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir"
                  className="btn h-5 rounded border border-brand-soft px-1.5 text-[10px] text-ink-soft disabled:opacity-30">▲</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Bajar"
                  className="btn mt-0.5 h-5 rounded border border-brand-soft px-1.5 text-[10px] text-ink-soft disabled:opacity-30">▼</button>
              </div>
              <span className="text-lg" aria-hidden>{it.icon}</span>
              <input
                value={it.label}
                placeholder={it.defaultLabel}
                maxLength={40}
                onChange={(e) => patch(i, { label: e.target.value })}
                className={`min-w-0 flex-1 rounded-lg border border-brand-soft px-2 py-1.5 text-sm ${it.hidden ? "opacity-50 line-through" : ""}`}
              />
              <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-soft">
                {it.hidden ? "Oculta" : "Visible"}
                <button
                  type="button"
                  role="switch"
                  aria-checked={!it.hidden}
                  disabled={!it.canHide}
                  onClick={() => patch(i, { hidden: !it.hidden })}
                  className={`relative h-5 w-9 rounded-full transition disabled:opacity-40 ${!it.hidden ? "bg-brand" : "bg-brand-soft"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${!it.hidden ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-ink-soft">Nota: aunque una sección esté visible, cada persona solo la ve si su rol tiene permiso.</p>
      </section>

      {/* Dashboard por rol (Nivel 2) */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h3 className="mb-1 font-bold text-ink">Tarjetas del Dashboard</h3>
        <p className="mb-3 text-xs text-ink-soft">Elige qué indicadores ve cada rol y en qué orden. Sin cambios = todas por defecto.</p>
        <label className="mb-3 block text-xs text-ink-soft">
          Configurar para el rol:
          <select
            value={role}
            onChange={(e) => selectRole(e.target.value)}
            className="mt-1 block w-full max-w-xs rounded-lg border border-brand-soft bg-white px-2 py-1.5 text-sm text-ink"
          >
            {roles.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        <ul className="divide-y divide-brand-soft">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-2 py-2">
              <div className="flex flex-col">
                <button type="button" onClick={() => moveCard(i, -1)} disabled={i === 0} aria-label="Subir"
                  className="btn h-5 rounded border border-brand-soft px-1.5 text-[10px] text-ink-soft disabled:opacity-30">▲</button>
                <button type="button" onClick={() => moveCard(i, 1)} disabled={i === rows.length - 1} aria-label="Bajar"
                  className="btn mt-0.5 h-5 rounded border border-brand-soft px-1.5 text-[10px] text-ink-soft disabled:opacity-30">▼</button>
              </div>
              <span className={`min-w-0 flex-1 text-sm ${r.visible ? "text-ink" : "text-ink-soft line-through"}`}>{labelOf(r.key)}</span>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-soft">
                {r.visible ? "Visible" : "Oculta"}
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.visible}
                  aria-label={`Mostrar ${labelOf(r.key)}`}
                  onClick={() => toggleCard(i)}
                  className={`relative h-5 w-9 rounded-full transition ${r.visible ? "bg-brand" : "bg-brand-soft"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${r.visible ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {/* Diseñador de bloques del inicio (Nivel 3) */}
      <section className="rounded-card border border-brand-soft bg-white p-4">
        <h3 className="mb-1 font-bold text-ink">Bloques del inicio del panel</h3>
        <p className="mb-3 text-xs text-ink-soft">Arma un panel de inicio con bloques: aparecen arriba en el Dashboard. Agrega, edita, arrastra para reordenar (o usa ▲▼) y quita con ✕.</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {BLOCK_TYPES.map((t) => (
            <button key={t.type} type="button" onClick={() => addBlock(t.type)}
              className="btn rounded-full border border-dashed border-brand px-3 py-1.5 text-xs font-semibold text-brand-dark">
              + {t.icon} {t.label}
            </button>
          ))}
        </div>
        {blocks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-brand-soft bg-cream px-3 py-6 text-center text-xs text-ink-soft">
            Aún no hay bloques. Agrega uno con los botones de arriba.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {blocks.map((blk, i) => (
              <li
                key={blk.id}
                draggable
                onDragStart={() => (dragIx.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragIx.current !== null) moveBlock(dragIx.current, i); dragIx.current = null; }}
                className="rounded-lg border border-brand-soft bg-cream p-2"
              >
                <div className="flex items-center gap-2">
                  <span className="cursor-grab text-ink-soft" aria-hidden title="Arrastra para reordenar">⠿</span>
                  <span className="text-xs font-bold text-brand-dark">{blockLabel(blk.type)}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button type="button" onClick={() => moveBlock(i, i - 1)} disabled={i === 0} aria-label="Subir"
                      className="btn h-6 rounded border border-brand-soft px-1.5 text-[10px] text-ink-soft disabled:opacity-30">▲</button>
                    <button type="button" onClick={() => moveBlock(i, i + 1)} disabled={i === blocks.length - 1} aria-label="Bajar"
                      className="btn h-6 rounded border border-brand-soft px-1.5 text-[10px] text-ink-soft disabled:opacity-30">▼</button>
                    <button type="button" onClick={() => removeBlock(i)} aria-label="Quitar bloque"
                      className="btn h-6 rounded border border-brand-soft px-2 text-[11px] text-coral-dark">✕</button>
                  </div>
                </div>
                {blk.type !== "divider" && (
                  <div className="mt-2 flex flex-col gap-2">
                    {(blk.type === "heading" || blk.type === "text" || blk.type === "button" || blk.type === "links") && (
                      <input
                        value={blk.text ?? ""} maxLength={300}
                        placeholder={
                          blk.type === "button" ? "Texto del botón (ej. Ver pedidos)"
                            : blk.type === "heading" ? "Título"
                              : blk.type === "links" ? "Título de los accesos (opcional)"
                                : "Escribe el texto…"
                        }
                        onChange={(e) => patchBlock(i, { text: e.target.value })}
                        className="w-full rounded-lg border border-brand-soft bg-white px-2 py-1.5 text-sm"
                      />
                    )}
                    {blk.type === "button" && (
                      <input
                        value={blk.href ?? ""} maxLength={300}
                        placeholder="Enlace (ej. /admin/pedidos o https://…)"
                        onChange={(e) => patchBlock(i, { href: e.target.value })}
                        className="w-full rounded-lg border border-brand-soft bg-white px-2 py-1.5 text-sm"
                      />
                    )}
                    {blk.type === "links" && (
                      <div className="flex flex-col gap-1.5">
                        {(blk.items ?? []).map((it, k) => (
                          <div key={k} className="flex items-center gap-1.5">
                            <input
                              value={it.label} maxLength={60} placeholder="Nombre"
                              onChange={(e) => setLinkItems(i, (blk.items ?? []).map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))}
                              className="w-1/3 rounded-lg border border-brand-soft bg-white px-2 py-1.5 text-sm"
                            />
                            <input
                              value={it.href} maxLength={300} placeholder="/admin/… o https://…"
                              onChange={(e) => setLinkItems(i, (blk.items ?? []).map((x, j) => (j === k ? { ...x, href: e.target.value } : x)))}
                              className="min-w-0 flex-1 rounded-lg border border-brand-soft bg-white px-2 py-1.5 text-sm"
                            />
                            <button type="button" aria-label="Quitar acceso" onClick={() => setLinkItems(i, (blk.items ?? []).filter((_, j) => j !== k))}
                              className="btn h-6 rounded border border-brand-soft px-2 text-[11px] text-coral-dark">✕</button>
                          </div>
                        ))}
                        <button type="button" onClick={() => setLinkItems(i, [...(blk.items ?? []), { label: "", href: "" }])}
                          className="btn w-fit rounded-full border border-dashed border-brand px-3 py-1 text-xs font-semibold text-brand-dark">+ Agregar acceso</button>
                      </div>
                    )}
                    {blk.type === "image" && (
                      <div className="flex flex-col gap-2">
                        {blk.url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={blk.url} alt="" className="max-h-28 w-full rounded-lg border border-brand-soft object-cover" />
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="btn cursor-pointer rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-white">
                            {uploadingId === blk.id ? "Subiendo…" : blk.url ? "Cambiar imagen" : "Subir imagen"}
                            <input type="file" accept="image/*" className="hidden" disabled={uploadingId === blk.id}
                              onChange={(e) => void uploadBlockImage(i, e.target.files?.[0])} />
                          </label>
                          {blk.url && (
                            <button type="button" onClick={() => patchBlock(i, { url: undefined })}
                              className="btn rounded-full border border-brand-soft px-3 py-1.5 text-xs text-ink-soft">Quitar</button>
                          )}
                        </div>
                        <input
                          value={blk.url ?? ""} maxLength={500}
                          placeholder="…o pega un enlace de imagen (https://… /ruta)"
                          onChange={(e) => patchBlock(i, { url: e.target.value })}
                          className="w-full rounded-lg border border-brand-soft bg-white px-2 py-1.5 text-sm"
                        />
                      </div>
                    )}
                    {(blk.type === "heading" || blk.type === "button") && (
                      <label className="flex items-center gap-2 text-[11px] text-ink-soft">
                        Color
                        <input type="color" value={blk.color ?? (blk.type === "button" ? "#16a765" : "#17231d")}
                          onChange={(e) => patchBlock(i, { color: e.target.value })}
                          className="h-6 w-9 cursor-pointer rounded border border-brand-soft bg-white p-0.5" />
                        {blk.color && (
                          <button type="button" onClick={() => patchBlock(i, { color: undefined })} className="underline">quitar color</button>
                        )}
                      </label>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex gap-2">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="btn rounded-full bg-brand px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
        <button type="button" onClick={() => { setItems(initial); setAccent(initialAccent); setDashCfg(initialDash); setRows(rowsForRole(role, initialDash)); setBlocks(initialBlocks); }} disabled={saving}
          className="btn rounded-full border border-brand-soft px-4 py-2 text-sm text-ink-soft">
          Deshacer
        </button>
      </div>
    </div>
  );
}
