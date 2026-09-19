/**
 * TaxDesk OS — Tax Desk: PACK & RULE traceability surfaces (K3-22).
 *
 * Presentation only. Every value shown here comes from the pure
 * `describeCaseTraceability` / `describeGoverningPack` read model
 * (`src/lib/tax-desk/case-traceability.ts`) — nothing is derived, computed, or
 * re-worded here, and no wording may imply that a pack, a rule, or a number is
 * CA-verified. TaxDesk OS ships no `ca_verified` pack.
 *
 * These are server-renderable (no client state), so they add no reconciliation
 * surface: they display existing truth and mutate nothing.
 */

import { ChevronRight, ShieldAlert } from "lucide-react";
import { Callout } from "@/components/ui/alert";
import {
  summarizeTraceabilityStates,
  type CaseTraceability,
  type GoverningPackState,
  type TraceableLine,
} from "@/lib/tax-desk/case-traceability";
import type { TaxPackRelianceBlocker } from "@/lib/tax-pack/verification-state";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * The unmissable statement that the governing pack is not CA-verified. Rendered
 * ABOVE the numbers, not tucked into a disclosure — a preparer must not have to
 * open anything to learn that the governing rules package is unverified.
 *
 * Deliberately distinct from the four professional-review concepts (K.2.9.4):
 * this is about the *rules package*, not about who reviewed the case.
 */
export function PackVerificationNotice({
  pack,
  relianceBlocker,
  scope = "computation",
}: {
  pack: GoverningPackState;
  relianceBlocker: TaxPackRelianceBlocker | null;
  /** Which screen-specific truthfulness contract the notice must explain. */
  scope?: "computation" | "validation";
}) {
  if (pack.verified) return null;
  return (
    <div data-testid="pack-verification-notice">
    <Callout
      tone="warning"
      icon={ShieldAlert}
      title={`Tax pack ${pack.computationRulesVersion} is ${pack.status} — not CA-verified`}
    >
      <p>
        {scope === "validation"
          ? "These checks are produced by validation rules that no qualified professional has yet checked against the official sources; an absent finding is not assurance."
          : "Traced rule-derived figures below use this unverified pack's rules. Input projections apply no tax rule; categorical decisions have no engine source tags; explicit limitations claim no complete trace."}{" "}
        Preparation only — not tax advice, and not a basis for real-client reliance.
      </p>
      {relianceBlocker && (
        <p className="mt-1 text-xs">
          {relianceBlocker.message} ({relianceBlocker.code}).
        </p>
      )}
      {pack.unverifiedRuleIds.length > 0 && (
        <p className="mt-1 text-xs">
          Unverified rule groups: <span className="font-mono">{pack.unverifiedRuleIds.join(", ")}</span>
        </p>
      )}
    </Callout>
    </div>
  );
}

/** The refusal shown when no bound pack governs the case. Never a fallback number. */
export function PackRefusedNotice({
  reason,
  resolution,
}: {
  reason: string;
  resolution: string;
}) {
  return (
    <div data-testid="pack-refused-notice">
      <Callout tone="warning" icon={ShieldAlert} title="No versioned tax pack governs this case">
        <p>{reason}</p>
        <p className="mt-1 text-xs">Resolution: {resolution}. No computation may be relied upon.</p>
      </Callout>
    </div>
  );
}

