# K.3 — Wave-3 coverage and limitations

**Milestone:** `K3-33` (Wave-3 gate closeout)

**Statutory path assessed:** AY 2026-27 / FY 2025-26 / Income-tax Act 1961

**Status:** preparation-only, synthetic-only, every shipped tax pack `draft`

This report answers a narrow question: exactly what the evidence-ingestion
vertical slice (`K3-30`→`K3-32B`) covers today. It is not a tax-law
correctness opinion, a CA verification record, a filing-readiness statement,
or evidence of tax-authority acceptance. See
`docs/coverage/k3-wave-2-coverage-and-limitations.md` for the (separate,
still partly-closed) tax-computation coverage question this report does not
re-litigate.

The machine-readable inventory is `buildWave3CoverageReport()` in
`src/lib/tax-desk/wave-3-coverage-report.ts`. It derives every claim below
from the SAME closed vocabularies the propose→review→promote workflow
(`source-proposals.ts`), the accepted-evidence manifest
(`evidence-manifest.ts`), the persisted draft-output artifact
(`draft-output-artifact.ts`), and the live traceability read model
(`case-traceability.ts`) already enforce by their own unit tests — it
introduces no second vocabulary of its own. Its guard,
`src/lib/tax-desk/__tests__/wave-3-coverage-report.test.ts`, pins every
number in this report; a future change that changes the supported scope
fails that test until this report is consciously reassessed.

**`MAINT-03` (2026-07-27) correction.** That claim was not true of the PROSE.
While remediating `AUDIT-03-F3` for the Wave-4 report, this document was
checked for the same defect and found to have it: §1's figure-inventory row
still read `34 = 28 traced + 2 categorical + 4 untraced limitations`, the
pre-`K4-06` partition, while the live inventory had moved to `38 = 32 + 2 + 4`
(`K4-06` +2 traced, `K4-07` +2 traced). The guard passed throughout, because
it asserted the live report against literals in the TEST file that each
milestone dutifully updated — this document was never read back. That drift is
corrected above, and the marker below now closes the structural gap the same
way `MAINT-02` did for Wave 2 and this milestone did for Wave 4: the guard reads
these values out of this file and compares them against
`buildWave3CoverageReport()`.

<!-- WAVE3_COVERAGE_COUNTS
figureInventoryTotal=48
figureInventoryTraced=44
figureInventoryCategorical=2
figureInventoryUntracedLimitations=2
supportedProposalFacts=2
supportedRegimes=2
-->

## 1. Supported scope (exact, closed)

