"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSettingAction } from "@/app/actions/settings";

/**
 * Editor amigable de una llave de configuración: en lugar de editar JSON a
 * mano, cada valor se presenta con el control que le corresponde —
 * interruptores Sí/No, montos, porcentajes (bps), colores, horarios con
 * campos de hora, casillas para listas conocidas. La validación final sigue
 * siendo la misma en el servidor (esquema Zod + auditoría); el JSON queda
 * disponible como "modo avanzado".
 */

type Path = (string | number)[];
type Update = (path: Path, v: unknown) => void;

/* ---------- Diccionarios de presentación (solo etiquetas; el dato manda) ---------- */

const FIELD_LABELS: Record<string, string> = {
  // llaves de primer nivel con valor simple
  "orders.weightTolerancePctBps": "Tolerancia de peso",
  "delivery.freeFromCop": "Envío gratis desde",
  "loyalty.pointsPer1000Cop": "Puntos por cada $1.000",
  "catalog.enablePoundUnit": "Vender por libras",
  "accounts.requireForCheckout": "Exigir cuenta para comprar en línea",
  "commission.subscriptionPctBps": "Comisión sobre la mensualidad premium",
  // commission.base
  ratePctBps: "Porcentaje de comisión",
  includeDelivery: "Incluir valor del domicilio",
  includeTip: "Incluir propinas",
  includeTax: "Incluir impuestos",
  deductGatewayFees: "Descontar comisión de pasarela",
  deductMarketplaceFees: "Descontar comisión de marketplaces",
  deductDiscounts: "Descontar descuentos",
  deductRefunds: "Descontar reembolsos",
  channels: "Canales que suman a la base",
  // business.contact / location
  whatsapp: "WhatsApp (57 + número)",
  phone: "Teléfono",
  address: "Dirección",
  lat: "Latitud",
  lng: "Longitud",
  approximate: "Ubicación aproximada",
  // premium.plan
  priceCopMonthly: "Precio mensual",
  freeDelivery: "Domicilio gratis para miembros",
  loyaltyMultiplier: "Multiplicador de puntos",
  // credit.rules
  initialLimitCop: "Cupo inicial",
  maxLimitCop: "Cupo máximo",
  singleInstallmentMaxCop: "Cuota única hasta",
  maxInstallments: "Máximo de cuotas",
  allowedFrequencies: "Frecuencias de cuota",
  portfolioCapCop: "Tope total de cartera",
  minPaidOrdersOnline: "Pedidos pagados mínimos (canal en línea)",
  onlineRequirePhoneVerified: "Exigir celular verificado (crédito en línea)",
  onlineRequireEmailVerified: "Exigir correo verificado (crédito en línea)",
  onlineRequireIdentityVerified: "Exigir identidad 18+ (crédito en línea)",
  // restricted.rules
  label: "Nombre",
  schedule: "Horario de venta",
  requiresAgeDeclaration: "Exigir declaración de edad",
  requiresIdCheckOnDelivery: "Verificar cédula en la entrega",
  allowedFulfillments: "Formas de entrega permitidas",
  excludedZoneIds: "Zonas excluidas (ids)",
  minAge: "Edad mínima",
  // branding
  name: "Nombre del negocio",
  tagline: "Frase corta (tagline)",
  slogan: "Eslogan",
  seoDescription: "Descripción para buscadores",
  businessType: "Tipo de negocio",
  colors: "Paleta de colores",
  brand: "Color principal",
  brandDark: "Principal oscuro",
  brandSoft: "Principal suave (fondos)",
  coral: "Coral (acciones)",
  coralDark: "Coral oscuro",
  sun: "Amarillo (sol)",
  cream: "Crema (fondo general)",
  ink: "Tinta (texto)",
  inkSoft: "Tinta suave (texto secundario)",
  liquor: "Licor (restringidos)",
  liquorSoft: "Licor suave",
};

