import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  assembleCompleteLedgerRows,
  buildEngineInput,
  hasMeaningfulInput,
  verifyStoredPresumptiveActivityEligibility,
} from "@/lib/tax-desk/computation-adapter";
import { classifyLedgerSupport } from "@/lib/tax-desk/ledger-support";
import { deriveValidationRun } from "@/lib/tax-desk/validation-run";
import { evaluateEligibility, type SpecialSituationCode } from "@/lib/tax-desk/eligibility";
import { totalIncomeForSurchargeApplicability } from "@/lib/tax-desk/tax-capability";
import { taxpayerAgeBandOrNull } from "@/lib/tax-desk/senior-treatment";
import type { Regime } from "@/lib/tax-engine/ay-2026-27/types";
import { computeTax } from "@/lib/tax-engine/ay-2026-27";
import { bindDefaultTaxPackToCase, taxCaseStatutoryContext } from "@/lib/tax-pack";
import {
  assembleFilingReadiness,
  type FilingReadinessModel,
  type ReadinessSnapshot,
} from "@/lib/tax-desk/filing-readiness";
import { TAX_INCOME_ENGINE_ROW_PROJECTION } from "./tax-income-projection";

/**
 * Filing Readiness server-side compute + page view (K.2.8). Loads every input
 * with the SESSION client (RLS staff/admin), builds live engine input from the
 * current ledger rows, parses the latest complete snapshot, and runs the pure
 * assembler. Never trusts browser-supplied readiness state. No PAN / Aadhaar /
 * ledger notes / file URLs / auth identifiers are selected or returned.
 */

/** Parse a raw snapshot row into the readiness shape (incl. stored engineInput). */
function parseReadinessSnapshot(row: {
  id: string;
  rules_version: string;
  input_snapshot: unknown;
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  users?: any;
}): ReadinessSnapshot {
  const input = (row.input_snapshot ?? {}) as Record<string, unknown>;
  const engineInput = (input.engineInput ?? null) as ReadinessSnapshot["engineInput"];
  const parseOk =
    !!engineInput &&
    Array.isArray((engineInput as Record<string, unknown>).income) &&
    Array.isArray((engineInput as Record<string, unknown>).taxPaid);
  const activityVerified = parseOk
    ? verifyStoredPresumptiveActivityEligibility(
        ((engineInput as Record<string, unknown>).income ?? []) as never[],
        (engineInput as Record<string, unknown>).presumptiveActivityEligibility,
      ).ok
    : null;
  return {
    id: row.id,
    createdAt: row.created_at,
    rulesVersion: row.rules_version,
    // Preserve the historical `complete` marker for an otherwise-unparseable
    // snapshot so adjacent evidence (for example its accepted manifest) can
    // still be associated with that snapshot. Readiness itself continues to
    // fail closed because `parseOk` is false. A parseable snapshot, however,
    // is complete only when its presumptive-activity contract verifies.
    complete: input.complete === true && activityVerified !== false,
    parseOk,
    selectedItrType: (input.selectedItrType as string | null) ?? null,
    createdByName: row.users?.full_name ?? null,
    engineInput: parseOk ? engineInput : null,
  };
}

/** Live (unsaved) computation preview from current ledger data. Null when there
 *  is no meaningful input to compute. Engine convention: refundOrPayable > 0
 *  payable, < 0 refund — always read through the canonical resolver. */
export interface LivePreview {
  refundOrPayable: number;
  regime: string | null;
  totalIncome: number;
  taxPaid: number;
}

export interface ReadinessCompute {
  model: FilingReadinessModel;
  caseId: string;
  clientName: string;
  latestSnapshotId: string | null;
  livePreview: LivePreview | null;
  /** Engine-derived count of live ledger entries the engine cannot represent
   *  (needing manual tax treatment). Gates the shell/preview outcome (K.2.8.7). */
  liveUnsupportedCount: number;
  /** True when readiness checks have been persisted (tax_readiness_items exist). */
  hasPersistedReadiness: boolean;
}

