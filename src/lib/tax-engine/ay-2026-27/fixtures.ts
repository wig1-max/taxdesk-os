/**
 * Deterministic fixture inputs for the AY 2026-27 engine. PURE — no imports
 * except local types. Used by unit tests and safe to reuse for previews.
 *
 * These are illustrative preparation-only cases — NOT real client data.
 */

import type { TaxEngineInput } from "./types";

const AY = "2026-27";
const FY = "2025-26";

const baseTaxpayer = {
  residentStatus: "resident" as const,
  ageCategory: "below_60" as const,
};

/**
 * 1. Simple salaried refund case.
 *    Salary + interest, TDS greater than tax payable, no capital gains.
 *    Expected: new regime, nil tax after 87A rebate, refund of the TDS.
 */
export const simpleSalariedRefundCase: TaxEngineInput = {
  assessmentYear: AY,
  financialYear: FY,
  taxpayer: baseTaxpayer,
  selectedItrType: "ITR-1",
  clientApprovalStatus: "pending",
  filingStatus: "in_preparation",
  eVerificationStatus: "not_applicable",
  finalized: false,
  requiredDocuments: [
    { code: "form16", label: "Form 16", required: true, status: "received" },
  ],
  income: [
    { id: "inc_salary_1", category: "salary", amount: 800_000, sourceType: "Form16", sourceDocumentId: "doc_form16" },
    { id: "inc_sav_1", category: "savings_interest", amount: 5_000, sourceType: "manual" },
    { id: "inc_fd_1", category: "fd_interest", amount: 20_000, sourceType: "manual" },
  ],
  taxPaid: [
    { id: "tp_tds_1", category: "salary_tds", amount: 60_000, sourceType: "Form16", sourceDocumentId: "doc_form16" },
  ],
  deductions: [],
  capitalGains: [],
  sourceRecordIds: ["ledger_row_1", "ledger_row_2"],
};

/**
 * 2. Salary + capital gains case.
 *    Salary, FD interest, STCG u/s 111A and LTCG u/s 112A.
 *    ITR-1 is (deliberately) selected so validation blocks it; recommendation
 *    should be ITR-2.
 */
export const salaryCapitalGainsCase: TaxEngineInput = {
  assessmentYear: AY,
  financialYear: FY,
  taxpayer: baseTaxpayer,
  selectedItrType: "ITR-1",
  clientApprovalStatus: "pending",
  filingStatus: "in_preparation",
  eVerificationStatus: "not_applicable",
  finalized: false,
  requiredDocuments: [
    { code: "form16", label: "Form 16", required: true, status: "received" },
    { code: "broker_pnl", label: "Broker capital-gains statement", required: true, status: "received" },
  ],
  income: [
    { id: "inc_salary_1", category: "salary", amount: 1_200_000, sourceType: "Form16", sourceDocumentId: "doc_form16" },
    { id: "inc_fd_1", category: "fd_interest", amount: 40_000, sourceType: "bank_certificate", sourceDocumentId: "doc_bank" },
  ],
  taxPaid: [
    { id: "tp_tds_1", category: "salary_tds", amount: 90_000, sourceType: "Form16", sourceDocumentId: "doc_form16" },
  ],
  deductions: [],
  capitalGains: [
    {
      id: "cg_stcg_1",
      category: "stcg_111a",
      amount: 100_000,
      taxable_gain: 100_000,
      sourceType: "broker_report",
      source_document_id: "doc_broker",
    },
    {
      id: "cg_ltcg_1",
      category: "ltcg_112a",
      amount: 200_000,
      taxable_gain: 200_000,
      sourceType: "broker_report",
      source_document_id: "doc_broker",
    },
  ],
  sourceRecordIds: ["ledger_row_10", "ledger_row_11"],
};

/**
 * 3. Reconciliation mismatch case.
 *    AIS reports FD interest that was never entered; Form 26AS shows non-salary
 *    TDS with no mapped income; a required document is missing.
 *    Expected: reconciliation + document validation warnings.
 */
export const reconciliationMismatchCase: TaxEngineInput = {
  assessmentYear: AY,
  financialYear: FY,
  taxpayer: baseTaxpayer,
  selectedItrType: "ITR-1",
  clientApprovalStatus: "pending",
  filingStatus: "in_preparation",
  eVerificationStatus: "not_applicable",
  finalized: false,
  requiredDocuments: [
    { code: "form16", label: "Form 16", required: true, status: "received" },
    { code: "bank_certificate", label: "Bank interest certificate", required: true, status: "missing" },
  ],
  income: [
    { id: "inc_salary_1", category: "salary", amount: 600_000, sourceType: "manual" },
    // Reported by AIS but NOT entered by the taxpayer (no manual interest entry).
    { id: "inc_fd_ais", category: "fd_interest", amount: 30_000, sourceType: "AIS", sourceDocumentId: "doc_ais" },
  ],
  taxPaid: [
    { id: "tp_salary_tds", category: "salary_tds", amount: 10_000, sourceType: "manual" },
    // 26AS non-salary TDS with no manually-entered non-salary income to map it to.
    { id: "tp_nonsal_tds", category: "non_salary_tds", amount: 3_000, sourceType: "26AS", sourceDocumentId: "doc_26as" },
  ],
  deductions: [],
  capitalGains: [],
  sourceRecordIds: ["ledger_row_20"],
};
