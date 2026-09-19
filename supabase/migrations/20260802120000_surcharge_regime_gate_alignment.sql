-- ============================================================
-- TaxDesk OS — 20260802120000 MAINT-05: align BOTH surcharge SQL gates on the
-- engine's own verdict, and make the backstop fail CLOSED on malformed input.
--
-- Closes AUDIT-05-F1 (high) and AUDIT-05-F4 (medium). Additive: no table, no
-- column, no index, no policy, no new object. It replaces two `app.*` helpers
-- and re-emits four guarded RPCs whose ONLY change is one sentence of refusal
-- text. Local Supabase only; NOT deployed, NOT run against production.
--
-- ------------------------------------------------------------
-- AUDIT-05-F1 — the released window was inoperative in production
-- ------------------------------------------------------------
-- K4-11 (20260801130000) narrowed `app.tax_case_surcharge_risk_blocked` so a
-- case whose total income exceeds Rs 50,00,000 is released when the ENGINE'S OWN
-- stored verdict says its surcharge treatment is complete. It did NOT narrow the
-- sibling `app.tax_case_surcharge_risk_blocked_for_regime`, which kept applying
-- the pre-K4-11 rule: block ANY selected-regime total income above Rs 50,00,000,
-- with no knowledge of the verdict.
--
-- `create_evidence_manifest` is that helper's only caller and RAISES on it, and
-- `capture_client_approval` requires a manifest bound to the exact snapshot being
-- approved. So no case inside the released window could obtain a manifest, and
-- therefore none could be approved or finalized: K4-11's headline capability did
-- not take effect at all. The direction of error was safe (it blocked rather than
-- permitted) which is why AUDIT-05 rated it high, not critical.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT. The `_for_regime` helper now
-- applies the SAME release condition as its conservative sibling — the stored
-- `output_snapshot -> 'computation' -> 'surchargeTreatmentSupported'` — while
-- keeping its INTENTIONALLY DIFFERENT income base. The two helpers answer two
-- different questions and D47 records why:
--
--   * `tax_case_surcharge_risk_blocked`      — CONSERVATIVE. Higher of both
--     regimes' total income. Used pre-approval, where the regime is not yet
--     chosen, so the case must clear the gate under EITHER regime.
--   * `tax_case_surcharge_risk_blocked_for_regime` — SELECTED regime's own total
--     income. Used once staff have explicitly chosen a regime for the manifest.
--
-- That difference is preserved exactly. What was never intended to differ — the
-- RELEASE condition — no longer does. This mirrors the TypeScript layer, which
-- already threaded one verdict into both evaluations (`evidence-manifest.ts`
-- reads it once at :252 and passes it to both the conservative pre-approval
-- evaluation and the selected-regime enforcement evaluation).
--
-- Neither helper re-implements the Rs 2,00,00,000 ceiling, the band table or the
-- marginal-relief ambiguity test in PL/pgSQL. A second copy of a tax judgement in
-- SQL is the divergence class D44 exists to prevent — and F1 is what that class
-- looks like when it actually happens.
--
-- ------------------------------------------------------------
-- AUDIT-05-F4 — the backstop failed OPEN on malformed input
-- ------------------------------------------------------------
-- (a) ABSENT / NON-NUMERIC TOTALS FAILED OPEN. `greatest()` ignores NULLs and
--     yields NULL only when every argument is NULL, and the helper then returned
--     NULL — meaning NOT BLOCKED. A snapshot whose `output_snapshot.computation`
--     was empty or malformed passed the surcharge gate entirely
--     (`app.latest_complete_snapshot_id` validates only INPUT completeness). In
--     the milder form, one missing regime total let `greatest()` silently proceed
--     on the other. This is PRE-EXISTING behaviour from 20260724120000, not a
--     K4-11 regression, and it survived four audits.
--
--     Both helpers now require every total income they depend on to be present
--     AND to be a JSON **number** (`jsonb_typeof(...) = 'number'`). Anything else
--     — absent, JSON null, a JSON string, an object — returns the blocker.
--     Reading the JSON type rather than casting the text rendering also removes
--     the cast-raises-on-garbage path entirely.
--
-- (b) A JSON STRING "true" RELEASED, CONTRADICTING THE MIGRATION'S OWN COMMENT.
--     20260801130000's header claimed "any other stored value, including a JSON
--     string, a number or a null, blocks". That was FALSE: `->>` renders both a
--     JSON boolean `true` and a JSON string `"true"` as the SQL text `'true'`, so
--     `IS DISTINCT FROM 'true'` was false for both and the string released. That
--     claim is corrected here rather than in the applied migration, which is left
--     as the historical record of what was shipped.
--
--     The verdict is now compared as JSONB against the JSON boolean
--     `'true'::jsonb`. A JSON string `"true"`, the number 1, JSON null and an
--     absent key are all distinct from it and all block. This matches the
--     TypeScript authority exactly (`tax-capability.ts` uses strict `=== true`).
--
-- REACHABILITY, RECORDED HONESTLY (D134). This is a defense-in-depth fix, not an
-- authorization fix: `authenticated` holds SELECT only on
-- `tax_computation_snapshots`, so no ordinary caller can create the malformed
-- snapshot these paths need. It matters because a backstop whose whole purpose is
-- to hold when the TypeScript layer is bypassed must not fail open on input it
-- cannot parse.
--
-- BLAST RADIUS, STATED RATHER THAN DISCOVERED. Failing closed on absent totals
-- means a snapshot that carries no regime totals at all is now BLOCKED where it
-- previously passed. Every production snapshot carries them — `computeTax`
-- always emits `oldRegime`/`newRegime` — so this affects only hand-built
-- fixtures, several of which are made realistic in this same session rather than
-- having the guard weakened for them.
--
-- ------------------------------------------------------------
-- AUDIT-05-F1(b) — the refusal message was untrue
-- ------------------------------------------------------------
-- Four RPCs told the user "Surcharge/marginal relief is not implemented for this
-- income level." Since K4-11 that is simply false for a case between Rs 50,00,000
-- and Rs 2,00,00,000: it IS implemented for that income level, and the case is
-- refused for a different reason (above the ceiling, an indeterminate marginal-
-- relief reference, or a snapshot predating the verdict). This repository treats
-- a false status statement as a defect in its own right (K.2.9.4, D129).
--
-- The replacement says what is actually checked and names no threshold, so it
-- cannot drift the way a restated literal would:
--
--   "The computation engine did not report a complete surcharge / marginal-relief
--    treatment for this case, so it must be prepared manually by a professional."
--
-- The four function bodies below were taken VERBATIM from the live catalog via
-- `pg_get_functiondef` with only that sentence substituted — hand-transcribing
-- four ~120-line SECURITY DEFINER bodies is a risk this repository does not take.
-- Their logic, locking, idempotency and guards are byte-identical to what was
-- already deployed. Ownership and grants are reasserted explicitly afterwards so
-- the migration is self-contained on a fresh reset; `create or replace` preserves
-- both, and the reassertion is belt-and-braces, not a change.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CONSERVATIVE gate (higher of both regimes) — F4(a) + F4(b)
-- ------------------------------------------------------------

