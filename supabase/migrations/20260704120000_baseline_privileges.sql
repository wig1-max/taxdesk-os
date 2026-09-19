-- ============================================================
-- TaxDesk OS — 20260704120000 baseline privileges
--
-- ROOT CAUSE THIS FIXES
-- 000002 ("grant shaping") was written on the assumption that the
-- platform's default ACLs already give anon/authenticated/
-- service_role broad privileges on every new table, so it only
-- REVOKED the exceptions. On this stack, migrations run as
-- `postgres` with no such default privileges configured, so:
--   * `authenticated` ended up with almost no table privileges
--     (only the explicit clients column grants + 3 views), and
--   * `service_role` ended up with NO privileges at all — it
--     bypasses RLS but still needs ordinary SQL grants.
-- Result: permission-denied on services/templates/settings reads
-- (empty dropdowns/pages), on every service-role write (PAN
-- client insert, audit_logs, display codes), and on public.users
-- (login) — previously hotfixed by 20260704100000.
--
-- RLS was never the problem: PostgreSQL checks table privileges
-- BEFORE row policies. This migration makes the intended privilege
-- matrix explicit and reproducible on `supabase db reset` and
-- hosted `db push`. It adds NOTHING for anon, keeps audit_logs
-- append-only via service role, and keeps pan_encrypted
-- unreachable for `authenticated` (column-scoped grants only).
-- ============================================================

-- Schema usage. anon deliberately receives nothing anywhere.
grant usage on schema public to authenticated, service_role;

-- ------------------------------------------------------------
-- service_role: full data access. Server-only by construction
-- (src/lib/supabase/admin.ts is `import "server-only"` and the
-- key never ships to the browser). Needed for: PAN write/reveal,
-- audit() writer, display-code allocation, public upload flow,
-- signed-URL/file routes, purge.
-- ------------------------------------------------------------
grant all privileges on all tables in schema public to service_role;
-- audit_logs.id is GENERATED ALWAYS AS IDENTITY — inserts need
-- usage on its sequence.
grant usage, select on all sequences in schema public to service_role;

-- Future tables created by migrations (role postgres) get
-- service_role access automatically, so this class of bug cannot
-- recur for the server-side path. `authenticated` intentionally
-- gets NO default privileges: every new table must opt in
-- explicitly, next to its RLS policies.
alter default privileges for role postgres in schema public
  grant all privileges on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

-- ------------------------------------------------------------
-- authenticated: explicit per-table matrix mirroring the RLS
-- design in 000002. Row access is still gated by RLS policies
-- (staff/admin via app.is_staff_or_admin(); config + users writes
-- admin-only via app.is_admin()). NOTE: public.clients is
-- intentionally ABSENT from these table-level grants — its
-- SELECT/INSERT/UPDATE are column-scoped (below) so that
-- pan_encrypted stays unreadable and unwritable for API users.
-- ------------------------------------------------------------

-- Read + write tables.
grant select, insert, update on
  public.users,
  public.client_contacts,
  public.cases,
  public.case_documents,
  public.upload_links,
  public.uploaded_files,
  public.fees,
  public.followups,
  public.physical_documents,
  public.identity_reviews,
  public.services,
  public.document_requirements,
  public.pdf_templates,
  public.message_templates,
  public.settings
to authenticated;

-- Append-only tables: select + insert, no update/delete
-- (matches 000002, which also created no update policies).
grant select, insert on
  public.case_status_history,
  public.consent_records,
  public.payments,
  public.generated_pdfs,
  public.case_messages
to authenticated;

-- audit_logs: read-only for the API role (RLS limits reads to
-- admins); rows are written solely by the service-role audit()
-- helper. No insert/update/delete grant.
grant select on public.audit_logs to authenticated;

-- Views (security_invoker: base-table RLS and column grants
-- still apply underneath).
grant select on
  public.clients_safe,
  public.identity_reviews_completeness,
  public.fee_balances
to authenticated;

-- ------------------------------------------------------------
-- public.clients: re-assert the exact column-scoped grants from
-- 000002 (select) and 000005 (insert/update) so this migration
-- leaves a deterministic end state even if ad-hoc grants were
-- applied manually before it. pan_encrypted: service_role only.
-- pan_last4: readable (masked display/search), writes service-
-- role only so it can never drift from the ciphertext.
-- ------------------------------------------------------------
revoke select, insert, update, delete on public.clients from authenticated;

grant select (
  id, display_code, full_name, primary_phone, email, pan_last4,
  date_of_birth, address_line1, address_line2, city, state, pincode,
  kyc_status, notes, created_by, created_at, updated_at, deleted_at
) on public.clients to authenticated;

grant insert (
  id, display_code, full_name, primary_phone, email,
  date_of_birth, address_line1, address_line2, city, state, pincode,
  kyc_status, notes, created_by
) on public.clients to authenticated;

grant update (
  display_code, full_name, primary_phone, email,
  date_of_birth, address_line1, address_line2, city, state, pincode,
  kyc_status, notes,
  deleted_at  -- soft delete/restore; admin-gated by trigger
              -- app.enforce_soft_delete_admin() from 000002
) on public.clients to authenticated;

-- ------------------------------------------------------------
-- Defensive re-assertion: anon gets nothing (000002 policy).
-- ------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
