import { createClient as createServerClient } from "@/lib/supabase/server";
import { TAX_INCOME_ENGINE_ROW_PROJECTION } from "./tax-income-projection";
import {
  DOC_SATISFIED_STATUSES,
  summarizeChecklist,
  type ChecklistDoc,
  type ChecklistSummary,
} from "@/lib/tax-desk/checklist";
import { isTaxCaseLocked, sumField } from "@/lib/tax-desk/ledger";
import type {
  BroughtForwardLossLedgerRow,
  CapitalGainLedgerRow,
  DeductionLedgerRow,
  BusinessBooksLedgerRow,
  HousePropertyLedgerRow,
  IncomeLedgerRow,
  LedgerRows,
  TaxPaidLedgerRow,
} from "@/lib/tax-desk/computation-adapter";
import {
  buildReconciliation,
  type ReconciliationSummary,
  type ValidationDoc,
} from "@/lib/tax-desk/validation-runner";
import { deriveValidationRun } from "@/lib/tax-desk/validation-run";
import {
  assembleClientReviewPack,
  type ApprovalMethod,
  type ReviewPackModel,
  type ReviewRecord,
  type ReviewSnapshot,
  type ReviewStatus,
} from "@/lib/tax-desk/client-review-pack";

/**
 * Tax Desk read-only queries (K.2.1–K.2.3). Metric cards, case list, and the
 * document/checklist view. NO ledger CRUD, NO computation — those arrive
 * later. All queries run with the SESSION client, so RLS applies.
 */

export interface TaxDeskMetric {
  key: string;
  label: string;
  count: number;
  tone?: "amber" | "red";
}

/** Raw counts the metric cards are built from. Kept separate so the
 *  mapping stays a pure, unit-testable function. */
export interface TaxDeskCounts {
  total: number;
  docsPending: number;
  computationPending: number;
  clientApprovalPending: number;
  filingPending: number;
  eVerificationPending: number;
  closed: number;
  blockerFindings: number;
}

/** case_status buckets that count as "computation pending" (pre-review). */
export const COMPUTATION_PENDING_STATUSES = [
  "data_entry_pending",
  "reconciliation_pending",
  "computation_ready",
] as const;

/** Pure: turn raw counts into the ordered metric cards the page renders. */
export function buildTaxDeskMetrics(c: TaxDeskCounts): TaxDeskMetric[] {
  return [
    { key: "total", label: "Total ITR prep cases", count: c.total },
    { key: "docs_pending", label: "Docs pending", count: c.docsPending, tone: "amber" },
    { key: "computation_pending", label: "Computation pending", count: c.computationPending, tone: "amber" },
    { key: "client_approval_pending", label: "Client approval pending", count: c.clientApprovalPending, tone: "amber" },
    { key: "filing_pending", label: "Filing pending", count: c.filingPending, tone: "amber" },
    { key: "everification_pending", label: "E-verification pending", count: c.eVerificationPending, tone: "amber" },
    { key: "closed", label: "Closed cases", count: c.closed },
    { key: "blocker_findings", label: "High-risk / blocker findings", count: c.blockerFindings, tone: "red" },
  ];
}

export async function getTaxDeskOverview(): Promise<{
  counts: TaxDeskCounts;
  metrics: TaxDeskMetric[];
  isEmpty: boolean;
}> {
  const supabase = await createServerClient();
  const exact = { count: "exact" as const, head: true };

  const [
    taxRows,
    computationPending,
    clientApprovalPending,
    filingPending,
    eVerificationPending,
    closed,
    blockerFindings,
  ] = await Promise.all([
    // Fetch tax-case parent ids once — used for total + the docs-pending join.
    supabase.from("tax_cases").select("id, case_id"),
    supabase
      .from("tax_cases")
      .select("id", exact)
      .in("case_status", [...COMPUTATION_PENDING_STATUSES]),
    // "Client approval pending" = review sent to the client, awaiting response.
    // Reads the authoritative client_review_status (K.2.7), not the legacy field.
    supabase.from("tax_cases").select("id", exact).eq("client_review_status", "sent"),
    supabase.from("tax_cases").select("id", exact).eq("filing_status", "portal_filing_pending"),
    supabase.from("tax_cases").select("id", exact).eq("e_verification_status", "pending"),
    supabase.from("tax_cases").select("id", exact).eq("case_status", "closed"),
    supabase
      .from("tax_validation_findings")
      .select("id", exact)
      .eq("severity", "blocker")
      .eq("status", "open"),
  ]);

  // Docs pending = tax cases whose parent case still has a REQUIRED
  // checklist item not received/verified/waived. One extra query, bounded
  // by the tax-case parent ids (no per-case fan-out).
  const parentCaseIds = (taxRows.data ?? []).map((r) => r.case_id);
  let docsPending = 0;
  if (parentCaseIds.length > 0) {
    const { data: outstanding } = await supabase
      .from("case_documents")
      .select("case_id")
      .in("case_id", parentCaseIds)
      .eq("is_required", true)
      .is("deleted_at", null)
      .not("status", "in", `(${DOC_SATISFIED_STATUSES.join(",")})`);
    docsPending = new Set((outstanding ?? []).map((d) => d.case_id)).size;
  }

  const counts: TaxDeskCounts = {
    total: (taxRows.data ?? []).length,
    docsPending,
    computationPending: computationPending.count ?? 0,
    clientApprovalPending: clientApprovalPending.count ?? 0,
    filingPending: filingPending.count ?? 0,
    eVerificationPending: eVerificationPending.count ?? 0,
    closed: closed.count ?? 0,
    blockerFindings: blockerFindings.count ?? 0,
  };

  return {
    counts,
    metrics: buildTaxDeskMetrics(counts),
    isEmpty: counts.total === 0,
  };
}