/** Listas con opciones conocidas → casillas en lugar de texto libre. */
const ENUM_OPTIONS: Record<string, { value: string; label: string }[]> = {
  channels: [
    { value: "web_pwa", label: "Web (PWA)" },
    { value: "whatsapp", label: "WhatsApp (bot)" },
    { value: "subscription", label: "Canastas recurrentes" },
    { value: "rappi", label: "Rappi" },
    { value: "didi", label: "DiDi" },
    { value: "social", label: "Redes sociales" },
    { value: "manual", label: "Manual" },
    { value: "pos_physical", label: "Tienda física" },
  ],
  allowedFrequencies: [
    { value: "weekly", label: "Semanal" },
    { value: "biweekly", label: "Quincenal" },
  ],
  allowedFulfillments: [
    { value: "delivery", label: "Domicilio" },
    { value: "pickup", label: "Recoger en tienda" },
  ],
};

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

/** Plantilla al crear una nueva regla de producto restringido desde el panel. */
const RESTRICTED_RULE_TEMPLATE = {
  label: "Nueva categoría",
  schedule: Object.fromEntries(DAYS.map((d) => [d.key, ["08:00-20:00"]])),
  requiresAgeDeclaration: true,
  requiresIdCheckOnDelivery: true,
  allowedFulfillments: ["delivery", "pickup"],
  excludedZoneIds: [],
  minAge: 18,
};

const labelFor = (key: string) => FIELD_LABELS[key] ?? key;
const isHexColor = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s) || /^#[0-9a-fA-F]{3}$/.test(s);
const isTimeWindow = (s: string) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(s);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const inputCls = "rounded-lg border border-brand-soft bg-white px-2.5 py-1.5 text-sm focus:border-brand";

/* ---------- Controles básicos ---------- */

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`inline-flex items-center gap-2 rounded-full px-1 py-0.5 transition-colors ${value ? "" : ""}`}
    >
      <span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${value ? "bg-brand" : "bg-ink/20"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${value ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span className={`text-xs font-bold ${value ? "text-brand-dark" : "text-ink-soft"}`}>{value ? "Sí" : "No"}</span>
    </button>
  );
}

function NumberField({ name, value, onChange }: { name: string; value: number; onChange: (v: number) => void }) {
  const isBps = /Bps$/.test(name) || name === "ratePctBps";
  const isCop = /Cop/.test(name);
  const isFloat = name === "lat" || name === "lng";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {isCop && <span className="text-sm text-ink-soft">$</span>}
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        step={isFloat ? "0.000001" : 1}
        onChange={(e) => {
          const n = isFloat ? e.target.valueAsNumber : Math.trunc(e.target.valueAsNumber);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className={`${inputCls} w-36 text-right`}
        aria-label={labelFor(name)}
      />
      {isBps && <span className="text-xs font-semibold text-brand-dark">= {(value / 100).toLocaleString("es-CO")} %</span>}
      {isCop && value > 0 && <span className="text-xs text-ink-soft">{`$${value.toLocaleString("es-CO")}`}</span>}
    </span>
  );
}

function ColorField({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-12 cursor-pointer rounded border border-brand-soft"
        aria-label={`Color ${labelFor(name)}`}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} w-24 font-mono text-xs`}
        aria-label={`Hex de ${labelFor(name)}`}
      />
    </span>
  );
}

/* ---------- Horario semanal (ventanas HH:MM-HH:MM por día) ---------- */

function ScheduleEditor({ value, path, update }: { value: Record<string, unknown>; path: Path; update: Update }) {
  const setDay = (day: string, windows: string[]) => update([...path, day], windows);
  return (
    <div className="space-y-1.5">
      {DAYS.map(({ key, label }) => {
        const windows = Array.isArray(value[key]) ? (value[key] as string[]) : [];
        return (
          <div key={key} className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 text-xs font-semibold text-ink">{label}</span>
            {windows.length === 0 && (
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink-soft">Cerrado</span>
            )}
            {windows.map((w, i) => {
              const [start = "08:00", end = "20:00"] = isTimeWindow(w) ? w.split("-") : [];
              return (
                <span key={i} className="inline-flex items-center gap-1">
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => setDay(key, windows.map((x, j) => (j === i ? `${e.target.value}-${end}` : x)))}
                    className={`${inputCls} px-1.5 py-1 text-xs`}
                    aria-label={`${label}: apertura ${i + 1}`}
                  />
                  <span className="text-xs text-ink-soft">a</span>
                  <input
                    type="time"
                    value={end}
                    onChange={(e) => setDay(key, windows.map((x, j) => (j === i ? `${start}-${e.target.value}` : x)))}
                    className={`${inputCls} px-1.5 py-1 text-xs`}
                    aria-label={`${label}: cierre ${i + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => setDay(key, windows.filter((_, j) => j !== i))}
                    className="rounded-full px-1 text-xs text-coral-dark hover:bg-coral/10"
                    aria-label={`Quitar horario ${i + 1} de ${label}`}
                  >
                    ✕
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => setDay(key, [...windows, "08:00-20:00"])}
              className="rounded-full border border-brand-soft px-2 py-0.5 text-xs text-brand-dark hover:bg-brand-soft"
            >
              + horario
            </button>
          </div>
        );
      })}
      <p className="text-[11px] text-ink-soft">Sin horarios = cerrado ese día. Varias ventanas por día están permitidas.</p>
    </div>
  );
}

