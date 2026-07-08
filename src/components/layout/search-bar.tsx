"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function SearchBarInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  // Búsqueda EN VIVO: al escribir (2+ letras) muestra resultados tras una breve
  // espera, sin pulsar 🔍. Si ya estás en resultados, refina sin llenar el
  // historial (replace); si no, navega a resultados (push).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => {
      const url = `/buscar?q=${encodeURIComponent(term)}`;
      if (pathname === "/buscar") router.replace(url);
      else router.push(url);
    }, 350);
    return () => clearTimeout(t);
  }, [q, pathname, router]);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/buscar?q=${encodeURIComponent(q.trim())}`);
      }}
      className="flex"
    >
      <label htmlFor="mc-search" className="sr-only">
        Buscar productos
      </label>
      <input
        id="mc-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar arroz, frutas, gaseosa…"
        className="w-full rounded-l-full border-0 bg-cream px-4 text-sm text-ink placeholder:text-ink-soft focus:ring-0"
      />
      <button
        type="submit"
        aria-label="Buscar"
        className="rounded-r-full bg-brand-dark px-4 text-cream transition hover:bg-ink"
      >
        🔍
      </button>
    </form>
  );
}

export function SearchBar() {
  return (
    <Suspense fallback={<div className="skeleton h-11 w-full rounded-full" />}>
      <SearchBarInner />
    </Suspense>
  );
}