export interface TaxCaseListRow {
  id: string;
  case_id: string;
  case_display_code: string | null;
  client_name: string;
  assessment_year: string;
  case_status: string;
  /** Authoritative K.2.7 client-review lifecycle (not the legacy client_approval_status). */
  client_review_status: string;
  filing_status: string;
  e_verification_status: string;
  itr_type_selected: string | null;
  itr_type_recommended: string | null;
  assigned_staff_name: string | null;
  reviewer_name: string | null;
  updated_at: string;
}

const TAX_CASE_LIST_SELECT =
  "id, case_id, assessment_year, case_status, client_review_status, filing_status, " +
  "e_verification_status, itr_type_selected, itr_type_recommended, updated_at, " +
  "cases:case_id(display_code), clients:client_id(full_name), " +
  "assigned:assigned_staff_id(full_name), reviewer:reviewer_id(full_name)";

/** Read-only tax-case list. Joins case display code + client name (safe
 *  columns only; PAN is never selected here). */
export async function getTaxCasesList(): Promise<TaxCaseListRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("tax_cases")
    .select(TAX_CASE_LIST_SELECT)
    .order("updated_at", { ascending: false })
    .limit(200);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    case_id: r.case_id,
    case_display_code: r.cases?.display_code ?? null,
    client_name: r.clients?.full_name ?? "—",
    assessment_year: r.assessment_year,
    case_status: r.case_status,
    client_review_status: r.client_review_status,
    filing_status: r.filing_status,
    e_verification_status: r.e_verification_status,
    itr_type_selected: r.itr_type_selected,
    itr_type_recommended: r.itr_type_recommended,
    assigned_staff_name: r.assigned?.full_name ?? null,
    reviewer_name: r.reviewer?.full_name ?? null,
    updated_at: r.updated_at,
  }));
}

export interface TaxCaseFile {
  id: string;
  case_document_id: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  review_status: string;
  uploaded_via: string;
  contains_aadhaar: boolean;
  created_at: string;
}

export interface TaxCaseDocsView {
  taxCaseId: string;
  caseId: string;
  caseDisplayCode: string | null;
  caseTitle: string | null;
  clientName: string;
  assessmentYear: string;
  financialYear: string;
  aadhaarRequired: boolean;
  docs: (ChecklistDoc & { requirement_id: string | null })[];
  files: TaxCaseFile[];
  summary: ChecklistSummary;
}

/**
 * Read the parent-case checklist + files for a Tax Desk case's Documents page.
 * Reuses the existing case_documents / uploaded_files tables via the parent
 * case (no separate tax_case_documents table). PAN is never selected; file
 * access is app-routed (/api/files/:id), never a public storage URL.
 */
export async function getTaxCaseDocumentsView(
  taxCaseId: string,
): Promise<TaxCaseDocsView | null> {
  const supabase = await createServerClient();
  const { data: tc } = await supabase
    .from("tax_cases")
    .select(
      "id, case_id, assessment_year, financial_year, " +
        "cases:case_id(display_code, title, aadhaar_required), clients:client_id(full_name)",
    )
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!tc) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tc as any;
  const caseId: string = t.case_id;

  const [{ data: docRows }, { data: fileRows }] = await Promise.all([
    supabase
      .from("case_documents")
      .select("id, name, status, is_required, waived_reason, notes, requirement_id")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("uploaded_files")
      .select(
        "id, case_document_id, original_filename, mime_type, size_bytes, review_status, uploaded_via, contains_aadhaar, created_at",
      )
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const docs = (docRows ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status,
    is_required: d.is_required,
    waived_reason: d.waived_reason,
    notes: d.notes,
    requirement_id: d.requirement_id,
  }));

  return {
    taxCaseId: t.id,
    caseId,
    caseDisplayCode: t.cases?.display_code ?? null,
    caseTitle: t.cases?.title ?? null,
    clientName: t.clients?.full_name ?? "—",
    assessmentYear: t.assessment_year,
    financialYear: t.financial_year,
    aadhaarRequired: t.cases?.aadhaar_required ?? false,
    docs,
    files: (fileRows ?? []) as TaxCaseFile[],
    summary: summarizeChecklist(docs),
  };
}

