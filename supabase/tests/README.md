# Database smoke tests

Two SQL suites that prove the security posture of the database itself,
independent of application code.

| File | What it proves | Side effects |
|---|---|---|
| `rls-smoke.sql` | RLS on all tables; anon fully blocked (grants + live check); staff cannot read audit logs, mutate settings/templates, soft-delete clients, touch `pan_encrypted`/`pan_last4` writes, or update append-only tables; `clients_safe` hides `pan_encrypted`; no Aadhaar-number columns anywhere; buckets private; zero `storage.objects` policies | **None** — runs in one transaction and rolls back |
| `seed-smoke.sql` | 8 services with parseable flows, checklist/template/settings counts, IEPF fee config, demo data is marked SYNTHETIC | None — read-only |

## Run

```bash
# local stack (after supabase db reset):
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/rls-smoke.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/seed-smoke.sql

# hosted DEV project (connection string from dashboard):
psql "$DATABASE_URL" -f supabase/tests/rls-smoke.sql
psql "$DATABASE_URL" -f supabase/tests/seed-smoke.sql
```

Every check prints `PASS: …` as a NOTICE; any failure raises
`FAIL: …` and aborts.

## Safety notes

- `rls-smoke.sql` §9 inserts a throwaway row into `auth.users` to
  simulate a staff session. It is wrapped in the rollback, but run it
  against **local/dev only** — some hosted configurations restrict
  direct `auth.users` inserts (the block will simply error there; that
  is a signal to run this suite locally).
- Requires a superuser-ish connection (the default `postgres` role) so
  it can `SET ROLE anon/authenticated` to simulate API callers.
- These suites complement — not replace — the app-level checks:
  fee overrides and PAN write-path rules are business rules enforced in
  server actions and covered by vitest (`npm test`) and Playwright
  (`npm run test:e2e`).
- Re-run both suites after **every** migration that touches policies,
  grants, triggers, or storage buckets.
