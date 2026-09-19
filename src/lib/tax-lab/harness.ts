/**
 * TaxDesk OS — Synthetic Case Laboratory: the deterministic HARNESS
 * (Wave 2, K3-20).
 *
 * PURE TYPESCRIPT ONLY (see material-outputs.ts for the boundary rules).
 *
 * For one fixture the harness:
 *   1. resolves the governing pack through `bindTaxPackToCase` — the SAME single
 *      authority production writers use — and reports a typed refusal if none
 *      binds (never a fallback engine, never a guess);
 *   1a. WITHHOLDS every fact whose evidence was not accepted (`K3-21`) — before
 *      the adapter runs, so an unaccepted fact is never folded into preparation
 *      truth and instead comes back as typed, itemised work;
 *   2. builds the engine input through the existing `buildEngineInput` adapter,
 *      so the laboratory exercises the real mapping layer including the warnings
 *      it raises for facts the engine cannot represent;
 *   3. computes **through the resolved pack's `binding.computation`** — this is
 *      the pack-routed path decisions D8/D10 defer for *production call sites*,
 *      not for tests; the laboratory is exactly where it gets exercised;
 *   4. checks every declared expectation — validating its cited rule ids against
 *      the resolved pack's own provenance, its `rulesUnverified` claim against
 *      the pack's caveats + lifecycle status, and (K3-21) resolving the engine's
 *      OWN per-`ComputedValue` source tags back to the accepted evidence-backed
 *      facts behind the number;
 *   5. checks the pinned `validateCase` findings by code + severity + area, both
 *      ways, so "unsupported facts create explicit work" is proved for the
 *      validation half of the golden path too.
 *
 * Unsupported facts NEVER produce a guess and NEVER skip an assertion. A fixture
 * whose adapter run raised mapping warnings comes back `blocked` with the facts
 * itemised, and every declared expectation is still evaluated and reported — the
 * outcome tells the reader the numbers exclude those facts, rather than quietly
 * omitting them.
 *
 * The harness computes nothing itself. It resolves, routes, projects and compares.
 */

import { buildEngineInput, type AdapterResult, type LedgerRows, type MappingWarning } from "@/lib/tax-desk/computation-adapter";
import { bindTaxPackToCase, type TaxCasePackVersions } from "@/lib/tax-pack/case-pack";
import { taxPackProvenance } from "@/lib/tax-pack/pack";
import { findRuleProvenance } from "@/lib/tax-pack/provenance";
import type { TaxPackRegistry } from "@/lib/tax-pack/registry";
import { createDefaultTaxPackRegistry } from "@/lib/tax-pack/registry-default";
import { taxPackKey } from "@/lib/tax-pack/identity";
import type { SourceType, ValidationFinding } from "@/lib/tax-engine/ay-2026-27/types";
import {
  declaredLedgerFacts,
  type SyntheticCaseFixture,
  type ExpectedUnsupportedFact,
} from "./fixture";
import {
  describeEvidence,
  evidenceDocument,
  evidenceSourceType,
  isAcceptedEvidence,
  type EvidenceAcceptanceState,
  type EvidenceKind,
  type LedgerFactEvidence,
  type LedgerFactKind,
} from "./evidence";
import {
  materialOutputKind,
  materialOutputSourceTags,
  readMaterialOutput,
  type ComputedCaseOutputs,
  type MaterialOutputId,
  type MaterialOutputValue,
} from "./material-outputs";

/** Why a fixture run did not hold. Every kind names the fixture and the pack. */
export type FixtureFailureKind =
  | "pack_refused"
  | "pack_bound_unexpectedly"
  | "pack_version_mismatch"
  | "unknown_rule"
  | "untraced_output"
  | "trace_understated"
  | "value_mismatch"
  | "unsupported_mismatch"
  // K3-21 — the evidence half of traceability.
  | "withheld_mismatch"
  | "untraced_evidence"
  | "unaccepted_evidence"
  | "validation_finding_missing"
  | "validation_finding_unexpected"
  | "validation_finding_mismatch";

