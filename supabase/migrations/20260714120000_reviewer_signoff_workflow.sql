-- ============================================================
-- TaxDesk OS — 20260714120000 Qualified-reviewer sign-off workflow (K.2.8.9B)
--
-- ADDITIVE + enforcement in one file (local-only phase; no staged production
-- rollout for this phase). It layers a MANUAL PROFESSIONAL REVIEW track on top
-- of the K.2.8.9A eligibility gate WITHOUT altering or weakening it:
--
--   * a secure, auditable representation of a qualified tax reviewer
--     (tax_reviewer_credentials) with an admin-only credential reference that is
--     never exposed to ordinary authenticated staff,
--   * an APPEND-ONLY sign-off ledger (tax_case_reviews) that snapshots the
--     reviewer identity + qualification at decision time, so a completed sign-off
--     survives any later credential change or revocation,
--   * manual-review overlay columns on tax_cases (status + latest-decision
--     pointer + assignment), added to the protected-column guard,
--   * database helpers + FOUR guarded SECURITY DEFINER RPCs that enforce reviewer
--     qualification, active status, allowed case state, self-review prevention,
--     required reason, and allowed transitions — the browser/action layers are
--     defense-in-depth, not the sole enforcement,
--   * two curated views: qualified_reviewers (staff-safe directory, NO reference)
--     and tax_case_review_history (staff-safe sign-off history, NO reference).
--
-- Preserves ALL K.2.8.8B / K.2.8.9A hardening: SECURITY DEFINER ownership
-- (app_writer), pinned empty search_path, actor derived from auth.uid(), narrow
-- grants, audit logging, finalized immutability, and the eligibility gate.
--
-- IMPORTANT (does NOT weaken 9A): reviewer approval records an immutable
-- professional sign-off that AUTHORIZES manual handling of an unsupported /
-- special-situation case. It does NOT flip the K.2.8.9A computation eligibility
-- gate — an ineligible case still cannot auto-compute / prepare review / capture
-- approval / finalize. The manual-review track is a parallel, auditable overlay.
--
-- Reversible notes: dropping a migration file does NOT reverse it. To roll back
-- locally, supabase/deploy/K2.8.9B-rollback.sql is executable (drops the new
-- objects, restores the 9A guard body); it preserves the 9A/8B objects and data.
--
-- Local Supabase only; NOT deployed, NOT run against production.
-- ============================================================

-- ------------------------------------------------------------
-- 1. tax_reviewer_credentials — the secure reviewer representation.
--    One row per staff/admin user who is a qualified tax reviewer. The
--    credential_reference (membership / registration number) is CREDENTIAL-
--    SENSITIVE and is admin-only: ordinary staff can see WHO is an active
--    reviewer (via the qualified_reviewers view) but never the reference.
-- ------------------------------------------------------------
create table if not exists public.tax_reviewer_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id),
  qualification text not null
    check (qualification in ('chartered_accountant','advocate','tax_return_preparer','other')),
  -- Credential-sensitive: membership / registration number. Admin-only.
  credential_reference text,
  status text not null default 'active'
    check (status in ('active','inactive','revoked')),
  notes text,
  activated_at   timestamptz,
  deactivated_at timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tax_reviewer_credentials_updated_at
  before update on public.tax_reviewer_credentials
  for each row execute function app.set_updated_at();

create index if not exists idx_tax_reviewer_credentials_user_id on public.tax_reviewer_credentials (user_id);
create index if not exists idx_tax_reviewer_credentials_status on public.tax_reviewer_credentials (status);

alter table public.tax_reviewer_credentials enable row level security;

-- Base-table read is ADMIN-ONLY (so the credential_reference stays hidden from
-- ordinary staff). Writes are RPC/service-role only (no authenticated policy).
drop policy if exists tax_reviewer_credentials_select on public.tax_reviewer_credentials;
create policy tax_reviewer_credentials_select on public.tax_reviewer_credentials
  for select to authenticated using (app.is_admin());

