-- ============================================================
-- TaxDesk OS — 20260725150000 Senior/super-senior blocker message correction
-- (K4-02)
--
-- K4-02 implemented the FIRST later-computation dossier item
-- (the k4-senior-treatment-specification design notes §10.1): the OLD-
-- regime senior/super-senior basic-exemption WIDENING is now real
-- (src/lib/tax-engine/ay-2026-27/slabs.ts `OLD_REGIME_SENIOR_SLABS` /
-- `OLD_REGIME_SUPER_SENIOR_SLABS`, applied by `compute-tax.ts`'s
-- `computeRegime` for a RESIDENT taxpayer's OLD-regime figure only).
--
-- Per decision D68 (the k3-tax-intelligence-program design notes §6), the
-- OLD-regime `SENIOR_TREATMENT_UNSUPPORTED` block
-- (app.tax_case_senior_treatment_blocked_for_case_regime — UNCHANGED by this
-- migration, still returns the SAME code for the SAME condition) DELIBERATELY
-- STAYS in place: the Section 80D senior-citizen cap and Section 80TTB
-- (senior) vs 80TTA remain flat, age-unaware DEDUCTION_CAPS placeholders, so
-- an OLD-regime senior/super-senior computation is still not reliably
-- complete. What changes here is ONLY the exception MESSAGE text in the three
-- guarded RPCs that raise it (create_evidence_manifest,
-- capture_client_approval, finalize_tax_case) — the pre-K4-02 wording ("Senior
-- /super-senior treatment is not implemented for this case") is now FALSE
-- (basic-exemption widening IS implemented) and is replaced with wording that
-- names the actual remaining gap. No other check in any of the three
-- functions changes. No table/column/grant/ownership change — ADDITIVE
-- message-text-only correction. Local Supabase only; NOT deployed, NOT run
-- against production.
-- ============================================================

-- ------------------------------------------------------------
-- 1. create_evidence_manifest — message-text-only change to the
--    senior-treatment exception (full function body replaced; every existing
--    check, including the message wording for every OTHER exception, is
--    unchanged from 20260725130000).
-- ------------------------------------------------------------
create or replace function public.create_evidence_manifest(
  p_tax_case_id             uuid,
  p_snapshot_id             uuid,
  p_selected_regime         text,
  p_manifest_payload        jsonb,
  p_manifest_content_hash   text,
  p_validation_rules_version text,
  p_tax_pack_id             text,
  p_tax_pack_version        text,
  p_tax_pack_lifecycle_status text,
  p_pre_approval_capability_result jsonb,
  p_snapshot_capability_result     jsonb,
  p_event_id                uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_case_id       uuid;
  v_finalized     timestamptz;
  v_snap_case_id  uuid;
  v_snap_complete boolean;
  v_senior_blocked text;
  v_risk_blocked  text;
  v_selected_income   numeric;
  v_conservative_income numeric;
  v_manifest_id   uuid;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if p_selected_regime not in ('old', 'new') then
    raise exception 'No regime has been explicitly selected. Select old or new regime.' using errcode = '22023';
  end if;
  if p_manifest_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Malformed manifest content hash.' using errcode = '22023';
  end if;
  if p_manifest_payload is null or p_tax_pack_id is null or p_tax_pack_version is null
     or p_tax_pack_lifecycle_status is null or p_validation_rules_version is null then
    raise exception 'Incomplete manifest payload.' using errcode = '22023';
  end if;

  if app.event_already_applied(p_event_id, 'tax_evidence_manifest.created', v_actor, p_snapshot_id::text) then
    select id into v_manifest_id from public.tax_evidence_manifests
      where event_id = p_event_id;
    if v_manifest_id is null then
      raise exception 'event_id % was already used for a different manifest.', p_event_id using errcode = '23505';
    end if;
    return v_manifest_id;
  end if;

  select tc.case_id, tc.finalized_at into v_case_id, v_finalized
    from public.tax_cases tc where tc.id = p_tax_case_id for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized and read-only.' using errcode = '42501';
  end if;

  select tcs.tax_case_id, (tcs.input_snapshot ->> 'complete') = 'true'
    into v_snap_case_id, v_snap_complete
    from public.tax_computation_snapshots tcs
    where tcs.id = p_snapshot_id;
  if v_snap_case_id is null then
    raise exception 'Computation snapshot not found.' using errcode = 'P0002';
  end if;
  if v_snap_case_id <> p_tax_case_id then
    raise exception 'Snapshot does not belong to this case.' using errcode = '42501';
  end if;
  if v_snap_complete is not true then
    raise exception 'The snapshot is not a complete computation snapshot.' using errcode = '22023';
  end if;

  -- K4-01/K4-02: the senior/super-senior selected-regime gate. Re-derived
  -- from the database (residential_status, client date_of_birth) — never
  -- trusted from the TypeScript-side p_snapshot_capability_result. The
  -- CONDITION is unchanged from K4-01; only the message below was corrected
  -- in K4-02 (decision D68) once the basic-exemption widening became real.
  v_senior_blocked := app.tax_case_senior_treatment_blocked_for_case_regime(p_tax_case_id, p_selected_regime);
  if v_senior_blocked is not null then
    raise exception 'Not eligible for an evidence manifest under the % regime (%). Senior/super-senior old-regime basic-exemption treatment is applied, but the Section 80D senior-citizen cap and Section 80TTB/80TTA treatment are not — reliance on the OLD regime remains blocked for this case.',
      p_selected_regime, v_senior_blocked using errcode = '22023';
  end if;

  -- The gate this RPC enforces: the SELECTED regime's own total income, never
  -- the conservative higher-of-both figure. Re-derived from the database,
  -- never trusted from p_snapshot_capability_result.
  v_risk_blocked := app.tax_case_surcharge_risk_blocked_for_regime(p_snapshot_id, p_selected_regime);
  if v_risk_blocked is not null then
    raise exception 'Not eligible for an evidence manifest under the % regime (%). Surcharge/marginal relief is not implemented for this income level.',
      p_selected_regime, v_risk_blocked using errcode = '22023';
  end if;

  v_selected_income := app.tax_case_regime_total_income(p_snapshot_id, p_selected_regime);
  v_conservative_income := greatest(
    app.tax_case_regime_total_income(p_snapshot_id, 'old'),
    app.tax_case_regime_total_income(p_snapshot_id, 'new')
  );

  insert into public.tax_evidence_manifests
    (tax_case_id, computation_snapshot_id, manifest_payload, manifest_content_hash,
     selected_regime, selected_regime_total_income, pre_approval_conservative_total_income,
     pre_approval_capability_result, snapshot_capability_result, active_blocker_codes,
     tax_pack_id, tax_pack_version, tax_pack_lifecycle_status, validation_identity,
     created_by, event_id)
  values
    (p_tax_case_id, p_snapshot_id, p_manifest_payload, p_manifest_content_hash,
     p_selected_regime, coalesce(v_selected_income, 0), v_conservative_income,
     coalesce(p_pre_approval_capability_result, '{}'::jsonb), coalesce(p_snapshot_capability_result, '{}'::jsonb), '{}',
     p_tax_pack_id, p_tax_pack_version, p_tax_pack_lifecycle_status,
     jsonb_build_object('validationRulesVersion', p_validation_rules_version),
     v_actor, p_event_id)
  returning id into v_manifest_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_evidence_manifest.created', 'tax_evidence_manifests', p_snapshot_id::text, v_case_id,
     jsonb_build_object('tax_case_id', p_tax_case_id, 'snapshot_id', p_snapshot_id,
                        'manifest_id', v_manifest_id, 'selected_regime', p_selected_regime,
                        'manifest_content_hash', p_manifest_content_hash),
     p_event_id);

  return v_manifest_id;
end;
$$;

-- ------------------------------------------------------------
-- 2. capture_client_approval — message-text-only change to the
--    senior-treatment re-check (full function body replaced; every existing
--    check, including the message wording for every OTHER exception, is
--    unchanged from 20260725130000).
-- ------------------------------------------------------------
create or replace function public.capture_client_approval(
  p_tax_case_id uuid,
  p_manifest_id uuid,
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
  v_senior_blocked text;
  v_manifest_case_id uuid;
  v_manifest_snapshot_id uuid;
  v_manifest_hash text;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if p_manifest_id is null then
    raise exception 'An accepted-evidence manifest is required before capturing approval.' using errcode = '22023';
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

  -- K3-32B: the manifest must exist, belong to THIS case, and be bound to
  -- THE EXACT snapshot being approved — never a manifest for a different
  -- snapshot or a different case.
  select m.tax_case_id, m.computation_snapshot_id, m.manifest_content_hash
    into v_manifest_case_id, v_manifest_snapshot_id, v_manifest_hash
    from public.tax_evidence_manifests m
    where m.id = p_manifest_id;
  if v_manifest_case_id is null then
    raise exception 'Evidence manifest not found.' using errcode = 'P0002';
  end if;
  if v_manifest_case_id <> p_tax_case_id then
    raise exception 'Evidence manifest does not belong to this case.' using errcode = '42501';
  end if;
  if v_manifest_snapshot_id <> v_latest then
    raise exception 'Evidence manifest is bound to a different snapshot than the one being approved.'
      using errcode = '22023';
  end if;

  -- K4-01/K4-02: defense-in-depth re-check — the manifest could only exist
  -- already-clear of this block (create_evidence_manifest refuses it), but
  -- this RPC never trusts that without re-deriving it directly. CONDITION
  -- unchanged from K4-01; only the message below was corrected in K4-02
  -- (decision D68).
  v_senior_blocked := app.tax_case_senior_treatment_blocked_for_manifest(p_manifest_id);
  if v_senior_blocked is not null then
    raise exception 'This tax case is not approval-ready (%). Senior/super-senior old-regime basic-exemption treatment is applied, but the Section 80D senior-citizen cap and Section 80TTB/80TTA treatment are not — reliance on the OLD regime remains blocked for this case.', v_senior_blocked
      using errcode = '22023';
  end if;

  update public.tax_cases set
    client_review_status        = 'approved',
    client_review_manifest_id   = p_manifest_id,
    client_review_manifest_hash = v_manifest_hash,
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
     jsonb_build_object('tax_case_id', p_tax_case_id, 'snapshot_id', v_review_snap, 'method', p_method,
                        'manifest_id', p_manifest_id, 'manifest_hash', v_manifest_hash),
     p_event_id);

  return p_event_id;
end;
$$;

-- ------------------------------------------------------------
-- 3. finalize_tax_case — message-text-only change to the senior-treatment
--    re-check (full function body replaced; every existing check, including
--    the message wording for every OTHER exception, is unchanged from
--    20260725130000).
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
  v_review_manifest_id uuid;
  v_snap_ok boolean;
  v_open_blockers int;
  v_blocked text;
  v_risk_blocked text;
  v_senior_blocked text;
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

  select tc.case_id, tc.finalized_at, tc.client_review_manifest_id
    into v_case_id, v_finalized, v_review_manifest_id
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

  -- K4-01/K4-02: re-check against the case's CURRENTLY bound review manifest,
  -- when one exists. A case without any bound manifest has no regime-specific
  -- senior-treatment fact to re-check here (filing readiness / client review
  -- already require a current approval bound to a manifest before finalize
  -- is offered in the UI) — this is defense-in-depth on top of that, not a
  -- new independent gate for the no-manifest case. CONDITION unchanged from
  -- K4-01; only the message below was corrected in K4-02 (decision D68).
  if v_review_manifest_id is not null then
    v_senior_blocked := app.tax_case_senior_treatment_blocked_for_manifest(v_review_manifest_id);
    if v_senior_blocked is not null then
      raise exception 'Cannot finalize (%). Senior/super-senior old-regime basic-exemption treatment is applied, but the Section 80D senior-citizen cap and Section 80TTB/80TTA treatment are not — reliance on the OLD regime remains blocked for this case.', v_senior_blocked
        using errcode = '22023';
    end if;
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
-- 4. Ownership / grants (defense in depth — reasserted explicitly rather
--    than assumed, same convention as every prior migration in this
--    repository; CREATE OR REPLACE FUNCTION preserves the existing owner
--    and grants, so this is idempotent, not a change).
-- ------------------------------------------------------------
alter function public.create_evidence_manifest(uuid, uuid, text, jsonb, text, text, text, text, text, jsonb, jsonb, uuid) owner to app_writer;
alter function public.capture_client_approval(uuid, uuid, text, text, timestamptz, uuid) owner to app_writer;
alter function public.finalize_tax_case(uuid, uuid, text, boolean, uuid) owner to app_writer;

revoke all on function public.create_evidence_manifest(uuid, uuid, text, jsonb, text, text, text, text, text, jsonb, jsonb, uuid) from public;
revoke all on function public.capture_client_approval(uuid, uuid, text, text, timestamptz, uuid) from public;
revoke all on function public.finalize_tax_case(uuid, uuid, text, boolean, uuid) from public;

grant execute on function public.create_evidence_manifest(uuid, uuid, text, jsonb, text, text, text, text, text, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.capture_client_approval(uuid, uuid, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.finalize_tax_case(uuid, uuid, text, boolean, uuid) to authenticated;
