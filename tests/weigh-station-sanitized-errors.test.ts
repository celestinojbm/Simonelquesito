/**
 * #8 Errores sanitizados: la server action NO filtra SQL/Drizzle/stack ni detalles
 * internos; devuelve un mensaje genérico para errores inesperados y conserva los
 * mensajes específicos de errores conocidos (StationError, permisos, Zod).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({ id: "u", email: "e@example.invalid", fullName: "F", role: "admin" })),
}));
vi.mock("@/modules/inventory/weigh-station", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/inventory/weigh-station")>();
  return { ...actual, recordStationMovement: vi.fn() };
});

import { recordStationMovement, StationError } from "@/modules/inventory/weigh-station";
import { stationMovementAction } from "@/app/actions/weigh-station";

const valid = {
  variantId: "v",
  direction: "in" as const,
  quantityMinor: 1000,
  source: "manual" as const,
  reasonCode: "recepcion",
  idempotencyKey: "sanitized-key-1",
};

describe("errores sanitizados en la server action", () => {
  it("un error inesperado (SQL/Drizzle) se devuelve genérico y no filtra detalles", async () => {
    vi.mocked(recordStationMovement).mockRejectedValueOnce(
      new Error('relation "product_variants" does not exist\n  at Query.execute (drizzle-orm)'),
    );
    const r = await stationMovementAction(valid as never);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe("No se pudo completar la operación. Intenta nuevamente.");
      expect(r.message).not.toMatch(/product_variants|relation|drizzle|at Query/i);
    }
  });

  it("un StationError conocido conserva su mensaje específico", async () => {
    vi.mocked(recordStationMovement).mockRejectedValueOnce(new StationError("La cantidad debe ser un entero mayor que cero."));
    const r = await stationMovementAction(valid as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("La cantidad debe ser un entero mayor que cero.");
  });

  it("un error de validación Zod se reporta como dato inválido, no genérico de servidor", async () => {
    const r = await stationMovementAction({ ...valid, quantityMinor: -5 } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain("No se pudo completar");
  });
});
