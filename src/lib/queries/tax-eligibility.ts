import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  assembleCompleteLedgerRows,
  buildEngineInput,
  hasMeaningfulInput,
  type AdapterResult,
} from "@/lib/tax-desk/computation-adapter";
import { classifyLedgerSupport } from "@/lib/tax-desk/ledger-support";
import {
  evaluateEligibility,
  type EligibilityResult,
  type SpecialSituationCode,
} from "@/lib/tax-desk/eligibility";
import { TAX_INCOME_ENGINE_ROW_PROJECTION } from "./tax-income-projection";

/**
 * Canonical server-side eligibility loader (K.2.8.9A). Assembles the
 * {@link evaluateEligibility} input from AUTHORITATIVE server data — profile
 * columns (+ the client's DOB), live ledger rows, and open validation findings —
 * then runs the one pure evaluator. Every UI page and server action that needs
 * eligibility calls THIS, so no surface re-derives conflicting logic.
 *
 * Runs with the SESSION client (RLS staff/admin). Never trusts a browser value.
 * No PAN / Aadhaar / notes / file URLs are selected.
 */

export interface TaxpayerProfileView {
  dateOfBirth: string | null;
  residentialStatus: string | null;
  taxpayerCategory: string | null;
  declaredSpecialSituations: SpecialSituationCode[];
  clientName: string;
  updatedAt: string | null;
}

export interface TaxCaseEligibility {
  taxCaseId: string;
  caseId: string;
  clientId: string;
  finalized: boolean;
  assessmentYear: string;
  financialYear: string;
  selectedItrType: string | null;
  profile: TaxpayerProfileView;
  /** Reusable adapter result (income/tax/deduction/CG mapping + warnings). */
  adapter: AdapterResult;
  /** Whether there is at least one meaningful (non-placeholder) tax figure. */
  hasMeaningfulData: boolean;
  result: EligibilityResult;
}

const PROFILE_SELECT =
  "id, case_id, client_id, assessment_year, financial_year, itr_type_selected, finalized_at, " +
  "residential_status, taxpayer_category, declared_special_situations, taxpayer_profile_updated_at, " +
  "clients:client_id(full_name, date_of_birth)";

export async function getTaxCaseEligibility(
  taxCaseId: string,
): Promise<TaxCaseEligibility | null> {
  const supabase = await createServerClient();

  const { data: tc } = await supabase.from("tax_cases").select(PROFILE_SELECT).eq("id", taxCaseId).maybeSingle();
  if (!tc) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tc as any;

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
    findings,
  ] =
    await Promise.all([
    live("tax_income_entries", TAX_INCOME_ENGINE_ROW_PROJECTION),
    live("tax_tax_paid_entries", "id, tax_paid_type, amount, source_type, source_document_id"),
    live(
      "tax_deduction_entries",
      "id, deduction_type, section_code, amount, source_type, source_document_id, proof_case_document_id, insured_party_senior",
    ),
    live(
      "tax_capital_gain_entries",
      "id, gain_type, sale_value, cost, expenses, exemption_claimed, taxable_gain, source_type, source_document_id",
    ),
    live(
      "tax_house_property_entries",
      "id, usage, annual_rent_received, municipal_taxes_paid, home_loan_interest, source_type, source_document_id, proof_case_document_id",
    ),
    // K4-14: same reason as the brought-forward note below — this layer must
    // see books-based rows, or a case the adapter refuses on Computation would
    // pass the eligibility/manifest gate.
    live(
      "tax_business_books_entries",
      "id, revenue, expenses, is_profession, adjustments, activity_classification, declared_turnover, book_depreciation, claims_additional_depreciation, depreciation_blocks, source_type, source_document_id, proof_case_document_id",
    ),
    // K4-10: this layer MUST see brought-forward rows too. `buildEngineInput`
    // is the single authority for `complete`, and the eligibility/manifest gate
    // reads it — omitting the rows here would let a case whose brought-forward
    // allocation the adapter refuses pass this gate while Computation refuses
    // it, which is the two-authorities-disagreeing class, not a shortcut.
    live("tax_brought_forward_loss_entries", "id, originating_assessment_year, loss_type, amount, filing_eligibility, loss_provenance, prior_tax_case_id, elected_set_off_target, source_type, source_document_id, proof_case_document_id"),
    supabase
      .from("tax_validation_findings")
      .select("severity, status")
      .eq("tax_case_id", taxCaseId)
      .eq("status", "open"),
  ]);

  const rows = assembleCompleteLedgerRows({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    income: (income.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    taxPaid: (taxPaid.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deductions: (deductions.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    capitalGains: (capitalGains.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    housePropertyEntries: (houseProperty.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    businessBooksEntries: (businessBooks.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    broughtForwardLosses: (broughtForwardLosses.data ?? []) as any[],
  });

  const meta = {
    assessmentYear: t.assessment_year,
    financialYear: t.financial_year,
    selectedItrType: t.itr_type_selected,
    finalized: !!t.finalized_at,
    dateOfBirth: t.clients?.date_of_birth ?? null,
    residentialStatus: t.residential_status ?? null,
  };
  const adapter = buildEngineInput(rows, meta);
  const support = classifyLedgerSupport(rows, meta);
  const meaningful = hasMeaningfulInput(adapter);

  const findRows = (findings.data ?? []) as { severity: string; status: string }[];
  const openBlocking = findRows.filter((f) => f.severity === "error" || f.severity === "blocker").length;
  const openWarning = findRows.filter((f) => f.severity === "warning").length;

  const declared = (t.declared_special_situations ?? []) as SpecialSituationCode[];

  const result = evaluateEligibility({
    profile: {
      dateOfBirth: t.clients?.date_of_birth ?? null,
      residentialStatus: t.residential_status ?? null,
      taxpayerCategory: t.taxpayer_category ?? null,
      assessmentYear: t.assessment_year,
    },
    data: {
      hasMeaningfulData: meaningful,
      unsupportedEntries: support.entries.map((e) => ({
        ledgerId: e.ledgerId,
        entryType: e.entryType,
        code: e.code,
      })),
    },
    declaredSpecialSituations: declared,
    validation: { openBlocking, openWarning },
  });

  return {
    taxCaseId: t.id,
    caseId: t.case_id,
    clientId: t.client_id,
    finalized: !!t.finalized_at,
    assessmentYear: t.assessment_year,
    financialYear: t.financial_year,
    selectedItrType: t.itr_type_selected,
    profile: {
      dateOfBirth: t.clients?.date_of_birth ?? null,
      residentialStatus: t.residential_status ?? null,
      taxpayerCategory: t.taxpayer_category ?? null,
      declaredSpecialSituations: declared,
      clientName: t.clients?.full_name ?? "—",
      updatedAt: t.taxpayer_profile_updated_at ?? null,
    },
    adapter,
    hasMeaningfulData: meaningful,
    result,
  };
}
