-- ============================================================
-- TaxDesk OS — 20260727120000 House Property finalized-lock + actor
-- attribution triggers (MAINT-03, remediating AUDIT-03-F1)
--
-- `K4-06`'s `20260726140000_house_property_ledger.sql` created
-- `tax_house_property_entries` with only `trg_..._updated_at`. It never
-- wired `app.enforce_ledger_finalized_lock()` or `app.set_ledger_actor()`,
-- which all four sibling ledger tables have carried since
-- `20260712140000_authz_boundary_enforcement.sql` §2b/§2c.
--
-- That mattered because the RLS policies on ALL FIVE ledger tables carry no
-- finalized predicate whatsoever — the "a finalized case is read-only"
-- control (`PROJECT_CONSTITUTION.md` §2 rule 8) lives ENTIRELY in the
-- trigger. `MAINT-03` proved the consequence empirically rather than
-- inferring it from the catalog (which is all `AUDIT-03`'s read-only charter
-- allowed): before this migration, a real authenticated STAFF token used
-- against PostgREST directly could insert (HTTP 201), amend (200), and
-- soft-delete (200) house-property rows on a FINALIZED case — the three
-- operations `tests/security/hostile-postgrest.mjs` B1/B2/B3 prove blocked
-- for every other ledger.
--
-- ADDITIVE AND TRIGGERS ONLY. This migration deliberately changes no RLS
-- policy, no grant, no RPC signature, no ownership, and no `search_path`.
-- The trigger declarations below are byte-equivalent to what
-- `20260712140000`'s `format()` loop emits for a sibling table — the same
-- `before insert or update` timing, the same `for each row` scope, the same
-- two functions, and the same `trg_<table>_finalized_lock` /
-- `trg_<table>_actor` names — so `tax_house_property_entries` is now
-- indistinguishable from its siblings in `pg_trigger`.
--
-- `drop trigger if exists` first, matching the sibling loop, so re-applying
-- this migration against a database that already has them is a no-op rather
-- than a duplicate-object error.
--
-- Two gates now make a SIXTH ledger table unable to repeat this silently:
--   * `tests/security/hostile-postgrest.mjs` §[B] iterates a declared ledger
--     list instead of hardcoding `tax_income_entries`; and
--   * `scripts/deployment-parity-check.mjs` DERIVES the ledger-table set from
--     the catalog (any `public.tax_*_entries` table) and asserts both
--     triggers on each — so a new ledger fails parity until it is wired,
--     with no hand-maintained list to forget.
-- ============================================================

drop trigger if exists trg_tax_house_property_entries_finalized_lock
  on public.tax_house_property_entries;
create trigger trg_tax_house_property_entries_finalized_lock
  before insert or update on public.tax_house_property_entries
  for each row execute function app.enforce_ledger_finalized_lock();

drop trigger if exists trg_tax_house_property_entries_actor
  on public.tax_house_property_entries;
create trigger trg_tax_house_property_entries_actor
  before insert or update on public.tax_house_property_entries
  for each row execute function app.set_ledger_actor();
