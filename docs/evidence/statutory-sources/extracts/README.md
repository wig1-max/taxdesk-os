# Committed statutory text extracts

**Read this before using anything in this directory.**

## Why this exists

The statutory PDFs live at `.sources/statutory/`, which is **gitignored** (~144
MB against a 39 MB `.git`). Until `K4-SOURCE-02` a fresh clone therefore carried
the *manifest* — hashes, URLs, provenance — and **not one word of statute**.

That had three costs, and the third is the one that mattered:

1. Checking a cited provision meant re-retrieving the PDF, which for an ITD
   document costs an **owner action** (`official-source-retrieval.md` §3.1).
2. It then meant re-running the extraction and **re-resolving the same table
   misrenderings that had already been resolved once**, earlier in the project,
   by someone who wrote the answer down only as prose in a code caveat.
3. **Two artifacts cannot be re-retrieved at all.** See below.

The files here are **committed plain text**. After them the cited statutory text
is readable, greppable and diffable from a bare clone with no PDF present.

## These are EVIDENCE, not AUTHORITY

Extracting a source neither verifies a tax treatment
(`PROJECT_CONSTITUTION.md` §2 rule 5) nor moves any pack toward `ca_verified`
(§2 rule 10). Every pack is still truthfully `draft`.

**Never edit a file in this directory.** They are generated. Edit
`scripts/build-statutory-extracts.mjs` and regenerate.

```bash
node scripts/build-statutory-extracts.mjs
```

`npm run check:statutory-extracts` is the gate. It still runs when the PDFs are
absent, which is the fresh-clone case, and explicitly **reports** that the
artifact-backed check could not run. When a PDF is present it hashes the actual
artifact and freshly re-derives every configured page range in all three modes;
a committed block that differs from the artifact fails the gate.

## All three extraction modes are emitted, deliberately

Each file contains the `-layout`, default and `-raw` renderings in full.

**This is not redundancy.** `official-source-retrieval.md` §3.2 and §9.1:
`-layout` preserves prose but **shuffles statutory table rows**, the default mode
splits tables **column-major**, and `-raw` emits content-stream order and pairs
these publishers' table rows correctly. Emitting a single "best" rendering would
throw away the evidence a reader needs to cross-check — and would quietly
re-create the hazard, because **one rendering of a statutory table looks equally
authoritative whether or not its rows are offset**.

The point is not to pick a winner. It is to put all three in front of the next
reader, with the known traps named in each file's header.

## Index