export interface FixtureFailure {
  readonly kind: FixtureFailureKind;
  /** Human-readable, and deliberately specific: which rule, under which pack version. */
  readonly detail: string;
  readonly outputId?: MaterialOutputId;
  readonly expected?: MaterialOutputValue;
  readonly actual?: MaterialOutputValue;
  readonly ruleIds?: readonly string[];
  readonly packComputationRulesVersion?: string;
}

/**
 * One evidence-backed ledger fact that contributed to a material output, resolved
 * from the engine's own source tags (never re-derived).
 */
export interface ContributingFact {
  readonly ledgerId: string;
  readonly ledgerKind: LedgerFactKind;
  readonly evidenceKind: EvidenceKind;
  readonly sourceType: SourceType;
  /** The synthetic document behind the fact; absent when staff-attested. */
  readonly documentId?: string;
  readonly acceptance: EvidenceAcceptanceState;
  /**
   * The granularity at which the engine's source tag identified this fact.
   *
   * The engine tags a figure with its DOCUMENT when the row points at one, and
   * with the row id otherwise. So a tag can name evidence shared by several rows
   * (one Form 16 backing both salary and salary TDS), and every row sharing that
   * document is reported. `"document"` says so plainly rather than implying the
   * tag singled this row out — the concept being traced is the EVIDENCE, and
   * document granularity is the engine's own.
   */
  readonly resolvedBy: "document" | "ledger_row";
}

/** The per-expectation verdict. Never absent — an expectation is never skipped. */
export interface ExpectationCheck {
  readonly outputId: MaterialOutputId;
  readonly expected: MaterialOutputValue;
  readonly actual: MaterialOutputValue;
  readonly matched: boolean;
  readonly ruleIds: readonly string[];
  readonly packComputationRulesVersion: string;
  /** True when every cited rule is unverified (or the pack is not `ca_verified`). */
  readonly rulesUnverified: boolean;
  /**
   * False for a categorical decision (recommended regime / ITR form), which
   * carries no `ComputedValue` and therefore no source tags. Distinguishing this
   * from "tagged, but nothing contributed" keeps the report honest.
   */
  readonly evidenceTraceable: boolean;
  /** The accepted, evidence-backed facts behind the number. */
  readonly contributingFacts: readonly ContributingFact[];
}

/** One fact the engine cannot represent, as raised by the adapter. */
export interface BlockedFact {
  readonly code: MappingWarning["code"];
  readonly ledgerId: string;
  readonly entryType: string;
  readonly amount: number;
  readonly message: string;
}

/**
 * One declared fact WITHHELD from the computation because its evidence was not
 * accepted. Distinct from `BlockedFact`: a blocked fact is an engine gap
 * (engineering work), a withheld fact is an evidence gap (case work). Both mean
 * the same thing for the numbers — they exclude a declared fact — which is why
 * either one yields the `blocked` outcome (decision D21).
 */
export interface WithheldFact {
  readonly ledgerId: string;
  readonly ledgerKind: LedgerFactKind;
  readonly acceptance: Exclude<EvidenceAcceptanceState, "accepted">;
  readonly evidenceKind: EvidenceKind;
  readonly sourceType: SourceType;
  readonly documentId?: string;
  /** Why the evidence was not accepted. Always present — the constructor requires it. */
  readonly reason: string;
}

/** The per-finding verdict for a pinned validation finding. */
export interface ValidationFindingCheck {
  readonly code: string;
  readonly expectedSeverity: string;
  readonly actualSeverity: string;
  readonly expectedArea: string;
  readonly actualArea: string;
  readonly matched: boolean;
  readonly packValidationRulesVersion: string;
}

export type FixtureRunOutcome = "supported" | "blocked" | "refused";

