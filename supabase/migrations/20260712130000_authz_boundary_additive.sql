-- ============================================================
-- TaxDesk OS — 20260712130000 Authorization boundary, MIGRATION A (additive)
-- Phase K.2.8.8B — deployment-safe split (A of 2).
--
-- ADDITIVE / BACKWARD-COMPATIBLE ONLY. Safe to apply while the CURRENTLY
-- DEPLOYED application is still doing direct writes. It:
--   * creates the least-privilege app_writer role + supporting objects,
--   * adds nullable/backward-compatible columns + indexes,
--   * creates the guarded SECURITY DEFINER RPCs and grants EXECUTE.
-- It DOES NOT revoke any legacy grant, DOES NOT install any trigger, and
-- DOES NOT add any constraint that an existing production row could violate.
-- Enforcement (revokes, triggers, strict constraints) is MIGRATION B, applied
-- AFTER the new application code is deployed and the new RPC paths are smoke-
-- tested.
--
-- Intended production sequence (full detail: supabase/deploy/K2.8.8B-deployment-runbook.md):
--   a. run supabase/deploy/K2.8.8B-preA-preflight.sql (read-only, pre-A schema)
--   b. apply THIS migration (A) from a worktree that does NOT contain Migration B
--   c. deploy the new application code
--   d. smoke-test every new RPC path
--   e. run supabase/deploy/K2.8.8B-preB-preflight.sql (read-only, post-A)
--   f. apply 20260712140000_authz_boundary_enforcement.sql (B)
--   g. run hostile direct-API security smoke tests + verify audit/history counts
--
-- WARNING: `supabase db push` applies EVERY pending migration in the worktree.
-- Migration A and Migration B must NOT be in the same worktree during the first
-- push, or both apply at once and break the compatibility sequence.
--
-- Local Supabase only; not deployed here.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Least-privilege writer role for the definer RPCs.
--    NOLOGIN (never a connection identity); BYPASSRLS so the vetted function
--    bodies can write protected rows AFTER doing their own authorization. Only
--    reachable through the SECURITY DEFINER functions below — never directly.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_writer') then
    create role app_writer nologin bypassrls;
  end if;
  -- The migration role must be a member of app_writer to reassign ownership of
  -- the definer functions to it (unless it is a superuser).
  execute format('grant app_writer to %I', current_user);
end $$;

grant usage on schema public to app_writer;
grant usage on schema app to app_writer;

-- app.current_user_id() (`select auth.uid()`) is SECURITY INVOKER, so inside an
-- app_writer-owned definer RPC it would run AS app_writer and fail on
-- `permission denied for schema auth` (the auth schema is owned by
-- supabase_admin and USAGE on it cannot be granted to app_writer). Promote it to
-- SECURITY DEFINER — matching its sibling app.current_role() — so it reads
-- auth.uid() as its owner (postgres, which has auth access). It still returns
-- the request JWT's sub (never a caller-supplied value), so every existing
-- caller is unaffected. search_path is pinned empty (its body already
-- schema-qualifies auth.uid()) so the definer surface cannot be hijacked.
alter function app.current_user_id() security definer set search_path = '';

grant execute on function app.current_user_id() to app_writer;
grant execute on function app.current_role() to app_writer;
grant execute on function app.is_admin() to app_writer;
grant execute on function app.is_staff_or_admin() to app_writer;

-- Exact table privileges the RPC bodies need (least privilege).
grant select, update on public.tax_cases to app_writer;
grant select, insert, update on public.tax_validation_findings to app_writer;
grant select on public.tax_computation_snapshots to app_writer;
grant select on public.cases to app_writer;
grant select on public.services to app_writer;  -- transition_case_status reads status_flow
grant update (status, next_action, next_action_due, on_hold_reason, completed_at)
  on public.cases to app_writer;
grant insert on public.case_status_history to app_writer;
-- SELECT for the per-RPC idempotency check; INSERT for the atomic audit event.
grant select, insert on public.audit_logs to app_writer;

-- ------------------------------------------------------------
-- 1. Schema additions — DB-guaranteed attribution + audit idempotency.
--    All nullable / additive; the currently deployed app is unaffected.
-- ------------------------------------------------------------
alter table public.tax_cases
  add column if not exists updated_by uuid references public.users(id);

-- Correlation id / idempotency key for guarded transitions. Nullable so the
-- existing service-role audit() writer (which does not set it) is unaffected.
alter table public.audit_logs
  add column if not exists event_id uuid;

