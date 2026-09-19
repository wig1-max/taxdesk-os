# K.4 — Common-case coverage audit and Wave-4 priority

**Milestone:** `K4-00` (Wave 4 opening audit: coverage, prioritisation and adaptive-graph
design only; no tax-rule, computation or production-behaviour change)

**Status:** preparation-only, synthetic-only, every shipped tax pack `draft`

This report answers two narrow questions: (1) what does TaxDesk OS actually
support today, across six distinct dimensions, for every closed ledger category
and every capability-matrix area; and (2) in what order should Wave 4 close the
unsupported areas. It is not a tax-law correctness opinion, a CA-verification
record or a filing-readiness statement.

The machine-readable inventory backing §1 is `buildWave4LedgerCoverage()` /
`buildCapabilityStateSummary()` / `SILENT_EXCLUSION_FINDINGS` in
`src/lib/tax-desk/wave-4-coverage-audit.ts`. Its guard,
`src/lib/tax-desk/__tests__/wave-4-coverage-audit.test.ts`, pins every claim
below against the SAME closed vocabularies `ledger.ts`, `tax-capability.ts`,
`source-proposals.ts` and `computation-adapter.ts` already enforce — it
introduces no second, independently-maintained vocabulary. Any change to those
vocabularies fails the guard until the audit is consciously reassessed.

The prose is guarded too: the marker below is read back by
`src/lib/tax-lab/__tests__/coverage-report.test.ts` and every value is compared
against the **live vocabularies**, so a stale count fails CI.

<!-- WAVE4_COVERAGE_COUNTS
incomeHeads=11
taxPaidTypes=5
deductionTypes=8
gainTypes=5
engineValidationCodes=35
runnerValidationCodes=18
housePropertyValidationCodes=3
presumptive44adaValidationCodes=2
presumptive44adValidationCodes=3
-->

---

## 1. Executable current-coverage inventory

### 1.1 Ledger-category coverage (six dimensions, never collapsed to one label)

For every value in the four closed ledger vocabularies (`INCOME_HEADS`,
`TAX_PAID_TYPES`, `DEDUCTION_TYPES`, `GAIN_TYPES`), the audit module probes
the REAL adapter (`buildEngineInput`) and derives:

| Dimension | What it answers |
| --- | --- |
| Computation support | Does the adapter map this value into the engine input, or exclude it with an explicit warning? |
| Validation support | (See §1.3 — kept at the coarse, name-based level the codebase already established; not a new per-category vocabulary.) |
| Evidence-association support | Can a row of this category carry `source_type` / `source_document_id`? (True for every category the adapter actually maps — a structural DB property, not category-specific.) |
| Proposal-review support | Does a human accept/reject decision exist for this exact fact via the K3-30 propose→review→promote workflow? |
| Manifest / output-lineage support | Is this category's contributing fact reachable inside an accepted-evidence manifest's `evidenceFacts` (K3-32B)? |
| Filing-readiness / capability state | Which `TAX_CAPABILITY_MATRIX` area (if any) does this category roll up to, and what is that area's current state? |

**Income heads** (`INCOME_HEADS`, 11 values — the table below is the K4-00-era
8; `presumptive_professional_44ada` is the 9th, added by `K4-07`, and
`presumptive_business_44ad_digital` / `presumptive_business_44ad_cash` are the
10th and 11th, added by `K4-08` — each described in its own update note after
this table):

| Head | Computation | Evidence-association | Proposal-review | Manifest lineage | Capability area | State |
| --- | --- | --- | --- | --- | --- | --- |
| `salary` | computed | yes | **yes** (`income.salary`) | yes | `income_salary_pension` | supported |
| `savings_interest` | computed | yes | no | yes | `income_other_sources` | supported |
| `fd_interest` | computed | yes | no | yes | `income_other_sources` | supported |
| `dividend` | computed | yes | no | yes | `income_other_sources` | supported |
| `other_sources` | computed | yes | no | yes | `income_other_sources` | supported |
| `exempt_income` | computed (tracked, excluded from taxable GTI by design) | yes | no | yes | `income_other_sources` | supported |
| `house_property` | **excluded** (`UNSUPPORTED_INCOME_HEAD`, non-zero rows blocked) | no | no | no | `house_property` | unsupported |
| `business_income` | **excluded** (`UNSUPPORTED_INCOME_HEAD`, non-zero rows blocked) | no | no | no | `business_professional_income` | unsupported |

