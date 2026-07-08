import Image from "next/image";

/**
 * Miniatura de producto para listas (admin y tienda): la foto si existe, o
 * el ícono de la categoría como respaldo presentable. Un solo componente
 * para que TODAS las áreas con productos se vean igual.
 */
export function ProductThumb({
  imageUrl,
  icon,
  alt,
  size = 40,
}: {
  imageUrl: string | null;
  icon?: string | null;
  alt: string;
  size?: number;
}) {
  if (imageUrl) {
    return (
      <Image
        src={imageUrl}
        alt={alt}
        width={size}
        height={size}
        unoptimized
        className="shrink-0 rounded-lg border border-brand-soft bg-white object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg border border-brand-soft bg-brand-soft/40"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {icon ?? "📦"}
    </span>
  );
}

/** URL liviana para <Image>: las fotos data-URI se sirven vía /api/images. */
export function imageSrc(img: { id: string; url: string } | null | undefined): string | null {
  if (!img) return null;
  return img.url.startsWith("data:") ? `/api/images/${img.id}` : img.url;
}
