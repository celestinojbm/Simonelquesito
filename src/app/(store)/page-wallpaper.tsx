/**
 * Capa fija de fondo de pantalla (detrás de todo el contenido): la foto + un
 * velo crema tenue para que el texto siga legible. Se usa para el fondo global
 * (layout) y para el fondo por sección (portada/categoría), que se pinta encima
 * del global cuando existe.
 */
export function PageWallpaper({ url }: { url: string }) {
  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 -z-10"
        style={{ backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />
      <div aria-hidden className="fixed inset-0 -z-10 bg-cream/35" />
    </>
  );
}
