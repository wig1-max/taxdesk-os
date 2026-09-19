/**
 * `K4-23` review finding F3 (P1) — a declared capital loss must refuse a
 * house-sale row even when the 111A/112A set-off window is satisfied.
 *
 * WHY THIS FILE EXISTS. The adapter's `lossUnsupported` decision aggregates
 * `SUPPORTED_GAINS`, which is `stcg_111a` and `ltcg_112a` only. A house-sale
 * gain is invisible to every test in it. So a case carrying a 112A gain, a
 * small LTCL that sits comfortably inside the supported window, AND a
 * house-sale gain produced `lossUnsupported === false` — the loss was quietly
 * fixed against the 112A bucket and the house-sale row was admitted beside it.
 *
 * That is the mixed set-off `D337` item 13 and the `capital_gains_house_sale`
 * capability reason both say must refuse, and it is not a labelling problem: a
 * long-term house-sale gain is a lawful s.70 destination, and a s.112 gain is
 * taxed through a PER-PROPERTY comparator rather than at one flat rate, so
 * allocating the loss there instead can change the tax. The two allocations
 * are not equivalent, and nothing in the engine chose between them.
 */

import { describe, expect, it } from "vitest";
import {
  buildEngineInput,
  type BroughtForwardLossLedgerRow,
  type CaseMeta,
  type LedgerRows,
} from "../computation-adapter";

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: "ITR-2",
  finalized: false,
};

const EMPTY: LedgerRows = { income: [], taxPaid: [], deductions: [], capitalGains: [] };

/** A long-term house sale with every declaration K4-23 requires. */
const HOUSE_SALE_LTCG = {
  id: "cg_house",
  gain_type: "house_sale",
  sale_value: 80_00_000,
  cost: 20_00_000,
  expenses: 0,
  exemption_claimed: 0,
  taxable_gain: 60_00_000,
  source_type: "manual",
  transfer_date: "2025-12-01",
  acquisition_date: "2002-06-01",
  stamp_duty_value: 80_00_000,
  asset_kind: "building",
  acquisition_mode: "purchase",
  cost_of_improvement: 0,
  house_sale_declarations: [
    "not_agricultural_land",
    "not_depreciable_asset",
    "interest_not_in_cost",
    "agreement_and_registration_same_date",
    "amounts_are_assessee_share",
    "stamp_duty_value_accepted",
  ],
} as const;

function build(capitalGains: unknown[], broughtForwardLosses: unknown[] = []) {
  return buildEngineInput(
    { ...EMPTY, capitalGains, broughtForwardLosses } as LedgerRows,
    META,
  );
}

/** An ADMITTED brought-forward loss — verified filing, usable provenance. */
function bfRow(over: Partial<BroughtForwardLossLedgerRow> = {}): BroughtForwardLossLedgerRow {
  return {
    id: "bf_1",
    originating_assessment_year: "2022-23",
    loss_type: "ltcl",
    amount: "100000",
    filing_eligibility: "verified_timely",
    loss_provenance: "prior_finalized_case_in_system",
    elected_set_off_target: null,
    source_type: "prefilled_json",
    ...over,
  };
}

const GAIN_112A = {
  id: "cg_112a_gain",
  gain_type: "ltcg_112a",
  sale_value: 10_00_000,
  cost: 0,
  expenses: 0,
  exemption_claimed: 0,
  taxable_gain: 10_00_000,
  source_type: "manual",
} as const;

function houseSaleWarning(adapter: ReturnType<typeof build>) {
  return adapter.warnings.find((w) => w.code === "HOUSE_SALE_UNSUPPORTED") ?? null;
}