export interface FixtureRunResult {
  readonly fixtureId: string;
  readonly outcome: FixtureRunOutcome;
  readonly passed: boolean;
  readonly failures: readonly FixtureFailure[];
  /** Empty when the pack refused (nothing was computed). */
  readonly checks: readonly ExpectationCheck[];
  /** Itemised unsupported facts (engine gaps). */
  readonly blocked: readonly BlockedFact[];
  /** Itemised facts withheld for want of accepted evidence (case work). */
  readonly withheld: readonly WithheldFact[];
  /** Per-finding verdicts for the pinned validation findings. */
  readonly findingChecks: readonly ValidationFindingCheck[];
  /** Every finding the governing pack's `validateCase` raised. Absent on refusal. */
  readonly findings?: readonly ValidationFinding[];
  /** The canonical pack key that governed the run; absent when the pack refused. */
  readonly packKey?: string;
  /** Versions the governing pack stamps. Absent when the pack refused. */
  readonly packVersions?: TaxCasePackVersions;
  /** The adapter result, for callers that want the mapping detail. Absent on refusal. */
  readonly adapter?: AdapterResult;
}

function unsupportedKey(fact: { code: string; ledgerId: string }): string {
  return `${fact.code}:${fact.ledgerId}`;
}

function describeExpectedUnsupported(fact: ExpectedUnsupportedFact): string {
  return `${fact.code} on ledger row ${fact.ledgerId} (${fact.entryType})`;
}

/**
 * The identifier the engine's source tags carry for a fact: the source document
 * when the row points at one, otherwise the ledger row id. That mapping belongs
 * to the engine's own `sourceTag` (and the adapter that feeds it) — we do not
 * re-derive it, we index BY it, and a tag that matches no index entry is a typed
 * failure rather than a silently-dropped trace.
 */
function tagIdentifier(fact: { ledgerId: string; sourceDocumentId: string | null }): string {
  return fact.sourceDocumentId ?? fact.ledgerId;
}

/** Keep only the rows whose evidence was accepted. Pure — the adapter is untouched. */
function acceptedLedgerRows(
  ledger: LedgerRows,
  withheldIds: ReadonlySet<string>,
): LedgerRows {
  return {
    income: ledger.income.filter((r) => !withheldIds.has(r.id)),
    taxPaid: ledger.taxPaid.filter((r) => !withheldIds.has(r.id)),
    deductions: ledger.deductions.filter((r) => !withheldIds.has(r.id)),
    capitalGains: ledger.capitalGains.filter((r) => !withheldIds.has(r.id)),
    // K4-06: optional on `LedgerRows` — filtered the same way when present.
    housePropertyEntries: ledger.housePropertyEntries?.filter((r) => !withheldIds.has(r.id)),
    // K4-14: optional on `LedgerRows` — withheld the same way, so an unaccepted
    // books record never reaches the adapter.
    businessBooksEntries: ledger.businessBooksEntries?.filter((r) => !withheldIds.has(r.id)),
    // K4-10: optional on `LedgerRows` — withheld the same way when present, so
    // an unaccepted carry-forward record never reaches the adapter.
    broughtForwardLosses: ledger.broughtForwardLosses?.filter((r) => !withheldIds.has(r.id)),
  };
}

function contributingFactOf(
  evidence: LedgerFactEvidence,
  ledgerId: string,
  resolvedBy: "document" | "ledger_row",
): ContributingFact {
  const doc = evidenceDocument(evidence);
  return Object.freeze({
    ledgerId,
    ledgerKind: evidence.ledgerKind,
    evidenceKind: evidence.kind,
    sourceType: evidenceSourceType(evidence),
    ...(doc !== undefined ? { documentId: doc.documentId } : {}),
    acceptance: evidence.acceptance,
    resolvedBy,
  });
}

/**
 * Run one fixture against an explicit registry. Pure and deterministic — the same
 * fixture and registry always yield the same result.
 */
