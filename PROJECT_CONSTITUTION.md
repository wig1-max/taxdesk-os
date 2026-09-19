# Project Constitution — TaxDesk OS

**Stable spine. Rarely edited.** This file records the settled product,
safety and architecture rules that every change must respect. Day-to-day
engineering conventions (commands, file layout, PII rules) live in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## 1. Product purpose

TaxDesk OS is an operations command center for a CA (Chartered Accountant)
tax practice. It is a **staff/admin tool**, not a consumer product: clients
never log in and never self-file. It manages clients, cases, documents, and a
Tax Desk ITR-preparation workspace, evolving toward a CA-first professional
preparation and control system whose promise is *every source evidenced,
every material number traceable, every exception reviewed, every approval
bound to the exact computation, and every filing outcome reconciled back into
the case.*

## 2. Non-negotiable safety spine

These are not reopened by a judgment call inside a single change — reopening
any of them requires an explicit, dated, recorded decision, not a silent
change:

1. Staff-first CA workflow. No consumer self-filing funnel, ever.
2. Synthetic data only until an explicit, separately-authorized real-client
   release gate passes.
3. No government-portal scraping, no unattended/automated filing.
4. Never store portal passwords, OTPs, CAPTCHA material, reusable EVC data,
   DSC secrets, PAN, or Aadhaar in notes, audit metadata, or telemetry. PAN
   is masked at rest; reveal is audited.
5. AI/OCR may only **propose** — a fact, a classification, a summary, a
   question. It is never the authoritative source for a tax calculation, an
   eligibility decision, a sign-off, or a filing action.
6. Computation and validation stay deterministic and unit-tested. Domain
   logic under `tax-desk`, `tax-engine`, `tax-pack`, and `tax-lab` stays
   pure TypeScript — no React/Next/Supabase/env/route imports.
7. Protected database writes go only through guarded RPCs
   (`SECURITY DEFINER`, owned by the least-privilege `app_writer` role,
   `search_path` pinned). Server actions re-verify auth and
   finalized/eligibility state server-side — never trust a client-sent
   status or count — and `revalidatePath` the affected route.
8. Snapshots are immutable. A finalized case is read-only (admin-only
   reopen).
9. Internal finalization is not filing and is not tax-authority acceptance.
   Eligibility is not correctness. Reviewer sign-off is not an eligibility
   override.
10. A tax pack that is not truthfully `ca_verified` cannot support real-client
    reliance — every shipped pack today is truthfully `draft`, and no pack
    may be marked `ca_verified` without real CA sign-off against official
    sources.
11. No real-client enablement merely because code exists. Operational,
    security, legal, CA-verification, backup, and production-parity gates
    must all separately pass first.

## 3. Domain architecture boundaries

- **One authority per concept.** Eligibility, document state, validation-run
  derivation, workflow-stage derivation, and case traceability each have
  exactly one canonical evaluator that every reader consumes — never a
  second, independently-derived copy in a component or action.
- **Tax law, source formats, and output schemas are versioned packages**
  (`src/lib/tax-pack/*`), not mutable globals. A computation is reproducible
  from an immutable pack identity.
- **Finalization ≠ filing ≠ ERI submission ≠ ITD acceptance.** Each is a
  distinct, separately-gated step; no later step's language may be borrowed
  to describe an earlier one's result.
- **Canonical internal model vs. ITD JSON adapter.** The product's internal
  tax-truth representation is architecturally separate from any future ITD
  JSON / e-filing adapter. No change may collapse that boundary by inventing
  ITD-shaped fields early.
- **No `tax-lab` import from production.** The synthetic case laboratory
  (`src/lib/tax-lab/*`) is a test/design instrument only — enforced by a
  boundary test, not merely by convention.
- **No source-format claim without an inspected, versioned, authoritative
  specimen.** A schema package may declare a fact it supports only after a
  real specimen has actually been looked at — never inferred from memory or
  a competitor's output.
- **Draft tax-pack versioning (decision `D276`).** A `draft`
  (non-`ca_verified`, unreleased, synthetic-only) tax pack is **one mutable
  computation until a freeze event** — an assessment-year/statutory-period
  change, an explicit maintainer release/freeze decision, or the
  `draft → ca_verified` transition. Two guarantees are separate and must not
  be conflated: (a) **always owed** — `computationRulesVersion` bumps on every
  *material* computation behaviour change, so the snapshot freshness check
  (`snapshot.rulesVersion !== current version`) stays honest; (b) **owed only
  at a freeze event** — a frozen *executable* historical engine binding
  (in-tree copy or git tag) is created only by an explicit decision, **never
  per capability slice**. A stored snapshot is immutable historical *output*
  evidence; it is replay-complete only if built with the complete-input
  format, and a saved output is **not** a replay-complete input.

## 4. Decision-change protocol

- A settled rule in this file is not reopened by simply doing something
  different in a later change. Reopening requires an explicit, dated decision
  entry stating what changed and why.
- A completed milestone's claims are never silently reversed. If later work
  finds a prior "complete" claim was wrong, it records that correction as a
  new, dated entry — it does not edit history to make the prior entry look
  right in hindsight.
- Deliberately replacing a pre-existing test assertion (rather than adding a
  new one) is always recorded as a decision with a rationale, never done
  silently: "record it, don't hide it."

## 5. Status-language discipline

No document may describe this product with unqualified completeness
language ("Tax Desk is complete," "the tax engine is complete," "no known
bugs," "production ready," "ready for real-client filing"). Use instead:

> The office-core workflow and Tax Desk control pipeline are substantially
> implemented. Tax computation coverage remains limited and unsupported
> situations remain reliance-blocked.

and, for test/CI status specifically:

> No open defects are recorded in the currently verified unit, security, and
> E2E surfaces. Production and staging migration parity, deployed
> authorization controls, backup restoration, and production-specific
> runtime behavior remain incompletely verified.