**Update (`K4-06`, 2026-07-26): `house_property` (this table row) is historical.**
This `INCOME_HEADS` placeholder value stays exactly as described above
(still excluded, untouched), but is now SUPERSEDED for computation by a new,
dedicated `tax_house_property_entries` ledger — a single property per case
(self-occupied or let-out) is now computed (`house_property_computation`;
`house_property` capability area moved `unsupported` → `partially_supported`).
See the tax-capability-matrix design notes's "House property (K4-06)"
section for the full detail and decision D80.

**Update (`K4-07`, 2026-07-26): `presumptive_professional_44ada` is a NEW
`INCOME_HEADS` value (row #3's item, not `business_income` above).** A
gross-receipts row of this head is **computed** as a 50% deemed-profit
figure (`presumptive_44ada_computation`) once the AGGREGATE across every
live row for the case stays within the applicable ₹50L/₹75L eligibility
ceiling; above the ceiling ALL such rows are excluded
(`PRESUMPTIVE_44ADA_CEILING_EXCEEDED`), never partially computed.
`presumptive_44ada` capability area moved `unsupported` →
`partially_supported`. See the tax-capability-matrix design notes's
"Presumptive professional income (K4-07)" section and decision D81.

**Update (`K4-08`, 2026-07-31): `presumptive_business_44ad_digital` and
`presumptive_business_44ad_cash` are TWO new `INCOME_HEADS` values** (again
not the `business_income` placeholder above, which stays untouched and
excluded). A turnover row of either head is **computed**
(`presumptive_44ad_computation`): 6% deemed profit on the digital head, 8% on
the cash head. They are two heads rather than one because Section 44AD
applies two rates to two PORTIONS of turnover, unlike Section 44ADA's single
rate on the whole — which additionally makes the 5%-cash eligibility test
**derived** from the declared amounts rather than staff-asserted. Once the
AGGREGATE across both heads exceeds the applicable ₹2cr/₹3cr ceiling ALL such
rows are excluded (`PRESUMPTIVE_44AD_CEILING_EXCEEDED`), never partially
computed. `presumptive_44ad` capability area moved `unsupported` →
`partially_supported`. See the tax-capability-matrix design notes's
"Presumptive business income (K4-08)" section and decisions D90/D91.

**Tax-paid types** (`TAX_PAID_TYPES`, 5 values) — all 5 (`salary_tds`,
`non_salary_tds`, `tcs`, `advance_tax`, `self_assessment_tax`) are **computed**;
only `salary_tds` has proposal-review support (`tax_paid.salary_tds`).

**Deduction sections** (`DEDUCTION_TYPES`, 8 values) — all 8 (`80C`, `80D`,
`80D_PARENTS`, `80TTA`, `80TTB`, `80CCD`, `80G`, `other_deductions` → engine
`other`) are **computed** (basic caps only — see `rules.ts` `DEDUCTION_CAPS`
caveats). None has proposal-review support. `80D_PARENTS` was added by `K4-05`
as a separately-capped parents bucket (decision D78's spousal-senior widening
of the self/family bucket remains open).

**Capital gains** (`GAIN_TYPES`, 4 values): `stcg_111a` / `ltcg_112a` are
**computed** (special-rate branches); `other_stcg` / `other_ltcg` are
**excluded** (`UNSUPPORTED_GAIN_TYPE`). A **negative** `stcg_111a` / `ltcg_112a`
(a loss) is separately excluded (`CAPITAL_LOSS_NOT_MODELLED`) even though the
positive case is supported — losses are checked as their own row in the audit
module (`capitalGainLosses`), not conflated with the positive-gain check.

### 1.2 Capability-matrix summary (case-level areas)

`TAX_CAPABILITY_MATRIX` (`tax-capability.ts`) has **15** areas at rest:

| State | Count | Areas |
| --- | --- | --- |
| `supported` | 3 | income_salary_pension, income_other_sources, capital_gains_111a_112a |
| `partially_supported` | 5 | senior_citizen_treatment, house_property (`K4-06`), presumptive_44ada (`K4-07`), presumptive_44ad (`K4-08`), loss_set_off_carry_forward (`K4-09`) |
| `unsupported` | 7 | business_professional_income, fno, vda, surcharge, marginal_relief, foreign_assets, tax_audit |
| `reliance_blocked` (at rest) | 0 | — (surcharge/marginal_relief become `reliance_blocked` dynamically, per-case, once computed total income exceeds ₹50,00,000 — TAX-SAFE-01/01A) |

Corrected `K4-07` — this table went stale after `K4-06` moved `house_property`
to `partially_supported` without this snapshot being updated (the same
`AUDIT-02-F2` drift class the wave-2 coverage doc's own marker exists to
catch); fixed in the same change that adds `presumptive_44ada`'s own move.

12 areas (7 unsupported + 5 partial) are Wave-4 candidates. §3 ranks them.
`loss_set_off_carry_forward` remains a candidate despite moving to
`partially_supported` in `K4-09`: only the WITHIN-YEAR half shipped, and the
carry-forward half (which is what the `brought_forward_losses` eligibility
declaration actually gates on) is untouched.

> **`TAX-SAFE-02` update (2026-08-01, D112).** The carry-forward half (`K4-10`)
> was blocked on **D93**'s two ordering questions. It is now **unblocked within a
> bounded release scope** — see the tax-capability-matrix design notes's
> "`K4-10` release boundary" section for the exact scope and the release gate,
> and `docs/evidence/d93-ay-2026-27/` for the evidence and its limits. Two
> constraints travel with it: the Section 112A threshold applies **after** loss
> set-off (external portal-conformance evidence, **not** independently reproduced
> and **not** CA-verified), and **no single allocation order may be hard-coded as
> the statutory result** — an explicit versioned policy plus a taxpayer-election
> path is required.

> **`TAX-SAFE-02A` correction to the note above (2026-08-01, D114).** The note is
> left as written (`PROJECT_CONSTITUTION.md` §4), but one clause in it is now
> superseded: the Section 112A threshold-after-set-off conclusion **was**
> subsequently reproduced independently. The maintainer supplied the official
> artifacts, all five hash-verified exactly, and the mechanics were re-derived
> from the workbook itself by read-only static inspection — worksheet `SPI - SI`,
> `P3 = MIN(125000,H28)` and `P5 = MIN(125000-P3,H79)`. What remains
> **unreproduced** is narrower than the note implies: the `G28`→`H28` step is
> **inferred**, and the resident basic-exemption step is **externally sourced but
> not reproduced**. The rest of the note stands unchanged — it is still
> portal-conformance evidence rather than statute, **no pack is `ca_verified`**,
> and the no-hard-coded-order requirement is untouched.

> **`OPS-04` sequencing note (2026-08-01, D116).** `K4-10` is the **next**
> implementation milestone, ahead of `K4-11` (surcharge and marginal relief).
> `K4-11` is deferred to the milestone after it, not cancelled; its scope is
> preserved in full in the change log `OPS-04` entry. The
> `D112` release boundary referenced above is unchanged by that re-ordering.

### 1.3 Validation coverage (kept coarse, per existing convention)

The AY engine's **19** finding codes are already inventoried by name in
`docs/coverage/k3-wave-2-coverage-and-limitations.md` §4 — this milestone does
not re-derive a new per-ledger-category validation vocabulary (doing so would
create a SECOND, competing validation-coverage authority; Wave 2's report is
the one that already cross-checks these codes against `validate-case.ts`'s
literals).

**As originally written (`K4-00`, historical):** none of the then-12 engine
codes, and none of the 18 coordinator-owned codes, referenced any of the 12
Wave-4 candidate areas — house property, business/professional income,
44AD/44ADA, loss set-off, F&O, VDA, senior treatment, surcharge/marginal
relief, foreign assets, and tax audit all had zero validation coverage, for
the same reason they had zero computation coverage: there was nothing to
validate yet.

**Status as of `K4-08` (2026-07-31) — that is no longer true, and a
Wave-4 milestone reading this section to decide whether it must define its own
findings must read THIS paragraph, not the one above.** The engine vocabulary
has grown 12 → **22**, and **three** of the Wave-4 candidate areas now carry
real validation coverage, added by the milestones that implemented them:

| Area | Findings | Added by |
| --- | --- | --- |
| House property | `HOUSE_PROPERTY_LOSS_REQUIRES_ITR2`, `HOUSE_PROPERTY_INTEREST_PROOF_MISSING`, `HOUSE_PROPERTY_LOSS_SETOFF_CAPPED` | `K4-06` |
| Presumptive professional (44ADA) | `PRESUMPTIVE_44ADA_REQUIRES_ITR4`, `PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED` | `K4-07` |
| Presumptive business (44AD) | `PRESUMPTIVE_44AD_REQUIRES_ITR4`, `PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED`, `PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED` | `K4-08` |

Senior treatment also gained `DEDUCTION_SECTION_AGE_MISMATCH` (`K4-03`) and
`ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2` (`K4-04`). The remaining candidate
areas — business/professional income (books-based, non-presumptive), loss
set-off, F&O, VDA, surcharge/marginal relief, foreign assets, tax audit —
still have zero validation coverage.

The original expectation still holds and is confirmed by how these five
arrived: **each Wave-4 category milestone defines its own validation findings as
part of its computation contract.** This is not a gap to close separately.
The counts above are machine-checked — see the `WAVE4_COVERAGE_COUNTS` marker
at the top of this document.

### 1.4 Evidence / proposal / manifest coverage

Only **two** facts, in the entire product, have human accept/reject lineage
via the K3-30 workflow: `income.salary` and `tax_paid.salary_tds`
(`PROPOSAL_FACT_KINDS`). Every other computed category — all of interest,
dividend, exempt income, deductions, capital gains, and the other four
tax-paid types — has, at most, **source association** (a `source_type` /
`source_document_id` tag), never a recorded human acceptance decision. This is
exactly Wave 2's D24 gap, and Wave 3 did not widen it (see
`k3-wave-3-coverage-and-limitations.md` §3.1). K4-00 does not reopen or
reassess D24 — it is restated here only so a Wave-4 category's "evidence
requirements" section can honestly state whether it inherits this gap (it
does, for every category except the two already closed).

