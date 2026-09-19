/**
 * Case validation / reconciliation for AY 2026-27. PURE — no external imports.
 *
 * Produces preparation-time findings: missing documents, source-vs-entered
 * reconciliation gaps, ITR-form eligibility, deduction proof, payment gaps,
 * workflow guards, and a practical portal-credential text guard.
 *
 * This is NOT a security product — the credential check is a best-effort
 * guard against risky free text landing in prep notes.
 */

import type { ComputationRateFigures } from "@/lib/tax-engine/core/statutory-rate-parameters";
import { computeTax, taxableGainOf } from "./compute-tax";
import { AY_2026_27_COMPUTATION_FIGURES } from "./rate-figures";
import { PORTAL_CREDENTIAL_PATTERNS, PRESUMPTIVE_44AD, RECON_TOLERANCE } from "./rules";
import type {
  ReportedSourceType,
  TaxEngineInput,
  ValidationFinding,
  ValidationResult,
} from "./types";

const REPORTED_SOURCES = new Set<ReportedSourceType | string>([
  "AIS",
  "26AS",
  "Form16",
  "prefilled_json",
  "broker_report",
  "bank_certificate",
]);

const INTEREST_CATEGORIES = new Set(["savings_interest", "fd_interest"]);
const NON_SALARY_INCOME_CATEGORIES = new Set([
  "savings_interest",
  "fd_interest",
  "dividend",
  "other_sources",
]);

function sum(entries: { amount: number }[]): number {
  return entries.reduce((acc, e) => acc + e.amount, 0);
}

function tags(prefix: string, entries: { id: string; sourceType: string; sourceDocumentId?: string }[]): string[] {
  return entries.map((e) =>
    e.sourceDocumentId ? `${prefix}:${e.sourceType}:${e.sourceDocumentId}` : `${prefix}:${e.sourceType}:${e.id}`,
  );
}

/**
 * K4-08: source tags for Section 44AD entries. Unlike `tags` above these span
 * TWO categories (digital / cash turnover), so each entry is tagged with its
 * OWN head rather than one shared prefix — the receipt-mode split is exactly
 * what makes these figures traceable, and collapsing it would lose it.
 */
function tags44ad(
  entries: { id: string; category: string; sourceType: string; sourceDocumentId?: string }[],
): string[] {
  return entries.map((e) =>
    e.sourceDocumentId
      ? `${e.category}:${e.sourceType}:${e.sourceDocumentId}`
      : `${e.category}:${e.sourceType}:${e.id}`,
  );
}