describe("K4-23 F3 — a declared capital loss refuses a house-sale row", () => {
  it("admits the house sale when NO capital loss is declared", () => {
    // The control. Without it, a test that always refuses would pass while
    // asserting nothing about the loss at all.
    const adapter = build([HOUSE_SALE_LTCG]);
    expect(houseSaleWarning(adapter)).toBeNull();
    expect(adapter.input.capitalGains.some((g) => g.category === "house_sale")).toBe(true);
  });

  it("REFUSES it for the exact case the review named — a loss inside the 112A window", () => {
    // 112A gain ₹10,00,000, LTCL ₹1,00,000. The window is
    // 10,00,000 − 1,25,000 = 8,75,000, and 1,00,000 is far inside it, so the
    // pre-existing 111A/112A gate is satisfied and `lossUnsupported` is false.
    // Before F3 the house-sale row was admitted anyway.
    const adapter = build([
      {
        id: "cg_112a_gain",
        gain_type: "ltcg_112a",
        sale_value: 10_00_000,
        cost: 0,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: 10_00_000,
        source_type: "manual",
      },
      {
        id: "cg_112a_loss",
        gain_type: "ltcg_112a",
        sale_value: 0,
        cost: 1_00_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: -1_00_000,
        source_type: "manual",
      },
      HOUSE_SALE_LTCG,
    ]);

    const warning = houseSaleWarning(adapter);
    expect(warning, "the house-sale row must be refused").not.toBeNull();
    expect(warning?.message).toContain("capital loss");
    expect(warning?.message).toContain("per-property comparator");
    // Excluded from the engine input entirely, not merely flagged.
    expect(adapter.input.capitalGains.some((g) => g.category === "house_sale")).toBe(false);
    expect(adapter.excludedLedgerIds).toContain("cg_house");
    expect(adapter.complete).toBe(false);
  });

  it("REFUSES it for a short-term loss inside its own window too", () => {
    const adapter = build([
      {
        id: "cg_111a_gain",
        gain_type: "stcg_111a",
        sale_value: 5_00_000,
        cost: 0,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: 5_00_000,
        source_type: "manual",
      },
      {
        id: "cg_111a_loss",
        gain_type: "stcg_111a",
        sale_value: 0,
        cost: 50_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: -50_000,
        source_type: "manual",
      },
      HOUSE_SALE_LTCG,
    ]);
    expect(houseSaleWarning(adapter)).not.toBeNull();
    expect(adapter.input.capitalGains.some((g) => g.category === "house_sale")).toBe(false);
  });

  it("refuses a SHORT-term house sale on the same footing", () => {
    // The interaction is about the loss having a lawful alternative
    // destination, which is true of a short-term house sale too — that gain
    // is slab income and absorbing a loss there changes the tax as well.
    const shortTerm = {
      ...HOUSE_SALE_LTCG,
      id: "cg_house_st",
      acquisition_date: "2025-01-15",
      taxable_gain: 60_00_000,
    };
    const adapter = build([
      {
        id: "cg_112a_gain",
        gain_type: "ltcg_112a",
        sale_value: 10_00_000,
        cost: 0,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: 10_00_000,
        source_type: "manual",
      },
      {
        id: "cg_112a_loss",
        gain_type: "ltcg_112a",
        sale_value: 0,
        cost: 1_00_000,
        expenses: 0,
        exemption_claimed: 0,
        taxable_gain: -1_00_000,
        source_type: "manual",
      },
      shortTerm,
    ]);
    expect(houseSaleWarning(adapter)).not.toBeNull();
    expect(adapter.input.capitalGains.some((g) => g.category === "house_sale")).toBe(false);
  });
});

describe("K4-23 F5 — an ADMITTED brought-forward loss also refuses a house-sale row", () => {
  it("refuses the exact case the review named: BF loss + 112A gain + house LTCG", () => {
    // No CURRENT-YEAR negative row, so `lossDeclared` is false, and the
    // brought-forward allocation across 111A/112A is unambiguous, so
    // `bfRefusalCode` is null too. Before F5 this computed.
    const adapter = build([GAIN_112A, HOUSE_SALE_LTCG], [bfRow()]);
    const warning = houseSaleWarning(adapter);
    expect(warning, "the house-sale row must be refused").not.toBeNull();
    expect(adapter.input.capitalGains.some((g) => g.category === "house_sale")).toBe(false);
    expect(adapter.excludedLedgerIds).toContain("cg_house");
    expect(adapter.complete).toBe(false);
  });

  it("CONTROL: the same case with no brought-forward row computes", () => {
    // Without this the test above would pass even if the gate refused
    // everything unconditionally.
    const adapter = build([GAIN_112A, HOUSE_SALE_LTCG], []);
    expect(houseSaleWarning(adapter)).toBeNull();
    expect(adapter.input.capitalGains.some((g) => g.category === "house_sale")).toBe(true);
  });

  it("a REJECTED brought-forward record does not refuse the house sale", () => {
    // `bfAdmitted` is the deliberate input, not `bfRows`: a record that
    // cannot be carried forward at all raises no allocation ambiguity for
    // this head. Its own refusal path is `bfRefusalCode`, unchanged.
    const adapter = build([HOUSE_SALE_LTCG], [bfRow({ filing_eligibility: "not_eligible" })]);
    expect(houseSaleWarning(adapter)).toBeNull();
    expect(adapter.input.capitalGains.some((g) => g.category === "house_sale")).toBe(true);
  });
});
