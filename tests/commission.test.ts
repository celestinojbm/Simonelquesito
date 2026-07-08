import { describe, it, expect } from "vitest";
import { computeCommission, type OrderForCommission } from "@/modules/commission/service";
import { settingsDefaults } from "@/modules/config/keys";

const baseConfig = settingsDefaults["commission.base"];

function order(overrides: Partial<OrderForCommission> = {}): OrderForCommission {
  return {
    channel: "web_pwa",
    status: "delivered",
    itemsTotalCop: 100_000,
    discountCop: 0,
    deliveryFeeCop: 5_000,
    taxCop: 0,
    tipCop: 0,
    gatewayFeeCop: 0,
    marketplaceCommissionCop: 0,
    refundedCop: 0,
    ...overrides,
  };
}

describe("computeCommission", () => {
  it("aplica el 10% por defecto sobre la venta neta de mercancía", () => {
    const result = computeCommission([order()], baseConfig);
    expect(result.netMerchandiseCop).toBe(100_000);
    expect(result.commissionCop).toBe(10_000);
  });

  it("excluye pedidos de canales no atribuibles (POS físico)", () => {
    const result = computeCommission([order(), order({ channel: "pos_physical" })], baseConfig);
    expect(result.ordersCount).toBe(1);
    expect(result.commissionCop).toBe(10_000);
  });

  it("solo cuenta pedidos entregados; cancelados quedan informativos", () => {
    const result = computeCommission([order(), order({ status: "cancelled" })], baseConfig);
    expect(result.ordersCount).toBe(1);
    expect(result.cancellationsCop).toBe(100_000);
    expect(result.commissionCop).toBe(10_000);
  });

  it("deduce descuentos, pasarela, marketplace y reembolsos según configuración", () => {
    const result = computeCommission(
      [order({ discountCop: 10_000, gatewayFeeCop: 3_000, marketplaceCommissionCop: 2_000, refundedCop: 5_000 })],
      baseConfig,
    );
    // 100000 − 10000 − 3000 − 2000 − 5000 = 80000 → 10% = 8000
    expect(result.netMerchandiseCop).toBe(80_000);
    expect(result.commissionCop).toBe(8_000);
  });

  it("el envío NO forma parte de la base por defecto, pero es configurable", () => {
    const withDelivery = computeCommission([order()], { ...baseConfig, includeDelivery: true });
    expect(withDelivery.netMerchandiseCop).toBe(105_000);
    const without = computeCommission([order()], baseConfig);
    expect(without.netMerchandiseCop).toBe(100_000);
  });

  it("la tasa es configurable (no está fija en 10%)", () => {
    const result = computeCommission([order()], { ...baseConfig, ratePctBps: 750 });
    expect(result.commissionCop).toBe(7_500);
  });

  it("desglosa por canal", () => {
    const result = computeCommission(
      [order(), order({ channel: "whatsapp", itemsTotalCop: 50_000 })],
      baseConfig,
    );
    expect(result.byChannel["web_pwa"]?.netCop).toBe(100_000);
    expect(result.byChannel["whatsapp"]?.netCop).toBe(50_000);
  });

  it("la base nunca es negativa", () => {
    const result = computeCommission([order({ refundedCop: 500_000 })], baseConfig);
    expect(result.netMerchandiseCop).toBe(0);
    expect(result.commissionCop).toBe(0);
  });
});