| Extract | Artifact | Statutory world | Backs |
| --- | --- | --- | --- |
| [ay-2026-27/cbdt-notification-44-2017-cii-fy-2001-02-to-2017-18.txt](ay-2026-27/cbdt-notification-44-2017-cii-fy-2001-02-to-2017-18.txt) | `K4-23-S1` | **AY 2026-27 / ITA 1961** | The **principal** CII notification, S.O. 1790(E) — FY 2001-02 (**100**) to FY 2017-18 (**272**) under s.48 Explanation (v). **Its `-layout` extraction misrenders the table** (§3.2): it pairs serial 2 and 3 with the same year and the next year's index, so only `-raw` is pinned |
| [ay-2026-27/cbdt-notification-39-2023-cii-fy-2023-24.txt](ay-2026-27/cbdt-notification-39-2023-cii-fy-2023-24.txt) | `K4-23-S2` | **AY 2026-27 / ITA 1961** | FY 2023-24 Cost Inflation Index **348**, S.O. 2571(E) |
| [ay-2026-27/cbdt-notification-44-2024-cii-fy-2024-25.txt](ay-2026-27/cbdt-notification-44-2024-cii-fy-2024-25.txt) | `K4-23-S3` | **AY 2026-27 / ITA 1961** | FY 2024-25 Cost Inflation Index **363**, S.O. 2103(E) |
| [ay-2026-27/cbdt-notification-70-2025-cii-fy-2025-26.txt](ay-2026-27/cbdt-notification-70-2025-cii-fy-2025-26.txt) | `K4-SOURCE-04-S1` | **AY 2026-27 / ITA 1961** | FY 2025-26 Cost Inflation Index **376** under s.48 Explanation (v). **`K4-23` now uses it**: it is one of four registered notifications behind the s.112 indexed branch; the five for FY 2018-19 to FY 2022-23 **were held by no artifact until `K4-SOURCE-07` registered all five** (the rows immediately below); their engine values nonetheless remain `owner_decided` under `D337` until a session is separately authorized to re-mark them |
| [ay-2026-27/cbdt-notification-26-2018-cii-fy-2018-19.txt](ay-2026-27/cbdt-notification-26-2018-cii-fy-2018-19.txt) | `K4-SOURCE-07-CII-2018` | **AY 2026-27 / ITA 1961** | FY 2018-19 Cost Inflation Index **280**, S.O. 2413(E). **Page 1 is the Hindi page and its English glyphs are DROPPED in all three modes** — the English instrument is on page 2. Its `-layout` table also puts the value on the line ABOVE its own row label, so only `-raw` is pinned per mode. It prints the department in title case, `(Central Board of Direct Taxes)`, where its four siblings use caps |
| [ay-2026-27/cbdt-notification-63-2019-cii-fy-2019-20.txt](ay-2026-27/cbdt-notification-63-2019-cii-fy-2019-20.txt) | `K4-SOURCE-07-CII-2019` | **AY 2026-27 / ITA 1961** | FY 2019-20 Cost Inflation Index **289**, S.O. 3266(E). Amends **S.O. 2413(E)**, not the principal notification, and its own Note calls 2413(E) 'the principal notification'. Prints the assessment year long: **2020-2021** |
| [ay-2026-27/cbdt-notification-32-2020-cii-fy-2020-21.txt](ay-2026-27/cbdt-notification-32-2020-cii-fy-2020-21.txt) | `K4-SOURCE-07-CII-2020` | **AY 2026-27 / ITA 1961** | FY 2020-21 Cost Inflation Index **301**, S.O. 1879(E). The only one of the five that prints **'assessment year' in lower case** — a needle taken from this repository's own notes instead of the document would have asserted a sentence the Gazette does not contain |
| [ay-2026-27/cbdt-notification-73-2021-cii-fy-2021-22.txt](ay-2026-27/cbdt-notification-73-2021-cii-fy-2021-22.txt) | `K4-SOURCE-07-CII-2021` | **AY 2026-27 / ITA 1961** | FY 2021-22 Cost Inflation Index **317**, S.O. 2336(E). **Its English page prints the financial year `2021-2022` while its Hindi page prints `2021-22`** — two pages of one instrument disagreeing on format. Its e-Gazette listing row reads office 'Not Applicable' and subject 'Income Tax', which is one reason an office-filtered search missed it |
| [ay-2026-27/cbdt-notification-62-2022-cii-fy-2022-23.txt](ay-2026-27/cbdt-notification-62-2022-cii-fy-2022-23.txt) | `K4-SOURCE-07-CII-2022` | **AY 2026-27 / ITA 1961** | FY 2022-23 Cost Inflation Index **331**, S.O. 2735(E). Prints its own number with an interior space, **'Notification No. 62 /2022'**. First of this cluster to carry a digital Gazette ID |
| [ay-2026-27/income-tax-rules-1962-rule-21A-21AA-section-89-relief.txt](ay-2026-27/income-tax-rules-1962-rule-21A-21AA-section-89-relief.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 21A + rule 21AA** — the section 89 pair. 21A(2) is the arrears computation; **21AA is what prescribes Form No. 10E**, not 21A. Holding them does NOT make s.89 computable (`D311`) |
| [ay-2026-27/income-tax-rules-1962-rule-3-perquisite-valuation.txt](ay-2026-27/income-tax-rules-1962-rule-3-perquisite-valuation.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 3** — valuation of perquisites. Nothing in this repository values a perquisite. A heading scan places this rule on page 9; it is on page **31** |
| [ay-2026-27/income-tax-rules-1962-rule-2BB-exempt-allowances.txt](ay-2026-27/income-tax-rules-1962-rule-2BB-exempt-allowances.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 2BB** — allowances exempt under s.10(14). **Range ends at page 12, not 9**: sub-rule (3), the s.115BAC restriction, is on page 12, and a short cut would have looked complete while omitting it |
| [ay-2026-27/income-tax-rules-1962-rule-11DD-specified-diseases.txt](ay-2026-27/income-tax-rules-1962-rule-11DD-specified-diseases.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 11DD** — the closed list of s.80DDB diseases. The list IS the deduction; s.80DDB is not computed here |
| [ay-2026-27/income-tax-rules-1962-rule-11A-disability-certification.txt](ay-2026-27/income-tax-rules-1962-rule-11A-disability-certification.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 11A** — s.80DD / s.80U certification. It certifies, it does not quantify |
| [ay-2026-27/income-tax-rules-1962-rule-6DD-cash-payment-exceptions.txt](ay-2026-27/income-tax-rules-1962-rule-6DD-cash-payment-exceptions.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 6DD** — the exceptions to the s.40A(3) cash disallowance. Read with rule 6ABBA, which it cross-references. s.40A(3) is not modelled here |
| [ay-2026-27/income-tax-rules-1962-rule-6ABBA-electronic-modes.txt](ay-2026-27/income-tax-rules-1962-rule-6ABBA-electronic-modes.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 6ABBA** — the prescribed electronic modes. **Already load-bearing for 44AD's digital-turnover split and cited by nothing**; registering the rule does not retro-cite it |
| [ay-2026-27/income-tax-rules-1962-rule-8AA-holding-period.txt](ay-2026-27/income-tax-rules-1962-rule-8AA-holding-period.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 8AA** — holding period in certain cases. It **excepts** the assets covered by Explanation 1 to s.2(42A), which is where gift/inheritance holding periods actually come from — see the brief's reclassification |
| [ay-2026-27/income-tax-rules-1962-rule-6G-tax-audit-report.txt](ay-2026-27/income-tax-rules-1962-rule-6G-tax-audit-report.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 6G** — Forms 3CA/3CB and, at 6G(2), Form 3CD. It supplies the form routing, **not** the s.44AB threshold. `tax_audit` stays unsupported |
| [ay-2026-27/income-tax-rules-1962-rule-12AB-return-furnishing-conditions.txt](ay-2026-27/income-tax-rules-1962-rule-12AB-return-furnishing-conditions.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 12AB** — conditions for MANDATORY RETURN FURNISHING under the seventh proviso to s.139(1). **Its sixty-lakh and ten-lakh figures are NOT audit thresholds** |
| [ay-2026-27/income-tax-rules-1962-rule-21AGA-115BAC-option.txt](ay-2026-27/income-tax-rules-1962-rule-21AGA-115BAC-option.txt) | `K4-SOURCE-07-RULES-1962` | **AY 2026-27 / ITA 1961** | **Rule 21AGA** — the rule that prescribes Form 10-IEA. The engine models no opt-out instrument |
| [ay-2026-27/income-tax-act-1961-2026-vintage-identity.txt](ay-2026-27/income-tax-act-1961-2026-vintage-identity.txt) | `K4-SOURCE-07-ACT-1961` | **AY 2026-27 / ITA 1961** | **s.1 plus the publisher's Finance Act, 2026 printing-convention note** — committed so the artifact's VINTAGE CLAIM is checkable from a bare clone rather than only asserted in the manifest. **The PDF's page 1 is Chapter XIV s.139**, not s.1 |
| [ay-2026-27/income-tax-act-1961-2026-s089-arrears-relief.txt](ay-2026-27/income-tax-act-1961-2026-s089-arrears-relief.txt) | `K4-SOURCE-07-ACT-1961` | **AY 2026-27 / ITA 1961** | **s.89 and s.89A at Finance Act 2026 vintage.** s.89 grants relief 'as may be prescribed' — the delegation to rule 21A, and the reason the section alone never made the relief specifiable. Committed beside `K4-PORT-04-S2`'s FA-2025-vintage text deliberately, so vintages can be compared rather than assumed equal |
| [ay-2026-27/form-10e-section-89-relief.txt](ay-2026-27/form-10e-section-89-relief.txt) | `K4-SOURCE-07-FORM-10E` | **AY 2026-27 / ITA 1961** | **FORM NO. 10E**, whole. Its rubric reads **`[See rule 21AA]`** while its particulars are those 'referred to in rule 21A' — the brief's 'Rule 21A + Form 10E' shorthand elides that. It prescribes a disclosure, not an arithmetic |
| [ay-2026-27/form-3cd-section-44AB-particulars.txt](ay-2026-27/form-3cd-section-44AB-particulars.txt) | `K4-SOURCE-07-FORM-3CD` | **AY 2026-27 / ITA 1961** | **FORM NO. 3CD**, whole (20 pages). Committed for reference only — **generating 3CD is an explicit non-goal** and `tax_audit` stays unsupported. Every clause is in a two-column table, so §3.2 governs throughout |
| [ay-2026-27/form-10-iea-115BAC-option.txt](ay-2026-27/form-10-iea-115BAC-option.txt) | `K4-SOURCE-07-FORM-10-IEA` | **AY 2026-27 / ITA 1961** | **FORM No. 10-IEA**, whole. **One form serves both exercise AND withdrawal** of the s.115BAC(6) option. No regime-election state exists in this repository |
| [ay-2026-27/itr-output/itr-1-schema-change-v1.1.txt](ay-2026-27/itr-output/itr-1-schema-change-v1.1.txt) | `K4-SOURCE-05-ITR1-CHANGES` | **AY 2026-27 / ITA 1961 output layer** | Page 5 only: ITR-1 schema delta from 15 May to 30 June 2026; technical evidence, not law |
| [ay-2026-27/itr-output/itr-1-validation-rules-v1.0-sample.txt](ay-2026-27/itr-output/itr-1-validation-rules-v1.0-sample.txt) | `K4-SOURCE-05-ITR1-VALIDATIONS` | **AY 2026-27 / ITA 1961 output layer** | Pages 4-6 only: defect categories and opening Category A rules; rank-5 portal material, not a tax holding |
| [ay-2026-27/itr-output/itr-4-schema-change-v1.1.txt](ay-2026-27/itr-output/itr-4-schema-change-v1.1.txt) | `K4-SOURCE-05-ITR4-CHANGES` | **AY 2026-27 / ITA 1961 output layer** | Page 5 only: ITR-4 schema delta from 15 May to 30 June 2026; technical evidence, not law |
| [ay-2026-27/itr-output/itr-4-validation-rules-v1.0-sample.txt](ay-2026-27/itr-output/itr-4-validation-rules-v1.0-sample.txt) | `K4-SOURCE-05-ITR4-VALIDATIONS` | **AY 2026-27 / ITA 1961 output layer** | Pages 5-7 only: A/B/D category actions and opening Category A rules; default mode merges the D marker into prose |
| [ay-2026-27/itr-output/itr-2-schema-change-v1.2.txt](ay-2026-27/itr-output/itr-2-schema-change-v1.2.txt) | `K4-SOURCE-05-ITR2-CHANGES` | **AY 2026-27 / ITA 1961 output layer** | Page 5 only: ITR-2 deltas through 13 August 2026, preserving the source spelling `EditAutopoulatedDetail` |
| [ay-2026-27/itr-output/itr-2-validation-rules-v1.0-sample.txt](ay-2026-27/itr-output/itr-2-validation-rules-v1.0-sample.txt) | `K4-SOURCE-05-ITR2-VALIDATIONS` | **AY 2026-27 / ITA 1961 output layer** | Pages 5-7 only: defect categories and opening Category A rules; rank-5 portal material |
| [ay-2026-27/itr-output/itr-3-schema-change-v1.1.txt](ay-2026-27/itr-output/itr-3-schema-change-v1.1.txt) | `K4-SOURCE-05-ITR3-CHANGES` | **AY 2026-27 / ITA 1961 output layer** | Page 5 only: TDSSection enum/description changes in ScheduleTDS2 and ScheduleTDS3 |
| [ay-2026-27/itr-output/itr-3-validation-rules-v1.0-sample.txt](ay-2026-27/itr-output/itr-3-validation-rules-v1.0-sample.txt) | `K4-SOURCE-05-ITR3-VALIDATIONS` | **AY 2026-27 / ITA 1961 output layer** | Pages 3-5 only: defect categories and opening Category A rules, including the exact source line `HUF cannot claim relief u/s 89`; it decides no s.89 question |
| [ay-2026-27/itr-output/notification-45-2026-itr-1-opening.txt](ay-2026-27/itr-output/notification-45-2026-itr-1-opening.txt) | `K4-SOURCE-05-ITR14-NOTIFICATION` | **AY 2026-27 / ITA 1961 notified forms** | Pages 15-16 only: G.S.R. 226(E), Income-tax (Second Amendment) Rules, 2026, and the opening of substituted ITR-1 |
| [ay-2026-27/itr-output/notification-45-2026-itr-4-opening.txt](ay-2026-27/itr-output/notification-45-2026-itr-4-opening.txt) | `K4-SOURCE-05-ITR14-NOTIFICATION` | **AY 2026-27 / ITA 1961 notified forms** | Pages 19-20 only: substitution and opening identity of ITR-4; same hashed notification as the ITR-1 extract |
| [ay-2026-27/itr-output/notification-46-2026-itr-2-opening.txt](ay-2026-27/itr-output/notification-46-2026-itr-2-opening.txt) | `K4-SOURCE-05-ITR2-NOTIFICATION` | **AY 2026-27 / ITA 1961 notified forms** | Pages 38-39 only: G.S.R. 227(E), Income-tax (Third Amendment) Rules, 2026, and substituted ITR-2 opening |
| [ay-2026-27/itr-output/notification-47-2026-itr-3-opening.txt](ay-2026-27/itr-output/notification-47-2026-itr-3-opening.txt) | `K4-SOURCE-05-ITR3-NOTIFICATION` | **AY 2026-27 / ITA 1961 notified forms** | Pages 75-76 only: G.S.R. 228(E), Income-tax (Fourth Amendment) Rules, 2026, and substituted ITR-3 opening |
| [ay-2026-27/itr-output/notification-57-2026-corrigendum-itr-1-itr-4.txt](ay-2026-27/itr-output/notification-57-2026-corrigendum-itr-1-itr-4.txt) | `K4-SOURCE-05-ITR14-CORRIGENDUM` | **AY 2026-27 / ITA 1961 notified forms** | Page 3 only: G.S.R. 262(E) corrections to ITR-1 and ITR-4, including exact `Iva` to `iva` case change |
| [ay-2026-27/itr-output/notification-58-2026-corrigendum-itr-2.txt](ay-2026-27/itr-output/notification-58-2026-corrigendum-itr-2.txt) | `K4-SOURCE-05-ITR2-CORRIGENDUM` | **AY 2026-27 / ITA 1961 notified forms** | Page 2 only: G.S.R. 263(E), nine corrections to ITR-2 |
| [ay-2026-27/itr-output/notification-59-2026-corrigendum-itr-3.txt](ay-2026-27/itr-output/notification-59-2026-corrigendum-itr-3.txt) | `K4-SOURCE-05-ITR3-CORRIGENDUM` | **AY 2026-27 / ITA 1961 notified forms** | Page 2 only: G.S.R. 264(E), three corrections to ITR-3; preserves the source's missing `by`/`with` in clause (ii) |
| [ay-2026-27/finance-act-2026-s2.txt](ay-2026-27/finance-act-2026-s2.txt) | `K4-SOURCE-02-S1` | **AY 2026-27 / ITA 1961** | `cess_rate`, `surcharge_rates` (new regime), `surcharge_marginal_relief` (new regime) |
| [both-worlds/finance-act-2026-first-schedule.txt](both-worlds/finance-act-2026-first-schedule.txt) | `K4-SOURCE-02-S2` | **BOTH** — Part I-A is the 1961 Act, Part I-B the 2025 Act | `surcharge_rates`, `surcharge_marginal_relief` (old regime, Part I-A ¶F); **AND, since `K4-PORT-04`, the TY world's own Part I-B ¶A slab tables (incl. the senior 60-80 and super-senior 80+ bands) and ¶F surcharge + marginal relief** — the "five uncited TY rule groups when slice 2 reaches them" this row used to promise |
| [ay-2026-27/income-tax-rules-1962-rule-12.txt](ay-2026-27/income-tax-rules-1962-rule-12.txt) | `K4-SOURCE-02-S3` | **AY 2026-27 / ITA 1961** | `itr1_income_ceiling` |
| [ay-2026-27/income-tax-rules-1962-new-appendix-I.txt](ay-2026-27/income-tax-rules-1962-new-appendix-I.txt) | `K4-SOURCE-02-S4` | **AY 2026-27 / ITA 1961** | `K4-20` standing-class Section 32(1)(ii) rates (I(1) 5, I(2) 10, I(4) 40, II 10, III(1) 15, III(2)(i) 15, III(3)(ii)(a) 30, III(5) 40, Part B 25) — resolved across the live PDF and all three modes; `-layout` is broken on I(4) and Part B |
| [corroboration-only/finance-bill-2026-as-introduced.txt](corroboration-only/finance-bill-2026-as-introduced.txt) | `K4-SOURCE-02-S5` | BOTH, as *proposed* | **nothing, ever.** A Bill is outside the §5 ladder — corroboration only |
| [ty-2026-27/ita-2025-s002-s003-definitions-and-tax-year.txt](ty-2026-27/ita-2025-s002-s003-definitions-and-tax-year.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `senior_super_senior_age_definition`, `business_books_computation` (s.2(31)/(33)), `capital_loss_brought_forward_set_off` (s.3 "tax year") |
| [ty-2026-27/ita-2025-s019-s022-salary-and-house-property.txt](ty-2026-27/ita-2025-s019-s022-salary-and-house-property.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `standard_deduction`, `house_property_computation` |
| [ty-2026-27/ita-2025-s026-s027-business-income.txt](ty-2026-27/ita-2025-s026-s027-business-income.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `business_books_computation` (s.27) |
| [ty-2026-27/ita-2025-s058-s063-presumptive-and-audit.txt](ty-2026-27/ita-2025-s058-s063-presumptive-and-audit.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `presumptive_44ada_computation`, `presumptive_44ad_computation` |
| [ty-2026-27/ita-2025-s066-part-d-definitions.txt](ty-2026-27/ita-2025-s066-part-d-definitions.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `business_books_computation` (s.66(31)/(33)) |
| [ty-2026-27/ita-2025-s108-s114-set-off-and-carry-forward.txt](ty-2026-27/ita-2025-s108-s114-set-off-and-carry-forward.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `capital_loss_within_year_set_off`, `capital_loss_brought_forward_set_off`, `house_property_computation` (s.109(1)(b)) |
| [ty-2026-27/ita-2025-s126-health-insurance.txt](ty-2026-27/ita-2025-s126-health-insurance.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `senior_80d_deduction_cap`, `senior_80d_parents_deduction_cap` |
| [ty-2026-27/ita-2025-s153-interest-on-deposits.txt](ty-2026-27/ita-2025-s153-interest-on-deposits.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `senior_80tta_80ttb_mutual_exclusivity` |
| [ty-2026-27/ita-2025-s156-rebate.txt](ty-2026-27/ita-2025-s156-rebate.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `rebate_87a`, `rebate_87a_marginal_relief` |
| [ty-2026-27/ita-2025-s157-arrears-relief.txt](ty-2026-27/ita-2025-s157-arrears-relief.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `section_89_arrears_relief` — s.157, the s.89 counterpart. **Citation only; no 2025-Act relief arithmetic exists and none is authorised** |
| [ty-2026-27/ita-2025-s196-s198-special-rate-capital-gains.txt](ty-2026-27/ita-2025-s196-s198-special-rate-capital-gains.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `capital_gains_stcg_111a`, `capital_gains_ltcg_112a` |
| [ty-2026-27/ita-2025-s202-new-regime.txt](ty-2026-27/ita-2025-s202-new-regime.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `slab_rates`, `chapter_via_deduction_caps`, `house_property_computation` (s.202(2)) |
| [ty-2026-27/ita-2025-s403-advance-tax.txt](ty-2026-27/ita-2025-s403-advance-tax.txt) | `K4-PORT-00-S2` | **TY 2026-27 / ITA 2025** | `senior_citizen_advance_tax_exemption_207_2` |
| [ty-2026-27/income-tax-rules-2026-rule-73-section-157-relief.txt](ty-2026-27/income-tax-rules-2026-rule-73-section-157-relief.txt) | `K4-PORT-02-S2` | **TY 2026-27 / ITA 2025** | `section_89_arrears_relief` — rule 73 and its **Form No. 39**, the rule 21A / rule 21AA / Form 10E counterparts. **Rank 2**, a reproduction. Form 39's own layout is NOT held, so `D17` binds |
| [ty-2026-27/income-tax-rules-2026-rule-164.txt](ty-2026-27/income-tax-rules-2026-rule-164.txt) | `K4-PORT-02-S2` | **TY 2026-27 / ITA 2025** | `itr1_income_ceiling` — **rank 2**, a reproduction |
| [ty-2026-27/finance-act-2026-s3.txt](ty-2026-27/finance-act-2026-s3.txt) | `K4-PORT-02-S1` | **TY 2026-27 / ITA 2025** | `slab_rates` (s.3(3) → s.202), `cess_rate` (s.3(15)), `surcharge_rates` (s.3(1)) — **rank 2**, a reproduction; rank-1 corroboration for s.3 is still **owed** |
| [ay-2026-27/income-tax-act-1961-s016-standard-deduction.txt](ay-2026-27/income-tax-act-1961-s016-standard-deduction.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | `standard_deduction` — s.16(ia), including the s.115BAC(1A)(ii) substitution. **Rank 2**; citation only, not verification |
| [ay-2026-27/income-tax-act-1961-s080c-s080cce-deduction-caps.txt](ay-2026-27/income-tax-act-1961-s080c-s080cce-deduction-caps.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | `chapter_via_deduction_caps` — Chapter VI-A opening, s.80C, s.80CCD(1B), s.80CCE. **Rank 2** |
| [ay-2026-27/income-tax-act-1961-s080d-health-insurance.txt](ay-2026-27/income-tax-act-1961-s080d-health-insurance.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | `chapter_via_deduction_caps` — s.80D basic/senior cap text. **Rank 2** |
| [ay-2026-27/income-tax-act-1961-s080g-donations.txt](ay-2026-27/income-tax-act-1961-s080g-donations.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | `chapter_via_deduction_caps` — s.80G category text; the engine still passes 80G through. **Rank 2** |
| [ay-2026-27/income-tax-act-1961-s080tta-s080ttb-deposit-interest.txt](ay-2026-27/income-tax-act-1961-s080tta-s080ttb-deposit-interest.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | `chapter_via_deduction_caps` — s.80TTA / s.80TTB caps and population split. **Rank 2** |
| [ay-2026-27/income-tax-act-1961-s028-s030-business-computation.txt](ay-2026-27/income-tax-act-1961-s028-s030-business-computation.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | `business_books_computation`'s s.29 contrast span — **the one span the consolidated Act made checkable**, and a known false pass before it. **Rank 2**, a consolidation with editorial brackets |
| [ay-2026-27/income-tax-act-1961-s002-capital-asset-and-holding.txt](ay-2026-27/income-tax-act-1961-s002-capital-asset-and-holding.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | `capital_gains_house_sale` — s.2(14) / s.2(42A). **Rank 2** |
| [ay-2026-27/income-tax-act-1961-s045-s050c-capital-gains.txt](ay-2026-27/income-tax-act-1961-s045-s050c-capital-gains.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | `capital_gains_house_sale` — s.45 / s.48 / s.50C. **Rank 2** |
| [ay-2026-27/income-tax-act-1961-s111a-s112-special-rate-capital-gains.txt](ay-2026-27/income-tax-act-1961-s111a-s112-special-rate-capital-gains.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | `capital_gains_house_sale` — s.111A (not a house) / s.112 rate. **Rank 2** |
| [ay-2026-27/income-tax-act-1961-s055-cost-of-acquisition.txt](ay-2026-27/income-tax-act-1961-s055-cost-of-acquisition.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | Pages 276-279: s.55 pre-2001 optional FMV basis and s.112A grandfathering cost basis. **Rank 2**; no FMV figure is prescribed by notification |
| [ay-2026-27/income-tax-act-1961-s112a-listed-equity-ltcg.txt](ay-2026-27/income-tax-act-1961-s112a-listed-equity-ltcg.txt) | `K4-PORT-04-S2` | **AY 2026-27 / ITA 1961** | Pages 436-437: s.112A scope and current threshold/rate wording. **Rank 2**; retrieval decides no treatment |
| [both-worlds/finance-act-2026-gazette-chapter-ii.txt](both-worlds/finance-act-2026-gazette-chapter-ii.txt) | `K4-PORT-04-S1` | **BOTH** — s.2 is the 1961 Act, s.3 the 2025 Act | **nothing yet.** THE GAZETTE's own text of both charging sections, incl. s.2(6) and s.3(15) cess and s.3(3). Committed ahead of the re-citation |
| [both-worlds/finance-act-2026-gazette-first-schedule-part-i.txt](both-worlds/finance-act-2026-gazette-first-schedule-part-i.txt) | `K4-PORT-04-S1` | **BOTH** — Part I-A is the 1961 Act, Part I-B the 2025 Act | **nothing yet.** THE GAZETTE's own Part I, both halves. **Its Part I-B amounts are HARDER to quote than the ITD copy's** — see the hazard note below |
| [both-worlds/finance-act-2026-gazette-first-schedule-part-iii.txt](both-worlds/finance-act-2026-gazette-first-schedule-part-iii.txt) | `K4-PORT-04-S1` | **TY 2026-27 / ITA 2025** (Part III serves the 2025 Act throughout) | **nothing yet.** The Gazette's wording of the Chapter XIII exclusion `K4-PORT-04` cited from the ITD copy as rank-1 corroboration |
| [historical-ay-1961/finance-act-2014-interim-s2-charging.txt](historical-ay-1961/finance-act-2014-interim-s2-charging.txt) | `K4-SOURCE-08-FA2014-INTERIM` | **AY 2014-15 / ITA 1961** — s.89 lookback | Finance Act, 2014 (**11 of 2014**), the **INTERIM** Act **section 2** — long title *"An Act to **continue** the existing rates"*. It enacts **NO rates**: s.2 applies the **Finance Act, 2013**'s s.2 and First Schedule to the year commencing 1 April 2014 with enumerated modifications, and it was superseded for that AY by the **Finance (No. 2) Act, 2014**. **"THE FIRST SCHEDULE" occurs ZERO times** — scanned, not assumed, which settles that it has **no Schedule OF ITS OWN and nothing more**. ***IT DOES ENACT RATES: page 3 opens a `"PART I` / `INCOME-TAX` block that is the text s.2 SUBSTITUTES into the Finance Act, 2013 Schedule ("for Part I, the following Part I shall be substituted") — operative law, not a quotation.*** Its AY 2014-15 Paragraph A table was compared against F(No. 2)A 2014 and is **identical**. **The Finance Act, 2013 it incorporates is NOT HELD.** **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-no-2-act-2014-s2-charging.txt](historical-ay-1961/finance-no-2-act-2014-s2-charging.txt) | `K4-SOURCE-08-FA2014-NO2` | **AY 2014-15 / ITA 1961** — s.89 lookback | Finance (No. 2) Act, 2014 (**25 of 2014**) **section 2** — the charging words binding Part I of its First Schedule to **AY 2014-15** (previous year **2013-14**); this Act **superseded the interim Finance Act, 2014**. **Which of the 2014 pair carries the rates was established by reading each Act's own s.2**, never by analogy with the 2019 and 2024 pairs. **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-no-2-act-2014-first-schedule.txt](historical-ay-1961/finance-no-2-act-2014-first-schedule.txt) | `K4-SOURCE-08-FA2014-NO2` | **AY 2014-15 / ITA 1961** — s.89 lookback | Finance (No. 2) Act, 2014 (**25 of 2014**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2014-15** rates (basic exemption **₹2,00,000**, the earliest year this corpus reaches); **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. The masthead spells the Saka month **SHRAVANA** and the dateline below it **Sravana** — one document, two spellings. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2015-s2-charging.txt](historical-ay-1961/finance-act-2015-s2-charging.txt) | `K4-SOURCE-06-FA2015` | **AY 2015-16 / ITA 1961** — s.89 lookback | Finance Act, 2015 (**20 of 2015**) **section 2** — the charging words binding Part I of its First Schedule to **AY 2015-16** (previous year **2014-15**). **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-act-2015-first-schedule.txt](historical-ay-1961/finance-act-2015-first-schedule.txt) | `K4-SOURCE-06-FA2015` | **AY 2015-16 / ITA 1961** — s.89 lookback | Finance Act, 2015 (**20 of 2015**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2015-16** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2016-s2-charging.txt](historical-ay-1961/finance-act-2016-s2-charging.txt) | `K4-SOURCE-06-FA2016` | **AY 2016-17 / ITA 1961** — s.89 lookback | Finance Act, 2016 (**28 of 2016**) **section 2** — the charging words binding Part I of its First Schedule to **AY 2016-17** (previous year **2015-16**). **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-act-2016-first-schedule.txt](historical-ay-1961/finance-act-2016-first-schedule.txt) | `K4-SOURCE-06-FA2016` | **AY 2016-17 / ITA 1961** — s.89 lookback | Finance Act, 2016 (**28 of 2016**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2016-17** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2017-s2-charging.txt](historical-ay-1961/finance-act-2017-s2-charging.txt) | `K4-SOURCE-06-FA2017` | **AY 2017-18 / ITA 1961** — s.89 lookback | Finance Act, 2017 (**7 of 2017**) **section 2** — the charging words binding Part I of its First Schedule to **AY 2017-18** (previous year **2016-17**). **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-act-2017-first-schedule.txt](historical-ay-1961/finance-act-2017-first-schedule.txt) | `K4-SOURCE-06-FA2017` | **AY 2017-18 / ITA 1961** — s.89 lookback | Finance Act, 2017 (**7 of 2017**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2017-18** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2018-s2-charging.txt](historical-ay-1961/finance-act-2018-s2-charging.txt) | `K4-SOURCE-06-FA2018` | **AY 2018-19 / ITA 1961** — s.89 lookback | Finance Act, 2018 (**13 of 2018**) **section 2** — the charging words binding Part I of its First Schedule to **AY 2018-19** (previous year **2017-18**). **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-act-2018-first-schedule.txt](historical-ay-1961/finance-act-2018-first-schedule.txt) | `K4-SOURCE-06-FA2018` | **AY 2018-19 / ITA 1961** — s.89 lookback | Finance Act, 2018 (**13 of 2018**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2018-19** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2019-interim-s2-charging.txt](historical-ay-1961/finance-act-2019-interim-s2-charging.txt) | `K4-SOURCE-06-FA2019-INTERIM` | **AY 2019-20 / ITA 1961** — s.89 lookback | Finance Act, 2019 (**7 of 2019**), the INTERIM Act **section 2** — it enacts **NO rates**: it applies the **Finance Act, 2018**'s s.2 and First Schedule to **AY 2019-20** (previous year **2018-19**) with enumerated modifications, and was superseded for that AY by the **Finance (No. 2) Act, 2019**. **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-no-2-act-2019-s2-charging.txt](historical-ay-1961/finance-no-2-act-2019-s2-charging.txt) | `K4-SOURCE-06-FA2019-NO2` | **AY 2019-20 / ITA 1961** — s.89 lookback | Finance (No. 2) Act, 2019 (**23 of 2019**) **section 2** — the charging words for **AY 2019-20** (previous year **2018-19**); this Act **superseded the Finance Act, 2019** for that AY. **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-no-2-act-2019-first-schedule.txt](historical-ay-1961/finance-no-2-act-2019-first-schedule.txt) | `K4-SOURCE-06-FA2019-NO2` | **AY 2019-20 / ITA 1961** — s.89 lookback | Finance (No. 2) Act, 2019 (**23 of 2019**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2019-20** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2020-s2-charging.txt](historical-ay-1961/finance-act-2020-s2-charging.txt) | `K4-SOURCE-06-FA2020` | **AY 2020-21 / ITA 1961** — s.89 lookback | Finance Act, 2020 (**12 of 2020**) **section 2** — the charging words binding Part I of its First Schedule to **AY 2020-21** (previous year **2019-20**). **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-act-2020-first-schedule.txt](historical-ay-1961/finance-act-2020-first-schedule.txt) | `K4-SOURCE-06-FA2020` | **AY 2020-21 / ITA 1961** — s.89 lookback | Finance Act, 2020 (**12 of 2020**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2020-21** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2021-s2-charging.txt](historical-ay-1961/finance-act-2021-s2-charging.txt) | `K4-SOURCE-06-FA2021` | **AY 2021-22 / ITA 1961** — s.89 lookback | Finance Act, 2021 (**13 of 2021**) **section 2** — the charging words binding Part I of its First Schedule to **AY 2021-22** (previous year **2020-21**). **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-act-2021-first-schedule.txt](historical-ay-1961/finance-act-2021-first-schedule.txt) | `K4-SOURCE-06-FA2021` | **AY 2021-22 / ITA 1961** — s.89 lookback | Finance Act, 2021 (**13 of 2021**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2021-22** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2022-s2-charging.txt](historical-ay-1961/finance-act-2022-s2-charging.txt) | `K4-SOURCE-06-FA2022` | **AY 2022-23 / ITA 1961** — s.89 lookback | Finance Act, 2022 (**6 of 2022**) **section 2** — the charging words binding Part I of its First Schedule to **AY 2022-23** (previous year **2021-22**). **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-act-2022-first-schedule.txt](historical-ay-1961/finance-act-2022-first-schedule.txt) | `K4-SOURCE-06-FA2022` | **AY 2022-23 / ITA 1961** — s.89 lookback | Finance Act, 2022 (**6 of 2022**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2022-23** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2023-s2-charging.txt](historical-ay-1961/finance-act-2023-s2-charging.txt) | `K4-SOURCE-06-FA2023` | **AY 2023-24 / ITA 1961** — s.89 lookback | Finance Act, 2023 (**8 of 2023**) **section 2** — the charging words binding Part I of its First Schedule to **AY 2023-24** (previous year **2022-23**). **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-act-2023-first-schedule.txt](historical-ay-1961/finance-act-2023-first-schedule.txt) | `K4-SOURCE-06-FA2023` | **AY 2023-24 / ITA 1961** — s.89 lookback | Finance Act, 2023 (**8 of 2023**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2023-24** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2024-interim-s2-charging.txt](historical-ay-1961/finance-act-2024-interim-s2-charging.txt) | `K4-SOURCE-06-FA2024-INTERIM` | **AY 2024-25 / ITA 1961** — s.89 lookback | Finance Act, 2024 (**8 of 2024**), the INTERIM Act **section 2** — it enacts **NO rates**: it applies the **Finance Act, 2023**'s s.2 and First Schedule to **AY 2024-25** (previous year **2023-24**) with enumerated modifications, and was superseded for that AY by the **Finance (No. 2) Act, 2024**. **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-no-2-act-2024-s2-charging.txt](historical-ay-1961/finance-no-2-act-2024-s2-charging.txt) | `K4-SOURCE-06-FA2024-NO2` | **AY 2024-25 / ITA 1961** — s.89 lookback | Finance (No. 2) Act, 2024 (**15 of 2024**) **section 2** — the charging words for **AY 2024-25** (previous year **2023-24**); this Act **superseded the Finance Act, 2024** for that AY. **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-no-2-act-2024-first-schedule.txt](historical-ay-1961/finance-no-2-act-2024-first-schedule.txt) | `K4-SOURCE-06-FA2024-NO2` | **AY 2024-25 / ITA 1961** — s.89 lookback | Finance (No. 2) Act, 2024 (**15 of 2024**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2024-25** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2025-s2-charging.txt](historical-ay-1961/finance-act-2025-s2-charging.txt) | `K4-SOURCE-06-FA2025` | **AY 2025-26 / ITA 1961** — s.89 lookback | Finance Act, 2025 (**7 of 2025**) **section 2** — the charging words binding Part I of its First Schedule to **AY 2025-26** (previous year **2024-25**). **Rank 1, Gazette as enacted** |
| [historical-ay-1961/finance-act-2025-first-schedule.txt](historical-ay-1961/finance-act-2025-first-schedule.txt) | `K4-SOURCE-06-FA2025` | **AY 2025-26 / ITA 1961** — s.89 lookback | Finance Act, 2025 (**7 of 2025**) **First Schedule, complete (Parts I-IV)** — **Part I** carries the **AY 2025-26** rates; **Part III of the same Schedule serves the FOLLOWING AY**, so name the Part in every citation. **Rank 1, Gazette as enacted**; retrieval only, nothing implemented |
| [historical-ay-1961/finance-act-2016-s87A-rebate.txt](historical-ay-1961/finance-act-2016-s87A-rebate.txt) | `K4-SOURCE-06-FA2016` | **AY 2017-18 onward / ITA 1961** — s.89 lookback | Finance Act, 2016 (**28 of 2016**) **section 46** — s.87A maximum rebate **₹2,000 → ₹5,000** w.e.f. 1 April 2017. **It moves the CEILING only**; the ₹5,00,000 income limit is untouched and unmentioned. **Rank 1, Gazette as enacted**; retrieval only |
| [historical-ay-1961/finance-act-2017-s87A-rebate.txt](historical-ay-1961/finance-act-2017-s87A-rebate.txt) | `K4-SOURCE-06-FA2017` | **AY 2018-19 onward / ITA 1961** — s.89 lookback | Finance Act, 2017 (**7 of 2017**) **section 38** — s.87A limit **₹5,00,000 → ₹3,50,000** and rebate **₹5,000 → ₹2,500** w.e.f. 1 April 2018. **BOTH FIGURES MOVE DOWN** — the only amendment in the chain that does. **Rank 1, Gazette as enacted**; retrieval only |
| [historical-ay-1961/finance-act-2018-s112A-rebate-and-special-rate-interaction.txt](historical-ay-1961/finance-act-2018-s112A-rebate-and-special-rate-interaction.txt) | `K4-SOURCE-06-FA2018` | **AY 2019-20 onward / ITA 1961** — s.89 lookback | Finance Act, 2018 (**13 of 2018**) **section 33** — inserts **s.112A**, and with it **s.112A(6)**: the s.87A rebate is allowed on income-tax **as reduced by the tax on such capital gains**. **This is the statutory half of the special-rate-income question** — two years with the same total income and different composition carry different tax. **NOT an s.87A amendment**; s.112A is modelled for no historical year. **Rank 1**; retrieval only |
| [historical-ay-1961/finance-act-2019-interim-s87A-rebate.txt](historical-ay-1961/finance-act-2019-interim-s87A-rebate.txt) | `K4-SOURCE-06-FA2019-INTERIM` | **AY 2020-21 onward / ITA 1961** — s.89 lookback | Finance Act, 2019 (**7 of 2019**), the **INTERIM** Act, **section 8** — s.87A limit **→ ₹5,00,000** and rebate **→ ₹12,500** w.e.f. 1 April 2020. **THE OTHER FACE OF THE INTERIM-ACT TRAP**: the interim Acts enact no *rates*, but they do carry *substantive amendments*, and the **Finance (No. 2) Act, 2019 does not touch s.87A at all**. Page 9 sits **outside** this Act's s.2 extract. **Rank 1**; retrieval only |
| [historical-ay-1961/finance-act-2020-s115BAC-as-inserted.txt](historical-ay-1961/finance-act-2020-s115BAC-as-inserted.txt) | `K4-SOURCE-06-FA2020` | **AY 2021-22 onward / ITA 1961** — s.89 lookback | Finance Act, 2020 (**12 of 2020**) **section 53** — inserts **s.115BAC with its rate TABLE**, the new-regime slabs for **AY 2021-22, 2022-23 and 2023-24**, **OPTIONAL** ("at the option of such person"). ***ITS `-layout` RENDERING IS WRONG BY ONE ROW*** — it pairs ₹2,50,001-₹5,00,000 with **10 per cent.** when the enacted rate is **5**, offsetting every band below. **Pinned in `-raw` only.** Sharpest reading hazard in the s.89 corpus. **Rank 1**; retrieval only |
| [historical-ay-1961/finance-act-2023-s87A-new-regime-proviso.txt](historical-ay-1961/finance-act-2023-s87A-new-regime-proviso.txt) | `K4-SOURCE-06-FA2023` | **AY 2024-25 onward / ITA 1961** — s.89 lookback | Finance Act, 2023 (**8 of 2023**) **section 44** — inserts the s.87A proviso for income chargeable under **s.115BAC(1A)**: **₹7,00,000 / ₹25,000**, with the **rebate-threshold marginal-relief limb (b)**. This is the historical origin of the relief `K4-12` implemented for AY 2026-27 — the **REBATE** marginal relief, never the surcharge one. **NEW-REGIME ONLY**: the old regime keeps its own ₹5,00,000 / ₹12,500. **Rank 1**; retrieval only |
| [historical-ay-1961/finance-act-2023-s115BAC-1A-inserted.txt](historical-ay-1961/finance-act-2023-s115BAC-1A-inserted.txt) | `K4-SOURCE-06-FA2023` | **AY 2024-25 onward / ITA 1961** — s.89 lookback | Finance Act, 2023 (**8 of 2023**) **section 52** — confines s.115BAC(**1**) to years "before the 1st day of April, 2024" and **inserts s.115BAC(1A)** with the AY 2024-25 table. ***THE DEFAULT FLIPS HERE***: (1) was optional, (1A) applies unless an option is exercised under sub-section (6). This is the statutory fact behind the **Form 10E portal-behaviour question**, which this extract does **not** resolve. **Rank 1**; retrieval only |
| [historical-ay-1961/finance-no-2-act-2024-s115BAC-1A-substituted.txt](historical-ay-1961/finance-no-2-act-2024-s115BAC-1A-substituted.txt) | `K4-SOURCE-06-FA2024-NO2` | **AY 2025-26 onward / ITA 1961** — s.89 lookback | Finance (No. 2) Act, 2024 (**15 of 2024**) **section 37** — **substitutes** s.115BAC(1A) into limb **(i)** (AY 2024-25, restated verbatim) and limb **(ii)** (AY 2025-26 onward). **The restatement is a free corroboration** — two Gazette artifacts state the AY 2024-25 bands and they agree. Limb (ii)'s "on or after" was later **narrowed** by FA 2025 s.25(a). **Rank 1**; retrieval only |
| [historical-ay-1961/finance-act-2025-s87A-rebate.txt](historical-ay-1961/finance-act-2025-s87A-rebate.txt) | `K4-SOURCE-06-FA2025` | **AY 2026-27 / ITA 1961** — s.89 chain | Finance Act, 2025 (**7 of 2025**) **section 20** — new-regime rebate **→ ₹12,00,000 / ₹60,000**, plus a **SECOND proviso** capping the deduction at the tax payable **at s.115BAC(1A) slab rates** — the special-rate interaction stated in the statute, which did **not** exist for AY 2024-25 or AY 2025-26. Current-year Act; held so the chain reads end to end. **Rank 1**; retrieval only |
| [historical-ay-1961/finance-act-2025-s115BAC-1A-ay-2026-27.txt](historical-ay-1961/finance-act-2025-s115BAC-1A-ay-2026-27.txt) | `K4-SOURCE-06-FA2025` | **AY 2026-27 / ITA 1961** — s.89 chain | Finance Act, 2025 (**7 of 2025**) **section 25** — inserts limb **(iii)**, the AY 2026-27 table (4/8/12/16/20/24 lakh), **and omits "or after" from limb (ii)**. **The two-word deletion is as load-bearing as the new table**: without it the AY 2025-26 bands would run forward. Spans a page break mid-sentence. **Rank 1**; retrieval only |

### `K4-PORT-02-S1` NOW HAS AN EXTRACT, AND WHY IT DID NOT IS THE POINT

This README and the builder both used to record ICAI's Income-tax Act 2025
edition as deliberately unextracted, because **not one caveat span was quoted
from it**. That was true and is corrected forward, not rewritten
(`PROJECT_CONSTITUTION.md` §4).

`K4-PORT-04` quotes **Finance Act, 2026 section 3**, the charging section for tax
year 2026-27 — and s.3 exists in **no other artifact this repository holds**:

- `K4-SOURCE-02-S1` is the ITD's copy of **section 2**, the *1961*-Act half;
- `K4-SOURCE-02-S2` is the First Schedule **without any of the sections**;
- ICAI's edition reproduces the Finance Act's 2025-Act half and **omits** s.2,
  Part I-A and Chapter III Part A behind its own `* * *` marker.

So the moment a caveat quotes s.3, this artifact stops being
identity-corroboration prose and becomes the only evidence base for a declared
quotation. **Extracting a reproduction does not promote it**: it stays rank 2,
every citation resting on it says so, and rank-1 corroboration is a bounded owner
task (`incometaxindia.gov.in/finance-acts` serves the Act per section under the
save-dialog handoff — the same route that produced `K4-SOURCE-02-S1`).

### The Gazette arrived, and the highest-ranked source is the HARDEST to quote

`K4-PORT-04-S1` is **the Finance Act, 2026 as published in the Gazette of India**
(No. 4 of 2026, assented 30 March 2026) — owner-supplied on 2026-08-17, the same
day this session recorded rank-1 corroboration for section 3 as *owed*. It is the
**only** artifact in the register that is the Gazette itself: every other Finance
Act 2026 document here is an ITD departmental publication (rank 1, but disclosing
"NOT the Gazette") or ICAI's reproduction (rank 2).

**No pack cites it yet, and that is deliberate.** Retiring the "NOT the Gazette"
disclaimers means editing caveats in the **live** AY 2026-27 pack — text rendered
to preparers — and inverting a `parallel-worlds` assertion that currently
*requires* that disclaimer on every `K4-SOURCE-02` citation. That is a contract
change and it gets its own session. The extracts are committed now so the evidence
is readable from a bare clone when it happens, and because leaving a held document
recorded as "owed" is the exact `D300` failure this register exists to prevent.

**THE FINDING THAT WILL SURPRISE THE RE-CITATION SESSION: the rupee glyph does not
survive extraction from the Gazette's Part I-B.** The Gazette prints the 2025-Act
amounts with the rupee sign, and `pdftotext` drops it in all three modes, so the
text reads `exceed  250000` and ` 12500 plus 20%` with a leading blank. The ITD
copy prints the same amounts as `Rs. 250000` and extracts cleanly.

**So for a quotable Part I-B span the LOWER-ranked ITD copy is BETTER evidence
than the Gazette.** Authority and quotability come apart here, which nothing in
this system anticipated. Decide it **per span**, and where the ITD copy is kept,
say why in the citation. Part I-A is unaffected — it prints `Rs. 2,50,000`.

Two smaller notes on the same artifact: `-layout` folds the marginal notes into
the text column, so s.3(1)'s charging words are not contiguous in that mode (the
default and `-raw` modes carry them); and seven bytes in 122 pages are non-UTF8
(the Devanagari masthead and the rupee glyphs) and decode to replacement
characters, leaving the English statutory text clean.


### The consolidated Income-tax Act, 1961 arrived — and closed ONE span, not 43

`K4-PORT-04-S2` is the **consolidated Income-tax Act, 1961 as amended by Finance
Act 2025** (916 pages, s.1 to s.298 plus the Second to Fourteenth Schedules),
owner-supplied on 2026-08-17. It closes **`AUDIT-10-F4`'s headline item**, which
had stood since `AUDIT-10`: *the consolidated Act as amended, by any route
tested*.

**AND REGISTERING IT FALSIFIED THE CLAIM THAT MADE IT SOUND IMPORTANT.** This
README, the project status notes and `verbatim-quotes.test.ts` all described the 43
`QUOTE_SOURCE_NOT_REGISTERED` spans as *"headed by the consolidated Income-tax
Act, 1961, still unretrieved"*. Measured on registration:

- the 1961 Act accounts for **exactly one** of the 43 — the s.29 range
  (`"in accordance with the provisions contained in sections 30 to 43D"`) that
  the TY pack quotes **for contrast** with the 2025 Act's s.27;
- the other **42** quote ITD help pages, e-filing portal prose and secondary
  tax-law publishers — *"Up to Rs. 50 lakhs"*, *"file return in the ITR-4 form
  (Sugam)"*, *"optimal approach"*, *"this is only a guideline"*.

**No artifact will ever make those 42 checkable, because they are not quotations
of statute.** Closing them means re-declaring them `QUOTE_NOT_STATUTORY_TEXT` or
taking them out of the caveats — **editorial work, not retrieval work**. That is
the honest description of the gap, and it is a different and smaller thing than
"we are missing the Act".

**The one span it did close was a KNOWN LIVE FALSE PASS.** `MAINT-03` (`D308`)
found it matching off a **reading note** in an extract — this repository's own
prose explaining why the 1961 text was absent — which is one of the two false
passes that made `extractedStatuteOnly` read only the `pdftotext` blocks. It is
now checked against statute.

**Two limits, both recorded in the manifest and neither cosmetic.** (1) It is a
**consolidation, rank 2**: no imprint, no title page, no Gazette masthead, and
its publisher is *inferred* from the annotation style rather than established.
(2) Its **editorial brackets sit inside the quoted words** throughout, which is
the `QUOTE_ANNOTATION_STRIPPED` hazard — s.29 happens to carry no amendment
marker, which is why that span moves and nothing else does. And a **vintage**
limit: amended to Finance Act **2025** only, verified by *"Finance Act, 2026"*
occurring zero times. Finance Act 2026's amendments to the 1961 Act are in
`K4-PORT-04-S1`'s Chapter II-VI range, which is **not** extracted.

### One artifact, twelve files: page ranges, not the whole Act (`MAINT-03`)

The enacted Income-tax Act, 2025 is **666 pages and ~1.9 MB per extraction
mode** — ~5.9 MB of text for all three, nearly all of it about provisions this
repository does not implement. So it is committed as **one file per provision
group a pack caveat actually quotes**, at that group's page range.

**That is not only a size decision; it makes the check stronger.** A span found
somewhere in a 666-page Act is weak evidence. The same span found in the ten
pages of the provision the caveat cites is much better evidence. Narrowing the
haystack narrows what a false pass can hide in.

The corollary is a real limit, stated rather than discovered later: **a quote
from a provision outside these ranges has no extract to be checked against, and
`verbatim-quotes.test.ts` FAILS it rather than skipping it.** The fix is to add
the range to `scripts/build-statutory-extracts.mjs` — never to widen the matcher,
and never to move the span to `unverifiableQuotes`.

Sections the packs CITE but never QUOTE are deliberately absent (sections 92 and
93, for instance). Coverage is driven by the quotations, not by the citation list.

### The reading notes in these files are NOT evidence

Every extract is a project-authored header, hand-written reading notes, and then
the three `pdftotext` renderings. **Only the renderings count.** The notes quote
statute — a note has to be able to say *the Act says "or", lower-case* — so
searching the whole file would let this repository verify a quotation against its
own prose. Both guards (`verbatim-quotes.test.ts` and
`check-statutory-extracts.mjs`) read only between `BEGIN pdftotext` and
`END pdftotext`, and a file with no such block contributes nothing rather than
its header. Two live false passes were caught by that change the day it was made.

### The directory names are load-bearing

`ay-2026-27/` is the **Income-tax Act, 1961** world. `ty-2026-27/` is the
**Income-tax Act, 2025** world. `both-worlds/` is a single physical document that
serves **two** statutory worlds and must have its **Part** named on every
citation. `corroboration-only/` is material that **may never be cited as law**.

`D301` found the 1961/2025 conflation live in three continuity files at once, and
`K4-SOURCE-02` added a `parallel-worlds` guard that fails the build if the AY
pack cites Part I-B or the TY pack cites Part I-A. The directory layout is the
same rule expressed where a human browsing the tree will trip over it.

## Two documents whose extract carries a hard warning

**`new-appendix-I`** — **not one rate in it has been read, resolved, quoted or
relied on.** It was registered and extracted; that is all. *Unblocked is not
implemented.* Its `-layout` rendering is already visibly broken on the first
table. Anyone implementing Section 32 depreciation must resolve every rate across
all three modes before quoting any of them.

**`finance-bill-2026`** — a **Bill is not an Act**. Its only legitimate use is
comparing it against the enacted text to see what moved, which §4 warns is
exactly where numbering and text shift.

## Recoverability

`check:statutory-extracts` enumerates this on **every run**, and the numbers
below are the ones it prints. If this section and that output ever disagree,
**believe the tool and fix this document** — a register and a manifest drifting
apart on exactly this field is what hid the CBDT FAQ's URL until `K4-SOURCE-02`
went looking.

An artifact is recoverable if **any** of three things is true:

| Route | Count | Which |
| --- | --- | --- |
| **Fetchable `https` URL** | 29 | the prior eight URL-backed artifacts (`K4-SOURCE-02-S1` through `S4`, `K4-PORT-00-S2`, `OPS-14-S2`, `K4-PORT-04-S1`, `K4-SOURCE-04-S1`); three older CII notifications; and 18 AY 2026-27 ITR output-layer/Gazette artifacts |
| **Committed text, here** | 28 | `K4-SOURCE-02-S1` through `S5` (5); `K4-PORT-00-S2`, `K4-PORT-02-S1`/`S2`, and `K4-PORT-04-S1`/`S2` (5); four CII artifacts; and 14 `K4-SOURCE-05` artifacts (all 18 except the four raw JSON schemas) have one or more committed extracts — **for the configured page ranges only** where the source is not already per-provision |
| **Owner backup, off-repository** | 3 | the two ICAI editions and the held consolidated Income-tax Act, 1961 |

`MAINT-03` moved `K4-PORT-00-S2` and `K4-PORT-02-S2` into the second row. Read
that as **partial** preservation: the committed pages survive a lost
`.sources/`; the rest of those two documents does not, and for the ICAI edition
the owner backup is what covers the remainder.

### The ICAI editions are backed up, and that is recorded as a field

**Owner-confirmed on 2026-08-15: both ICAI editions are held on a local hard
drive and in cloud storage, and can be re-supplied on request.** Their manifest
`url` is a description rather than a fetchable address, so this is what closes
their gap.

It lives in the manifest as **`"ownerBackup": true`**, not as prose, and the
reason is worth keeping: **a mitigation only a human can see is one the next
session re-raises as a risk.** The recoverability report is what a future session
actually reads, so the fact has to live where the report can reach it.

**It does not change their RANK.** They remain rank-2 reproductions, and a
load-bearing quote still needs corroboration against rank-1 material. Backup is
about *survival*, not *authority*.

Their full text is still not committed, deliberately: ~53,000 and ~30,000 lines,
the great majority irrelevant to anything this repository computes. Since
`MAINT-03`, **rule 164 of ICAI's Rules 2026 IS committed** (pages 225-229) because
the TY pack quotes it; extracting it does **not** promote it, and the citation
still discloses rank 2.

**`K4-PORT-02-S1` — ICAI's Income-tax Act 2025 edition — has NO extract, and
that is a measured finding rather than an omission: not one caveat span in
either pack is quoted from it.** Its Finance Act 2026 appendix earns its keep by
corroborating the *identity* of `K4-SOURCE-02-S2` (see that file's notes), which
is prose in this repository, not a declared quotation. Extracting it would move
zero spans and is not scheduled.

### One artifact remains recoverable by no route, and it does not matter

The **Budget speech** (`K4-SOURCE-02-S6`) has no URL, no extract and no recorded
backup. It is **not law**, is cited by nothing, and may never be cited for any
figure — losing it costs nothing. It is named here so the tool's count and this
document's count cannot be read as disagreeing.
