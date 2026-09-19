import { describe, expect, it } from "vitest";
import { isTaxCaseLocked, sumField } from "@/lib/tax-desk/ledger";
import {
  capitalGainCreateSchema,
  deductionCreateSchema,
  incomeCreateSchema,
  ledgerRemoveSchema,
  taxPaidCreateSchema,
} from "@/lib/validation/tax-ledger";

const TAX_CASE_ID = "11111111-1111-1111-1111-111111111111";
const DOC_ID = "22222222-2222-2222-2222-222222222222";

describe("isTaxCaseLocked", () => {
  it("is locked only once finalized_at is set", () => {
    expect(isTaxCaseLocked(null)).toBe(false);
    expect(isTaxCaseLocked(undefined)).toBe(false);
    expect(isTaxCaseLocked("2026-07-09T00:00:00Z")).toBe(true);
  });
});

describe("sumField", () => {
  it("sums a numeric field, treating junk as 0", () => {
    const rows = [{ amount: 100 }, { amount: 50.5 }, { amount: null }, { amount: "x" as unknown as number }];
    expect(sumField(rows, (r) => r.amount)).toBe(150.5);
  });
  it("supports negative values (capital losses)", () => {
    expect(sumField([{ g: 100 }, { g: -30 }], (r) => r.g)).toBe(70);
  });
});

describe("income/tax-paid schemas", () => {
  it("accepts a valid income entry and coerces amount", () => {
    const r = incomeCreateSchema.safeParse({
      tax_case_id: TAX_CASE_ID,
      income_head: "salary",
      amount: "800000",
      source_type: "Form16",
      source_document_id: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.amount).toBe(800000);
      expect(r.data.source_document_id).toBeUndefined();
    }
  });

  it("rejects a negative amount", () => {
    const r = incomeCreateSchema.safeParse({
      tax_case_id: TAX_CASE_ID,
      income_head: "salary",
      amount: "-5",
      source_type: "manual",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown income head / source type", () => {
    expect(
      incomeCreateSchema.safeParse({ tax_case_id: TAX_CASE_ID, income_head: "lottery", amount: 1, source_type: "manual" }).success,
    ).toBe(false);
    expect(
      taxPaidCreateSchema.safeParse({ tax_case_id: TAX_CASE_ID, tax_paid_type: "salary_tds", amount: 1, source_type: "telepathy" }).success,
    ).toBe(false);
  });
});

describe("deduction schema", () => {
  it("carries section_code and proof document", () => {
    const r = deductionCreateSchema.safeParse({
      tax_case_id: TAX_CASE_ID,
      deduction_type: "80C",
      section_code: "80C",
      amount: "150000",
      source_type: "manual",
      proof_case_document_id: DOC_ID,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.proof_case_document_id).toBe(DOC_ID);
  });
});

describe("capital gain schema", () => {
  it("allows a negative taxable_gain (loss) but not negative sale/cost", () => {
    const ok = capitalGainCreateSchema.safeParse({
      tax_case_id: TAX_CASE_ID,
      gain_type: "stcg_111a",
      sale_value: "100000",
      cost: "130000",
      expenses: "0",
      exemption_claimed: "0",
      taxable_gain: "-30000",
      source_type: "broker_report",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.taxable_gain).toBe(-30000);

    const bad = capitalGainCreateSchema.safeParse({
      tax_case_id: TAX_CASE_ID,
      gain_type: "stcg_111a",
      sale_value: "-1",
      cost: "0",
      expenses: "0",
      exemption_claimed: "0",
      taxable_gain: "0",
      source_type: "manual",
    });
    expect(bad.success).toBe(false);
  });
});

describe("notes credential / PAN / Aadhaar screening", () => {
  const withNotes = (notes: string) =>
    incomeCreateSchema.safeParse({
      tax_case_id: TAX_CASE_ID,
      income_head: "salary",
      amount: 1,
      source_type: "manual",
      notes,
    });

  it("accepts clean notes", () => {
    expect(withNotes("Two Form 16s, FD interest at HDFC.").success).toBe(true);
  });
  it("rejects portal credential / OTP text", () => {
    expect(withNotes("portal password abc").success).toBe(false);
    expect(withNotes("client shared the OTP").success).toBe(false);
  });
  it("rejects a PAN in notes", () => {
    expect(withNotes("PAN ABCDE1234F").success).toBe(false);
  });
  it("rejects an Aadhaar-like number in notes", () => {
    expect(withNotes("aadhaar 1234 5678 9012").success).toBe(false);
  });
});

describe("ledgerRemoveSchema", () => {
  it("requires a uuid id; reason is optional", () => {
    expect(ledgerRemoveSchema.safeParse({ id: DOC_ID }).success).toBe(true);
    expect(ledgerRemoveSchema.safeParse({ id: DOC_ID, reason: "duplicate entry" }).success).toBe(true);
    expect(ledgerRemoveSchema.safeParse({ id: "nope" }).success).toBe(false);
  });
});
