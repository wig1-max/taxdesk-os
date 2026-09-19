import { describe, expect, it } from "vitest";
import {
  compareRegimes,
  computeTax,
  recommendItrForm,
  type TaxEngineInput,
} from "@/lib/tax-engine/ay-2026-27";
import {
  buildStoredComputationReplayInput,
  COMPUTATION_REPLAY_CONTRACT,
} from "../computation-replay-input";

function fullInput(): TaxEngineInput {
  return {
    assessmentYear: "2026-27",
    financialYear: "2025-26",
    taxpayer: { residentStatus: "resident", ageCategory: "senior" },
    selectedItrType: "ITR-3",
    selectedRegime: "old",
    clientApprovalStatus: "pending",
    filingStatus: "in_preparation",
    eVerificationStatus: "not_applicable",
    finalized: false,
    editRequested: false,
    requiredDocuments: [],
    income: [
      { id: "salary", amount: 900_000, sourceType: "Form16", category: "salary", notes: "remove me" },
    ],
    taxPaid: [
      { id: "tds", amount: 75_000, sourceType: "Form16", category: "salary_tds", notes: "remove me" },
    ],
    deductions: [],
    capitalGains: [],
    housePropertyEntries: [],
    businessBooksEntries: [
      {
        id: "books_profit",
        amount: 300_000,
        revenue: 500_000,
        expenses: 200_000,
        isProfession: false,
        adjustments: "none_s30_43d",
        activityClassification: "ordinary_business_or_profession",
        sourceType: "manual",
        notes: "remove me",
      },
      {
        id: "books_loss",
        amount: -100_000,
        revenue: 100_000,
        expenses: 200_000,
        isProfession: false,
        adjustments: "none_s30_43d",
        activityClassification: "ordinary_business_or_profession",
        sourceType: "manual",
      },
    ],
    broughtForwardLosses: [],
    sourceRecordIds: ["salary", "tds", "books_profit", "books_loss"],
    hasForeignAssets: false,
    hasBusinessOrProfessionalIncome: true,
    notes: "PAN-like free text must not be stored",
    freeTextFields: ["credential-like free text must not be stored"],
  };
}

describe("computation snapshot replay input", () => {
  it("retains all computation heads while removing top-level and entry notes", () => {
    const stored = buildStoredComputationReplayInput(fullInput());

    expect(stored.businessBooksEntries).toHaveLength(2);
    expect(stored.housePropertyEntries).toEqual([]);
    expect(stored.broughtForwardLosses).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain("remove me");
    expect(stored).not.toHaveProperty("notes");
    expect(stored).not.toHaveProperty("freeTextFields");
    expect(COMPUTATION_REPLAY_CONTRACT.validationReplayComplete).toBe(false);
  });

  it("reproduces every stored output from the notes-free input", () => {
    const original = fullInput();
    const replay = buildStoredComputationReplayInput(original) as TaxEngineInput;

    expect(computeTax(replay)).toEqual(computeTax(original));
    expect(compareRegimes(replay)).toEqual(compareRegimes(original));
    expect(recommendItrForm(replay)).toEqual(recommendItrForm(original));
  });
});