/* ---------- Campo genérico (recursivo) ---------- */

function ValueField({
  settingKey,
  name,
  value,
  path,
  update,
  removable,
  onRemove,
}: {
  settingKey: string;
  name: string;
  value: unknown;
  path: Path;
  update: Update;
  removable?: boolean;
  onRemove?: () => void;
}) {
  // Horario semanal: llaves hours.* completas o el campo "schedule" anidado.
  const isSchedule = (settingKey.startsWith("hours.") && path.length === 0) || name === "schedule";
  if (isSchedule && isPlainObject(value)) {
    return (
      <Labeled name={name} topLevel={path.length === 0}>
        <ScheduleEditor value={value} path={path} update={update} />
      </Labeled>
    );
  }

  if (typeof value === "boolean") {
    return (
      <Row name={name} removable={removable} onRemove={onRemove}>
        <Toggle value={value} onChange={(v) => update(path, v)} />
      </Row>
    );
  }

  if (typeof value === "number") {
    // delivery.freeFromCop admite null (= sin envío gratis global): botón para desactivar.
    const nullable = settingKey === "delivery.freeFromCop" && path.length === 0;
    return (
      <Row name={name} removable={removable} onRemove={onRemove}>
        <span className="inline-flex flex-wrap items-center gap-2">
          <NumberField name={name} value={value} onChange={(v) => update(path, v)} />
          {nullable && (
            <button
              type="button"
              onClick={() => update(path, null)}
              className="rounded-full border border-brand-soft px-2.5 py-1 text-xs text-ink-soft hover:border-coral/40 hover:text-coral-dark"
            >
              Desactivar
            </button>
          )}
        </span>
      </Row>
    );
  }

  if (value === null) {
    // Único caso hoy: delivery.freeFromCop (null = sin envío gratis global).
    return (
      <Row name={name} removable={removable} onRemove={onRemove}>
        <span className="inline-flex items-center gap-2">
          <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink-soft">Desactivado (sin valor)</span>
          <button
            type="button"
            onClick={() => update(path, 0)}
            className="rounded-full border border-brand px-2.5 py-1 text-xs font-bold text-brand-dark hover:bg-brand-soft"
          >
            Definir valor
          </button>
        </span>
      </Row>
    );
  }

  if (typeof value === "string") {
    if (isHexColor(value)) {
      return (
        <Row name={name} removable={removable} onRemove={onRemove}>
          <ColorField name={name} value={value} onChange={(v) => update(path, v)} />
        </Row>
      );
    }
    const long = value.length > 60 || name === "seoDescription" || name === "slogan";
    return (
      <Row name={name} removable={removable} onRemove={onRemove} block={long}>
        {long ? (
          <textarea
            value={value}
            rows={2}
            onChange={(e) => update(path, e.target.value)}
            className={`${inputCls} w-full`}
            aria-label={labelFor(name)}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => update(path, e.target.value)}
            className={`${inputCls} w-full max-w-72`}
            aria-label={labelFor(name)}
          />
        )}
      </Row>
    );
  }

  if (Array.isArray(value)) {
    const options = ENUM_OPTIONS[name];
    if (options) {
      const list = value as string[];
      return (
        <Row name={name} removable={removable} onRemove={onRemove} block>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {options.map((o) => (
              <label key={o.value} className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={list.includes(o.value)}
                  onChange={(e) =>
                    update(path, e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))
                  }
                  className="h-4 w-4 accent-[var(--color-brand)]"
                />
                {o.label}
              </label>
            ))}
          </div>
        </Row>
      );
    }
    // Lista libre de textos (sinónimos, ids de zona): un campo separado por comas.
    if (value.every((x) => typeof x === "string")) {
      return (
        <Row name={name} removable={removable} onRemove={onRemove} block>
          <input
            type="text"
            value={(value as string[]).join(", ")}
            placeholder="valores separados por coma"
            onChange={(e) =>
              update(path, e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
            }
            className={`${inputCls} w-full`}
            aria-label={labelFor(name)}
          />
        </Row>
      );
    }
  }

  if (isPlainObject(value)) {
    // Registros dinámicos: se pueden añadir/quitar entradas desde el panel.
    const dynamicRecord =
      path.length === 0 && (settingKey === "search.synonyms" || settingKey === "restricted.rules");
    return (
      <Labeled name={name} topLevel={path.length === 0} onRemove={removable ? onRemove : undefined}>
        <div className={`space-y-2 ${path.length > 0 ? "rounded-lg border border-brand-soft/70 bg-cream/50 p-2.5" : ""}`}>
          {Object.entries(value).map(([k, v]) => (
            <ValueField
              key={k}
              settingKey={settingKey}
              name={k}
              value={v}
              path={[...path, k]}
              update={update}
              removable={dynamicRecord}
              onRemove={() => {
                const next = { ...value };
                delete next[k];
                update(path, next);
              }}
            />
          ))}
          {dynamicRecord && (
            <RecordAdder
              placeholder={settingKey === "search.synonyms" ? "nueva palabra (ej. arroz)" : "clave (ej. energizantes)"}
              onAdd={(k) => {
                if (!k || k in value) return;
                update(path, {
                  ...value,
                  [k]: settingKey === "search.synonyms" ? [] : structuredClone(RESTRICTED_RULE_TEMPLATE),
                });
              }}
            />
          )}
        </div>
      </Labeled>
    );
  }

  // Forma desconocida: mini JSON como red de seguridad (no debería ocurrir).
  return (
    <Row name={name} block>
      <textarea
        value={JSON.stringify(value, null, 2)}
        rows={3}
        onChange={(e) => {
          try {
            update(path, JSON.parse(e.target.value));
          } catch {
            /* se valida al guardar */
          }
        }}
        className={`${inputCls} w-full font-mono text-xs`}
      />
    </Row>
  );
}

