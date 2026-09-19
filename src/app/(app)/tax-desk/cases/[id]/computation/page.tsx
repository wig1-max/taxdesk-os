import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Layers, TriangleAlert } from "lucide-react";
import { SnapshotControls } from "@/components/snapshot-controls";
import { fieldsVersion } from "@/components/ui/reconcile-core";
import { Surface, SectionHeader } from "@/components/ui/section";
import { StatusPill } from "@/components/ui/status";
import { Callout } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth";
import { getTaxCaseComputationData } from "@/lib/queries/tax-desk";
import { getPromotedProposalLineage, getSourceProposalsView } from "@/lib/queries/tax-source-proposals";
import { totalOutstandingProposalWork } from "@/lib/tax-desk/source-proposals";
import { getTaxCaseEligibility } from "@/lib/queries/tax-eligibility";
import { computationWithheld } from "@/lib/tax-desk/eligibility";
import {
  evaluateRebateMarginalReliefRisk,
  evaluateSurchargeMarginalReliefRisk,
  totalIncomeForSurchargeApplicability,
} from "@/lib/tax-desk/tax-capability";
import { EligibilityBanner } from "@/components/tax-desk/eligibility-banner";
import { buildEngineInput, hasMeaningfulInput } from "@/lib/tax-desk/computation-adapter";
import {
  resolveFinancialOutcome,
  formatOutcomeAmount,
  outcomeCompareLabel,
  manualTreatmentNote,
  resolveRecommendationDisplay,
} from "@/lib/tax-desk/financial-outcome";
import { describeLedgerSupport } from "@/lib/tax-desk/ledger-support";
import {
  buildComputationFigureValues,
  COMPUTATION_FIGURE_INVENTORY,
  describeCaseTraceability,
  describeGoverningPack,
  FULL_CALCULATION_FIGURE_ROWS,
  packCaptionText,
  REGIME_COMPARISON_FIGURE_ROWS,
  SURCHARGE_DEPENDENCY_CAVEAT,
  surchargeDependencyCaveatFor,
  type ComputationFigureId,
} from "@/lib/tax-desk/case-traceability";
import {
  PackRefusedNotice,
  PackVerificationNotice,
  RuleTraceabilityPanel,
} from "@/components/tax-desk/pack-traceability";
import { TONE_CLASSES } from "@/lib/ui/status-tone";
import { cn } from "@/lib/utils";
import { compareRegimes, computeTax, recommendItrForm } from "@/lib/tax-engine/ay-2026-27";
import { taxCaseStatutoryContext } from "@/lib/tax-pack";

export const metadata: Metadata = { title: "ITR Prep — Computation" };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const FIGURE_SPEC_BY_ID = new Map(COMPUTATION_FIGURE_INVENTORY.map((figure) => [figure.id, figure]));

function amount(
  values: Readonly<Record<ComputationFigureId, number | string>>,
  id: ComputationFigureId,
): number {
  const value = values[id];
  if (typeof value !== "number") throw new Error(`Material figure ${id} is not an amount`);
  return value;
}

function decision(
  values: Readonly<Record<ComputationFigureId, number | string>>,
  id: ComputationFigureId,
): string {
  const value = values[id];
  if (typeof value !== "string") throw new Error(`Material figure ${id} is not a decision`);
  return value;
}

