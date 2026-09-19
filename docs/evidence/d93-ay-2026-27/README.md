# `D93` evidence package — capital-loss set-off ordering, AY 2026-27

**Vendored by `TAX-SAFE-02` (2026-08-01).** These files are an **externally
supplied research package**, delivered from a bounded research task
run outside this repository on **2026-07-31**. They are preserved here verbatim
so that the `D93` decision, the pack rule's caveat, and the `K4-10` release gate
cite something durable rather than a path on someone's desktop.

| File | Source package | What it is |
| --- | --- | --- |
| `D93-decision-memo.md` | 2026-07-31 | The research memo and its conclusions. |
| `D93-evidence-manifest.json` | 2026-07-31 | Artifact versions, URLs, SHA256 hashes, retrieval date, stated limits. |
| `D93-synthetic-test-matrix.csv` | 2026-07-31 | 11 synthetic conformance cases (`D93-01`…`D93-11`), inputs and expected figures. |
| `D93-synthetic-results.json` | 2026-07-31 | The same cases as a structured result record. |
| `evidence-manifest.json` | 2026-08-01 | The verification package's own manifest: the five official artifacts it retrieved, their URLs, sizes, expected-vs-actual SHA256, and its stated reliance limits. Added by `TAX-SAFE-02A`. |

**These files are byte-exact.** `.gitattributes` marks this directory `-text`, so
the artifacts round-trip through Git without line-ending conversion and their
SHA256 can be recomputed from a fresh checkout. `TAX-SAFE-02` vendored them under
the repository-wide `* text=auto` rule, which normalised `D93-decision-memo.md`
and `D93-evidence-manifest.json` on commit and restored them as CRLF on checkout;
they no longer hashed to their source. `TAX-SAFE-02A` added the `-text` rule and
restored all four from the original package before recording anything below.

The five **official** artifacts (the ITR-2 v1.2 workbook, both JSON schemas, both
validation-rule PDFs — 13 MB, including a macro-enabled workbook) are **not**
vendored. They are identified by URL, version, size and SHA256 in
`evidence-manifest.json`, which is enough to re-retrieve and re-verify them.

## Evidence status — read this before citing any of it

This package is **not uniform in reliability**, and the distinction is
load-bearing. `TAX-SAFE-02` recorded it in three layers:

1. **Statutory eligibility and the eight-year ceiling** — sections 70(2)/(3),
   71(3), 74(1)(a)/(b), 74(2). These were **already independently sourced and
   corroborated by this repository** in `K4-09` (**D94**): ClearTax directly
   retrieved, corroborated by `incometaxmanagement.in` and `aubsp.com` quoting
   the bare section text. This package agrees with that sourcing. Safe to record
   as established.
2. **The Section 112A threshold-timing conclusion** (the threshold applies to
   Section 112A income *surviving* capital-loss set-off, not to the gross
   Schedule 112A gain) — recorded as **supported by the supplied official-utility
   analysis**. `TAX-SAFE-02` did **not** independently reproduce the workbook
   trace. See the limits below.
3. **The workbook macro trace and the exact portal-default bucket sequence**
   (`CG_Calc.doSetoff`, `setOffPctg20Loss_STCG`, `setOffAgainst125`, `calcBFLA`,
   `P3 = MIN(125000,H28)`, BF LTCL before BF STCL, non-112A 12.5% LTCG consumed
   before Section 112A) — **external portal-conformance evidence from this
   supplied package only.** It describes the behaviour of one released version of
   one official utility. **It is not a statement of mandatory law.**
   *(Updated `TAX-SAFE-02A`, 2026-08-01: most of layer 3 has since been
   **independently reproduced** from the byte-verified official workbook — see
   "Independent verification" below. That changes how well-evidenced the trace
   is. It does **not** promote any of it to law; the last two sentences stand.)*

## What could and could not be verified

**Independently corroborated by `TAX-SAFE-02` (direct fetch, 2026-08-01):**
`incometax.gov.in/iec/foportal/downloads` confirms the manifest's artifact
provenance exactly — ITR-2 Excel utility **v1.2, released 17-Jul-2026**, and
ITR-2 JSON schema **v1.1, latest 30-Jun-2026**.

**Not verified — recorded as blocked:** `incometaxindia.gov.in` returned
**HTTP 403** to a direct fetch, the **fifth consecutive attempt** on that host
(`K4-06`, `K4-07`, `K4-08`, `K4-09`, now `TAX-SAFE-02`). The statute pages and
both CBDT notifications the manifest cites are therefore unverified here. Per
**D67** this is recorded rather than silently substituted.

