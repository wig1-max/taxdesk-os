-- ============================================================
-- TaxDesk OS — 20260713120000 Computation eligibility gate (K.2.8.9A)
--
-- ADDITIVE + enforcement in one file (local-only phase; no staged production
-- rollout for this phase). It:
--   * adds nullable taxpayer-profile columns + a declared-special-situations
--     array to tax_cases (DOB is REUSED from clients.date_of_birth, not
--     duplicated),
--   * adds app.tax_case_eligibility_blocked() — the authoritative DB backstop
--     for the profile / declared-situation subset of eligibility,
--   * adds the guarded save_taxpayer_profile() RPC (writes clients.date_of_birth
--     + tax_cases profile columns + audit atomically),
--   * extends the three progression RPCs (prepare_client_review,
--     capture_client_approval, finalize_tax_case) with an eligibility assertion
--     so an authenticated caller cannot advance an ineligible case even by
--     calling the RPC directly,
--   * extends the tax_cases protected-column guard to cover the new profile
--     columns (defense in depth).
--
-- Preserves all K.2.8.8B hardening: SECURITY DEFINER ownership (app_writer),
-- pinned empty search_path, actor derived from auth.uid(), narrow grants,
-- audit logging, finalized-ledger protection, protected-column guards.
--
-- Reversible notes: dropping a migration file does NOT reverse it. To roll back
-- locally, `supabase db reset` re-applies from scratch.
--
-- Local Supabase only; NOT deployed, NOT run against production.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Taxpayer-profile columns on tax_cases (additive, nullable).
--    DOB is reused from clients.date_of_birth — intentionally NOT duplicated.
-- ------------------------------------------------------------
alter table public.tax_cases
  add column if not exists residential_status text
    check (residential_status is null
           or residential_status in ('resident','non_resident','not_ordinarily_resident')),
  add column if not exists taxpayer_category text
    check (taxpayer_category is null
           or taxpayer_category in ('individual','huf')),
  add column if not exists declared_special_situations text[] not null default '{}',
  add column if not exists taxpayer_profile_updated_at timestamptz,
  add column if not exists taxpayer_profile_updated_by uuid references public.users(id);

-- Every declared situation must be one of the known structured codes (no free
-- text). `<@` = "array is contained by" the allowed set.
alter table public.tax_cases
  drop constraint if exists chk_tax_cases_declared_situations;
alter table public.tax_cases
  add constraint chk_tax_cases_declared_situations
  check (declared_special_situations <@ array[
    'business_or_professional_income','foreign_income_or_assets','virtual_digital_assets',
    'futures_and_options','clubbing_of_income','brought_forward_losses',
    'agricultural_special_rate','nonresident_special_rate','surcharge_or_marginal_relief',
    'other_unsupported'
  ]::text[]);

-- The profile RPC (owned by app_writer) writes the client's DOB atomically with
-- the case profile columns. Grant the least privilege needed for that read+write.
grant select on public.clients to app_writer;
grant update (date_of_birth) on public.clients to app_writer;

