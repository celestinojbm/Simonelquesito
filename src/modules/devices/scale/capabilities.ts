/**
 * Detección PURA de capacidades del entorno para la balanza USB. Sin efectos:
 * recibe objetos tipo `navigator`/`location`/`window` (o los globales por
 * defecto) para ser testeable y no tocar nada al importarse.
 *
 * NO accede a secretos ni abre dispositivos. Solo informa qué APIs existen.
 */

export type ScaleEnvLike = {
  hasSerial: boolean;
  hasUsb: boolean;
  secureContext: boolean;
  userAgent: string;
};

export type ScaleCapabilities = {
  /** Web Serial API disponible (Chrome/Edge escritorio). */
  webSerial: boolean;
  /** WebUSB API disponible. */
  webUsb: boolean;
  /** Contexto seguro (HTTPS o localhost) — requisito de ambas APIs. */
  secureContext: boolean;
  /** Sistema operativo aproximado, derivado solo de capacidades públicas del UA. */
  approxOs: "Windows" | "macOS" | "Linux" | "Android" | "iOS" | "Desconocido";
  /** Navegador aproximado. */
  approxBrowser: "Chrome" | "Edge" | "Firefox" | "Safari" | "Desconocido";
  /** ¿El modo manual está siempre disponible? (sí, por diseño). */
  manualAvailable: true;
};

/** Deriva un SO aproximado del user agent (solo pistas públicas, sin fingerprinting). */
function approxOs(ua: string): ScaleCapabilities["approxOs"] {
  const s = ua.toLowerCase();
  if (s.includes("windows")) return "Windows";
  if (s.includes("android")) return "Android";
  if (s.includes("iphone") || s.includes("ipad") || s.includes("ios")) return "iOS";
  if (s.includes("mac os") || s.includes("macintosh")) return "macOS";
  if (s.includes("linux")) return "Linux";
  return "Desconocido";
}

function approxBrowser(ua: string): ScaleCapabilities["approxBrowser"] {
  const s = ua.toLowerCase();
  if (s.includes("edg/")) return "Edge";
  if (s.includes("firefox")) return "Firefox";
  if (s.includes("chrome") || s.includes("chromium")) return "Chrome";
  if (s.includes("safari")) return "Safari";
  return "Desconocido";
}

/** Calcula las capacidades a partir de un entorno ya resuelto (testeable). */
export function computeScaleCapabilities(env: ScaleEnvLike): ScaleCapabilities {
  return {
    webSerial: env.hasSerial && env.secureContext,
    webUsb: env.hasUsb && env.secureContext,
    secureContext: env.secureContext,
    approxOs: approxOs(env.userAgent),
    approxBrowser: approxBrowser(env.userAgent),
    manualAvailable: true,
  };
}

/** Lee el entorno real del navegador (no-op seguro en servidor). */
export function readScaleEnv(): ScaleEnvLike {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return { hasSerial: false, hasUsb: false, secureContext: false, userAgent: "" };
  }
  const nav = navigator as Navigator & { serial?: unknown; usb?: unknown };
  return {
    hasSerial: !!nav.serial,
    hasUsb: !!nav.usb,
    secureContext: typeof window.isSecureContext === "boolean" ? window.isSecureContext : false,
    userAgent: nav.userAgent ?? "",
  };
}

/** Capacidades del entorno actual (navegador). */
export function detectScaleCapabilities(): ScaleCapabilities {
  return computeScaleCapabilities(readScaleEnv());
}

/** Reporte de diagnóstico SANITIZADO (sin seriales completos ni datos personales). */
export function buildDiagnosticReport(
  caps: ScaleCapabilities,
  device?: { portSelected: boolean; vendorId?: string | null; productId?: string | null },
): string {
  const yesNo = (b: boolean) => (b ? "disponible" : "no disponible");
  return [
    "Balanza declarada: BBG Marker-30",
    `Sistema: ${caps.approxOs} · Navegador: ${caps.approxBrowser}`,
    `Contexto seguro (HTTPS): ${caps.secureContext ? "sí" : "no"}`,
    `Web Serial: ${yesNo(caps.webSerial)}`,
    `WebUSB: ${yesNo(caps.webUsb)}`,
    `Modo manual: ${caps.manualAvailable ? "disponible" : "no disponible"}`,
    `Puerto seleccionado: ${device?.portSelected ? "sí" : "no"}`,
    `Vendor ID: ${device?.vendorId ?? "no disponible"}`,
    `Product ID: ${device?.productId ?? "no disponible"}`,
    "Datos recibidos: pendiente de prueba física",
  ].join("\n");
}
