import { describe, expect, it } from "vitest";
import {
  buildEngineInput,
  type CaseMeta,
  type LedgerRows,
} from "@/lib/tax-desk/computation-adapter";
import {
  classifyLedgerSupport,
  describeLedgerSupport,
  ledgerSupportFromAdapter,
} from "@/lib/tax-desk/ledger-support";
import { sourceCoverage } from "@/lib/tax-desk/ledger-source";

/**
 * K.2.8.7 — engine-derived support classification. Proves the classifier reads
 * the SAME authority as Computation (buildEngineInput warnings), keeps support
 * strictly separate from source coverage, and stays stable across surfaces.
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
const rid = () => `row_${++n}`;

describe("classifyLedgerSupport — support vs source coverage are distinct axes", () => {
  it("a SOURCE-LINKED but engine-unsupported entry stays unsupported", () => {
    const hp = rid();
    const r = rows({
      income: [
        // house_property is not modelled by the engine → unsupported, even though
        // it is fully source-linked to a document.
        { id: hp, income_head: "house_property", amount: "120000", source_type: "manual", source_document_id: "doc-1" },
      ],
    });
    const support = classifyLedgerSupport(r, META);
    expect(support.unsupported).toBe(1);
    expect(support.byCategory.income.unsupported).toBe(1);
    expect(support.unsupportedIds).toEqual([hp]);
    // Source coverage sees it as LINKED — a different axis entirely.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(sourceCoverage(r.income as any).linked).toBe(1);
  });

  it("a NO-SOURCE but engine-supported entry stays supported", () => {
    const sal = rid();
    const r = rows({
      income: [
        // manual salary, no document mapped → supported by the engine.
        { id: sal, income_head: "salary", amount: "500000", source_type: "manual" },
      ],
    });
    const support = classifyLedgerSupport(r, META);
    expect(support.unsupported).toBe(0);
    expect(support.supported).toBe(1);
    // Source coverage sees it as UNLINKED — again, a different axis.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(sourceCoverage(r.income as any).unlinked).toBe(1);
  });
});

describe("classifyLedgerSupport — matches Computation classification", () => {
  const mixed = rows({
    income: [
      { id: rid(), income_head: "salary", amount: "800000", source_type: "Form16" },
      { id: rid(), income_head: "house_property", amount: "120000", source_type: "manual" },
      { id: rid(), income_head: "business_income", amount: "300000", source_type: "manual" },
    ],
    capitalGains: [
      { id: rid(), gain_type: "other_ltcg", sale_value: "0", cost: "0", expenses: "0", exemption_claimed: "0", taxable_gain: "70000", source_type: "manual" },
    ],
  });

  it("total unsupported equals the adapter's unsupportedEntryCount", () => {
    const adapter = buildEngineInput(mixed, META);
    const support = classifyLedgerSupport(mixed, META);
    expect(support.unsupported).toBe(adapter.unsupportedEntryCount);
    expect(support.supported).toBe(adapter.mappedEntryCount);
  });

  it("splits unsupported entries into the correct categories", () => {
    const support = classifyLedgerSupport(mixed, META);
    expect(support.byCategory.income.unsupported).toBe(2); // house_property + business_income
    expect(support.byCategory.capitalGains.unsupported).toBe(1); // other_ltcg
    expect(support.byCategory.taxPaid.unsupported).toBe(0);
    expect(support.byCategory.deductions.unsupported).toBe(0);
  });

  it("supported/unsupported counts are stable across Ledgers and Computation surfaces", () => {
    const adapter = buildEngineInput(mixed, META);
    const fromRows = classifyLedgerSupport(mixed, META);
    const fromAdapter = ledgerSupportFromAdapter(adapter);
    expect(fromRows.unsupported).toBe(fromAdapter.unsupported);
    expect(fromRows.supported).toBe(fromAdapter.supported);
    expect(fromRows.byCategory).toEqual(fromAdapter.byCategory);
  });
});

describe("classifyLedgerSupport — exclusions and empty state", () => {
  it("excludes archived / soft-removed rows from the count", () => {
    const live = rid();
    const archived = rid();
    const r = rows({
      income: [
        { id: live, income_head: "house_property", amount: "50000", source_type: "manual" },
        // Same unsupported head, but soft-removed → must NOT inflate the count.
        { id: archived, income_head: "house_property", amount: "90000", source_type: "manual", deleted_at: "2026-07-01T00:00:00Z" } as never,
      ],
    });
    const support = classifyLedgerSupport(r, META);
    expect(support.unsupported).toBe(1);
    expect(support.unsupportedIds).toEqual([live]);
  });

  it("zero unsupported entries renders the supported state", () => {
    const r = rows({
      income: [{ id: rid(), income_head: "salary", amount: "800000", source_type: "Form16" }],
      taxPaid: [{ id: rid(), tax_paid_type: "salary_tds", amount: "60000", source_type: "Form16" }],
    });
    const support = classifyLedgerSupport(r, META);
    expect(support.unsupported).toBe(0);
    expect(describeLedgerSupport(support.unsupported)).toBe(
      "All entries are supported by the current tax engine",
    );
  });

  it("a zero-amount placeholder needs no manual treatment (not counted)", () => {
    const r = rows({
      capitalGains: [
        { id: rid(), gain_type: "other_stcg", sale_value: "0", cost: "0", expenses: "0", exemption_claimed: "0", taxable_gain: "0", source_type: "manual" },
      ],
    });
    expect(classifyLedgerSupport(r, META).unsupported).toBe(0);
  });
});

describe("classifyLedgerSupport — brought-forward losses reach the adapter (K4-10)", () => {
  /** A brought-forward row with sane defaults; override what matters. */
  function bfRow(over: Record<string, unknown> = {}) {
    return {
      id: rid(),
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

  function ltcgRow(amount: number) {
    return {
      id: rid(),
      gain_type: "ltcg_112a",
      sale_value: String(amount),
      cost: "0",
      expenses: "0",
      exemption_claimed: "0",
      taxable_gain: String(amount),
      source_type: "broker_report",
    };
  }

  it("an UNVERIFIED filing eligibility surfaces under the broughtForwardLosses category", () => {
    // Regression: `classifyLedgerSupport` used to drop `broughtForwardLosses`
    // before calling `buildEngineInput`, so the adapter ran with NO carry-forward
    // records — the category badge always read 0 and the page total under-counted
    // even though the adapter genuinely refuses this case.
    const bf = rid();
    const r = rows({
      capitalGains: [ltcgRow(500_000)] as never,
      broughtForwardLosses: [bfRow({ id: bf, filing_eligibility: "unverified" })] as never,
    });
    const support = classifyLedgerSupport(r, META);

    expect(support.byCategory.broughtForwardLosses.unsupported).toBe(1);
    expect(support.byCategory.broughtForwardLosses.unsupportedIds).toEqual([bf]);
    // The gain row is excluded WITH the loss — never the loss alone.
    expect(support.byCategory.capitalGains.unsupported).toBe(1);
    expect(support.unsupported).toBe(2);
    expect(support.entries.map((e) => e.code)).toEqual([
      "BROUGHT_FORWARD_LOSS_FILING_UNVERIFIED",
      "BROUGHT_FORWARD_LOSS_FILING_UNVERIFIED",
    ]);
    // Same authority, same numbers as any surface already holding the result.
    expect(support.byCategory).toEqual(ledgerSupportFromAdapter(buildEngineInput(r, META)).byCategory);
  });

  it("an admitted brought-forward record needs no manual treatment", () => {
    const r = rows({
      capitalGains: [ltcgRow(500_000)] as never,
      broughtForwardLosses: [bfRow({ amount: "200000" })] as never,
    });
    const support = classifyLedgerSupport(r, META);
    expect(support.unsupported).toBe(0);
    expect(support.byCategory.broughtForwardLosses.unsupported).toBe(0);
  });

  it("excludes an archived brought-forward row before classification", () => {
    const r = rows({
      capitalGains: [ltcgRow(500_000)] as never,
      broughtForwardLosses: [
        bfRow({ filing_eligibility: "unverified", deleted_at: "2026-07-01T00:00:00Z" }),
      ] as never,
    });
    const support = classifyLedgerSupport(r, META);
    expect(support.unsupported).toBe(0);
    expect(support.byCategory.broughtForwardLosses.unsupported).toBe(0);
  });
});

