import { describe, it, expect } from "vitest";
import { checkRestricted, ageFromBirthDate } from "@/modules/restricted/engine";
import { isScheduleOpen } from "@/modules/config/schedule";
import type { RestrictedRule, WeeklySchedule } from "@/modules/config/keys";

const allWeek = (win: string): WeeklySchedule => ({
  mon: [win], tue: [win], wed: [win], thu: [win], fri: [win], sat: [win], sun: [win],
});

const liquorRule: RestrictedRule = {
  label: "Licores",
  schedule: allWeek("10:00-20:00"),
  requiresAgeDeclaration: true,
  requiresIdCheckOnDelivery: true,
  allowedFulfillments: ["delivery", "pickup"],
  excludedZoneIds: ["zon_excluida"],
  minAge: 18,
};

/** Miércoles 2026-07-01 a las 15:00 hora Bogotá (UTC-5) = 20:00 UTC. */
const openTime = new Date("2026-07-01T20:00:00Z");
/** 23:00 Bogotá = 04:00 UTC del día siguiente. */
const closedTime = new Date("2026-07-02T04:00:00Z");

describe("isScheduleOpen", () => {
  it("respeta el horario configurado en hora de Bogotá", () => {
    expect(isScheduleOpen(allWeek("10:00-20:00"), openTime)).toBe(true);
    expect(isScheduleOpen(allWeek("10:00-20:00"), closedTime)).toBe(false);
  });

  it("soporta ventanas que cruzan medianoche (futura operación 24h por config)", () => {
    // 23:00 Bogotá con ventana 22:00-02:00 → abierto
    expect(isScheduleOpen(allWeek("22:00-02:00"), closedTime)).toBe(true);
    // 01:00 Bogotá (06:00 UTC): la ventana del día anterior sigue activa
    expect(isScheduleOpen(allWeek("22:00-02:00"), new Date("2026-07-02T06:00:00Z"))).toBe(true);
  });

  it("día sin ventanas = cerrado", () => {
    const schedule: WeeklySchedule = { wed: [] };
    expect(isScheduleOpen(schedule, openTime)).toBe(false);
  });
});

describe("checkRestricted", () => {
  const base = {
    ruleKeys: ["liquor"],
    rules: { liquor: liquorRule },
    fulfillment: "delivery" as const,
    declaredBirthDate: "1990-05-10",
    termsAccepted: true,
  };

  it("permite la venta dentro de horario con mayoría de edad declarada", () => {
    const result = checkRestricted({ ...base, at: openTime });
    expect(result.allowed).toBe(true);
    expect(result.requiresIdCheckOnDelivery).toBe(true);
  });

  it("bloquea fuera del horario configurado", () => {
    const result = checkRestricted({ ...base, at: closedTime });
    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.includes("horario"))).toBe(true);
  });

  it("bloquea a menores de edad", () => {
    const result = checkRestricted({ ...base, at: openTime, declaredBirthDate: "2015-01-01" });
    expect(result.allowed).toBe(false);
  });

  it("exige aceptar condiciones y fecha de nacimiento", () => {
    expect(checkRestricted({ ...base, at: openTime, termsAccepted: false }).allowed).toBe(false);
    expect(checkRestricted({ ...base, at: openTime, declaredBirthDate: null }).allowed).toBe(false);
  });

  it("bloquea zonas excluidas", () => {
    const result = checkRestricted({ ...base, at: openTime, zoneId: "zon_excluida" });
    expect(result.allowed).toBe(false);
  });

  it("bloquea por precaución si no existe la regla configurada", () => {
    const result = checkRestricted({ ...base, at: openTime, rules: {} });
    expect(result.allowed).toBe(false);
  });
});

describe("ageFromBirthDate", () => {
  it("calcula la edad correctamente antes y después del cumpleaños", () => {
    const at = new Date(2026, 6, 1); // 1 jul 2026
    expect(ageFromBirthDate("2008-06-30", at)).toBe(18);
    expect(ageFromBirthDate("2008-07-02", at)).toBe(17);
  });
  it("rechaza formatos inválidos", () => {
    expect(ageFromBirthDate("no-fecha", new Date())).toBeNull();
  });
});