**Not verifiable in principle from this repository:** the workbook itself was
not supplied, so none of the macro names, cell references or formulas in layer 3
were reproduced. The SHA256 hashes in the manifest are recorded as the research
task reported them; no artifact was held against which to check them.
**— SUPERSEDED on 2026-08-01 by `TAX-SAFE-02A`**, when the owner supplied the
artifacts were supplied. Both limits are now lifted; see the next section.

## Independent verification — 2026-08-01 (`TAX-SAFE-02A`)

The official artifacts were supplied directly. They were inspected
**statically and read-only**: no macro was executed, no active content was
enabled, no client data was used, no portal upload was attempted, and the
workbook was not modified. `xl/vbaProject.bin` was decompressed with a
purpose-written stdlib-only CFBF + MS-OVBA reader (no third-party package was
downloaded, so nothing was substituted for the supplied evidence), recovering
151 modules; worksheet formulas were read from the OOXML parts and resolved
against the workbook's defined names; the validation-rule PDFs were searched
against a whitespace-normalised text extraction, because they draw text
glyph-by-glyph and a naive search would return misleading zero-hits.

### Hash verification

Every artifact's actual SHA256 equals both its `sha256` and its
`expected_sha256` in `evidence-manifest.json`, and every file size matches.
No substitution, no mismatch.

| Artifact | SHA256 | Bytes |
| --- | --- | --- |
| `ITR2_AY_26-27_V1.2.xlsm` | `E5CE02F3FFC848D7FB708D4157C6C41AF12013E68EE84686715B788C1F9FB785` | 10,067,896 |
| `ITR-2_2026_Main_V1.1.json` | `77BE18189ECAC94C7ED22BAAA5E3BB46E238F781F55B9E2A8F6547F1E8E00EC8` | 390,029 |
| `ITR-3_2026_Main_V1.1.json` | `66F4BD705E0E0788FDACB37EB297ACE56749D791B84F2F170F4DA84236C25E8B` | 1,060,874 |
| `ITR-2-validation-rules-v1.0.pdf` | `2321C5BA2469D3C9EAEEE40D906B99ABE56176782D547E6D0EC09FFDB529550B` | 740,989 |
| `ITR-3-validation-rules-v1.0.pdf` | `60334E821EEF769B1AF2826B7E8CA2F1AEB76B302886473ED5FEC6A0B7CC9D5D` | 1,112,874 |

**Chain of custody holds.** `evidence-manifest.json` declares the *prior*
manifest's SHA256 as `34ED0BF698F0F6748A6CC16F2C897EB9012ECEB26FAF3C19A58F7FE11926E928`.
That is exactly the hash of `D93-evidence-manifest.json` in this directory — so
the link between the two packages can now be checked from inside the repository.

### Directly reproduced workbook behaviour

Each of the following was re-derived from the byte-verified workbook, not read
from the research package's prose.