function Row({
  name,
  children,
  removable,
  onRemove,
  block,
}: {
  name: string;
  children: React.ReactNode;
  removable?: boolean;
  onRemove?: () => void;
  block?: boolean;
}) {
  return (
    <div className={block ? "space-y-1" : "flex flex-wrap items-center justify-between gap-2"}>
      <span className="inline-flex items-center gap-1.5 text-sm text-ink">
        {labelFor(name)}
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full px-1.5 text-xs text-coral-dark hover:bg-coral/10"
            aria-label={`Eliminar ${name}`}
          >
            🗑
          </button>
        )}
      </span>
      {children}
    </div>
  );
}

function Labeled({
  name,
  topLevel,
  onRemove,
  children,
}: {
  name: string;
  topLevel: boolean;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  if (topLevel) return <>{children}</>;
  return (
    <div className="space-y-1">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
        {labelFor(name)}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full px-1.5 text-xs font-normal text-coral-dark hover:bg-coral/10"
            aria-label={`Eliminar ${name}`}
          >
            🗑 eliminar
          </button>
        )}
      </p>
      {children}
    </div>
  );
}

/* ---------- Vista de SOLO LECTURA amigable (sin JSON) ---------- */

const DAY_LABEL: Record<string, string> = Object.fromEntries(DAYS.map((d) => [d.key, d.label]));