export function validateCase(
  input: TaxEngineInput,
  figures: ComputationRateFigures = AY_2026_27_COMPUTATION_FIGURES,
): ValidationResult {
  const findings: ValidationFinding[] = [];

  // 1. Missing required documents.
  for (const doc of input.requiredDocuments) {
    if (doc.required && doc.status === "missing") {
      findings.push({
        code: "DOC_MISSING",
        severity: "warning",
        area: "documents",
        message: `Required document "${doc.label}" is missing.`,
        suggestedAction: `Collect and attach "${doc.label}" before finalizing.`,
        sources: [`document:${doc.code}`],
      });
    }
  }

  // Reconciliation buckets.
  const interestEntries = input.income.filter((e) => INTEREST_CATEGORIES.has(e.category));
  const reportedInterest = interestEntries.filter((e) => REPORTED_SOURCES.has(e.sourceType));
  const enteredInterest = interestEntries.filter((e) => e.sourceType === "manual");
  const reportedInterestTotal = sum(reportedInterest);
  const enteredInterestTotal = sum(enteredInterest);

  // 2. AIS/reported interest exists but nothing entered.
  if (reportedInterestTotal > 0 && enteredInterestTotal === 0) {
    findings.push({
      code: "AIS_INTEREST_NOT_ENTERED",
      severity: "warning",
      area: "reconciliation",
      message: `Reported interest of ₹${reportedInterestTotal} (AIS/bank) exists but no interest income was entered.`,
      sourceValue: reportedInterestTotal,
      enteredValue: 0,
      difference: reportedInterestTotal,
      suggestedAction: "Enter the interest income to match the reported figure, or record why it differs.",
      sources: tags("interest", reportedInterest),
    });
  } else if (
    reportedInterestTotal > 0 &&
    enteredInterestTotal > 0 &&
    reportedInterestTotal - enteredInterestTotal > RECON_TOLERANCE
  ) {
    // 3. Entered interest lower than reported.
    findings.push({
      code: "AIS_INTEREST_MISMATCH",
      severity: "warning",
      area: "reconciliation",
      message: `Entered interest ₹${enteredInterestTotal} is lower than reported ₹${reportedInterestTotal}.`,
      sourceValue: reportedInterestTotal,
      enteredValue: enteredInterestTotal,
      difference: reportedInterestTotal - enteredInterestTotal,
      suggestedAction: "Reconcile the shortfall against AIS / bank certificates.",
      sources: tags("interest", [...reportedInterest, ...enteredInterest]),
    });
  }

  // 4. 26AS non-salary TDS/TCS exists but no non-salary income entered.
  const reported26asTds = input.taxPaid.filter(
    (t) => (t.category === "non_salary_tds" || t.category === "tcs") && t.sourceType === "26AS",
  );
  const reported26asTdsTotal = sum(reported26asTds);
  const enteredNonSalaryIncome = input.income.filter(
    (e) => NON_SALARY_INCOME_CATEGORIES.has(e.category) && e.sourceType === "manual",
  );
  const hasCapitalGains = input.capitalGains.some((cg) => taxableGainOf(cg) > 0);
  if (reported26asTdsTotal > 0 && sum(enteredNonSalaryIncome) === 0 && !hasCapitalGains) {
    findings.push({
      code: "TDS_26AS_UNMAPPED",
      severity: "warning",
      area: "reconciliation",
      message: `Form 26AS shows non-salary TDS/TCS of ₹${reported26asTdsTotal} but no related income is mapped.`,
      sourceValue: reported26asTdsTotal,
      enteredValue: 0,
      suggestedAction: "Map the income against which this TDS/TCS was deducted before claiming credit.",
      sources: tags("tds", reported26asTds),
    });
  }

  // 5. Form 16 salary vs entered salary mismatch.
  const salaryEntries = input.income.filter((e) => e.category === "salary");
  const form16Salary = salaryEntries.filter((e) => e.sourceType === "Form16");
  const manualSalary = salaryEntries.filter((e) => e.sourceType === "manual");
  const form16Total = sum(form16Salary);
  const manualTotal = sum(manualSalary);
  if (form16Total > 0 && manualTotal > 0 && Math.abs(form16Total - manualTotal) > RECON_TOLERANCE) {
    findings.push({
      code: "FORM16_SALARY_MISMATCH",
      severity: "warning",
      area: "reconciliation",
      message: `Entered salary ₹${manualTotal} does not match Form 16 salary ₹${form16Total}.`,
      sourceValue: form16Total,
      enteredValue: manualTotal,
      difference: manualTotal - form16Total,
      suggestedAction: "Reconcile entered salary against Form 16 before finalizing.",
      sources: tags("salary", [...form16Salary, ...manualSalary]),
    });
  }

  // 6. Capital gains present but ITR-1 selected.
  if (hasCapitalGains && input.selectedItrType === "ITR-1") {
    findings.push({
      code: "CG_REQUIRES_ITR2",
      severity: "blocker",
      area: "itr_form",
      message: "Capital gains are present but ITR-1 is selected. ITR-1 cannot report capital gains.",
      suggestedAction: "Switch the selected form to ITR-2.",
      sources: tags(
        "capital_gain",
        input.capitalGains.map((cg) => ({ ...cg, sourceDocumentId: cg.source_document_id ?? cg.sourceDocumentId })),
      ),
    });
  }

  // 6b. House property present (K4-06). `computation` below is reused —
  // computed once here rather than a second time, since this finding needs
  // the recommended regime's OWN house-property treatment (mirrors
  // `recommend-itr-form.ts`'s identical `hasHousePropertyLoss` derivation —
  // the SAME authority, never a second independently-derived check).
  const computation = computeTax(input, figures);
  const housePropertyEntries = input.housePropertyEntries ?? [];
  const recommendedHouseProperty =
    computation.recommendedRegime === "old"
      ? computation.oldRegime.housePropertyIncome
      : computation.newRegime.housePropertyIncome;
  const hasHousePropertyLoss = recommendedHouseProperty.value < 0;

  if (hasHousePropertyLoss && input.selectedItrType === "ITR-1") {
    findings.push({
      code: "HOUSE_PROPERTY_LOSS_REQUIRES_ITR2",
      severity: "blocker",
      area: "itr_form",
      message: "House property shows a net loss under the recommended regime, but ITR-1 is selected. ITR-1 does not permit a house-property loss.",
      sourceValue: recommendedHouseProperty.value,
      suggestedAction: "Switch the selected form to ITR-2.",
      sources: recommendedHouseProperty.sources,
    });
  }

  for (const hp of housePropertyEntries) {
    if (hp.homeLoanInterest > 0 && !hp.proofDocumentId && !hp.sourceDocumentId) {
      findings.push({
        code: "HOUSE_PROPERTY_INTEREST_PROOF_MISSING",
        severity: "warning",
        area: "deductions",
        message: `Section 24(b) home-loan interest of ₹${hp.homeLoanInterest} is claimed for this property without any supporting proof (interest certificate).`,
        enteredValue: hp.homeLoanInterest,
        suggestedAction: "Attach the home-loan interest certificate as proof.",
        sources: [`house_property:${hp.sourceType}:${hp.id}`],
      });
    }
  }

  // Section 71(3A) set-off cap disclosure (old regime only) — the engine
  // already applies the cap (compute-tax.ts's computeHouseProperty); this
  // surfaces WHY, matching the DEDUCTION_SECTION_AGE_MISMATCH / 207(2)
  // disclosure convention rather than leaving a capped figure unexplained.
  if (housePropertyEntries.length > 0 && computation.oldRegime.housePropertyIncome.notes.some((n) => n.includes("Section 71(3A)"))) {
    findings.push({
      code: "HOUSE_PROPERTY_LOSS_SETOFF_CAPPED",
      severity: "info",
      area: "deductions",
      message: "The house-property loss exceeds the ₹2,00,000 Section 71(3A) annual set-off cap against other heads (old regime) — the excess is not applied this year and is not carried forward by this engine.",
      sourceValue: computation.oldRegime.housePropertyIncome.value,
      suggestedAction: "No action needed for this preparation; loss carry-forward tracking is not yet supported.",
      sources: computation.oldRegime.housePropertyIncome.sources,
    });
  }

  // 6c. Presumptive professional income (44ADA, K4-07) present but ITR-1
  // selected. ITR-1 does not permit any business/professional income,
  // including presumptive income under Section 44ADA.
  const presumptive44adaEntries = input.income.filter(
    (e) => e.category === "presumptive_professional_44ada" && e.amount > 0,
  );
  if (presumptive44adaEntries.length > 0 && input.selectedItrType === "ITR-1") {
    findings.push({
      code: "PRESUMPTIVE_44ADA_REQUIRES_ITR4",
      severity: "blocker",
      area: "itr_form",
      message:
        "Presumptive professional income (Section 44ADA) is present, but ITR-1 is selected. ITR-1 does not " +
        "permit any business or professional income — ITR-4 (Sugam) applies for a presumptive-only case.",
      suggestedAction: "Switch the selected form to ITR-4 (or ITR-3 if other complications also apply).",
      sources: tags("presumptive_professional_44ada", presumptive44adaEntries),
    });
  }

  // 6b-books. Books-based business/profession (K4-14, Sections 28/29).
  // Only rows the adapter ADMITTED reach here — a refused row was excluded
  // from the engine input entirely and is reported by its own mapping
  // warning, so these findings never describe a case the engine did not
  // compute.
  // K4-15-F1: PRESENCE, not magnitude. This filter used to be
  // `e.revenue - e.expenses > 0`, which is exactly the defect `AUDIT-08-F2`
  // (`D243`) found and fixed in `recommendItrForm` — fixed there, missed here.
  // The adapter admits the whole head when its aggregate is non-negative, so a
  // BREAK-EVEN business or a K4-17 negative row fully absorbed by positive
  // siblings is a fully accepted books entry; under the old filter
  // it raised no `BUSINESS_BOOKS_REQUIRES_ITR3` blocker, so a case the
  // recommender now sends to ITR-3 could be validated on ITR-1 with no
  // complaint. Which form a case needs, and which disclosures it owes, turn on
  // the NATURE of the income present, never on its size.
  const businessBooks = input.businessBooksEntries ?? [];
  if (businessBooks.length > 0 && input.selectedItrType !== "ITR-3") {
    findings.push({
      code: "BUSINESS_BOOKS_REQUIRES_ITR3",
      severity: "blocker",
      area: "itr_form",
      message:
        "Books-based business or professional income is present, but the selected return form is " +
        `${input.selectedItrType ?? "not set"}. Income computed from books of account (rather than ` +
        "presumptively under Sections 44AD/44ADA) is returned on ITR-3 — ITR-1 and ITR-4 do not permit it, " +
        "and ITR-2 does not permit business or professional income at all.",
      suggestedAction: "Switch the selected form to ITR-3.",
      sources: tags("business_books", businessBooks),
    });
  }

  // Disclosure (info) — states the BASIS of the figure, matching the
  // PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED convention. This one matters more
  // than most: the number looks like an ordinary subtraction, and nothing on
  // the face of it reveals that its correctness rests entirely on a
  // declaration the engine cannot check.
  if (businessBooks.length > 0) {
    findings.push({
      code: "BUSINESS_BOOKS_NET_PROFIT_APPLIED",
      severity: "info",
      area: "deductions",
      message:
        "Business income is taken as declared revenue minus declared expenses, plus a bounded " +
        "Section 32(1)(ii) adjustment where the preparer declared a complete Appendix I standing-class " +
        "set (book depreciation added back, prescribed percentage applied to the declared WDV). " +
        "Section 29 still requires Sections 30 to 43D; this engine does not verify the WDV under " +
        "Section 43(6)(c), additional depreciation under Section 32(1)(iia), any disallowance " +
        "(Sections 37/40/43B), or the Section 44AB audit position beyond the declared turnover " +
        "threshold. Where one current-year source is negative, Section 70(1) " +
        "intra-head set-off is included only if the whole books-business aggregate remains zero or positive; " +
        "no residual cross-head set-off or carry-forward is computed.",
      suggestedAction:
        "Confirm against the books that the declared WDV, book-depreciation add-back and " +
        "Appendix I class are right, and that no disallowance or add-back is owed, before " +
        "relying on this figure.",
      sources: tags("business_books", businessBooks),
    });
  }

  // Regime-option disclosure (info). A taxpayer WITH business income cannot
  // simply pick the old regime on the return: Section 115BAC(6) requires Form
  // 10-IEA, and the option, once withdrawn, is permanently lost. This engine
  // compares both regimes and recommends the cheaper one, so surfacing the
  // procedural condition attached to that recommendation is a disclosure the
  // case would otherwise be missing entirely. It is INFO, not a blocker: the
  // form is the preparer's to file, and nothing here computes it.
  if (businessBooks.length > 0) {
    findings.push({
      code: "BUSINESS_INCOME_REGIME_OPTION_10IEA",
      severity: "info",
      area: "itr_form",
      message:
        "This case has income from business or profession, so opting out of the new regime is not a free " +
        "choice on the return: Section 115BAC(6) requires Form 10-IEA to be filed on or before the " +
        "Section 139(1) due date, and once the option is withdrawn it cannot be exercised again.",
      suggestedAction:
        "If the old regime is chosen, file Form 10-IEA within the due date. This product neither files " +
        "nor tracks that form.",
      sources: tags("business_books", businessBooks),
    });
  }

  // 6d. Deemed-profit disclosure (info) — explains WHY the presumptive
  // figure is what it is, matching the HOUSE_PROPERTY_LOSS_SETOFF_CAPPED /
  // ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2 disclosure convention rather
  // than leaving a 50%-of-receipts figure unexplained.
  if (presumptive44adaEntries.length > 0) {
    findings.push({
      code: "PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED",
      severity: "info",
      area: "deductions",
      message:
        "A deemed profit of 50% of gross receipts is applied under Section 44ADA — no separate expense or " +
        "depreciation deduction is claimed on top, and books of account / Section 44AB tax audit are not " +
        "required for a full presumptive declaration.",
      suggestedAction: "No action needed for a full presumptive declaration; this engine does not support " +
        "declaring a lower actual profit (which would require books of account and, above the basic " +
        "exemption limit, a Section 44AB audit).",
      sources: tags("presumptive_professional_44ada", presumptive44adaEntries),
    });
  }

  // 6e. Presumptive BUSINESS income (44AD, K4-08) present but ITR-1
  // selected — same reasoning as 6c above: ITR-1 permits no business income
  // of any kind, presumptive included.
  const presumptive44adEntries = input.income.filter(
    (e) =>
      (e.category === "presumptive_business_44ad_digital" ||
        e.category === "presumptive_business_44ad_cash") &&
      e.amount > 0,
  );
  if (presumptive44adEntries.length > 0 && input.selectedItrType === "ITR-1") {
    findings.push({
      code: "PRESUMPTIVE_44AD_REQUIRES_ITR4",
      severity: "blocker",
      area: "itr_form",
      message:
        "Presumptive business income (Section 44AD) is present, but ITR-1 is selected. ITR-1 does not " +
        "permit any business or professional income — ITR-4 (Sugam) applies for a presumptive-only case.",
      suggestedAction: "Switch the selected form to ITR-4 (or ITR-3 if other complications also apply).",
      sources: tags44ad(presumptive44adEntries),
    });
  }

  // 6f. Deemed-profit disclosure (info) — explains the dual-rate figure, and
  // states plainly the two eligibility tests this engine does NOT perform.
  if (presumptive44adEntries.length > 0) {
    findings.push({
      code: "PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED",
      severity: "info",
      area: "deductions",
      message:
        "A deemed profit of 6% of turnover received through banking / prescribed electronic modes plus 8% " +
        "of cash turnover is applied under Section 44AD — no separate expense or depreciation deduction is " +
        "claimed on top. The declared ACTIVITY was tested and is not one Section 44AD(6) excludes (a " +
        "Section 44AA(1) profession, commission or brokerage, or agency business) nor the goods-carriage " +
        "business the Explanation to Section 44AD excludes from \"eligible business\" — an undeclared or " +
        "excluded activity is refused, so reaching this figure means that test passed (K4-13). Two " +
        "eligibility conditions remain UNTESTED: the eligible-ASSESSEE limbs of that same Explanation " +
        "(resident individual / HUF / firm but not an LLP, having claimed no deduction under Sections 10A, " +
        "10AA, 10B, 10BA or Chapter VI-A Part C), and the Section 44AD(4)/(5) five-year lock-in with its " +
        "Section 44AB audit consequence.",
      suggestedAction:
        "Confirm the taxpayer is an eligible ASSESSEE and has not opted out of Section 44AD within the " +
        "last five years — neither is verified by this engine. The eligible-activity test IS applied.",
      sources: tags44ad(presumptive44adEntries),
    });
  }

  // 6f-bis. K4-09 — within-year capital-loss set-off disclosure (info).
  // Fires only when a set-off actually reduced a figure, and says plainly
  // which of the two Section 74 halves is NOT modelled, so a preparer is
  // never left to infer that carry-forward was considered and found to be nil.
  // Reuses the `computation` already computed above — the SAME authority,
  // never a second independently-derived set-off.
  const capitalSetOff = computation.capitalLossSetOff;
  /** K4-10 — the declared carry-forward records, read once. */
  const broughtForwardRecords = input.broughtForwardLosses ?? [];
  if (capitalSetOff && (capitalSetOff.absorbedAgainstStcg > 0 || capitalSetOff.absorbedAgainstLtcg > 0)) {
    findings.push({
      code: "CAPITAL_LOSS_SET_OFF_APPLIED",
      severity: "info",
      // `deductions` — the same area K4-07/K4-08's deemed-profit computation
      // disclosures use. There is no `computation` area, and widening the
      // ValidationArea union would ripple into the DB check constraint and the
      // validation-inbox filters for no gain to the reader.
      area: "deductions",
      message:
        `A within-year capital-loss set-off was applied: ₹${capitalSetOff.absorbedAgainstStcg} against ` +
        `short-term (111A) gains and ₹${capitalSetOff.absorbedAgainstLtcg} against long-term (112A) ` +
        "gains (Sections 70 and 74(1)). A capital loss cannot reduce income under any other head " +
        "(Section 71(3)). " +
        // K4-10 corrected this sentence rather than leaving it. It used to
        // assert flatly that no brought-forward loss is held, which is no
        // longer true for every case — and a disclosure that is false for the
        // case it is attached to is worse than no disclosure.
        (broughtForwardRecords.length > 0
          ? "Brought-forward losses from earlier assessment years are recorded on this case and are " +
            "applied SEPARATELY, after this within-year set-off — see the brought-forward " +
            "disclosures below."
          : "This case holds no brought-forward loss from an earlier assessment year, so the figures " +
            "reflect this year's declared rows only.") +
        " This engine does NOT generate a new carry-forward record from an unabsorbed current-year " +
        "loss — a case with a within-year residual is refused outright rather than partly computed.",
      suggestedAction:
        broughtForwardRecords.length > 0
          ? "Review the brought-forward disclosures below alongside this one — the two set-offs are " +
            "governed by different sections and only the brought-forward one leaves a residual that " +
            "carries into a future year."
          : "Confirm no brought-forward capital loss from an earlier assessment year is available to " +
            "set off, and that the return is filed by the due date if any loss is to be carried forward.",
      sources: [],
    });
  }

  // 6f-ter. K4-10 — BROUGHT-FORWARD capital-loss disclosures (Section 74).
  //
  // Every one of these reads the engine's OWN computed
  // `broughtForwardLossSetOff` — never a second derivation of expiry,
  // eligibility or allocation. Each names the ORIGINATING assessment year,
  // because an exclusion a preparer cannot attribute to a specific
  // carry-forward record is indistinguishable from a silent drop.
  const bfSetOff = computation.broughtForwardLossSetOff;
  if (bfSetOff) {
    if (bfSetOff.absorbedAgainstStcg > 0 || bfSetOff.absorbedAgainstLtcg > 0) {
      findings.push({
        code: "BROUGHT_FORWARD_LOSS_SET_OFF_APPLIED",
        severity: "info",
        area: "deductions",
        message:
          `A BROUGHT-FORWARD capital-loss set-off was applied under Section 74: ` +
          `₹${bfSetOff.absorbedAgainstStcg} against short-term (111A) gains and ` +
          `₹${bfSetOff.absorbedAgainstLtcg} against long-term (112A) gains, taken AFTER the ` +
          "within-year set-off and against only the gains surviving it. " +
          bfSetOff.allocations
            .map(
              (a) =>
                `₹${a.amount} of the AY ${a.originatingAssessmentYear} ` +
                `${a.lossType === "ltcl" ? "long-term" : "short-term"} loss went to ` +
                `${a.target === "stcg_111a" ? "STCG 111A" : "LTCG 112A"}`,
            )
            .join("; ") +
          `. The allocation sequence comes from the "${bfSetOff.policyId}" policy ` +
          `(${bfSetOff.policyVersion}), which reproduces the official ITR-2 utility's DEFAULT for ` +
          "utility v1.2 / JSON schema v1.1 / validation rules v1.0. That is portal-conformance " +
          "behaviour, NOT a statutory ordering rule — no CBDT circular or rule making any " +
          "intra-head rate-bucket sequence mandatory was located, and a taxpayer may lawfully elect " +
          "a different beneficial allocation.",
        suggestedAction:
          "Confirm the allocation is the one intended for this taxpayer, and re-validate it if the " +
          "ITR-2 utility, JSON schema or validation-rules version has changed since v1.2 / v1.1 / v1.0.",
        sources: [],
      });
    }

    for (const residual of bfSetOff.residuals) {
      findings.push({
        code: "BROUGHT_FORWARD_LOSS_RESIDUAL_CARRIED",
        severity: residual.expiresAfterThisYear ? "warning" : "info",
        area: "deductions",
        message:
          `₹${residual.amount} of the AY ${residual.originatingAssessmentYear} ` +
          `${residual.lossType === "ltcl" ? "long-term" : "short-term"} capital loss remains ` +
          "unabsorbed after this year's set-off and continues to be carried forward. Under Section " +
          `74(2) it may last be set off in AY ${residual.finalEligibleAssessmentYear}` +
          (residual.expiresAfterThisYear
            ? " — THIS IS ITS FINAL YEAR. Any part not absorbed now lapses permanently."
            : "."),
        suggestedAction: residual.expiresAfterThisYear
          ? "This loss lapses after the current assessment year. Confirm there is no further gain it " +
            "could lawfully be set off against before the return is filed."
          : "Carry this residual into the next assessment year's records with its originating " +
            "assessment year intact — the eight-year window runs from that year, not from this one.",
        sources: [],
      });
    }

    // One EXPLICIT branch per exclusion reason, each with a LITERAL `code:`.
    // Deliberately not one push with a ternary code: `AUDIT-04-F1`'s guard
    // derives the engine's code inventory from this file's own source text
    // (`/\bcode:\s*"([A-Z][A-Z0-9_]+)"/`), so a computed code would be
    // invisible to it — and a code no guard can see is exactly the "surfaced
    // or explicitly suppressed" invariant failing silently.
    //
    // The severities are not uniform, and that is the point. An expired or
    // filing-ineligible loss is a POSITIVE legal conclusion with a known
    // correct treatment, so it is a WARNING and the case can still proceed. An
    // UNVERIFIED filing eligibility, or a record whose originating year cannot
    // be read at all, is an ABSENCE of knowledge and fails closed as a BLOCKER.
    for (const excluded of bfSetOff.excluded) {
      if (excluded.reason === "filing_eligibility_unverified") {
        findings.push({
          code: "BROUGHT_FORWARD_LOSS_FILING_UNVERIFIED",
          severity: "blocker",
          area: "deductions",
          message: excluded.message,
          suggestedAction:
            "Verify from the prior year's records whether that loss return was filed by the due date " +
            "(Sections 139(3) and 80) and record the result. Until then this loss cannot be used.",
          sources: [],
        });
      } else if (excluded.reason === "expired_8_assessment_years") {
        findings.push({
          code: "BROUGHT_FORWARD_LOSS_EXPIRED",
          severity: "warning",
          area: "deductions",
          message: excluded.message,
          suggestedAction:
            "No action is available — the Section 74(2) window has closed. Remove or archive the " +
            "record so it is not carried into a later year in error.",
          sources: [],
        });
      } else if (excluded.reason === "filing_not_eligible") {
        findings.push({
          code: "BROUGHT_FORWARD_LOSS_FILING_INELIGIBLE",
          severity: "warning",
          area: "deductions",
          message: excluded.message,
          suggestedAction:
            "No action is available — a loss return filed after the due date cannot be carried " +
            "forward. Confirm the recorded filing status is correct before relying on this.",
          sources: [],
        });
      } else {
        findings.push({
          code: "BROUGHT_FORWARD_LOSS_RECORD_UNUSABLE",
          severity: "blocker",
          area: "deductions",
          message: excluded.message,
          suggestedAction:
            "Correct the record's originating assessment year so its Section 74(2) eight-year window " +
            "can be evaluated. A brought-forward loss must also originate in an assessment year " +
            "earlier than the current one.",
          sources: [],
        });
      }
    }

    for (const divergence of bfSetOff.electionDivergences) {
      findings.push({
        code: "BROUGHT_FORWARD_LOSS_ELECTION_DIVERGES",
        severity: "blocker",
        area: "deductions",
        message: divergence.message,
        suggestedAction:
          "A qualified professional must review this allocation and either withdraw the election or " +
          "confirm it is the intended lawful position. This engine will not choose between them.",
        sources: [],
      });
    }

    // The policy's own review/audit flags. Fires whenever an election is in
    // play at all — including an election that DOES reproduce the portal
    // default, because a human has still made an allocation decision the
    // engine did not, and a reviewer needs to know that.
    if (bfSetOff.requiresProfessionalReview && broughtForwardRecords.some((e) => e.electedSetOffTarget)) {
      findings.push({
        code: "BROUGHT_FORWARD_LOSS_ELECTION_REQUIRES_REVIEW",
        severity: "blocker",
        area: "deductions",
        message:
          "This case's brought-forward capital-loss set-off was computed under the " +
          `"${bfSetOff.policyId}" allocation policy, because a taxpayer election is recorded on at ` +
          "least one carry-forward record. An elected allocation is a human tax position, not an " +
          "engine result, and is flagged for audit.",
        suggestedAction:
          "Have a qualified professional confirm the elected allocation before this computation is " +
          "used for client approval or filing.",
        sources: [],
      });
    }

    // Provenance assurance. `prior_finalized_case_in_system` and
    // `staff_declared` are not the same kind of fact, and flattening them
    // would hide exactly the difference a preparer needs.
    const staffDeclared = broughtForwardRecords.filter((e) => e.provenance === "staff_declared");
    if (staffDeclared.length > 0) {
      findings.push({
        code: "BROUGHT_FORWARD_LOSS_STAFF_DECLARED",
        severity: "warning",
        area: "documents",
        message:
          `${staffDeclared.length} brought-forward capital-loss record(s) on this case (` +
          `${staffDeclared.map((e) => `AY ${e.originatingAssessmentYear}`).join(", ")}) are ` +
          "STAFF-DECLARED figures, not losses carried out of a finalized prior-year case in this " +
          "system. They carry no verified computation behind them.",
        suggestedAction:
          "Obtain the prior year's filed return or computation for each staff-declared record and " +
          "attach it, or re-record the loss from the finalized prior-year case if one exists here.",
        sources: [],
      });
    }
  }

  // 6g. Enhanced-ceiling disclosure (K4-08, decision D91). The ₹3,00,00,000
  // ceiling requires BOTH that cash receipts do not exceed 5% of total
  // receipts AND that cash PAYMENTS do not exceed 5% of total payments. The
  // adapter derives the receipts leg from the declared split, but no payments
  // data is captured anywhere in this product, so the second leg cannot be
  // verified. Below ₹2,00,00,000 the enhanced ceiling is not load-bearing —
  // the ordinary ceiling already covers the case — so this fires ONLY in the
  // band where an unverified condition is actually deciding eligibility.
  const presumptive44adTurnover = presumptive44adEntries.reduce((sum, e) => sum + e.amount, 0);
  if (presumptive44adTurnover > PRESUMPTIVE_44AD.turnoverCeiling) {
    findings.push({
      code: "PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED",
      severity: "blocker",
      area: "itr_form",
      message:
        `Aggregate Section 44AD turnover of ₹${presumptive44adTurnover} exceeds the ordinary ` +
        `₹${PRESUMPTIVE_44AD.turnoverCeiling} ceiling, so eligibility rests on the enhanced ` +
        `₹${PRESUMPTIVE_44AD.turnoverCeilingLowCash} ceiling. That ceiling requires BOTH that cash ` +
        "receipts do not exceed 5% of total receipts (derived from the declared split and satisfied) AND " +
        "that cash payments do not exceed 5% of total payments — this product captures no payments data, " +
        "so the second condition is NOT verified by this engine.",
      enteredValue: presumptive44adTurnover,
      suggestedAction:
        "Confirm from the books that cash payments did not exceed 5% of total payments for the year before " +
        "relying on this computation.",
      sources: tags44ad(presumptive44adEntries),
    });
  }

  // 7. Deductions claimed but proof missing.
  for (const d of input.deductions) {
    if (d.amount > 0 && !d.proofDocumentId && !d.sourceDocumentId) {
      findings.push({
        code: "DEDUCTION_PROOF_MISSING",
        severity: "warning",
        area: "deductions",
        message: `Deduction under ${d.section} of ₹${d.amount} is claimed without any supporting proof.`,
        enteredValue: d.amount,
        suggestedAction: `Attach proof for the ${d.section} claim (receipt / certificate).`,
        sources: [`${d.section}:${d.sourceType}:${d.id}`],
      });
    }
  }

  // 7b. Section 80TTA/80TTB claimed under a section that does not match the
  // taxpayer's own age band (K4-03) — the two are mutually exclusive by law
  // (`deductionCapForSection` in `rules.ts` already excludes the mismatched
  // claim from the computed total; this surfaces WHY, rather than leaving a
  // silently-zeroed line unexplained). Gated on resident status the same way
  // `compute-tax.ts`'s `effectiveOldRegimeAgeBand` is — a non-resident or
  // unresolved-residency taxpayer never receives resident senior/super-senior
  // treatment, so no mismatch finding applies to them either.
  if (input.taxpayer.residentStatus === "resident") {
    const ageBand = input.taxpayer.ageCategory;
    const isSenior = ageBand === "senior" || ageBand === "super_senior";
    for (const d of input.deductions) {
      if (d.amount <= 0) continue;
      if (d.section === "80TTA" && isSenior) {
        findings.push({
          code: "DEDUCTION_SECTION_AGE_MISMATCH",
          severity: "warning",
          area: "deductions",
          message: `Section 80TTA (₹${d.amount}) is claimed, but this taxpayer is a resident senior/super-senior citizen. Section 80TTA cannot be claimed by a resident senior citizen — Section 80TTB applies instead, and the two are mutually exclusive.`,
          enteredValue: d.amount,
          suggestedAction: "Re-tag this deduction row to Section 80TTB, or correct the taxpayer's date of birth if this is a data-entry error.",
          sources: [`80TTA:${d.sourceType}:${d.id}`],
        });
      } else if (d.section === "80TTB" && !isSenior) {
        findings.push({
          code: "DEDUCTION_SECTION_AGE_MISMATCH",
          severity: "warning",
          area: "deductions",
          message: `Section 80TTB (₹${d.amount}) is claimed, but this taxpayer is not a resident senior/super-senior citizen. Section 80TTB is available only to a resident senior citizen — Section 80TTA applies instead (savings-account interest only, lower cap).`,
          enteredValue: d.amount,
          suggestedAction: "Re-tag this deduction row to Section 80TTA, or correct the taxpayer's date of birth if this is a data-entry error.",
          sources: [`80TTB:${d.sourceType}:${d.id}`],
        });
      }
    }
  }

  // 8. Tax payable exists but no self-assessment challan entered.
  // (`computation` was already computed above, at 6b, for the house-property checks.)
  const payable = computation.refundOrPayable.value;
  const hasSelfAssessmentChallan = input.taxPaid.some(
    (t) => t.category === "self_assessment_tax" && t.amount > 0,
  );
  if (payable > 0 && !hasSelfAssessmentChallan) {
    findings.push({
      code: "TAX_PAYABLE_NO_CHALLAN",
      severity: "warning",
      area: "payments",
      message: `Tax payable of ₹${payable} remains but no self-assessment challan is recorded.`,
      sourceValue: payable,
      suggestedAction: "Record the self-assessment tax challan once paid.",
      sources: [],
    });
  }

  // 8b. Section 207(2) advance-tax exemption for a resident senior/super-
  // senior citizen with no business/professional income (K4-04, spec §10.4).
  // This is a DISCLOSURE, not a defect: TaxDesk OS computes no advance-tax-
  // adequacy/234B/234C finding for ANYONE (no such check exists), so there is
  // nothing incorrect to correct for a non-exempt taxpayer — this only
  // explains, when tax is payable, why THIS taxpayer was never required to
  // have paid it via advance-tax installments during the year. Gated on
  // resident status the same way 7b/`effectiveOldRegimeAgeBand` are; gated on
  // `hasBusinessOrProfessionalIncome` being false/absent because Section
  // 207(2)'s exemption requires no business/professional income.
  if (
    input.taxpayer.residentStatus === "resident" &&
    (input.taxpayer.ageCategory === "senior" || input.taxpayer.ageCategory === "super_senior") &&
    !input.hasBusinessOrProfessionalIncome &&
    payable > 0
  ) {
    findings.push({
      code: "ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2",
      severity: "info",
      area: "payments",
      // AUDIT-02-F6: this states what is RECORDED, never what is true of the
      // taxpayer. The trigger is the absence of a business/professional income
      // row, which is not evidence that none exists — a row simply may never
      // have been entered. Asserting the statutory conclusion outright would
      // be an over-claim from absent data, so the conclusion is conditioned on
      // the recorded facts and the preparer is told what to confirm.
      message:
        `Tax payable of ₹${payable} remains, and no business or professional income is recorded for this ` +
        "case. Under Section 207(2), a resident senior/super-senior citizen with no business or professional " +
        "income is not liable to pay advance tax, so on the facts recorded here the amount can be settled " +
        "entirely via self-assessment tax without interest under Sections 234B/234C for not having paid it " +
        "as advance tax during the year. This rests on the ledger being complete — confirm with the client " +
        "that no business or professional income exists before relying on it.",
      enteredValue: payable,
      suggestedAction:
        "Confirm the client has no business or professional income; if that holds, no advance-tax action is " +
        "needed and the amount can be settled via self-assessment tax.",
      sources: [],
    });
  }

  // 9. Client approval missing before filing.
  const isFilingOrLater = input.filingStatus === "ready_to_file" || input.filingStatus === "filed";
  if (isFilingOrLater && input.clientApprovalStatus !== "approved") {
    findings.push({
      code: "APPROVAL_MISSING",
      severity: "blocker",
      area: "workflow",
      message: `Case is "${input.filingStatus}" but client approval status is "${input.clientApprovalStatus}".`,
      suggestedAction: "Obtain client approval before filing.",
      sources: [],
    });
  }

  // 10. Filed but e-verification pending.
  if (input.filingStatus === "filed" && input.eVerificationStatus === "pending") {
    findings.push({
      code: "EVERIFICATION_PENDING",
      severity: "warning",
      area: "workflow",
      message: "Return is filed but e-verification is still pending.",
      suggestedAction: "Complete e-verification within the allowed window.",
      sources: [],
    });
  }

  // 11. Finalized edit attempted / blocked.
  if (input.finalized && input.editRequested) {
    findings.push({
      code: "FINALIZED_EDIT_BLOCKED",
      severity: "blocker",
      area: "workflow",
      message: "The case is finalized; edits are blocked.",
      suggestedAction: "Un-finalize the case (with authorization) before editing.",
      sources: [],
    });
  }

  // 12. Portal credential-like text in notes / free text.
  const freeTexts: { label: string; text: string }[] = [];
  if (input.notes) freeTexts.push({ label: "notes", text: input.notes });
  input.freeTextFields?.forEach((t, i) => freeTexts.push({ label: `freeText[${i}]`, text: t }));
  for (const e of input.income) if (e.notes) freeTexts.push({ label: `income:${e.id}`, text: e.notes });
  for (const t of input.taxPaid) if (t.notes) freeTexts.push({ label: `taxPaid:${t.id}`, text: t.notes });
  for (const d of input.deductions) if (d.notes) freeTexts.push({ label: `deduction:${d.id}`, text: d.notes });
  for (const cg of input.capitalGains) if (cg.notes) freeTexts.push({ label: `capitalGain:${cg.id}`, text: cg.notes });

  for (const { label, text } of freeTexts) {
    if (PORTAL_CREDENTIAL_PATTERNS.some((re) => re.test(text))) {
      findings.push({
        code: "PORTAL_CREDENTIAL_TEXT",
        severity: "blocker",
        area: "security",
        message: `Possible portal credential / OTP / password text detected in ${label}. Never store portal credentials.`,
        suggestedAction: "Remove the credential-like text. TaxDesk OS never stores portal passwords or OTPs.",
        sources: [label],
      });
    }
  }

  const hasBlockers = findings.some((f) => f.severity === "blocker");
  return { findings, hasBlockers };
}
