-- ============================================================
-- TaxDesk OS — 20260725140000 search_path hardening (AUDIT-01-F7)
--
-- Additive, defense-in-depth only. `AUDIT-01` found five `app.*` functions
-- that predate the `20260712130000_authz_boundary_additive.sql` hardening
-- pass and were never revisited:
--   * app.current_role(), app.is_admin(), app.is_staff_or_admin() — already
--     SECURITY DEFINER, but pin search_path = public rather than ''.
--   * app.set_updated_at(), app.enforce_soft_delete_admin() — trigger
--     functions (SECURITY INVOKER, the Postgres default — neither carries the
--     keyword) with NO proconfig at all.
--
-- NOT currently exploitable (verified, not assumed, in AUDIT-01 §3.1.4): the
-- `public` schema grants CREATE to the database owner only — `authenticated`
-- has USAGE, not CREATE — so no application role can plant a shadow object
-- for a definer (or an invoker running with an attacker-influenced
-- search_path) to resolve. Every body below already schema-qualifies every
-- reference it makes (public.users, app.current_role(), app.is_admin()), so
-- pinning search_path = '' changes nothing about what each function resolves
-- — confirmed by re-reading each body immediately below before this change,
-- not assumed from the audit's summary.
--
-- This migration changes ONLY proconfig (via `alter function ... set
-- search_path`). No function body, security mode, grant, or return type is
-- touched. Apply ONLY via `npm run db:migration:up:local`.
-- ============================================================

-- Already SECURITY DEFINER; tighten search_path=public -> search_path=''.
-- Bodies (000002_rls_policies.sql): current_role() selects from
-- public.users (qualified); is_admin()/is_staff_or_admin() call
-- app.current_role() (qualified). Nothing here relies on an implicit
-- search_path.
alter function app.current_role() set search_path = '';
alter function app.is_admin() set search_path = '';
alter function app.is_staff_or_admin() set search_path = '';

-- SECURITY INVOKER trigger functions with no proconfig at all. Neither body
-- references anything unqualified that isn't a Postgres builtin (now(),
-- current_user) — builtins resolve via pg_catalog regardless of
-- search_path, so search_path = '' is safe here too. Security mode is left
-- untouched (still invoker, matching AUDIT-01's "not currently exploitable"
-- finding — this is hardening, not a mode change).
alter function app.set_updated_at() set search_path = '';
alter function app.enforce_soft_delete_admin() set search_path = '';
