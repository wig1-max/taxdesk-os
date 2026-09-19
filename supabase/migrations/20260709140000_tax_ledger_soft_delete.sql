-- ============================================================
-- TaxDesk OS — 20260709140000 tax ledger soft-delete (K.2.4)
--
-- Adds soft-remove columns to the four K.2.1 tax ledger tables so staff
-- can retract manual ledger entries without losing history. Hard DELETE
-- stays revoked for `authenticated` (from 20260709120000); removal is an
-- UPDATE of deleted_at, which the existing staff/admin RLS update policy
-- and table grant already permit — no policy/grant change needed.
--
-- Idempotent (add column if not exists). Matches the deleted_at pattern
-- used on clients/cases/etc. NOTE: the admin-only soft-delete TRIGGER on
-- those tables is deliberately NOT applied here — ledger entries are
-- working data that staff may retract during preparation.
-- ============================================================

alter table public.tax_income_entries
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id),
  add column if not exists delete_reason text;

alter table public.tax_tax_paid_entries
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id),
  add column if not exists delete_reason text;

alter table public.tax_deduction_entries
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id),
  add column if not exists delete_reason text;

alter table public.tax_capital_gain_entries
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id),
  add column if not exists delete_reason text;

-- Partial indexes: the ledger UI reads live (non-deleted) rows per tax case.
create index if not exists idx_tax_income_entries_live
  on public.tax_income_entries (tax_case_id) where deleted_at is null;
create index if not exists idx_tax_tax_paid_entries_live
  on public.tax_tax_paid_entries (tax_case_id) where deleted_at is null;
create index if not exists idx_tax_deduction_entries_live
  on public.tax_deduction_entries (tax_case_id) where deleted_at is null;
create index if not exists idx_tax_capital_gain_entries_live
  on public.tax_capital_gain_entries (tax_case_id) where deleted_at is null;
