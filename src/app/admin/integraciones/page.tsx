import { requirePermission } from "@/lib/auth/session";
import { getSetting } from "@/modules/config/service";
import {
  getMpIntegration,
  mpAuthorizationUrl,
  mpCallbackUrl,
  mpOauthState,
} from "@/modules/payments/mercadopago";
import { disconnectMercadoPagoAction } from "@/app/actions/integraciones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integraciones · Admin" };

const MP_MESSAGES: Record<string, { kind: "ok" | "error"; text: string }> = {
  conectado: { kind: "ok", text: "Cuenta de Mercado Pago conectada. Los pagos en línea ya pueden activarse." },
  cancelado: { kind: "error", text: "La autorización se canceló en Mercado Pago. No se conectó nada." },
  estado_invalido: { kind: "error", text: "El enlace de autorización venció o no es válido. Intenta conectar de nuevo." },
  sin_codigo: { kind: "error", text: "Mercado Pago no devolvió el código de autorización. Intenta de nuevo." },
  error: { kind: "error", text: "No se pudo completar la conexión con Mercado Pago. Revisa las credenciales de la aplicación." },
};

export default async function IntegracionesPage({
  searchParams,
}: {
  searchParams: Promise<{ mp?: string }>;
}) {
  await requirePermission("integrations.manage");
  const { mp } = await searchParams;
  const message = mp ? MP_MESSAGES[mp] : undefined;

  const [integration, commission] = await Promise.all([getMpIntegration(), getSetting("commission.base")]);

  const hasApp = !!process.env.MERCADOPAGO_CLIENT_ID && !!process.env.MERCADOPAGO_CLIENT_SECRET;
  const hasWebhookSecret = !!process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const hasCipherKey = /^[0-9a-f]{64}$/i.test(process.env.INTEGRATION_CREDENTIALS_KEY ?? "");
  const provider = process.env.PAYMENT_PROVIDER ?? "sandbox";
  const connected = integration?.status === "live" || integration?.status === "sandbox";
  const config = (integration?.config ?? {}) as {
    collectorId?: number | null;
    connectedAt?: string;
    expiresAt?: string;
  };

  // El enlace de autorización solo se puede construir con la app configurada.
  const authUrl = hasApp && hasCipherKey ? mpAuthorizationUrl(mpOauthState()) : null;

  const check = (okState: boolean, label: string, detail?: string) => (
    <li className="flex items-start gap-2">
      <span aria-hidden>{okState ? "✅" : "⬜"}</span>
      <span>
        {label}
        {detail && <span className="block text-xs text-ink-soft">{detail}</span>}
      </span>
    </li>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-extrabold text-ink">🔌 Integraciones</h1>
      <p className="text-sm text-ink-soft">
        Conexiones con servicios externos. Las credenciales se guardan <strong>cifradas</strong> y cada
        conexión/desconexión queda en la auditoría.
      </p>

      {message && (
        <p
          role="alert"
          className={`rounded-lg px-3 py-2 text-sm font-medium ${message.kind === "ok" ? "bg-brand-soft text-brand-dark" : "bg-coral/15 text-coral-dark"}`}
        >
          {message.kind === "ok" ? "✅ " : "⚠️ "}
          {message.text}
        </p>
      )}

      {/* Mercado Pago */}
      <section className="rounded-card border border-brand-soft bg-white p-5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-ink">💳 Mercado Pago — pagos en línea con split</h2>
          {connected ? (
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${integration!.status === "live" ? "bg-brand text-white" : "bg-sun/50 text-ink"}`}>
              {integration!.status === "live" ? "Conectado (producción)" : "Conectado (pruebas)"}
            </span>
          ) : (
            <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-semibold text-ink-soft">Sin conectar</span>
          )}
        </div>
        <p className="mb-3 text-sm text-ink-soft">
          Tarjetas y PSE (Nequi paga vía PSE). Con cada venta, el{" "}
          <strong>{(commission.ratePctBps / 100).toFixed(1)}%</strong> de comisión va automáticamente a la
          cuenta de la agencia (split en la fuente) y el resto entra directo a la cuenta del negocio. El
          porcentaje se edita en Configuración → <code className="rounded bg-brand-soft px-1">commission.base</code>.
          Guía paso a paso: <code className="rounded bg-brand-soft px-1">docs/MERCADOPAGO.md</code>.
        </p>

        <h3 className="mb-1 text-sm font-bold text-ink">Requisitos (variables en Vercel)</h3>
        <ul className="mb-3 space-y-1 text-sm">
          {check(hasApp, "Aplicación de la agencia", "MERCADOPAGO_CLIENT_ID y MERCADOPAGO_CLIENT_SECRET")}
          {check(hasWebhookSecret, "Secreto del webhook", "MERCADOPAGO_WEBHOOK_SECRET (panel de desarrolladores de MP)")}
          {check(hasCipherKey, "Clave de cifrado de credenciales", "INTEGRATION_CREDENTIALS_KEY (openssl rand -hex 32)")}
          {check(connected, "Cuenta del negocio autorizada", "El propietario inicia sesión en SU cuenta de Mercado Pago")}
          {check(provider === "mercado_pago", "Pasarela activada", `PAYMENT_PROVIDER=mercado_pago (hoy: ${provider})`)}
        </ul>

        {connected ? (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="text-ink-soft">Cuenta (collector):</span>{" "}
              <strong>{config.collectorId ?? "—"}</strong>
              {config.connectedAt && (
                <span className="ml-2 text-xs text-ink-soft">
                  conectada el {new Date(config.connectedAt).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {authUrl && (
                <a href={authUrl} className="btn rounded-full border border-brand px-4 py-2 text-sm font-bold text-brand-dark hover:bg-brand-soft">
                  🔄 Reconectar cuenta
                </a>
              )}
              <form action={disconnectMercadoPagoAction}>
                <button type="submit" className="btn rounded-full border border-coral px-4 py-2 text-sm font-bold text-coral-dark hover:bg-coral/10">
                  Desconectar
                </button>
              </form>
            </div>
          </div>
        ) : authUrl ? (
          <a href={authUrl} className="btn inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white">
            Conectar cuenta Mercado Pago del negocio
          </a>
        ) : (
          <p className="rounded-lg bg-sun/20 px-3 py-2 text-sm text-ink">
            Para conectar, primero configura las variables marcadas arriba en Vercel y redespliega.
          </p>
        )}

        <p className="mt-3 text-xs text-ink-soft">
          Webhook a registrar en el panel de MP: <code className="rounded bg-brand-soft px-1">{`${mpCallbackUrl().replace("/api/integrations/mercadopago/callback", "")}/api/webhooks/payments/mercadopago`}</code>{" "}
          · Redirect URI de la aplicación: <code className="rounded bg-brand-soft px-1">{mpCallbackUrl()}</code>
        </p>
      </section>

      {/* Otras integraciones (estado informativo) */}
      <section className="rounded-card border border-brand-soft bg-white p-5">
        <h2 className="mb-2 text-lg font-bold text-ink">Otras integraciones</h2>
        <ul className="space-y-1 text-sm text-ink-soft">
          <li>💬 WhatsApp Business (Meta): {process.env.WHATSAPP_ACCESS_TOKEN ? "✅ credenciales configuradas" : "pendiente de aprobación de Meta — el bot funciona en el simulador"}</li>
          <li>📞 Bot de llamadas (Twilio): {process.env.TWILIO_AUTH_TOKEN ? "✅ credenciales configuradas" : "pendiente de cuenta"}</li>
          <li>📧 Correo (Resend): {process.env.RESEND_API_KEY ? "✅ credenciales configuradas" : "modo demo (los códigos quedan en Mensajes)"}</li>
        </ul>
      </section>
    </div>
  );
}