revoke all on public.tax_reviewer_credentials from anon;
revoke insert, update, delete on public.tax_reviewer_credentials from authenticated;
grant select on public.tax_reviewer_credentials to authenticated;   -- gated by admin-only RLS
grant select, insert, update on public.tax_reviewer_credentials to app_writer;

-- upsert_reviewer_credential validates the target is an active team member, so
-- the definer role (app_writer) needs read access to public.users.
grant select on public.users to app_writer;

-- ------------------------------------------------------------
-- 2. tax_case_reviews — APPEND-ONLY sign-off ledger.
--    Every reviewer decision snapshots the reviewer identity + qualification +
--    (admin-only) credential reference AT DECISION TIME, so audit/history remain
--    accurate even if the credential is later changed or revoked. No update/
--    delete path exists for any role except the trusted server (service_role).
-- ------------------------------------------------------------
create table if not exists public.tax_case_reviews (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  reviewer_id uuid not null references public.users(id),
  -- The credential LINK is a convenience only; if a credential row is ever hard-
  -- deleted the sign-off history is still complete via the immutable qualification
  -- / reference SNAPSHOT columns below — so the link is ON DELETE SET NULL.
  reviewer_credential_id uuid references public.tax_reviewer_credentials(id) on delete set null,
  -- Historical snapshots (immutable): qualification is staff-visible; the
  -- reference snapshot is credential-sensitive → admin-only via base-table RLS.
  reviewer_qualification_snapshot text not null,
  reviewer_credential_reference_snapshot text,
  decision text not null
    check (decision in ('approved_for_progression','returned_for_changes')),
  reason text,
  -- The manual-review blocker code that required this sign-off (for compliance).
  eligibility_blocker_at_review text,
  -- Who prepared the work being reviewed (separation-of-duties evidence).
  preparer_id uuid references public.users(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_tax_case_reviews_tax_case_id on public.tax_case_reviews (tax_case_id);
create index if not exists idx_tax_case_reviews_reviewer_id on public.tax_case_reviews (reviewer_id);
create index if not exists idx_tax_case_reviews_created_at on public.tax_case_reviews (created_at);

alter table public.tax_case_reviews enable row level security;

-- Base-table read ADMIN-ONLY (protects the reference snapshot). Staff read the
-- reference-free tax_case_review_history view. No authenticated write path.
drop policy if exists tax_case_reviews_select on public.tax_case_reviews;
create policy tax_case_reviews_select on public.tax_case_reviews
  for select to authenticated using (app.is_admin());

revoke all on public.tax_case_reviews from anon;
revoke insert, update, delete on public.tax_case_reviews from authenticated;
grant select on public.tax_case_reviews to authenticated;   -- gated by admin-only RLS
grant select, insert on public.tax_case_reviews to app_writer;  -- append-only for the RPC

-- ------------------------------------------------------------
-- 3. Manual-review overlay columns on tax_cases (additive).
--    reviewer_id (assignment) is REUSED from the foundation. The overlay is
--    orthogonal to the finalize/review lifecycle; it never mutates 9A columns.
-- ------------------------------------------------------------
alter table public.tax_cases
  add column if not exists manual_review_status text not null default 'none'
    check (manual_review_status in ('none','pending','approved','changes_requested')),
  add column if not exists manual_review_id uuid references public.tax_case_reviews(id),
  add column if not exists manual_review_reviewer_id uuid references public.users(id),
  add column if not exists manual_review_decided_at timestamptz,
  add column if not exists manual_review_assigned_at timestamptz;

-- ------------------------------------------------------------
-- 4. Helper functions (SECURITY DEFINER, pinned empty search_path).
-- ------------------------------------------------------------

-- 4a. Active credential id for a user, or null. The authoritative qualification
--     check used by the assignment + sign-off RPCs.
create or replace function app.active_reviewer_credential(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.tax_reviewer_credentials c
  where c.user_id = p_user_id and c.status = 'active'
  limit 1
$$;
revoke all on function app.active_reviewer_credential(uuid) from public;
grant execute on function app.active_reviewer_credential(uuid) to app_writer;
grant execute on function app.active_reviewer_credential(uuid) to authenticated;

-- 4b. Does this case require MANUAL PROFESSIONAL REVIEW? Returns the first
--     unsupported / declared-situation blocker code, else null. This is the
--     professionally-judged, profile-level subset of the 9A gate (unsupported
--     residency / category / declared special situations) — NOT mere profile
--     incompleteness (which the preparer just fills in) and NOT ledger-support
--     (resolved in Ledgers). Read from live tax_cases + clients, so it cannot be
--     forged by the caller. Mirrors src/lib/tax-desk/reviewer.ts.
create or replace function app.tax_case_requires_manual_review(p_tax_case_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res text;
  v_cat text;
  v_situations text[];
begin
  select tc.residential_status, tc.taxpayer_category, tc.declared_special_situations
    into v_res, v_cat, v_situations
    from public.tax_cases tc
    where tc.id = p_tax_case_id;
  if not found then
    return null;
  end if;

  if v_res is not null and v_res <> 'resident' then
    return 'UNSUPPORTED_RESIDENTIAL_STATUS';
  end if;
  if v_cat is not null and v_cat <> 'individual' then
    return 'UNSUPPORTED_TAXPAYER_CATEGORY';
  end if;
  if coalesce(array_length(v_situations, 1), 0) > 0 then
    return 'MANUAL_PROFESSIONAL_REVIEW_REQUIRED';
  end if;
  return null;
end;
$$;
revoke all on function app.tax_case_requires_manual_review(uuid) from public;
grant execute on function app.tax_case_requires_manual_review(uuid) to app_writer;
grant execute on function app.tax_case_requires_manual_review(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. Credential-management RPCs (ADMIN ONLY, owner app_writer).
--    Actor is always app.current_user_id(); idempotent per event_id.
-- ------------------------------------------------------------

-- 5a. upsert_reviewer_credential — create or update qualification + reference.
create or replace function public.upsert_reviewer_credential(
  p_user_id      uuid,
  p_qualification text,
  p_reference    text,
  p_notes        text,
  p_event_id     uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_cred_id uuid;
  v_existing uuid;
begin
  if not app.is_admin() then
    raise exception 'Only an admin can manage reviewer credentials.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if p_user_id is null then
    raise exception 'A user is required.' using errcode = '22023';
  end if;
  if p_qualification not in ('chartered_accountant','advocate','tax_return_preparer','other') then
    raise exception 'Invalid qualification.' using errcode = '22023';
  end if;
  -- The target must be an active staff/admin user.
  if not exists (select 1 from public.users u
                 where u.id = p_user_id and u.is_active = true and u.deleted_at is null) then
    raise exception 'The selected user is not an active team member.' using errcode = '22023';
  end if;

  if app.event_already_applied(p_event_id, 'tax_reviewer_credential.saved', v_actor, p_user_id::text) then
    return p_event_id;
  end if;

  select id into v_existing from public.tax_reviewer_credentials where user_id = p_user_id for update;
  if v_existing is null then
    insert into public.tax_reviewer_credentials
      (user_id, qualification, credential_reference, status, notes, activated_at, created_by, updated_by)
    values
      (p_user_id, p_qualification, p_reference, 'active', p_notes, now(), v_actor, v_actor)
    returning id into v_cred_id;
  else
    update public.tax_reviewer_credentials set
      qualification = p_qualification,
      credential_reference = p_reference,
      notes = p_notes,
      updated_by = v_actor
    where id = v_existing
    returning id into v_cred_id;
  end if;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, after, event_id)
  values
    (v_actor, v_role, 'tax_reviewer_credential.saved', 'tax_reviewer_credentials', v_cred_id::text,
     jsonb_build_object('credential_id', v_cred_id, 'user_id', p_user_id,
                        'qualification', p_qualification, 'has_reference', p_reference is not null,
                        'created', v_existing is null),
     p_event_id);

  return p_event_id;
end;
$$;

-- 5b. set_reviewer_credential_status — activate / deactivate / revoke.
create or replace function public.set_reviewer_credential_status(
  p_credential_id uuid,
  p_status        text,
  p_reason        text,
  p_event_id      uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_prev  text;
  v_user  uuid;
begin
  if not app.is_admin() then
    raise exception 'Only an admin can manage reviewer credentials.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if p_status not in ('active','inactive','revoked') then
    raise exception 'Invalid credential status.' using errcode = '22023';
  end if;

  if app.event_already_applied(p_event_id, 'tax_reviewer_credential.status_changed', v_actor, p_credential_id::text) then
    return p_event_id;
  end if;

  select status, user_id into v_prev, v_user
    from public.tax_reviewer_credentials where id = p_credential_id for update;
  if v_prev is null then
    raise exception 'Reviewer credential not found.' using errcode = 'P0002';
  end if;

  update public.tax_reviewer_credentials set
    status = p_status,
    activated_at   = case when p_status = 'active'   then now() else activated_at end,
    deactivated_at = case when p_status = 'inactive' then now() else deactivated_at end,
    revoked_at     = case when p_status = 'revoked'  then now() else revoked_at end,
    revoked_reason = case when p_status = 'revoked'  then p_reason else revoked_reason end,
    updated_by     = v_actor
  where id = p_credential_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, before, after, event_id)
  values
    (v_actor, v_role, 'tax_reviewer_credential.status_changed', 'tax_reviewer_credentials',
     p_credential_id::text,
     jsonb_build_object('status', v_prev),
     jsonb_build_object('credential_id', p_credential_id, 'user_id', v_user,
                        'status', p_status, 'has_reason', p_reason is not null),
     p_event_id);

  return p_event_id;
end;
$$;

-- ------------------------------------------------------------
-- 6. Manual-review workflow RPCs (STAFF/ADMIN, owner app_writer).
-- ------------------------------------------------------------

-- 6a. assign_case_reviewer — route a case that requires manual review to a
--     qualified, active reviewer. Sets the assignment + pending status.
create or replace function public.assign_case_reviewer(
  p_tax_case_id uuid,
  p_reviewer_id uuid,
  p_event_id    uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_case_id uuid;
  v_finalized timestamptz;
  v_status text;
  v_requires text;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if app.event_already_applied(p_event_id, 'tax_manual_review.assigned', v_actor, p_tax_case_id::text) then
    return p_event_id;
  end if;

  select tc.case_id, tc.finalized_at, tc.manual_review_status
    into v_case_id, v_finalized, v_status
    from public.tax_cases tc where tc.id = p_tax_case_id for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized. Manual review is read-only.' using errcode = '42501';
  end if;

  v_requires := app.tax_case_requires_manual_review(p_tax_case_id);
  if v_requires is null then
    raise exception 'This case does not require manual professional review.' using errcode = '22023';
  end if;
  if v_status = 'approved' then
    raise exception 'This case already has a completed reviewer sign-off.' using errcode = '22023';
  end if;
  if app.active_reviewer_credential(p_reviewer_id) is null then
    raise exception 'The selected reviewer is not an active qualified reviewer.' using errcode = '22023';
  end if;

  update public.tax_cases set
    reviewer_id               = p_reviewer_id,
    manual_review_status      = 'pending',
    manual_review_assigned_at = now(),
    updated_by                = v_actor
  where id = p_tax_case_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_manual_review.assigned', 'tax_cases', p_tax_case_id::text, v_case_id,
     jsonb_build_object('tax_case_id', p_tax_case_id, 'reviewer_id', p_reviewer_id, 'blocker', v_requires),
     p_event_id);

  return p_event_id;
end;
$$;

-- 6b. record_reviewer_signoff — the core sign-off. Enforces (DB-first): reviewer
--     qualification + active status, case requires review, allowed transition,
--     self-review prevention (reviewer <> preparer), required reason on a
--     return, and finalized immutability. Writes an APPEND-ONLY tax_case_reviews
--     row (with the qualification/reference SNAPSHOT) + the overlay pointer +
--     audit, all in ONE transaction.
create or replace function public.record_reviewer_signoff(
  p_tax_case_id uuid,
  p_decision    text,
  p_reason      text,
  p_event_id    uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_case_id uuid;
  v_finalized timestamptz;
  v_status text;
  v_assigned uuid;
  v_profile_by uuid;
  v_requires text;
  v_cred_id uuid;
  v_qual text;
  v_ref text;
  v_snap_creator uuid;
  v_preparer uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_audit_action text;
  v_review_id uuid;
  v_new_status text;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if p_decision not in ('approved_for_progression','returned_for_changes') then
    raise exception 'Invalid reviewer decision.' using errcode = '22023';
  end if;
  if p_decision = 'returned_for_changes' and v_reason is null then
    raise exception 'A reason is required when returning a case for changes.' using errcode = '22023';
  end if;

  v_audit_action := case when p_decision = 'approved_for_progression'
                         then 'tax_manual_review.approved'
                         else 'tax_manual_review.returned' end;
  v_new_status   := case when p_decision = 'approved_for_progression'
                         then 'approved' else 'changes_requested' end;

  if app.event_already_applied(p_event_id, v_audit_action, v_actor, p_tax_case_id::text) then
    return p_event_id;  -- idempotent replay of the same decision
  end if;

  select tc.case_id, tc.finalized_at, tc.manual_review_status,
         tc.assigned_staff_id, tc.taxpayer_profile_updated_by
    into v_case_id, v_finalized, v_status, v_assigned, v_profile_by
    from public.tax_cases tc where tc.id = p_tax_case_id for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized. Manual review is read-only.' using errcode = '42501';
  end if;

  -- State gate: the case must actually require manual professional review.
  v_requires := app.tax_case_requires_manual_review(p_tax_case_id);
  if v_requires is null then
    raise exception 'This case does not require manual professional review.' using errcode = '22023';
  end if;
  -- Allowed transition: cannot re-decide an already-approved case.
  if v_status = 'approved' then
    raise exception 'This case already has a completed reviewer sign-off.' using errcode = '22023';
  end if;

  -- Qualification gate: the actor must be an ACTIVE qualified reviewer.
  v_cred_id := app.active_reviewer_credential(v_actor);
  if v_cred_id is null then
    raise exception 'You are not an active qualified reviewer.' using errcode = '42501';
  end if;

  -- Self-review prevention (separation of duties). The role model is admin/staff
  -- only (no dedicated reviewer role), so the enforceable boundary is: the
  -- signing reviewer must not be the preparer. "Preparer" = whichever of these
  -- attributions is present: the assigned staff, the taxpayer-profile author, or
  -- the latest computation snapshot creator.
  select s.created_by into v_snap_creator
    from public.tax_computation_snapshots s
    where s.tax_case_id = p_tax_case_id
    order by s.created_at desc limit 1;
  if v_actor = v_assigned or v_actor = v_profile_by or v_actor = v_snap_creator then
    raise exception 'A reviewer cannot sign off on a case they prepared (separation of duties).'
      using errcode = '42501';
  end if;

  v_preparer := coalesce(v_assigned, v_profile_by, v_snap_creator);

  select qualification, credential_reference into v_qual, v_ref
    from public.tax_reviewer_credentials where id = v_cred_id;

  -- Append-only sign-off record with the immutable reviewer/qualification snapshot.
  insert into public.tax_case_reviews
    (tax_case_id, reviewer_id, reviewer_credential_id, reviewer_qualification_snapshot,
     reviewer_credential_reference_snapshot, decision, reason, eligibility_blocker_at_review,
     preparer_id, created_by)
  values
    (p_tax_case_id, v_actor, v_cred_id, v_qual, v_ref, p_decision, v_reason, v_requires,
     v_preparer, v_actor)
  returning id into v_review_id;

  update public.tax_cases set
    manual_review_status      = v_new_status,
    manual_review_id          = v_review_id,
    manual_review_reviewer_id = v_actor,
    manual_review_decided_at  = now(),
    updated_by                = v_actor
  where id = p_tax_case_id;

  -- Audit stores the DECISION + blocker + snapshot ids only. The free-text reason
  -- is screened at the action layer and is NOT copied into audit metadata (same
  -- policy as client-review reference/summary text).
  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, v_audit_action, 'tax_case_reviews', v_review_id::text, v_case_id,
     jsonb_build_object('tax_case_id', p_tax_case_id, 'review_id', v_review_id,
                        'decision', p_decision, 'blocker', v_requires,
                        'reviewer_qualification', v_qual, 'has_reason', v_reason is not null),
     p_event_id);

  return p_event_id;
end;
$$;

-- ------------------------------------------------------------
-- 7. Curated, staff-safe views (NO credential reference).
--    Owned by the migration role (postgres) so they project the admin-only base
--    tables for ordinary staff WITHOUT exposing credential-sensitive columns.
-- ------------------------------------------------------------
create or replace view public.qualified_reviewers as
  select c.id as credential_id, c.user_id, u.full_name, u.email,
         c.qualification, c.status, c.created_at
  from public.tax_reviewer_credentials c
  join public.users u on u.id = c.user_id
  where u.is_active = true and u.deleted_at is null;

revoke all on public.qualified_reviewers from anon;
grant select on public.qualified_reviewers to authenticated;

create or replace view public.tax_case_review_history as
  select r.id, r.tax_case_id, r.reviewer_id, u.full_name as reviewer_name,
         r.reviewer_qualification_snapshot, r.decision, r.reason,
         r.eligibility_blocker_at_review, r.preparer_id, r.created_at
  from public.tax_case_reviews r
  join public.users u on u.id = r.reviewer_id;

revoke all on public.tax_case_review_history from anon;
grant select on public.tax_case_review_history to authenticated;

-- ------------------------------------------------------------
-- 8. Extend the protected-column guard to cover the new manual-review overlay
--    columns + reviewer_id (assignment). Re-created verbatim from 20260713120000
--    with the new columns appended. An authenticated direct UPDATE that touches
--    any of these → 42501 (they change only through the guarded RPCs).
-- ------------------------------------------------------------
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
  or new.residential_status      is distinct from old.residential_status
  or new.taxpayer_category       is distinct from old.taxpayer_category
  or new.declared_special_situations   is distinct from old.declared_special_situations
  or new.taxpayer_profile_updated_at   is distinct from old.taxpayer_profile_updated_at
  or new.taxpayer_profile_updated_by   is distinct from old.taxpayer_profile_updated_by
  or new.reviewer_id             is distinct from old.reviewer_id
  or new.manual_review_status    is distinct from old.manual_review_status
  or new.manual_review_id        is distinct from old.manual_review_id
  or new.manual_review_reviewer_id     is distinct from old.manual_review_reviewer_id
  or new.manual_review_decided_at is distinct from old.manual_review_decided_at
  or new.manual_review_assigned_at is distinct from old.manual_review_assigned_at
  then
    raise exception 'Protected tax_cases columns can only change through a guarded transition.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 9. Ownership + least-privilege grants for the new RPCs.
--    Owned by app_writer; callable only by authenticated (never anon/public).
--    Column/row authorization lives in the bodies above.
-- ------------------------------------------------------------
grant create on schema public to app_writer;
do $$
declare
  fn text;
  fns text[] := array[
    'upsert_reviewer_credential(uuid,text,text,text,uuid)',
    'set_reviewer_credential_status(uuid,text,text,uuid)',
    'assign_case_reviewer(uuid,uuid,uuid)',
    'record_reviewer_signoff(uuid,text,text,uuid)'
  ];
begin
  foreach fn in array fns loop
    execute format('alter function public.%s owner to app_writer;', fn);
    execute format('revoke all on function public.%s from public;', fn);
    execute format('revoke all on function public.%s from anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;
revoke create on schema public from app_writer;
