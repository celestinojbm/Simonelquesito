import { getSetting } from "@/modules/config/service";
import { formatCop } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Términos y condiciones · Market Castilla" };

/** Términos del servicio. PENDIENTE revisión legal antes del lanzamiento masivo. */
export default async function TermsPage() {
  const [contact, freeFrom, plan] = await Promise.all([
    getSetting("business.contact"),
    getSetting("delivery.freeFromCop"),
    getSetting("premium.plan"),
  ]);
  return (
    <article className="prose prose-sm mx-auto max-w-2xl text-ink [&_h2]:text-brand-dark">
      <h1 className="text-2xl font-extrabold text-brand-dark">Términos y condiciones</h1>
      <p className="text-xs text-ink-soft">Última actualización: julio de 2026 · Market Castilla · {contact.address} · {contact.phone}</p>

      <h2>Pedidos y precios</h2>
      <ul>
        <li>Los precios se muestran en pesos colombianos (COP) e incluyen los impuestos aplicables.</li>
        <li>Las frutas y verduras se venden <strong>por libra</strong>: el total al hacer el pedido es <strong>estimado</strong> y se ajusta con el peso real al alistarlo. Si la diferencia supera la tolerancia configurada, te pedimos aprobación antes de continuar.</li>
        <li>Si un producto se agota, aplicamos tu preferencia de sustitución o te contactamos.</li>
      </ul>

      <h2>Domicilios</h2>
      <ul>
        <li>Entregamos en la zona de cobertura publicada, dentro del horario visible en la tienda.</li>
        {freeFrom !== null && <li>Domicilio gratis en compras desde {formatCop(freeFrom)}; tarifa visible antes de confirmar.</li>}
        <li>El tiempo de entrega es un rango estimado, no una promesa exacta.</li>
      </ul>

      <h2>Productos de venta restringida (+18)</h2>
      <p>Licores y cigarrillos se venden únicamente a mayores de 18 años, dentro de los horarios legales. En la entrega se <strong>verifica el documento de identidad</strong>; sin verificación no hay entrega de estos productos. Prohíbase el expendio de bebidas embriagantes a menores de edad.</p>

      <h2>Membresía premium y Fiado Digital</h2>
      <ul>
        <li>La membresía ({formatCop(plan.priceCopMonthly)}/mes) es opcional, se renueva por periodos de 30 días y puede cancelarse en cualquier momento (rige hasta el fin del periodo pagado).</li>
        <li>El Fiado Digital es un cupo de crédito <strong>sin intereses ni cargos ocultos</strong>, sujeto a aprobación, cupo y al pago puntual de las cuotas. La mora suspende el cupo; no genera intereses.</li>
      </ul>

      <h2>Pagos</h2>
      <p>Aceptamos pago contra entrega (efectivo/datáfono), transferencia y —cuando esté habilitado— pago en línea a través de pasarelas autorizadas. Los reembolsos aprobados se procesan por el mismo medio del pago.</p>

      <h2>Contacto y reclamos</h2>
      <p>WhatsApp {contact.phone} o en el local ({contact.address}). Siempre puedes pedir hablar con una persona — también en nuestros canales automatizados.</p>
    </article>
  );
}
