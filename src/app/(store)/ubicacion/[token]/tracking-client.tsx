"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { MapPicker } from "@/components/map/map-picker";
import { loadLeaflet, pinIcon } from "@/components/map/leaflet-loader";

const STATUS_ES: Record<string, string> = {
  new: "Recibido",
  pending_payment: "Esperando pago",
  paid: "Pago confirmado",
  confirmed: "Confirmado ✅",
  preparing: "En preparación 🧺",
  awaiting_substitution: "Esperando tu respuesta a un reemplazo",
  weight_adjustment_pending: "Ajustando peso real ⚖️",
  ready: "Listo para salir 📦",
  assigned: "Domiciliario asignado 🛵",
  out_for_delivery: "¡En camino! 🛵💨",
  delivered: "Entregado ✅",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  failed: "Fallido",
};

type Pos = { lat: number; lng: number };

type ApiState = {
  status: string;
  location: Pos | null;
  canSetLocation: boolean;
  driver: (Pos & { at: string | null }) | null;
};

/** Mapa en vivo: tienda, punto de entrega y domiciliario (si va en camino). */
function LiveMap({ store, home, driver }: { store: Pos; home: Pos; driver: Pos | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const driverMarkerRef = useRef<Marker | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = await loadLeaflet();
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        }).addTo(map);
        L.marker([store.lat, store.lng], { icon: pinIcon(L, "#12613F", "🏪") })
          .addTo(map)
          .bindPopup("Market Castilla");
        L.marker([home.lat, home.lng], { icon: pinIcon(L, "#F05A3C", "🏠") })
          .addTo(map)
          .bindPopup("Tu entrega");
        map.fitBounds(
          L.latLngBounds([
            [store.lat, store.lng],
            [home.lat, home.lng],
          ]).pad(0.25),
        );
        mapRef.current = map;
      } catch {
        /* el estado textual sigue visible sin mapa */
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      driverMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const L = typeof window !== "undefined" ? window.L : undefined;
    if (!map || !L) return;
    if (driver) {
      if (driverMarkerRef.current) driverMarkerRef.current.setLatLng([driver.lat, driver.lng]);
      else {
        driverMarkerRef.current = L.marker([driver.lat, driver.lng], {
          icon: pinIcon(L, "#F5C542", "🛵"),
        })
          .addTo(map)
          .bindPopup("Tu domiciliario");
      }
    } else if (driverMarkerRef.current) {
      driverMarkerRef.current.remove();
      driverMarkerRef.current = null;
    }
  }, [driver]);

  // isolate + z-0: los z-index internos de Leaflet no tapan el header sticky.
  return <div ref={containerRef} className="relative isolate z-0 h-72 w-full overflow-hidden rounded-card border border-brand-soft" />;
}

export function TrackingClient({
  token,
  initialStatus,
  fulfillment,
  initialLocation,
  store,
}: {
  token: string;
  initialStatus: string;
  fulfillment: string;
  initialLocation: Pos | null;
  store: Pos;
}) {
  const [state, setState] = useState<ApiState>({
    status: initialStatus,
    location: initialLocation,
    canSetLocation: fulfillment === "delivery",
    driver: null,
  });
  const [picking, setPicking] = useState<Pos | null>(null);
  const [editing, setEditing] = useState(initialLocation === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/ubicacion/${token}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ApiState;
      setState(data);
    } catch {
      /* reintenta en el próximo ciclo */
    }
  }, [token]);

  // Sondeo: cada 10 s mientras el pedido está vivo (más aún si va en camino).
  useEffect(() => {
    const final = ["delivered", "cancelled", "refunded", "failed"].includes(state.status);
    if (final) return;
    const ms = state.status === "out_for_delivery" ? 8000 : 15000;
    const t = setInterval(refresh, ms);
    return () => clearInterval(t);
  }, [refresh, state.status]);

  const save = async () => {
    if (!picking) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ubicacion/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(picking),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "No se pudo guardar");
      setEditing(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la ubicación");
    } finally {
      setSaving(false);
    }
  };

  const statusLabel = STATUS_ES[state.status] ?? state.status;
  const showPicker = fulfillment === "delivery" && state.canSetLocation && (editing || !state.location);

  return (
    <div className="space-y-4">
      <div className="rounded-card bg-brand-soft p-3 text-center">
        <p className="text-xs text-brand-dark uppercase">Estado del pedido</p>
        <p className="text-lg font-extrabold text-brand-dark">{statusLabel}</p>
        {state.status === "out_for_delivery" && !state.driver && (
          <p className="text-xs text-ink-soft">La posición del domiciliario aparecerá aquí en cuanto la comparta.</p>
        )}
      </div>

      {showPicker ? (
        <div className="space-y-2">
          <MapPicker center={state.location ?? store} value={picking ?? state.location} onChange={setPicking} />
          <button
            type="button"
            onClick={save}
            disabled={!picking || saving}
            className="btn w-full rounded-full bg-brand px-4 py-2.5 font-bold text-white disabled:opacity-50"
          >
            {saving ? "Guardando…" : "📍 Guardar punto de entrega"}
          </button>
          {error && <p role="alert" className="text-xs font-medium text-coral-dark">{error}</p>}
        </div>
      ) : state.location ? (
        <div className="space-y-2">
          <LiveMap store={store} home={state.location} driver={state.driver} />
          {state.canSetLocation && (
            <button
              type="button"
              onClick={() => {
                setPicking(state.location);
                setEditing(true);
              }}
              className="btn rounded-full border border-brand-soft px-4 py-1.5 text-xs font-semibold text-ink-soft"
            >
              ✏️ Corregir el punto de entrega
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