| Memo trace claim | Where it lives |
| --- | --- |
| `CG_Calc.doSetoff` performs Schedule CG intra-head set-off | `CG_Calc.bas:115` `Sub doSetoff()` |
| `CYLABFLASetOff` runs the CYLA routines, then `calcBFLA`, then `calcCFL` | `CYLACalculations.bas:2579`; calls at 2593-2597, in the order `setOffOthSrcLossCYLA` → `setOffHPLossCYLA` → `setOffBussLossCYLA` → `calcBFLA` → `calcCFL` |
| An active 20% STCL is routed STCG 30% → STCG applicable rate → LTCG 12.5%, carrying the residual between steps | `SchCG.bas:7787` `setOffPctg20Loss_STCG`, calling `setOffAgainst30` → `setOffAgainstAr` → `setOffAgainst125` |
| Brought-forward LTCL is consumed before brought-forward STCL | `CYLACalculations.bas:6256-6257` loads `totofbfloss.LTCGLossCF8` / `totofbfloss.STCGLossCF8`; line 6259 is the workbook's own comment `'stage-1 setting off LTCG_CFL`; the first brought-forward **STCL** consumption is at line 6621 |
| The Schedule SI redistribution assigns the surviving 12.5% pool to Section 112A first | `CG_Calc.bas:889-901`: `SI_LTCG125_112A = Max(0, Min(BFLA_LTCG_125, …_sec112A))`, and every later 12.5% class subtracts it from the pool; written to the sheet at `CG_Calc.bas:959` |
| The ₹1,25,000 threshold is one aggregate shared between direct and PTI Section 112A income | worksheet `SPI - SI` (`xl/worksheets/sheet42.xml`) — see below |

Worksheet `SPI - SI`, row 28 (*"112A - LTCG on sale of shares /units of equity
oriented fund/units of business trust…"*), row 79 (*"Pass Through Income in the
nature of Long Term Capital Gain chargeable @ 12.5% u/s 112A"*):

| Cell | Formula | Meaning |
| --- | --- | --- |
| `G28` | `BFLAtemp125Sec_112A` → `'Temporary Values'!$F$36` | the **post-BFLA** Section 112A income |
| `H28` | `temp112A_125_exmp_New` → `'SPI - SI'!$U$60` | the figure actually taxed; the defined name `taxableInc2B` **is** `$H$28` |
| `P3` | `MIN(125000,H28)` | the threshold, taken **from** the figure being taxed |
| `I28` | `ROUND(IF(taxableInc2B>P3,(taxableInc2B-P3)*F28/100,0),0)` | 12.5% on the excess |
| `P5` | `MIN(125000-P3,H79)` | the PTI row receives only the **unused balance** of the same ₹1,25,000 |
| `I79` | `ROUND(IF(H79>P5,(H79-P5)*F79/100,0),0)` | — |

This is the reproduced basis for the **threshold-after-set-off** reading: the
₹1,25,000 is computed from, and capped by, the post-set-off figure. It is never
subtracted from gross Schedule 112A gain beforehand.

Two ancillary points, also directly observed. `calcBFLA` is **defined twice** —
`BFLA_Calculations.bas:4` and `CYLACalculations.bas:5986`. The live one is
`CYLACalculations.calcBFLA`: every call site is module-qualified to it
(`Sheet16.bas:23`, `Sheet17.bas:31`), while the other has no observed caller and
handles only the pre-12.5% `prctg10`/`prctg20` buckets. And row 59 of `SPI - SI`
— *115AD(1)(b)(iii) proviso, non-residents* — takes `P6 = MIN(125000,H59)`, its
**own full** ₹1,25,000 rather than a share of the 112A aggregate. That is outside
the memo's scope and outside ours (resident cases only), but any future
non-resident work must not assume a single global threshold.

### Retained qualification — `setOffAgainst125`

`SchCG.bas:1738-1762`. The observed call order, with the workbook's own
descending priority comments, is 112AB(9)`'10` → 112(1)(c)`'9` → 115AC`'8` →
115ACA`'7` → 115AD(3) → 115AD(3)-proviso`'6` → 115E(b)`'5` → PTI`'4` →
second-proviso`'3` → PTI 10(1)`'2` → **112A `'1`**. Section 112A is last among
the numbered calls — **but two further calls follow it in source order**,
`setOffAgainst115E_a125` and `setOffAgainst112ASEC48`, each annotated
`'not using`. Static inspection cannot prove those two are inert without
executing them, which was prohibited. **The "112A last" claim holds only if
those annotations are accurate.** Do not drop this qualification.

### Not independently reproduced

- **The writer of `temp112A_125_exmp_New` (`'SPI - SI'!$U$60`) was not found.**
  No module among the 151 recovered writes it, and the cell has no stored value
  in the sheet XML. The step from `G28` (post-BFLA, directly observed) to `H28`
  (the taxed figure) is therefore **inferred, not observed**. The inference is
  strong — rows 31/32 of the same table set `H=G` by explicit formula, and every
  sibling special-rate row taxes column H — but it is an inference.
- **The "resident basic-exemption shortfall" step is unreproduced**, and this is
  precisely where it would live. Treat the memo's description of it as external,
  unreproduced claim.
- The memo's "same-rate/source netting occurs before these cross-bucket steps",
  its synthetic result matrix (`D93-01`…`D93-11`), the ITAT/High Court
  authorities and the CBDT notifications were **not** re-derived here. They
  remain external research.

### Schemas and validation rules prescribe arithmetic, not ordering

