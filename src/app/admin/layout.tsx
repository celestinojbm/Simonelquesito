import Image from "next/image";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getSetting } from "@/modules/config/service";
import { roleHas } from "@/lib/auth/permissions";
import { OrderAlarm } from "@/components/admin/order-alarm";
import { resolveNav, accentTextIsDark } from "@/modules/admin/nav";
import { AdminNav } from "./admin-nav";

// El panel depende de la sesión (cookies) y datos en vivo: nunca se pre-genera.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const [branding, panel] = await Promise.all([getSetting("branding"), getSetting("admin.panel")]);
  if (!user) redirect("/login");
  if (user.role === "customer" || user.role === "driver") redirect("/cuenta");

  // Menú resuelto con la personalización (orden/ocultos/renombrados) y filtrado
  // por permisos del rol.
  const visibleNav = resolveNav(panel).filter((n) => roleHas(user.role, n.perm));

  // Color del panel (barra lateral). Si el color es claro, el texto va oscuro.
  const accentDark = panel.accent ? accentTextIsDark(panel.accent) : false;
  const asideStyle = panel.accent ? { backgroundColor: panel.accent } : undefined;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside
        className={`border-b border-brand-soft md:min-h-dvh md:w-60 md:border-r md:border-b-0 ${
          panel.accent ? (accentDark ? "text-ink" : "text-cream") : "bg-brand-dark text-cream"
        }`}
        style={asideStyle}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <Image src="/icons/logo.svg" alt="" width={32} height={32} />
          <div className="leading-tight">
            <p className="font-extrabold">{branding.name}</p>
            <p className={`text-xs ${accentDark ? "text-ink-soft" : "text-brand-soft"}`}>Panel · {user.role}</p>
          </div>
        </div>
        <AdminNav
          tone={accentDark ? "dark" : "light"}
          items={visibleNav.map((n) => ({
            href: n.href,
            label: n.label,
            icon: n.icon,
            activeFor: n.activeFor ? [...n.activeFor] : undefined,
          }))}
        />
      </aside>
      <main className="flex-1 bg-cream px-4 py-6 md:px-8">{children}</main>
      {/* Timbre de pedidos nuevos: suena hasta pulsar «Recibir pedido». */}
      {roleHas(user.role, "orders.manage") && <OrderAlarm />}
    </div>
  );
}
