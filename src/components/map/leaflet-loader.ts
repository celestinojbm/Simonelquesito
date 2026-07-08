"use client";

/**
 * Carga Leaflet (mapas con OpenStreetMap) bajo demanda desde CDN.
 * Sin API keys ni costos por uso, a diferencia de Google Maps. Se carga solo
 * cuando una página muestra un mapa; el resto de la app no paga el peso.
 */

type LeafletNS = typeof import("leaflet");

declare global {
  interface Window {
    L?: LeafletNS;
  }
}

const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

let loading: Promise<LeafletNS> | null = null;

export function loadLeaflet(): Promise<LeafletNS> {
  if (typeof window === "undefined") return Promise.reject(new Error("solo en cliente"));
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => (window.L ? resolve(window.L) : reject(new Error("Leaflet no cargó")));
    script.onerror = () => reject(new Error("No se pudo cargar el mapa (¿sin internet?)"));
    document.head.appendChild(script);
  });
  return loading;
}

/** Ícono de pin como divIcon (sin depender de las imágenes del CDN). */
export function pinIcon(L: LeafletNS, color: string, emoji: string) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:${color};border:2px solid #fff;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.35)"><span style="transform:rotate(45deg);font-size:16px;line-height:1">${emoji}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 30],
  });
}
