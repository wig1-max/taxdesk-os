import { describe, expect, it } from "vitest";
import { computeIepfFee } from "@/lib/validation/fees";

describe("IEPF fee math (15% / ₹5,000 upfront / balance after credit)", () => {
  it("computes expected fee from estimated claim value", () => {
    const r = computeIepfFee({
      estimated_claim_value: 240000,
      fee_percent: 15,
      payments_received: 0,
    });
    expect(r.expected_fee).toBe(36000);
    expect(r.final_fee).toBeUndefined();
    expect(r.effective_total).toBe(36000);
    expect(r.balance_fee_due).toBe(36000);
  });

  it("switches to final fee once actual recovery is known", () => {
    const r = computeIepfFee({
      estimated_claim_value: 240000,
      actual_recovered_value: 200000,
      fee_percent: 15,
      payments_received: 5000,
    });
    expect(r.final_fee).toBe(30000);
    expect(r.effective_total).toBe(30000);
    expect(r.balance_fee_due).toBe(25000); // 30000 - 5000 upfront paid
  });

  it("override wins over computed values", () => {
    const r = computeIepfFee({
      estimated_claim_value: 100000,
      actual_recovered_value: 100000,
      fee_percent: 15,
      payments_received: 5000,
      override_total: 12000,
    });
    expect(r.effective_total).toBe(12000);
    expect(r.balance_fee_due).toBe(7000);
  });

  it("never returns a negative balance (overpayment)", () => {
    const r = computeIepfFee({
      estimated_claim_value: 10000,
      actual_recovered_value: 10000,
      fee_percent: 15,
      payments_received: 5000, // > 1500 fee
    });
    expect(r.balance_fee_due).toBe(0);
  });

  it("zero recovery -> zero final fee, zero balance", () => {
    const r = computeIepfFee({
      estimated_claim_value: 240000,
      actual_recovered_value: 0,
      fee_percent: 15,
      payments_received: 5000,
    });
    expect(r.final_fee).toBe(0);
    expect(r.balance_fee_due).toBe(0);
  });

  it("rounds to whole rupees", () => {
    const r = computeIepfFee({
      estimated_claim_value: 33333,
      fee_percent: 15,
      payments_received: 0,
    });
    expect(r.expected_fee).toBe(5000); // 4999.95 -> 5000
  });
});