export async function computeTaxCaseReadiness(taxCaseId: string): Promise<ReadinessCompute | null> {
  const supabase = await createServerClient();

  const { data: tc } = await supabase
    .from("tax_cases")
    .select(
      "id, case_id, assessment_year, financial_year, law, itr_type_selected, itr_type_recommended, " +
        "finalized_at, finalized_snapshot_id, reopened_at, " +
        "client_review_status, client_review_snapshot_id, client_approved_at, client_approval_method, " +
        "validation_last_run_at, validation_rules_version, " +
        "residential_status, taxpayer_category, declared_special_situations, " +
        "cases:case_id(display_code, title), clients:client_id(full_name, date_of_birth), " +
        "fin_by:finalized_by(full_name), reop_by:reopened_by(full_name)",
    )
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!tc) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tc as any;
  const caseId: string = t.case_id;

  const live = (table: string, cols: string) =>
    supabase.from(table).select(cols).eq("tax_case_id", taxCaseId).is("deleted_at", null).order("created_at");
  const latestUpd = (table: string) =>
    supabase
      .from(table)
      .select("updated_at")
      .eq("tax_case_id", taxCaseId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  const [income, taxPaid, deductions, capitalGains, houseProperty, businessBooks, broughtForwardLosses, snaps, docs, findings, upI, upT, upD, upC, upH, upBk, upB, readinessCount] = await Promise.all([
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
    // K4-14: same reason as the brought-forward note below — the readiness
    // rail consumes the same `complete` verdict Computation does.
    live(
      "tax_business_books_entries",
      "id, revenue, expenses, is_profession, adjustments, activity_classification, declared_turnover, book_depreciation, claims_additional_depreciation, depreciation_blocks, source_type, source_document_id, proof_case_document_id",
    ),
    // K4-10: same reason as the eligibility read model — the readiness rail
    // consumes `buildEngineInput`'s `complete`, so it has to see the same rows
    // Computation does or the two surfaces can disagree about the same case.
    live("tax_brought_forward_loss_entries", "id, originating_assessment_year, loss_type, amount, filing_eligibility, loss_provenance, prior_tax_case_id, elected_set_off_target, source_type, source_document_id, proof_case_document_id"),
    supabase
      .from("tax_computation_snapshots")
      .select("id, rules_version, input_snapshot, created_at, created_by, users:created_by(full_name)")
      .eq("tax_case_id", taxCaseId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("case_documents").select("id, status, is_required").eq("case_id", caseId).is("deleted_at", null),
    supabase
      .from("tax_validation_findings")
      .select("id, severity, status")
      .eq("tax_case_id", taxCaseId)
      .eq("status", "open"),
    latestUpd("tax_income_entries"),
    latestUpd("tax_tax_paid_entries"),
    latestUpd("tax_deduction_entries"),
    latestUpd("tax_capital_gain_entries"),
    latestUpd("tax_house_property_entries"),
    // K4-14: same reason as the brought-forward note below — without this, a
    // books-row edit could report success while the rail still showed the
    // pre-edit verdict.
    latestUpd("tax_business_books_entries"),
    // K4-10: the reconciliation `dataVersion` must move when a brought-forward
    // row changes. Without this a successful edit could report success while
    // the rail still showed the pre-edit verdict — exactly the stale-after-
    // success class the K.2.9 reconciliation work exists to prevent.
    latestUpd("tax_brought_forward_loss_entries"),
    // Are readiness checks persisted? (drives the "Checks saved" vs "Live checks
    // pass" rail subtitle — the model itself is always a fresh live evaluation).
    supabase
      .from("tax_readiness_items")
      .select("code", { count: "exact", head: true })
      .eq("tax_case_id", taxCaseId),
  ]);
  const hasPersistedReadiness = (readinessCount.count ?? 0) > 0;

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
  const adapter = buildEngineInput(rows, {
    assessmentYear: t.assessment_year,
    financialYear: t.financial_year,
    selectedItrType: t.itr_type_selected,
    finalized: !!t.finalized_at,
    dateOfBirth: t.clients?.date_of_birth ?? null,
    residentialStatus: t.residential_status ?? null,
  });

  // Live (unsaved) preview outcome — the recommended-regime result on current
  // ledger data. Same engine + resolver the Computation hero uses.
  let livePreview: LivePreview | null = null;
  // TAX-SAFE-01A: the conservative higher-of-both-regimes total income, for
  // the surcharge/marginal-relief capability gate below — kept separate from
  // `livePreview.totalIncome` (the recommended-regime headline figure, a
  // different display concept) so the gate can never silently regress to the
  // single-regime figure.
  let surchargeApplicabilityTotalIncome: number | null = null;
  // K4-11: the engine's own surcharge verdict for the SAME live computation the
  // income above came from — read, never re-derived here. `undefined` while no
  // computation exists, which fails closed.
  let surchargeTreatmentSupported: boolean | undefined;
  // K4-12: the NEW regime's own total income and the engine's own section 87A
  // verdict, from the SAME live computation — the relief reaches the new regime
  // only, so this is deliberately not the higher-of-both figure above.
  let rebateReliefTotalIncome: number | null = null;
  let rebateReliefTreatmentSupported: boolean | undefined;
  // K4-23 review F1: the section 112 long-term house-sale verdict, and
  // whether such a gain is present at all. `hasHouseSaleLtcg` is derived from
  // the ENGINE's own per-property detail, not from a ledger row's gain_type,
  // so a row the adapter excluded cannot make readiness block on a gain that
  // never entered the computation.
  let houseSaleLtcgTreatmentSupported: boolean | undefined;
  let hasHouseSaleLtcg = false;
  // Bind BEFORE any live compute. A case that resolves to the TY pack (or
  // any unbound world) must not be priced by the 1961 engine — that would
  // show the wrong world's figures under a 2025-Act row. Readiness already
  // fails closed on an unbound pack for freshness (`engineRulesVersion`
  // sentinel); this stops the preview numbers too.
  const packBinding = bindDefaultTaxPackToCase(
    taxCaseStatutoryContext(t.assessment_year, t.law),
  );

  if (hasMeaningfulInput(adapter) && packBinding.outcome === "bound") {
    const liveComp = computeTax(adapter.input);
    livePreview = {
      refundOrPayable: liveComp.refundOrPayable.value,
      regime: liveComp.recommendedRegime,
      totalIncome: liveComp.totalIncome.value,
      taxPaid: liveComp.taxPaid.value,
    };
    surchargeApplicabilityTotalIncome = totalIncomeForSurchargeApplicability(
      liveComp.oldRegime.totalIncome.value,
      liveComp.newRegime.totalIncome.value,
    );
    surchargeTreatmentSupported = liveComp.surchargeTreatmentSupported;
    rebateReliefTotalIncome = liveComp.newRegime.totalIncome.value;
    rebateReliefTreatmentSupported = liveComp.rebateReliefTreatmentSupported;
    houseSaleLtcgTreatmentSupported = liveComp.houseSaleLtcgTreatmentSupported;
    // Present when EITHER regime carries per-property detail, or when the
    // treatment was refused while a long-term gain existed. A refusal zeroes
    // the detail list, so the refused case must be recognised from the
    // verdict rather than from the (now empty) detail.
    hasHouseSaleLtcg =
      liveComp.oldRegime.houseSaleLtcgDetails.length > 0 ||
      liveComp.newRegime.houseSaleLtcgDetails.length > 0 ||
      liveComp.houseSaleLtcgTreatmentSupported === false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsedSnaps = ((snaps.data ?? []) as any[]).map(parseReadinessSnapshot);
  const latestComplete =
    parsedSnaps.find((sp) => sp.complete && sp.parseOk) ?? parsedSnaps.find((sp) => sp.complete) ?? null;

  // K4-01: the regime the LATEST evidence manifest bound to the latest
  // complete snapshot explicitly selected, if any — never guessed from the
  // engine's recommendation. `null` when no manifest exists yet for this
  // snapshot (the case has not reached the `snapshot_selected_regime`
  // evaluation context).
  let selectedRegimeForLatestManifest: Regime | null = null;
  if (latestComplete) {
    const { data: manifestRow } = await supabase
      .from("tax_evidence_manifests")
      .select("selected_regime")
      .eq("computation_snapshot_id", latestComplete.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    selectedRegimeForLatestManifest = (manifestRow?.selected_regime as Regime | undefined) ?? null;
  }

  const docRows = (docs.data ?? []) as { status: string; is_required: boolean }[];
  const req = docRows.filter((d) => d.is_required);
  const documents = {
    requiredTotal: req.length,
    requiredOutstanding: req.filter((d) => d.status === "pending" || d.status === "requested").length,
    requiredRejected: req.filter((d) => d.status === "rejected").length,
    receivedUnverified: docRows.filter((d) => d.status === "received").length,
  };

  const findRows = (findings.data ?? []) as { id: string; severity: string; status: string }[];
  // Authoritative validation-run marker (Phase 3 / K.2.9.3) — the SAME
  // derivation the Validation page uses, so the workbench rail and the page can
  // never disagree about whether a run happened.
  const runMarker = deriveValidationRun(t);
  const validation = {
    runExists: runMarker.runExists,
    lastRunAt: runMarker.lastRunAt,
    rulesVersion: runMarker.rulesVersion,
    openError: findRows.filter((f) => f.severity === "error").length,
    openBlocker: findRows.filter((f) => f.severity === "blocker").length,
    openWarning: findRows.filter((f) => f.severity === "warning").length,
    openInfo: findRows.filter((f) => f.severity === "info").length,
    latestLedgerChangeAt:
      [upI, upT, upD, upC, upH, upBk, upB]
        .map((u) => (u.data as { updated_at: string } | null)?.updated_at ?? null)
        .filter((x): x is string => !!x)
        .sort()
        .pop() ?? null,
    openBlockerFindingIds: findRows
      .filter((f) => f.severity === "error" || f.severity === "blocker")
      .map((f) => f.id),
  };

  // Computation eligibility (K.2.8.9A) — one canonical evaluator, same inputs
  // the standalone eligibility loader uses. Surfaced as a blocking readiness
  // item so finalize capability + the rail agree with the Computation page.
  const support = classifyLedgerSupport(rows, {
    assessmentYear: t.assessment_year,
    financialYear: t.financial_year,
    selectedItrType: t.itr_type_selected,
    finalized: !!t.finalized_at,
  });
  const eligibilityResult = evaluateEligibility({
    profile: {
      dateOfBirth: t.clients?.date_of_birth ?? null,
      residentialStatus: t.residential_status ?? null,
      taxpayerCategory: t.taxpayer_category ?? null,
      assessmentYear: t.assessment_year,
    },
    data: {
      hasMeaningfulData: hasMeaningfulInput(adapter),
      unsupportedEntries: support.entries.map((e) => ({
        ledgerId: e.ledgerId,
        entryType: e.entryType,
        code: e.code,
      })),
    },
    declaredSpecialSituations: (t.declared_special_situations ?? []) as SpecialSituationCode[],
    validation: {
      openBlocking: findRows.filter((f) => f.severity === "error" || f.severity === "blocker").length,
      openWarning: findRows.filter((f) => f.severity === "warning").length,
    },
  });

  const model = assembleFilingReadiness({
    case: {
      clientName: t.clients?.full_name ?? "—",
      caseDisplayCode: t.cases?.display_code ?? null,
      caseTitle: t.cases?.title ?? null,
      assessmentYear: t.assessment_year,
      financialYear: t.financial_year,
      selectedItrType: t.itr_type_selected,
      recommendedItrType: t.itr_type_recommended,
      finalizedAt: t.finalized_at ?? null,
      finalizedByName: t.fin_by?.full_name ?? null,
      finalizedSnapshotId: t.finalized_snapshot_id ?? null,
      reopenedAt: t.reopened_at ?? null,
      reopenedByName: t.reop_by?.full_name ?? null,
    },
    latestCompleteSnapshot: latestComplete,
    live: {
      engineInput: {
        ...adapter.input,
        presumptiveActivityEligibility:
          adapter.presumptiveActivityEligibility,
      },
      complete: adapter.complete,
      unsupportedEntryCount: adapter.unsupportedEntryCount,
      selectedItrType: t.itr_type_selected,
    },
    documents,
    validation,
    review: {
      status: t.client_review_status ?? "not_started",
      reviewSnapshotId: t.client_review_snapshot_id ?? null,
      approvedAt: t.client_approved_at ?? null,
      approvalMethod: t.client_approval_method ?? null,
    },
    eligibility: {
      eligible: eligibilityResult.eligible,
      blockers: eligibilityResult.blockers.map((b) => ({ code: b.code, message: b.message })),
    },
    // TAX-SAFE-01 / TAX-SAFE-01A: the live (unsaved) preview's conservative
    // higher-of-both-regimes total income — recomputed from live ledger
    // rows, never a browser-supplied figure. `null` when there is nothing
    // meaningful to compute yet.
    capability: {
      totalIncome: surchargeApplicabilityTotalIncome,
      surchargeTreatmentSupported,
      newRegimeTotalIncome: rebateReliefTotalIncome,
      rebateReliefTreatmentSupported,
      houseSaleLtcgTreatmentSupported,
      hasHouseSaleLtcg,
      // K4-01: the taxpayer's age band derived fresh from the profile DOB +
      // the case's assessment year (never hardcoded), the raw residential
      // status, and the latest manifest's explicitly selected regime.
      seniorTreatment: {
        ageBand: taxpayerAgeBandOrNull(t.clients?.date_of_birth ?? null, t.assessment_year),
        residentialStatus: t.residential_status ?? null,
        selectedRegimeForLatestManifest,
      },
    },
    // Supported computation version for the freshness check (K3-12): the
    // version of the pack that governs THIS case, from the same canonical
    // authority the snapshot writer stamps with — so a snapshot produced by a
    // different pack version is detectably stale rather than silently reused.
    // If no single bound pack governs the case, the sentinel below can never
    // equal any stored version, so the item fails CLOSED (blocked) instead of
    // pretending the snapshot is on the supported engine.
    engineRulesVersion: packBinding.outcome === "bound" ? packBinding.versions.computationRulesVersion : "unresolved",
  });

  return {
    model,
    caseId,
    clientName: t.clients?.full_name ?? "—",
    latestSnapshotId: latestComplete?.id ?? null,
    livePreview,
    liveUnsupportedCount: adapter.unsupportedEntryCount,
    hasPersistedReadiness,
  };
}

export interface PersistedReadinessItem {
  code: string;
  status: string;
  is_blocking: boolean;
  category: string | null;
  last_checked_at: string | null;
}

export interface TaxCaseFilingReadinessView {
  taxCaseId: string;
  caseId: string;
  model: FilingReadinessModel;
  persisted: Record<string, PersistedReadinessItem>;
  hasRun: boolean;
}

export async function getTaxCaseFilingReadinessView(
  taxCaseId: string,
): Promise<TaxCaseFilingReadinessView | null> {
  const computed = await computeTaxCaseReadiness(taxCaseId);
  if (!computed) return null;

  const supabase = await createServerClient();
  const { data: rows } = await supabase
    .from("tax_readiness_items")
    .select("code, status, is_blocking, category, last_checked_at")
    .eq("tax_case_id", taxCaseId);

  const persisted: Record<string, PersistedReadinessItem> = {};
  for (const r of (rows ?? []) as PersistedReadinessItem[]) persisted[r.code] = r;

  return { taxCaseId, caseId: computed.caseId, model: computed.model, persisted, hasRun: (rows ?? []).length > 0 };
}