### 1.5 Silent-exclusion audit — one active finding

The milestone plan required a specific search: a case where a user-entered or
imported fact is silently dropped from computation with no blocker or warning
explaining the omission. Three CANDIDATE gaps were checked and confirmed
**NOT** silent (`CONFIRMED_NON_SILENT_UNSUPPORTED_AREAS`) — house property,
business/professional income, and capital losses all raise an explicit
`MappingWarning` the instant a non-zero row exists, which blocks snapshot
creation (`adapter.complete === false`). These are honestly-documented,
safely-blocked gaps, not silent ones.

**Update (`K4-01`, 2026-07-25): this finding is RESOLVED.** The historical
record below is kept (not deleted or rewritten) per
`PROJECT_CONSTITUTION.md` §4 — `src/lib/tax-desk/wave-4-coverage-audit.ts`'s
`SILENT_EXCLUSION_FINDINGS` entry now carries `resolvedInSession: "K4-01"`.
`buildEngineInput()` now derives the real age band from the taxpayer's date
of birth and a real, sourced, automatic reliance blocker
(`evaluateSeniorTreatmentRisk`, `src/lib/tax-desk/senior-treatment.ts`) is
wired into filing readiness, the evidence-manifest creation gate, and the
three guarded RPCs. See
the k4-senior-treatment-specification design notes for the full detail.
The underlying senior/super-senior slab/deduction COMPUTATION remains
unimplemented (`rules.ts NOT_IMPLEMENTED.seniorSlabs`, unchanged) — only the
silent-reliance-on-a-wrong-answer risk is closed, not the capability gap
itself. The finding as originally recorded, for historical reference:

One finding IS silent (`SILENT_EXCLUSION_FINDINGS`, `AGE_CATEGORY_HARDCODED_BELOW_60`):

> **The taxpayer's date of birth is collected and required (`eligibility.ts`
> blocks a case on `PROFILE_DOB_MISSING`), but it never reaches the tax
> engine.** `computation-adapter.ts`'s `buildEngineInput()` hardcodes
> `taxpayer: { residentStatus: "resident", ageCategory: "below_60" }` for
> **every** case, unconditionally. `CaseMeta` — the function's only other
> argument — carries no age or date-of-birth field at all. There is no
> automatic reliance blocker analogous to `detectSurchargeMarginalReliefRisk`
> (TAX-SAFE-01) that fires when a case's taxpayer is actually a senior or
> super-senior citizen. `TAX_CAPABILITY_MATRIX`'s `senior_citizen_treatment`
> row (`partially_supported`, `clientApprovalAllowed: false`,
> `finalizationAllowed: false`) is **descriptive only** — `findTaxCapability`
> is called nowhere in production code, only in that module's own unit test
> (confirmed by a repository-wide grep). Nothing today would stop a senior
> citizen's case from being computed, snapshotted, approved, and internally
> finalized while silently applying below-60 slab and deduction treatment
> (missing senior slab widening, the senior 80D cap, and 80TTB) — with
> nothing in the UI stating that age was ignored.