| Dimension | Value | Source of truth |
| --- | --- | --- |
| Source kind | `Form16` | `source-proposals.ts` `PROPOSAL_SOURCE_SCHEMA_KIND` |
| Source schema version | `FORM16_V0_PLANNED` | `source-proposals.ts` `PROPOSAL_SOURCE_SCHEMA_VERSION` (still `planned` — D17 stands; no field layout is claimed) |
| Proposal facts | `income.salary`, `tax_paid.salary_tds` | `source-proposals.ts` `PROPOSAL_FACT_KINDS` (cross-checked by test against `packs/ay-2026-27-schemas.ts`'s Form16 package) |
| Manifest-eligible regimes | `old`, `new` | `evidence-manifest.ts` `REGIME_VALUES` |
| Manifest schema | `TAX_EVIDENCE_MANIFEST_V1` | `evidence-manifest.ts` `MANIFEST_SCHEMA_VERSION` |
| Draft-output package schema | `TAX_DRAFT_OUTPUT_PACKAGE_V1`, status `internal_draft` | `draft-output-artifact.ts` |
| Live traceable material figures | 48 = 44 traced + 2 categorical + 2 untraced limitations | `case-traceability.ts` `COMPUTATION_FIGURE_INVENTORY` (K3-24..26; reused verbatim, never re-derived) |

No other source kind, proposal fact, or regime is supported. Adding one
requires extending the closed vocabularies in `source-proposals.ts` **and**
the migration's `check` constraints **and** the cross-check test against
`source-schema.ts` (see `k3-source-proposal-workflow.md` §9) — never a
silent addition.

## 2. Full chain — what each stage actually proves, and what it does not

The Wave-3 exit gate names seven handoffs. This table states, for the
narrow Form16 salary + salary-TDS slice, what is proved at each handoff and
by which authority — distinguishing **source association** (a row merely
tagged with a source type/document) from **human acceptance** (an explicit
accept/reject decision), which is exactly the distinction `D24` named as
Wave 2's open gap.

| Handoff | What is proved | Authority | Test evidence |
| --- | --- | --- | --- |
| Source association | A ledger row may carry `source_type` / `source_document_id` for ANY ledger category (salary, interest, deductions, capital gains, …) | Existing ledger schema (pre-`K3-30`) | `tax-desk.ts` read models, `12-tax-desk-ledgers.spec.ts` |
| Proposal creation | A staff member can record a candidate salary/salary-TDS value against an uploaded Form 16, explicitly labelled "proposal — not authoritative" | `propose_source_fact` RPC | `source-proposal-workflow.mjs`, `e2e/28-source-proposals.spec.ts`, `e2e/31-wave-3-full-chain.spec.ts` |
| Human acceptance | An explicit accept/reject decision is recorded per fact, with a reason required on rejection; a rejected fact may be corrected and re-proposed | `decide_source_proposal` RPC + `canTransitionProposalStatus` | `source-proposals.test.ts` (exhaustive 16-pair transition table), `[P6][P8][P9][P10]` in `source-proposal-workflow.mjs`, `e2e/28`, `e2e/31` |
| Promotion | Only an accepted PAIR (both facts) promotes atomically/idempotently into the canonical `tax_income_entries` / `tax_tax_paid_entries` ledgers, with immutable lineage | `promote_source_proposal_pair` RPC | `[P11][P12]` in `source-proposal-workflow.mjs`, `e2e/28`, `e2e/31` |
| Computation contribution | A promoted row contributes through the SAME canonical adapter/engine as a manually entered row — no proposal-specific computation path exists | `computation-adapter.ts` (unmodified) | `source-proposal-reconciliation.test.ts` (equivalence proof), `[P14]` (inertness-before-promotion proof), `e2e/31` (real "Save snapshot" from live promoted data) |
| Traceability | A contributing figure names, per fact, whether it was `promoted` and by whom/when, resolved through the promotion RPC's own immutable link — never `source_type` alone | `case-traceability.ts` `resolvePromotedProposalLineage` (D35) | `case-traceability.test.ts` (K3-31 suite), `e2e/26`, `e2e/31` |
| Immutable evidence manifest | The exact figures + evidence facts behind ONE snapshot, under ONE explicitly selected regime, are frozen into a hash-identified, append-only row | `create_evidence_manifest` RPC + `evidence-manifest.ts` | `evidence-manifest.test.ts`, `evidence-manifest-workflow.mjs` (M1-M20), `e2e/30`, `e2e/31` |
| Approval binding | Client approval binds to the exact snapshot id, manifest id, and manifest hash together | `capture_client_approval` RPC (6-arg) | `evidence-manifest-workflow.mjs` M15, `e2e/30`, `e2e/31` |
| Draft-output inclusion | A persisted, immutable, idempotently-generated internal draft-output artifact is derivable ONLY from a manifest with current approval, no active blocker, and no open validation error | `generate_internal_draft_output` RPC + `draft-output-artifact.ts` | `draft-output-artifact.test.ts`, `evidence-manifest-workflow.mjs` M16-M19, `e2e/30`, `e2e/31` |

## 3. What Wave 3 does **not** claim

1. **Other ledger categories have source association but no proposal-based
   human-acceptance lineage.** Interest, deductions, capital gains, and every
   income/tax-paid category outside the two Form16 facts above can carry a
   `source_type`/`source_document_id` today, but there is no propose/accept
   workflow for them — a preparer entering (or an existing document tagging)
   those values directly is not, and cannot be described as, an "accepted
   evidence" decision in the D24 sense. `D24` remains valid: Wave 2 is still
   only partly closed for this reason, and Wave 3 does not silently widen
   that claim.
2. **No OCR, parser, or AI extraction.** Every proposed value in this slice
   is synthetic and hand-entered by a human looking at a synthetic test
   document — `source-schema.ts`'s Form16 package remains `planned` (D17);
   no real specimen has been inspected.
3. **No new tax rule, rate, slab, deduction, surcharge, or marginal-relief
   calculation.** The reliance blocker at the manifest layer
   (`SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED`) reuses the existing canonical
   evaluator (`tax-capability.ts`) — see `D47`.
4. **Draft output is not filing.** The persisted artifact is explicitly
   `internal_draft`, carries the `EVIDENCE_MANIFEST_DISCLAIMER` /
   `DRAFT_OUTPUT_ARTIFACT_DISCLAIMER` text, and is not an ITD JSON payload,
   e-filing upload package, or filing action.
5. **No pack is CA-verified.** Every manifest discloses (never hides) the
   governing tax pack's truthful `draft` lifecycle status (D45).
6. **Rule/figure attribution stays pack-rule-group coarse** (inherited from
   Wave 2, D22/D26) — this milestone does not sharpen that granularity.
7. **The evidence-manifest security suite could not be re-run against the
   isolated fresh-migration-replay environment** (§4 of the Wave-3 verdict
   in the change log `K3-33` entry) — it hardcodes a `:55321`-only
   local-target safety guard, deliberately not weakened by this milestone. Its
   passing evidence against the PRIMARY local instance (this milestone's own
   full-gate rerun, §Verification) stands as the functional proof instead.
8. **Two E2E-fixture-only defects (never product/tax-value code) had to be
   fixed before the connected proof in §2 could pass reliably** — see D52/D53
   in the change log `K3-33` entry. Both were discovered BECAUSE this
   milestone was the first to combine a fixture-seeded case with the real
   upload/propose/promote path in one connected E2E test; neither reflects a
   gap in the supported chain itself.

## 4. Wave-3 gate consequence

Every handoff in §2 has both a component-level test (unit, security-suite,
or isolated E2E spec) and, for the first time this milestone, one CONNECTED
serial E2E proof (`e2e/31-wave-3-full-chain.spec.ts`) that walks a single
synthetic case through all nine rows of that table without a database
shortcut for any product-visible step. Combined with the clean-database
migration replay (§Wave-3 verdict), the narrow Form16 salary + salary-TDS
slice satisfies the Wave-3 exit gate's letter: *no imported value silently
becomes tax truth; the supported case moves upload → reviewed facts →
reconciliation → computation → validation → approval → draft output with
full lineage.* This is a narrow-slice closure, not a breadth claim — see
the k3-tax-intelligence-program design notes §6b's decision log for the
exact verdict and rationale, and §3 above for what remains explicitly
unsupported.