// ---------------------------------------------------------------------------
// Ledgers view (K.2.4)
// ---------------------------------------------------------------------------

export interface LedgerRow {
  id: string;
  source_type: string;
  source_document_id: string | null;
  source_file_id: string | null;
  source_document_name: string | null;
  source_file_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // kind-specific fields are carried through as-is:
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface TaxCaseLedgersView {
  taxCaseId: string;
  caseId: string;
  caseDisplayCode: string | null;
  caseTitle: string | null;
  clientName: string;
  assessmentYear: string;
  financialYear: string;
  locked: boolean;
  income: LedgerRow[];
  taxPaid: LedgerRow[];
  deductions: LedgerRow[];
  capitalGains: LedgerRow[];
  houseProperty: LedgerRow[];
  /** K4-14: books-based business or profession (Sections 28/29). */
  businessBooks: LedgerRow[];
  /** K4-10: prior-year capital losses brought forward (Section 74). */
  broughtForwardLosses: LedgerRow[];
  totals: {
    income: number;
    taxPaid: number;
    deductions: number;
    capitalGainsTaxable: number;
    houseProperty: number;
    businessBooksNetProfit: number;
    broughtForwardLoss: number;
  };
  docOptions: { id: string; label: string }[];
  fileOptions: { id: string; label: string }[];
}

/**
 * Read the four live (non-deleted) ledgers for a Tax Desk case, plus the parent
 * case documents/files used for optional source mapping. PAN is never selected.
 */
export async function getTaxCaseLedgers(taxCaseId: string): Promise<TaxCaseLedgersView | null> {
  const supabase = await createServerClient();
  const { data: tc } = await supabase
    .from("tax_cases")
    .select(
      "id, case_id, assessment_year, financial_year, finalized_at, " +
        "cases:case_id(display_code, title), clients:client_id(full_name)",
    )
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!tc) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tc as any;
  const caseId: string = t.case_id;

