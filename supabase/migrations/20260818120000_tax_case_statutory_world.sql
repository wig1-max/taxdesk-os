-- K4-PORT-05 / D316 -- the D19 law / period_kind / stored pack-key migration
-- (port slice 3).
--
-- WHY THIS MIGRATION EXISTS.
-- D19 (2026-07-19) deferred a stored pack-key column because registrable was
-- not reachable: tax_cases had no law / period_kind selector, its
-- assessment_year CHECK admitted only '2026-27', and every production caller
-- of bindDefaultTaxPackToCase passed { assessmentYear } alone, so law always
-- defaulted to ITA_1961. No case could resolve to the TY 2026-27 pack.
-- D279 repeated the same trigger: if a second world becomes reachable, the
-- pack-key column ships IN THE SAME MIGRATION, never after.
--
-- This slice makes a case row able to carry law = ITA_2025 (and the matching
-- period_kind) so case-pack.ts can resolve that case to the TY pack. It is
-- the RESOLUTION coordinate, not a computation wiring. The TY pack still
-- carries no computation surface (TY_2026_27_NO_COMPUTATION_SURFACE);
-- bindTaxPackToCase still refuses unbound. The "no stored row can reference
-- the TY coordinate, so renaming it is free" argument expires here.
--
-- WHAT THIS DOES NOT DO.
-- It does not attach a computation surface. It does not rename the TY
-- coordinate. It does not widen financial_year (inventing a TY FY pairing
-- is a later question; the existing CHECK still admits only '2025-26').
-- It does not rewrite any guarded RPC body -- they read assessment_year as
-- the period string, which stays '2026-27' in both worlds.
--
-- CHECK CONSTRAINT STORY.
-- assessment_year still admits only '2026-27'. The TY world's period is
-- also '2026-27' (TY_2026_27_PERIOD), so widening the year set would invent
-- a period neither pack registers. The unnamed founding CHECK is replaced
-- with a named one so test:db can parse it both ways against the packs'
-- own period constants (the K4-19 SPECIAL_SITUATIONS shape).
--
-- SAFETY SHAPE.
-- Additive columns with defaults, so every existing row becomes
-- ITA_1961 / assessment_year / the current AY pack key and stays valid.
-- The pairing CHECK (ITA_1961 <-> assessment_year, ITA_2025 <-> tax_year)
-- is the same mapping periodKindForLaw already owns. tax_pack_key must
-- begin IN:{law}:{period_kind}:{assessment_year}: so the stored key cannot
-- silently disagree with the coordinate columns. Authenticated INSERT is
-- granted on the three new columns (creation-time, like assessment_year);
-- UPDATE is not. The protected-column trigger refuses an authenticated
-- change after insert -- coordinates are immutable without a guarded
-- transition, and this session ships none.
--
-- Local-only (D34): apply with migration up --local after db:guard reports
-- no linked project. Production is at 47/47; that apply authorization is
-- SPENT. Applying this remotely needs a new, exact authorization.

-- ------------------------------------------------------------
-- 1. Coordinate columns. Defaults keep every existing row in the 1961 world.
-- ------------------------------------------------------------
alter table public.tax_cases
  add column if not exists law text not null default 'ITA_1961';

alter table public.tax_cases
  add column if not exists period_kind text not null default 'assessment_year';

alter table public.tax_cases
  add column if not exists tax_pack_key text not null
    default 'IN:ITA_1961:assessment_year:2026-27:AY_2026_27_V2_PREP_ONLY';

alter table public.tax_cases
  drop constraint if exists chk_tax_cases_law;
alter table public.tax_cases
  add constraint chk_tax_cases_law
  check (law in ('ITA_1961', 'ITA_2025'));

alter table public.tax_cases
  drop constraint if exists chk_tax_cases_period_kind;
alter table public.tax_cases
  add constraint chk_tax_cases_period_kind
  check (period_kind in ('assessment_year', 'tax_year'));

alter table public.tax_cases
  drop constraint if exists chk_tax_cases_law_period_kind;
alter table public.tax_cases
  add constraint chk_tax_cases_law_period_kind
  check (
    (law = 'ITA_1961' and period_kind = 'assessment_year')
    or (law = 'ITA_2025' and period_kind = 'tax_year')
  );

