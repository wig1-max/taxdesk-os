-- ============================================================
-- TaxDesk OS — 20260803120000 K4-12: the section 87A REBATE-threshold marginal
-- relief reliance gate, in the database.
--
-- Additive: no table, no column, no index, no policy, no data. It adds ONE new
-- `app.*` helper and re-emits the four guarded RPCs, whose only change is one
-- inserted guard block each. Local Supabase only; NOT deployed, NOT run against
-- production.
--
-- ------------------------------------------------------------
-- WHY A SECOND HELPER RATHER THAN WIDENING THE SURCHARGE ONE
-- ------------------------------------------------------------
-- Section 87A marginal relief is a genuinely SEPARATE relief from the surcharge
-- marginal relief K4-11 shipped, sharing only the name. It operates at the
-- Rs 12,00,000 REBATE ceiling, not the Rs 50,00,000 surcharge threshold, and the
-- two windows are provably disjoint (the 87A relief tapers to nothing at about
-- Rs 12,70,588, derived from the slab table in `rebate-relief.ts` and asserted
-- there against `SURCHARGE.entryThreshold`). Folding it into
-- `app.tax_case_surcharge_risk_blocked` would have made that function return a
-- rebate blocker code under a surcharge name, and would have told a preparer of
-- a Rs 12.2 lakh case that their SURCHARGE treatment was incomplete — which is
-- false, and is exactly the untrue-status-copy defect K.2.9.4 / D129 treat as
-- real in their own right.
--
-- ------------------------------------------------------------
-- AUDIT-05-F1's LESSON, APPLIED UP FRONT
-- ------------------------------------------------------------
-- K4-11 narrowed the TypeScript layer and one of two SQL helpers, and the
-- released window was inoperative in production for a whole session because the
-- sibling never moved. So this migration ships the SQL gate in the SAME session
-- as the TypeScript one, and the four RPC bodies below were taken VERBATIM from
-- `pg_get_functiondef` against the live local catalog — never transcribed from a
-- migration file — with exactly one block inserted into each. Everything else is
-- byte-identical to what is deployed.
--
-- ------------------------------------------------------------
-- THE WINDOW, AND WHY IT HAS AN UPPER EDGE
-- ------------------------------------------------------------
-- The helper blocks only when the NEW regime's own total income is strictly
-- above Rs 12,00,000 AND at or below Rs 12,70,589, and the engine's stored
-- verdict is not the JSON boolean `true`.
--
--   * The NEW regime's figure, not the higher-of-both-regimes figure the
--     surcharge gate uses (D44/D47). That is not an inconsistency: the enabling
--     proviso is conditioned on section 115BAC(1A), so the relief reaches the
--     new regime ONLY, and blocking on an old-regime income would refuse cases
--     for a relief that cannot apply to them.
--   * The UPPER edge is what keeps this proportionate. Without it, every
--     new-regime case above Rs 12,00,000 whose snapshot predates K4-12 — and so
--     carries no verdict, and so fails closed — would be blocked. With it, only
--     the narrow band where relief could actually have been due is examined, and
--     a historical snapshot in THAT band should be blocked: it computed tax
--     without a relief that was due, and overstated it.
--   * Rs 12,70,589 is the derived taper point rounded UP. Widening the window a
--     blocker examines is the safe direction; narrowing it below a real relief is
--     not. `rebate-relief.test.ts` pins the literal to the derived bound within
--     one rupee and fails if the slab table ever moves it past this number.
--
-- Fail-closed, following AUDIT-05-F4: an absent or non-numeric total income
-- blocks, and only the JSON boolean `true` releases — a JSON STRING "true" does
-- NOT, which is why the comparison is against `'true'::jsonb` and never `->>`.
-- ============================================================

