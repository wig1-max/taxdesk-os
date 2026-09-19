import { describe, expect, it } from "vitest";
import {
  screenSensitiveText,
  SUPPORTED_TAX_LAWS,
  taxPrepCaseCreateSchema,
} from "@/lib/validation/tax-case";
import { TAX_LAWS } from "@/lib/tax-pack/identity";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

function base(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    assessment_year: "2026-27",
    financial_year: "2025-26",
    ...overrides,
  };
}

describe("screenSensitiveText", () => {
  it("passes clean scope notes", () => {
    expect(screenSensitiveText("Salaried client, two Form 16s, FD interest.")).toBeNull();
    expect(screenSensitiveText("")).toBeNull();
    expect(screenSensitiveText(undefined)).toBeNull();
  });

  it("rejects portal credential / OTP text", () => {
    expect(screenSensitiveText("portal password is abc123")).toMatch(/credential/i);
    expect(screenSensitiveText("OTP came on mobile")).toMatch(/credential/i);
    expect(screenSensitiveText("share the e-filing password")).toMatch(/credential/i);
  });

  it("rejects a PAN in free text", () => {
    expect(screenSensitiveText("PAN is ABCDE1234F for reference")).toMatch(/PAN/i);
  });

  it("rejects an Aadhaar-like number in free text", () => {
    expect(screenSensitiveText("aadhaar 1234 5678 9012")).toMatch(/Aadhaar/i);
    expect(screenSensitiveText("123456789012")).toMatch(/Aadhaar/i);
  });
});

describe("taxPrepCaseCreateSchema", () => {
  it("accepts a minimal valid input and normalizes empty optionals", () => {
    const r = taxPrepCaseCreateSchema.safeParse(
      base({ title: "", itr_type_selected: "", assigned_staff_id: "", reviewer_id: "", notes: "" }),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBeUndefined();
      expect(r.data.itr_type_selected).toBeUndefined();
      expect(r.data.assigned_staff_id).toBeUndefined();
      expect(r.data.notes).toBeUndefined();
    }
  });

  it("accepts optional fields when provided", () => {
    const r = taxPrepCaseCreateSchema.safeParse(
      base({ itr_type_selected: "ITR-2", assigned_staff_id: USER_ID, notes: "Simple salary case." }),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.itr_type_selected).toBe("ITR-2");
      expect(r.data.assigned_staff_id).toBe(USER_ID);
    }
  });

  it("rejects an unsupported assessment year", () => {
    const r = taxPrepCaseCreateSchema.safeParse(base({ assessment_year: "2025-26" }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/2026-27/);
  });

  it("defaults law to ITA_1961 and accepts ITA_2025", () => {
    const omitted = taxPrepCaseCreateSchema.safeParse(base());
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data.law).toBe("ITA_1961");
    const ty = taxPrepCaseCreateSchema.safeParse(base({ law: "ITA_2025" }));
    expect(ty.success).toBe(true);
    if (ty.success) expect(ty.data.law).toBe("ITA_2025");
  });

  it("rejects an unknown statutory world", () => {
    expect(taxPrepCaseCreateSchema.safeParse(base({ law: "ITA_1922" })).success).toBe(false);
  });

  it("offers exactly TAX_LAWS — a new Act cannot appear on one side only", () => {
    expect([...SUPPORTED_TAX_LAWS]).toEqual([...TAX_LAWS]);
  });

  it("rejects an unsupported financial year", () => {
    const r = taxPrepCaseCreateSchema.safeParse(base({ financial_year: "2024-25" }));
    expect(r.success).toBe(false);
  });

  it("rejects a missing / invalid client id", () => {
    expect(taxPrepCaseCreateSchema.safeParse(base({ client_id: "" })).success).toBe(false);
    expect(taxPrepCaseCreateSchema.safeParse(base({ client_id: "not-a-uuid" })).success).toBe(false);
  });

  it("rejects an invalid ITR type", () => {
    expect(taxPrepCaseCreateSchema.safeParse(base({ itr_type_selected: "ITR-9" })).success).toBe(false);
  });

  it("rejects notes containing portal credential text", () => {
    const r = taxPrepCaseCreateSchema.safeParse(base({ notes: "client password: hunter2" }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/credential/i);
  });
});