alter table public.tax_cases
  drop constraint if exists chk_tax_cases_tax_pack_key_prefix;
alter table public.tax_cases
  add constraint chk_tax_cases_tax_pack_key_prefix
  check (
    tax_pack_key like ('IN:' || law || ':' || period_kind || ':' || assessment_year || ':%')
  );

comment on column public.tax_cases.law is
  'K4-PORT-05 / D316: statutory basis. ITA_1961 (default) or ITA_2025. '
  'Locked to period_kind by chk_tax_cases_law_period_kind. Vocabulary pinned '
  'both ways against TAX_LAWS in src/lib/tax-pack/identity.ts.';

comment on column public.tax_cases.period_kind is
  'K4-PORT-05 / D316: period-counting model. assessment_year (1961 Act) or '
  'tax_year (2025 Act). Derived from law at insert; not independently chosen. '
  'Vocabulary pinned both ways against PERIOD_KINDS.';

comment on column public.tax_cases.tax_pack_key is
  'K4-PORT-05 / D316: canonical pack key '
  '(jurisdiction:law:periodKind:period:computationRulesVersion) stored in the '
  'same migration as the world selector (D19 / D279). Prefix-checked against '
  'the coordinate columns. Written at insert; not a live resolution pin this '
  'slice -- callers still resolve via law + period through case-pack.ts.';

comment on constraint chk_tax_cases_law on public.tax_cases is
  'K4-PORT-05: closed statutory-basis vocabulary. Kept in lockstep with '
  'TAX_LAWS in src/lib/tax-pack/identity.ts; test:db pins both directions.';

comment on constraint chk_tax_cases_period_kind on public.tax_cases is
  'K4-PORT-05: closed period-kind vocabulary. Kept in lockstep with '
  'PERIOD_KINDS in src/lib/tax-pack/identity.ts; test:db pins both directions.';

comment on constraint chk_tax_cases_law_period_kind on public.tax_cases is
  'K4-PORT-05: law <-> period_kind pairing. Same mapping as periodKindForLaw '
  'in src/lib/tax-pack/case-pack.ts. A mixed pair is refused, never guessed.';

comment on constraint chk_tax_cases_tax_pack_key_prefix on public.tax_cases is
  'K4-PORT-05: stored pack-key must name THIS row''s coordinates, so a key '
  'from the other world cannot land on the row.';

-- ------------------------------------------------------------
-- 2. Name the assessment_year CHECK. Members are unchanged: only '2026-27',
--    which is as far as the TY world needs (TY_2026_27_PERIOD is '2026-27').
-- ------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.tax_cases'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ 'assessment_year'
      and c.conname not in (
        'chk_tax_cases_assessment_year',
        'chk_tax_cases_tax_pack_key_prefix'
      )
  loop
    execute format('alter table public.tax_cases drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.tax_cases
  drop constraint if exists chk_tax_cases_assessment_year;
alter table public.tax_cases
  add constraint chk_tax_cases_assessment_year
  check (assessment_year in ('2026-27'));

comment on constraint chk_tax_cases_assessment_year on public.tax_cases is
  'K4-PORT-05: statutory period vocabulary. Still only 2026-27 -- the TY '
  'world registers the same period string. Pinned both ways against the AY '
  'and TY packs'' own period constants.';

create index if not exists idx_tax_cases_law on public.tax_cases (law);

-- ------------------------------------------------------------
-- 3. Creation-time INSERT grants. UPDATE stays revoked (table-wide and
--    column-scoped). Matches assessment_year / financial_year.
-- ------------------------------------------------------------
grant insert (law, period_kind, tax_pack_key) on public.tax_cases to authenticated;

-- ------------------------------------------------------------
-- 4. Protected-column guard -- coordinates cannot change after insert
--    through an authenticated UPDATE, should one ever be re-granted.
--    Full body replaced (same convention as 20260725120000); every
--    pre-existing guarded column is unchanged.
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
  or new.law                     is distinct from old.law
  or new.period_kind             is distinct from old.period_kind
  or new.tax_pack_key            is distinct from old.tax_pack_key
  then
    raise exception 'Protected tax_cases columns can only change through a guarded transition.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
