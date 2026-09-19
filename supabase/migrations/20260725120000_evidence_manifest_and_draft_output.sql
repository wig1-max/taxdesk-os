-- ============================================================
-- TaxDesk OS — 20260725120000 Immutable accepted-evidence manifest +
-- persisted internal draft-output artifact (K3-32B, Wave 3)
--
-- K3-32 shipped a strong PURE/READ-MODEL draft-output projection
-- (src/lib/tax-desk/draft-output.ts) but nothing was ever written to the
-- database, so there was no durable, immutable, hash-identified record of
-- exactly what evidence a client's approval was captured against, and no
-- persisted internal draft output at all. This migration adds exactly that,
-- narrowly:
--
--   1. tax_evidence_manifests — an append-only, immutable manifest bound to
--      ONE computation snapshot + ONE EXPLICITLY selected regime (never the
--      recommended regime by default). The manifest payload + its sha256
--      content hash are computed in TypeScript (src/lib/tax-desk/
--      evidence-manifest.ts) and passed in; the guarded RPC re-derives every
--      invariant it CAN independently check (regime-specific reliance
--      blocker, snapshot completeness, case/snapshot ownership) rather than
--      trusting the caller for anything it can verify itself — same
--      "SECURITY DEFINER never trusts the caller" discipline as every prior
--      guarded RPC in this repository.
--   2. tax_draft_outputs — an append-only, immutable internal draft-output
--      artifact derived EXCLUSIVELY from an approved, hash-matching manifest.
--      Not ITD JSON, not a filing payload.
--   3. tax_cases gains client_review_manifest_id / client_review_manifest_hash
--      — approval now binds to the EXACT manifest (in addition to the
--      pre-existing client_review_snapshot_id), never only the snapshot.
--      prepare_client_review resets both to null (same reset discipline as
--      every other review column); capture_client_approval now REQUIRES a
--      manifest id and verifies it belongs to the exact snapshot being
--      approved before binding.
--   4. app.tax_case_regime_total_income / app.tax_case_surcharge_risk_blocked_for_regime
--      — a regime-SELECTIVE sibling of the existing (TAX-SAFE-01A)
--      app.tax_case_surcharge_risk_blocked, which uses the CONSERVATIVE
--      higher-of-both-regimes figure. Both are used deliberately, for
--      different questions: preparation-stage checks (prepare/approve/
--      finalize) keep using the conservative figure; a manifest's own
--      creation gate uses ONLY its selected regime's figure (a case whose
--      NON-selected regime exceeds the threshold does not block a manifest
--      for a selected regime that does not — see evidence-manifest.ts's
--      module doc). The ₹50,00,000 literal is duplicated here exactly as the
--      TAX-SAFE-01A migration already duplicates it (SQL cannot import the
--      TypeScript constant); tests/security/evidence-manifest-workflow.mjs
--      proves both SQL functions and the TS evaluator agree at the boundary.
--
-- SYNTHETIC DATA ONLY. No engine/adapter/computation semantic changed. No
-- tax rule, rate, slab or surcharge amount computed here. Local Supabase
-- only; NOT deployed, NOT run against production.
-- ============================================================

-- ------------------------------------------------------------
-- 0. tax_evidence_manifests
-- ------------------------------------------------------------
create table public.tax_evidence_manifests (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  computation_snapshot_id uuid not null references public.tax_computation_snapshots(id),

  manifest_schema_version text not null default 'TAX_EVIDENCE_MANIFEST_V1'
    check (manifest_schema_version = 'TAX_EVIDENCE_MANIFEST_V1'),
  manifest_payload jsonb not null,
  manifest_content_hash text not null check (manifest_content_hash ~ '^[0-9a-f]{64}$'),

  selected_regime text not null check (selected_regime in ('old', 'new')),
  selected_regime_total_income numeric(14, 2) not null,
  pre_approval_conservative_total_income numeric(14, 2),

  -- Blocker-code snapshots for audit/disclosure only. A manifest can only be
  -- CREATED when active_blocker_codes is empty (the RPC re-checks and
  -- refuses otherwise) — pre_approval_capability_result may legitimately
  -- carry a blocker even when the manifest itself does not (see module doc).
  pre_approval_capability_result jsonb not null default '{}'::jsonb,
  snapshot_capability_result jsonb not null default '{}'::jsonb,
  active_blocker_codes text[] not null default '{}',

  tax_pack_id text not null,
  tax_pack_version text not null,
  tax_pack_lifecycle_status text not null,
  validation_identity jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id),
  event_id uuid
);

create index idx_tax_evidence_manifests_tax_case_id on public.tax_evidence_manifests (tax_case_id);
create index idx_tax_evidence_manifests_snapshot_id on public.tax_evidence_manifests (computation_snapshot_id);
create unique index uq_tax_evidence_manifests_event_id
  on public.tax_evidence_manifests (event_id) where event_id is not null;