function LineRow({ line }: { line: TraceableLine }) {
  return (
    <tr className="border-t align-top" data-testid={`traceability-line-${line.id}`}>
      <td className="py-1.5 pr-2 font-medium">{line.label}</td>
      <td className="py-1.5 pr-2 text-right tnum">
        {line.format === "amount" ? inr(line.value as number) : line.value}
      </td>
      <td className="py-1.5 pr-2">
        {line.state === "untraced_limitation" ? (
          <span className="text-warning">{line.limitation}</span>
        ) : line.kind === "input_projection" ? (
          <span className="text-muted-foreground">
            Sum of declared entries — no rate, cap or threshold applied
          </span>
        ) : (
          <ul className="space-y-0.5">
            {line.rules.map((r) => (
              <li key={r.ruleId}>
                <span className="font-mono">{r.ruleId}</span>
                <span className="text-muted-foreground"> — {r.summary}</span>
                {r.citations.length > 0 ? (
                  <span className="block text-muted-foreground">{r.citations.join("; ")}</span>
                ) : (
                  <span className="block text-warning">No official source cited for this rule</span>
                )}
                {r.caveat && <span className="block text-warning">{r.caveat}</span>}
              </li>
            ))}
          </ul>
        )}
        {line.unknownRuleIds.length > 0 && (
          <p className="text-warning">
            Rule id(s) not declared by this pack: {line.unknownRuleIds.join(", ")}
          </p>
        )}
        {line.implementationCaveat && (
          <p className="mt-0.5 text-warning">{line.implementationCaveat}</p>
        )}
      </td>
      <td className="py-1.5 pr-2">
        {line.state === "not_source_tagged_by_construction" ? (
          <span className="text-warning">No engine source tags by construction — {line.limitation}</span>
        ) : line.state === "untraced_limitation" ? (
          <span className="text-warning">No evidence lineage claimed for this display limitation</span>
        ) : line.contributingFacts.length === 0 ? (
          <span className="text-muted-foreground">
            Derived from totals — no individual entry is tagged
          </span>
        ) : (
          <ul className="space-y-0.5">
            {line.contributingFacts.map((f) => (
              <li key={f.ledgerId} className="text-muted-foreground" data-proposal-id={f.promotedProposal?.proposalId}>
                {/* "No source document" — NOT "no document": a deduction may
                    carry a separate proof the engine does not tag by, and this
                    column must not understate it. */}
                {f.documentLabel ?? "No source document"} · {f.sourceType.replaceAll("_", " ")} ·{" "}
                {f.resolvedBy === "document" ? "matched by document" : "matched by entry"}
                {/* K3-31: a row promoted through the propose -> review ->
                    promote workflow states its human decision lineage. Never
                    "verified"/"accurate"/"approved by ITD" — a human accepted
                    the proposed value; nothing has checked it against the
                    original document. A manually entered row (no
                    `promotedProposal`) renders exactly as before. */}
                {f.promotedProposal && (
                  <span className="block text-foreground" data-testid="promoted-proposal-lineage">
                    Accepted through proposal workflow
                    {f.promotedProposal.decidedByName ? ` by ${f.promotedProposal.decidedByName}` : ""}
                    {f.promotedProposal.decidedAt
                      ? ` on ${new Date(f.promotedProposal.decidedAt).toLocaleDateString("en-IN")}`
                      : ""}
                    ; promoted from an accepted source proposal
                    {f.promotedProposal.promotedAt
                      ? ` on ${new Date(f.promotedProposal.promotedAt).toLocaleDateString("en-IN")}`
                      : ""}
                    .
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {line.unresolvedSourceTags.length > 0 && (
          <p className="text-warning">
            {line.unresolvedSourceTags.length} source tag(s) matched no live ledger entry
          </p>
        )}
      </td>
      <td className="py-1.5">
        {line.state === "untraced_rule_mapping_gap" ? (
          <span className="text-warning">Untraced rule mapping gap</span>
        ) : line.state === "untraced_limitation" ? (
          <span className="text-warning">Untraced limitation</span>
        ) : line.state === "not_source_tagged_by_construction" ? (
          <span className="text-warning">Not source-tagged</span>
        ) : line.rulesUnverified ? (
          <span className="text-warning">Unverified</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

/**
 * Per-figure traceability: each row's effective rule/evidence state and the
 * versioned rules or explicit gap behind that state. Progressive disclosure — the
 * *unverified* and *incomplete* statements are made above, never only in here.
 */
export function RuleTraceabilityPanel({ traceability }: { traceability: CaseTraceability }) {
  if (traceability.outcome === "refused") return null;
  const { pack, lines, completeness } = traceability;
  if (lines.length === 0) return null;
  const stateSummary = summarizeTraceabilityStates(lines);

  return (
    <details className="group rounded-xl border bg-card shadow-elev-1" data-testid="rule-traceability">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
        <span className="flex items-center gap-2">
          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
          Rule &amp; evidence traceability
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          pack {pack.computationRulesVersion} · {pack.status}
        </span>
      </summary>
      <div className="space-y-2 border-t px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Closed authored material-figure inventory: {stateSummary.authoredTraced} traced,{" "}
          {stateSummary.authoredCategorical} categorical and not source-tagged by construction,{" "}
          {stateSummary.authoredLimitations} explicit untraced limitations. Effective for this
          governing pack: {stateSummary.effectiveTraced} traced,{" "}
          {stateSummary.effectiveCategorical} categorical,{" "}
          {stateSummary.effectiveRuleMappingGaps} untraced rule-mapping gaps — categorical decisions
          cite pack rules too, so their citations are checked for drift exactly like traced figures.
          Traced figures use the engine&apos;s own values and source tags; cited rules resolve only
          through tax pack <span className="font-mono">{pack.key}</span>. {pack.summary}.
        </p>
        {!completeness.complete && (
          <p className="text-xs text-warning" data-testid="traceability-incomplete">
            These figures EXCLUDE {completeness.excluded.length} declared entr
            {completeness.excluded.length === 1 ? "y" : "ies"} the engine cannot represent (
            {completeness.excluded.map((e) => `${e.entryType} ${inr(e.amount)}`).join(", ")}). They are
            partial, not final.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">Figure</th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">Amount</th>
                <th scope="col" className="py-1 pr-2 font-medium">Versioned rule(s)</th>
                <th scope="col" className="py-1 pr-2 font-medium">Evidence behind it</th>
                <th scope="col" className="py-1 font-medium">Verification</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <LineRow key={line.id} line={line} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
