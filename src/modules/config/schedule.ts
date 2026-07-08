import type { WeeklySchedule } from "./keys";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Minutos desde medianoche en la zona horaria del negocio (America/Bogota). */
export function localTimeParts(date: Date, timeZone = "America/Bogota") {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, (typeof DAY_KEYS)[number]> = {
    Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat",
  };
  const hour = parseInt(get("hour"), 10) % 24; // Intl puede devolver "24"
  return {
    day: weekdayMap[get("weekday")] ?? "mon",
    minutes: hour * 60 + parseInt(get("minute"), 10),
  };
}

function parseWindow(win: string): { start: number; end: number } | null {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(win);
  if (!m) return null;
  return {
    start: Number(m[1]) * 60 + Number(m[2]),
    end: Number(m[3]) * 60 + Number(m[4]),
  };
}

/**
 * ¿El horario semanal está activo en `date`?
 * Soporta ventanas que cruzan medianoche ("22:00-02:00").
 */
export function isScheduleOpen(schedule: WeeklySchedule, date: Date, timeZone?: string): boolean {
  const { day, minutes } = localTimeParts(date, timeZone);
  const windows = schedule[day] ?? [];
  for (const win of windows) {
    const w = parseWindow(win);
    if (!w) continue;
    if (w.start <= w.end) {
      if (minutes >= w.start && minutes < w.end) return true;
    } else {
      // cruza medianoche
      if (minutes >= w.start || minutes < w.end) return true;
    }
  }
  // Ventana del día anterior que cruza medianoche
  const prevDay = DAY_KEYS[(DAY_KEYS.indexOf(day) + 6) % 7]!;
  for (const win of schedule[prevDay] ?? []) {
    const w = parseWindow(win);
    if (w && w.start > w.end && minutes < w.end) return true;
  }
  return false;
}

/** Descripción legible del horario de hoy, ej. "08:00 – 20:00". */
export function todayWindowsLabel(schedule: WeeklySchedule, date: Date, timeZone?: string): string {
  const { day } = localTimeParts(date, timeZone);
  const windows = schedule[day] ?? [];
  if (windows.length === 0) return "Cerrado hoy";
  return windows.map((w) => w.replace("-", " – ")).join(", ");
}