function ReadValue({ settingKey, name, value, top }: { settingKey: string; name: string; value: unknown; top: boolean }) {
  // Horario semanal
  const isSchedule = (settingKey.startsWith("hours.") && top) || name === "schedule";
  if (isSchedule && isPlainObject(value)) {
    return (
      <ReadRow name={name} top={top} block>
        <ul className="text-sm">
          {DAYS.map(({ key, label }) => {
            const w = Array.isArray(value[key]) ? (value[key] as string[]) : [];
            return (
              <li key={key} className="flex gap-2">
                <span className="w-24 shrink-0 text-ink-soft">{label}</span>
                <span className="text-ink">{w.length ? w.map((x) => x.replace("-", " a ")).join(", ") : "Cerrado"}</span>
              </li>
            );
          })}
        </ul>
      </ReadRow>
    );
  }
  if (typeof value === "boolean") {
    return (
      <ReadRow name={name} top={top}>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${value ? "bg-brand-soft text-brand-dark" : "bg-ink/5 text-ink-soft"}`}>
          {value ? "Sí" : "No"}
        </span>
      </ReadRow>
    );
  }
  if (value === null) {
    return <ReadRow name={name} top={top}><span className="text-sm text-ink-soft">Desactivado</span></ReadRow>;
  }
  if (typeof value === "number") {
    const isBps = /Bps$/.test(name) || name === "ratePctBps";
    const isCop = /Cop/.test(name);
    return (
      <ReadRow name={name} top={top}>
        <span className="text-sm font-semibold text-ink">
          {isCop ? `$${value.toLocaleString("es-CO")}` : isBps ? `${(value / 100).toLocaleString("es-CO")} %` : value.toLocaleString("es-CO")}
        </span>
      </ReadRow>
    );
  }
  if (typeof value === "string") {
    if (isHexColor(value)) {
      return (
        <ReadRow name={name} top={top}>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-4 w-6 rounded border border-brand-soft" style={{ backgroundColor: value }} />
            <span className="font-mono text-xs text-ink-soft">{value}</span>
          </span>
        </ReadRow>
      );
    }
    return <ReadRow name={name} top={top} block={value.length > 50}><span className="text-sm text-ink">{value || "—"}</span></ReadRow>;
  }
  if (Array.isArray(value)) {
    const opts = ENUM_OPTIONS[name];
    const labelOf = (v: string) => opts?.find((o) => o.value === v)?.label ?? v;
    return (
      <ReadRow name={name} top={top} block>
        {value.length === 0 ? (
          <span className="text-sm text-ink-soft">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {(value as unknown[]).map((v, i) => (
              <span key={i} className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">{labelOf(String(v))}</span>
            ))}
          </span>
        )}
      </ReadRow>
    );
  }
  if (isPlainObject(value)) {
    return (
      <div className={top ? "space-y-2" : "space-y-1.5 rounded-lg border border-brand-soft/70 bg-cream/40 p-2.5"}>
        {!top && <p className="text-sm font-semibold text-ink">{name === "schedule" ? DAY_LABEL[name] ?? labelFor(name) : labelFor(name)}</p>}
        {Object.entries(value).map(([k, v]) => (
          <ReadValue key={k} settingKey={settingKey} name={k} value={v} top={false} />
        ))}
      </div>
    );
  }
  return <ReadRow name={name} top={top}><span className="text-sm text-ink-soft">—</span></ReadRow>;
}

function ReadRow({ name, top, block, children }: { name: string; top: boolean; block?: boolean; children: React.ReactNode }) {
  // En el nivel superior de una llave simple no repetimos el nombre (ya es el título de la tarjeta).
  if (top) return <div>{children}</div>;
  if (block) {
    return (
      <div className="space-y-0.5">
        <p className="text-sm text-ink-soft">{labelFor(name)}</p>
        {children}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-sm text-ink-soft">{labelFor(name)}</span>
      {children}
    </div>
  );
}

function RecordAdder({ placeholder, onAdd }: { placeholder: string; onAdd: (key: string) => void }) {
  const [key, setKey] = useState("");
  return (
    <div className="flex items-center gap-2 pt-1">
      <input
        type="text"
        value={key}
        placeholder={placeholder}
        onChange={(e) => setKey(e.target.value.toLowerCase())}
        className={`${inputCls} max-w-56 text-xs`}
      />
      <button
        type="button"
        onClick={() => {
          onAdd(key.trim());
          setKey("");
        }}
        className="rounded-full border border-brand px-3 py-1 text-xs font-bold text-brand-dark hover:bg-brand-soft"
      >
        + Añadir
      </button>
    </div>
  );
}

/* ---------- Editor principal ---------- */

export function SettingEditor({ settingKey, initialJson }: { settingKey: string; initialJson: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [value, setValue] = useState<unknown>(() => JSON.parse(initialJson));
  const [text, setText] = useState(initialJson);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const update: Update = (path, v) => {
    setValue((prev: unknown) => {
      if (path.length === 0) return v;
      const next = structuredClone(prev) as Record<string | number, unknown>;
      let cur: Record<string | number, unknown> = next;
      for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]!] as Record<string | number, unknown>;
      cur[path[path.length - 1]!] = v;
      return next;
    });
  };

  const save = (json: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateSettingAction(settingKey, json);
      if (result.ok) {
        setMessage({ ok: true, text: "Guardado (validado y auditado)." });
        setEditing(false);
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  };

  if (!editing) {
    return (
      <div>
        <div className="rounded-lg border border-brand-soft/60 bg-cream/40 p-3">
          <ReadValue settingKey={settingKey} name={settingKey} value={value} top />
        </div>
        <button
          type="button"
          onClick={() => {
            setValue(JSON.parse(initialJson));
            setText(initialJson);
            setAdvanced(false);
            setMessage(null);
            setEditing(true);
          }}
          className="btn mt-2 rounded-full border border-brand px-4 py-1.5 text-xs font-bold text-brand-dark hover:bg-brand-soft"
        >
          ✏️ Editar
        </button>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={`mt-1 text-xs font-medium ${message.ok ? "text-brand-dark" : "text-coral-dark"}`}>
            {message.ok ? "✅ " : "⚠️ "}{message.text}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-brand bg-white p-3">
      {advanced ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.min(18, Math.max(4, text.split("\n").length + 1))}
          spellCheck={false}
          className="w-full rounded-lg border border-brand-soft bg-white p-3 font-mono text-xs focus:border-brand"
          aria-label={`Valor JSON de ${settingKey}`}
        />
      ) : (
        <div className="space-y-2.5">
          <ValueField settingKey={settingKey} name={settingKey} value={value} path={[]} update={update} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => save(advanced ? text : JSON.stringify(value))}
          className="btn rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {pending ? "Guardando…" : "💾 Guardar"}
        </button>
        <button
          type="button"
          onClick={() => {
            // Descarta cambios sin guardar: la vista de lectura usa `value`.
            setValue(JSON.parse(initialJson));
            setEditing(false);
            setMessage(null);
          }}
          className="btn rounded-full border border-brand-soft px-4 py-1.5 text-xs text-ink-soft"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => {
            if (advanced) {
              // Volver al formulario: intenta traer lo escrito en JSON.
              try {
                setValue(JSON.parse(text));
                setAdvanced(false);
              } catch {
                setMessage({ ok: false, text: "El JSON tiene un error de sintaxis; corrígelo antes de volver al formulario." });
              }
            } else {
              setText(JSON.stringify(value, null, 2));
              setAdvanced(true);
            }
          }}
          className="btn ml-auto rounded-full px-3 py-1.5 text-xs text-ink-soft underline-offset-2 hover:underline"
        >
          {advanced ? "← Volver al formulario" : "Modo avanzado (JSON)"}
        </button>
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mt-1 text-xs font-medium ${message.ok ? "text-brand-dark" : "text-coral-dark"}`}>
          {message.ok ? "✅ " : "⚠️ "}{message.text}
        </p>
      )}
    </div>
  );
}