export function runSyntheticCaseFixture(
  registry: TaxPackRegistry,
  fixture: SyntheticCaseFixture,
): FixtureRunResult {
  const failures: FixtureFailure[] = [];
  const binding = bindTaxPackToCase(registry, fixture.statutory);

  if (binding.outcome === "refused") {
    if (fixture.expectedBinding === "bound") {
      failures.push({
        kind: "pack_refused",
        detail: `Fixture ${fixture.id}: no governing pack bound (${binding.resolution}) — ${binding.reason}`,
      });
    }
    return Object.freeze({
      fixtureId: fixture.id,
      outcome: "refused" as const,
      passed: failures.length === 0,
      failures: Object.freeze(failures),
      checks: Object.freeze([]),
      blocked: Object.freeze([]),
      withheld: Object.freeze([]),
      findingChecks: Object.freeze([]),
    });
  }

  if (fixture.expectedBinding === "refused") {
    failures.push({
      kind: "pack_bound_unexpectedly",
      detail: `Fixture ${fixture.id} expected the statutory world to refuse, but pack ${taxPackKey(binding.identity)} bound a computation`,
    });
  }

  const packKey = taxPackKey(binding.identity);
  const packVersion = binding.versions.computationRulesVersion;
  const provenance = taxPackProvenance(binding.pack);
  const packIsCaVerified = binding.identity.status === "ca_verified";

  // --- 2. Evidence: an unaccepted fact never becomes preparation truth ------
  // Withholding happens BEFORE the adapter runs, so an unaccepted fact cannot
  // reach the engine input at all — it is not filtered out downstream, it is
  // never folded in. What it produces instead is itemised work.
  const facts = declaredLedgerFacts(fixture.ledger);
  const evidenceById = new Map<string, LedgerFactEvidence>(
    fixture.evidence.map((e) => [e.ledgerId, e]),
  );

  const withheld: WithheldFact[] = [];
  const withheldIds = new Set<string>();
  const acceptedFacts: { ledgerId: string; sourceDocumentId: string | null }[] = [];
  for (const fact of facts) {
    const evidence = evidenceById.get(fact.ledgerId);
    if (evidence === undefined) {
      // `makeSyntheticCaseFixture` refuses this; a hand-built literal could still
      // reach it, and an un-evidenced fact must never be computed silently.
      failures.push({
        kind: "untraced_evidence",
        detail: `Fixture ${fixture.id} declares ${fact.ledgerKind} row ${fact.ledgerId} with no evidence record; it cannot become preparation truth`,
      });
      withheldIds.add(fact.ledgerId);
      continue;
    }
    if (isAcceptedEvidence(evidence.acceptance)) {
      acceptedFacts.push({ ledgerId: fact.ledgerId, sourceDocumentId: fact.sourceDocumentId });
      continue;
    }
    const doc = evidenceDocument(evidence);
    withheldIds.add(fact.ledgerId);
    withheld.push(
      Object.freeze({
        ledgerId: fact.ledgerId,
        ledgerKind: fact.ledgerKind,
        acceptance: evidence.acceptance as Exclude<EvidenceAcceptanceState, "accepted">,
        evidenceKind: evidence.kind,
        sourceType: evidenceSourceType(evidence),
        ...(doc !== undefined ? { documentId: doc.documentId } : {}),
        // The constructor requires a reason for any unaccepted state, so this
        // fallback is only reachable for a hand-built fixture literal. It says
        // "nobody recorded one" rather than presenting an empty string as if a
        // reason had been given.
        reason: evidence.acceptanceReason ?? "no reason recorded",
      }),
    );
  }

  // Declared-vs-actual withheld facts must match exactly, both ways.
  const declaredWithheld = new Map(fixture.expectedWithheld.map((w) => [w.ledgerId, w]));
  for (const fact of withheld) {
    const declared = declaredWithheld.get(fact.ledgerId);
    if (declared === undefined) {
      failures.push({
        kind: "withheld_mismatch",
        detail: `Fixture ${fixture.id} did not declare ${fact.ledgerId} as withheld, but its evidence is ${fact.acceptance}: ${fact.reason}`,
      });
    } else if (declared.acceptance !== fact.acceptance) {
      failures.push({
        kind: "withheld_mismatch",
        detail: `Fixture ${fixture.id} declares ${fact.ledgerId} withheld as ${declared.acceptance}, but the run withheld it as ${fact.acceptance}`,
      });
    }
  }
  const withheldById = new Set(withheld.map((w) => w.ledgerId));
  for (const declared of fixture.expectedWithheld) {
    if (!withheldById.has(declared.ledgerId)) {
      failures.push({
        kind: "withheld_mismatch",
        detail: `Fixture ${fixture.id} declares ${declared.ledgerId} withheld (${declared.acceptance}), but the run accepted or never saw it`,
      });
    }
  }

  // Index the ACCEPTED facts by the identifier the engine's own source tags
  // carry, so an output can be resolved back to the evidence behind it.
  const acceptedByTagIdentifier = new Map<string, string[]>();
  for (const fact of acceptedFacts) {
    const key = tagIdentifier(fact);
    const bucket = acceptedByTagIdentifier.get(key);
    if (bucket) bucket.push(fact.ledgerId);
    else acceptedByTagIdentifier.set(key, [fact.ledgerId]);
  }

  // --- 3. Adapter: build the engine input and collect unsupported facts -----
  const adapter = buildEngineInput(acceptedLedgerRows(fixture.ledger, withheldIds), fixture.caseMeta);
  const blocked: BlockedFact[] = adapter.warnings.map((w) =>
    Object.freeze({
      code: w.code,
      ledgerId: w.ledgerId,
      entryType: w.entryType,
      amount: w.amount,
      message: w.message,
    }),
  );

  // Declared-vs-actual unsupported facts must match exactly, both ways: an
  // undeclared blocker is a surprise, and a declared-but-absent one means the
  // fixture no longer proves what it claims.
  const actualKeys = new Set(blocked.map(unsupportedKey));
  const declaredKeys = new Set(fixture.expectedUnsupported.map(unsupportedKey));
  for (const fact of fixture.expectedUnsupported) {
    if (!actualKeys.has(unsupportedKey(fact))) {
      failures.push({
        kind: "unsupported_mismatch",
        detail: `Fixture ${fixture.id} declares ${describeExpectedUnsupported(fact)} as unsupported, but pack ${packKey} raised no such blocker`,
      });
    }
  }
  for (const fact of blocked) {
    if (!declaredKeys.has(unsupportedKey(fact))) {
      failures.push({
        kind: "unsupported_mismatch",
        detail: `Fixture ${fixture.id} did not declare ${fact.code} on ledger row ${fact.ledgerId} (${fact.entryType}), but pack ${packKey} blocked it: ${fact.message}`,
      });
    }
  }

  // --- 4. Compute THROUGH the resolved pack's binding -----------------------
  const outputs: ComputedCaseOutputs = Object.freeze({
    computation: binding.computation.computeTax(adapter.input),
    itrForm: binding.computation.recommendItrForm(adapter.input),
  });
  const validation = binding.computation.validateCase(adapter.input);

  // --- 5. Check the pinned validation findings ------------------------------
  // Codes and severities only — never message text, which is prose and may be
  // reworded without any rule moving.
  const findingChecks: ValidationFindingCheck[] = [];
  const raisedByCode = new Map(validation.findings.map((f) => [f.code, f]));
  for (const expected of fixture.expectedFindings) {
    if (expected.packValidationRulesVersion !== binding.versions.validationRulesVersion) {
      failures.push({
        kind: "pack_version_mismatch",
        detail: `Fixture ${fixture.id} pinned validation finding ${expected.code} under version ${expected.packValidationRulesVersion}, but ${packKey} governs this case at ${binding.versions.validationRulesVersion}`,
        packComputationRulesVersion: expected.packValidationRulesVersion,
      });
    }
    const raised = raisedByCode.get(expected.code);
    if (raised === undefined) {
      failures.push({
        kind: "validation_finding_missing",
        detail: `Fixture ${fixture.id} requires validation finding ${expected.code} (${expected.severity}/${expected.area}), but pack ${packKey} raised none`,
      });
      continue;
    }
    const matched = raised.severity === expected.severity && raised.area === expected.area;
    if (!matched) {
      failures.push({
        kind: "validation_finding_mismatch",
        detail: `Fixture ${fixture.id} pins ${expected.code} as ${expected.severity}/${expected.area}, but pack ${packKey} raised it as ${raised.severity}/${raised.area}`,
      });
    }
    findingChecks.push(
      Object.freeze({
        code: expected.code,
        expectedSeverity: expected.severity,
        actualSeverity: raised.severity,
        expectedArea: expected.area,
        actualArea: raised.area,
        matched,
        packValidationRulesVersion: binding.versions.validationRulesVersion,
      }),
    );
  }
  const declaredFindingCodes = new Set(fixture.expectedFindings.map((f) => f.code));
  for (const raised of validation.findings) {
    if (!declaredFindingCodes.has(raised.code)) {
      failures.push({
        kind: "validation_finding_unexpected",
        detail: `Fixture ${fixture.id} did not pin validation finding ${raised.code} (${raised.severity}/${raised.area}), but pack ${packKey} raised it`,
      });
    }
  }

  // --- 6. Check every expectation ------------------------------------------
  const checks: ExpectationCheck[] = [];
  for (const expectation of fixture.expectations) {
    const { outputId, trace } = expectation;

    if (trace.packComputationRulesVersion !== packVersion) {
      failures.push({
        kind: "pack_version_mismatch",
        detail: `Fixture ${fixture.id} pinned ${outputId} under pack version ${trace.packComputationRulesVersion}, but ${packKey} governs this case at ${packVersion}`,
        outputId,
        packComputationRulesVersion: trace.packComputationRulesVersion,
      });
    }

    // A rule-derived output must name at least one rule. Without this, a fixture
    // could pin a tax figure to an empty `ruleIds` array and still pass — and the
    // laboratory's central claim (every material number names the versioned rule
    // behind it) would hold only by convention.
    if (materialOutputKind(outputId) === "rule_derived" && trace.ruleIds.length === 0) {
      failures.push({
        kind: "untraced_output",
        detail: `Fixture ${fixture.id} pins ${outputId} without citing any rule; ${outputId} is rule-derived under pack ${packKey} and must name the rule(s) it derives from`,
        outputId,
        ruleIds: trace.ruleIds,
        packComputationRulesVersion: packVersion,
      });
    }

    // Rule ids must exist in the governing pack's own provenance, otherwise the
    // "traceability" is a label nobody can follow.
    let anyCaveat = false;
    for (const ruleId of trace.ruleIds) {
      const rule = provenance ? findRuleProvenance(provenance, ruleId) : undefined;
      if (rule === undefined) {
        failures.push({
          kind: "unknown_rule",
          detail: `Fixture ${fixture.id} traces ${outputId} to rule ${JSON.stringify(ruleId)}, which pack ${packKey} does not declare`,
          outputId,
          ruleIds: trace.ruleIds,
          packComputationRulesVersion: packVersion,
        });
        continue;
      }
      if (rule.caveat !== null) anyCaveat = true;
    }

    // A value is unverified if any cited rule carries an unresolved caveat OR the
    // pack itself is not CA-verified. A fixture may not claim LESS than that.
    const mustBeUnverified = anyCaveat || !packIsCaVerified;
    if (mustBeUnverified && !trace.rulesUnverified) {
      failures.push({
        kind: "trace_understated",
        detail: `Fixture ${fixture.id} marks ${outputId} as verified, but pack ${packKey} is ${binding.identity.status}${anyCaveat ? " and the cited rules carry unresolved TODO(CA-verify) caveats" : ""}`,
        outputId,
        ruleIds: trace.ruleIds,
        packComputationRulesVersion: packVersion,
      });
    }

    const actual = readMaterialOutput(outputs, outputId);
    const matched = actual === expectation.expected;
    if (!matched) {
      const ruleText = trace.ruleIds.length > 0 ? trace.ruleIds.join(", ") : "no rule cited";
      failures.push({
        kind: "value_mismatch",
        detail: `Fixture ${fixture.id}: ${outputId} expected ${JSON.stringify(expectation.expected)}, got ${JSON.stringify(actual)} — traced to rule(s) [${ruleText}] under pack ${packKey}`,
        outputId,
        expected: expectation.expected,
        actual,
        ruleIds: trace.ruleIds,
        packComputationRulesVersion: packVersion,
      });
    }

    // --- Evidence: which accepted facts contributed to THIS number? ---------
    // Resolved from the engine's own source tags. A tag that resolves to nothing
    // means a number is standing on evidence the laboratory cannot name, which is
    // exactly the situation the Wave-2 gate exists to forbid.
    const tags = materialOutputSourceTags(outputs, outputId);
    const contributingFacts: ContributingFact[] = [];
    const seenFactIds = new Set<string>();
    if (tags !== null) {
      for (const tag of tags) {
        let resolved = false;
        for (const [identifier, ledgerIds] of acceptedByTagIdentifier) {
          if (!tag.endsWith(`:${identifier}`)) continue;
          resolved = true;
          for (const ledgerId of ledgerIds) {
            if (seenFactIds.has(ledgerId)) continue;
            const evidence = evidenceById.get(ledgerId);
            if (evidence === undefined) continue;
            seenFactIds.add(ledgerId);
            contributingFacts.push(
              contributingFactOf(evidence, ledgerId, identifier === ledgerId ? "ledger_row" : "document"),
            );
          }
        }
        if (!resolved) {
          const withheldHit = withheld.find((w) => tag.endsWith(`:${w.ledgerId}`) || (w.documentId !== undefined && tag.endsWith(`:${w.documentId}`)));
          failures.push(
            withheldHit
              ? {
                  kind: "unaccepted_evidence",
                  detail: `Fixture ${fixture.id}: ${outputId} was computed from source tag ${JSON.stringify(tag)}, which belongs to ${describeEvidence(evidenceById.get(withheldHit.ledgerId) as LedgerFactEvidence)} — an unaccepted fact must never reach a computed number`,
                  outputId,
                }
              : {
                  kind: "untraced_evidence",
                  detail: `Fixture ${fixture.id}: ${outputId} was computed from source tag ${JSON.stringify(tag)}, which resolves to no accepted evidence-backed fact declared by the fixture`,
                  outputId,
                },
          );
        }
      }
    }

    checks.push(
      Object.freeze({
        outputId,
        expected: expectation.expected,
        actual,
        matched,
        ruleIds: trace.ruleIds,
        packComputationRulesVersion: packVersion,
        rulesUnverified: mustBeUnverified,
        evidenceTraceable: tags !== null,
        contributingFacts: Object.freeze(contributingFacts),
      }),
    );
  }

  return Object.freeze({
    fixtureId: fixture.id,
    // Either kind of exclusion blocks: the numbers exclude a declared fact, and
    // the reader must be told so whether the gap is the engine's or the file's.
    outcome: (blocked.length > 0 || withheld.length > 0 ? "blocked" : "supported") as FixtureRunOutcome,
    passed: failures.length === 0,
    failures: Object.freeze(failures),
    checks: Object.freeze(checks),
    blocked: Object.freeze(blocked),
    withheld: Object.freeze(withheld),
    findingChecks: Object.freeze(findingChecks),
    findings: Object.freeze([...validation.findings]),
    packKey,
    packVersions: binding.versions,
    adapter,
  });
}

/** Run a fixture against the registry TaxDesk OS ships. */
export function runSyntheticCaseFixtureWithDefaultRegistry(
  fixture: SyntheticCaseFixture,
): FixtureRunResult {
  return runSyntheticCaseFixture(createDefaultTaxPackRegistry(), fixture);
}

/** A one-line summary of a run, suitable for a test failure message. */
export function describeFixtureRun(result: FixtureRunResult): string {
  const head = `${result.fixtureId}: ${result.outcome}${result.passed ? " (passed)" : " (FAILED)"}`;
  if (result.passed) return head;
  return [head, ...result.failures.map((f) => `  - [${f.kind}] ${f.detail}`)].join("\n");
}
