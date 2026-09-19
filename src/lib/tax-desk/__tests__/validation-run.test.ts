import { describe, expect, it } from "vitest";
import { deriveValidationRun } from "@/lib/tax-desk/validation-run";

/**
 * Phase 3 (K.2.9.3) — authoritative validation-run marker. Proves the single
 * derivation both the Validation view and the readiness model consume: a run
 * exists iff `validation_last_run_at` is set, independent of any findings.
 */
describe("deriveValidationRun", () => {
  it("reports no run when the marker is absent", () => {
    expect(deriveValidationRun(null)).toEqual({ runExists: false, lastRunAt: null, rulesVersion: null });
    expect(deriveValidationRun(undefined)).toEqual({ runExists: false, lastRunAt: null, rulesVersion: null });
    expect(deriveValidationRun({})).toEqual({ runExists: false, lastRunAt: null, rulesVersion: null });
  });

  it("reports a run from the marker alone — a ZERO-FINDING run still counts", () => {
    // The whole point of Phase 3: no findings, but the marker is set → runExists.
    const m = deriveValidationRun({
      validation_last_run_at: "2026-07-18T10:00:00.000Z",
      validation_rules_version: "AY_2026_27_V0_PREP_ONLY",
    });
    expect(m).toEqual({
      runExists: true,
      lastRunAt: "2026-07-18T10:00:00.000Z",
      rulesVersion: "AY_2026_27_V0_PREP_ONLY",
    });
  });

  it("normalizes an explicit null timestamp to no-run", () => {
    expect(deriveValidationRun({ validation_last_run_at: null, validation_rules_version: null })).toEqual({
      runExists: false,
      lastRunAt: null,
      rulesVersion: null,
    });
  });

  it("carries a run timestamp even when the rules version is missing", () => {
    const m = deriveValidationRun({ validation_last_run_at: "2026-07-18T11:22:33.000Z" });
    expect(m.runExists).toBe(true);
    expect(m.lastRunAt).toBe("2026-07-18T11:22:33.000Z");
    expect(m.rulesVersion).toBeNull();
  });
});
