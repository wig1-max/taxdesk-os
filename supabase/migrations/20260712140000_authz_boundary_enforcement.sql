-- ============================================================
-- TaxDesk OS — 20260712140000 Authorization boundary, MIGRATION B (enforcement)
-- Phase K.2.8.8B — deployment-safe split (B of 2).
--
-- BEHAVIOR-CHANGING. Apply ONLY AFTER Migration A is applied AND the new
-- application code (which writes through the guarded RPCs / service role) is
-- deployed and its RPC paths smoke-tested. Before this migration a direct
-- PostgREST write as staff could forge protected state; after it, the only
-- write paths are the guarded RPCs and the server-only service role.
--
-- This migration:
--   * revokes the broad `authenticated` INSERT/UPDATE on protected tables,
--   * installs narrow column grants for legitimate ordinary edits,
--   * installs the finalized-ledger lock + protected-tax_cases + actor triggers,
--   * adds the strict finalized⇒snapshot coherence constraint.
--
-- PREFLIGHT (supabase/deploy/K2.8.8B-preB-preflight.sql) MUST run first and
-- return zero rows for every "would violate enforcement" query — otherwise the
-- coherence constraint here will fail to validate existing rows. (The earlier
-- K2.8.8B-preA-preflight.sql runs before Migration A.)
--
-- Rollback: supabase/deploy/K2.8.8B-rollback.sql (executable; restores grants,
-- drops these triggers/constraints). Deleting a migration file does NOT reverse
-- an applied migration.
--
-- Local Supabase only; not deployed here.
-- ============================================================

-- ============================================================
-- 1. Privilege revocations + narrow retained grants (the grant flip).
-- ============================================================

-- 1a. tax_cases — NO table INSERT/UPDATE for authenticated. All protected
--     workflow/lock/approval/validation columns become RPC/service-only.
--     Retain a COLUMN-SCOPED INSERT for legitimate case creation
--     (createTaxPrepCaseAction) — none of the protected columns are grantable,
--     so a hostile INSERT that pre-populates finalized_at/etc → 42501.
revoke insert, update on public.tax_cases from authenticated;
grant insert (
  case_id, client_id, assessment_year, financial_year,
  itr_type_selected, itr_type_recommended, assigned_staff_id, reviewer_id
) on public.tax_cases to authenticated;

-- 1b. Engine-derived / RPC-lifecycle tables — no authenticated writes at all.
revoke insert, update on public.tax_validation_findings from authenticated;
revoke insert, update on public.tax_readiness_items       from authenticated;
revoke insert          on public.tax_computation_snapshots from authenticated;

-- 1c. History is written only inside the guarded RPCs / service role.
revoke insert on public.case_status_history from authenticated;

-- 1d. cases — remove table-wide UPDATE (which exposed `status`); retain a
--     COLUMN-SCOPED UPDATE for ordinary case edits. `status` is RPC-only.
revoke update on public.cases from authenticated;
grant update (
  title, next_action, next_action_due, next_action_owner, owner_id,
  priority, lead_source, service_data, aadhaar_required,
  aadhaar_required_reason, deleted_at
) on public.cases to authenticated;

-- 1e. Latent over-grant cleanup (TRUNCATE bypasses RLS; never used by the app).
revoke truncate on all tables in schema public from authenticated;

-- Ledger tables (tax_*_entries) intentionally KEEP authenticated INSERT/UPDATE:
-- ordinary staff editing on non-finalized cases is a legitimate path. The
-- finalized-lock is enforced by the trigger below instead of a revoke.

-- ============================================================
-- 2. Triggers + constraints — finalized immutability, protected-column guard,
--    attribution, INDEPENDENT of grants (defense in depth).
-- ============================================================

