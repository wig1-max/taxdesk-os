-- ============================================================
-- TaxDesk OS — 000002 RLS policies, helpers, grants
--
-- Principles:
--   * Deny by default. NO anonymous policies anywhere.
--   * The public /upload/[token] flow uses the service role from a
--     server route (Phase D). Service role bypasses RLS by design,
--     so nothing here needs to open access for it.
--   * Append-only tables get no UPDATE/DELETE policies AND lose
--     the privileges at the grant level.
--   * pan_encrypted is unreadable by authenticated users at the
--     column-grant level; only the service role (admin PAN-reveal
--     server action, audited) can read it.
-- ============================================================

-- ------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so policies on other tables
-- can consult public.users without recursive RLS evaluation.
-- ------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid()
$$;

create or replace function app.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.users u
  where u.id = auth.uid()
    and u.is_active = true
    and u.deleted_at is null
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app.current_role() = 'admin', false)
$$;

create or replace function app.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app.current_role() in ('admin','staff'), false)
$$;

revoke all on function app.current_user_id() from public, anon;
revoke all on function app.current_role() from public, anon;
revoke all on function app.is_admin() from public, anon;
revoke all on function app.is_staff_or_admin() from public, anon;
grant execute on function app.current_user_id() to authenticated;
grant execute on function app.current_role() to authenticated;
grant execute on function app.is_admin() to authenticated;
grant execute on function app.is_staff_or_admin() to authenticated;
grant usage on schema app to authenticated;

-- ------------------------------------------------------------
-- Soft-delete guard: only admins (or non-API roles, e.g. the
-- service role used by audited server actions / purge jobs) may
-- change deleted_at on major records. API users connect as role
-- 'authenticated'; service role connects as 'service_role'.
-- ------------------------------------------------------------
create or replace function app.enforce_soft_delete_admin()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and current_user = 'authenticated'
     and not app.is_admin() then
    raise exception 'Only admins can soft delete or restore this record.';
  end if;
  return new;
end;
$$;

create trigger trg_clients_soft_delete_admin
  before update on public.clients
  for each row execute function app.enforce_soft_delete_admin();
create trigger trg_cases_soft_delete_admin
  before update on public.cases
  for each row execute function app.enforce_soft_delete_admin();
create trigger trg_uploaded_files_soft_delete_admin
  before update on public.uploaded_files
  for each row execute function app.enforce_soft_delete_admin();
create trigger trg_fees_soft_delete_admin
  before update on public.fees
  for each row execute function app.enforce_soft_delete_admin();
create trigger trg_physical_documents_soft_delete_admin
  before update on public.physical_documents
  for each row execute function app.enforce_soft_delete_admin();

-- ------------------------------------------------------------
-- Grant shaping (belt and suspenders under RLS)
-- ------------------------------------------------------------
-- Anonymous role: nothing, anywhere.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Hard DELETE is never used by the app (soft delete only;
-- append-only corrections happen via new rows).
revoke delete on all tables in schema public from authenticated;

-- Append-only tables: also remove UPDATE privilege.
revoke update on public.case_status_history from authenticated;
revoke update on public.consent_records from authenticated;
revoke update on public.payments from authenticated;
revoke update on public.generated_pdfs from authenticated;
revoke update on public.case_messages from authenticated;
revoke update on public.audit_logs from authenticated;

-- audit_logs: written exclusively by the server-side audit()
-- helper using the service role.
revoke insert on public.audit_logs from authenticated;

-- pan_encrypted: column-level lockout for API users. Writes go
-- through columns grants below; reads are impossible for
-- 'authenticated' — only the service role can read it.
revoke select on public.clients from authenticated;
grant select (
  id, display_code, full_name, primary_phone, email, pan_last4,
  date_of_birth, address_line1, address_line2, city, state, pincode,
  kyc_status, notes, created_by, created_at, updated_at, deleted_at
) on public.clients to authenticated;

-- Views are safe by construction; make grants explicit.
revoke all on public.clients_safe from anon;
revoke all on public.identity_reviews_completeness from anon;
revoke all on public.fee_balances from anon;
grant select on public.clients_safe to authenticated;
grant select on public.identity_reviews_completeness to authenticated;
grant select on public.fee_balances to authenticated;

-- ------------------------------------------------------------
-- Enable RLS on every table
-- ------------------------------------------------------------
alter table public.users enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.services enable row level security;
alter table public.cases enable row level security;
alter table public.case_status_history enable row level security;
alter table public.document_requirements enable row level security;
alter table public.case_documents enable row level security;
alter table public.upload_links enable row level security;
alter table public.uploaded_files enable row level security;
alter table public.consent_records enable row level security;
alter table public.fees enable row level security;
alter table public.payments enable row level security;
alter table public.pdf_templates enable row level security;
alter table public.generated_pdfs enable row level security;
alter table public.message_templates enable row level security;
alter table public.case_messages enable row level security;
alter table public.followups enable row level security;
alter table public.audit_logs enable row level security;
alter table public.settings enable row level security;
alter table public.physical_documents enable row level security;
alter table public.identity_reviews enable row level security;

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
create policy users_select on public.users
  for select to authenticated
  using (app.is_staff_or_admin());

create policy users_insert_admin on public.users
  for insert to authenticated
  with check (app.is_admin());

create policy users_update_admin on public.users
  for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());
-- Self-service profile edits (own name/phone) deferred to Phase D
-- server action; column-scoped policies are not expressible in RLS.

-- ------------------------------------------------------------
-- Core business tables: staff/admin read + write.
-- Soft delete/restore is admin-only via the trigger above.
-- ------------------------------------------------------------
-- clients
create policy clients_select on public.clients
  for select to authenticated using (app.is_staff_or_admin());
