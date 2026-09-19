# TaxDesk OS — Supabase database

Postgres schema, RLS, storage, and seed for TaxDesk OS. Region: **ap-south-1 (Mumbai)**.

## Migration order

| File | Contents |
|---|---|
| `migrations/000001_initial_schema.sql` | Extensions (pgcrypto, citext, pg_trgm), `app` schema, updated_at trigger, all 22 tables, 3 views (`clients_safe`, `identity_reviews_completeness`, `fee_balances`), indexes |
| `migrations/000002_rls_policies.sql` | `app.*` helper functions, soft-delete-admin trigger, grant shaping (anon = nothing; `pan_encrypted` column locked), RLS enable + policies on every table |
| `migrations/000003_storage_buckets.sql` | Private buckets `case-files` and `generated-pdfs`; no storage policies (server-route access only) |
| `migrations/000004_seed_templates.sql` | Idempotent config seed: services + status flows, checklists, PDF templates, message templates, settings |
| `migrations/000005_pan_column_hardening.sql` | PAN write lockdown: authenticated loses INSERT/UPDATE on `pan_encrypted` **and** `pan_last4` (column-list grants); documents the service-role-only PAN write/reveal path |
| `migrations/20260704100000_fix_public_users_grants.sql` | Hotfix: `usage` on schema + `select` on `public.users` for `authenticated`, full `public.users` for `service_role` (needed for the login/profile lookup). Subsumed by the baseline below; kept for history. |
| `migrations/20260704120000_baseline_privileges.sql` | **Root-cause fix.** Makes the base table-privilege matrix explicit instead of relying on platform default ACLs (which aren't present on this stack): `service_role` gets full table + sequence access (server-only paths: PAN write/reveal, `audit()`, display codes, uploads); `authenticated` gets the exact per-table SELECT/INSERT/UPDATE that mirrors the RLS design. `anon` still gets nothing; `clients` stays column-scoped so `pan_encrypted` is unreachable. RLS unchanged. |
| `seed.sql` | **Dev-only** synthetic demo clients/cases (Ramesh Testwala, Priya Demo, Iqbal Sample). Demo cases need an admin — see bootstrap below. The "no user … skipped demo cases" NOTICE on a fresh reset is expected. |

## Run locally

```bash
# once
npm install -g supabase        # or use npx
supabase init                  # if not initialized
supabase start                 # local stack (Docker)

# apply migrations + seed.sql (supabase runs seed.sql automatically on reset)
supabase db reset
```

Against a hosted project:

```bash
supabase link --project-ref <YOUR_PROJECT_REF>
supabase db push               # applies migrations/ in order
# seed demo data only if this is a dev project:
psql "$DATABASE_URL" -f supabase/seed.sql
```

## Bootstrap the first admin

Access is **invite-only**: an Auth user can sign in only if a matching
`public.users` row exists with role `staff`/`admin` and `is_active = true`.
RLS makes `users` admin-write-only, so the first row must be created with
elevated access (service role / SQL editor). Grants for this path are applied
by migration `20260704120000_baseline_privileges.sql` — no manual `GRANT`
is needed after a reset.

> **Grants are permanent and live in migrations.** After `supabase db reset`
> everything (login, clients, cases, services, templates, audit) works with no
> hand-run SQL. Do **not** run manual `GRANT` statements against the database —
> if a privilege is ever missing, add it to a migration instead so the fix
> survives the next reset.

Staff/admin accounts can also be managed from the app once an admin exists:
**Settings → Users** (invite, deactivate/reactivate, change role — all
audited). The SQL below is only for the very first admin.

The repeatable way (no hand-copying UUIDs), from the project root with the
local stack running:

```bash
# 1. Create the Auth user (GoTrue owns password hashing).
curl -s http://127.0.0.1:54321/auth/v1/admin/users \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"changeme123","email_confirm":true}'

# 2. Promote that Auth user to an active admin (matches BY EMAIL, idempotent).
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v email="owner@example.com" -v name="Owner Name" \
  -f supabase/bootstrap-admin.sql

# 3. Re-run the demo seed so demo CASES get an owner (clients seed on reset).
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -f supabase/seed.sql
```

Prefer the UI? Create the Auth user in Studio → Authentication → Add user
(disable email confirm for dev), then run steps 2–3. `bootstrap-admin.sql`
looks the user up by email, so you never copy the UUID by hand.

## Reset and reseed

```bash
supabase db reset     # local: drops, re-applies all migrations, runs seed.sql
```

Hosted dev project: `supabase db push` is incremental; for a full reset use a
fresh project or `supabase db reset --linked` (destructive — never on prod).

## Smoke tests

```bash
psql "$DATABASE_URL" -f supabase/tests/rls-smoke.sql    # rolls back; no residue
psql "$DATABASE_URL" -f supabase/tests/seed-smoke.sql   # read-only
```

`rls-smoke.sql` asserts: RLS on all tables; `clients_safe` hides
`pan_encrypted`; authenticated cannot SELECT `pan_encrypted`; no
Aadhaar-number columns exist (flags only); buckets private; append-only
tables have no UPDATE/DELETE policies; anon has zero grants and is blocked
live; a simulated staff user cannot read audit logs, update settings,
mutate payments, or read encrypted PAN.

## Security decisions (do not weaken)

- **No anonymous policies anywhere.** The public `/upload/[token]` route is
  served by a Phase D server route using the service role, which validates
  the hashed token itself. Storage has no client-facing policies at all.
- **PAN columns are fully locked for API users (000005).** `authenticated`
  has no SELECT/INSERT/UPDATE on `pan_encrypted` and no INSERT/UPDATE on
  `pan_last4` (it stays readable for search/masked display). Both columns
  are written together only by the Phase D `setClientPan` server action
  (service role: validate → encrypt via node:crypto → write → audit with
  masked values). Reveal is a separate admin-only audited server action.
  Never decrypt PAN in SQL.
- **Soft delete/restore is admin-only** via `app.enforce_soft_delete_admin()`
  trigger on clients, cases, uploaded_files, fees, physical_documents.
- **Append-only** (`case_status_history`, `consent_records`, `payments`,
  `generated_pdfs`, `case_messages`, `audit_logs`): no UPDATE/DELETE
  policies AND privileges revoked. Corrections = new rows.
- **audit_logs** are admin-read, service-role-write only.
- **Aadhaar:** no number column exists; checklist items are optional with a
  DEFAULT DENY note; `cases.aadhaar_required` needs a reason (CHECK);
  Aadhaar-flagged files carry `contains_aadhaar` and surface via the
  partial index `idx_uploaded_files_purge_queue` for early purge.

## Known limitations (intentional, Phase D+)

- Status-transition legality, IEPF-5 preparation guards, fee-override
  admin gating, and display-code generation are app/server-action rules
  (the JSONB `status_flow.guards` documents them for the engine).
- `balance_fee_due` lives in the `fee_balances` view (needs the payments
  ledger; not expressible as a generated column).
- Users' self-service profile edits deferred (column-scoped RLS not
  expressible).
- `rls-smoke.sql` §9 inserts a minimal `auth.users` row — local dev only.
