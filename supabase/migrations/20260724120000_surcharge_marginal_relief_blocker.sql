-- ============================================================
-- TaxDesk OS — 20260724120000 Surcharge / marginal-relief reliance blocker
-- (TAX-SAFE-01, boundary corrected in TAX-SAFE-01A)
--
-- The AY 2026-27 engine does not implement surcharge or marginal relief
-- (src/lib/tax-engine/ay-2026-27/rules.ts NOT_IMPLEMENTED.surcharge /
-- .marginalRelief — surcharge is always a ₹0 placeholder). Until now the
-- only guard against relying on such a case was a preparer manually
-- declaring "surcharge_or_marginal_relief" as a special situation
-- (tax_cases.declared_special_situations). This migration adds an
-- AUTOMATIC, income-derived database backstop that does not depend on a
-- declaration: a case whose latest complete computation snapshot's own
-- computed total income (the conservative HIGHER of the old-regime and
-- new-regime figures — never only the recommended regime's) EXCEEDS a
-- conservative, sourced risk threshold (₹50,00,000 — see
-- src/lib/tax-pack/packs/ay-2026-27-provenance.ts
-- "surcharge_marginal_relief_safety_threshold", and the mirrored TS
-- constant in src/lib/tax-desk/tax-capability.ts) is rejected by
-- prepare_client_review, capture_client_approval and finalize_tax_case at
-- the SECURITY DEFINER boundary — the same defense-in-depth convention
-- app.tax_case_eligibility_blocked() already established for the profile /
-- declared-situation subset of eligibility.
--
-- TAX-SAFE-01A (2026-07-24): this migration file was corrected IN PLACE
-- (never committed/pushed/applied remotely — see the TAX-SAFE-01A session-log
-- entry) to use STRICT `>` instead of the original `>=`, and to read BOTH
-- regimes' total income instead of only the recommended regime's. Official
-- sources (Finance Act 2025 First Schedule Part III; ITD AY 2026-27
-- guidance) state surcharge/marginal relief begin only once income EXCEEDS
-- Rs 50 lakh — exactly Rs 50,00,000 attracts nil surcharge.
--
-- This threshold is used ONLY to trigger a reliance blocker. No surcharge
-- or marginal-relief AMOUNT is computed here or anywhere else.
--
-- ADDITIVE. No table structure changes. Local Supabase only; NOT deployed,
-- NOT run against production.
-- ============================================================

-- ------------------------------------------------------------
-- 1. app.tax_case_surcharge_risk_blocked(snapshot_id) -> blocker code | null
--    Reads the SNAPSHOT'S OWN computed total income for BOTH regimes
--    (output_snapshot -> computation -> oldRegime/newRegime -> totalIncome
--    -> value) and takes the conservative HIGHER of the two — never
--    re-derived, never trusted from the caller. The top-level
--    computation -> totalIncome is only the RECOMMENDED regime's figure;
--    using it alone could miss a case whose non-recommended regime is the
--    one that actually crosses the risk threshold (TAX-SAFE-01A — mirrors
--    totalIncomeForSurchargeApplicability in
--    src/lib/tax-desk/tax-capability.ts). A snapshot with no parseable
--    total income on EITHER regime is NOT treated as risky (fails toward
--    "let the existing snapshot-completeness checks catch it", not toward
--    inventing a number).
-- ------------------------------------------------------------
create or replace function app.tax_case_surcharge_risk_blocked(p_snapshot_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_old_total_income numeric;
  v_new_total_income numeric;
  v_total_income numeric;
begin
  if p_snapshot_id is null then
    return null;
  end if;

  select (s.output_snapshot -> 'computation' -> 'oldRegime' -> 'totalIncome' ->> 'value')::numeric,
         (s.output_snapshot -> 'computation' -> 'newRegime' -> 'totalIncome' ->> 'value')::numeric
    into v_old_total_income, v_new_total_income
    from public.tax_computation_snapshots s
    where s.id = p_snapshot_id;

  v_total_income := greatest(v_old_total_income, v_new_total_income);
  if v_total_income is null then
    return null;
  end if;

  -- 50,00,000 = Rs 50 lakh. Sourced, conservative, blocking-only threshold —
  -- see the migration header comment for the canonical citation. Mirrors
  -- SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR in
  -- src/lib/tax-desk/tax-capability.ts; kept in sync by
  -- tests/security/surcharge-marginal-relief-blocker.mjs, which proves both
  -- layers agree at and around the threshold.
  --
  -- STRICT `>` (TAX-SAFE-01A correction) — official sources (Finance Act
  -- 2025, First Schedule Part III; ITD AY 2026-27 guidance) state surcharge/
  -- marginal relief begin only once income EXCEEDS Rs 50 lakh; exactly Rs
  -- 50,00,000 attracts nil surcharge and must not be blocked. The original
  -- TAX-SAFE-01 migration used `>=`, which incorrectly blocked the exact
  -- boundary case — see the change log's TAX-SAFE-01A entry.
  if v_total_income > 5000000 then
    return 'SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED';
  end if;

  return null;
end;
$$;
revoke all on function app.tax_case_surcharge_risk_blocked(uuid) from public;
grant execute on function app.tax_case_surcharge_risk_blocked(uuid) to app_writer;
grant execute on function app.tax_case_surcharge_risk_blocked(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. prepare_client_review — add the surcharge-risk assertion after the
--    latest-complete-snapshot lookup (full function body replaced; only the
--    new block is added, nothing else changed from the K.2.8.9A version).
-- ------------------------------------------------------------
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
  v_risk_blocked text;
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

  v_risk_blocked := app.tax_case_surcharge_risk_blocked(v_latest);
  if v_risk_blocked is not null then
    raise exception 'This tax case is not approval-ready (%). Surcharge/marginal relief is not implemented for this income level.', v_risk_blocked
      using errcode = '22023';
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

-- ------------------------------------------------------------
-- 3. capture_client_approval — add the same assertion after the latest-
--    complete-snapshot lookup.
-- ------------------------------------------------------------
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
  v_risk_blocked text;
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

  v_risk_blocked := app.tax_case_surcharge_risk_blocked(v_latest);
  if v_risk_blocked is not null then
    raise exception 'This tax case is not approval-ready (%). Surcharge/marginal relief is not implemented for this income level.', v_risk_blocked
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

-- ------------------------------------------------------------
-- 4. finalize_tax_case — add the same assertion against the snapshot being
--    finalized (p_snapshot_id), after the existing completeness check.
-- ------------------------------------------------------------
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
  v_risk_blocked text;
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

  v_risk_blocked := app.tax_case_surcharge_risk_blocked(p_snapshot_id);
  if v_risk_blocked is not null then
    raise exception 'Cannot finalize (%). Surcharge/marginal relief is not implemented for this income level.', v_risk_blocked
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
-- 5. Ownership / grants (defense in depth — these should already be correct
--    from prior migrations, but SECURITY DEFINER functions must always be
--    reasserted explicitly rather than assumed).
-- ------------------------------------------------------------
alter function public.prepare_client_review(uuid, uuid) owner to app_writer;
alter function public.capture_client_approval(uuid, text, text, timestamptz, uuid) owner to app_writer;
alter function public.finalize_tax_case(uuid, uuid, text, boolean, uuid) owner to app_writer;

revoke all on function public.prepare_client_review(uuid, uuid) from public;
revoke all on function public.capture_client_approval(uuid, text, text, timestamptz, uuid) from public;
revoke all on function public.finalize_tax_case(uuid, uuid, text, boolean, uuid) from public;

grant execute on function public.prepare_client_review(uuid, uuid) to authenticated;
grant execute on function public.capture_client_approval(uuid, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.finalize_tax_case(uuid, uuid, text, boolean, uuid) to authenticated;
