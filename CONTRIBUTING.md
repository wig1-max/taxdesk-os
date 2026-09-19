# Contributing to TaxDesk OS

This is the day-to-day engineering contract: stack, layout, commands and the
guardrails every change must respect. The settled product and safety rules
live in [`PROJECT_CONSTITUTION.md`](PROJECT_CONSTITUTION.md); read it once
before your first change.

## Stack

Next.js 15 (App Router, React Server Components, server actions) · React 19 ·
strict TypeScript · Tailwind · Supabase (PostgreSQL + row-level security +
Auth + Storage) · Zod · Vitest · Playwright. Local Supabase runs in Docker
(`supabase start`).

## Architecture entry points

- **Routes:** `src/app/(app)/tax-desk/cases/[id]/{ledgers,computation,validation,review,readiness,manual-review,profile,documents}/page.tsx`
  (server components) wrapped by a shared case shell.
- **Client task screens:** `src/components/tax-desk/*` (`ledger-workspace.tsx`,
  `readiness-actions.tsx`, `client-review-actions.tsx`, `validation-inbox.tsx`,
  `snapshot-controls.tsx`, `manual-review-panel.tsx`, `taxpayer-profile-form.tsx`).
- **Server actions:** `src/app/actions/tax-*.ts`. Every action re-verifies auth
  and finalized/eligibility state server-side and calls `revalidatePath` for the
  affected route.
- **Pure domain logic (unit-tested):** `src/lib/tax-desk/*` (filing readiness,
  workflow, ledgers, eligibility, reviewer sign-off, case traceability, source
  proposals), the AY 2026-27 engine in `src/lib/tax-engine/ay-2026-27/*`,
  versioned tax packs in `src/lib/tax-pack/*`, and the synthetic case
  laboratory (tests only) in `src/lib/tax-lab/*`. All four trees are pure: no
  React, Next, Supabase, env or route imports. A boundary test enforces this.
- **Read models:** `src/lib/queries/tax-*.ts`. `getTaxCaseWorkspace` is
  `cache()`-memoized per request.
- **Shared UI primitives:** `src/components/ui/*`: accessible `Drawer` and
  `ConfirmDialog`, toasts, and the post-mutation reconciliation primitive
  (`reconcile-core.ts` + `use-reconciled-action.tsx`).
- **Database:** `supabase/migrations/*`. Protected writes go through guarded
  `SECURITY DEFINER` RPCs owned by the least-privilege `app_writer` role.

## Commands

```bash
npm run typecheck                # tsc --noEmit
npm run lint                     # ESLint
npm test                         # Vitest unit suite (node env, pure logic)
npm run check:control-bytes      # no invisible control bytes in source
npm run check:statutory-extracts # statutory evidence extracts match their manifest
npm run test:db-guard            # the local-only database guard's own tests

# Need the local Supabase stack (`supabase start`) and a .env.local:
npm run test:db                  # catalog boundary assertions
npm run test:e2e:bootstrap       # create local Auth users
npm run test:security            # hostile-client PostgREST security suites
npm run test:rpc-smoke           # guarded-RPC smoke test
npm run test:e2e                 # Playwright (runs under `next dev`)
```

A change that touches schema, RPCs or grants should run `test:db` and
`test:security` as well as the unit suite. `test:db` is the only place that
asserts several load-bearing catalog invariants (protected-column revokes, RPC
parameter shape, `search_path` pinning).

All database scripts go through `npm run db:guard`, which refuses to run while
a remote Supabase project is linked. Never point local tooling at a hosted
project.

## Guardrails

- **Never store or log PAN, Aadhaar, OTPs, portal passwords, CAPTCHA material,
  EVC data or DSC secrets** in notes, audit metadata or telemetry. PAN is
  encrypted and masked at rest; every reveal is audited. Telemetry goes through
  `src/lib/telemetry/report-error.ts`, which is the single PII-safe seam.
- **Protected columns are writable only through guarded RPCs.** Server actions
  never trust a client-sent status or count.
- **Snapshots are immutable; finalized cases are read-only** (admin-only reopen).
- **Every quoted span in a tax-pack provenance caveat must be declared.**
  Caveats render to preparers, so a wrong quotation is a wrong statement of law
  on screen. `makeRuleProvenance` refuses, at construction, a caveat carrying a
  quoted span that is not listed as a `verbatimQuote` (checked against the
  committed statutory extract by `verbatim-quotes.test.ts`) or as an
  `unverifiableQuotes` entry with a reason. Only the `pdftotext` blocks of an
  extract count as evidence.
- **Domain logic stays pure and unit-tested.** Factor React-free cores out of
  components (see `reconcile-core.ts`); unit tests run in the node environment.
- **Guards that read files match `\r?\n`**, never a bare `\n`, so the verdict
  does not depend on a checkout's line-ending configuration.
- **Status language:** follow `PROJECT_CONSTITUTION.md` §5. No "production
  ready" or "complete" claims.

## Pull requests

Keep changes focused, include tests for domain logic, and make sure
`typecheck`, `lint`, `test` and the pure guards pass locally. CI runs the same
gate on every pull request.