alter table public.tax_evidence_manifests enable row level security;

-- Base-table read is staff/admin (mirrors tax_source_proposals). NO
-- authenticated insert/update/delete policy or grant at all — every write
-- goes through the guarded RPC below, and there is no UPDATE path for
-- anyone: the manifest is immutable for its entire life.
drop policy if exists tax_evidence_manifests_select on public.tax_evidence_manifests;
create policy tax_evidence_manifests_select on public.tax_evidence_manifests
  for select to authenticated using (app.is_staff_or_admin());

revoke all on public.tax_evidence_manifests from anon;
revoke insert, update, delete on public.tax_evidence_manifests from authenticated;
grant select on public.tax_evidence_manifests to authenticated;
grant select, insert on public.tax_evidence_manifests to app_writer; -- INSERT only — no UPDATE, ever.

-- ------------------------------------------------------------
-- 1. tax_draft_outputs
-- ------------------------------------------------------------
create table public.tax_draft_outputs (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  source_snapshot_id uuid not null references public.tax_computation_snapshots(id),
  source_manifest_id uuid not null references public.tax_evidence_manifests(id),
  source_manifest_hash text not null check (source_manifest_hash ~ '^[0-9a-f]{64}$'),

  package_schema_version text not null default 'TAX_DRAFT_OUTPUT_PACKAGE_V1'
    check (package_schema_version = 'TAX_DRAFT_OUTPUT_PACKAGE_V1'),
  package_payload jsonb not null,
  package_content_hash text not null check (package_content_hash ~ '^[0-9a-f]{64}$'),

  status text not null default 'internal_draft' check (status = 'internal_draft'),

  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id),
  event_id uuid not null
);

create index idx_tax_draft_outputs_tax_case_id on public.tax_draft_outputs (tax_case_id);
create index idx_tax_draft_outputs_manifest_id on public.tax_draft_outputs (source_manifest_id);
create unique index uq_tax_draft_outputs_event_id on public.tax_draft_outputs (event_id);

alter table public.tax_draft_outputs enable row level security;

drop policy if exists tax_draft_outputs_select on public.tax_draft_outputs;
create policy tax_draft_outputs_select on public.tax_draft_outputs
  for select to authenticated using (app.is_staff_or_admin());

revoke all on public.tax_draft_outputs from anon;
revoke insert, update, delete on public.tax_draft_outputs from authenticated;
grant select on public.tax_draft_outputs to authenticated;
grant select, insert on public.tax_draft_outputs to app_writer; -- INSERT only — no UPDATE, ever.

-- ------------------------------------------------------------
-- 2. tax_cases — approval now binds to the exact manifest too.
-- ------------------------------------------------------------
alter table public.tax_cases
  add column if not exists client_review_manifest_id uuid references public.tax_evidence_manifests(id),
  add column if not exists client_review_manifest_hash text;

create index if not exists idx_tax_cases_client_review_manifest_id
  on public.tax_cases (client_review_manifest_id);

-- Extend the protected-column guard (20260712140000) to cover the two new
-- columns — full function body replaced (same convention as every prior
-- session that added a protected tax_cases column); every pre-existing
-- guarded column is unchanged.
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
  or new.client_review_manifest_id     is distinct from old.client_review_manifest_id
  or new.client_review_manifest_hash   is distinct from old.client_review_manifest_hash
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