/**
 * AUDIT-08-F4 / decision D245 — every OPTIONAL ledger kind is forwarded.
 *
 * `classifyLedgerSupport` used to rebuild its input by naming each field, with
 * a comment warning that a new kind could be dropped there. A comment cannot
 * fail a build, and two of the three optional kinds were in fact dropped on
 * the way in (`broughtForwardLosses` at `K4-10`, `businessBooksEntries` at
 * `K4-14`, both repaired at `K4-14F`). TypeScript is structurally unable to
 * catch it: every optional field absent is treated exactly like `[]`, so the
 * omission compiles and silently zeroes that category's badge.
 *
 * The function now forwards by key, so this suite is the behavioural pin: each
 * optional kind, populated with a row the adapter REFUSES, must report a
 * non-zero count in its OWN category. A dropped kind reads 0 and fails here.
 */
describe("classifyLedgerSupport — every optional ledger kind reaches the adapter (D245)", () => {
  const hpRow = (over: Record<string, unknown> = {}) => ({
    id: rid(),
    usage: "let_out",
    annual_rent_received: "600000",
    municipal_taxes_paid: "0",
    home_loan_interest: "0",
    source_type: "manual",
    ...over,
  });
  const bfRow = (over: Record<string, unknown> = {}) => ({
    id: rid(),
    originating_assessment_year: "2022-23",
    loss_type: "ltcl",
    amount: "100000",
    filing_eligibility: "unverified",
    loss_provenance: "prior_finalized_case_in_system",
    elected_set_off_target: null,
    source_type: "prefilled_json",
    ...over,
  });
  const booksRow = (over: Record<string, unknown> = {}) => ({
    id: rid(),
    revenue: "900000",
    expenses: "400000",
    is_profession: false,
    // Refuses: the engine implements none of Sections 30-43D.
    adjustments: "depreciation_s32",
    source_type: "manual",
    ...over,
  });

  it("housePropertyEntries — a refused row surfaces under its own category", () => {
    // Two live rows: session scope is one, so ALL are excluded.
    const r = rows({ housePropertyEntries: [hpRow(), hpRow()] as never });
    const support = classifyLedgerSupport(r, META);
    expect(support.byCategory.houseProperty.unsupported).toBe(2);
    expect(support.entries.every((e) => e.code === "MULTIPLE_HOUSE_PROPERTIES_NOT_MODELLED")).toBe(true);
  });

  it("broughtForwardLosses — a refused row surfaces under its own category", () => {
    const r = rows({ broughtForwardLosses: [bfRow()] as never });
    const support = classifyLedgerSupport(r, META);
    expect(support.byCategory.broughtForwardLosses.unsupported).toBe(1);
  });

  it("businessBooksEntries — a refused row surfaces under its own category", () => {
    const r = rows({ businessBooksEntries: [booksRow()] as never });
    const support = classifyLedgerSupport(r, META);
    expect(support.byCategory.businessBooks.unsupported).toBe(1);
    expect(support.entries[0]?.code).toBe("BUSINESS_BOOKS_DEPRECIATION_UNSUPPORTED");
  });

  it("ALL optional kinds together match the adapter exactly — no kind dropped", () => {
    const r = rows({
      housePropertyEntries: [hpRow(), hpRow()] as never,
      broughtForwardLosses: [bfRow()] as never,
      businessBooksEntries: [booksRow()] as never,
    });
    const support = classifyLedgerSupport(r, META);
    // The one authority, reshaped — identical by construction, not by luck.
    expect(support.byCategory).toEqual(ledgerSupportFromAdapter(buildEngineInput(r, META)).byCategory);
    expect(support.byCategory.houseProperty.unsupported).toBeGreaterThan(0);
    expect(support.byCategory.broughtForwardLosses.unsupported).toBeGreaterThan(0);
    expect(support.byCategory.businessBooks.unsupported).toBeGreaterThan(0);
  });

  it("soft-deleted rows are dropped generically, in EVERY optional kind", () => {
    const gone = { deleted_at: "2026-07-01T00:00:00Z" };
    const r = rows({
      housePropertyEntries: [hpRow(gone), hpRow(gone)] as never,
      broughtForwardLosses: [bfRow(gone)] as never,
      businessBooksEntries: [booksRow(gone)] as never,
    });
    expect(classifyLedgerSupport(r, META).unsupported).toBe(0);
  });
});

describe("describeLedgerSupport — precise, non-vague phrasing", () => {
  it("pluralises and names the concrete action", () => {
    expect(describeLedgerSupport(0)).toBe("All entries are supported by the current tax engine");
    expect(describeLedgerSupport(1)).toBe("1 entry needs manual tax treatment");
    expect(describeLedgerSupport(2)).toBe("2 entries need manual tax treatment");
  });
});
