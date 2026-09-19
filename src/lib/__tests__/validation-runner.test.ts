import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEngineInput, hasMeaningfulInput, type LedgerRows } from "@/lib/tax-desk/computation-adapter";
import {
  COMPARABLE_SOURCE_PAIRS,
  runValidation,
  SUPPRESSED_ENGINE_CODES,
  type ValidationDoc,
} from "@/lib/tax-desk/validation-runner";

let seq = 0;
const rid = () => `row_${++seq}`;

interface RunOpts {
  income?: LedgerRows["income"];
  taxPaid?: LedgerRows["taxPaid"];
  deductions?: LedgerRows["deductions"];
  capitalGains?: LedgerRows["capitalGains"];
  housePropertyEntries?: LedgerRows["housePropertyEntries"];
  documents?: ValidationDoc[];
  validFileIds?: string[];
  selectedItrType?: string | null;
}

function run(opts: RunOpts) {
  const ledgers: LedgerRows = {
    income: opts.income ?? [],
    taxPaid: opts.taxPaid ?? [],
    deductions: opts.deductions ?? [],
    capitalGains: opts.capitalGains ?? [],
    housePropertyEntries: opts.housePropertyEntries ?? [],
  };
  const adapter = buildEngineInput(ledgers, {
    assessmentYear: "2026-27",
    financialYear: "2025-26",
    selectedItrType: opts.selectedItrType ?? null,
    finalized: false,
  });
  return runValidation({
    context: { assessmentYear: "2026-27", financialYear: "2025-26", selectedItrType: opts.selectedItrType ?? null, finalized: false },
    ledgers,
    adapter,
    documents: opts.documents ?? [],
    validFileIds: opts.validFileIds ?? [],
  });
}

const keys = (r: ReturnType<typeof run>) => r.findings.map((f) => f.findingKey);
const codes = (r: ReturnType<typeof run>) => r.findings.map((f) => f.ruleCode);
const inc = (over: Partial<LedgerRows["income"][number]> = {}) => ({ id: rid(), income_head: "salary", amount: 800000, source_type: "manual", ...over });
const cg = (over: Partial<LedgerRows["capitalGains"][number]> = {}) => ({ id: rid(), gain_type: "stcg_111a", sale_value: 100000, cost: 60000, expenses: 0, exemption_claimed: 0, taxable_gain: 40000, source_type: "manual", ...over });

describe("finding keys — deterministic", () => {
  it("produces the same key for the same subject across runs, and a changed amount keeps the key", () => {
    const id = rid();
    const a = run({ capitalGains: [cg({ id, taxable_gain: 999 })] }); // arithmetic mismatch
    const b = run({ capitalGains: [cg({ id, taxable_gain: 111 })] }); // still mismatch, same subject
    const ka = a.findings.find((f) => f.ruleCode === "ledger.cg_arithmetic")?.findingKey;
    const kb = b.findings.find((f) => f.ruleCode === "ledger.cg_arithmetic")?.findingKey;
    expect(ka).toBeDefined();
    expect(ka).toBe(kb); // same key → upsert, not a new finding
  });
});

