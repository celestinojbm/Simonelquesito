/* Service worker de Market Castilla — MVP.
 * Estrategia: red para navegación (datos frescos de pedidos/stock);
 * stale-while-revalidate para imágenes e íconos (se sirve caché y se
 * actualiza en segundo plano, así los cambios de marca llegan solos);
 * cache-first solo para los assets con hash de Next (inmutables). */
const CACHE = "mc-static-v3"; // subir versión invalida cachés anteriores
const STATIC_ASSETS = ["/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Solo peticiones GET del PROPIO dominio: las rutas de abajo comparan
  // pathname, y URLs externas también pueden empezar por /images/ (p. ej.
  // images.openfoodfacts.org/images/...) — esas van directo a la red.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Assets con hash en el nombre: nunca cambian → cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Imágenes e íconos: stale-while-revalidate (rápido + se actualiza solo).
  if (
    url.pathname.startsWith("/images/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/api/images/")
  ) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request)
          .then((res) => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
