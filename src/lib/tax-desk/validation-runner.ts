/**
 * Tax Desk validation coordinator (K.2.6). PURE — imports only the K.2.0 engine
 * (types + validateCase/recommendItrForm) and the K.2.5 adapter types. No
 * React/Next/Supabase, no DB, no writes.
 *
 * Produces a DETERMINISTIC array of normalized findings (stable findingKey per
 * subject) plus a manual source-reconciliation summary. Findings never contain
 * PAN/Aadhaar/notes/URLs — only ids, amounts, source types and counts.
 *
 * This is NOT filing readiness. "No open findings" ≠ "ready to file".
 */

import { recommendItrForm, validateCase } from "@/lib/tax-engine/ay-2026-27";
import { isDocSatisfied } from "@/lib/documents/document-state";
import {
  hasMeaningfulInput,
  toNum,
  type AdapterResult,
  type CapitalGainLedgerRow,
  type DeductionLedgerRow,
  type HousePropertyLedgerRow,
  type IncomeLedgerRow,
  type LedgerRows,
  type TaxPaidLedgerRow,
} from "@/lib/tax-desk/computation-adapter";

export type FindingCategory =
  | "engine"
  | "documents"
  | "ledger"
  | "reconciliation"
  | "itr_form"
  | "computation_coverage";

export type FindingSeverity = "error" | "warning" | "info";

export interface RunnerFinding {
  ruleCode: string;
  findingKey: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  message: string;
  /** Safe structured details — ids/amounts/source types/counts only. */
  details: Record<string, unknown>;
  subjectType?: string;
  subjectKey?: string;
  sourceValue?: number | null;
  enteredValue?: number | null;
  difference?: number | null;
  suggestedAction?: string;
}

export interface ValidationDoc {
  id: string;
  name: string;
  status: string;
  is_required: boolean;
}

export interface ValidationContext {
  assessmentYear: string;
  financialYear: string;
  selectedItrType: string | null;
  finalized: boolean;
}

export interface ValidationRunInput {
  context: ValidationContext;
  ledgers: LedgerRows;
  adapter: AdapterResult;
  documents: ValidationDoc[];
  validFileIds: string[];
}

export interface ReconRow {
  sourceType: string;
  total: number;
  count: number;
  saleTotal?: number;
}
export interface ReconGroup {
  category: "income" | "tax_paid" | "deduction" | "capital_gain";
  key: string;
  rows: ReconRow[];
  total: number;
}
export interface ReconPairDelta {
  pairCode: string;
  category: string;
  key: string;
  label: string;
  sourceA: string;
  totalA: number;
  sourceB: string;
  totalB: number;
  delta: number;
  mismatch: boolean;
}
export interface ReconciliationSummary {
  groups: ReconGroup[];
  pairs: ReconPairDelta[];
}

export interface ValidationRunResult {
  findings: RunnerFinding[];
  reconciliation: ReconciliationSummary;
  counts: { error: number; warning: number; info: number; total: number };
}

/** ₹1 rounding tolerance for arithmetic + reconciliation comparisons. */
export const TOLERANCE = 1;

/** Source types that imply an external supporting document should be linked. */
const EXTERNAL_SOURCES = new Set(["AIS", "26AS", "Form16", "prefilled_json", "broker_report", "bank_certificate"]);

/**
 * Explicit, tested comparable source pairs for automatic mismatch findings.
 * Anything NOT listed here is shown as totals only (never auto-declared wrong):
 * broker_report/bank_certificate/adjustment vs third-party sources legitimately
 * differ (timing, cost basis, corrections).
 */