-- 2a. Serialization helper: read the parent tax case's finalized_at while taking
--     a FOR SHARE row lock. SECURITY DEFINER so the lock/read succeed regardless
--     of the (narrowed) authenticated grants. The FOR SHARE lock CONFLICTS with
--     the FOR UPDATE that finalize_tax_case / reopen_tax_case take on the same
--     row, so a ledger write concurrent with a finalization is serialized: it
--     either completes before the finalize commits, or blocks and then fails the
--     finalized-lock check below. A finalized case can never acquire a
--     post-finalization ledger edit.
create or replace function app.parent_tax_case_finalized(p_tax_case_id uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  select finalized_at from public.tax_cases where id = p_tax_case_id for share
$$;
revoke all on function app.parent_tax_case_finalized(uuid) from public;
grant execute on function app.parent_tax_case_finalized(uuid) to authenticated;

-- 2b. Ledger finalized-lock: block any authenticated INSERT/UPDATE on a ledger
--     row whose parent tax case is finalized. Server-only roles (service_role,
--     app_writer) are trusted.
-- NOTE: these trigger functions are SECURITY INVOKER (the default) — exactly
-- like app.enforce_soft_delete_admin() — so that `current_user` reflects the
-- role that issued the triggering statement (`authenticated` for an API write,
-- `service_role`/`app_writer` for a server-only write). A SECURITY DEFINER
-- trigger would report the function owner instead and never see 'authenticated'.
create or replace function app.enforce_ledger_finalized_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  -- Locks the parent FOR SHARE (serializes against a concurrent finalize).
  if app.parent_tax_case_finalized(new.tax_case_id) is not null then
    raise exception 'This tax case is finalized and read-only. Reopen it before editing ledgers.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 2c. Actor attribution on ledger rows: force created_by / updated_by to the
--     authenticated caller so a direct write cannot forge or mis-attribute them.
create or replace function app.set_ledger_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.created_by := app.current_user_id();
      new.updated_by := app.current_user_id();
    elsif tg_op = 'UPDATE' then
      new.updated_by := app.current_user_id();
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tax_income_entries','tax_tax_paid_entries',
    'tax_deduction_entries','tax_capital_gain_entries'
  ] loop
    execute format(
      'drop trigger if exists trg_%1$s_finalized_lock on public.%1$s;', t);
    execute format(
      'create trigger trg_%1$s_finalized_lock before insert or update on public.%1$s '
      || 'for each row execute function app.enforce_ledger_finalized_lock();', t);
    execute format(
      'drop trigger if exists trg_%1$s_actor on public.%1$s;', t);
    execute format(
      'create trigger trg_%1$s_actor before insert or update on public.%1$s '
      || 'for each row execute function app.set_ledger_actor();', t);
  end loop;
end $$;

-- 2d. Protected-column guard on tax_cases: an authenticated UPDATE (should one
--     ever be re-granted by mistake) must not change any protected workflow /
--     lock / approval / validation column. Independent backstop for A1/A2/A3/C1/F1.
create or replace function app.guard_tax_cases_protected_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.finalized_at            is distinct from old.finalized_at
  or new.finalized_by            is distinct from old.finalized_by
  or new.finalized_snapshot_id   is distinct from old.finalized_snapshot_id
  or new.finalization_note       is distinct from old.finalization_note
  or new.reopened_at             is distinct from old.reopened_at
  or new.reopened_by             is distinct from old.reopened_by
  or new.reopen_reason           is distinct from old.reopen_reason
  or new.client_review_status    is distinct from old.client_review_status
  or new.client_review_snapshot_id     is distinct from old.client_review_snapshot_id
  or new.client_review_sent_at   is distinct from old.client_review_sent_at
  or new.client_review_sent_by   is distinct from old.client_review_sent_by
  or new.client_approved_at      is distinct from old.client_approved_at
  or new.client_approval_captured_by   is distinct from old.client_approval_captured_by
  or new.client_approval_method  is distinct from old.client_approval_method
  or new.client_approval_reference     is distinct from old.client_approval_reference
  or new.client_changes_requested_at   is distinct from old.client_changes_requested_at
  or new.client_changes_requested_by   is distinct from old.client_changes_requested_by
  or new.client_changes_summary  is distinct from old.client_changes_summary
  or new.validation_last_run_at  is distinct from old.validation_last_run_at
  or new.validation_last_run_by  is distinct from old.validation_last_run_by
  or new.validation_rules_version is distinct from old.validation_rules_version
  or new.filing_status           is distinct from old.filing_status
  or new.e_verification_status   is distinct from old.e_verification_status
  or new.client_approval_status  is distinct from old.client_approval_status
  or new.case_status             is distinct from old.case_status
  then
    raise exception 'Protected tax_cases columns can only change through a guarded transition.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tax_cases_protected_guard on public.tax_cases;
create trigger trg_tax_cases_protected_guard
  before update on public.tax_cases
  for each row execute function app.guard_tax_cases_protected_columns();

-- 2e. Coherence: a finalized tax case must be bound to a finalization snapshot.
--     (Blocks the impossible "finalized without snapshot" state.) The preflight
--     query surfaces any pre-existing violating rows to repair before this runs.
alter table public.tax_cases
  drop constraint if exists chk_tax_cases_finalized_snapshot;
alter table public.tax_cases
  add constraint chk_tax_cases_finalized_snapshot
  check (finalized_at is null or finalized_snapshot_id is not null);
