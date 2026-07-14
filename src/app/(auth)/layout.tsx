import Image from "next/image";
import { getSetting } from "@/modules/config/service";

/**
 * Shell mínimo y NEUTRO para las pantallas sin storefront: `/login` y las
 * páginas legales (`/privacidad`, `/terminos`). A diferencia de
 * `(store)/layout.tsx`, aquí NO se monta el chrome comercial heredado —sin
 * buscador, carrito, estado de domicilios, botón de WhatsApp, navegación
 * pública (Inicio/Categorías/Ofertas/Carrito/Cuenta) ni footer comercial—.
 * Solo la marca de la instancia (leída de `settings`, nunca hardcodeada) y el
 * contenido de la página.
 */
export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const branding = await getSetting("branding");
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <Image src="/icons/logo.svg" alt="" width={56} height={56} priority />
        <span className="text-lg font-extrabold text-brand-dark">{branding.name}</span>
        {branding.tagline && <span className="text-xs text-ink-soft">{branding.tagline}</span>}
      </div>
      <main className="w-full max-w-2xl flex-1">{children}</main>
    </div>
  );
}