create policy clients_insert on public.clients
  for insert to authenticated with check (app.is_staff_or_admin());
create policy clients_update on public.clients
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- client_contacts
create policy client_contacts_select on public.client_contacts
  for select to authenticated using (app.is_staff_or_admin());
create policy client_contacts_insert on public.client_contacts
  for insert to authenticated with check (app.is_staff_or_admin());
create policy client_contacts_update on public.client_contacts
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- cases
create policy cases_select on public.cases
  for select to authenticated using (app.is_staff_or_admin());
create policy cases_insert on public.cases
  for insert to authenticated with check (app.is_staff_or_admin());
create policy cases_update on public.cases
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- case_documents
create policy case_documents_select on public.case_documents
  for select to authenticated using (app.is_staff_or_admin());
create policy case_documents_insert on public.case_documents
  for insert to authenticated with check (app.is_staff_or_admin());
create policy case_documents_update on public.case_documents
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- upload_links (revocation = update of revoked_at)
create policy upload_links_select on public.upload_links
  for select to authenticated using (app.is_staff_or_admin());
create policy upload_links_insert on public.upload_links
  for insert to authenticated with check (app.is_staff_or_admin());
create policy upload_links_update on public.upload_links
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- uploaded_files (client-link inserts happen via service role)
create policy uploaded_files_select on public.uploaded_files
  for select to authenticated using (app.is_staff_or_admin());
create policy uploaded_files_insert on public.uploaded_files
  for insert to authenticated with check (app.is_staff_or_admin());
create policy uploaded_files_update on public.uploaded_files
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- fees
create policy fees_select on public.fees
  for select to authenticated using (app.is_staff_or_admin());
create policy fees_insert on public.fees
  for insert to authenticated with check (app.is_staff_or_admin());
create policy fees_update on public.fees
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());
-- Note: fee override/percent changes are admin-only BUSINESS rules,
-- enforced in the Phase D server action + audited. RLS keeps the
-- coarse staff/admin boundary only.

-- followups
create policy followups_select on public.followups
  for select to authenticated using (app.is_staff_or_admin());
create policy followups_insert on public.followups
  for insert to authenticated with check (app.is_staff_or_admin());
create policy followups_update on public.followups
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- physical_documents
create policy physical_documents_select on public.physical_documents
  for select to authenticated using (app.is_staff_or_admin());
create policy physical_documents_insert on public.physical_documents
  for insert to authenticated with check (app.is_staff_or_admin());
create policy physical_documents_update on public.physical_documents
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- identity_reviews
create policy identity_reviews_select on public.identity_reviews
  for select to authenticated using (app.is_staff_or_admin());
create policy identity_reviews_insert on public.identity_reviews
  for insert to authenticated with check (app.is_staff_or_admin());
create policy identity_reviews_update on public.identity_reviews
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- ------------------------------------------------------------
-- Config tables: staff read, admin write
-- ------------------------------------------------------------
create policy services_select on public.services
  for select to authenticated using (app.is_staff_or_admin());
create policy services_write_admin on public.services
  for insert to authenticated with check (app.is_admin());
create policy services_update_admin on public.services
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

create policy document_requirements_select on public.document_requirements
  for select to authenticated using (app.is_staff_or_admin());
create policy document_requirements_insert_admin on public.document_requirements
  for insert to authenticated with check (app.is_admin());
create policy document_requirements_update_admin on public.document_requirements
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

create policy pdf_templates_select on public.pdf_templates
  for select to authenticated using (app.is_staff_or_admin());
create policy pdf_templates_insert_admin on public.pdf_templates
  for insert to authenticated with check (app.is_admin());
create policy pdf_templates_update_admin on public.pdf_templates
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

create policy message_templates_select on public.message_templates
  for select to authenticated using (app.is_staff_or_admin());
create policy message_templates_insert_admin on public.message_templates
  for insert to authenticated with check (app.is_admin());
create policy message_templates_update_admin on public.message_templates
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

create policy settings_select on public.settings
  for select to authenticated using (app.is_staff_or_admin());
create policy settings_insert_admin on public.settings
  for insert to authenticated with check (app.is_admin());
create policy settings_update_admin on public.settings
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

-- ------------------------------------------------------------
-- Append-only tables: select + insert only (no update/delete
-- policies exist, and privileges were revoked above).
-- ------------------------------------------------------------
create policy case_status_history_select on public.case_status_history
  for select to authenticated using (app.is_staff_or_admin());
create policy case_status_history_insert on public.case_status_history
  for insert to authenticated with check (app.is_staff_or_admin());

create policy consent_records_select on public.consent_records
  for select to authenticated using (app.is_staff_or_admin());
create policy consent_records_insert on public.consent_records
  for insert to authenticated with check (app.is_staff_or_admin());

create policy payments_select on public.payments
  for select to authenticated using (app.is_staff_or_admin());
create policy payments_insert on public.payments
  for insert to authenticated with check (app.is_staff_or_admin());

create policy generated_pdfs_select on public.generated_pdfs
  for select to authenticated using (app.is_staff_or_admin());
create policy generated_pdfs_insert on public.generated_pdfs
  for insert to authenticated with check (app.is_staff_or_admin());

create policy case_messages_select on public.case_messages
  for select to authenticated using (app.is_staff_or_admin());
create policy case_messages_insert on public.case_messages
  for insert to authenticated with check (app.is_staff_or_admin());

-- audit_logs: admin read only; NO authenticated insert policy —
-- rows are written solely by the service-role audit() helper.
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated using (app.is_admin());