create or replace function app.tax_case_rebate_relief_blocked(p_snapshot_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_income jsonb;
  v_total_income numeric;
  v_verdict jsonb;
begin
  if p_snapshot_id is null then
    return null;
  end if;

  -- The NEW regime's own total income, and the engine's own section 87A verdict,
  -- read from the SAME stored snapshot. Nothing is re-derived here: this function
  -- deliberately does NOT re-implement the relief window or the ambiguity test in
  -- PL/pgSQL, exactly as its surcharge siblings do not.
  select s.output_snapshot -> 'computation' -> 'newRegime' -> 'totalIncome' -> 'value',
         s.output_snapshot -> 'computation' -> 'rebateReliefTreatmentSupported'
    into v_income, v_verdict
    from public.tax_computation_snapshots s
    where s.id = p_snapshot_id;

  -- No such snapshot: the CALLER owns "not found" and raises its own error.
  if not found then
    return null;
  end if;

  -- AUDIT-05-F4(a): absent or non-numeric fails CLOSED. A snapshot that cannot
  -- say what its new-regime total income was cannot be shown to be outside the
  -- relief window.
  if v_income is null or jsonb_typeof(v_income) <> 'number' then
    return 'REBATE_MARGINAL_RELIEF_UNSUPPORTED';
  end if;
  v_total_income := (v_income #>> '{}')::numeric;

  -- Strictly above the ceiling (at exactly Rs 12,00,000 clause (a) applies and no
  -- relief question arises) and at or below the derived taper point.
  if v_total_income > 1200000 and v_total_income <= 1270589 then
    -- AUDIT-05-F4(b): `is distinct from 'true'::jsonb` — a JSON string "true"
    -- must NOT release, which `->>` would have allowed.
    if v_verdict is distinct from 'true'::jsonb then
      return 'REBATE_MARGINAL_RELIEF_UNSUPPORTED';
    end if;
  end if;

  return null;
end;
$function$;

-- Ownership deliberately NOT set: every `app.*` helper in this schema is owned
-- by `postgres` (only the `public.*` guarded RPCs are owned by `app_writer`),
-- and `app_writer` holds USAGE but not CREATE on schema `app`, so an
-- `alter function ... owner to app_writer` here fails outright. Grants follow
-- the siblings exactly: revoked from PUBLIC, executable by the two roles that
-- actually call it.
revoke all on function app.tax_case_rebate_relief_blocked(uuid) from public;
grant execute on function app.tax_case_rebate_relief_blocked(uuid) to app_writer;
grant execute on function app.tax_case_rebate_relief_blocked(uuid) to authenticated;

-- ============================================================
-- The four guarded RPCs, re-emitted verbatim from the live catalog with exactly
-- one inserted guard block each.
-- ============================================================


CREATE OR REPLACE FUNCTION public.prepare_client_review(p_tax_case_id uuid, p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'This tax case is not approval-ready (%). The computation engine did not report a complete surcharge / marginal-relief treatment for this case, so it must be prepared manually by a professional.', v_risk_blocked
      using errcode = '22023';
  end if;

  -- K4-12: the SEPARATE section 87A rebate-threshold relief gate. Reuses
  -- `v_risk_blocked` and the same fail-closed shape as the surcharge gate
  -- above; the two windows are disjoint, so at most one can ever fire.
  v_risk_blocked := app.tax_case_rebate_relief_blocked(v_latest);
  if v_risk_blocked is not null then
    raise exception 'This tax case is not approval-ready (%). The computation engine did not report a complete section 87A rebate-threshold marginal-relief treatment for this case, so it must be prepared manually by a professional.', v_risk_blocked
      using errcode = '22023';
  end if;

  update public.tax_cases set
    client_review_snapshot_id    = v_latest,
    client_review_status         = 'prepared',
    client_review_manifest_id    = null,
    client_review_manifest_hash  = null,
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
$function$;

alter function public.prepare_client_review(uuid, uuid) owner to app_writer;
revoke all on function public.prepare_client_review(uuid, uuid) from public;
grant execute on function public.prepare_client_review(uuid, uuid) to app_writer;
grant execute on function public.prepare_client_review(uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.capture_client_approval(p_tax_case_id uuid, p_manifest_id uuid, p_method text, p_reference text, p_approved_at timestamp with time zone, p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'Client approval is out of date â€” a newer snapshot exists. Prepare the latest snapshot again.'
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
    raise exception 'This tax case is not approval-ready (%). The computation engine did not report a complete surcharge / marginal-relief treatment for this case, so it must be prepared manually by a professional.', v_risk_blocked
      using errcode = '22023';
  end if;

  -- K4-12: the SEPARATE section 87A rebate-threshold relief gate. Reuses
  -- `v_risk_blocked` and the same fail-closed shape as the surcharge gate
  -- above; the two windows are disjoint, so at most one can ever fire.
  v_risk_blocked := app.tax_case_rebate_relief_blocked(v_latest);
  if v_risk_blocked is not null then
    raise exception 'This tax case is not approval-ready (%). The computation engine did not report a complete section 87A rebate-threshold marginal-relief treatment for this case, so it must be prepared manually by a professional.', v_risk_blocked
      using errcode = '22023';
  end if;

  -- K3-32B: the manifest must exist, belong to THIS case, and be bound to
  -- THE EXACT snapshot being approved â€” never a manifest for a different
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

  -- K4-01/K4-02/K4-03/K4-05: defense-in-depth re-check â€” the manifest could
  -- only exist already-clear of this block (create_evidence_manifest
  -- refuses it), but this RPC never trusts that without re-deriving it
  -- directly. As of K4-05 this can only fire for
  -- RESIDENTIAL_STATUS_UNRESOLVED.
  v_senior_blocked := app.tax_case_senior_treatment_blocked_for_manifest(p_manifest_id);
  if v_senior_blocked is not null then
    raise exception 'This tax case is not approval-ready (%). Residential status must be resolved before capturing approval.', v_senior_blocked
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
$function$;

alter function public.capture_client_approval(uuid, uuid, text, text, timestamptz, uuid) owner to app_writer;
revoke all on function public.capture_client_approval(uuid, uuid, text, text, timestamptz, uuid) from public;
grant execute on function public.capture_client_approval(uuid, uuid, text, text, timestamptz, uuid) to app_writer;
grant execute on function public.capture_client_approval(uuid, uuid, text, text, timestamptz, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.finalize_tax_case(p_tax_case_id uuid, p_snapshot_id uuid, p_note text, p_confirm boolean, p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'Cannot finalize (%). The computation engine did not report a complete surcharge / marginal-relief treatment for this case, so it must be prepared manually by a professional.', v_risk_blocked
      using errcode = '22023';
  end if;

  -- K4-12: the SEPARATE section 87A rebate-threshold relief gate. Reuses
  -- `v_risk_blocked` and the same fail-closed shape as the surcharge gate
  -- above; the two windows are disjoint, so at most one can ever fire.
  v_risk_blocked := app.tax_case_rebate_relief_blocked(p_snapshot_id);
  if v_risk_blocked is not null then
    raise exception 'Cannot finalize (%). The computation engine did not report a complete section 87A rebate-threshold marginal-relief treatment for this case, so it must be prepared manually by a professional.', v_risk_blocked
      using errcode = '22023';
  end if;

  -- K4-01/K4-02/K4-03/K4-05: re-check against the case's CURRENTLY bound
  -- review manifest, when one exists. A case without any bound manifest has
  -- no regime-specific senior-treatment fact to re-check here (filing
  -- readiness / client review already require a current approval bound to a
  -- manifest before finalize is offered in the UI) â€” this is defense-in-
  -- depth on top of that, not a new independent gate for the no-manifest
  -- case. As of K4-05 this can only fire for RESIDENTIAL_STATUS_UNRESOLVED.
  if v_review_manifest_id is not null then
    v_senior_blocked := app.tax_case_senior_treatment_blocked_for_manifest(v_review_manifest_id);
    if v_senior_blocked is not null then
      raise exception 'Cannot finalize (%). Residential status must be resolved before finalizing.', v_senior_blocked
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
$function$;

alter function public.finalize_tax_case(uuid, uuid, text, boolean, uuid) owner to app_writer;
revoke all on function public.finalize_tax_case(uuid, uuid, text, boolean, uuid) from public;
grant execute on function public.finalize_tax_case(uuid, uuid, text, boolean, uuid) to app_writer;
grant execute on function public.finalize_tax_case(uuid, uuid, text, boolean, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.create_evidence_manifest(p_tax_case_id uuid, p_snapshot_id uuid, p_selected_regime text, p_manifest_payload jsonb, p_manifest_content_hash text, p_validation_rules_version text, p_tax_pack_id text, p_tax_pack_version text, p_tax_pack_lifecycle_status text, p_pre_approval_capability_result jsonb, p_snapshot_capability_result jsonb, p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- K4-01/K4-02/K4-03/K4-05: the senior/super-senior selected-regime gate.
  -- Re-derived from the database (residential_status, client date_of_birth)
  -- â€” never trusted from the TypeScript-side p_snapshot_capability_result.
  -- As of K4-05 this can only fire for RESIDENTIAL_STATUS_UNRESOLVED â€” the
  -- OLD-regime age-based block was removed (see the helper function above).
  v_senior_blocked := app.tax_case_senior_treatment_blocked_for_case_regime(p_tax_case_id, p_selected_regime);
  if v_senior_blocked is not null then
    raise exception 'Not eligible for an evidence manifest under the % regime (%). Residential status must be resolved before an evidence manifest can be created.',
      p_selected_regime, v_senior_blocked using errcode = '22023';
  end if;

  -- The gate this RPC enforces: the SELECTED regime's own total income, never
  -- the conservative higher-of-both figure. Re-derived from the database,
  -- never trusted from p_snapshot_capability_result.
  v_risk_blocked := app.tax_case_surcharge_risk_blocked_for_regime(p_snapshot_id, p_selected_regime);
  if v_risk_blocked is not null then
    raise exception 'Not eligible for an evidence manifest under the % regime (%). The computation engine did not report a complete surcharge / marginal-relief treatment for this case, so it must be prepared manually by a professional.',
      p_selected_regime, v_risk_blocked using errcode = '22023';
  end if;

  -- K4-12: the SEPARATE section 87A rebate-threshold relief gate. Reuses
  -- `v_risk_blocked` and the same fail-closed shape as the surcharge gate
  -- above; the two windows are disjoint, so at most one can ever fire.
  v_risk_blocked := app.tax_case_rebate_relief_blocked(p_snapshot_id);
  if v_risk_blocked is not null then
    raise exception 'Not eligible for an evidence manifest (%). The computation engine did not report a complete section 87A rebate-threshold marginal-relief treatment for this case, so it must be prepared manually by a professional.', v_risk_blocked
      using errcode = '22023';
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
$function$;

alter function public.create_evidence_manifest(uuid, uuid, text, jsonb, text, text, text, text, text, jsonb, jsonb, uuid) owner to app_writer;
revoke all on function public.create_evidence_manifest(uuid, uuid, text, jsonb, text, text, text, text, text, jsonb, jsonb, uuid) from public;
grant execute on function public.create_evidence_manifest(uuid, uuid, text, jsonb, text, text, text, text, text, jsonb, jsonb, uuid) to app_writer;
grant execute on function public.create_evidence_manifest(uuid, uuid, text, jsonb, text, text, text, text, text, jsonb, jsonb, uuid) to authenticated;
