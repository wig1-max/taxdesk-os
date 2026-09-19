import { describe, expect, it } from "vitest";
import { makeTaxPackIdentity, type TaxPackStatus } from "@/lib/tax-pack/identity";
import { canTransition, isRelianceReady, retireTaxPack, verifyTaxPack } from "@/lib/tax-pack/lifecycle";

function identity(status: TaxPackStatus) {
  return makeTaxPackIdentity({
    jurisdiction: "IN",
    law: "ITA_1961",
    periodKind: "assessment_year",
    period: "2026-27",
    computationRulesVersion: "V0",
    validationRulesVersion: "V0",
    status,
    effectiveFrom: "2025-04-01",
    verifiedBy: status === "ca_verified" ? "CA Test" : null,
    verifiedAt: status === "ca_verified" ? "2026-07-19T00:00:00.000Z" : null,
  });
}

describe("lifecycle transitions", () => {
  it("permits only draft→ca_verified, draft→retired, ca_verified→retired", () => {
    expect(canTransition("draft", "ca_verified")).toBe(true);
    expect(canTransition("draft", "retired")).toBe(true);
    expect(canTransition("ca_verified", "retired")).toBe(true);
    // Disallowed
    expect(canTransition("ca_verified", "draft")).toBe(false);
    expect(canTransition("retired", "draft")).toBe(false);
    expect(canTransition("retired", "ca_verified")).toBe(false);
    expect(canTransition("draft", "draft")).toBe(false);
  });

  it("verifies a draft pack, recording verifier + timestamp, without mutating the original", () => {
    const draft = identity("draft");
    const result = verifyTaxPack(draft, { verifiedBy: "CA Alpha", verifiedAt: "2026-07-19T10:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.status).toBe("ca_verified");
      expect(result.identity.verifiedBy).toBe("CA Alpha");
      expect(result.identity.verifiedAt).toBe("2026-07-19T10:00:00.000Z");
      // Coordinates unchanged — verification does not change identity.
      expect(result.identity.computationRulesVersion).toBe(draft.computationRulesVersion);
      expect(result.identity.period).toBe(draft.period);
    }
    // Original identity is untouched (immutability).
    expect(draft.status).toBe("draft");
    expect(draft.verifiedBy).toBeNull();
  });

  it("refuses to verify a non-draft pack, or without verifier/timestamp", () => {
    expect(verifyTaxPack(identity("retired"), { verifiedBy: "CA", verifiedAt: "t" })).toEqual({
      ok: false,
      reason: "Cannot verify a retired pack",
    });
    const alreadyVerified = verifyTaxPack(identity("ca_verified"), { verifiedBy: "CA", verifiedAt: "t" });
    expect(alreadyVerified.ok).toBe(false);
    const missing = verifyTaxPack(identity("draft"), { verifiedBy: "", verifiedAt: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/requires verifiedBy and verifiedAt/);
  });

  it("retires from draft or ca_verified and clears verification fields", () => {
    const fromDraft = retireTaxPack(identity("draft"));
    expect(fromDraft.ok).toBe(true);
    if (fromDraft.ok) expect(fromDraft.identity.status).toBe("retired");

    const fromVerified = retireTaxPack(identity("ca_verified"));
    expect(fromVerified.ok).toBe(true);
    if (fromVerified.ok) {
      expect(fromVerified.identity.status).toBe("retired");
      expect(fromVerified.identity.verifiedBy).toBeNull();
      expect(fromVerified.identity.verifiedAt).toBeNull();
    }
  });

  it("refuses to retire an already-retired pack", () => {
    const r = retireTaxPack(identity("retired"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Cannot retire a retired pack/);
  });

  it("isRelianceReady is true only for ca_verified", () => {
    expect(isRelianceReady(identity("draft"))).toBe(false);
    expect(isRelianceReady(identity("ca_verified"))).toBe(true);
    expect(isRelianceReady(identity("retired"))).toBe(false);
  });
});