Searched in full: **neither** validation-rules PDF prescribes any rate-bucket
set-off order, and **neither** mentions a ₹1,25,000 Section 112A threshold. All
53 (ITR-2) and 56 (ITR-3) "set off" rules are arithmetic-consistency rules of
the form *"… should be equal to …"* or *"'Total loss set off' cannot be more
than the 'Loss to be set off'"*. The only `125000` in the ITR-2 rules is the
**80DD / 80U** severe-disability limit; the ITR-3 rules contain none. In both
JSON schemas the only two occurrences of `125000` are the `Section80DD` and
`Section80U` `maximum` constraints. Every schedule identifier the memo names
(`ScheduleCGFor23`, `Schedule112A`, `SaleOfEquityShareUs112A`, `BalanceCG`,
`STCG20Per`, `STCG30Per`, `STCGAppRate`, `STCGDTAARate`, `LTCG12_5Per`,
`LTCGDTAARate`, `ScheduleBFLA`, `IncOfCurYrUndHeadFromCYLA`,
`BFlossPrevYrUndSameHeadSetoff`, `IncOfCurYrAfterSetOffBFLosses`,
`ScheduleCFL`, `ScheduleSI`) exists — but the schemas carry **structure**, not
computation order.

So: **the bucket ordering and the ₹1,25,000 sequence are the behaviour of one
released utility version. They are not published rules, and they are not
statute.** This is independent support for **D113**.

One observation, recorded but **not** built on: an ITR-2 validation rule reads
*"In Schedule SI, the amount at column (ii) Tax thereon should be equal to
taxable income (\*) special rate"*, which rows 28/59/79 do not satisfy, since
they subtract `P3`/`P5`/`P6` before applying the rate. Either the rule is a
simplification or the 112A-family rows are an unstated carve-out. Unresolved.

### The utility itself offers a manual allocation

`CG_Calc.doSetoff` has **two branches**, selected by
`UCase(Sheet13.Range("CG_TableE_Checkbox").value) = "TRUE"`. The `True` branch
runs the automatic sequence above. The `Else` branch reads **user-entered**
amounts from `IHLA.Ei2_StclSetoff20Per`, `IHLA.Ei3_StclSetoff30Per` and
`IHLA.Ei4_StclSetoffAppRate` on Schedule CG Table E.

The official utility therefore treats its own sequence as a **default over a
user-supplied allocation**, not as the only expressible result. That is direct
support for the versioned taxpayer-election architecture the `K4-10` release
boundary already requires (**D112**): a `portal_default_ay2026_27` mode
alongside a `taxpayer_elected` mode, with divergence stopping for professional
review. It does not change that boundary.

### What this verification does *not* do

- It marks **nothing** `ca_verified`. No pack lifecycle changed; no CA has
  reviewed any of this.
- It does **not** make portal-default behaviour mandatory statute. The evidence
  above points the other way.
- It does **not** close the `D93` Q2 ordering question, implement `K4-10`, or
  alter the bounded `K4-10` release scope set by **D112**.
- Every finding is bound to **ITR-2 utility v1.2**, **JSON schema v1.1**,
  **ITR-2 validation rules v1.0** (2026-05-26) and **ITR-3 validation rules
  v1.0** (2026-06-18). The revalidation gate below is unchanged and applies to
  this section in full.

## Standing limits carried from the package

- No client data was used; every case is synthetic.
- No official portal upload and no CPC acceptance test was performed. The
  synthetic JSON is a conformance record, **not** an uploadable return.
- Macros were **not executed** — the trace is static inspection of formulas and
  source.
- ITAT orders bind their parties and are persuasive only; territorial High Court
  precedent must be checked for a taxpayer's jurisdiction. The official Calcutta
  High Court copy of *Rungamatee* was not independently retrieved.
- **Nothing in this package makes any pack `ca_verified`, and nothing here has
  been reviewed by the verifying CA.**

## Revalidation gate

This evidence is **version-bound**. Re-run the conformance reasoning, and revisit
the `K4-10` release scope, whenever **any** of these changes:

- the AY 2026-27 offline/Excel utility version (recorded here at ITR-2 **v1.2**,
  common utility **v1.2.2**);
- the ITR-2 / ITR-3 **JSON schema** version (recorded at **v1.1**);
- the ITR-2 / ITR-3 **validation rules** version (recorded at **v1.0**).

A taxpayer-elected allocation that diverges from the portal default must stop for
professional review rather than be silently substituted.

See **D110**–**D113** (the `TAX-SAFE-02` close) and **D114**–**D115** (the
`TAX-SAFE-02A` independent verification and the byte-exact storage rule) in
the k3-tax-intelligence-program design notes §6, and the corresponding entries
in the change log.
