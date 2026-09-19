# K.3 — Wave-2 coverage and limitations

**Milestone:** `K3-23` (Wave-2 closeout)

**Statutory path assessed:** AY 2026-27 / FY 2025-26 / Income-tax Act 1961

**Status:** preparation-only, synthetic-only, every shipped tax pack `draft`

This report answers a narrow question: what the current engine, adapter, tax
pack, validation layers, and seeded synthetic laboratory actually cover. It is
not a tax-law correctness opinion, a CA verification record, a filing-readiness
statement, or evidence of tax-authority acceptance.

The machine-readable inventory is `buildWave2CoverageReport()` in
`src/lib/tax-lab/coverage-report.ts`. Its guard,
`src/lib/tax-lab/__tests__/coverage-report.test.ts`, probes the real adapter over
the Tax Desk's closed ledger vocabularies, derives fixture exercise from the
seeded fixture data, checks all `MATERIAL_OUTPUT_IDS` and pack rule ids, and
cross-checks the declared validation-code inventories against the literals that
raise findings in `validate-case.ts` and `validation-runner.ts`. A vocabulary or
finding-code addition therefore fails the test until the test's own expected
lists are updated.

**That is not, by itself, a guarantee this document stays current** —
`AUDIT-02` (2026-07-26) found six factual drifts here after `K4-02`/`K4-03`/
`K4-04` each updated the test's expected lists and left this prose untouched
(`AUDIT-02-F2`). The marker below closes that gap: a dedicated assertion in
`coverage-report.test.ts` reads it back out of this file and compares every
value against the live `buildWave2CoverageReport()` output, so a count above
drifting from the code — not just from the test file — now fails the suite.
Update the marker (and the surrounding prose) in the same change that moves
any of these numbers.

<!-- WAVE2_COVERAGE_COUNTS
materialOutputsDeclared=14
packRulesDeclared=22
engineCodesDeclared=35
exercisedEngineCodes=15
fixtureIds=22
deductionCategoriesNotSeeded=3
-->

## 1. Supported golden path

The supported golden path consists of the four bound fixtures that declare no
excluded or withheld fact:

1. `ay2026-27/salaried-refund-new-regime`
2. `ay2026-27/salary-capital-gains`
3. `ay2026-27/salaried-payable-with-deductions`
4. `ay2026-27/reported-interest-not-reconciled`

Two additional bound fixtures exercise explicit work rather than a complete
case: `unsupported-house-property-and-other-ltcg` is adapter-blocked and
`unaccepted-broker-evidence` is evidence-blocked. The TY 2026-27 fixture is
refused because its identity-only pack has no computation binding.

All **14** closed material-output ids are exercised by at least one seeded
fixture, and all **14** computation pack rules are cited by at least one
seeded expectation. (Provenance declares **17** rules in total; **3** are
non-computed — reliance-blocking, classification, or validation-only, never
cited by an engine `ComputedValue` — and excluded from this fixture-exercise
vocabulary by `NON_COMPUTED_VALUE_PACK_RULE_IDS`; see §4 for the validation-only
one.) That proves vocabulary coverage and deterministic regression behavior. It
does not prove that the rule values match the law.

## 2. Ledger-to-computation coverage

The status below is derived by passing every value in `INCOME_HEADS`,
`TAX_PAID_TYPES`, `DEDUCTION_TYPES`, and `GAIN_TYPES` through
`buildEngineInput`.

