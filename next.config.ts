import type { NextConfig } from "next";

// Reconstrucción limpia (rev 2): invalida la caché de build de Vercel tras un
// manifiesto de RSC corrupto en /admin/fiado.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El demo corre sin CDN de imágenes; los assets son SVG locales.
  images: { unoptimized: true },
  // Las imágenes de fondo se suben como data-URI por Server Action; el cliente
  // las reduce (~1600px), pero damos holgura por encima del 1MB por defecto.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