export const COMPARABLE_SOURCE_PAIRS = [
  { pairCode: "salary_form16_ais", category: "income" as const, key: "salary", label: "Salary — Form 16 vs AIS", sourceA: "Form16", sourceB: "AIS" },
  { pairCode: "salary_tds_form16_26as", category: "tax_paid" as const, key: "salary_tds", label: "Salary TDS — Form 16 vs 26AS", sourceA: "Form16", sourceB: "26AS" },
  { pairCode: "non_salary_tds_26as_ais", category: "tax_paid" as const, key: "non_salary_tds", label: "Non-salary TDS — 26AS vs AIS", sourceA: "26AS", sourceB: "AIS" },
] as const;

/**
 * Engine finding codes this coordinator deliberately does NOT surface, each
 * with the reason it is safe to drop.
 *
 * This replaces an AREA-level skip list (`documents` / `reconciliation` /
 * `deductions`) whose stated rationale — "the coordinator owns these areas with
 * dedicated rules (skip to avoid dupes)" — was true for exactly ONE of the
 * twelve codes it silenced (`AUDIT-04-F1`). `runValidation` is the only
 * production consumer of `validateCase`, so the drop was total: disclosures
 * deliberately authored by `K4-03`, `K4-06`, `K4-07`, `K4-08` and `K4-09` —
 * including `DEDUCTION_SECTION_AGE_MISMATCH`, written precisely so an
 * age-excluded claim does not read as a silent ₹0 — never reached a preparer.
 *
 * The rule now: a code is dropped only when something else states the SAME
 * thing to the SAME reader, and the claim is written down where it can be
 * re-checked. Suppressing by area is what let this pass unnoticed for five
 * sessions, so suppression is per code and every entry carries its reason.
 * `validation-runner.test.ts` fails if an engine code is neither surfaced nor
 * listed here — a sixth session cannot repeat this by widening a filter.
 */
export const SUPPRESSED_ENGINE_CODES: Readonly<Record<string, string>> = {
  DEDUCTION_PROOF_MISSING:
    "Exact duplicate of this coordinator's own `ledger.deduction_no_proof` rule — same condition " +
    "(a deduction amount > 0 carrying neither a proof nor a source document) and the same `warning` " +
    "severity. Verified against validate-case.ts's rule 7 and rule 5d below.",
  DOC_MISSING:
    "Duplicated by this coordinator's own four `documents.required_*` rules (§4 below), which read the same " +
    "required-document state through the shared `documents/document-state.ts` authority and cover a richer " +
    "status vocabulary than the engine's single `missing`. It is also UNREACHABLE on this path today: " +
    "`buildEngineInput` always passes `requiredDocuments: []` (computation-adapter.ts), so the engine rule " +
    "cannot fire through `runValidation` at all. Both facts are recorded rather than inherited — if a future " +
    "session ever populates `requiredDocuments`, the duplication becomes live and must be decided then.",
};

const SUPPRESSED_ENGINE_CODE_SET = new Set(Object.keys(SUPPRESSED_ENGINE_CODES));

const round = (n: number) => Math.round(n);

// ---------------------------------------------------------------------------
// Reconciliation summary (grouped source totals + comparable-pair deltas)
// ---------------------------------------------------------------------------