| Ledger concept | Current adapter / engine treatment | Seeded fixture exercise |
| --- | --- | --- |
| Income: `salary` | Mapped and taxed through salary/slab logic | Yes |
| Income: `savings_interest`, `fd_interest` | Mapped as ordinary slab income | Yes: both |
| Income: `dividend`, `other_sources` | Mapped as ordinary slab income | **No** |
| Income: `exempt_income` | Mapped and tracked, deliberately excluded from taxable GTI | **No** |
| Income: `house_property` (the OLD `tax_income_entries` placeholder head) | Explicit `UNSUPPORTED_INCOME_HEAD` blocker for non-zero rows; excluded — superseded by the new dedicated `tax_house_property_entries` ledger (`K4-06`, below) | Yes |
| Income: `business_income` | Explicit `UNSUPPORTED_INCOME_HEAD` blocker for non-zero rows; excluded | **No** |
| Income: `presumptive_professional_44ada` (`K4-07`) | Computed as a 50% deemed-profit figure — `presumptive_44ada_computation`; the AGGREGATE across every live row must stay within the applicable ₹50L/₹75L eligibility ceiling or ALL rows are excluded (`PRESUMPTIVE_44ADA_CEILING_EXCEEDED`) | Yes (`presumptive44adaFixture`) |
| House property (`K4-06`, dedicated ledger, NOT an `INCOME_HEADS` value) | Computed for a SINGLE property per case (self-occupied or let-out) — `house_property_computation`; more than one live row is excluded (`MULTIPLE_HOUSE_PROPERTIES_NOT_MODELLED`) | Yes (`houseSelfOccupiedInterestFixture`) |
| Capital gain: `stcg_111a`, `ltcg_112a` | Mapped and taxed at the engine's special-rate branches | Yes: both |
| Capital gain: `other_stcg`, `other_ltcg` | Explicit `UNSUPPORTED_GAIN_TYPE` blocker for non-zero gains; excluded | Other LTCG yes; other STCG **no** |
| Negative `stcg_111a` / `ltcg_112a` | Explicit `CAPITAL_LOSS_NOT_MODELLED` blocker; excluded | **No seeded loss fixture** |
| Tax paid: `salary_tds`, `non_salary_tds`, `tcs`, `advance_tax`, `self_assessment_tax` | All mapped and summed | Salary TDS + advance tax only; other three **not seeded** |
| Deductions: `80C`, `80D`, `80D_PARENTS`, `80TTA`, `80TTB`, `80CCD`, `80G` | Mapped to the old-regime Chapter VI-A computation using basic caps | 80C + 80D + 80D_PARENTS + 80TTA + 80TTB seeded; `80CCD`/`80G` **not seeded** |
| Deduction: `other_deductions` | Mapped to engine section `other` | **No** |

The absence of a seeded fixture is recorded as a coverage gap, not as evidence
that the path fails. Direct adapter/engine unit tests cover more combinations,
but the Wave-2 case laboratory does not currently exercise them end to end.

## 3. Material outputs and versioned rules

The closed material-output vocabulary is fully exercised: gross total income,
deductions allowed, total income, old/new regime tax, recommended regime,
special-rate gains and tax, rebate, cess, gross liability, taxes paid,
refund/payable, and recommended ITR type.

The sixteen computation pack rules are also all exercised: `slab_rates`,
`standard_deduction`, `rebate_87a`, `capital_gains_stcg_111a`,
`capital_gains_ltcg_112a`, `cess_rate`, `chapter_via_deduction_caps`,
`itr1_income_ceiling`, `senior_super_senior_basic_exemption_widening`,
`senior_80d_deduction_cap`, `senior_80d_parents_deduction_cap`,
`senior_80tta_80ttb_mutual_exclusivity` (the last four added by
`K4-02`/`K4-03`/`K4-05`), `house_property_computation` (`K4-06`), and
`presumptive_44ada_computation` (`K4-07`), `presumptive_44ad_computation`
(`K4-08`), and `capital_loss_within_year_set_off` (`K4-09` — the WITHIN-YEAR
half only; carry-forward across assessment years is not modelled at all).
Attribution is intentionally at
rule-group granularity; the pack declares no finer rule identity.

Gross total income and taxes paid are classified as `input_projection`; the
other 12 outputs are `rule_derived` and must cite at least one declared rule id.
Recommended regime and recommended ITR type are categorical decisions with no
engine `ComputedValue.sources` tags, so the laboratory marks them
`evidenceTraceable: false` rather than pretending an empty evidence list is a
trace.

### `K3-24` live rendered-figure correction

The 14 ids above are the laboratory expectation vocabulary; they are not a list
of every material occurrence rendered by the live Computation screen. `K3-24`
added a separate, guarded production inventory, extended by `K4-06` (+2 traced
house-property figures) and `K4-07` (+2 traced presumptive-44ADA figures) to
**38** ids: **32 traced**, **2
not source-tagged by construction**, and **4 explicit untraced limitations**.

The traced partition includes top-level outcome figures, separate old/new
regime values, the engine's signed old-minus-new liability difference, input
summary gross total income, and the slab/special-rate/cess/gross-liability full
detail. Each traced value and its evidence tags come from the same engine
`ComputedValue`; old/new ids are never backed by the recommended result.

