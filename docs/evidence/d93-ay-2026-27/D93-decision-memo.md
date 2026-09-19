# TaxDesk OS Decision Memo - D93

**Decision date:** 31 July 2026  
**Tax period:** FY 2025-26 / AY 2026-27  
**Scope:** Individuals/HUFs using ITR-2 or ITR-3; synthetic resident cases unless noted; no client data  
**Decision status:** **Partly close D93, partly narrow it**

## Executive decision

1. **Close the Section 112A threshold question.** For AY 2026-27, the official ITR-2 v1.2 computation applies current-year and brought-forward capital-loss set-off first, then any resident basic-exemption shortfall, and only then the aggregate **Rs 1,25,000** Section 112A threshold. It does not subtract the threshold from gross Schedule 112A gain before loss set-off.
2. **Close the eligibility rules.** Current or brought-forward STCL may be set off against eligible STCG or LTCG; LTCL may be set off only against LTCG. Unused capital loss may be carried forward for at most eight assessment years, subject to the return-filing conditions outside the narrow D93 test.
3. **Use current-year loss before brought-forward loss in the AY 2026-27 filing pipeline.** The notified form, schema, validation rules and utility all sequence Schedule CG/current-year set-off and CYLA before BFLA, then CFL/SI.
4. **Do not close D93 by declaring one rate-bucket hierarchy to be mandatory law.** Sections 70 and 74 do not prescribe a hierarchy among all eligible gain buckets. Recent official ITAT orders, and the Calcutta High Court authority they reproduce, recognize a taxpayer's beneficial choice. The official Excel utility nevertheless applies a fixed default sequence.
5. **K4-10 may proceed** for year/type storage, eligibility, eight-year expiry, current-before-brought-forward pipeline, allocation ledger, provenance and disclosures. Final tax computation must preserve an explicit allocation election and a versioned `portal_default_ay2026_27` mode; it must not silently label the utility sequence as the only statutory result.

## What is mandatory, operational, interpretive or unresolved

| Layer | Finding | D93 treatment |
|---|---|---|
| Mandatory law | Section 70(2): STCL is eligible against gain from any other capital asset. Section 70(3): LTCL only against gain from a non-short-term asset. Section 71(3): capital loss cannot move to another income head. Section 74 repeats the STCL/LTCL limits for brought-forward loss and imposes an eight-AY ceiling. | Closed |
| Mandatory law | Section 112A taxes qualifying LTCG **exceeding Rs 1,25,000**, subject to the resident basic-exemption adjustment. In the statutory computation, that gain is an amount included in total income after Chapter VI aggregation/set-off. | Threshold-after-set-off is the better legal reading; closed with utility confirmation |
| Notified form / portal behavior | Part B-TI takes current-year losses first, then brought-forward losses, then identifies special-rate income. Schedule BFLA consumes the output of CYLA. | Closed for AY 2026-27 filing conformance |
| Official utility behavior | Current STCL is routed across eligible rate buckets by a fixed sequence; within 12.5% LTCG, non-112A classes are consumed before Section 112A. BFLA also preserves Section 112A until other 12.5% LTCG is exhausted. | Versioned portal default, not universal law |
| Judicial / professional interpretation | Official ITAT orders hold that section 70 does not create rate compartments or a compulsory chronology, and that the taxpayer may choose a lawful beneficial allocation. | Explicit election/review path required |
| Unresolved | No CBDT circular or rule was located that makes the Excel utility's intra-head rate-bucket sequence legally mandatory. No Supreme Court authority on the precise Section 112A threshold-versus-loss ordering was located in the bounded search. Portal upload behavior can change with a utility/schema release. | Keep narrow D93 sub-issue open and version-gated |

## Authoritative AY 2026-27 artifacts

The Income Tax Department downloads page listed, as retrieved on 31 July 2026:

- Common Offline Utility for ITR-1/2/3/4 **v1.2.2**, released 17 July 2026.
- ITR-2 Excel utility **v1.2**, released 17 July 2026; JSON schema **v1.1**, latest 30 June 2026; validation rules **v1.0**, dated 26 May 2026.
- ITR-3 Excel utility **v1.2**, released 17 July 2026; JSON schema **v1.1**, latest 30 June 2026; validation rules **v1.0**, dated 18 June 2026.

ITR-2 is the principal conformance artifact used because its capital-gain schedules and computational code are sufficient for D93. ITR-3 contains the same relevant Schedule CG/CYLA/BFLA/CFL/SI structure, with business-income rows added.

## Official utility trace

Static inspection of the official ITR-2 v1.2 workbook (macros were **not executed**) established this calculation graph:

1. `CG_Calc.doSetoff` performs capital-gain intra-head set-off in Schedule CG.
2. `CYLABFLASetOff` runs CYLA functions, then `calcBFLA`, then `calcCFL`.
3. For an active 20% STCL, `setOffPctg20Loss_STCG` routes the remaining loss to STCG 30%, STCG at applicable rate, then LTCG 12.5%. Same-rate/source netting occurs before these cross-bucket steps.
4. `setOffAgainst125` calls the 12.5% LTCG sub-buckets with Section 112A last. Thus a loss reaches Section 112A only after the earlier non-112A 12.5% buckets are exhausted.
5. `calcBFLA` consumes brought-forward LTCL before brought-forward STCL, and its SI redistribution assigns the surviving aggregate 12.5% LTCG to Section 112A first. That is economically equivalent to consuming non-112A LTCG before Section 112A.
6. Schedule SI row 28 takes post-BFLA Section 112A income, applies any resident basic-exemption shortfall, sets the threshold as `MIN(125000, adjusted 112A income)`, and computes 12.5% tax on the excess. The companion PTI row receives only the unused balance of the same aggregate Rs 1,25,000 threshold.

### JSON / schedule mapping inspected

- `ScheduleCGFor23` and `Schedule112A` hold transaction and Schedule CG amounts. `SaleOfEquityShareUs112A.BalanceCG` is the pre-threshold Schedule CG balance, not the exempt threshold amount.
- Capital loss set-off is represented first in Schedule CG Table E. In the JSON schema, CYLA carries the resulting capital buckets as `STCG20Per`, `STCG30Per`, `STCGAppRate`, `STCGDTAARate`, `LTCG12_5Per` and `LTCGDTAARate`.
- `ScheduleBFLA.<bucket>.IncBFLA` contains `IncOfCurYrUndHeadFromCYLA`, `BFlossPrevYrUndSameHeadSetoff` and `IncOfCurYrAfterSetOffBFLosses`.
- `ScheduleCFL` carries unused losses by originating assessment year.
- `ScheduleSI` receives the post-BFLA special-rate income and tax. The validation rules require Schedule SI to agree with BFLA and Part B-TI.

No official submission JSON was uploaded or accepted through the portal. The conformance result is based on inspection of the official workbook's calculation/export source, formulas, notified form, schema and validations. The accompanying synthetic JSON is a test result record, not an uploadable ITR.

## Synthetic conformance results

Assumptions for the compact matrix: rupee integers; no DTAA/FPI/VDA cases; no deductions; no basic-exemption shortfall; tax shown before surcharge and cess. “Other 12.5%” is a simplified non-112A LTCG bucket.