**This is classified as a defect / active reliance-safety gap, not ordinary
future breadth.** Per the milestone plan's explicit instruction, K4-00 does
**not** fix it (no engine/adapter/blocker change is in scope for this
milestone) — but because it creates immediate reliance risk (unlike the safely-
blocked areas above), it is recorded here and a separate, narrowly-bounded
correction milestone is recommended as a matter of urgency: a **`TAX-SAFE-02`**
bridge milestone, structurally identical in shape to `TAX-SAFE-01` (a sourced,
automatic, income/age-derived reliance blocker — no slab computation, no tax
value change), inserted before or alongside `K4-01`. This recommendation is
advisory; the programme plan
remains `K4-01` per the milestone plan's explicit requirement — see §5.

**Update (`K4-01`, 2026-07-25):** the recommended blocker was delivered as
`K4-01`'s own Objective D/F (never a separate `TAX-SAFE-02` milestone — it
was folded into `K4-01`'s scope exactly as this section anticipated was
optional). See the k4-senior-treatment-specification design notes.

---


## 3. Prioritised Wave-4 roadmap

Ranked using: (1) the one confirmed ACTIVE safety finding (§1.5) outweighs
frequency-only reasoning; (2) Level 3 assumptions A.1-A.6 above; (3)
complexity (lower complexity + higher assumed frequency ranks earlier, all
else equal); (4) natural dependency ordering (e.g. loss set-off depends on
capital gains already being supported).

