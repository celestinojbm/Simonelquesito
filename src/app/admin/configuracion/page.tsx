import { asc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { roleHas } from "@/lib/auth/permissions";
import { SettingEditor } from "./setting-editor";
import { ConfigTabs } from "./config-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configuración · Admin" };

const KEY_DESCRIPTIONS: Record<string, string> = {
  "hours.store": "Horario del local (por día de la semana)",
  "hours.delivery": "Horario de domicilios — la ampliación a 24 h se hace aquí, nunca en código",
  "hours.pickup": "Horario de recogida en tienda",
  "restricted.rules": "Reglas de productos restringidos: horarios, edad mínima, verificación en entrega, zonas",
  "orders.weightTolerancePctBps": "Tolerancia de diferencia de peso antes de pedir aprobación (en basis points: 1500 = 15 %)",
  "delivery.freeFromCop": "Umbral de envío gratis en COP (null = sin envío gratis global)",
  "loyalty.pointsPer1000Cop": "Puntos por cada $1.000 COP de compra neta",
  "commission.base": "Base de la comisión de agencia: porcentaje, canales y conceptos que suman o deducen",
  "search.synonyms": "Sinónimos de búsqueda aprobados por el negocio",
  "catalog.enablePoundUnit": "Habilitar unidad libra (decisión del negocio)",
  "business.contact": "Datos de contacto del negocio (WhatsApp, teléfono, dirección)",
  "business.location": "Coordenadas del local — centran los mapas de entrega y seguimiento",
  "accounts.requireForCheckout": "Exigir cuenta (celular verificado) para comprar en línea — encender cuando el canal de códigos esté activo",
  "premium.plan": "Suscripción premium: precio mensual y beneficios (domicilio gratis, multiplicador de puntos)",
  "credit.rules": "Fiado Digital: cupo inicial/máximo, umbral de cuota única, cuotas y frecuencias, tope de cartera, pedidos mínimos en línea",
  "commission.subscriptionPctBps": "Comisión de agencia sobre la mensualidad premium (5000 = 50%)",
};

export default async function AdminSettingsPage() {
  const [rows, user] = await Promise.all([
    db.query.settings.findMany({
      where: isNull(settings.branchId),
      orderBy: asc(settings.key),
    }),
    getSessionUser(),
  ]);
  const canEdit = !!user && roleHas(user.role, "settings.manage");

  return (
    <div className="max-w-3xl space-y-4">
      <ConfigTabs />
      <p className="text-sm text-ink-soft">
        Todos los parámetros operativos viven aquí — nada está incrustado en el código. Cada cambio
        se valida contra el esquema de la llave y queda registrado en la auditoría.
        {!canEdit && " Tu rol solo tiene lectura."}
      </p>
      <ul className="space-y-3">
        {rows.map((s) => (
          <li key={s.id} className="rounded-card border border-brand-soft bg-white p-4">
            <p className="font-bold text-brand-dark">{s.key}</p>
            <p className="mb-2 text-xs text-ink-soft">{KEY_DESCRIPTIONS[s.key] ?? ""}</p>
            {canEdit ? (
              <SettingEditor settingKey={s.key} initialJson={JSON.stringify(s.value, null, 2)} />
            ) : (
              <pre className="overflow-x-auto rounded-lg bg-ink/5 p-3 text-xs">
                {JSON.stringify(s.value, null, 2)}
              </pre>
            )}
            <p className="mt-1 text-xs text-ink-soft">
              Última modificación: {s.updatedBy ?? "—"} · {s.updatedAt.toLocaleString("es-CO", { timeZone: "America/Bogota" })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
