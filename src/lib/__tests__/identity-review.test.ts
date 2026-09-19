import { describe, expect, it } from "vitest";
import {
  identityReviewSchema,
  isIdentityReviewComplete,
} from "@/lib/validation/identity-review";

const base = {
  case_id: "3f0e8f9a-0000-4000-8000-000000000001",
  pan_name_match: "match",
  cml_name_match: "match",
  certificate_name_match: "na",
  bank_name_match: "match",
  address_mismatch: "no",
  signature_mismatch_risk: "low",
  same_person_affidavit_needed: false,
  change_of_address_affidavit_needed: false,
} as const;

describe("identity review completeness", () => {
  it("complete when every field is checked", () => {
    const r = identityReviewSchema.parse(base);
    expect(isIdentityReviewComplete(r)).toBe(true);
  });

  it("incomplete while any name match is not_checked", () => {
    const r = identityReviewSchema.parse({ ...base, cml_name_match: "not_checked" });
    expect(isIdentityReviewComplete(r)).toBe(false);
  });

  it("incomplete while address is not_checked", () => {
    const r = identityReviewSchema.parse({ ...base, address_mismatch: "not_checked" });
    expect(isIdentityReviewComplete(r)).toBe(false);
  });

  it("incomplete while signature risk is unknown", () => {
    const r = identityReviewSchema.parse({ ...base, signature_mismatch_risk: "unknown" });
    expect(isIdentityReviewComplete(r)).toBe(false);
  });

  it("mismatches still count as complete (checked, with issues)", () => {
    const r = identityReviewSchema.parse({
      ...base,
      pan_name_match: "mismatch",
      address_mismatch: "yes",
      signature_mismatch_risk: "high",
    });
    expect(isIdentityReviewComplete(r)).toBe(true);
  });

  it("rejects invalid enum values", () => {
    expect(identityReviewSchema.safeParse({ ...base, pan_name_match: "maybe" }).success).toBe(false);
  });
});
