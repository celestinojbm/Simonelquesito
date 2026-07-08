import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { WhatsAppFab } from "@/components/layout/whatsapp-fab";
import { getSetting } from "@/modules/config/service";
import { isScheduleOpen, todayWindowsLabel } from "@/modules/config/schedule";
import { getSectionBackgroundUrl } from "@/modules/config/section-bg";
import { PageWallpaper } from "./page-wallpaper";

// Toda la tienda se renderiza en cada solicitud: el layout lee el horario desde
// la base de datos, así que no debe pre-generarse en tiempo de build.
export const dynamic = "force-dynamic";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [deliveryHours, contact, branding, pageBg] = await Promise.all([
    getSetting("hours.delivery"),
    getSetting("business.contact"),
    getSetting("branding"),
    getSectionBackgroundUrl("page"),
  ]);
  const now = new Date();
  const open = isScheduleOpen(deliveryHours, now);
  const hoursLabel = todayWindowsLabel(deliveryHours, now);

  return (
    // `isolate` crea un contexto de apilamiento propio: sin él, el fondo crema
    // opaco del <body> se pinta ENCIMA de las capas con z-index negativo y
    // oculta la imagen. Con isolate, las capas quedan sobre el crema del body
    // pero debajo del contenido.
    <div className="relative isolate flex min-h-dvh flex-col">
      {/* Fondo de pantalla de toda la tienda (opcional). Cada sección puede
          poner el suyo propio encima (portada/categoría). Si no hay ninguno, se
          ve el fondo crema del tema. */}
      {pageBg && <PageWallpaper url={pageBg} />}
      <Header open={open} hoursLabel={hoursLabel} brandName={branding.name} brandTagline={branding.tagline} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-24 md:pb-10">{children}</main>
      <footer className="hidden border-t border-brand-soft bg-white py-6 text-center text-sm text-ink-soft md:block">
        <p className="font-semibold text-brand-dark">{branding.name}</p>
        <p>
          {contact.address}
          {contact.phone !== "PENDIENTE" && <> · Tel/WhatsApp: {contact.phone}</>}
        </p>
        <p className="mt-1 text-xs">
          Prohíbase el expendio de bebidas embriagantes a menores de edad. El exceso de alcohol es perjudicial para la salud.
        </p>
        <p className="mt-1 text-xs">
          <a href="/privacidad" className="underline hover:text-brand-dark">Política de privacidad</a>
          {" · "}
          <a href="/terminos" className="underline hover:text-brand-dark">Términos y condiciones</a>
        </p>
      </footer>
      <WhatsAppFab phone={contact.whatsapp} brandName={branding.name} />
      <BottomNav />
    </div>
  );
}
