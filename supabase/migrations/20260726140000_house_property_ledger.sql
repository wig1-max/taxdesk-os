-- ============================================================
-- TaxDesk OS — 20260726140000 House Property ledger (K4-06, Wave-4
-- priority #2, `k4-common-case-coverage-and-priorities.md`)
--
-- Additive-only. NEW table `tax_house_property_entries` — one row PER
-- PROPERTY (not one row per fact), mirroring `tax_capital_gain_entries`'
-- multi-column-per-row shape (a property carries several distinct facts:
-- usage, rent received, municipal taxes paid, home-loan interest) rather
-- than the single-`amount` shape of `tax_income_entries`/
-- `tax_deduction_entries`. See decision D80
-- (the k3-tax-intelligence-program design notes) for the full shape
-- rationale, including why this is a NEW table rather than an extension of
-- the existing `house_property` placeholder inside `tax_income_entries`
-- (that placeholder stays in the `income_head` vocabulary, untouched, for
-- historical-row compatibility, but the adapter no longer needs it for
-- computation once a row exists here).
--
-- Session scope: ONE property per case (multi-property / co-ownership are
-- explicitly deferred to Wave-4 priority #5, loss set-off — see the
-- roadmap's own non-goals row). This migration does NOT enforce a
-- single-row-per-case constraint at the DB layer — the ADAPTER is the
-- single authority that decides how many live rows it can safely compute
-- (see `computation-adapter.ts`'s `MULTIPLE_HOUSE_PROPERTIES_NOT_MODELLED`
-- warning), matching how `tax_capital_gain_entries` lets multiple rows
-- exist while the adapter (not a DB constraint) decides support per row.
--
-- `usage` drives Section 22/23 GAV treatment (self-occupied → deemed nil;
-- let-out → actual rent received) — see `compute-tax.ts`'s
-- `computeHouseProperty`. Soft-delete columns are added in the SAME
-- migration (unlike K4-05's `insured_party_senior` column addition to an
-- EXISTING already-soft-deleted table) because this is a brand-new table.
-- ============================================================

create table public.tax_house_property_entries (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  usage text not null check (usage in ('self_occupied', 'let_out')),
  -- Meaningful only when usage = 'let_out' (0 for self-occupied — Section
  -- 22/23 deems the annual value nil, so no rent figure is computed).
  annual_rent_received numeric(14,2) not null default 0 check (annual_rent_received >= 0),
  -- Deductible under Section 23(1) only when ACTUALLY PAID during the year
  -- (never merely accrued) — see compute-tax.ts's own caveat.
  municipal_taxes_paid numeric(14,2) not null default 0 check (municipal_taxes_paid >= 0),
  -- Section 24(b) home-loan interest. Regime/usage-aware caps (self-occupied
  -- old-regime ₹2,00,000; self-occupied new-regime disallowed; let-out
  -- uncapped at the head level, Section 71(3A) set-off capped instead) are
  -- applied by the ENGINE, never at the DB layer.
  home_loan_interest numeric(14,2) not null default 0 check (home_loan_interest >= 0),
  source_type text not null default 'manual'
    check (source_type in (
      'manual','AIS','26AS','Form16','prefilled_json','broker_report',
      'bank_certificate','adjustment')),
  source_document_id uuid references public.case_documents(id) on delete set null,
  source_file_id uuid references public.uploaded_files(id) on delete set null,
  -- Proof for the home-loan interest claim (interest certificate) — mirrors
  -- tax_deduction_entries.proof_case_document_id, a SEPARATE evidence slot
  -- from the general source_document_id (rent receipt / property document).
  proof_case_document_id uuid references public.case_documents(id) on delete set null,
  notes text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.users(id),
  delete_reason text
);

create trigger trg_tax_house_property_entries_updated_at
  before update on public.tax_house_property_entries
  for each row execute function app.set_updated_at();

create index idx_tax_house_property_entries_tax_case_id on public.tax_house_property_entries (tax_case_id);
create index idx_tax_house_property_entries_usage on public.tax_house_property_entries (usage);
create index idx_tax_house_property_entries_source_document_id on public.tax_house_property_entries (source_document_id);
create index idx_tax_house_property_entries_proof_case_document_id on public.tax_house_property_entries (proof_case_document_id);
create index idx_tax_house_property_entries_live
  on public.tax_house_property_entries (tax_case_id) where deleted_at is null;

alter table public.tax_house_property_entries enable row level security;

create policy tax_house_property_entries_select on public.tax_house_property_entries
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_house_property_entries_insert on public.tax_house_property_entries
  for insert to authenticated with check (app.is_staff_or_admin());
create policy tax_house_property_entries_update on public.tax_house_property_entries
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

grant select, insert, update on public.tax_house_property_entries to authenticated;
revoke delete on public.tax_house_property_entries from authenticated;
revoke all on public.tax_house_property_entries from anon;