export function buildReconciliation(ledgers: LedgerRows): ReconciliationSummary {
  const groups: ReconGroup[] = [];

  const groupBy = (
    category: ReconGroup["category"],
    rows: { key: string; source_type: string; amount: number; sale?: number }[],
  ) => {
    const byKey = new Map<string, Map<string, ReconRow>>();
    for (const r of rows) {
      let bySrc = byKey.get(r.key);
      if (!bySrc) {
        bySrc = new Map();
        byKey.set(r.key, bySrc);
      }
      const cur = bySrc.get(r.source_type) ?? { sourceType: r.source_type, total: 0, count: 0, saleTotal: 0 };
      cur.total += r.amount;
      cur.count += 1;
      if (r.sale !== undefined) cur.saleTotal = (cur.saleTotal ?? 0) + r.sale;
      bySrc.set(r.source_type, cur);
    }
    for (const [key, bySrc] of byKey) {
      const rowsArr = [...bySrc.values()];
      groups.push({ category, key, rows: rowsArr, total: rowsArr.reduce((a, r) => a + r.total, 0) });
    }
  };

  groupBy(
    "income",
    ledgers.income.map((r) => ({ key: r.income_head, source_type: r.source_type, amount: toNum(r.amount) })),
  );
  groupBy(
    "tax_paid",
    ledgers.taxPaid.map((r) => ({ key: r.tax_paid_type, source_type: r.source_type, amount: toNum(r.amount) })),
  );
  groupBy(
    "deduction",
    ledgers.deductions.map((r) => ({ key: r.deduction_type, source_type: r.source_type, amount: toNum(r.amount) })),
  );
  groupBy(
    "capital_gain",
    ledgers.capitalGains.map((r) => ({
      key: r.gain_type,
      source_type: r.source_type,
      amount: toNum(r.taxable_gain),
      sale: toNum(r.sale_value),
    })),
  );
  // AUDIT-03-F2 — house property is DELIBERATELY not grouped here, and this
  // comment exists so the omission reads as a decision rather than the same
  // oversight that left it out of §5's integrity checks (which WAS a gap, and
  // is now fixed).
  //
  // This surface exists to cross-check ONE figure declared by TWO independent
  // external authorities — every entry in COMPARABLE_SOURCE_PAIRS is of that
  // shape (Form 16 vs AIS, Form 16 vs 26AS, 26AS vs AIS). No second authority
  // exists for a house property's rent received, municipal taxes paid, or
  // home-loan interest in this ledger's vocabulary, so there is no pair to
  // define. Grouping the rows anyway would render a totals block that can
  // never produce a delta — implying a reconciliation is happening when none
  // is, which is exactly the kind of over-claim this repository refuses.
  //
  // If a future session establishes a genuine second source (e.g. AIS rent
  // against a rent receipt), that is a sourcing decision for a K4-era session
  // with official sources behind it — not a maintenance change.

  const totalFor = (category: string, key: string, source: string): { total: number; present: boolean } => {
    const g = groups.find((x) => x.category === category && x.key === key);
    const row = g?.rows.find((r) => r.sourceType === source);
    return { total: row?.total ?? 0, present: !!row };
  };

  const pairs: ReconPairDelta[] = [];
  // Configured pairs.
  for (const p of COMPARABLE_SOURCE_PAIRS) {
    const a = totalFor(p.category, p.key, p.sourceA);
    const b = totalFor(p.category, p.key, p.sourceB);
    if (!a.present || !b.present) continue;
    const delta = round(a.total - b.total);
    pairs.push({
      pairCode: p.pairCode,
      category: p.category,
      key: p.key,
      label: p.label,
      sourceA: p.sourceA,
      totalA: round(a.total),
      sourceB: p.sourceB,
      totalB: round(b.total),
      delta,
      mismatch: a.total !== 0 && b.total !== 0 && Math.abs(a.total - b.total) > TOLERANCE,
    });
  }
  // Generic prefilled_json vs AIS per income head.
  for (const g of groups.filter((x) => x.category === "income")) {
    const a = totalFor("income", g.key, "prefilled_json");
    const b = totalFor("income", g.key, "AIS");
    if (!a.present || !b.present) continue;
    pairs.push({
      pairCode: `income_prefilled_ais_${g.key}`,
      category: "income",
      key: g.key,
      label: `${g.key} — Prefilled JSON vs AIS`,
      sourceA: "prefilled_json",
      totalA: round(a.total),
      sourceB: "AIS",
      totalB: round(b.total),
      delta: round(a.total - b.total),
      mismatch: a.total !== 0 && b.total !== 0 && Math.abs(a.total - b.total) > TOLERANCE,
    });
  }

  return { groups, pairs };
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export function runValidation(input: ValidationRunInput): ValidationRunResult {
  const { adapter, ledgers, documents, validFileIds, context } = input;
  const findings: RunnerFinding[] = [];
  const push = (f: RunnerFinding) => findings.push(f);

  // --- 1. Engine (validateCase) ---
  const engine = validateCase(adapter.input);
  for (const f of engine.findings) {
    if (SUPPRESSED_ENGINE_CODE_SET.has(f.code)) continue;
    const severity: FindingSeverity = f.severity === "blocker" ? "error" : f.severity;
    // AUDIT-04-F1: the engine's `reconciliation`-area findings now reach the
    // preparer, so they group with this coordinator's own reconciliation
    // findings rather than landing in the generic `engine` bucket.
    const category: FindingCategory =
      f.area === "itr_form"
        ? "itr_form"
        : f.area === "payments"
          ? "computation_coverage"
          : f.area === "reconciliation"
            ? "reconciliation"
            : "engine";
    push({
      ruleCode: `engine.${f.code}`,
      findingKey: `engine.${f.code}`,
      category,
      severity,
      title: `Engine: ${f.code}`,
      message: f.message,
      details: { code: f.code, area: f.area },
      subjectType: "engine",
      subjectKey: f.code,
      suggestedAction: f.suggestedAction,
    });
  }

  // --- 2. Computation coverage ---
  for (const w of adapter.warnings) {
    push({
      ruleCode: "coverage.unsupported_entry",
      findingKey: `coverage.unsupported_entry:${w.ledgerId}`,
      category: "computation_coverage",
      severity: "error", // blocks a complete snapshot
      title: "Unsupported ledger entry",
      message: w.message,
      details: { entryType: w.entryType, amount: round(w.amount), code: w.code, ledgerKind: w.ledgerKind },
      subjectType: "ledger_entry",
      subjectKey: w.ledgerId,
      suggestedAction: "Remove or re-map this entry so the computation is complete.",
    });
  }
  if (!adapter.complete) {
    push({
      ruleCode: "coverage.partial",
      findingKey: "coverage.partial",
      category: "computation_coverage",
      severity: "warning",
      title: "Partial computation coverage",
      message: `${adapter.unsupportedEntryCount} entr${adapter.unsupportedEntryCount === 1 ? "y is" : "ies are"} not computed by this engine; the preview is incomplete and not filing-ready.`,
      details: { unsupportedEntryCount: adapter.unsupportedEntryCount, mappedEntryCount: adapter.mappedEntryCount },
    });
  }
  // AUDIT-03-F2: CONSUME the canonical signal, never recompute it. This used
  // to sum its own six terms, which stopped at the pre-K4-06 vocabulary — so a
  // house-property-only or 44ADA-only case was computed by the engine while
  // this told the preparer "nothing to compute". `hasMeaningfulInput` is the
  // single authority (`PROJECT_CONSTITUTION.md` §3) and already accounts for
  // presumptive-44ADA receipts and the presence of a house-property record.
  // `adapter` is the full `AdapterResult` the helper takes, so there is nothing
  // awkward about the dependency — the duplication was never necessary.
  if (!hasMeaningfulInput(adapter)) {
    push({
      ruleCode: "coverage.no_meaningful_income",
      findingKey: "coverage.no_meaningful_income",
      category: "computation_coverage",
      severity: "info",
      title: "No mapped income or tax",
      message: "No mapped income, capital gains or taxes paid yet — nothing to compute.",
      details: {},
    });
  }

  // --- 3. ITR form (from recommendItrForm) ---
  const rec = recommendItrForm(adapter.input);
  if (!context.selectedItrType) {
    push({
      ruleCode: "itr.missing_selected",
      findingKey: "itr.missing_selected",
      category: "itr_form",
      severity: "info",
      title: "No ITR form selected",
      message: `No ITR form is selected yet. Recommended: ${rec.recommendedItrType}.`,
      details: { recommendedItrType: rec.recommendedItrType },
    });
  } else if (context.selectedItrType !== rec.recommendedItrType) {
    push({
      ruleCode: "itr.mismatch",
      findingKey: "itr.mismatch",
      category: "itr_form",
      severity: "warning",
      title: "Selected ITR differs from recommended",
      message: `Selected ${context.selectedItrType} but the recommended form is ${rec.recommendedItrType}.`,
      details: { selectedItrType: context.selectedItrType, recommendedItrType: rec.recommendedItrType, blockers: rec.blockers },
    });
  }

  // --- 4. Documents (parent checklist) ---
  const docById = new Map(documents.map((d) => [d.id, d]));
  const fileIds = new Set(validFileIds);
  for (const d of documents) {
    if (!d.is_required) continue;
    if (d.status === "rejected") {
      push(docFinding("documents.required_rejected", d, "error", "Required document rejected", `Required document "${d.name}" was rejected.`));
    } else if (d.status === "pending") {
      push(docFinding("documents.required_missing", d, "warning", "Required document missing", `Required document "${d.name}" has not been collected.`));
    } else if (d.status === "requested") {
      push(docFinding("documents.required_requested", d, "warning", "Required document requested, not received", `Required document "${d.name}" was requested but not yet received.`));
    } else if (d.status === "received") {
      push(docFinding("documents.required_unverified", d, "info", "Required document received, not verified", `Required document "${d.name}" is received but not yet verified.`));
    }
  }

  // --- 5. Ledger integrity ---
  const allRows: { kind: string; row: LedgerAnyRow }[] = [
    ...ledgers.income.map((r) => ({ kind: "income", row: r as LedgerAnyRow })),
    ...ledgers.taxPaid.map((r) => ({ kind: "tax_paid", row: r as LedgerAnyRow })),
    ...ledgers.deductions.map((r) => ({ kind: "deduction", row: r as LedgerAnyRow })),
    ...ledgers.capitalGains.map((r) => ({ kind: "capital_gain", row: r as LedgerAnyRow })),
    // AUDIT-03-F2: house-property rows carry the same `source_document_id` /
    // `source_file_id` evidence slots as every other ledger, so they get the
    // same source-document-rejected / -missing / external-source-unlinked
    // checks. K4-06 added the ledger without adding it here.
    ...(ledgers.housePropertyEntries ?? []).map((r) => ({ kind: "house_property", row: r as LedgerAnyRow })),
  ];

  // 5a. Source document reference checks.
  for (const { kind, row } of allRows) {
    if (row.source_document_id) {
      const doc = docById.get(row.source_document_id);
      if (!doc) {
        push(refFinding("ledger.source_ref_invalid", kind, row.id, "warning", "Ledger source document not found", "A ledger entry references a source document that no longer exists on the case."));
      } else if (doc.status === "rejected") {
        push(refFinding("ledger.source_rejected", kind, row.id, "error", "Ledger source document rejected", `A ledger entry references "${doc.name}", which was rejected.`));
      } else if (!isDocSatisfied(doc.status)) {
        push(refFinding("ledger.source_not_received", kind, row.id, "warning", "Ledger source document not received", `A ledger entry references "${doc.name}", which is not yet received/verified.`));
      }
    }
    if (row.source_file_id && !fileIds.has(row.source_file_id)) {
      push(refFinding("ledger.source_ref_invalid", kind, row.id, "warning", "Ledger source file not found", "A ledger entry references a source file that is no longer available."));
    }
    // 5b. External source without any linked document/file.
    if (EXTERNAL_SOURCES.has(row.source_type) && !row.source_document_id && !row.source_file_id) {
      push({
        ruleCode: "ledger.non_manual_no_source",
        findingKey: `ledger.non_manual_no_source:${row.id}`,
        category: "ledger",
        severity: "warning",
        title: "External source not linked to a document",
        message: `A ${kind} entry tagged "${row.source_type}" has no linked source document or file.`,
        details: { ledgerKind: kind, sourceType: row.source_type },
        subjectType: "ledger_entry",
        subjectKey: row.id,
        suggestedAction: "Link the supporting document/file, or set the source to manual.",
      });
    }
  }

  // 5c. Zero-value rows.
  for (const r of ledgers.income) if (toNum(r.amount) === 0) push(zeroFinding("income", r.id, r.income_head));
  for (const r of ledgers.taxPaid) if (toNum(r.amount) === 0) push(zeroFinding("tax_paid", r.id, r.tax_paid_type));
  for (const r of ledgers.deductions) if (toNum(r.amount) === 0) push(zeroFinding("deduction", r.id, r.deduction_type));
  for (const r of ledgers.capitalGains) if (toNum(r.taxable_gain) === 0 && toNum(r.sale_value) === 0) push(zeroFinding("capital_gain", r.id, r.gain_type));

  // 5d. Deduction proof mapping.
  for (const r of ledgers.deductions) {
    if (toNum(r.amount) > 0 && !r.proof_case_document_id && !r.source_document_id) {
      push({
        ruleCode: "ledger.deduction_no_proof",
        findingKey: `ledger.deduction_no_proof:${r.id}`,
        category: "ledger",
        severity: "warning",
        title: "Deduction claimed without proof",
        message: `Deduction ${r.deduction_type} of ₹${round(toNum(r.amount))} has no proof document mapped.`,
        details: { deductionType: r.deduction_type, amount: round(toNum(r.amount)) },
        subjectType: "ledger_entry",
        subjectKey: r.id,
        suggestedAction: "Attach a proof document for this deduction.",
      });
    }
  }

  // 5e. Capital-gain arithmetic.
  for (const r of ledgers.capitalGains) {
    const improvement = r.gain_type === "house_sale" ? toNum(r.cost_of_improvement) : 0;
    const expected = toNum(r.sale_value) - toNum(r.cost) - improvement - toNum(r.expenses) - toNum(r.exemption_claimed);
    const stored = toNum(r.taxable_gain);
    if (Math.abs(expected - stored) > TOLERANCE) {
      push({
        ruleCode: "ledger.cg_arithmetic",
        findingKey: `ledger.cg_arithmetic:${r.id}`,
        category: "ledger",
        severity: "warning",
        title: "Capital-gain arithmetic mismatch",
        message: `${r.gain_type}: stored taxable gain ₹${round(stored)} ≠ sale − cost − expenses − exemption (₹${round(expected)}).`,
        details: { gainType: r.gain_type, expected: round(expected), stored: round(stored) },
        subjectType: "ledger_entry",
        subjectKey: r.id,
        sourceValue: round(expected),
        enteredValue: round(stored),
        difference: round(stored - expected),
        suggestedAction: "Re-check the sale/cost/expenses/exemption or the stored taxable gain.",
      });
    }
  }

  // 5f. Conservative duplicate detection (type + amount + source_type + ref).
  const dupBuckets = new Map<string, { ids: string[]; kind: string; type: string; amount: number; sourceType: string }>();
  const addDup = (kind: string, id: string, type: string, amount: number, sourceType: string, ref: string) => {
    const fp = `${kind}|${type}|${amount}|${sourceType}|${ref}`;
    const cur = dupBuckets.get(fp) ?? { ids: [], kind, type, amount, sourceType };
    cur.ids.push(id);
    dupBuckets.set(fp, cur);
  };
  const refOf = (row: LedgerAnyRow) => row.source_document_id ?? row.source_file_id ?? "";
  for (const r of ledgers.income) addDup("income", r.id, r.income_head, round(toNum(r.amount)), r.source_type, refOf(r as LedgerAnyRow));
  for (const r of ledgers.taxPaid) addDup("tax_paid", r.id, r.tax_paid_type, round(toNum(r.amount)), r.source_type, refOf(r as LedgerAnyRow));
  for (const r of ledgers.deductions) addDup("deduction", r.id, r.deduction_type, round(toNum(r.amount)), r.source_type, refOf(r as LedgerAnyRow));
  for (const r of ledgers.capitalGains) addDup("capital_gain", r.id, r.gain_type, round(toNum(r.taxable_gain)), r.source_type, refOf(r as LedgerAnyRow));
  for (const [fp, b] of dupBuckets) {
    if (b.ids.length < 2) continue;
    const keyHash = fp.replace(/[^a-zA-Z0-9_.:|-]/g, "_");
    push({
      ruleCode: "ledger.duplicate",
      findingKey: `ledger.duplicate:${keyHash}`,
      category: "ledger",
      severity: "warning",
      title: "Possible duplicate ledger entries",
      message: `${b.ids.length} ${b.kind} entries share ${b.type} / ₹${b.amount} / ${b.sourceType} / same source — possible duplicate.`,
      details: { ledgerKind: b.kind, type: b.type, amount: b.amount, sourceType: b.sourceType, count: b.ids.length, entryIds: b.ids },
      subjectType: "ledger_group",
      subjectKey: keyHash,
      suggestedAction: "Confirm these are distinct; remove any accidental duplicate.",
    });
  }

  // --- 6. Reconciliation ---
  const reconciliation = buildReconciliation(ledgers);
  for (const p of reconciliation.pairs) {
    if (!p.mismatch) continue;
    push({
      ruleCode: "reconciliation.source_mismatch",
      findingKey: `reconciliation.source_mismatch:${p.pairCode}`,
      category: "reconciliation",
      severity: "warning",
      title: "Source totals differ",
      message: `${p.label}: ${p.sourceA} ₹${p.totalA} vs ${p.sourceB} ₹${p.totalB} (Δ ₹${p.delta}).`,
      details: { pairCode: p.pairCode, key: p.key, sourceA: p.sourceA, totalA: p.totalA, sourceB: p.sourceB, totalB: p.totalB },
      subjectType: "source_pair",
      subjectKey: p.pairCode,
      sourceValue: p.totalA,
      enteredValue: p.totalB,
      difference: p.delta,
      suggestedAction: "Reconcile the two sources; neither is assumed correct.",
    });
  }

  const counts = { error: 0, warning: 0, info: 0, total: findings.length };
  for (const f of findings) counts[f.severity] += 1;

  return { findings, reconciliation, counts };
}

// ---------------------------------------------------------------------------
// small local finding builders
// ---------------------------------------------------------------------------

type LedgerAnyRow = (
  | IncomeLedgerRow
  | TaxPaidLedgerRow
  | DeductionLedgerRow
  | CapitalGainLedgerRow
  | HousePropertyLedgerRow
) & {
  id: string;
  source_type: string;
  source_document_id?: string | null;
  source_file_id?: string | null;
};

function docFinding(rule: string, d: ValidationDoc, severity: FindingSeverity, title: string, message: string): RunnerFinding {
  return {
    ruleCode: rule,
    findingKey: `${rule}:${d.id}`,
    category: "documents",
    severity,
    title,
    message,
    details: { documentName: d.name, status: d.status },
    subjectType: "document",
    subjectKey: d.id,
  };
}

function refFinding(rule: string, kind: string, id: string, severity: FindingSeverity, title: string, message: string): RunnerFinding {
  return {
    ruleCode: rule,
    findingKey: `${rule}:${id}`,
    category: "ledger",
    severity,
    title,
    message,
    details: { ledgerKind: kind },
    subjectType: "ledger_entry",
    subjectKey: id,
  };
}

function zeroFinding(kind: string, id: string, type: string): RunnerFinding {
  return {
    ruleCode: "ledger.zero_value",
    findingKey: `ledger.zero_value:${id}`,
    category: "ledger",
    severity: "info",
    title: "Zero-value ledger entry",
    message: `A ${kind} entry (${type}) has a zero amount and contributes nothing.`,
    details: { ledgerKind: kind, type },
    subjectType: "ledger_entry",
    subjectKey: id,
  };
}
