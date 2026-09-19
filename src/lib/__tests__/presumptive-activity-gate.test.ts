import { describe, expect, it } from "vitest";
import {
  buildEngineInput,
  buildPresumptiveActivityEligibilitySnapshot,
  gatePresumptiveActivity,
  verifyStoredPresumptiveActivityEligibility,
  type CaseMeta,
  type LedgerRows,
} from "@/lib/tax-desk/computation-adapter";
import { PRESUMPTIVE_ACTIVITY_TYPES } from "@/lib/tax-desk/ledger";
import { PRESUMPTIVE_ACTIVITY_ELIGIBILITY } from "@/lib/tax-engine/ay-2026-27";

/**
 * K4-13 (decision D217) — the presumptive eligible-ACTIVITY gate.
 *
 * This is the session's load-bearing behaviour, so it is asserted directly
 * rather than inferred from the adapter suite's fixture updates. Before K4-13
 * the gap FAILED OPEN: a commission agent's turnover entered under Section
 * 44AD computed a 6%/8% deemed profit and the case could be approved and
 * finalized, because no field recorded the activity. Every test here fails if
 * that behaviour returns.
 */

const META: CaseMeta = {
  assessmentYear: "2026-27",
  financialYear: "2025-26",
  selectedItrType: null,
  finalized: false,
};

function rows(partial: Partial<LedgerRows>): LedgerRows {
  return { income: [], taxPaid: [], deductions: [], capitalGains: [], ...partial };
}

let n = 0;
const rid = () => `k413_row_${++n}`;

/** Two 44AD receipt-mode rows, both declaring `activity` (or nothing). */
function ad44(activity?: string | null) {
  return rows({
    income: [
      {
        id: rid(),
        income_head: "presumptive_business_44ad_digital",
        amount: "1000000",
        source_type: "manual",
        presumptive_activity_type: activity,
      },
      {
        id: rid(),
        income_head: "presumptive_business_44ad_cash",
        amount: "200000",
        source_type: "manual",
        presumptive_activity_type: activity,
      },
    ],
  });
}

/** One 44ADA gross-receipts row declaring `activity` (or nothing). */
function ada44(activity?: string | null) {
  return rows({
    income: [
      {
        id: rid(),
        income_head: "presumptive_professional_44ada",
        amount: "1200000",
        source_type: "manual",
        presumptive_activity_type: activity,
      },
    ],
  });
}

describe("vocabulary parity — ledger vs engine (no drift)", () => {
  // The ledger/DB vocabulary and the engine's statutory eligibility map are
  // two parallel lists (the engine may not import from tax-desk, and tax-desk
  // may not become a second authority on eligibility). Pinned in BOTH
  // directions so a member added to either side without the other fails here
  // rather than silently becoming an activity the gate cannot classify.
  it("the two vocabularies contain exactly the same members", () => {
    const ledger = [...PRESUMPTIVE_ACTIVITY_TYPES].sort();
    const engine = Object.keys(PRESUMPTIVE_ACTIVITY_ELIGIBILITY).sort();
    expect(ledger).toEqual(engine);
  });

  it("every member declares an authority naming a real provision", () => {
    for (const [key, rule] of Object.entries(PRESUMPTIVE_ACTIVITY_ELIGIBILITY)) {
      expect(rule.authority, key).toMatch(/Section 44A[DE]|Explanation to Section 44AD/);
      expect(rule.label.length, key).toBeGreaterThan(0);
    }
  });

  // The statutory mirror image, asserted as data rather than left as a claim
  // in a comment: Section 44AD(6)(i) EXCLUDES a Section 44AA(1) profession
  // and Section 44ADA(1) REQUIRES one, so exactly one member is eligible for
  // each scheme, and they are different members.
  it("exactly one member is 44AD-eligible and exactly one — a different one — is 44ADA-eligible", () => {
    const eligible44AD = Object.entries(PRESUMPTIVE_ACTIVITY_ELIGIBILITY)
      .filter(([, r]) => r.eligibleFor44AD)
      .map(([k]) => k);
    const eligible44ADA = Object.entries(PRESUMPTIVE_ACTIVITY_ELIGIBILITY)
      .filter(([, r]) => r.eligibleFor44ADA)
      .map(([k]) => k);
    expect(eligible44AD).toEqual(["other_business"]);
    expect(eligible44ADA).toEqual(["specified_profession_44aa_1"]);
    expect(eligible44AD).not.toEqual(eligible44ADA);
  });

  it("has NO member meaning unknown/unspecified — absence is not a vocabulary member", () => {
    // A default or an "unknown" member is exactly the presumption of
    // eligibility this vocabulary exists to remove.
    for (const member of PRESUMPTIVE_ACTIVITY_TYPES) {
      expect(member).not.toMatch(/unknown|unspecified|not_declared|none|other$/);
    }
  });
});

