import { redirect } from "next/navigation";

/**
 * Sección de Mensajes RETIRADA del panel por ahora (no se utiliza).
 *
 * Solo se oculta la pantalla: la infraestructura de mensajería —tabla
 * `notifications`, servicios de mensajería, webhooks de WhatsApp, plantillas y
 * el código que genera notificaciones para otros procesos— queda intacta. El
 * acceso directo a la URL se redirige a `/admin` sin mostrar error; para
 * reactivar la sección basta con restaurar esta página y su ítem en `BASE_NAV`.
 */
export default function AdminMessagesPage() {
  redirect("/admin");
}