The two categorical exceptions are exactly recommended regime and recommended
ITR. The four limitations are exactly the old/new presentation-derived “tax
before rebate” totals and old/new unimplemented surcharge zero placeholders.
They are visible beside the rendered figures and in the trace panel. The
inventory/page-row/source-audit unit guard fails if this partition or rendered
vocabulary moves without a new traceability decision.

### `K3-25` effective-state and rendered-vocabulary hardening

The 28/2/4 partition above is the **authored** inventory against today's shipped
pack. It is not allowed to conceal later pack drift. Runtime rule resolution now
derives a separate effective state: any authored traced line citing an
undeclared governing-pack rule becomes an itemised
`untraced_rule_mapping_gap`, and the read-model count authority removes it from
the effective traced total. A controlled provenance test proves this without
mutating the registry; the current-pack assertion still proves every shipped id
is known and the static partition remains exactly 32/2/4 (28/2/4 as of
`K3-25`; `K4-06` added 2 traced house-property figures, `K4-07` added 2 traced
presumptive-44ADA figures).

The source audit now rejects every `.value`/`?.value` access and `value`
destructure on the Computation page, covering alternative formatters, aliases,
arithmetic, and raw JSX at the scalar-extraction boundary without adding a
parser. A complementary live E2E set comparison proves the complete rendered
`data-material-figure-id` vocabulary has no missing or unknown id. The id list is
an import-safe, data-only module; Playwright does not load a server module.

Liability, outcome, and difference values keep their engine `ComputedValue`
lineage but now carry one shared proximate caveat: they incorporate the engine's
unimplemented surcharge ₹0 placeholder and therefore are not complete or
verified surcharge treatment. This does not turn them into lineage gaps; it
separates traceability from implementation completeness. The two surcharge
detail rows remain untraced limitations.

## 4. Validation coverage

The AY engine declares 22 finding codes:

- `DOC_MISSING`
- `AIS_INTEREST_NOT_ENTERED` — seeded
- `AIS_INTEREST_MISMATCH`
- `TDS_26AS_UNMAPPED`
- `FORM16_SALARY_MISMATCH`
- `CG_REQUIRES_ITR2` — seeded
- `HOUSE_PROPERTY_LOSS_REQUIRES_ITR2` (`K4-06`)
- `HOUSE_PROPERTY_INTEREST_PROOF_MISSING` — seeded (`K4-06`)
- `HOUSE_PROPERTY_LOSS_SETOFF_CAPPED` (`K4-06`)
- `PRESUMPTIVE_44ADA_REQUIRES_ITR4` — seeded (`K4-07`)
- `PRESUMPTIVE_44ADA_DEEMED_PROFIT_APPLIED` — seeded (`K4-07`; disclosure
  only, no separate expense/depreciation deduction is claimed on top)
- `PRESUMPTIVE_44AD_REQUIRES_ITR4` — seeded (`K4-08`)
- `PRESUMPTIVE_44AD_DEEMED_PROFIT_APPLIED` — seeded (`K4-08`; disclosure only,
  and states plainly that the eligible-business-type test and the Section
  44AD(4)/(5) five-year lock-in are NOT performed by this engine)
- `PRESUMPTIVE_44AD_ENHANCED_CEILING_UNVERIFIED` (`K4-08`; blocker — fires only
  above the ordinary ₹2cr ceiling, where eligibility rests on the enhanced ₹3cr
  ceiling whose cash-PAYMENTS leg no captured data can verify. Not seeded: the
  turnover needed would add a second, unrelated ITR-1 blocker to the fixture,
  so it carries unit coverage instead)