export default async function TaxDeskComputationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const data = await getTaxCaseComputationData(id);
  if (!data) notFound();

  // Computation eligibility gate (K.2.8.9A). When ineligible, all computed
  // output is WITHHELD — no outcome, no regime comparison, no ITR
  // recommendation, no snapshot — and the actionable blockers are shown instead.
  const [eligibility, promotedProposals, proposalsView] = await Promise.all([
    getTaxCaseEligibility(id),
    getPromotedProposalLineage(data.taxCaseId),
    getSourceProposalsView(data.taxCaseId),
  ]);
  const base = `/tax-desk/cases/${data.taxCaseId}`;
  // K3-31: outstanding proposal work is surfaced here (a preparer-facing
  // summary) as well as itemised in full on the Documents page — never an
  // eligibility blocker, purely visible work.
  const outstandingProposalWork = proposalsView ? totalOutstandingProposalWork(proposalsView.workSummary) : 0;

  // K3-22: the pack that GOVERNS this case is the only honest source of a rules
  // version to print. Never an engine constant — a version string on its own
  // would read as an endorsement of numbers nothing has verified.
  const statutory = taxCaseStatutoryContext(data.assessmentYear, data.law);
  const governing = describeGoverningPack(statutory);
  const packCaption =
    governing.outcome === "bound"
      ? packCaptionText(governing.pack)
      : `no governing tax pack (${governing.resolution})`;

  // An unbound world (ITA_2025 today) must not be priced by the 1961 engine.
  // Binding is not computation: this withholds the wrong-world figures rather
  // than attaching a surface. Snapshot / validation writers already refuse.
  if (governing.outcome !== "bound") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Computation — {data.clientName}</h1>
          <p className="text-xs text-muted-foreground">
            {data.law} {data.assessmentYear} / FY {data.financialYear} · {packCaption}
          </p>
        </div>
        <PackRefusedNotice reason={governing.reason} resolution={governing.resolution} />
      </div>
    );
  }

  if (eligibility && computationWithheld(eligibility.result)) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Computation — {data.clientName}</h1>
          <p className="text-xs text-muted-foreground">
            AY {data.assessmentYear} / FY {data.financialYear} · {packCaption}
          </p>
        </div>
        <EligibilityBanner result={eligibility.result} profileHref={`${base}/profile`} />
        <Surface className="p-5">
          <div data-testid="computation-withheld">
            <SectionHeader
              title="Computation withheld"
              description="A tax computation is not produced until the case is eligible. Resolve the items above, then return here."
            />
            <div className="mt-3 text-sm text-muted-foreground">
              No refund/payable, regime comparison or ITR recommendation is available yet, and snapshots are blocked.
            </div>
          </div>
        </Surface>
      </div>
    );
  }

  const adapter = buildEngineInput(data.rows, {
    assessmentYear: data.assessmentYear,
    financialYear: data.financialYear,
    selectedItrType: data.selectedItrType,
    finalized: data.finalized,
  });
  const meaningful = hasMeaningfulInput(adapter);
  const computation = computeTax(adapter.input);
  const comparison = compareRegimes(adapter.input);
  const recommendation = recommendItrForm(adapter.input);
  const figureOutputs = { computation, comparison, itrRecommendation: recommendation };
  const figures = buildComputationFigureValues(figureOutputs);

  const s = adapter.summary;
  // Canonical outcome for the live preview (recommended regime). Completeness
  // guard (K.2.8.7): unsupported entries make the input partial, so no
  // refund/payable/nil is shown — an "Incomplete preview" is shown instead.
  const outcome = resolveFinancialOutcome(amount(figures, "outcome.refundOrPayable"), meaningful, {
    unsupportedCount: adapter.unsupportedEntryCount,
  });
  const incompleteOutcome = outcome.kind === "incomplete";

  // Recommendation guard (K.2.8.7): a partial calculation (unsupported entries
  // excluded) cannot safely recommend a regime or an ITR form. When incomplete,
  // NO regime is highlighted, NO REC badge is shown, and NO ITR recommendation is
  // exposed — the selected ITR (a factual user choice) is preserved. Engine
  // calculations, sign convention, and snapshot gating are unchanged.
  const rec = resolveRecommendationDisplay({
    unsupportedCount: adapter.unsupportedEntryCount,
    recommendedRegime: comparison.recommendedRegime,
    recommendedItrType: recommendation.recommendedItrType,
  });
  const recRegime = rec.regime;
  const itrMismatch =
    rec.available && !!data.selectedItrType && data.selectedItrType !== recommendation.recommendedItrType;

  // K3-22: per-figure traceability over the SAME adapter result and computation
  // the page renders — the pack + rules behind each number, the evidence behind
  // it, and what the numbers exclude. Derives nothing; displays existing truth.
  const traceability = describeCaseTraceability({
    statutory,
    adapter,
    rows: data.rows,
    outputs: figureOutputs,
    taxCaseId: data.taxCaseId,
    promotedProposals,
  });

  // TAX-SAFE-01 / TAX-SAFE-01A: automatic, income-derived reliance blocker —
  // independent of whether a preparer declared "surcharge_or_marginal_relief"
  // as a special situation. A provisional computation is still shown (never
  // withheld) so the preparer can diagnose the case, but it must never read
  // as approval-ready. See src/lib/tax-desk/tax-capability.ts. Uses the
  // canonical `totalIncomeForSurchargeApplicability` helper (the higher of
  // the two regimes' taxable income — conservative, never under-blocks
  // regardless of which regime is ultimately selected) — the SAME helper
  // every other enforcement layer (client-review actions, readiness query,
  // guarded RPCs) now uses, so no layer can silently disagree on the base
  // figure — read through the SAME already-extracted figures map every other
  // number on this page uses (see the K3-25 lexical source-audit boundary
  // test, which forbids this file from extracting a scalar directly off a
  // raw ComputedValue).
  //
  // K4-11 NARROWED this. The income base and the canonical helper are
  // unchanged; what is added is the engine's OWN verdict on whether it could
  // complete the surcharge treatment. That verdict is read straight off the
  // computation rather than re-derived from the income here — this page must
  // not become a fifth authority on the window, which is precisely the D44
  // failure mode. It is deliberately NOT taken from the `figures` map: it is a
  // boolean judgement, not a material rupee figure, so it is out of scope for
  // the K3-25 lexical source-audit boundary, which forbids reading a scalar
  // straight off a raw ComputedValue — there is no ComputedValue here at all.
  // (That guard greps this file's own source text, so the forbidden token must
  // not appear even inside a comment — the D122 lesson, met again here.)
  const surchargeRisk = evaluateSurchargeMarginalReliefRisk(
    totalIncomeForSurchargeApplicability(
      amount(figures, "comparison.old.totalIncome"),
      amount(figures, "comparison.new.totalIncome"),
    ),
    computation.surchargeTreatmentSupported,
  );
  // K4-12: the SEPARATE section 87A rebate-threshold relief verdict, read the
  // same way and for the same reason — this page must not become a second
  // authority on that window either. Its base is the NEW regime's own total
  // income, not the higher-of-both figure the surcharge gate uses, because the
  // relief reaches the new regime only.
  const rebateReliefRisk = evaluateRebateMarginalReliefRisk(
    amount(figures, "comparison.new.totalIncome"),
    computation.rebateReliefTreatmentSupported,
  );

  const canSnapshot = !data.finalized && adapter.complete && meaningful;
  const blockedReason = data.finalized
    ? "Case finalized — no new snapshots."
    : !adapter.complete
      ? "Resolve unsupported entries to enable snapshot."
      : !meaningful
        ? "Add ledger entries to enable snapshot."
        : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Computation — {data.clientName}</h1>
        <p className="text-xs text-muted-foreground">
          AY {data.assessmentYear} / FY {data.financialYear} · {packCaption} · preview only, not tax advice
        </p>
      </div>

      {eligibility && <EligibilityBanner result={eligibility.result} profileHref={`${base}/profile`} compact />}

      {/* K3-25: the governing pack's draft/not-CA-verified state and the exact
          traced/projection/categorical/limitation partition are stated before
          the numbers, never only inside a disclosure. */}
      {traceability.outcome === "traced" ? (
        <PackVerificationNotice
          pack={traceability.pack}
          relianceBlocker={traceability.relianceBlocker}
        />
      ) : (
        <PackRefusedNotice reason={traceability.reason} resolution={traceability.resolution} />
      )}

      {/* TAX-SAFE-01: a structural reliance blocker, not a caveat buried in a
          disclosure — shown above the numbers, exactly like the pack-draft
          notice above. The figures below remain visible for diagnosis. */}
      {surchargeRisk && (
        <Callout tone="warning" title="Provisional computation — reliance blocked">
          <p>
            Surcharge and marginal relief could not be computed for this case (total income ₹
            {surchargeRisk.totalIncome.toLocaleString("en-IN")}, above the conservative ₹
            {surchargeRisk.thresholdInr.toLocaleString("en-IN")} risk threshold). Surcharge IS
            computed up to a total income of ₹2,00,00,000; above that the 25%/37% tiers and the
            then-binding 15% cap on dividend and section 111A/112/112A income are not modelled, and
            marginal relief is not applied where the statute does not fix how its notional reference
            income is composed. The figures below are provisional and for preparer diagnosis only —
            they are NOT a final tax amount, an approved liability, or a filing-ready position, and
            any ₹0 surcharge shown is not a verified nil. Client review, approval and finalization
            are blocked until this case is prepared manually or the engine adds verified treatment
            for it.
          </p>
        </Callout>
      )}

      {/* K4-12: the SEPARATE section 87A rebate-threshold relief blocker. Its
          own notice rather than a sentence bolted onto the surcharge one —
          a preparer of a ₹12.2 lakh case told "surcharge" would be reading
          something untrue (the K.2.9.4 / D129 status-copy rule). */}
      {rebateReliefRisk && (
        <Callout tone="warning" title="Provisional computation — reliance blocked">
          <p>
            Section 87A marginal relief could not be computed for this case (new-regime total income
            ₹{rebateReliefRisk.totalIncome.toLocaleString("en-IN")}, just above the ₹
            {rebateReliefRisk.ceilingInr.toLocaleString("en-IN")} rebate ceiling, where relief may be
            due). This case also carries special-rate section 111A/112A income, and no located source
            settles either whether the rebate is available at all where total income includes such
            gains, or what &ldquo;the income-tax payable on such total income&rdquo; comprises. NO
            relief was applied, so the tax shown is NOT understated — it may be OVERSTATED by up to
            the full rebate. This is a different relief from the surcharge marginal relief and shares
            only the name. Client review, approval and finalization are blocked until this case is
            prepared manually or the engine adds verified treatment for it.
          </p>
        </Callout>
      )}

      {/* K4-19: Section 89(1) arrears relief. UNIVERSAL on any case carrying
          salary or pension, because unlike every other gap disclosed above this
          one CANNOT BE DETECTED. Surcharge and rebate relief are income-derived
          — the numbers reveal them. Arrears are not in the numbers at all:
          ₹8,00,000 of salary is identical whether or not ₹3,00,000 of it is
          arrears, so there is nothing to condition on except the presence of
          salary itself.

          It is deliberately NOT worded as a reliance blocker, and that is the
          K.2.9.4 / D129 status-copy rule doing its work rather than being
          relaxed: this does not block anything, and a notice that said it did
          would be false on every ordinary salaried case. Blocking every salaried
          return on a relief that applies to a small minority of them would also
          be its own dishonesty. The DECLARED case is blocked — by the
          `salary_arrears_section_89` special situation, through the existing
          eligibility gate. This notice exists for the case nobody declared, and
          it is the only thing covering it. */}
      {s.salary > 0 && (
        <Callout tone="warning" title="Section 89 arrears relief is not computed">
          <p data-testid="section-89-disclosure">
            This computation contains <strong>no Section 89(1) relief</strong>. If any part of the
            salary or pension above was received in <strong>arrears or in advance</strong>, relief
            under Rule 21A may be due and <strong>Form 10E may have to be filed</strong> — neither
            is modelled here. Relief needs each earlier year&apos;s own rate schedule and total
            income, and this engine holds one year of rates and no multi-year history, so it is not
            a figure that could be produced and reviewed; it is absent. Omitting relief can only
            make the tax shown <strong>too high, never too low</strong>. Nothing on this page detects
            arrears, so this notice appears on every case with salary or pension income and its
            absence would prove nothing. Where arrears are present, declare{" "}
            <Link href={`${base}/profile`} className="font-medium underline">
              salary or pension arrears
            </Link>{" "}
            on the taxpayer profile to route the case to manual professional preparation. The Rule
            21A(3)-(5) limbs — gratuity, commuted pension and compensation on termination — are
            equally not computed.
          </p>
        </Callout>
      )}

      {/* K3-31: outstanding source-proposal work — visible here, itemised in
          full on Documents. Never a blocker; purely a work-queue signal. */}
      {outstandingProposalWork > 0 && proposalsView && (
        <Callout tone="info" title="Proposed source facts need review">
          <p>
            {proposalsView.workSummary.awaitingDecision} awaiting decision ·{" "}
            {proposalsView.workSummary.acceptedNotPromoted} accepted, not yet promoted into the
            ledgers · {proposalsView.workSummary.rejectedNeedsFreshProposal} rejected, need a fresh
            proposal.{" "}
            <Link href={`${base}/documents`} className="underline">
              Review in Documents →
            </Link>
          </p>
        </Callout>
      )}

      {/* 1. Dominant outcome + snapshot action */}
      <Surface className="p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div
            data-testid="computation-outcome"
            data-outcome-kind={outcome.kind}
            className="min-w-0"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {outcome.label}
            </div>
            <div
              className={cn(
                "tnum text-4xl font-bold leading-tight",
                outcome.amount == null ? "text-muted-foreground" : TONE_CLASSES[outcome.tone].text,
              )}
              data-material-figure-id="outcome.refundOrPayable"
            >
              {formatOutcomeAmount(outcome)}
            </div>
            {incompleteOutcome ? (
              <div className="mt-1 text-sm text-warning">
                {manualTreatmentNote(outcome.unsupportedCount)} ·{" "}
                <span className="text-muted-foreground">No reliable balance until resolved</span>
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>
                  Recommended regime{" "}
                  <span
                    className="font-semibold uppercase text-foreground"
                    data-material-figure-id="decision.recommendedRegime"
                  >
                    {decision(figures, "decision.recommendedRegime")}
                  </span>
                </span>
                <span aria-hidden>·</span>
                <span className="tnum" data-material-figure-id="outcome.taxPaid">
                  Tax paid {inr(amount(figures, "outcome.taxPaid"))}
                </span>
                <span aria-hidden>·</span>
                <span>{packCaption}</span>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <StatusPill
                tone={data.snapshots.length > 0 ? "info" : "warning"}
                label={data.snapshots.length > 0 ? `${data.snapshots.length} snapshot${data.snapshots.length === 1 ? "" : "s"}` : "No snapshot"}
                dot={false}
              />
              <span className="text-muted-foreground">
                Selected ITR {data.selectedItrType ?? "—"}
                {incompleteOutcome
                  ? " · ITR recommendation unavailable until manual-treatment entries are resolved"
                  : ` · recommended ${decision(figures, "decision.recommendedItrType")}`}
              </span>
            </div>
            {!incompleteOutcome && (
              <p
                className="mt-2 max-w-3xl text-xs text-warning"
                data-testid="surcharge-dependency-caveat"
              >
                {SURCHARGE_DEPENDENCY_CAVEAT}
              </p>
            )}
          </div>

          <div className="shrink-0 rounded-lg border bg-muted/20 p-3">
            <SnapshotControls
              taxCaseId={data.taxCaseId}
              canSnapshot={canSnapshot}
              blockedReason={blockedReason}
              // Reconciliation signal (K.2.9.2): a new immutable snapshot bumps the
              // count and prepends a new id/created_at, so this flips on save.
              dataVersion={fieldsVersion([
                data.snapshots.length,
                data.snapshots[0]?.id,
                data.snapshots[0]?.created_at,
              ])}
            />
          </div>
        </div>
      </Surface>

      {/* 2. Warnings — unmistakable, before secondary detail */}
      {(data.finalized || !meaningful || !adapter.complete || itrMismatch) && (
        <div className="space-y-2">
          {data.finalized && (
            <Callout tone="neutral" title="Finalized — read-only">
              New snapshots are blocked; existing snapshots remain readable.
            </Callout>
          )}
          {!meaningful && (
            <Callout tone="warning" title="Nothing to compute yet">
              No mapped income or tax figures. Add entries in{" "}
              <Link href={`${base}/ledgers`} className="underline">
                Ledgers
              </Link>{" "}
              to see a computation.
            </Callout>
          )}
          {!adapter.complete && (
            <Callout
              tone="warning"
              icon={TriangleAlert}
              title={`Partial preview — ${adapter.unsupportedEntryCount} entr${adapter.unsupportedEntryCount === 1 ? "y is" : "ies are"} not computed by this engine`}
            >
              <p>Unsupported entries are excluded. Not filing-ready; snapshot is blocked.</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {adapter.warnings.map((w) => (
                  <li key={w.ledgerId}>
                    {w.entryType} ({inr(w.amount)}) — {w.code}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {itrMismatch && (
            <Callout tone="warning" title="ITR form differs from recommendation">
              Selected ITR ({data.selectedItrType}) differs from the recommended form (
              {decision(figures, "decision.recommendedItrType")}). Confirm this is intentional
              (professional judgment).
            </Callout>
          )}
        </div>
      )}

      {/* 3. Regime comparison */}
      <Surface className="p-4">
        <SectionHeader
          title={incompleteOutcome ? "Partial regime comparison — supported entries only" : "Regime comparison"}
          description={
            incompleteOutcome
              ? "Unsupported entries are excluded. No regime recommendation is available until all manual-treatment entries are resolved."
              : "Recommended regime is highlighted. Not tax advice — CA verification required."
          }
          icon={<Layers className="h-4 w-4" />}
        />
        <p
          className="mt-2 text-xs text-warning"
          data-testid="surcharge-dependency-caveat"
        >
          {SURCHARGE_DEPENDENCY_CAVEAT}
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm" data-testid="regime-comparison">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="py-2 text-left font-medium">
                  Line
                </th>
                <th scope="col" className={cn("py-2 text-right font-medium", recRegime === "old" && "text-foreground")}>
                  Old regime {recRegime === "old" && <RecTag />}
                </th>
                <th scope="col" className={cn("py-2 text-right font-medium", recRegime === "new" && "text-foreground")}>
                  New regime {recRegime === "new" && <RecTag />}
                </th>
              </tr>
            </thead>
            <tbody>
              {REGIME_COMPARISON_FIGURE_ROWS.map((row) => (
                <CompareRow
                  key={row.oldId}
                  label={row.label}
                  oldId={row.oldId}
                  newId={row.newId}
                  values={figures}
                  rec={recRegime}
                  strong={row.strong}
                />
              ))}
              <tr className={cn("border-t font-semibold")}>
                <td className="py-2 pr-2">Final outcome</td>
                <td
                  className={cn("py-2 pr-2 text-right tnum", recRegime === "old" && "bg-accent/60")}
                  data-material-figure-id="comparison.old.refundOrPayable"
                >
                  {outcomeCompareLabel(amount(figures, "comparison.old.refundOrPayable"))}
                </td>
                <td
                  className={cn("py-2 text-right tnum", recRegime === "new" && "bg-accent/60")}
                  data-material-figure-id="comparison.new.refundOrPayable"
                >
                  {outcomeCompareLabel(amount(figures, "comparison.new.refundOrPayable"))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Difference in liability between regimes (old minus new; positive means new is lower):{" "}
          <span className="tnum font-medium" data-material-figure-id="comparison.difference">
            {inr(amount(figures, "comparison.difference"))}
          </span>.
        </p>
      </Surface>

      {/* 4. Input summary + case facts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Surface className="p-4">
          <SectionHeader
            title="Input summary"
            description={`${adapter.mappedEntryCount} supported · ${describeLedgerSupport(adapter.unsupportedEntryCount)}`}
            actions={
              <Link href={`${base}/ledgers`} className="text-xs font-medium text-primary hover:underline">
                Edit in Ledgers →
              </Link>
            }
          />
          <table className="mt-3 w-full text-sm">
            <tbody>
              {[
                ["Salary", s.salary],
                ["Interest (savings + FD)", s.interest],
                ["Dividend / other sources", s.dividendOther],
                ["Exempt income", s.exempt],
                ["Deductions", s.deductions],
                ["STCG 111A", s.stcg111a],
                ["LTCG 112A", s.ltcg112a],
                ["Total tax paid", s.totalTaxPaid],
              ].map(([label, val]) => (
                <tr key={label as string} className="border-t">
                  <td className="py-1.5 pr-2 text-muted-foreground">{label}</td>
                  <td className="py-1.5 text-right tnum">{inr(val as number)}</td>
                </tr>
              ))}
              <tr className="border-t font-medium">
                <td className="py-1.5 pr-2">Gross total income</td>
                <td className="py-1.5 text-right tnum" data-material-figure-id="summary.grossTotalIncome">
                  {inr(amount(figures, "summary.grossTotalIncome"))}
                </td>
              </tr>
            </tbody>
          </table>
        </Surface>

        <Surface className="p-4">
          <SectionHeader title="ITR form" description="Selected vs engine recommendation" />
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Selected ITR</dt>
              <dd className="font-medium">{data.selectedItrType ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Recommended ITR</dt>
              {incompleteOutcome ? (
                <dd className="text-xs text-muted-foreground">
                  ITR recommendation unavailable until manual-treatment entries are resolved.
                </dd>
              ) : (
                <dd className="font-medium">
                  <span data-material-figure-id="decision.recommendedItrType">
                    {decision(figures, "decision.recommendedItrType")}
                  </span>
                  {recommendation.blockers.length > 0 && (
                    <span className="ml-2">
                      <StatusPill tone="warning" label={`${recommendation.blockers.length} blocker${recommendation.blockers.length > 1 ? "s" : ""}`} dot={false} />
                    </span>
                  )}
                </dd>
              )}
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Parent case</dt>
              <dd>
                <Link href={`/cases/${data.caseId}`} className="font-mono text-xs text-primary hover:underline">
                  {data.caseDisplayCode ?? data.caseId}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Supported / need manual treatment</dt>
              <dd className="tnum">{adapter.mappedEntryCount} / {adapter.unsupportedEntryCount}</dd>
            </div>
          </dl>
        </Surface>
      </div>

      {/* 5. Full calculation (progressive disclosure) */}
      <details className="group rounded-xl border bg-card shadow-elev-1">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
            View full calculation
          </span>
          <span className="text-xs font-normal text-muted-foreground">slab / special-rate / cess detail</span>
        </summary>
        <div className="overflow-x-auto border-t px-4 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="py-1 text-left font-medium">Line</th>
                <th scope="col" className="py-1 text-right font-medium">Old</th>
                <th scope="col" className="py-1 text-right font-medium">New</th>
              </tr>
            </thead>
            <tbody>
              {FULL_CALCULATION_FIGURE_ROWS.map((row) => (
                <CompareRow
                  key={row.oldId}
                  label={row.label}
                  oldId={row.oldId}
                  newId={row.newId}
                  values={figures}
                  rec={recRegime}
                  strong={row.strong}
                />
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* 6. Source traceability (progressive disclosure) */}
      <details className="group rounded-xl border bg-card shadow-elev-1">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
            Source traceability
          </span>
          <span className="text-xs font-normal text-muted-foreground">{adapter.sourceTrace.length} mapped groups</span>
        </summary>
        <div className="overflow-x-auto border-t px-4 py-3">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">Mapped group</th>
                <th scope="col" className="py-1 pr-2 font-medium">Entries</th>
                <th scope="col" className="py-1 pr-2 font-medium">Source types</th>
                <th scope="col" className="py-1 pr-2 font-medium">Documents</th>
                <th scope="col" className="py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {adapter.sourceTrace.map((g) => (
                <tr key={g.key} className="border-t align-top">
                  <td className="py-1 pr-2">{g.label}</td>
                  <td className="py-1 pr-2">{g.ledgerIds.length}</td>
                  <td className="py-1 pr-2">{g.sourceTypes.join(", ")}</td>
                  <td className="py-1 pr-2">{g.documentLabels.length ? g.documentLabels.join(", ") : "—"}</td>
                  <td className="py-1 text-right tnum">{inr(g.total)}</td>
                </tr>
              ))}
              {adapter.sourceTrace.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-muted-foreground">
                    No mapped ledger entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>

      {/* 6b. Rule & evidence traceability (K3-22) */}
      <RuleTraceabilityPanel traceability={traceability} />

      {/* 7. Snapshot history */}
      <Surface className="p-4">
        <SectionHeader title="Snapshot history" description="Append-only, newest first" />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">Saved</th>
                <th scope="col" className="py-1 pr-2 font-medium">By</th>
                <th scope="col" className="py-1 pr-2 font-medium">Status</th>
                <th scope="col" className="py-1 pr-2 font-medium">Recommended ITR</th>
                <th scope="col" className="py-1 pr-2 font-medium">Regime</th>
                <th scope="col" className="py-1 font-medium">Engine</th>
              </tr>
            </thead>
            <tbody>
              {data.snapshots.map((snap) => (
                <tr key={snap.id} className="border-t">
                  <td className="py-1.5 pr-2">{new Date(snap.created_at).toLocaleString("en-IN")}</td>
                  <td className="py-1.5 pr-2">{snap.created_by_name ?? "—"}</td>
                  <td className="py-1.5 pr-2">
                    <StatusPill tone={snap.complete ? "success" : "warning"} label={snap.complete ? "complete" : "partial"} dot={false} />
                  </td>
                  <td className="py-1.5 pr-2">{snap.recommended_itr_type ?? "—"}</td>
                  <td className="py-1.5 pr-2 uppercase">{snap.recommended_regime ?? "—"}</td>
                  <td className="py-1.5">{snap.rules_version}</td>
                </tr>
              ))}
              {data.snapshots.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-muted-foreground">
                    No snapshots yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Surface>
    </div>
  );
}

function RecTag() {
  return (
    <span className="ml-1 rounded bg-success-soft px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase text-success">
      Rec
    </span>
  );
}

function CompareRow({
  label,
  oldId,
  newId,
  values,
  rec,
  strong,
}: {
  label: string;
  oldId: ComputationFigureId;
  newId: ComputationFigureId;
  values: Readonly<Record<ComputationFigureId, number | string>>;
  /** null when no regime is recommended (incomplete input) — no highlight. */
  rec: "old" | "new" | null;
  strong?: boolean;
}) {
  const limitation = FIGURE_SPEC_BY_ID.get(oldId)?.limitation;
  const implementationCaveat = surchargeDependencyCaveatFor(oldId);
  return (
    <tr className={cn("border-t", strong && "font-semibold")}>
      <td className="py-1.5 pr-2 text-muted-foreground">
        {label}
        {limitation && (
          <span className="block max-w-xl text-[0.68rem] font-normal leading-snug text-warning">
            {limitation}
          </span>
        )}
        {implementationCaveat && (
          <span className="block max-w-xl text-[0.68rem] font-normal leading-snug text-warning">
            {implementationCaveat}
          </span>
        )}
      </td>
      <td
        className={cn("py-1.5 pr-2 text-right tnum", rec === "old" && "bg-accent/40")}
        data-material-figure-id={oldId}
      >
        {inr(amount(values, oldId))}
      </td>
      <td
        className={cn("py-1.5 text-right tnum", rec === "new" && "bg-accent/40")}
        data-material-figure-id={newId}
      >
        {inr(amount(values, newId))}
      </td>
    </tr>
  );
}
