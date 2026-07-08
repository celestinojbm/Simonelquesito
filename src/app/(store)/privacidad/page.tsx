import { getSetting } from "@/modules/config/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Política de privacidad · Market Castilla" };

/**
 * Política de tratamiento de datos personales (Ley 1581 de 2012 y
 * Decreto 1377 de 2013 — Habeas Data, Colombia). Requerida además por Meta
 * para aprobar la app de WhatsApp. PENDIENTE: revisión de un abogado antes
 * del lanzamiento masivo — este texto es la base operativa honesta.
 */
export default async function PrivacyPage() {
  const contact = await getSetting("business.contact");
  return (
    <article className="prose prose-sm mx-auto max-w-2xl text-ink [&_h2]:text-brand-dark">
      <h1 className="text-2xl font-extrabold text-brand-dark">Política de privacidad y tratamiento de datos</h1>
      <p className="text-xs text-ink-soft">Última actualización: julio de 2026 · Responsable: Market Castilla (establecimiento de comercio, Bogotá D.C.) · Contacto: {contact.phone} · {contact.address}</p>

      <h2>Qué datos tratamos y para qué</h2>
      <ul>
        <li><strong>Nombre, teléfono y dirección</strong>: para recibir, preparar y entregar tus pedidos, y contactarte sobre ellos (incluido WhatsApp).</li>
        <li><strong>Ubicación en el mapa</strong> (si la compartes): únicamente para ubicar la entrega de tu pedido.</li>
        <li><strong>Fecha de nacimiento</strong> (solo si compras productos de venta restringida): para cumplir la ley sobre venta a mayores de 18 años; el documento se verifica en la entrega.</li>
        <li><strong>Cédula</strong> (solo si solicitas el Fiado Digital): para identificar al titular del crédito.</li>
        <li><strong>Historial de pedidos</strong>: para tu cuenta, beneficios y atención.</li>
      </ul>

      <h2>Lo que NO hacemos</h2>
      <ul>
        <li>No vendemos ni cedemos tus datos a terceros con fines comerciales.</li>
        <li>No te enviamos publicidad sin tu consentimiento expreso (casilla separada y opcional en el checkout). Puedes darte de baja cuando quieras: escribe <strong>STOP</strong> por WhatsApp o desactívalo en <strong>Mi cuenta → Ofertas por WhatsApp</strong>.</li>
        <li>No cobramos intereses ni reportamos a centrales de riesgo por el Fiado Digital.</li>
      </ul>

      <h2>Con quién se comparten (encargados)</h2>
      <p>Solo con los proveedores necesarios para operar: procesamiento de pagos (pasarela), mensajería (WhatsApp Business/Meta) e infraestructura de cómputo. Cada uno trata los datos bajo sus propias políticas y nuestras instrucciones.</p>

      <h2>Tus derechos (Ley 1581 de 2012)</h2>
      <p>Puedes conocer, actualizar, rectificar y solicitar la supresión de tus datos, o revocar tu autorización, escribiéndonos al WhatsApp {contact.phone} o visitándonos en {contact.address}. Para las ofertas por WhatsApp, la baja es inmediata: escribe <strong>STOP</strong> o desactívala en <strong>Mi cuenta</strong>. Respondemos dentro de los términos legales.</p>

      <h2>Seguridad y conservación</h2>
      <p>Los datos se almacenan en bases de datos protegidas con acceso restringido por roles y registro de auditoría. Se conservan mientras exista relación comercial o lo exija la ley.</p>
    </article>
  );
}