describe("engine + coverage", () => {
  it("surfaces a validateCase finding as an engine.* finding", () => {
    // selected ITR-1 with capital gains → engine CG_REQUIRES_ITR2 (itr_form, blocker→error)
    const r = run({ income: [inc()], capitalGains: [cg()], selectedItrType: "ITR-1" });
    const f = r.findings.find((x) => x.ruleCode === "engine.CG_REQUIRES_ITR2");
    expect(f).toBeDefined();
    expect(f?.category).toBe("itr_form");
    expect(f?.severity).toBe("error");
  });

  it("converts an unsupported non-zero entry into a coverage error", () => {
    const id = rid();
    const r = run({ income: [inc({ id, income_head: "house_property", amount: 120000 })] });
    const f = r.findings.find((x) => x.findingKey === `coverage.unsupported_entry:${id}`);
    expect(f?.severity).toBe("error");
    expect(codes(r)).toContain("coverage.partial");
  });

  it("flags no meaningful income", () => {
    expect(codes(run({}))).toContain("coverage.no_meaningful_income");
  });

  // AUDIT-03-F2 regression. The runner used to recompute "meaningfulness" from
  // its own six-term sum, frozen at the pre-K4-06 vocabulary, so a
  // house-property-only or 44ADA-only case was computed by the engine while
  // being told "nothing to compute". The two signals are now asserted to AGREE
  // rather than each being asserted separately — an agreement test cannot pass
  // while a second authority drifts.
  it("agrees with the canonical hasMeaningfulInput on every ledger kind (AUDIT-03-F2)", () => {
    const cases: { label: string; opts: RunOpts; expected: boolean }[] = [
      { label: "empty", opts: {}, expected: false },
      { label: "salary only", opts: { income: [inc()] }, expected: true },
      { label: "capital gains only", opts: { capitalGains: [cg()] }, expected: true },
      {
        label: "house property only (K4-06)",
        opts: {
          housePropertyEntries: [{
            id: rid(), usage: "let_out", annual_rent_received: 240000,
            municipal_taxes_paid: 0, home_loan_interest: 0, source_type: "manual",
          }],
        },
        expected: true,
      },
      {
        // Self-occupied, no loan: rent-minus-interest nets to exactly 0, so a
        // sum-based signal would call this meaningless. Presence is what counts.
        label: "house property netting to zero (K4-06)",
        opts: {
          housePropertyEntries: [{
            id: rid(), usage: "self_occupied", annual_rent_received: 0,
            municipal_taxes_paid: 0, home_loan_interest: 0, source_type: "manual",
          }],
        },
        expected: true,
      },
      {
        label: "presumptive 44ADA only (K4-07)",
        opts: { income: [inc({ income_head: "presumptive_professional_44ada", amount: 500000, presumptive_activity_type: "specified_profession_44aa_1" })] },
        expected: true,
      },
    ];

    for (const { label, opts, expected } of cases) {
      const ledgers: LedgerRows = {
        income: opts.income ?? [], taxPaid: opts.taxPaid ?? [],
        deductions: opts.deductions ?? [], capitalGains: opts.capitalGains ?? [],
        housePropertyEntries: opts.housePropertyEntries ?? [],
      };
      const adapter = buildEngineInput(ledgers, {
        assessmentYear: "2026-27", financialYear: "2025-26",
        selectedItrType: null, finalized: false,
      });
      const canonical = hasMeaningfulInput(adapter);
      const runnerSaysMeaningless = codes(run(opts)).includes("coverage.no_meaningful_income");

      expect(canonical, `${label}: canonical signal`).toBe(expected);
      // The runner's "nothing to compute" finding must be the exact negation of
      // the canonical signal — no third opinion.
      expect(runnerSaysMeaningless, `${label}: runner agrees with canonical`).toBe(!canonical);
    }
  });

  it("flags selected vs recommended ITR mismatch", () => {
    const r = run({ income: [inc()], capitalGains: [cg()], selectedItrType: "ITR-1" });
    const f = r.findings.find((x) => x.ruleCode === "itr.mismatch");
    expect(f?.details).toMatchObject({ selectedItrType: "ITR-1", recommendedItrType: "ITR-2" });
  });
});

describe("documents", () => {
  it("flags a required document missing and a required document rejected", () => {
    const r = run({
      income: [inc()],
      documents: [
        { id: "d1", name: "Form 16", status: "pending", is_required: true },
        { id: "d2", name: "AIS", status: "rejected", is_required: true },
        { id: "d3", name: "Optional", status: "pending", is_required: false }, // must NOT flag
      ],
    });
    expect(keys(r)).toContain("documents.required_missing:d1");
    const rej = r.findings.find((f) => f.findingKey === "documents.required_rejected:d2");
    expect(rej?.severity).toBe("error");
    expect(keys(r).some((k) => k.includes("d3"))).toBe(false);
  });

  it("flags a ledger-linked source document that is not received", () => {
    const r = run({
      income: [inc({ source_type: "Form16", source_document_id: "d1" })],
      documents: [{ id: "d1", name: "Form 16", status: "requested", is_required: true }],
    });
    expect(keys(r).some((k) => k.startsWith("ledger.source_not_received:"))).toBe(true);
  });
});

