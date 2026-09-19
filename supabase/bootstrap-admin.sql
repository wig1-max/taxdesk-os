-- ============================================================
-- TaxDesk OS — DEV bootstrap: promote an auth user to admin.
--
-- Access is INVITE-ONLY: a Supabase Auth user can log in only if a
-- matching row exists in public.users with role staff/admin and
-- is_active = true. RLS makes public.users admin-write-only, so the
-- FIRST admin must be created out-of-band (service role / SQL editor).
--
-- This script removes the manual "copy the auth UUID by hand" step
-- that was easy to get wrong: it looks the auth user up BY EMAIL and
-- upserts the public.users row. Idempotent — safe to re-run.
--
-- PREREQUISITE: the Auth user must already exist. Create it either
-- via Studio (Authentication > Add user, disable email confirm), or
-- via the local GoTrue admin API, e.g.:
--
--   curl -s http://127.0.0.1:54321/auth/v1/admin/users \
--     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
--     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"email":"owner@example.com","password":"changeme123","email_confirm":true}'
--
-- USAGE (override email/name with -v; both are optional):
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v email="owner@example.com" -v name="Owner Name" \
--     -f supabase/bootstrap-admin.sql
--
-- After this succeeds, re-run the demo seed to get demo cases
-- (they need an owner):
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f supabase/seed.sql
-- ============================================================
\set ON_ERROR_STOP on

-- Defaults if not supplied on the command line.
\if :{?email}
\else
  \set email 'owner@example.com'
\endif
\if :{?name}
\else
  \set name 'Owner'
\endif

-- Upsert the admin profile, matching the Auth user by email.
-- If no Auth user matches, zero rows are inserted (handled below).
insert into public.users (id, full_name, email, role, is_active)
select au.id, :'name', lower(:'email'), 'admin', true
from auth.users au
where lower(au.email) = lower(:'email')
on conflict (id) do update
  set role       = 'admin',
      is_active  = true,
      deleted_at = null,
      full_name  = excluded.full_name,
      email      = excluded.email;

-- Report the outcome loudly so a missing Auth user is obvious.
select
  case
    when exists (
      select 1 from public.users u
      join auth.users au on au.id = u.id
      where lower(au.email) = lower(:'email') and u.role = 'admin'
    )
    then 'OK: admin bootstrapped for ' || :'email'
    else 'ERROR: no auth.users row for ' || :'email' ||
         ' — create the Auth user first (see header), then re-run.'
  end as bootstrap_result \gset

\echo :bootstrap_result
