-- ============================================================
-- TaxDesk OS — 20260801130000 Narrow the surcharge / marginal-relief
-- reliance blocker to what K4-11 actually implements.
--
-- BACKGROUND. 20260724120000 added an automatic, income-derived database
-- backstop: a case whose latest complete snapshot's own computed total income
-- (the conservative HIGHER of both regimes) EXCEEDS Rs 50,00,000 is rejected by
-- prepare_client_review, capture_client_approval and finalize_tax_case. That
-- was correct while the engine implemented NO surcharge at all.
--
-- WHAT CHANGED (K4-11). The engine now computes surcharge and marginal relief
-- for a total income up to Rs 2,00,00,000 — the 10% and 15% tiers, where the
-- Finance Act's own proviso capping surcharge on dividend / section 111A / 112
-- / 112A income at 15% is provably NON-BINDING (both tier rates are at or below
-- 15%), so no apportionment of income-tax between capped and uncapped parts is
-- needed. Above that ceiling, and for a case whose marginal-relief reference
-- income composition the statute does not fix, the engine still computes
-- nothing and the case must still be blocked.
--
-- HOW THIS FUNCTION NARROWS, AND WHY IT DOES NOT RE-DERIVE THE RULE. The
-- trigger CONDITION is unchanged: total income strictly exceeding Rs 50,00,000
-- still puts a case in scope, and the Rs 50,00,000 literal below is untouched.
-- What changes is the RELEASE — a case in scope is cleared only when the
-- ENGINE'S OWN verdict, stored immutably in the same snapshot, says the
-- treatment was completed:
--
--     output_snapshot -> 'computation' ->> 'surchargeTreatmentSupported'
--
-- That boolean is written by src/lib/tax-engine/ay-2026-27/surcharge.ts, which
-- is the single authority for "can this case's surcharge be computed". This
-- function deliberately does NOT re-implement the Rs 2,00,00,000 ceiling, the
-- band table or the marginal-relief ambiguity test in PL/pgSQL. A second copy
-- of a tax judgement in SQL is exactly the divergence TAX-SAFE-01A found when
-- three of four enforcement layers had each derived the income base their own
-- way (decision D44) — and it would drift silently the first time the window
-- moved. The TypeScript layers (Computation banner, filing readiness,
-- client-review actions) read the same stored boolean, so all four layers
-- agree by construction rather than by discipline.
--
-- FAILS CLOSED, TWICE OVER. `->>` yields NULL when the key is absent, so a
-- snapshot computed BEFORE K4-11 — which carries no such property — is never
-- treated as supported and keeps exactly its pre-K4-11 treatment (blocked).
-- The comparison is against the literal text 'true' only: any other stored
-- value, including a JSON string, a number or a null, blocks.
--
-- This is a narrowing of an existing blocker, not a new capability: no
-- surcharge or marginal-relief AMOUNT is computed here or anywhere else in SQL.
--
-- ADDITIVE. No table structure changes, no new object, no grant change beyond
-- reasserting what already exists. Local Supabase only; NOT deployed, NOT run
-- against production.
-- ============================================================

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
  v_surcharge_supported text;
begin
  if p_snapshot_id is null then
    return null;
  end if;

  select (s.output_snapshot -> 'computation' -> 'oldRegime' -> 'totalIncome' ->> 'value')::numeric,
         (s.output_snapshot -> 'computation' -> 'newRegime' -> 'totalIncome' ->> 'value')::numeric,
         (s.output_snapshot -> 'computation' ->> 'surchargeTreatmentSupported')
    into v_old_total_income, v_new_total_income, v_surcharge_supported
    from public.tax_computation_snapshots s
    where s.id = p_snapshot_id;

  v_total_income := greatest(v_old_total_income, v_new_total_income);
  if v_total_income is null then
    return null;
  end if;

  -- 50,00,000 = Rs 50 lakh. UNCHANGED from 20260724120000 — see that
  -- migration's header for the citation, and note the STRICT `>`
  -- (TAX-SAFE-01A): exactly Rs 50,00,000 attracts nil surcharge and is not
  -- blocked. Mirrors SURCHARGE_MARGINAL_RELIEF_RISK_THRESHOLD_INR in
  -- src/lib/tax-desk/tax-capability.ts; kept in sync by
  -- tests/security/surcharge-marginal-relief-blocker.mjs, which proves both
  -- layers agree at and around the threshold AND on both sides of the K4-11
  -- release condition below.
  if v_total_income > 5000000 then
    -- K4-11: release ONLY on the engine's own stored verdict. Absent, null, or
    -- anything other than the literal 'true' keeps the case blocked.
    if v_surcharge_supported is distinct from 'true' then
      return 'SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function app.tax_case_surcharge_risk_blocked(uuid) from public;
grant execute on function app.tax_case_surcharge_risk_blocked(uuid) to app_writer;
grant execute on function app.tax_case_surcharge_risk_blocked(uuid) to authenticated;