describe("ledger integrity", () => {
  it("flags a non-manual entry with no linked source", () => {
    const id = rid();
    const r = run({ income: [inc({ id, source_type: "AIS" })] });
    expect(keys(r)).toContain(`ledger.non_manual_no_source:${id}`);
  });

  it("detects an exact duplicate but not a mere amount match", () => {
    const dup = run({ income: [inc({ amount: 500000, source_type: "manual" }), inc({ amount: 500000, source_type: "manual" })] });
    expect(codes(dup)).toContain("ledger.duplicate");

    const notDup = run({ income: [inc({ amount: 500000, source_type: "Form16", source_document_id: "d1" }), inc({ amount: 500000, source_type: "AIS" })] });
    expect(codes(notDup)).not.toContain("ledger.duplicate");
  });

  it("flags a capital-gain arithmetic mismatch beyond ₹1 but not within tolerance", () => {
    const bad = run({ capitalGains: [cg({ sale_value: 100000, cost: 60000, expenses: 0, exemption_claimed: 0, taxable_gain: 40050 })] });
    const f = bad.findings.find((x) => x.ruleCode === "ledger.cg_arithmetic");
    expect(f?.difference).toBe(50);

    const ok = run({ capitalGains: [cg({ sale_value: 100000, cost: 60000, expenses: 0, exemption_claimed: 0, taxable_gain: 40000 })] });
    expect(codes(ok)).not.toContain("ledger.cg_arithmetic");
  });
});

describe("reconciliation", () => {
  it("groups source totals by ledger head and source_type", () => {
    const r = run({ income: [inc({ source_type: "Form16", amount: 800000 }), inc({ source_type: "AIS", amount: 750000 })] });
    const g = r.reconciliation.groups.find((x) => x.category === "income" && x.key === "salary");
    expect(g?.rows.map((x) => x.sourceType).sort()).toEqual(["AIS", "Form16"]);
    expect(g?.total).toBe(1550000);
  });

  it("flags Form16 vs AIS salary mismatch and Form16 vs 26AS salary-TDS mismatch", () => {
    const r = run({
      income: [inc({ source_type: "Form16", amount: 800000 }), inc({ source_type: "AIS", amount: 750000 })],
      taxPaid: [
        { id: rid(), tax_paid_type: "salary_tds", amount: 60000, source_type: "Form16" },
        { id: rid(), tax_paid_type: "salary_tds", amount: 55000, source_type: "26AS" },
      ],
    });
    expect(keys(r)).toContain("reconciliation.source_mismatch:salary_form16_ais");
    expect(keys(r)).toContain("reconciliation.source_mismatch:salary_tds_form16_26as");
  });

  it("does NOT flag a mismatch when one side of the pair is absent", () => {
    const r = run({ income: [inc({ source_type: "Form16", amount: 800000 })] }); // no AIS salary
    expect(keys(r).some((k) => k.startsWith("reconciliation.source_mismatch"))).toBe(false);
  });

  it("respects the ₹1 tolerance on comparable pairs", () => {
    const r = run({ income: [inc({ source_type: "Form16", amount: 800000 }), inc({ source_type: "AIS", amount: 800001 })] });
    expect(keys(r).some((k) => k.startsWith("reconciliation.source_mismatch"))).toBe(false);
  });

  it("does NOT auto-flag broker_report capital gains vs AIS as an error", () => {
    const r = run({
      capitalGains: [
        cg({ source_type: "broker_report", taxable_gain: 40000 }),
      ],
      income: [inc({ source_type: "AIS", income_head: "dividend", amount: 40000 })],
    });
    expect(keys(r).some((k) => k.startsWith("reconciliation.source_mismatch"))).toBe(false);
  });

  it("exposes the comparable pairs list explicitly", () => {
    expect(COMPARABLE_SOURCE_PAIRS.map((p) => p.pairCode)).toEqual([
      "salary_form16_ais",
      "salary_tds_form16_26as",
      "non_salary_tds_26as_ais",
    ]);
  });
});

