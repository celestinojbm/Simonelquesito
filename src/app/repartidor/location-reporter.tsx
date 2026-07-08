"use client";

import { useEffect, useState } from "react";

/**
 * Mientras el domiciliario tenga esta página abierta con entregas en camino,
 * comparte su posición cada ~10 s para el seguimiento del cliente. Solo se
 * publica en pedidos out_for_delivery (lo filtra el servidor).
 */
export function LocationReporter({ activeCount }: { activeCount: number }) {
  const [status, setStatus] = useState<"idle" | "on" | "denied" | "off">("idle");

  useEffect(() => {
    if (activeCount === 0 || !navigator.geolocation) {
      setStatus("off");
      return;
    }
    let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus("on");
        const now = Date.now();
        if (now - lastSent < 10_000) return; // no saturar la red/batería
        lastSent = now;
        void fetch("/api/driver/location", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        }).catch(() => {});
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setStatus("denied");
      },
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeCount]);

  if (activeCount === 0) return null;
  if (status === "denied") {
    return (
      <p className="mb-3 rounded-lg bg-sun/40 px-3 py-2 text-xs text-ink">
        ⚠️ Sin permiso de ubicación: el cliente no podrá ver dónde vas. Actívalo en el navegador.
      </p>
    );
  }
  return (
    <p className="mb-3 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand-dark">
      {status === "on" ? "📡 Compartiendo tu posición con el cliente mientras la entrega va en camino." : "📡 Activando ubicación…"}
    </p>
  );
}
