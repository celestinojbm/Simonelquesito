"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { loadLeaflet, pinIcon } from "./leaflet-loader";

/**
 * Selector de punto de entrega: el cliente toca el mapa (o usa su GPS) para
 * fijar la ubicación EXACTA del domicilio. Complementa la dirección escrita —
 * no la reemplaza — y le ahorra al domiciliario adivinar interiores/manzanas.
 */
export function MapPicker({
  center,
  value,
  onChange,
}: {
  center: { lat: number; lng: number };
  value: { lat: number; lng: number } | null;
  onChange: (pos: { lat: number; lng: number } | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = await loadLeaflet();
        if (cancelled || !containerRef.current || mapRef.current) return;
        const start = value ?? center;
        const map = L.map(containerRef.current).setView([start.lat, start.lng], value ? 17 : 15);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        }).addTo(map);

        const setMarker = (lat: number, lng: number) => {
          if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
          else {
            markerRef.current = L.marker([lat, lng], {
              icon: pinIcon(L, "#F05A3C", "📍"),
              draggable: true,
            }).addTo(map);
            markerRef.current.on("dragend", () => {
              const p = markerRef.current!.getLatLng();
              onChangeRef.current({ lat: p.lat, lng: p.lng });
            });
          }
          onChangeRef.current({ lat, lng });
        };

        map.on("click", (e) => setMarker(e.latlng.lat, e.latlng.lng));
        if (value) setMarker(value.lat, value.lng);
        mapRef.current = map;
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // El mapa se monta una sola vez; value inicial y center no deben remontarlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lng } = pos.coords;
        const map = mapRef.current;
        if (!map || !window.L) return;
        map.setView([lat, lng], 17);
        map.fire("click", { latlng: window.L.latLng(lat, lng) });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  if (status === "error") {
    return (
      <p className="rounded-card border border-brand-soft bg-white p-3 text-xs text-ink-soft">
        No se pudo cargar el mapa. La dirección escrita es suficiente para el domicilio.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* isolate + z-0: los panes de Leaflet (z-index interno ≤1000) quedan
          encapsulados y no se dibujan por encima del header sticky (z-40). */}
      <div className="relative isolate z-0 overflow-hidden rounded-card border border-brand-soft">
        <div ref={containerRef} className="h-64 w-full" />
        {status === "loading" && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center bg-brand-soft text-sm text-brand-dark">
            Cargando mapa…
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="btn rounded-full border border-brand px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-50"
        >
          {locating ? "Ubicando…" : "🎯 Usar mi ubicación"}
        </button>
        {value ? (
          <span className="text-xs font-medium text-brand-dark">✓ Punto de entrega fijado</span>
        ) : (
          <span className="text-xs text-ink-soft">Toca el mapa donde debe llegar el pedido</span>
        )}
      </div>
    </div>
  );
}