describe("security + lifecycle planning", () => {
  it("never leaks PAN / notes into finding details", () => {
    const r = run({
      income: [inc({ source_type: "AIS" })],
      capitalGains: [cg({ taxable_gain: 999 })],
      documents: [{ id: "d1", name: "AIS", status: "rejected", is_required: true }],
    });
    const blob = JSON.stringify(r.findings);
    expect(blob).not.toMatch(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
    expect(blob).not.toContain('"notes"');
  });

  it("stale-resolution planning: removing the subject drops its finding key", () => {
    const id = rid();
    const withUnsupported = run({ income: [inc({ id, income_head: "business_income", amount: 300000 }), inc()] });
    expect(keys(withUnsupported)).toContain(`coverage.unsupported_entry:${id}`);
    const without = run({ income: [inc()] });
    expect(keys(without)).not.toContain(`coverage.unsupported_entry:${id}`);
  });
});

/**
 * `AUDIT-04-F1`. An AREA-level skip list silently discarded twelve engine
 * finding codes, of which exactly one was genuinely duplicated. Because
 * `runValidation` is the only production consumer of `validateCase`, five
 * sessions each authored a preparer disclosure that no preparer ever saw.
 *
 * This block is the structural half of the fix: the skip is now per code, and
 * a code that is neither surfaced nor explicitly justified fails here. It is
 * deliberately derived from `validate-case.ts`'s own source text, so a code
 * added by a future session is picked up without anyone remembering to update
 * a list.
 */
describe("AUDIT-04-F1 — every engine finding code is surfaced or explicitly suppressed", () => {
  const ENGINE_SOURCE = readFileSync(
    join(process.cwd(), "src/lib/tax-engine/ay-2026-27/validate-case.ts"),
    "utf8",
  );
  const ENGINE_CODES = [
    ...new Set([...ENGINE_SOURCE.matchAll(/code:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1])),
  ].sort();

  it("actually finds the engine's finding codes — guards this guard", () => {
    // AUDIT-04-F3/F4's lesson, applied to the guard being added by the same
    // audit: a source-text guard that quietly matches nothing is not a guard.
    // If `validate-case.ts` moves or its `code:` literal style changes, this
    // fails loudly instead of vacuously approving an empty set.
    expect(ENGINE_CODES.length).toBeGreaterThan(15);
    expect(ENGINE_CODES).toContain("DEDUCTION_SECTION_AGE_MISMATCH");
    expect(ENGINE_CODES).toContain("CAPITAL_LOSS_SET_OFF_APPLIED");
  });

  it("suppresses only real engine codes, and never without a stated reason", () => {
    for (const [code, reason] of Object.entries(SUPPRESSED_ENGINE_CODES)) {
      expect(ENGINE_CODES, `${code} is suppressed but is not an engine finding code`).toContain(code);
      expect(reason.trim().length, `${code} is suppressed without a real reason`).toBeGreaterThan(60);
    }
  });

  it("pins the suppressed set — widening it is a deliberate, reviewed act", () => {
    // If this fails, a code is being silenced. Justify it in
    // SUPPRESSED_ENGINE_CODES with the surface that states the same thing to
    // the same reader, then update this pin — do NOT skip by area again.
    expect(Object.keys(SUPPRESSED_ENGINE_CODES).sort()).toEqual([
      "DEDUCTION_PROOF_MISSING",
      "DOC_MISSING",
    ]);
  });

  it("a previously-discarded disclosure now reaches the preparer", () => {
    // `PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED` sits in the `deductions` area
    // and was dropped by the area skip since K4-07 authored it.
    const r = run({
      income: [inc({ income_head: "presumptive_professional_44ada", amount: 2_000_000, presumptive_activity_type: "specified_profession_44aa_1" })],
    });
    expect(codes(r)).toContain("engine.PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED");
  });

  it("the one genuinely duplicated code stays suppressed, and its runner equivalent still fires", () => {
    const r = run({
      income: [inc()],
      deductions: [{ id: rid(), deduction_type: "80C", amount: 150_000, source_type: "manual" }],
    });
    // Exactly one of the two, never both — that is what the suppression buys.
    expect(codes(r)).not.toContain("engine.DEDUCTION_PROOF_MISSING");
    expect(codes(r)).toContain("ledger.deduction_no_proof");
  });
});