describe("gatePresumptiveActivity — the pure gate", () => {
  it("refuses an empty declaration for either scheme", () => {
    for (const scheme of ["44AD", "44ADA"] as const) {
      const gate = gatePresumptiveActivity(scheme, [{ presumptive_activity_type: null }]);
      expect(gate.ok).toBe(false);
      if (!gate.ok) expect(gate.code).toBe(`PRESUMPTIVE_${scheme}_ACTIVITY_TYPE_UNDECLARED`);
    }
  });

  it("names each ineligible activity ONCE even when several rows repeat it", () => {
    const gate = gatePresumptiveActivity("44AD", [
      { presumptive_activity_type: "commission_or_brokerage" },
      { presumptive_activity_type: "commission_or_brokerage" },
      { presumptive_activity_type: "commission_or_brokerage" },
    ]);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      const occurrences = gate.message.split("commission or brokerage").length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "treats the inherited object key %s as undeclared, not as a declared activity",
    (key) => {
      // `key in obj` is TRUE for every one of these on any plain object, so a
      // membership test written with `in` would admit them as declared. The
      // DB check constraint and the Zod enum both prevent such a value being
      // stored, but this gate is the fail-closed authority and must hold on
      // its own.
      const gate = gatePresumptiveActivity("44AD", [{ presumptive_activity_type: key }]);
      expect(gate.ok).toBe(false);
      if (!gate.ok) {
        expect(gate.code).toBe("PRESUMPTIVE_44AD_ACTIVITY_TYPE_UNDECLARED");
        // ...and the message must not be built from a garbled lookup.
        expect(gate.message).not.toContain("undefined");
      }
    },
  );

  it("passes an empty row set (nothing to gate)", () => {
    expect(gatePresumptiveActivity("44AD", []).ok).toBe(true);
    expect(gatePresumptiveActivity("44ADA", []).ok).toBe(true);
  });
});

describe("buildEngineInput — the gate in the adapter", () => {
  // --- THE POINT OF THE SESSION: absence refuses, it does not presume. ---

  it("FAILS CLOSED on an undeclared 44AD activity — refuses rather than presuming eligible", () => {
    const r = buildEngineInput(ad44(undefined), META);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.every((w) => w.code === "PRESUMPTIVE_44AD_ACTIVITY_TYPE_UNDECLARED")).toBe(true);
    // The deemed profit is NOT computed — this is the legally wrong number
    // that used to be produced for an ineligible activity.
    expect(r.input.income).toEqual([]);
    expect(r.excludedLedgerIds).toHaveLength(2);
    expect(r.complete).toBe(false);
    // AUDIT-03-F9 / D86: excluded, but the declared business income is NOT
    // retracted — otherwise validate-case.ts's Section 207(2) disclosure would
    // state in writing that this taxpayer has no business income.
    expect(r.input.hasBusinessOrProfessionalIncome).toBe(true);
  });

  it("FAILS CLOSED on an undeclared 44ADA activity", () => {
    const r = buildEngineInput(ada44(null), META);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.code).toBe("PRESUMPTIVE_44ADA_ACTIVITY_TYPE_UNDECLARED");
    expect(r.input.income).toEqual([]);
    expect(r.complete).toBe(false);
    expect(r.input.hasBusinessOrProfessionalIncome).toBe(true);
  });

  it("treats an UNRECOGNISED activity string as undeclared, not as eligible", () => {
    // A value outside the closed vocabulary — a stale enum member, a
    // hand-written DB row, a renamed constant — must not fall through to
    // eligible.
    const r = buildEngineInput(ad44("wholesale_trading"), META);
    expect(r.warnings.every((w) => w.code === "PRESUMPTIVE_44AD_ACTIVITY_TYPE_UNDECLARED")).toBe(true);
    expect(r.input.income).toEqual([]);
    expect(r.complete).toBe(false);
  });

  it("FAILS CLOSED when only SOME rows declare an activity (all-or-nothing)", () => {
    const r = buildEngineInput(
      rows({
        income: [
          {
            id: rid(),
            income_head: "presumptive_business_44ad_digital",
            amount: "1000000",
            source_type: "manual",
            presumptive_activity_type: "other_business",
          },
          {
            id: rid(),
            income_head: "presumptive_business_44ad_cash",
            amount: "200000",
            source_type: "manual",
          },
        ],
      }),
      META,
    );
    // BOTH rows are excluded, including the properly declared one — never a
    // deemed profit over a subset of turnover nobody declared, and never an
    // ambiguous denominator for the aggregate ceiling test.
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.every((w) => w.code === "PRESUMPTIVE_44AD_ACTIVITY_TYPE_UNDECLARED")).toBe(true);
    expect(r.input.income).toEqual([]);
    expect(r.excludedLedgerIds).toHaveLength(2);
  });

  // --- Section 44AD(6) and the Explanation's "eligible business". ---

  it.each([
    "specified_profession_44aa_1",
    "commission_or_brokerage",
    "agency_business",
    "goods_carriage_44ae",
  ])("excludes %s from Section 44AD entirely", (activity) => {
    const r = buildEngineInput(ad44(activity), META);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.every((w) => w.code === "PRESUMPTIVE_44AD_INELIGIBLE_ACTIVITY")).toBe(true);
    expect(r.input.income).toEqual([]);
    expect(r.excludedLedgerIds).toHaveLength(2);
    expect(r.complete).toBe(false);
    expect(r.input.hasBusinessOrProfessionalIncome).toBe(true);
  });

  it("computes Section 44AD for an eligible other_business", () => {
    const r = buildEngineInput(ad44("other_business"), META);
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.input.income).toHaveLength(2);
    expect(r.summary.presumptiveBusinessTurnover).toBe(1200000);
  });

  // --- Section 44ADA(1): the MIRROR IMAGE of 44AD(6)(i). ---

  it.each(["commission_or_brokerage", "agency_business", "goods_carriage_44ae", "other_business"])(
    "excludes %s from Section 44ADA — 44ADA(1) reaches only a Section 44AA(1) profession",
    (activity) => {
      const r = buildEngineInput(ada44(activity), META);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]!.code).toBe("PRESUMPTIVE_44ADA_INELIGIBLE_ACTIVITY");
      expect(r.input.income).toEqual([]);
      expect(r.complete).toBe(false);
    },
  );

  it("computes Section 44ADA for a Section 44AA(1) specified profession", () => {
    const r = buildEngineInput(ada44("specified_profession_44aa_1"), META);
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.input.income).toHaveLength(1);
  });

  it("is a true mirror image end-to-end: profession is 44ADA-only, other_business is 44AD-only", () => {
    expect(buildEngineInput(ad44("specified_profession_44aa_1"), META).complete).toBe(false);
    expect(buildEngineInput(ada44("specified_profession_44aa_1"), META).complete).toBe(true);
    expect(buildEngineInput(ad44("other_business"), META).complete).toBe(true);
    expect(buildEngineInput(ada44("other_business"), META).complete).toBe(false);
  });

  // --- Why the field is PER ROW and not per case (decision D218). ---

  it("computes a 44ADA profession and a 44AD business on the SAME case (D218)", () => {
    // The case a single case-level type field could not represent: a doctor
    // with a clinic AND a shop. Both heads compute, each gated on its own
    // row's declared activity — the whole justification for per-row.
    const r = buildEngineInput(
      rows({
        income: [
          {
            id: rid(),
            income_head: "presumptive_professional_44ada",
            amount: "1200000",
            source_type: "manual",
            presumptive_activity_type: "specified_profession_44aa_1",
          },
          {
            id: rid(),
            income_head: "presumptive_business_44ad_digital",
            amount: "800000",
            source_type: "manual",
            presumptive_activity_type: "other_business",
          },
        ],
      }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.input.income).toHaveLength(2);
    expect(r.summary.presumptiveProfessionalIncome).toBe(1200000);
    expect(r.summary.presumptiveBusinessTurnover).toBe(800000);
  });

  it("gates the two schemes INDEPENDENTLY — an ineligible 44AD row does not block an eligible 44ADA row", () => {
    // The shopkeeper-with-agency-commission shape: a case-level field would
    // have to block both heads or answer one of them wrongly.
    const r = buildEngineInput(
      rows({
        income: [
          {
            id: rid(),
            income_head: "presumptive_professional_44ada",
            amount: "1200000",
            source_type: "manual",
            presumptive_activity_type: "specified_profession_44aa_1",
          },
          {
            id: rid(),
            income_head: "presumptive_business_44ad_digital",
            amount: "800000",
            source_type: "manual",
            presumptive_activity_type: "commission_or_brokerage",
          },
        ],
      }),
      META,
    );
    // The 44ADA row still computes; only the 44AD scheme is refused.
    expect(r.input.income).toHaveLength(1);
    expect(r.input.income[0]!.category).toBe("presumptive_professional_44ada");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.code).toBe("PRESUMPTIVE_44AD_INELIGIBLE_ACTIVITY");
    // Still incomplete — the excluded row holds the case back from snapshot,
    // approval and finalization (Shape A, D88).
    expect(r.complete).toBe(false);
  });

  // --- Ordering against the pre-existing ceiling gate. ---

  it("reports the ACTIVITY failure, not the ceiling, when a case fails both", () => {
    // ₹3.1cr of commission turnover: over every ceiling AND an excluded
    // activity. Reporting the ceiling would tell the preparer to reduce
    // turnover when the real defect is that the scheme does not apply at all.
    const r = buildEngineInput(
      rows({
        income: [
          {
            id: rid(),
            income_head: "presumptive_business_44ad_digital",
            amount: "31000000",
            source_type: "manual",
            presumptive_activity_type: "commission_or_brokerage",
          },
        ],
      }),
      META,
    );
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.code).toBe("PRESUMPTIVE_44AD_INELIGIBLE_ACTIVITY");
  });

  // --- The gate must not reach anything it does not own. ---

  it("leaves non-presumptive heads untouched", () => {
    const r = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "salary", amount: "900000", source_type: "manual" }] }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.input.income).toHaveLength(1);
  });

  it("ignores an activity declared on a NON-presumptive head", () => {
    // The column is meaningful only on the three presumptive heads, so a stray
    // ineligible value on a salary row must change nothing.
    const r = buildEngineInput(
      rows({
        income: [
          {
            id: rid(),
            income_head: "salary",
            amount: "900000",
            source_type: "manual",
            presumptive_activity_type: "commission_or_brokerage",
          },
        ],
      }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it("does not fire on a ZERO-amount presumptive row (no live turnover to gate)", () => {
    // Zero-amount rows are dropped before the gate; an undeclared activity on
    // one must not manufacture a blocker for a case with no presumptive
    // income at all.
    const r = buildEngineInput(
      rows({
        income: [
          {
            id: rid(),
            income_head: "presumptive_business_44ad_digital",
            amount: "0",
            source_type: "manual",
          },
        ],
      }),
      META,
    );
    expect(r.warnings).toEqual([]);
    expect(r.input.income).toEqual([]);
    expect(r.complete).toBe(true);
  });
});

describe("TAX-SAFE-03 immutable activity contract", () => {
  it("records the exact eligible 44AD facts and the adapter's verdict", () => {
    const source = ad44("other_business");
    const adapter = buildEngineInput(source, META);
    expect(adapter.presumptiveActivityEligibility).toEqual(
      buildPresumptiveActivityEligibilitySnapshot(source.income),
    );
    expect(adapter.presumptiveActivityEligibility.eligible).toBe(true);
    expect(adapter.presumptiveActivityEligibility.rows).toHaveLength(2);
    expect(
      verifyStoredPresumptiveActivityEligibility(
        adapter.input.income,
        adapter.presumptiveActivityEligibility,
      ),
    ).toEqual({ ok: true });
  });

  it("records the eligible 44ADA activity and its exact banking-channel fact", () => {
    const source = ada44("specified_profession_44aa_1");
    source.income[0]!.receipts_via_banking_channels = true;
    const adapter = buildEngineInput(source, META);
    expect(adapter.presumptiveActivityEligibility).toMatchObject({
      eligible: true,
      rows: [
        {
          activityType: "specified_profession_44aa_1",
          bankingChannelsConfirmed: true,
        },
      ],
    });
    expect(
      verifyStoredPresumptiveActivityEligibility(
        adapter.input.income,
        adapter.presumptiveActivityEligibility,
      ).ok,
    ).toBe(true);
  });

  it.each([
    ["44AD blank", ad44(null)],
    ["44ADA blank", ada44(null)],
    ["44AD profession", ad44("specified_profession_44aa_1")],
    ["44AD commission", ad44("commission_or_brokerage")],
    ["44AD agency", ad44("agency_business")],
    ["44AD goods carriage", ad44("goods_carriage_44ae")],
    ["44ADA commission", ada44("commission_or_brokerage")],
    ["44ADA agency", ada44("agency_business")],
    ["44ADA goods carriage", ada44("goods_carriage_44ae")],
    ["44ADA other business", ada44("other_business")],
  ])("stores an ineligible verdict for %s", (_label, source) => {
    expect(buildEngineInput(source, META).presumptiveActivityEligibility.eligible).toBe(false);
  });

  it("fails closed for a legacy presumptive snapshot with no contract", () => {
    const adapter = buildEngineInput(ad44("other_business"), META);
    expect(verifyStoredPresumptiveActivityEligibility(adapter.input.income, undefined).ok).toBe(false);
  });

  it.each([
    ["string verdict", { eligible: "true" }],
    ["false verdict", { eligible: false }],
    ["missing rows", { eligible: true, rows: undefined }],
  ])("fails closed for a malformed %s", (_label, change) => {
    const adapter = buildEngineInput(ad44("other_business"), META);
    const malformed = { ...adapter.presumptiveActivityEligibility, ...change };
    expect(verifyStoredPresumptiveActivityEligibility(adapter.input.income, malformed).ok).toBe(false);
  });

  it("fails closed when provenance does not match the snapshot engine row", () => {
    const adapter = buildEngineInput(ad44("other_business"), META);
    const contract = adapter.presumptiveActivityEligibility;
    const changed = {
      ...contract,
      rows: contract.rows.map((row, index) =>
        index === 0 ? { ...row, amount: row.amount + 1 } : row,
      ),
    };
    expect(verifyStoredPresumptiveActivityEligibility(adapter.input.income, changed).ok).toBe(false);
  });

  it("does not retroactively require the contract for a non-presumptive legacy snapshot", () => {
    const adapter = buildEngineInput(
      rows({ income: [{ id: rid(), income_head: "salary", amount: 900000, source_type: "manual" }] }),
      META,
    );
    expect(verifyStoredPresumptiveActivityEligibility(adapter.input.income, undefined)).toEqual({ ok: true });
  });
});