create or replace function app.tax_case_surcharge_risk_blocked(p_snapshot_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_old_income jsonb;
  v_new_income jsonb;
  v_total_income numeric;
  v_verdict jsonb;
begin
  if p_snapshot_id is null then
    return null;
  end if;

  select s.output_snapshot -> 'computation' -> 'oldRegime' -> 'totalIncome' -> 'value',
         s.output_snapshot -> 'computation' -> 'newRegime' -> 'totalIncome' -> 'value',
         s.output_snapshot -> 'computation' -> 'surchargeTreatmentSupported'
    into v_old_income, v_new_income, v_verdict
    from public.tax_computation_snapshots s
    where s.id = p_snapshot_id;

  -- No such snapshot: the CALLER owns "not found" and raises its own error. This
  -- helper answers "is this snapshot surcharge-blocked", and there is no snapshot
  -- to answer about.
  if not found then
    return null;
  end if;

  -- AUDIT-05-F4(a). BOTH regime totals must be present AND JSON numbers. The old
  -- code let `greatest()` swallow a NULL and, when both were NULL, returned "not
  -- blocked" — a backstop that failed open on exactly the malformed snapshot it
  -- exists to catch.
  if v_old_income is null or jsonb_typeof(v_old_income) <> 'number'
     or v_new_income is null or jsonb_typeof(v_new_income) <> 'number' then
    return 'SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED';
  end if;

  -- Conservative base (D44): the HIGHER of the two regimes, so a case must clear
  -- the gate under either. Both operands are proven non-null above, so
  -- `greatest()` can no longer hide an absent figure.
  v_total_income := greatest((v_old_income #>> '{}')::numeric, (v_new_income #>> '{}')::numeric);

  -- 50,00,000 = Rs 50 lakh. UNCHANGED from 20260724120000 — see that migration's
  -- header for the citation, and note the STRICT `>` (TAX-SAFE-01A): exactly
  -- Rs 50,00,000 attracts nil surcharge and is not blocked. Mirrors
  -- SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR in
  -- src/lib/tax-desk/tax-capability.ts; kept in sync by
  -- tests/security/surcharge-marginal-relief-blocker.mjs.
  if v_total_income > 5000000 then
    -- K4-11 release condition, corrected by AUDIT-05-F4(b): compare the stored
    -- JSONB against the JSON BOOLEAN `true`, not against its text rendering. A
    -- JSON string "true" renders as the same text and used to release; it now
    -- blocks, as do JSON null, a number, and an absent key (every pre-K4-11
    -- snapshot).
    if v_verdict is distinct from 'true'::jsonb then
      return 'SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function app.tax_case_surcharge_risk_blocked(uuid) from public;
grant execute on function app.tax_case_surcharge_risk_blocked(uuid) to app_writer;
grant execute on function app.tax_case_surcharge_risk_blocked(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. SELECTED-REGIME gate — F1 (release condition) + F4(a)/(b)
-- ------------------------------------------------------------

create or replace function app.tax_case_surcharge_risk_blocked_for_regime(p_snapshot_id uuid, p_regime text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_income jsonb;
  v_total_income numeric;
  v_verdict jsonb;
begin
  if p_snapshot_id is null or p_regime not in ('old', 'new') then
    return null;
  end if;

  -- D47's SELECTED-regime income base, preserved exactly. Read inline rather than
  -- through `app.tax_case_regime_total_income` because that helper returns
  -- `numeric` and therefore cannot distinguish "absent" from "zero" — the
  -- distinction F4(a) turns on. The other helper is left untouched: it is still
  -- the right thing for `create_evidence_manifest` to RECORD the figures with.
  select case p_regime
           when 'old' then s.output_snapshot -> 'computation' -> 'oldRegime' -> 'totalIncome' -> 'value'
           when 'new' then s.output_snapshot -> 'computation' -> 'newRegime' -> 'totalIncome' -> 'value'
         end,
         s.output_snapshot -> 'computation' -> 'surchargeTreatmentSupported'
    into v_income, v_verdict
    from public.tax_computation_snapshots s
    where s.id = p_snapshot_id;

  if not found then
    return null;
  end if;

  -- AUDIT-05-F4(a), applied to this helper too: absent or non-numeric fails
  -- CLOSED. Previously a null total income returned "not blocked".
  if v_income is null or jsonb_typeof(v_income) <> 'number' then
    return 'SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED';
  end if;
  v_total_income := (v_income #>> '{}')::numeric;

  if v_total_income > 5000000 then
    -- AUDIT-05-F1. THE FIX: exceeding Rs 50,00,000 is necessary but no longer
    -- sufficient to block. Before this migration the function returned the
    -- blocker unconditionally here, never reading the verdict, so every case in
    -- the window K4-11 released was still refused a manifest.
    if v_verdict is distinct from 'true'::jsonb then
      return 'SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function app.tax_case_surcharge_risk_blocked_for_regime(uuid, text) from public;
grant execute on function app.tax_case_surcharge_risk_blocked_for_regime(uuid, text) to app_writer;
grant execute on function app.tax_case_surcharge_risk_blocked_for_regime(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 3. Guarded RPCs — refusal wording only (F1(b))
--
-- Bodies verbatim from the live catalog; the ONLY textual difference from what
-- was already deployed is the one sentence quoted in the header above.
-- ------------------------------------------------------------

-- prepare_client_review
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

-- capture_client_approval
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
    raise exception 'This tax case is not approval-ready (%). The computation engine did not report a complete surcharge / marginal-relief treatment for this case, so it must be prepared manually by a professional.', v_risk_blocked
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

  -- K4-01/K4-02/K4-03/K4-05: defense-in-depth re-check — the manifest could
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

-- finalize_tax_case
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

  -- K4-01/K4-02/K4-03/K4-05: re-check against the case's CURRENTLY bound
  -- review manifest, when one exists. A case without any bound manifest has
  -- no regime-specific senior-treatment fact to re-check here (filing
  -- readiness / client review already require a current approval bound to a
  -- manifest before finalize is offered in the UI) — this is defense-in-
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

-- create_evidence_manifest
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
  -- — never trusted from the TypeScript-side p_snapshot_capability_result.
  -- As of K4-05 this can only fire for RESIDENTIAL_STATUS_UNRESOLVED — the
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
