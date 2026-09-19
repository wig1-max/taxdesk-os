-- ============================================================
-- TaxDesk OS — 20260726120000 Section 80D "insured party" (parent-premium)
-- sub-case (K4-05, spec §10.2's residual gap)
--
-- Additive-only. Adds ONE new `deduction_type` check-constraint value,
-- `'80D_PARENTS'`, so staff can tag a ledger row as a premium paid on behalf
-- of a PARENT rather than self/family — and ONE new nullable
-- `insured_party_senior boolean` column, meaningful ONLY when
-- `deduction_type = '80D_PARENTS'` (ignored/NULL for every other row),
-- recording whether the insured PARENT (not the taxpayer) is confirmed
-- senior/super-senior. Both default to leaving every EXISTING row exactly as
-- it already reads: no existing `deduction_type` value is touched, and the
-- new column defaults to NULL for every existing row (NULL/false is treated
-- as "not confirmed senior" by the engine — the conservative ₹25,000
-- parents-bucket cap — never inferred true).
--
-- No RLS/grant/trigger change — `tax_deduction_entries`' existing RLS
-- policies and the `app.set_updated_at()` trigger already cover every column
-- on the table generically. See
-- the k4-senior-treatment-specification design notes §10.2's `K4-04`
-- addendum for the recorded shape decision this migration implements.
-- ============================================================

alter table public.tax_deduction_entries
  drop constraint if exists tax_deduction_entries_deduction_type_check;
alter table public.tax_deduction_entries
  add constraint tax_deduction_entries_deduction_type_check
  check (deduction_type in (
    '80C', '80D', '80D_PARENTS', '80TTA', '80TTB', '80CCD', '80G', 'other_deductions'));

alter table public.tax_deduction_entries
  add column if not exists insured_party_senior boolean;

comment on column public.tax_deduction_entries.insured_party_senior is
  'K4-05: meaningful ONLY when deduction_type = ''80D_PARENTS'' — whether the insured PARENT (not the taxpayer) is senior/super-senior. NULL/false = not confirmed senior (conservative cap), never inferred true.';