| Case | Synthetic inputs | Utility-conformance result |
|---|---|---|
| D93-01 | STCL20 100,000; STCG30 60,000; STCG-app 60,000; 112A 200,000 | STCL uses 60,000 STCG30 then 40,000 STCG-app; 112A remains 200,000; taxable 112A base 75,000; tax 9,375 |
| D93-02 | STCL20 150,000; STCG30 40,000; STCG-app 30,000; other LTCG12.5 50,000; 112A 200,000 | Loss reaches 112A only for final 30,000; post-set-off 112A 170,000; taxable base 45,000; tax 5,625 |
| D93-03 | LTCL 100,000; other LTCG12.5 60,000; 112A 150,000 | LTCL consumes other LTCG first, then 40,000 of 112A; surviving 112A 110,000; no 112A tax |
| D93-04 | Current LTCL 50,000; BF LTCL 50,000; eligible LTCG 60,000 | Current loss uses 50,000; BF loss uses 10,000; BF LTCL 40,000 remains in CFL |
| D93-05 | Current STCL 100,000; BF STCL 100,000; STCG30 150,000 | Current loss uses 100,000; BF loss uses 50,000; BF STCL 50,000 remains |
| D93-06 | BF LTCL 50,000; BF STCL 50,000; other LTCG12.5 30,000; 112A 30,000 | Utility uses BF LTCL 50,000 first; BF STCL then uses 10,000; BF STCL 40,000 remains |
| D93-07/08/09 | 112A 124,999 / 125,000 / 125,008 | Taxable base 0 / 0 / 8; rounded tax 0 / 0 / 1 |
| D93-10 | 112A 150,000; current LTCL 30,000 | Post-loss 112A 120,000; threshold then applied; no tax |
| D93-11 | 112A 150,000; current LTCL 10,000 | Post-loss 112A 140,000; taxable base 15,000; tax 1,875 |

Full figures are in `D93-synthetic-test-matrix.csv` and `D93-synthetic-results.json`.

## Reconciliation with law and judicial authority

### Sections 70, 71 and 74

The Act creates eligibility boundaries, not detailed rate-bucket ordering. Sections 70(2) and 74(1)(a) make STCL usable against capital gain from any other capital asset. Sections 70(3) and 74(1)(b) confine LTCL to LTCG. Section 71(3) prevents a net capital loss from being set off against another head. Section 74(2) limits carry-forward to eight assessment years.

### Sections 111A, 112 and 112A

These provisions determine special tax rates and basic-exemption adjustments after the capital-gain computation. For FY 2025-26 transfers, section 111A uses 20% and sections 112/112A generally use 12.5% for the relevant post-23 July 2024 categories. Section 112A taxes the qualifying LTCG amount exceeding Rs 1,25,000; it does not state a separate rule requiring the threshold to be applied to gross gain before Chapter VI set-off.

### Judicial authority on allocation choice

The official ITAT order in **Divya Dinesh v DCIT**, ITA 2194 & 2195/Bang/2025 (24 February 2026), held that sections 111A/112/112A govern rates while section 70 governs set-off; CPC could not replace the taxpayer's lawful allocation merely because rates differed. Official ITAT orders in **India Acorn Fund Ltd** and **Ishana Capital Master Fund** likewise state that section 70(2) gives an unqualified choice and a lower-tax outcome is not a reason to deny it. Those orders reproduce and rely on **CIT v Rungamatee Trexim (P.) Ltd**, Calcutta High Court ITA 812/2008 (19 December 2008), which found no prescribed chronology among STCG rate classes.

These authorities strongly reject a universal compulsory rate hierarchy. They do not, by themselves, establish a nationwide Supreme Court rule for every resident fact pattern, every mix of current/brought-forward losses, or the exact Section 112A threshold question.

## Recommended deterministic implementation rule

Implement a two-layer engine:

1. **Legal eligibility layer (mandatory):** build an explicit allocation graph. STCL edges may point to eligible STCG/LTCG; LTCL edges only to LTCG. Track current versus brought-forward identity, originating AY, amount used, destination bucket and residual expiry. Reject ineligible edges.
2. **Allocation policy layer (elected and versioned):**
   - `portal_default_ay2026_27`: mirror official utility v1.2/v1.2.2, including current-year before BFLA, the observed rate-bucket routing, non-112A LTCG before 112A, BF LTCL before BF STCL, and threshold after all capital-loss set-off.
   - `taxpayer_elected`: accept a fully specified lawful allocation, normally chosen to minimize tax or preserve more valuable/earlier-expiring losses, with professional-review flag and an audit explanation.