-- Global uniqueness: an event_id is a single logical request. A repeated
-- event_id for a DIFFERENT operation collides here (and is caught earlier, with
-- a clear error, by app.event_already_applied). Multiple NULLs are allowed
-- (the legacy audit() writer never sets it).
drop index if exists public.uq_audit_logs_action_event;  -- superseded name (pre-split)
create unique index if not exists uq_audit_logs_event_id
  on public.audit_logs (event_id) where event_id is not null;

-- ------------------------------------------------------------
-- 2. Idempotency binding helper.
--    A guarded RPC is idempotent ONLY for a genuine replay of the SAME logical
--    request: same action, same actor, same target. A repeated event_id for a
--    different action/actor/target is a misuse and MUST fail (not silently reuse
--    an earlier result). SECURITY INVOKER — it is only ever called from inside
--    an app_writer-owned RPC, so it runs as app_writer (which holds SELECT on
--    audit_logs); it never trusts a caller-supplied actor.
-- ------------------------------------------------------------
create or replace function app.event_already_applied(
  p_event_id uuid,
  p_action   text,
  p_actor    uuid,
  p_entity   text
) returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_action  text;
  v_actor   uuid;
  v_entity  text;
begin
  if p_event_id is null then
    return false;
  end if;
  select a.action, a.actor_id, a.entity_id
    into v_action, v_actor, v_entity
    from public.audit_logs a
    where a.event_id = p_event_id
    limit 1;
  if not found then
    return false;  -- first time this event is seen → proceed
  end if;
  if v_action is distinct from p_action
     or v_actor is distinct from p_actor
     or v_entity is distinct from p_entity then
    raise exception
      'event_id % was already used for a different operation (recorded action=%, actor=%, target=%)',
      p_event_id, v_action, v_actor, v_entity
      using errcode = '23505';
  end if;
  return true;  -- genuine replay of the same operation → caller returns prior id
end;
$$;
revoke all on function app.event_already_applied(uuid, text, uuid, text) from public;
grant execute on function app.event_already_applied(uuid, text, uuid, text) to app_writer;