| # | Slice | Business rationale | Current support | Safety blocker today | Engine work (conceptual) | Evidence/source work | Validation work | Approval/output work | Adaptive-question work | New ledger/fact vocabulary | Dependencies | Complexity | Release boundary | Non-goals |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Senior/super-senior citizen age-based treatment** | §1.5's ACTIVE silent-exclusion finding; A.2 | `partially_supported`, computation runs but ignores age | **None today** — this is the gap | Age-category derivation from DOB "as on" the AY; senior/super-senior basic-exemption slab variants (old regime); senior 80D cap; 80TTB vs 80TTA selection | None new — DOB is already an existing profile field | New validation for age-category mismatch/edge cases (birthday during the FY) | Draft-output/manifest already project whatever the engine computes — needs the new figures added to `COMPUTATION_FIGURE_INVENTORY` | "Confirm taxpayer's age category for this AY" decision node | None (age category is derived, not entered) | None (uses existing profile DOB) | **Low-medium** | Compute-first; approval/output only once traced | No super-senior-specific ITR-form change; no NRI age nuance |
| 2 | **House property** | A.1, A.3 | `unsupported`, safely blocked | Adapter blocks non-zero rows (safe) | Annual value, municipal taxes, standard 30% deduction, home-loan interest (Section 24), self-occupied vs let-out | New ledger category(ies): rent received, municipal taxes paid, home-loan interest; new evidence facts (rent receipts, loan interest certificate) | New validation (negative income cap for self-occupied, ITR-2 requirement) | New material outputs + traceability lines | "Is any property owned?" → "let-out or self-occupied?" → conditional rent/loan questions | Yes — new ledger category | Independent | **Medium** | Compute-first | No co-ownership apportionment; no multiple-property loss-set-off interaction (defer to #5) |
| 3 | **Presumptive professional income (44ADA)** | A.4; simpler statutory shape than general business income | `unsupported` | Declared-situation only (routes to manual review) | Deemed-profit-percentage computation on gross receipts, no books required | New ledger category (gross professional receipts); evidence facts for receipts | New validation (receipts ceiling, eligibility) | New outputs + traceability | "Is this professional income eligible for 44ADA?" | Yes — new ledger category | Independent of #4 | **Medium** | Compute-first | No books-of-account path; no audit-trigger edge cases |
| 4 | **Presumptive business income (44AD)** | A.4 | `unsupported` | Declared-situation only | Deemed-profit-percentage on turnover, digital-receipts nuance | New ledger category (turnover, digital vs cash receipts) | New validation (turnover ceiling) | New outputs + traceability | "Is this business income eligible for 44AD?" | Yes — new ledger category | Shares design shape with #3 | **Medium** | Compute-first | No 44AD-to-tax-audit transition logic |
| 5 | **Loss set-off / carry-forward (capital gains only)** | A.5; natural extension of already-supported 111A/112A | `unsupported` | Adapter blocks negative supported gains (safe) | Intra-head/inter-head set-off ordering, carry-forward tracking across years | Multi-year carry-forward state (new persistence concept) | New validation (set-off ordering correctness) | New outputs + traceability; carry-forward disclosure | "Any brought-forward losses to set off?" | Extends existing gain-type vocabulary; needs a NEW multi-year concept | Depends on capital-gains support (already present) | **Medium-high** (multi-year state is new) | Compute-first | No business-loss carry-forward (depends on #6/#7 existing first) |
| 6 | **General business/professional income (books-based)** | A.4 (upper end — larger clients) | `unsupported` | Adapter blocks non-zero rows (safe) | P&L-derived income, depreciation schedules, disallowances | New ledger categories (revenue, expense heads, depreciation) | New validation (books completeness) | New outputs + traceability | Multi-step interview (books available? depreciation schedule? disallowances?) | Yes — significant new vocabulary | Best sequenced after #3/#4 establish the simpler presumptive path | **High** | Compute-first | No tax-audit integration (defer to #10) |
| 7 | **Surcharge and marginal relief (actual computation)** | Statutory completeness; currently only a reliance BLOCKER, not computed | `unsupported`, dynamically `reliance_blocked` above ₹50L (already SAFE) | **Already structurally blocked** (TAX-SAFE-01/01A) — lower urgency than #1 despite being long-standing | Surcharge slab table (10/15/25/37%), marginal relief formula, capital-gains surcharge cap | None new | New validation (surcharge-affected figures) | Removes the existing reliance blocker once implemented + verified | None (automatic, not interview-driven) | None | Independent, but touches every regime/rebate path | **Specialist** (interacts with every existing slab/rebate calc) | Compute-first; must not touch already-golden low-income fixtures | No sub-surcharge-threshold behavior change |
| 8 | **F&O (futures & options)** | A.6 (assumed low frequency) | `unsupported` | Declared-situation only | Speculative/non-speculative business classification, turnover-based tax-audit trigger | New ledger category | New validation | New outputs | "Any F&O/speculative transactions?" | Yes | Shares shape with #6 | **Specialist** | Compute-first | No tax-audit trigger implementation (defer to #10) |
| 9 | **VDA / crypto (Section 115BBH)** | A.6 (assumed low frequency); statutorily simple (flat 30%, no set-off) but narrow | `unsupported` | Declared-situation only | Flat-rate computation, explicit no-set-off/no-deduction rule | New ledger category | New validation (no-set-off enforcement) | New outputs | "Any VDA/crypto transfers?" | Yes | Independent | **Medium** (simple rule, but must not leak into ordinary set-off logic) | Compute-first | No cost-basis/FIFO specification (needs a source-backed rule milestone first) |
| 10 | **Foreign assets (Schedule FA)** | A.6 (assumed low frequency for a domestic CA office) | `unsupported` | Declared-situation only; blocks ITR-1 | Disclosure-heavy, not computation-heavy | New evidence/document requirements | New validation (disclosure completeness) | New outputs (disclosure schedule, not a tax figure) | Extensive interview (foreign accounts? foreign income? assets?) | Yes — largely document/disclosure vocabulary | Independent | **High** (disclosure correctness has its own legal risk) | Disclosure-first, not computation-first | No NRI residency-status computation |
| 11 | **Tax audit (Section 44AB)** | Naturally follows business-income breadth | `unsupported` | Declared-situation only | Turnover/receipt threshold detection, audit-report linkage | None new (derived from #6/#8's own figures) | New validation (threshold breach detection) | New outputs (audit-required flag) | "Does turnover exceed the audit threshold?" | None new | Depends on #6 (business income) and #8 (F&O) existing first | **Specialist** | Last in sequence | No actual 3CD/audit-report generation (separately-approved Wave 8 program per the K3 program's own wave table) |

**What this ranking deliberately does NOT claim:** that #1 is the practice's
highest-VOLUME need — it is the highest-RISK need, given the one confirmed
active safety finding. If the maintainer confirms A.6 is wrong (TaxDesk OS does serve
F&O/VDA/foreign-asset clients), items 8-10 should move up sharply. If A.4 is
overstated (few presumptive-eligible clients), items 3-4 should defer behind
house property.