-- ------------------------------------------------------------
-- 2. app.tax_case_eligibility_blocked(tax_case_id) → first blocker code | null
--    The AUTHORITATIVE database backstop for the profile / declared-situation
--    subset of the canonical evaluator (src/lib/tax-desk/eligibility.ts). It is
--    read from live tax_cases + clients data, so a caller cannot forge it. It
--    deliberately does NOT re-derive ledger "meaningful data" / unsupported
--    entries or validation findings — those are enforced where they already are:
--    snapshot creation (a COMPLETE snapshot cannot exist for an ineligible case)
--    and the existing open-blocking-findings checks. Blocker ORDER matches the
--    TypeScript evaluator so DB and app agree on the first actionable item.
-- ------------------------------------------------------------
create or replace function app.tax_case_eligibility_blocked(p_tax_case_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ay text;
  v_res text;
  v_cat text;
  v_dob date;
  v_situations text[];
begin
  select tc.assessment_year, tc.residential_status, tc.taxpayer_category,
         c.date_of_birth, tc.declared_special_situations
    into v_ay, v_res, v_cat, v_dob, v_situations
    from public.tax_cases tc
    join public.clients c on c.id = tc.client_id
    where tc.id = p_tax_case_id;
  if not found then
    return 'TAX_CASE_NOT_FOUND';
  end if;

  -- A. profile completeness
  if v_dob is null then return 'PROFILE_DOB_MISSING'; end if;
  if v_res is null then return 'PROFILE_RESIDENTIAL_STATUS_MISSING'; end if;
  if v_cat is null then return 'PROFILE_CATEGORY_MISSING'; end if;
  if v_ay <> '2026-27' then return 'PROFILE_ASSESSMENT_YEAR_UNSUPPORTED'; end if;

  -- C1. unsupported profile values
  if v_res <> 'resident' then return 'UNSUPPORTED_RESIDENTIAL_STATUS'; end if;
  if v_cat <> 'individual' then return 'UNSUPPORTED_TAXPAYER_CATEGORY'; end if;

  -- C3. any declared unsupported situation → manual professional review
  if coalesce(array_length(v_situations, 1), 0) > 0 then
    return 'MANUAL_PROFESSIONAL_REVIEW_REQUIRED';
  end if;

  return null;
end;
$$;
revoke all on function app.tax_case_eligibility_blocked(uuid) from public;
grant execute on function app.tax_case_eligibility_blocked(uuid) to app_writer;
grant execute on function app.tax_case_eligibility_blocked(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Guarded save_taxpayer_profile RPC (SECURITY DEFINER, owner app_writer).
--    Writes clients.date_of_birth + tax_cases profile columns + audit in ONE
--    transaction. Actor is always app.current_user_id() (never a parameter).
--    Emits a profile-eligibility transition audit event when the profile-subset
--    blocked state flips (blocked↔eligible).
-- ------------------------------------------------------------
create or replace function public.save_taxpayer_profile(
  p_tax_case_id       uuid,
  p_date_of_birth     date,
  p_residential_status text,
  p_taxpayer_category text,
  p_declared_situations text[],
  p_event_id          uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_case_id uuid;
  v_client_id uuid;
  v_finalized timestamptz;
  v_blocked_before text;
  v_blocked_after text;
  v_situations text[] := coalesce(p_declared_situations, '{}');
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  -- Validate structured inputs at the boundary (belt & suspenders vs CHECKs).
  if p_residential_status is not null
     and p_residential_status not in ('resident','non_resident','not_ordinarily_resident') then
    raise exception 'Invalid residential status.' using errcode = '22023';
  end if;
  if p_taxpayer_category is not null
     and p_taxpayer_category not in ('individual','huf') then
    raise exception 'Invalid taxpayer category.' using errcode = '22023';
  end if;
  if not (v_situations <@ array[
    'business_or_professional_income','foreign_income_or_assets','virtual_digital_assets',
    'futures_and_options','clubbing_of_income','brought_forward_losses',
    'agricultural_special_rate','nonresident_special_rate','surcharge_or_marginal_relief',
    'other_unsupported'
  ]::text[]) then
    raise exception 'Unknown declared situation code.' using errcode = '22023';
  end if;

  if app.event_already_applied(p_event_id, 'taxpayer_profile.updated', v_actor, p_tax_case_id::text) then
    return p_event_id;  -- idempotent replay
  end if;

  select tc.case_id, tc.client_id, tc.finalized_at
    into v_case_id, v_client_id, v_finalized
    from public.tax_cases tc
    where tc.id = p_tax_case_id
    for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized. The taxpayer profile is read-only.'
      using errcode = '42501';
  end if;

  v_blocked_before := app.tax_case_eligibility_blocked(p_tax_case_id);

  update public.clients set date_of_birth = p_date_of_birth
    where id = v_client_id;

  update public.tax_cases set
    residential_status          = p_residential_status,
    taxpayer_category           = p_taxpayer_category,
    declared_special_situations = v_situations,
    taxpayer_profile_updated_at = now(),
    taxpayer_profile_updated_by = v_actor,
    updated_by                  = v_actor
  where id = p_tax_case_id;

  v_blocked_after := app.tax_case_eligibility_blocked(p_tax_case_id);

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'taxpayer_profile.updated', 'tax_cases', p_tax_case_id::text, v_case_id,
     jsonb_build_object(
       'tax_case_id', p_tax_case_id,
       'has_dob', p_date_of_birth is not null,
       'residential_status', p_residential_status,
       'taxpayer_category', p_taxpayer_category,
       'declared_situation_count', coalesce(array_length(v_situations, 1), 0),
       'profile_blocker_before', v_blocked_before,
       'profile_blocker_after', v_blocked_after),
     p_event_id);

  -- Eligibility transition audit (profile subset). A separate NULL event_id row
  -- so it never collides with the profile.updated idempotency key.
  if v_blocked_before is not null and v_blocked_after is null then
    insert into public.audit_logs
      (actor_id, actor_role, action, entity_type, entity_id, case_id, after)
    values
      (v_actor, v_role, 'tax_eligibility.unblocked', 'tax_cases', p_tax_case_id::text, v_case_id,
       jsonb_build_object('tax_case_id', p_tax_case_id, 'cleared_blocker', v_blocked_before));
  elsif v_blocked_before is null and v_blocked_after is not null then
    insert into public.audit_logs
      (actor_id, actor_role, action, entity_type, entity_id, case_id, after)
    values
      (v_actor, v_role, 'tax_eligibility.blocked', 'tax_cases', p_tax_case_id::text, v_case_id,
       jsonb_build_object('tax_case_id', p_tax_case_id, 'new_blocker', v_blocked_after));
  end if;

  return p_event_id;
end;
$$;

-- ------------------------------------------------------------
-- 4. Extend the three progression RPCs with the eligibility assertion.
--    Re-created verbatim from 20260712130000 with ONE added guard each. Owner /
--    grants are preserved by CREATE OR REPLACE (re-asserted in section 5).
-- ------------------------------------------------------------

-- 4a. prepare_client_review (adds eligibility assertion) ------------------
create or replace function public.prepare_client_review(
  p_tax_case_id uuid,
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
  v_latest uuid;
  v_blocked text;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if app.event_already_applied(p_event_id, 'tax_client_review.prepared', v_actor, p_tax_case_id::text) then
    return p_event_id;
  end if;

  select tc.case_id, tc.finalized_at into v_case_id, v_finalized
    from public.tax_cases tc where tc.id = p_tax_case_id for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized. Client review actions are read-only.'
      using errcode = '42501';
  end if;

  v_blocked := app.tax_case_eligibility_blocked(p_tax_case_id);
  if v_blocked is not null then
    raise exception 'This tax case is not eligible for computation (%). Resolve eligibility before preparing client review.', v_blocked
      using errcode = '22023';
  end if;

  v_latest := app.latest_complete_snapshot_id(p_tax_case_id);
  if v_latest is null then
    raise exception 'No complete computation snapshot exists yet.' using errcode = '22023';
  end if;

  update public.tax_cases set
    client_review_snapshot_id    = v_latest,
    client_review_status         = 'prepared',
    client_review_sent_at        = null,
    client_review_sent_by        = null,
    client_approved_at           = null,
    client_approval_captured_by  = null,
    client_approval_method       = null,
    client_approval_reference    = null,
    client_changes_requested_at  = null,
    client_changes_requested_by  = null,
    client_changes_summary       = null,
    updated_by                   = v_actor
  where id = p_tax_case_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_client_review.prepared', 'tax_cases', p_tax_case_id::text, v_case_id,
     jsonb_build_object('tax_case_id', p_tax_case_id, 'snapshot_id', v_latest), p_event_id);

  return p_event_id;
end;
$$;

-- 4b. capture_client_approval (adds eligibility assertion) ----------------
create or replace function public.capture_client_approval(
  p_tax_case_id uuid,
  p_method      text,
  p_reference   text,
  p_approved_at timestamptz,
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
  v_review_snap uuid;
  v_latest uuid;
  v_open_err int;
  v_blocked text;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if app.event_already_applied(p_event_id, 'tax_client_review.approved', v_actor, p_tax_case_id::text) then
    return p_event_id;
  end if;

  select tc.case_id, tc.finalized_at, tc.client_review_snapshot_id
    into v_case_id, v_finalized, v_review_snap
    from public.tax_cases tc where tc.id = p_tax_case_id for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized. Client review actions are read-only.'
      using errcode = '42501';
  end if;
  if v_review_snap is null then
    raise exception 'Prepare the review pack before capturing approval.' using errcode = '22023';
  end if;

  v_blocked := app.tax_case_eligibility_blocked(p_tax_case_id);
  if v_blocked is not null then
    raise exception 'This tax case is not eligible for computation (%). Resolve eligibility before capturing approval.', v_blocked
      using errcode = '22023';
  end if;

  v_latest := app.latest_complete_snapshot_id(p_tax_case_id);
  if v_latest is null then
    raise exception 'No complete computation snapshot exists to approve.' using errcode = '22023';
  end if;
  if v_review_snap is distinct from v_latest then
    raise exception 'Client approval is out of date — a newer snapshot exists. Prepare the latest snapshot again.'
      using errcode = '22023';
  end if;
  select count(*) into v_open_err
    from public.tax_validation_findings f
    where f.tax_case_id = p_tax_case_id and f.status = 'open'
      and f.severity in ('error','blocker');
  if v_open_err > 0 then
    raise exception 'Resolve open validation errors before capturing client approval.'
      using errcode = '22023';
  end if;

  update public.tax_cases set
    client_review_status        = 'approved',
    client_approved_at          = coalesce(p_approved_at, now()),
    client_approval_captured_by = v_actor,
    client_approval_method      = p_method,
    client_approval_reference   = p_reference,
    updated_by                  = v_actor
  where id = p_tax_case_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_client_review.approved', 'tax_cases', p_tax_case_id::text, v_case_id,
     jsonb_build_object('tax_case_id', p_tax_case_id, 'snapshot_id', v_review_snap, 'method', p_method),
     p_event_id);

  return p_event_id;
end;
$$;

-- 4c. finalize_tax_case (adds eligibility assertion) ----------------------
create or replace function public.finalize_tax_case(
  p_tax_case_id uuid,
  p_snapshot_id uuid,
  p_note        text,
  p_confirm     boolean,
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
  v_snap_ok boolean;
  v_open_blockers int;
  v_blocked text;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if not coalesce(p_confirm, false) then
    raise exception 'Confirmation is required to finalize.' using errcode = '22023';
  end if;

  if app.event_already_applied(p_event_id, 'tax_case.finalized', v_actor, p_tax_case_id::text) then
    return p_event_id;
  end if;

  select tc.case_id, tc.finalized_at
    into v_case_id, v_finalized
    from public.tax_cases tc
    where tc.id = p_tax_case_id
    for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is already finalized.' using errcode = '22023';
  end if;

  v_blocked := app.tax_case_eligibility_blocked(p_tax_case_id);
  if v_blocked is not null then
    raise exception 'This tax case is not eligible for computation (%). Resolve eligibility before finalizing.', v_blocked
      using errcode = '22023';
  end if;

  select (s.input_snapshot ->> 'complete') = 'true'
    into v_snap_ok
    from public.tax_computation_snapshots s
    where s.id = p_snapshot_id and s.tax_case_id = p_tax_case_id;
  if v_snap_ok is not true then
    raise exception 'A complete computation snapshot for this case is required to finalize.'
      using errcode = '22023';
  end if;

  select count(*)
    into v_open_blockers
    from public.tax_validation_findings f
    where f.tax_case_id = p_tax_case_id
      and f.status = 'open'
      and f.severity in ('error','blocker');
  if v_open_blockers > 0 then
    raise exception 'Resolve all open blocking findings before finalizing.'
      using errcode = '22023';
  end if;

  update public.tax_cases set
    finalized_at          = now(),
    finalized_by          = v_actor,
    finalized_snapshot_id = p_snapshot_id,
    finalization_note     = p_note,
    updated_by            = v_actor
  where id = p_tax_case_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_case.finalized', 'tax_cases', p_tax_case_id::text, v_case_id,
     jsonb_build_object('tax_case_id', p_tax_case_id, 'snapshot_id', p_snapshot_id),
     p_event_id);

  return p_event_id;
end;
$$;

-- ------------------------------------------------------------
-- 5. Extend the protected-column guard to cover the new profile columns, and
--    (re)assert ownership + grants for the new / replaced RPCs.
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
  then
    raise exception 'Protected tax_cases columns can only change through a guarded transition.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Ownership + grants for the new save_taxpayer_profile RPC (the replaced
-- progression RPCs keep their owner/grants through CREATE OR REPLACE).
grant create on schema public to app_writer;
do $$
begin
  execute 'alter function public.save_taxpayer_profile(uuid,date,text,text,text[],uuid) owner to app_writer';
  execute 'revoke all on function public.save_taxpayer_profile(uuid,date,text,text,text[],uuid) from public';
  execute 'revoke all on function public.save_taxpayer_profile(uuid,date,text,text,text[],uuid) from anon';
  execute 'grant execute on function public.save_taxpayer_profile(uuid,date,text,text,text[],uuid) to authenticated';
end $$;
revoke create on schema public from app_writer;
