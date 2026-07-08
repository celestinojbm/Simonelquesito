import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { CartProvider } from "@/components/cart/cart-context";
import { ToastProvider } from "@/components/ui/toast";
import { getSetting } from "@/modules/config/service";

// Todo el sitio es dinámico (lee configuración en vivo); la marca de la
// instancia (plantilla replicable) sale de settings, nunca del código.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const b = await getSetting("branding");
  return {
    title: {
      default: `${b.name} — ${b.tagline}`,
      template: `%s · ${b.name}`,
    },
    description: b.seoDescription,
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icons/logo.svg" },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const b = await getSetting("branding");
  return {
    themeColor: b.colors.brand,
    width: "device-width",
    initialScale: 1,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const b = await getSetting("branding");
  const c = b.colors;
  // Sobrescribe las variables del tema de Tailwind en runtime: re-marcar una
  // instancia = editar la llave "branding" en configuración, sin build.
  const themeVars = `:root{--color-brand:${c.brand};--color-brand-dark:${c.brandDark};--color-brand-soft:${c.brandSoft};--color-coral:${c.coral};--color-coral-dark:${c.coralDark};--color-sun:${c.sun};--color-cream:${c.cream};--color-ink:${c.ink};--color-ink-soft:${c.inkSoft};--color-liquor:${c.liquor};--color-liquor-soft:${c.liquorSoft};}`;

  return (
    <html lang="es-CO">
      <head>
        <style id="mc-branding">{themeVars}</style>
      </head>
      <body className="min-h-dvh bg-cream text-ink antialiased">
        <ToastProvider>
          <CartProvider>{children}</CartProvider>
        </ToastProvider>
        <Script id="mc-sw" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(function(){}); }`}
        </Script>
      </body>
    </html>
  );
}