-- ------------------------------------------------------------
-- 3. Regime-selective surcharge/marginal-relief risk helpers.
-- ------------------------------------------------------------
create or replace function app.tax_case_regime_total_income(p_snapshot_id uuid, p_regime text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_regime = 'old' then (s.output_snapshot -> 'computation' -> 'oldRegime' -> 'totalIncome' ->> 'value')::numeric
    when p_regime = 'new' then (s.output_snapshot -> 'computation' -> 'newRegime' -> 'totalIncome' ->> 'value')::numeric
    else null
  end
  from public.tax_computation_snapshots s
  where s.id = p_snapshot_id;
$$;
revoke all on function app.tax_case_regime_total_income(uuid, text) from public;
grant execute on function app.tax_case_regime_total_income(uuid, text) to app_writer;
grant execute on function app.tax_case_regime_total_income(uuid, text) to authenticated;

-- Mirrors app.tax_case_surcharge_risk_blocked (TAX-SAFE-01A) exactly, except
-- it reads ONE regime's own total income instead of the conservative
-- greatest() of both — see the migration header for why both exist. Same
-- STRICT `>` boundary (D44): exactly Rs 50,00,000 is not blocked.
create or replace function app.tax_case_surcharge_risk_blocked_for_regime(p_snapshot_id uuid, p_regime text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total_income numeric;
begin
  if p_snapshot_id is null or p_regime not in ('old', 'new') then
    return null;
  end if;
  v_total_income := app.tax_case_regime_total_income(p_snapshot_id, p_regime);
  if v_total_income is null then
    return null;
  end if;
  if v_total_income > 5000000 then
    return 'SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED';
  end if;
  return null;
end;
$$;
revoke all on function app.tax_case_surcharge_risk_blocked_for_regime(uuid, text) from public;
grant execute on function app.tax_case_surcharge_risk_blocked_for_regime(uuid, text) to app_writer;
grant execute on function app.tax_case_surcharge_risk_blocked_for_regime(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 4. create_evidence_manifest — the ONLY path an evidence manifest may be
--    created through. The payload/hash are computed in TypeScript
--    (evidence-manifest.ts, which itself reuses the SAME describeCaseTraceability
--    + evaluateTaxCapability authorities every other production surface
--    uses); this RPC independently re-derives every invariant it CAN check
--    from the database alone and refuses if the caller's regime choice would
--    be reliance-blocked, regardless of what the payload claims.
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

  -- entity_id MUST match the entity app.event_already_applied was checked
  -- against above (p_snapshot_id::text) — a replay looks this row up by
  -- event_id and re-validates (action, actor, entity) against exactly what
  -- was recorded here, so using a different entity (e.g. the newly minted
  -- manifest id) would make a genuine replay indistinguishable from a
  -- conflicting reuse.
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
-- 5. capture_client_approval — now REQUIRES an evidence manifest and binds
--    approval to it (full function body replaced; K3-32B adds p_manifest_id
--    and the manifest-binding block; every existing TAX-SAFE-01/01A check is
--    unchanged).
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
-- 6. prepare_client_review — also resets the manifest binding (full function
--    body replaced; every existing check unchanged).
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
$$;

-- ------------------------------------------------------------
-- 7. generate_internal_draft_output — the ONLY path a persisted draft-output
--    artifact may be created through. Re-verifies EVERY condition against
--    live database state — never trusts p_package_payload's own claims about
--    approval, blockers, or validation.
-- ------------------------------------------------------------
create or replace function public.generate_internal_draft_output(
  p_tax_case_id           uuid,
  p_manifest_id           uuid,
  p_package_payload       jsonb,
  p_package_content_hash  text,
  p_event_id              uuid
) returns table (draft_output_id uuid, already_generated boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_case_id uuid;
  v_finalized timestamptz;
  v_review_status text;
  v_review_snap uuid;
  v_review_manifest uuid;
  v_manifest_case_id uuid;
  v_manifest_snapshot_id uuid;
  v_manifest_hash text;
  v_manifest_blockers text[];
  v_open_err int;
  v_existing uuid;
  v_new_id uuid;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if p_package_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Malformed package content hash.' using errcode = '22023';
  end if;
  if p_package_payload is null then
    raise exception 'Package payload is required.' using errcode = '22023';
  end if;

  -- Idempotent replay: same event_id must resolve to the SAME manifest, or
  -- it is a conflicting reuse of the event id (never a silent no-op with
  -- different inputs — same discipline as decide_source_proposal).
  select id into v_existing from public.tax_draft_outputs where event_id = p_event_id;
  if v_existing is not null then
    -- Deliberately NOT errcode 23505 here: this function's own `exception
    -- when unique_violation` handler below exists to catch a genuine
    -- CONCURRENT-INSERT race on uq_tax_draft_outputs_event_id and treat it as
    -- an idempotent replay — using 23505 for this APPLICATION-LEVEL conflict
    -- check would make that handler swallow it and silently return the
    -- existing row instead of surfacing the conflict (caught by this
    -- session's own security test, M19b).
    if (select source_manifest_id from public.tax_draft_outputs where id = v_existing) <> p_manifest_id then
      raise exception 'event_id % was already used to generate a draft output from a different manifest.', p_event_id
        using errcode = '22023';
    end if;
    draft_output_id := v_existing;
    already_generated := true;
    return next;
    return;
  end if;

  select tc.case_id, tc.finalized_at, tc.client_review_status, tc.client_review_snapshot_id, tc.client_review_manifest_id
    into v_case_id, v_finalized, v_review_status, v_review_snap, v_review_manifest
    from public.tax_cases tc where tc.id = p_tax_case_id for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized and read-only.' using errcode = '42501';
  end if;

  -- No FOR UPDATE here: the manifest is immutable (app_writer holds no
  -- UPDATE grant on tax_evidence_manifests at all — SELECT ... FOR UPDATE
  -- would fail with "permission denied" since Postgres requires UPDATE
  -- privilege for a row lock, not just SELECT). Concurrency safety for the
  -- draft-output row itself comes from the tax_cases row lock above plus the
  -- event_id uniqueness/replay handling below, never from locking a row that
  -- can never be written to again.
  select m.tax_case_id, m.computation_snapshot_id, m.manifest_content_hash, m.active_blocker_codes
    into v_manifest_case_id, v_manifest_snapshot_id, v_manifest_hash, v_manifest_blockers
    from public.tax_evidence_manifests m
    where m.id = p_manifest_id;
  if v_manifest_case_id is null then
    raise exception 'Evidence manifest not found.' using errcode = 'P0002';
  end if;
  if v_manifest_case_id <> p_tax_case_id then
    raise exception 'Evidence manifest does not belong to this case.' using errcode = '42501';
  end if;

  -- Approval must be CURRENT for this exact snapshot AND this exact
  -- manifest — a stale approval (superseded snapshot, or a later manifest
  -- regenerated for the same snapshot) never generates output.
  if v_review_status <> 'approved' or v_review_snap is distinct from v_manifest_snapshot_id
     or v_review_manifest is distinct from p_manifest_id then
    raise exception 'Client approval is not current for this manifest. Capture a fresh approval bound to this exact manifest.'
      using errcode = '22023';
  end if;

  if coalesce(array_length(v_manifest_blockers, 1), 0) > 0 then
    raise exception 'This manifest carries an active reliance blocker (%) and cannot produce a draft output.',
      array_to_string(v_manifest_blockers, ', ') using errcode = '22023';
  end if;

  select count(*) into v_open_err
    from public.tax_validation_findings f
    where f.tax_case_id = p_tax_case_id and f.status = 'open'
      and f.severity in ('error', 'blocker');
  if v_open_err > 0 then
    raise exception 'Resolve open validation errors before generating a draft output.' using errcode = '22023';
  end if;

  insert into public.tax_draft_outputs
    (tax_case_id, source_snapshot_id, source_manifest_id, source_manifest_hash,
     package_payload, package_content_hash, created_by, event_id)
  values
    (p_tax_case_id, v_manifest_snapshot_id, p_manifest_id, v_manifest_hash,
     p_package_payload, p_package_content_hash, v_actor, p_event_id)
  returning id into v_new_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_draft_output.generated', 'tax_draft_outputs', v_new_id::text, v_case_id,
     jsonb_build_object('tax_case_id', p_tax_case_id, 'manifest_id', p_manifest_id,
                        'draft_output_id', v_new_id, 'package_content_hash', p_package_content_hash),
     p_event_id);

  draft_output_id := v_new_id;
  already_generated := false;
  return next;
  return;
exception
  when unique_violation then
    select id into v_existing from public.tax_draft_outputs where event_id = p_event_id;
    if v_existing is not null then
      draft_output_id := v_existing;
      already_generated := true;
      return next;
      return;
    end if;
    raise;
end;
$$;

-- ------------------------------------------------------------
-- 8. Ownership + least-privilege grants.
-- ------------------------------------------------------------
grant create on schema public to app_writer;
do $$
declare
  fn text;
  fns text[] := array[
    'create_evidence_manifest(uuid,uuid,text,jsonb,text,text,text,text,text,jsonb,jsonb,uuid)',
    'generate_internal_draft_output(uuid,uuid,jsonb,text,uuid)'
  ];
begin
  foreach fn in array fns loop
    execute format('alter function public.%s owner to app_writer;', fn);
    execute format('revoke all on function public.%s from public;', fn);
    execute format('revoke all on function public.%s from anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;

-- These two also need ALTER OWNER (re-asserted defense-in-depth, same as the
-- TAX-SAFE-01A migration) — kept inside the same CREATE-privilege window as
-- the block above; ALTER ... OWNER TO requires the NEW owner to hold CREATE
-- on the schema even when the current session is superuser.
alter function public.capture_client_approval(uuid, uuid, text, text, timestamptz, uuid) owner to app_writer;
alter function public.prepare_client_review(uuid, uuid) owner to app_writer;
revoke all on function public.capture_client_approval(uuid, uuid, text, text, timestamptz, uuid) from public;
revoke all on function public.prepare_client_review(uuid, uuid) from public;
grant execute on function public.capture_client_approval(uuid, uuid, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.prepare_client_review(uuid, uuid) to authenticated;

revoke create on schema public from app_writer;

-- The OLD 5-argument capture_client_approval signature (pre-K3-32B) no
-- longer exists as a distinct overload once replaced above (CREATE OR
-- REPLACE cannot change a function's argument list in place) — drop it
-- explicitly so no stale, differently-gated overload is reachable via
-- PostgREST's function-by-name RPC resolution.
drop function if exists public.capture_client_approval(uuid, text, text, timestamptz, uuid);
