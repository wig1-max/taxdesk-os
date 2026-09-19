-- ============================================================
-- TaxDesk OS — SMOKE-TEST DATA CLEANUP (manual, admin-run)
--
-- Purpose: after validating a hosted environment with synthetic
-- smoke-test records, soft-delete them so they disappear from the app
-- without destroying anything or corrupting history.
--
-- SAFETY BY DESIGN:
--  * SOFT delete only (sets deleted_at). Fully reversible — set
--    deleted_at back to NULL to restore. No hard DELETE anywhere.
--  * PATTERN-GATED: the WHERE clauses only match names you pass via
--    :pattern (default 'E2E %', the automated suite's prefix). Even if
--    the whole file is run blindly, it cannot touch real client data
--    whose name doesn't match the pattern.
--  * Audit/consent rows are never modified; the original creation of
--    each record remains in the audit log.
--  * There is deliberately NO in-app button for this — cleanup is a
--    conscious, reviewed psql action.
--
-- USAGE (review the preview FIRST, then run the soft-delete block):
--   psql "<db-url>" -v pattern="E2E %"  -f supabase/cleanup-smoke-data.sql
--   psql "<db-url>" -v pattern="Smoke %" -f supabase/cleanup-smoke-data.sql
--
-- NEVER run this with a pattern that could match real clients. Start on
-- staging. Storage objects for smoke uploads are not removed here (their
-- rows are soft-deleted); delete those from the Storage console/S3 if
-- desired, or leave them — they are private and unreferenced.
-- ============================================================
\set ON_ERROR_STOP on
\if :{?pattern}
\else
  \set pattern 'E2E %'
\endif

\echo '--- Clients matching pattern (PREVIEW — nothing changed yet):'
select id, display_code, full_name, primary_phone, created_at
from public.clients
where full_name ilike :'pattern'
  and deleted_at is null
order by created_at;

\echo '--- Cases belonging to those clients (PREVIEW):'
select k.id, k.display_code, k.title, k.status
from public.cases k
join public.clients c on c.id = k.client_id
where c.full_name ilike :'pattern'
  and k.deleted_at is null
order by k.created_at;

-- ------------------------------------------------------------
-- SOFT DELETE. Review the previews above; this only affects rows
-- whose client name matches :pattern. Comment out to run previews only.
-- ------------------------------------------------------------
update public.cases k
set deleted_at = now()
where k.deleted_at is null
  and k.client_id in (
    select id from public.clients
    where full_name ilike :'pattern' and deleted_at is null
  );

update public.clients
set deleted_at = now()
where deleted_at is null
  and full_name ilike :'pattern';

\echo '--- Done. Soft-deleted (reversible) clients/cases matching:' :'pattern'
\echo '--- To restore: update public.clients/cases set deleted_at = null where ...'
