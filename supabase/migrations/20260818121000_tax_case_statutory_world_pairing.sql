-- K4-PORT-05 / D316 -- restore the two CHECKs 20260818120000 dropped.
--
-- WHY THIS MIGRATION EXISTS.
-- 20260818120000's DO block dropped every tax_cases CHECK whose
-- pg_get_constraintdef mentioned the substring assessment_year, intending
-- only to replace the unnamed founding period CHECK with a named one.
-- chk_tax_cases_period_kind lists 'assessment_year' as a VALUE, and
-- chk_tax_cases_law_period_kind pairs ITA_1961 with that same value, so
-- both were dropped after they were added. The founding period CHECK was
-- then correctly re-added as chk_tax_cases_assessment_year. This file
-- puts the two dropped constraints back. The first file is not edited
-- (an applied migration's statements are stored; D34 / K4-15-F3).
--
-- Idempotent: drop if exists + add. A later environment that somehow
-- still has them is a no-op replace. Local-only; production apply is
-- not authorised (47/47, spent).

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

comment on constraint chk_tax_cases_period_kind on public.tax_cases is
  'K4-PORT-05: closed period-kind vocabulary. Kept in lockstep with '
  'PERIOD_KINDS in src/lib/tax-pack/identity.ts; test:db pins both directions. '
  'Restored by 20260818121000 after 20260818120000 dropped it.';

comment on constraint chk_tax_cases_law_period_kind on public.tax_cases is
  'K4-PORT-05: law <-> period_kind pairing. Same mapping as periodKindForLaw '
  'in src/lib/tax-pack/case-pack.ts. Restored by 20260818121000 after '
  '20260818120000 dropped it.';
