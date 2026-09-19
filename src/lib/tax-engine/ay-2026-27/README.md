# Tax Engine — AY 2026-27 / FY 2025-26 (`ay-2026-27`)

Native **Tax Desk / ITR Prep** computation engine for TaxDesk OS.

> ⚠️ **Preparation-only. Not tax advice. CA verification required before any
> real client reliance.** Rules version: `AY_2026_27_V1_PREP_ONLY`.
> Historical pre-K4-17 snapshots retain `AY_2026_27_V0_PREP_ONLY` and are
> deliberately stale against this engine rather than silently reinterpreted.
> The pre-K4-17 engine is recoverable at git tag `tax-pack-AY-2026-27-V0`
> (`b2a7406`), not in-tree (`D277`); legacy snapshots are stored-output
> evidence, not replay-complete inputs.

## Purpose

This module computes a preparation-time view of an individual's income tax for
**Assessment Year 2026-27 (Financial Year 2025-26)**: income aggregation,
old-vs-new regime comparison, a basic ITR-form recommendation, and case
validation / reconciliation findings.

It exists to help a preparer **draft and sanity-check** a return. It does not
file anything and it does not talk to the Income Tax portal.

## Hard boundaries

**No filing / no portal integration.** This engine performs **zero** of the
following (and must never be extended to, in this folder):

- e-filing, ERI integration, portal automation, or portal scraping
- storing Income Tax portal credentials
- OTP / captcha handling
- OCR, AI extraction, or prefill fetching

**Pure-engine boundary.** Every file here is **pure TypeScript**. It must not
import:

- React / Next.js
- the Supabase client
- UI or PDF components
- server actions
- env / config
- app routes

The only runtime dependency is the language itself. This keeps the engine
trivially unit-testable and safe to run anywhere (server, worker, test).

## Supported (K.2.0)

- Salary income + standard deduction (regime-specific: ₹75,000 new / ₹50,000 old)
- Interest income (savings + FD) and dividend income at slab rates
- Ordinary slab income (old + new regime slabs)
- Basic Chapter VI-A deductions (old regime): 80C, 80D, 80TTA, 80TTB, 80CCD, 80G, other
- Old vs new regime comparison + recommendation (lower gross liability)
- Section 87A rebate (new ₹60,000 ≤ ₹12L total income; old ₹12,500 ≤ ₹5L)
- Health & Education Cess @ 4%
- STCG u/s 111A @ 20% and LTCG u/s 112A @ 12.5% over the ₹1,25,000 exemption
- Capital gains taxed at **special rates** — never merged into slab income
- TDS / TCS / advance / self-assessment adjustment → refund or payable
- Basic ITR-1 vs ITR-2 recommendation
- Source-aware computed values (every number carries its formula + source tags)
- Case validation / reconciliation findings (see `validate-case.ts`)

## Public API

```ts
import {
  computeTax,
  compareRegimes,
  recommendItrForm,
  validateCase,
} from "@/lib/tax-engine/ay-2026-27";
```

| Function | Returns |
| --- | --- |
| `computeTax(input)` | Gross total income, ordinary income, special-rate gains, deductions, total income, old/new regime tax, recommended regime, special-rate tax, rebate, cess, gross liability, tax paid, refund/payable — each as a `ComputedValue`. |
| `compareRegimes(input)` | Both regime computations, the recommended regime, the difference, and notes. |
| `recommendItrForm(input)` | `recommendedItrType`, `blockers`, `reasons`, `notes`. |
| `validateCase(input)` | `findings[]` (`code`, `severity`, `area`, `message`, optional source/entered/difference, `suggestedAction`, `sources`) and `hasBlockers`. |

Every computed number is a `ComputedValue`:

```ts
{ value: number; formula: string; sources: string[]; notes: string[] }
```

## Limitations / placeholders (NOT implemented in K.2.0)

These are intentionally stubbed and documented in `rules.ts` (`NOT_IMPLEMENTED`):

- Senior / super-senior slab variants
- Surcharge and marginal relief
- House property and business / professional income (captured as placeholder heads, not taxed)
- Foreign assets (only blocks ITR-1), clubbing, set-off / carry-forward
- F&O, crypto / VDA (s.115BBH), tax-audit (s.44AB) cases
- Resident adjustment of unexhausted basic exemption against 111A / 112A gains

## Rule references

Constants live in [`rules.ts`](./rules.ts) and [`slabs.ts`](./slabs.ts). Sources
were checked against public summaries of the Finance Act 2025 / Budget 2025 and
the post-23-Jul-2024 capital-gains regime. **Do not rely on developer memory** —
re-verify against the bare Act / CBDT circulars each assessment year. Search for
`TODO(CA-verify)` for spots that explicitly need a CA sign-off.

## CA verification required

No output of this engine may be relied on for a real client return until a
qualified CA has verified the applicable slabs, rebate, special rates, deduction
caps, and the placeholders above for the specific case.

## How future DB adapters should call the engine

The engine is deliberately DB-agnostic. A future adapter (server action, worker,
etc. — living **outside** this folder) should:

1. Read the case's ledger rows (income, tax paid, deductions, capital gains),
   documents, and workflow flags from Supabase.
2. Map each row to a typed entry, preserving `sourceType`
   (`manual | AIS | 26AS | Form16 | prefilled_json | broker_report |
   bank_certificate | adjustment`) and `sourceDocumentId` for traceability.
3. Assemble a `TaxEngineInput` and call `computeTax` / `compareRegimes` /
   `recommendItrForm` / `validateCase`.
4. Persist / render the returned `ComputedValue`s. `sources[]` maps back to the
   originating rows/documents; `formula` and `notes` are display-ready.

The adapter owns all I/O, auth, RLS, and persistence. The engine stays pure.
