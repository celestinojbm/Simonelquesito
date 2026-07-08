"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminSetProductActive } from "@/app/actions/admin";

/** Editar + activar/desactivar un producto desde la lista. */
export function ProductRowActions({ productId, isActive }: { productId: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState(false);

  const toggle = () => {
    setErr(false);
    startTransition(async () => {
      const r = await adminSetProductActive(productId, !isActive);
      if (r.ok) router.refresh();
      else setErr(true);
    });
  };

  return (
    <span className="flex items-center justify-end gap-2">
      <Link
        href={`/admin/productos/${productId}`}
        className="btn rounded-full border border-brand px-3 py-1 text-xs font-bold text-brand-dark hover:bg-brand-soft"
      >
        ✏️ Editar
      </Link>
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className={`btn rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
          isActive ? "border border-brand-soft text-ink-soft hover:bg-ink/5" : "bg-brand text-white"
        }`}
        title={isActive ? "Ocultar de la tienda" : "Mostrar en la tienda"}
      >
        {pending ? "…" : isActive ? "Desactivar" : "Activar"}
      </button>
      {err && <span className="text-xs text-coral-dark">error</span>}
    </span>
  );
}