-- Shared helper: id of the latest COMPLETE computation snapshot for a case.
create or replace function app.latest_complete_snapshot_id(p_tax_case_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.tax_computation_snapshots s
  where s.tax_case_id = p_tax_case_id
    and (s.input_snapshot ->> 'complete') = 'true'
  order by s.created_at desc
  limit 1
$$;
grant execute on function app.latest_complete_snapshot_id(uuid) to app_writer;

-- ============================================================
-- 3. Guarded transactional RPCs (SECURITY DEFINER, owner app_writer).
--    Each: validate role + state → mutate → history (where relevant) →
--    audit — all in ONE transaction (fail-closed). Idempotent per event_id,
--    bound to (action, actor, target). The actor is ALWAYS derived from the
--    request JWT (app.current_user_id()) — never a function parameter.
-- ============================================================

-- 3a. finalize_tax_case ---------------------------------------------------
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
    return p_event_id;  -- idempotent replay of the same finalize
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

-- 3b. reopen_tax_case (ADMIN ONLY) ---------------------------------------
create or replace function public.reopen_tax_case(
  p_tax_case_id uuid,
  p_reason      text,
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
  v_prior_snap uuid;
  v_prior_status text;
begin
  if not app.is_admin() then
    raise exception 'Only an admin can reopen a finalized tax case.' using errcode = '42501';
  end if;
  if not coalesce(p_confirm, false) then
    raise exception 'Confirmation is required to reopen.' using errcode = '22023';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;

  if app.event_already_applied(p_event_id, 'tax_case.reopened', v_actor, p_tax_case_id::text) then
    return p_event_id;
  end if;

  select tc.case_id, tc.finalized_at, tc.finalized_snapshot_id, tc.client_review_status
    into v_case_id, v_finalized, v_prior_snap, v_prior_status
    from public.tax_cases tc
    where tc.id = p_tax_case_id
    for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is null then
    raise exception 'This tax case is not finalized.' using errcode = '22023';
  end if;

  update public.tax_cases set
    finalized_at          = null,
    finalized_by          = null,
    finalized_snapshot_id = null,
    finalization_note     = null,
    reopened_at           = now(),
    reopened_by           = v_actor,
    reopen_reason         = p_reason,
    client_review_status  = 'superseded',
    updated_by            = v_actor
  where id = p_tax_case_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_case.reopened', 'tax_cases', p_tax_case_id::text, v_case_id,
     jsonb_build_object('tax_case_id', p_tax_case_id,
                        'prior_finalized_snapshot_id', v_prior_snap,
                        'previous_review_status', v_prior_status,
                        'reopened_by_role', v_role),
     p_event_id);

  return p_event_id;
end;
$$;

-- 3c. resolve_tax_finding / reopen_tax_finding ---------------------------
create or replace function public.resolve_tax_finding(
  p_finding_id uuid,
  p_note       text,
  p_event_id   uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_tax_case uuid;
  v_case_id uuid;
  v_code text;
  v_finalized timestamptz;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if app.event_already_applied(p_event_id, 'tax_validation.finding_resolved', v_actor, p_finding_id::text) then
    return p_event_id;
  end if;

  select f.tax_case_id, f.code, tc.case_id, tc.finalized_at
    into v_tax_case, v_code, v_case_id, v_finalized
    from public.tax_validation_findings f
    join public.tax_cases tc on tc.id = f.tax_case_id
    where f.id = p_finding_id
    for update of f;
  if v_tax_case is null then
    raise exception 'Finding not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized. Findings are read-only.' using errcode = '42501';
  end if;

  update public.tax_validation_findings set
    status = 'resolved', resolved_at = now(), resolved_by = v_actor, resolution_note = p_note
  where id = p_finding_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_validation.finding_resolved', 'tax_validation_findings',
     p_finding_id::text, v_case_id,
     jsonb_build_object('tax_case_id', v_tax_case, 'finding_id', p_finding_id, 'rule_code', v_code),
     p_event_id);

  return p_event_id;
end;
$$;

create or replace function public.reopen_tax_finding(
  p_finding_id uuid,
  p_event_id   uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_tax_case uuid;
  v_case_id uuid;
  v_code text;
  v_finalized timestamptz;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if app.event_already_applied(p_event_id, 'tax_validation.finding_reopened', v_actor, p_finding_id::text) then
    return p_event_id;
  end if;

  select f.tax_case_id, f.code, tc.case_id, tc.finalized_at
    into v_tax_case, v_code, v_case_id, v_finalized
    from public.tax_validation_findings f
    join public.tax_cases tc on tc.id = f.tax_case_id
    where f.id = p_finding_id
    for update of f;
  if v_tax_case is null then
    raise exception 'Finding not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized. Findings are read-only.' using errcode = '42501';
  end if;

  update public.tax_validation_findings set
    status = 'open', resolved_at = null, resolved_by = null, resolution_note = null
  where id = p_finding_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_validation.finding_reopened', 'tax_validation_findings',
     p_finding_id::text, v_case_id,
     jsonb_build_object('tax_case_id', v_tax_case, 'finding_id', p_finding_id, 'rule_code', v_code),
     p_event_id);

  return p_event_id;
end;
$$;

-- 3d. Client-review lifecycle --------------------------------------------
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

create or replace function public.mark_client_review_sent(
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
  v_status text;
  v_review_snap uuid;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if app.event_already_applied(p_event_id, 'tax_client_review.marked_sent', v_actor, p_tax_case_id::text) then
    return p_event_id;
  end if;

  select tc.case_id, tc.finalized_at, tc.client_review_status, tc.client_review_snapshot_id
    into v_case_id, v_finalized, v_status, v_review_snap
    from public.tax_cases tc where tc.id = p_tax_case_id for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized. Client review actions are read-only.'
      using errcode = '42501';
  end if;
  if v_review_snap is null then
    raise exception 'Prepare the review pack before marking it sent.' using errcode = '22023';
  end if;
  if v_status <> 'prepared' then
    raise exception 'Only a prepared review can be marked sent.' using errcode = '22023';
  end if;
  if v_review_snap is distinct from app.latest_complete_snapshot_id(p_tax_case_id) then
    raise exception 'A newer snapshot exists. Prepare the latest snapshot again before sending.'
      using errcode = '22023';
  end if;

  update public.tax_cases set
    client_review_status  = 'sent',
    client_review_sent_at = now(),
    client_review_sent_by = v_actor,
    updated_by            = v_actor
  where id = p_tax_case_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_client_review.marked_sent', 'tax_cases', p_tax_case_id::text, v_case_id,
     jsonb_build_object('tax_case_id', p_tax_case_id, 'snapshot_id', v_review_snap), p_event_id);

  return p_event_id;
end;
$$;

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

create or replace function public.record_client_changes(
  p_tax_case_id uuid,
  p_summary     text,
  p_method      text,
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
  v_review_snap uuid;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if app.event_already_applied(p_event_id, 'tax_client_review.changes_requested', v_actor, p_tax_case_id::text) then
    return p_event_id;
  end if;

  select tc.case_id, tc.finalized_at, tc.client_review_status, tc.client_review_snapshot_id
    into v_case_id, v_finalized, v_status, v_review_snap
    from public.tax_cases tc where tc.id = p_tax_case_id for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized. Client review actions are read-only.'
      using errcode = '42501';
  end if;
  if v_status = 'not_started' or v_review_snap is null then
    raise exception 'Prepare a review pack before recording requested changes.' using errcode = '22023';
  end if;

  update public.tax_cases set
    client_review_status        = 'changes_requested',
    client_changes_requested_at = now(),
    client_changes_requested_by = v_actor,
    client_changes_summary      = p_summary,
    updated_by                  = v_actor
  where id = p_tax_case_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_client_review.changes_requested', 'tax_cases', p_tax_case_id::text, v_case_id,
     jsonb_build_object('tax_case_id', p_tax_case_id, 'snapshot_id', v_review_snap, 'method', p_method),
     p_event_id);

  return p_event_id;
end;
$$;

-- 3e. transition_case_status (general Case status flow) ------------------
-- The rich ordinal/service-specific policy stays in lib/status-flow (runs in
-- the action first). This RPC is the atomic writer + DB backstop: role,
-- not-deleted, optimistic from-status match, to-status validity from the flow
-- JSON, and manual-filing confirmation. Writes status + history + audit atomically.
create or replace function public.transition_case_status(
  p_case_id           uuid,
  p_from_status       text,
  p_to_status         text,
  p_reason            text,
  p_confirmed_manual  boolean,
  p_next_action       text,
  p_next_action_due   date,
  p_on_hold_reason    text,
  p_completed         boolean,
  p_event_id          uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_status text;
  v_flow jsonb;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if app.event_already_applied(p_event_id, 'case.status_changed', v_actor, p_case_id::text) then
    return p_event_id;
  end if;

  select c.status, s.status_flow
    into v_status, v_flow
    from public.cases c
    join public.services s on s.id = c.service_id
    where c.id = p_case_id and c.deleted_at is null
    for update of c;
  if v_status is null then
    raise exception 'Case not found.' using errcode = 'P0002';
  end if;
  -- Optimistic concurrency: caller's view of the current status must match.
  if v_status is distinct from p_from_status then
    raise exception 'The case status changed since this action started. Refresh and retry.'
      using errcode = '40001';
  end if;
  -- Target must be a real status for this service's flow.
  if not exists (
    select 1 from jsonb_array_elements(v_flow -> 'statuses') e
    where e ->> 'code' = p_to_status
  ) then
    raise exception 'Unknown target status for this service.' using errcode = '22023';
  end if;
  -- The system never files anything: filing/submission targets require an
  -- explicit human manual-action confirmation.
  if (v_flow -> 'filing_confirmation_required') ? p_to_status
     and not coalesce(p_confirmed_manual, false) then
    raise exception 'Confirm that this filing/submission was done manually by an authorized person.'
      using errcode = '22023';
  end if;

  update public.cases set
    status          = p_to_status,
    next_action     = p_next_action,
    on_hold_reason  = p_on_hold_reason,
    completed_at    = case when coalesce(p_completed, false) then now() else null end,
    next_action_due = coalesce(p_next_action_due, next_action_due)
  where id = p_case_id;

  insert into public.case_status_history (case_id, from_status, to_status, reason, changed_by)
  values (p_case_id, v_status, p_to_status, nullif(btrim(coalesce(p_reason,'')), ''), v_actor);

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, before, after, event_id)
  values
    (v_actor, v_role, 'case.status_changed', 'cases', p_case_id::text, p_case_id,
     jsonb_build_object('status', v_status),
     jsonb_build_object('status', p_to_status, 'confirmed_manual_action', coalesce(p_confirmed_manual, false)),
     p_event_id);

  return p_event_id;
end;
$$;

-- ------------------------------------------------------------
-- 4. Ownership, search_path hardening, and execution grants for every RPC.
--    Owned by least-privilege app_writer; callable only by authenticated
--    (never anon/public). Column/row authorization is enforced in the bodies.
-- ------------------------------------------------------------
-- Ownership reassignment requires the incoming owner to hold CREATE on the
-- schema; grant it only for the duration of the reassignment, then revoke so
-- app_writer keeps ONLY the narrow table DML privileges granted in section 0.
grant create on schema public to app_writer;

do $$
declare
  fn text;
  fns text[] := array[
    'finalize_tax_case(uuid,uuid,text,boolean,uuid)',
    'reopen_tax_case(uuid,text,boolean,uuid)',
    'resolve_tax_finding(uuid,text,uuid)',
    'reopen_tax_finding(uuid,uuid)',
    'prepare_client_review(uuid,uuid)',
    'mark_client_review_sent(uuid,uuid)',
    'capture_client_approval(uuid,text,text,timestamptz,uuid)',
    'record_client_changes(uuid,text,text,uuid)',
    'transition_case_status(uuid,text,text,text,boolean,text,date,text,boolean,uuid)'
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