  const live = (table: string, cols: string) =>
    supabase
      .from(table)
      .select(cols)
      .eq("tax_case_id", taxCaseId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

  const [
    income,
    taxPaid,
    deductions,
    capitalGains,
    houseProperty,
    businessBooks,
    broughtForwardLosses,
    docs,
    files,
  ] =
    await Promise.all([
    live(
      "tax_income_entries",
      `${TAX_INCOME_ENGINE_ROW_PROJECTION}, source_file_id, notes, created_at, updated_at`,
    ),
    live(
      "tax_tax_paid_entries",
      "id, tax_paid_type, amount, source_type, source_document_id, source_file_id, notes, created_at, updated_at",
    ),
    live(
      "tax_deduction_entries",
      "id, deduction_type, section_code, amount, source_type, source_document_id, source_file_id, proof_case_document_id, insured_party_senior, notes, created_at, updated_at",
    ),
    live(
      "tax_capital_gain_entries",
      "id, gain_type, sale_value, cost, expenses, exemption_claimed, taxable_gain, transfer_date, acquisition_date, stamp_duty_value, asset_kind, acquisition_mode, cost_of_improvement, house_sale_declarations, source_type, source_document_id, source_file_id, notes, created_at, updated_at",
    ),
    live(
      "tax_house_property_entries",
      "id, usage, annual_rent_received, municipal_taxes_paid, home_loan_interest, source_type, source_document_id, source_file_id, proof_case_document_id, notes, created_at, updated_at",
    ),
    live(
      "tax_business_books_entries",
      "id, revenue, expenses, is_profession, adjustments, activity_classification, declared_turnover, book_depreciation, claims_additional_depreciation, depreciation_blocks, source_type, source_document_id, source_file_id, proof_case_document_id, notes, created_at, updated_at",
    ),
    live(
      "tax_brought_forward_loss_entries",
      "id, originating_assessment_year, loss_type, amount, filing_eligibility, loss_provenance, prior_tax_case_id, elected_set_off_target, source_type, source_document_id, source_file_id, proof_case_document_id, notes, created_at, updated_at",
    ),
    supabase
      .from("case_documents")
      .select("id, name")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("uploaded_files")
      .select("id, original_filename")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const docMap = new Map((docs.data ?? []).map((d) => [d.id, d.name]));
  const fileMap = new Map((files.data ?? []).map((f) => [f.id, f.original_filename]));

  const decorate = (rows: LedgerRow[] | null): LedgerRow[] =>
    (rows ?? []).map((r) => ({
      ...r,
      source_document_name: r.source_document_id ? (docMap.get(r.source_document_id) ?? null) : null,
      source_file_name: r.source_file_id ? (fileMap.get(r.source_file_id) ?? null) : null,
      proof_document_name: r.proof_case_document_id
        ? (docMap.get(r.proof_case_document_id) ?? null)
        : null,
    }));

  const incomeRows = decorate(income.data as unknown as LedgerRow[]);
  const taxPaidRows = decorate(taxPaid.data as unknown as LedgerRow[]);
  const deductionRows = decorate(deductions.data as unknown as LedgerRow[]);
  const capitalGainRows = decorate(capitalGains.data as unknown as LedgerRow[]);
  // K4-06: a raw, un-regime-adjusted at-a-glance figure for the row list —
  // rent received minus municipal taxes minus interest (self-occupied rows
  // are 0/0/interest, so this is simply the negative of interest for those).
  // Never the actual computed tax figure (regime-aware caps/set-off live
  // only in `computeHouseProperty`, engine-side) — matches how every other
  // ledger category's list total is a raw entered sum, not a post-cap value.
  const housePropertyRows = decorate(houseProperty.data as unknown as LedgerRow[]).map((r) => ({
    ...r,
    net_estimate:
      Number(r.annual_rent_received ?? 0) - Number(r.municipal_taxes_paid ?? 0) - Number(r.home_loan_interest ?? 0),
  }));

  // K4-14: the raw declared net profit for the row list — revenue minus
  // expenses, exactly as entered. It happens to equal the computed figure
  // today because this slice applies no Sections 30-43D adjustment; that is a
  // coincidence of scope, not a contract, and `computeBusinessBooksIncome`
  // remains the only authority for the taxable figure. Matches how every other
  // ledger category's list total is a raw entered sum.
  const businessBooksRows = decorate(businessBooks.data as unknown as LedgerRow[]).map((r) => ({
    ...r,
    net_estimate: Number(r.revenue ?? 0) - Number(r.expenses ?? 0),
  }));

  const broughtForwardLossRows = decorate(broughtForwardLosses.data as unknown as LedgerRow[]);

  return {
    taxCaseId: t.id,
    caseId,
    caseDisplayCode: t.cases?.display_code ?? null,
    caseTitle: t.cases?.title ?? null,
    clientName: t.clients?.full_name ?? "—",
    assessmentYear: t.assessment_year,
    financialYear: t.financial_year,
    locked: isTaxCaseLocked(t.finalized_at),
    income: incomeRows,
    taxPaid: taxPaidRows,
    deductions: deductionRows,
    capitalGains: capitalGainRows,
    houseProperty: housePropertyRows,
    businessBooks: businessBooksRows,
    broughtForwardLosses: broughtForwardLossRows,
    totals: {
      income: sumField(incomeRows, (r) => r.amount),
      taxPaid: sumField(taxPaidRows, (r) => r.amount),
      deductions: sumField(deductionRows, (r) => r.amount),
      capitalGainsTaxable: sumField(capitalGainRows, (r) => r.taxable_gain),
      houseProperty: sumField(housePropertyRows, (r) => r.net_estimate),
      businessBooksNetProfit: sumField(businessBooksRows, (r) => r.net_estimate),
      // K4-10: the raw declared carry-forward total, not the amount that will
      // actually be absorbed — that depends on the gains available and on the
      // expiry / filing-eligibility classification the engine performs.
      broughtForwardLoss: sumField(broughtForwardLossRows, (r) => r.amount),
    },
    docOptions: (docs.data ?? []).map((d) => ({ id: d.id, label: d.name })),
    fileOptions: (files.data ?? []).map((f) => ({ id: f.id, label: f.original_filename })),
  };
}

// ---------------------------------------------------------------------------
// Computation data + snapshots (K.2.5)
// ---------------------------------------------------------------------------

export interface SnapshotSummary {
  id: string;
  created_at: string;
  created_by_name: string | null;
  rules_version: string;
  complete: boolean;
  selected_itr_type: string | null;
  recommended_itr_type: string | null;
  recommended_regime: string | null;
  mapped_entry_count: number;
  unsupported_entry_count: number;
}

export interface TaxCaseComputationData {
  taxCaseId: string;
  caseId: string;
  caseDisplayCode: string | null;
  caseTitle: string | null;
  clientName: string;
  assessmentYear: string;
  financialYear: string;
  /** Statutory basis stored on the case (`K4-PORT-05`). */
  law: string;
  selectedItrType: string | null;
  finalized: boolean;
  /** K4-01: reused from clients.date_of_birth / tax_cases.residential_status —
   *  drives the real age-band derivation and senior-treatment risk evaluation
   *  (never hardcoded "below_60"/"resident" from here on). */
  dateOfBirth: string | null;
  residentialStatus: string | null;
  /** Authoritative case-level validation-run marker (Phase 3 / K.2.9.3). Written
   *  on EVERY validation refresh incl. a zero-finding run — NOT inferred from
   *  findings. Read through {@link deriveValidationRun}. */
  validationLastRunAt: string | null;
  validationRulesVersion: string | null;
  rows: LedgerRows;
  snapshots: SnapshotSummary[];
}

/** Load everything the computation page needs: case meta, live ledger rows
 *  (decorated with source doc/file labels), and snapshot history. No PAN. */
export async function getTaxCaseComputationData(
  taxCaseId: string,
): Promise<TaxCaseComputationData | null> {
  const supabase = await createServerClient();
  const { data: tc } = await supabase
    .from("tax_cases")
    .select(
      "id, case_id, assessment_year, financial_year, law, itr_type_selected, finalized_at, " +
        "validation_last_run_at, validation_rules_version, residential_status, " +
        "cases:case_id(display_code, title), clients:client_id(full_name, date_of_birth)",
    )
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!tc) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tc as any;
  const caseId: string = t.case_id;

  const live = (table: string, cols: string) =>
    supabase.from(table).select(cols).eq("tax_case_id", taxCaseId).is("deleted_at", null).order("created_at");

  const [
    income,
    taxPaid,
    deductions,
    capitalGains,
    houseProperty,
    businessBooks,
    broughtForwardLosses,
    docs,
    files,
    snaps,
  ] =
    await Promise.all([
    live(
      "tax_income_entries",
      `${TAX_INCOME_ENGINE_ROW_PROJECTION}, source_file_id`,
    ),
    live("tax_tax_paid_entries", "id, tax_paid_type, amount, source_type, source_document_id, source_file_id"),
    live(
      "tax_deduction_entries",
      "id, deduction_type, section_code, amount, source_type, source_document_id, proof_case_document_id, source_file_id, insured_party_senior",
    ),
    live(
      "tax_capital_gain_entries",
      "id, gain_type, sale_value, cost, expenses, exemption_claimed, taxable_gain, transfer_date, acquisition_date, stamp_duty_value, asset_kind, acquisition_mode, cost_of_improvement, house_sale_declarations, source_type, source_document_id, source_file_id",
    ),
    live(
      "tax_house_property_entries",
      "id, usage, annual_rent_received, municipal_taxes_paid, home_loan_interest, source_type, source_document_id, proof_case_document_id, source_file_id",
    ),
    live(
      "tax_business_books_entries",
      "id, revenue, expenses, is_profession, adjustments, activity_classification, declared_turnover, book_depreciation, claims_additional_depreciation, depreciation_blocks, source_type, source_document_id, proof_case_document_id, source_file_id",
    ),
    live(
      "tax_brought_forward_loss_entries",
      "id, originating_assessment_year, loss_type, amount, filing_eligibility, loss_provenance, prior_tax_case_id, elected_set_off_target, source_type, source_document_id, proof_case_document_id, source_file_id",
    ),
    supabase.from("case_documents").select("id, name").eq("case_id", caseId).is("deleted_at", null),
    supabase.from("uploaded_files").select("id, original_filename").eq("case_id", caseId).is("deleted_at", null),
    supabase
      .from("tax_computation_snapshots")
      .select("id, rules_version, input_snapshot, output_snapshot, created_at, created_by, users:created_by(full_name)")
      .eq("tax_case_id", taxCaseId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const docMap = new Map((docs.data ?? []).map((d) => [d.id, d.name]));
  const fileMap = new Map((files.data ?? []).map((f) => [f.id, f.original_filename]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decorate = <T extends Record<string, any>>(rows: T[] | null): T[] =>
    (rows ?? []).map((r) => ({
      ...r,
      source_document_name: r.source_document_id ? (docMap.get(r.source_document_id) ?? null) : null,
      source_file_name: r.source_file_id ? (fileMap.get(r.source_file_id) ?? null) : null,
    }));

  const rows: LedgerRows = {
    income: decorate(income.data as unknown as IncomeLedgerRow[]),
    taxPaid: decorate(taxPaid.data as unknown as TaxPaidLedgerRow[]),
    deductions: decorate(deductions.data as unknown as DeductionLedgerRow[]),
    capitalGains: decorate(capitalGains.data as unknown as CapitalGainLedgerRow[]),
    housePropertyEntries: decorate(houseProperty.data as unknown as HousePropertyLedgerRow[]),
    businessBooksEntries: decorate(businessBooks.data as unknown as BusinessBooksLedgerRow[]),
    broughtForwardLosses: decorate(broughtForwardLosses.data as unknown as BroughtForwardLossLedgerRow[]),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshots: SnapshotSummary[] = ((snaps.data ?? []) as any[]).map((s) => {
    const input = (s.input_snapshot ?? {}) as Record<string, unknown>;
    const output = (s.output_snapshot ?? {}) as Record<string, unknown>;
    const computation = (output.computation ?? {}) as Record<string, unknown>;
    return {
      id: s.id,
      created_at: s.created_at,
      created_by_name: s.users?.full_name ?? null,
      rules_version: s.rules_version,
      complete: input.complete === true,
      selected_itr_type: (input.selectedItrType as string | null) ?? null,
      recommended_itr_type: (input.recommendedItrType as string | null) ?? null,
      recommended_regime: (computation.recommendedRegime as string | null) ?? null,
      mapped_entry_count: Number(input.mappedEntryCount ?? 0),
      unsupported_entry_count: Number(input.unsupportedEntryCount ?? 0),
    };
  });

  return {
    taxCaseId: t.id,
    caseId,
    caseDisplayCode: t.cases?.display_code ?? null,
    caseTitle: t.cases?.title ?? null,
    clientName: t.clients?.full_name ?? "—",
    assessmentYear: t.assessment_year,
    financialYear: t.financial_year,
    law: t.law ?? "ITA_1961",
    selectedItrType: t.itr_type_selected,
    finalized: !!t.finalized_at,
    validationLastRunAt: t.validation_last_run_at ?? null,
    validationRulesVersion: t.validation_rules_version ?? null,
    dateOfBirth: t.clients?.date_of_birth ?? null,
    residentialStatus: t.residential_status ?? null,
    rows,
    snapshots,
  };
}

// ---------------------------------------------------------------------------
// Validation view (K.2.6)
// ---------------------------------------------------------------------------

export interface ValidationFindingRow {
  id: string;
  rule_code: string;
  finding_key: string | null;
  category: string;
  severity: string;
  title: string | null;
  message: string;
  details: Record<string, unknown>;
  source_value: number | null;
  entered_value: number | null;
  difference: number | null;
  suggested_action: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  resolver_name: string | null;
  resolution_note: string | null;
}

export interface TaxCaseValidationView {
  taxCaseId: string;
  caseId: string;
  caseDisplayCode: string | null;
  caseTitle: string | null;
  clientName: string;
  assessmentYear: string;
  financialYear: string;
  law: string;
  selectedItrType: string | null;
  finalized: boolean;
  dateOfBirth: string | null;
  residentialStatus: string | null;
  rows: LedgerRows;
  documents: ValidationDoc[];
  validFileIds: string[];
  reconciliation: ReconciliationSummary;
  findings: ValidationFindingRow[];
  counts: { openError: number; openWarning: number; openInfo: number; resolved: number };
  /** Authoritative validation-run marker (Phase 3 / K.2.9.3), from the case-level
   *  run record — NOT inferred from findings. `runExists`/`lastRunAt` move on
   *  EVERY run, including a zero-finding run. */
  runExists: boolean;
  lastRunAt: string | null;
  rulesVersion: string | null;
}

/** Load everything the Validation page + refresh action need. Reuses the
 *  computation data loader for ledger rows + case meta. No PAN. */
export async function getTaxCaseValidationView(taxCaseId: string): Promise<TaxCaseValidationView | null> {
  const base = await getTaxCaseComputationData(taxCaseId);
  if (!base) return null;

  const supabase = await createServerClient();
  const [{ data: docs }, { data: files }, { data: findingRows }] = await Promise.all([
    supabase
      .from("case_documents")
      .select("id, name, status, is_required")
      .eq("case_id", base.caseId)
      .is("deleted_at", null)
      .order("created_at"),
    supabase.from("uploaded_files").select("id").eq("case_id", base.caseId).is("deleted_at", null),
    supabase
      .from("tax_validation_findings")
      .select(
        "id, code, finding_key, area, severity, title, message, details, source_value, entered_value, difference, suggested_action, status, created_at, last_seen_at, resolved_at, resolution_note, resolver:resolved_by(full_name)",
      )
      .eq("tax_case_id", taxCaseId)
      .order("severity")
      .order("created_at"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findings: ValidationFindingRow[] = ((findingRows ?? []) as any[]).map((r) => ({
    id: r.id,
    rule_code: r.code,
    finding_key: r.finding_key,
    category: r.area,
    severity: r.severity,
    title: r.title,
    message: r.message,
    details: (r.details ?? {}) as Record<string, unknown>,
    source_value: r.source_value,
    entered_value: r.entered_value,
    difference: r.difference,
    suggested_action: r.suggested_action,
    status: r.status,
    first_seen_at: r.created_at,
    last_seen_at: r.last_seen_at,
    resolved_at: r.resolved_at,
    resolver_name: r.resolver?.full_name ?? null,
    resolution_note: r.resolution_note,
  }));

  const isOpen = (f: ValidationFindingRow) => f.status === "open";
  const counts = {
    openError: findings.filter((f) => isOpen(f) && f.severity === "error").length,
    openWarning: findings.filter((f) => isOpen(f) && f.severity === "warning").length,
    openInfo: findings.filter((f) => isOpen(f) && f.severity === "info").length,
    resolved: findings.filter((f) => f.status !== "open").length,
  };
  // Authoritative validation-run marker (Phase 3): read the case-level run
  // record, NOT max(last_seen_at) over findings — so a zero-finding run is still
  // a visible run, and this page can never disagree with the workbench rail.
  const runMarker = deriveValidationRun({
    validation_last_run_at: base.validationLastRunAt,
    validation_rules_version: base.validationRulesVersion,
  });

  return {
    taxCaseId: base.taxCaseId,
    caseId: base.caseId,
    caseDisplayCode: base.caseDisplayCode,
    caseTitle: base.caseTitle,
    clientName: base.clientName,
    assessmentYear: base.assessmentYear,
    financialYear: base.financialYear,
    law: base.law,
    selectedItrType: base.selectedItrType,
    finalized: base.finalized,
    dateOfBirth: base.dateOfBirth,
    residentialStatus: base.residentialStatus,
    rows: base.rows,
    documents: (docs ?? []).map((d) => ({ id: d.id, name: d.name, status: d.status, is_required: d.is_required })),
    validFileIds: (files ?? []).map((f) => f.id),
    reconciliation: buildReconciliation(base.rows),
    findings,
    counts,
    runExists: runMarker.runExists,
    lastRunAt: runMarker.lastRunAt,
    rulesVersion: runMarker.rulesVersion,
  };
}

// ---------------------------------------------------------------------------
// Client Review Pack view (K.2.7)
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** Read a `{ value }` ComputedValue safely. */
const cval = (v: unknown): number => num((v as { value?: unknown } | null)?.value);

/** Parse one immutable snapshot row into the safe {@link ReviewSnapshot} shape. */
function parseReviewSnapshot(row: {
  id: string;
  rules_version: string;
  input_snapshot: unknown;
  output_snapshot: unknown;
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  users?: any;
}): ReviewSnapshot {
  const input = (row.input_snapshot ?? {}) as Record<string, unknown>;
  const output = (row.output_snapshot ?? {}) as Record<string, unknown>;
  const summaryIn = (input.summary ?? {}) as Record<string, unknown>;
  const comp = (output.computation ?? {}) as Record<string, unknown>;

  return {
    id: row.id,
    createdAt: row.created_at,
    rulesVersion: row.rules_version,
    complete: input.complete === true,
    selectedItrType: (input.selectedItrType as string | null) ?? null,
    recommendedItrType: (input.recommendedItrType as string | null) ?? null,
    createdByName: row.users?.full_name ?? null,
    summary: {
      salary: num(summaryIn.salary),
      interest: num(summaryIn.interest),
      dividendOther: num(summaryIn.dividendOther),
      exempt: num(summaryIn.exempt),
      deductions: num(summaryIn.deductions),
      stcg111a: num(summaryIn.stcg111a),
      ltcg112a: num(summaryIn.ltcg112a),
      totalTaxPaid: num(summaryIn.totalTaxPaid),
    },
    tax: {
      grossTotalIncome: cval(comp.grossTotalIncome),
      totalIncome: cval(comp.totalIncome),
      specialRateCapitalGains: cval(comp.specialRateCapitalGains),
      oldRegimeTax: cval(comp.oldRegimeTax),
      newRegimeTax: cval(comp.newRegimeTax),
      recommendedRegime: (comp.recommendedRegime as string | null) ?? null,
      rebate: cval(comp.rebate),
      cess: cval(comp.cess),
      taxPaid: cval(comp.taxPaid),
      refundOrPayable: cval(comp.refundOrPayable),
      unsupportedCount: Number(input.unsupportedEntryCount ?? 0) || 0,
    },
  };
}

export interface TaxCaseClientReviewView {
  taxCaseId: string;
  caseId: string;
  model: ReviewPackModel;
}

/**
 * Load everything the Client Review page + assembler need (K.2.7). Reuses the
 * K.2.6 validation view for documents / findings / reconciliation, parses the
 * immutable snapshots, reads the snapshot-bound review record, then hands it
 * all to the pure assembler. No PAN / Aadhaar / notes / file URLs. Returns null
 * when the tax case is not found (or RLS-filtered).
 */
export async function getTaxCaseClientReviewView(
  taxCaseId: string,
): Promise<TaxCaseClientReviewView | null> {
  const validation = await getTaxCaseValidationView(taxCaseId);
  if (!validation) return null;

  const supabase = await createServerClient();
  const [{ data: tc }, { data: snapRows }] = await Promise.all([
    supabase
      .from("tax_cases")
      .select(
        "id, itr_type_recommended, client_review_snapshot_id, client_review_status, " +
          "client_review_sent_at, client_approved_at, client_approval_method, client_approval_reference, " +
          "client_changes_requested_at, client_changes_summary, " +
          "sent_by:client_review_sent_by(full_name), " +
          "approved_by:client_approval_captured_by(full_name), " +
          "changes_by:client_changes_requested_by(full_name)",
      )
      .eq("id", taxCaseId)
      .maybeSingle(),
    supabase
      .from("tax_computation_snapshots")
      .select("id, rules_version, input_snapshot, output_snapshot, created_at, created_by, users:created_by(full_name)")
      .eq("tax_case_id", taxCaseId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (tc ?? {}) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshots: ReviewSnapshot[] = ((snapRows ?? []) as any[]).map(parseReviewSnapshot);
  const latestCompleteSnapshot = snapshots.find((s) => s.complete) ?? null;
  const reviewSnapshotId: string | null = t.client_review_snapshot_id ?? null;
  const reviewSnapshot = reviewSnapshotId ? (snapshots.find((s) => s.id === reviewSnapshotId) ?? null) : null;

  const docSummary = summarizeChecklist(
    validation.documents.map((d) => ({ id: d.id, name: d.name, status: d.status, is_required: d.is_required })),
  );

  const review: ReviewRecord = {
    status: (t.client_review_status as ReviewStatus) ?? "not_started",
    reviewSnapshotId,
    sentAt: t.client_review_sent_at ?? null,
    sentByName: t.sent_by?.full_name ?? null,
    approvedAt: t.client_approved_at ?? null,
    approvalCapturedByName: t.approved_by?.full_name ?? null,
    approvalMethod: (t.client_approval_method as ApprovalMethod | null) ?? null,
    approvalReference: t.client_approval_reference ?? null,
    changesRequestedAt: t.client_changes_requested_at ?? null,
    changesRequestedByName: t.changes_by?.full_name ?? null,
    changesSummary: t.client_changes_summary ?? null,
  };

  const model = assembleClientReviewPack({
    case: {
      taxCaseId: validation.taxCaseId,
      caseId: validation.caseId,
      caseDisplayCode: validation.caseDisplayCode,
      caseTitle: validation.caseTitle,
      clientName: validation.clientName,
      assessmentYear: validation.assessmentYear,
      financialYear: validation.financialYear,
      selectedItrType: validation.selectedItrType,
      recommendedItrType: (t.itr_type_recommended as string | null) ?? null,
      finalized: validation.finalized,
    },
    reviewSnapshot,
    latestCompleteSnapshot,
    documents: {
      requiredTotal: docSummary.required,
      missing: docSummary.missing,
      received: docSummary.received,
      verified: docSummary.verified,
      rejected: docSummary.rejected,
      requiredOutstanding: docSummary.requiredOutstanding,
    },
    validation: {
      openError: validation.counts.openError,
      openWarning: validation.counts.openWarning,
      openInfo: validation.counts.openInfo,
      resolved: validation.counts.resolved,
      openFindings: validation.findings
        .filter((f) => f.status === "open")
        .map((f) => ({
          ruleCode: f.rule_code,
          category: f.category,
          severity: f.severity,
          title: f.title ?? f.rule_code,
        })),
    },
    reconciliation: {
      groups: validation.reconciliation.groups.map((g) => ({
        category: g.category,
        key: g.key,
        total: g.total,
        rows: g.rows.map((r) => ({ sourceType: r.sourceType, total: r.total, count: r.count })),
      })),
      pairs: validation.reconciliation.pairs.map((p) => ({
        label: p.label,
        sourceA: p.sourceA,
        totalA: p.totalA,
        sourceB: p.sourceB,
        totalB: p.totalB,
        delta: p.delta,
        mismatch: p.mismatch,
      })),
    },
    review,
  });

  return { taxCaseId: validation.taxCaseId, caseId: validation.caseId, model };
}