- `DEDUCTION_PROOF_MISSING`
- `DEDUCTION_SECTION_AGE_MISMATCH` — seeded (`K4-03`)
- `TAX_PAYABLE_NO_CHALLAN` — seeded
- `ADVANCE_TAX_EXEMPT_SENIOR_CITIZEN_207_2` — seeded (`K4-04`; validation-only,
  never a computed liability/refund figure — see §1's provenance-exclusion note)
- `APPROVAL_MISSING`
- `EVERIFICATION_PENDING`
- `FINALIZED_EDIT_BLOCKED`
- `PORTAL_CREDENTIAL_TEXT`

The laboratory pins exactly the ten marked codes by code + severity + area
and matches findings both ways. The remaining twelve engine findings exist and
have unit coverage, but are not exercised by seeded whole-case fixtures.

The production validation coordinator owns a further 18 fixed codes:
`coverage.unsupported_entry`, `coverage.partial`,
`coverage.no_meaningful_income`, `itr.missing_selected`, `itr.mismatch`, the four
`documents.required_*` states, `ledger.source_ref_invalid`,
`ledger.source_rejected`, `ledger.source_not_received`,
`ledger.non_manual_no_source`, `ledger.zero_value`,
`ledger.deduction_no_proof`, `ledger.cg_arithmetic`, `ledger.duplicate`, and
`reconciliation.source_mismatch`. It also passes the 23 engine codes through as
`engine.<code>`. **The seeded laboratory calls the pack's `validateCase`, not the
production `runValidation` coordinator, so none of those 18 coordinator-owned
codes is a seeded whole-case claim.**

## 5. Limitations — what a preparer must not conclude

1. **No pack is CA-verified.** Every shipped pack is `draft`; every AY rule has
   an unresolved `TODO(CA-verify)` caveat. A traced number is not a verified
   number.
2. **Fixture expectations are regression anchors, not correctness claims.** They
   record what the engine does today and were read from that behavior; they are
   not independently derived from tax law.
3. **No official source-format specimen has been inspected.** Every import
   source schema remains `planned` (decision D17). The laboratory declares
   evidence metadata; it parses no AIS, 26AS, Form 16, prefilled JSON, broker
   report, or bank certificate.
4. **The live product has no evidence-acceptance dimension.** `accepted /
   proposed / rejected` exists only in the synthetic laboratory. The production
   traceability surface shows a row's source document/type, not a human decision
   accepting that fact as preparation truth.
5. **Surcharge is not modelled** (the engine returns a zero placeholder). The
   live inventory therefore marks both surcharge detail values as untraced
   limitations and explicitly says ₹0 is not a verified zero-tax result.
   Liability, outcome, and difference figures retain traceable engine lineage,
   but a proximate shared caveat says they incorporate that placeholder and are
   not complete or verified surcharge treatment.
6. **The 80D "insured party" (parent-premium) sub-case is now modelled
   (`K4-05`, 2026-07-26)** — corrected from the prior `AUDIT-02` (2026-07-26)
   finding. `K4-01` replaced the hardcoded `below_60` with a DOB-derived age
   band; `K4-02` modelled the OLD-regime senior/super-senior basic-exemption
   slabs; `K4-03` applied the senior 80D cap and the 80TTA-vs-80TTB mutual
   exclusivity for the taxpayer's OWN age band; `K4-05` added a new
   `DeductionSection` value `"80D_PARENTS"` and a nullable
   `insured_party_senior` ledger column so a premium paid on behalf of a
   senior/super-senior PARENT (by a taxpayer of ANY age) now gets its own
   independent ₹25,000/₹50,000 cap, summed with — never merged into — the
   self/family bucket's cap (`senior_80d_parents_deduction_cap`; spec §10.2).
   **A separate, still-open gap surfaced during `K4-05`'s re-sourcing:** the
   self/family "80D" bucket's own cap does not yet widen when a SPOUSE (not
   the taxpayer) is senior — the ITD's own guidance states the cap widens "if
   ANY person is a Senior Citizen," which literally includes a senior spouse,
   but `K4-03` scoped that bucket to the taxpayer's own age band only. This
   affects a BELOW-60 taxpayer (never the resident senior/super-senior
   population `SENIOR_TREATMENT_UNSUPPORTED` gates) and is recorded as a
   candidate for a future change, not fixed by `K4-05` (`rules.ts`'s
   `DEDUCTION_CAPS` module doc).
7. **Loss set-off and carry-forward are not modelled.** A negative supported
   gain is blocked and excluded.