3. **Threshold step (mandatory in both policies):** calculate the surviving Section 112A income after set-off; apply the resident basic-exemption shortfall if applicable; then apply one aggregate Rs 1,25,000 threshold across direct and PTI Section 112A income; then apply the rate and rounding.
4. **No silent optimization:** persist the policy ID, utility/schema version, source evidence date and allocation ledger. If a taxpayer-elected allocation does not reproduce the current portal, stop for review rather than silently substituting the utility default.

## K4-10 release boundary

K4-10 is unblocked for:

- loss records by AY and STCL/LTCL type;
- statutory eligibility and eight-AY expiry;
- filing-timeliness/eligibility flags and provenance;
- current-year/BF separation;
- explicit allocations and residuals;
- portal-default versioning, disclosures and audit trail.

Keep the following release gate:

> Do not ship a single hard-coded “statutory allocation order.” Require an explicit policy/election, and re-run the conformance suite whenever the AY 2026-27 utility, schema or validations change.

## Reliance limits

- Research was current to 31 July 2026 and restricted to official Income Tax Department/CBDT materials, notified forms, official utility/schema/validation artifacts and primary court/tribunal materials where obtainable.
- Static workbook inspection is not the same as a successful e-filing portal upload or CPC assessment. The workbook's macros were not executed; formulas and source were inspected without running them.
- Synthetic cases exclude client facts, DTAA positions, FPI/115AD nuances, pre-23 July 2024 transfers, VDA, exemptions under sections 54-series, surcharge, cess, rebate and filing-timeliness adjudication.
- ITAT orders bind the parties and are persuasive; territorial High Court precedent and later appellate developments must be checked for the taxpayer's jurisdiction. The official Calcutta High Court copy of Rungamatee was not independently retrieved; the holding is preserved through multiple official ITAT orders.
- This memo supports software design and conformance testing. It is not a filing opinion for a taxpayer and should be reviewed by a qualified Indian tax professional before relying on a taxpayer-elected allocation that differs from portal output.

## Primary references

- Income Tax Department: [AY 2026-27 downloads](https://www.incometax.gov.in/iec/foportal/downloads)
- CBDT Notification 46/2026, G.S.R. 227(E): [notified ITR-2](https://www.incometaxindia.gov.in/documents/d/guest/notification-no-46-2026-pdf)
- CBDT Notification 47/2026, G.S.R. 228(E): [notified ITR-3](https://www.incometaxindia.gov.in/documents/d/guest/notification-no-47-2026-pdf)
- [ITR-2 validation rules v1.0](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-05/CBDT__e-Filing_ITR%202_Validation%20Rules_AY%202026-27_V1.0.pdf)
- [ITR-3 validation rules v1.0](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-06/CBDT_e-filing_ITR-3_Validation%20Rules_V1.0_AY%2026-27.pdf)
- Income-tax Act, 1961: [section 70](https://www.incometaxindia.gov.in/w/section-70-55), [section 71](https://www.incometaxindia.gov.in/w/section-71-65), [section 74](https://www.incometaxindia.gov.in/w/section-74-63), [section 111A](https://www.incometaxindia.gov.in/w/section-111a?p_l_back_url=%2Fsearch%3Fq%3DSection%2B271C%26category%3D4216417%26category%3D38263%26sort%3Dmodified-%26delta%3D20%26start%3D32%26category%3D4209131), [section 112](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-112-64), [section 112A](https://www.incometaxindia.gov.in/w/section-112a-60)
- ITAT: [Divya Dinesh v DCIT](https://itat.gov.in/public/files/upload/1772175089-cxFDsX-1-TO.pdf), [India Acorn Fund Ltd v DCIT](https://itat.gov.in/public/files/upload/1717569018-ITA%20No.%204556%20Mum%202023-India%20Acron%20Fund%20Ltd..pdf), [Ishana Capital Master Fund v DCIT](https://itat.gov.in/public/files/upload/1754384126-kHdAmZ-1-TO.pdf)

