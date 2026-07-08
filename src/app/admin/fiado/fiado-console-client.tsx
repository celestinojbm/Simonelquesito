"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Carga la consola de Fiado como chunk de CLIENTE (ssr: false). Evita que el
 * componente se resuelva por el "React Client Manifest" del servidor, que en
 * producción (Vercel) fallaba de forma intermitente para este componente
 * («Could not find the module …fiado-console#FiadoConsole»). El envoltorio es
 * un componente cliente diminuto y estable; la consola llega por import
 * dinámico normal. `ssr: false` solo se permite dentro de un componente
 * cliente, por eso este envoltorio.
 */
const FiadoConsole = dynamic(
  () => import("./fiado-console").then((m) => ({ default: m.FiadoConsole })),
  {
    ssr: false,
    loading: () => <p className="py-10 text-center text-sm text-ink-soft">Cargando consola de Fiado…</p>,
  },
);

export function FiadoConsoleClient(props: ComponentProps<typeof FiadoConsole>) {
  return <FiadoConsole {...props} />;
}