8. **House property is now computed for a SINGLE property per case (`K4-06`,
   2026-07-26)** — self-occupied or let-out, Section 24(a)/24(b)/71(3A). Not
   covered: co-ownership apportionment, multiple-property loss-set-off
   interaction and carry-forward beyond the current year (deferred to Wave-4
   priority #5), and the fair-rent/municipal-value/standard-rent GAV
   comparison. **Presumptive professional income (Section 44ADA) is now
   computed as a 50% deemed-profit figure (`K4-07`, 2026-07-26)**, aggregate-
   ceiling gated (₹50L/₹75L). Not covered: the books-of-account fallback path
   (a taxpayer declaring actual profit BELOW the deemed 50%, which the
   ledger has no field to even represent) and Section 44AB tax-audit trigger
   detection. **Books-based business/professional income IS now computed
   (`K4-14`, 2026-08-10), aggregated across undertakings (`K4-15`)** — but only
   where the preparer declares that no Sections 30-43D adjustment arises, the
   Section 44AB aggregate is within the limb's threshold, and no undertaking
   shows a loss. Every other case is refused, not partially computed. This
   sentence previously read "is not computed"; that was true when `K3-23`
   wrote it and `K4-14` did not correct it forward. Full ITR-3 vs
   ITR-4 selection is likewise outside the implemented recommendation
   breadth (`K4-07` positively recommends ITR-4 only for the clean
   presumptive-only case; any combination with capital gains, foreign
   assets, house-property loss, or general business income falls back to a
   CA-review note, matching the pre-existing business-income treatment).
9. **Chapter VI-A support is basic only.** 80G qualifying limits/categories and
   other section-specific eligibility nuances are not represented by the basic
   cap table.
10. **Rule attribution is coarse.** A figure cites pack rule groups, not a
    clause-level derivation graph; finer attribution would require finer stable
    rule identities and verified provenance.
11. **Two categorical decisions are not evidence-tagged.** Recommended regime
    and recommended ITR form have no engine source tags; the report says so
    instead of claiming evidence traceability.
12. **Fixture breadth is incomplete.** Dividend, other-sources, exempt income,
    business income, other STCG, capital losses, three tax-paid categories,
    three deduction categories (`80CCD`, `80G`, `other_deductions` — `80TTA`/
    `80TTB` are seeded as of `K4-03`, `80D_PARENTS` as of `K4-05`), eleven
    engine findings, and all coordinator-owned findings lack seeded
    whole-case exercise. House property gained its first fixture as of
    `K4-06` (`houseSelfOccupiedInterestFixture`, self-occupied only — no
    let-out fixture yet). Presumptive professional income (44ADA) gained its
    first fixture as of `K4-07` (`presumptive44adaFixture`, a single-row,
    ITR-1-selected case exercising both new findings at once) — no
    multi-row aggregation fixture and no digital-receipts-ceiling (₹75L)
    fixture yet.
13. **Document matching can be document-granular.** When multiple rows share one
    document, the engine source tag can associate all those rows with a figure;
    it is not a row-exclusive lineage claim. Deduction proof documents are not
    currently nameable on the production surface from the engine tag alone.
14. **Production computation still invokes the engine directly** (D8/D10). The
    pack identity describes and versions the code by a tested by-reference
    binding; the laboratory, not production call sites, exercises the routed
    pack computation path.
15. **A green run is not filing readiness, filing, or tax-authority acceptance.**
   Internal finalization remains distinct from all three.
16. **Two presentation totals have no engine authority of their own.** The old
    and new “tax before rebate” rows add two engine values in presentation. They
    are useful disclosure totals, but have no combined `ComputedValue` or source
    tags, so the live inventory marks them as visible untraced limitations.

## 6. Wave-2 gate consequence

The deterministic-rule and explicit-blocker clauses are met for the assessed
scope. The rendered-figure claim is now closed by the exact authored 28/2/4
partition, a runtime-effective mapping-gap downgrade, and source/live-DOM
anti-bypass guards. The accepted-evidence clause is still **partly met**: it is
structural and tested inside the laboratory, but the two exact categorical
outputs carry no evidence tags and the live product has no human acceptance
state. Wave 2 is therefore **partly closed**. `K3-25`'s runtime gate was rerun
in full on the developer host and is green (the contributor guide); `K3-25` is complete.
The accepted-evidence exit gate remains not fully met independently of that.
Wave 3 must close the product acceptance gap through a narrow propose → review
→ accept/reject vertical slice; it must not relabel the current source
association as acceptance. (`K3-30` shipped the first narrow slice of that —
see the contributor guide's `K3-30` entry — but Wave 3's exit gate is not yet claimed.)
