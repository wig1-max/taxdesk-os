-- ============================================================
-- TaxDesk OS — 20260709120000 Tax Desk / ITR Prep foundation (K.2.1)
--
-- Adds the native Tax Desk data foundation. NO ledger CRUD, NO
-- computation/validation behavior, NO filing/finalization workflow —
-- those arrive in K.2.2+. This migration only creates tables, checks,
-- indexes, RLS policies and grants.
--
-- Architecture: every ITR prep job stays linked to the existing case
-- system. public.cases remains the operational parent; public.tax_cases
-- is a 1:1 child (case_id unique, not null, cascade). Clients, documents,
-- files, users and audit foundations are REUSED, not duplicated.
--
-- Conventions matched from 000001/000002/20260704120000:
--   * gen_random_uuid() PKs, timestamptz created_at/updated_at
--   * app.set_updated_at() trigger reused for mutable tables
--   * RLS: deny-by-default, staff/admin via app.is_staff_or_admin();
--     NO anon policies anywhere
--   * authenticated needs EXPLICIT table grants (service_role is covered
--     by default privileges from 20260704120000)
-- ============================================================

-- ------------------------------------------------------------
-- 1. tax_cases — 1:1 child of public.cases, AY-scoped prep state
-- ------------------------------------------------------------
create table public.tax_cases (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.cases(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  assessment_year text not null default '2026-27'
    check (assessment_year in ('2026-27')),
  financial_year text not null default '2025-26'
    check (financial_year in ('2025-26')),
  itr_type_selected text,
  itr_type_recommended text,
  case_status text not null default 'docs_pending'
    check (case_status in (
      'docs_pending','docs_uploaded','data_entry_pending','reconciliation_pending',
      'computation_ready','review_pending','client_review_sent','client_approved',
      'portal_filing_pending','filed_pending_everify','everified',
      'acknowledgement_received','closed')),
  assigned_staff_id uuid references public.users(id),
  reviewer_id uuid references public.users(id),
  client_approval_status text not null default 'not_sent'
    check (client_approval_status in ('not_sent','sent','approved','changes_requested')),
  filing_status text not null default 'not_started'
    check (filing_status in ('not_started','portal_filing_pending','filed','acknowledgement_received')),
  e_verification_status text not null default 'not_started'
    check (e_verification_status in ('not_started','pending','everified')),
  finalized_at timestamptz,
  finalized_by uuid references public.users(id),
  reopened_at timestamptz,
  reopened_by uuid references public.users(id),
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tax_cases_updated_at
  before update on public.tax_cases
  for each row execute function app.set_updated_at();

create index idx_tax_cases_case_id on public.tax_cases (case_id);
create index idx_tax_cases_client_id on public.tax_cases (client_id);
create index idx_tax_cases_assessment_year on public.tax_cases (assessment_year);
create index idx_tax_cases_case_status on public.tax_cases (case_status);
create index idx_tax_cases_assigned_staff_id on public.tax_cases (assigned_staff_id);
create index idx_tax_cases_reviewer_id on public.tax_cases (reviewer_id);

-- ------------------------------------------------------------
-- 2. tax_income_entries — income ledger rows (source-aware)
-- ------------------------------------------------------------
create table public.tax_income_entries (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  income_head text not null
    check (income_head in (
      'salary','savings_interest','fd_interest','dividend','other_sources',
      'exempt_income','house_property','business_income')),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  source_type text not null default 'manual'
    check (source_type in (
      'manual','AIS','26AS','Form16','prefilled_json','broker_report',
      'bank_certificate','adjustment')),
  source_document_id uuid references public.case_documents(id) on delete set null,
  source_file_id uuid references public.uploaded_files(id) on delete set null,
  notes text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tax_income_entries_updated_at
  before update on public.tax_income_entries
  for each row execute function app.set_updated_at();

create index idx_tax_income_entries_tax_case_id on public.tax_income_entries (tax_case_id);
create index idx_tax_income_entries_income_head on public.tax_income_entries (income_head);
create index idx_tax_income_entries_source_document_id on public.tax_income_entries (source_document_id);
create index idx_tax_income_entries_source_file_id on public.tax_income_entries (source_file_id);

-- ------------------------------------------------------------
-- 3. tax_tax_paid_entries — TDS/TCS/advance/self-assessment ledger
-- ------------------------------------------------------------
create table public.tax_tax_paid_entries (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  tax_paid_type text not null
    check (tax_paid_type in (
      'salary_tds','non_salary_tds','tcs','advance_tax','self_assessment_tax')),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  source_type text not null default 'manual'
    check (source_type in (
      'manual','AIS','26AS','Form16','prefilled_json','broker_report',
      'bank_certificate','adjustment')),
  source_document_id uuid references public.case_documents(id) on delete set null,
  source_file_id uuid references public.uploaded_files(id) on delete set null,
  notes text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tax_tax_paid_entries_updated_at
  before update on public.tax_tax_paid_entries
  for each row execute function app.set_updated_at();

create index idx_tax_tax_paid_entries_tax_case_id on public.tax_tax_paid_entries (tax_case_id);
create index idx_tax_tax_paid_entries_tax_paid_type on public.tax_tax_paid_entries (tax_paid_type);
create index idx_tax_tax_paid_entries_source_document_id on public.tax_tax_paid_entries (source_document_id);
create index idx_tax_tax_paid_entries_source_file_id on public.tax_tax_paid_entries (source_file_id);

-- ------------------------------------------------------------
-- 4. tax_deduction_entries — Chapter VI-A deduction ledger
-- ------------------------------------------------------------
create table public.tax_deduction_entries (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  deduction_type text not null
    check (deduction_type in (
      '80C','80D','80TTA','80TTB','80CCD','80G','other_deductions')),
  section_code text,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  source_type text not null default 'manual'
    check (source_type in (
      'manual','AIS','26AS','Form16','prefilled_json','broker_report',
      'bank_certificate','adjustment')),
  source_document_id uuid references public.case_documents(id) on delete set null,
  source_file_id uuid references public.uploaded_files(id) on delete set null,
  proof_case_document_id uuid references public.case_documents(id) on delete set null,
  notes text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tax_deduction_entries_updated_at
  before update on public.tax_deduction_entries
  for each row execute function app.set_updated_at();

create index idx_tax_deduction_entries_tax_case_id on public.tax_deduction_entries (tax_case_id);
create index idx_tax_deduction_entries_deduction_type on public.tax_deduction_entries (deduction_type);
create index idx_tax_deduction_entries_source_document_id on public.tax_deduction_entries (source_document_id);
create index idx_tax_deduction_entries_proof_case_document_id on public.tax_deduction_entries (proof_case_document_id);

-- ------------------------------------------------------------
-- 5. tax_capital_gain_entries — special-rate gains ledger.
--    taxable_gain may go negative later (losses), so it is NOT
--    constrained >= 0; component amounts are.
-- ------------------------------------------------------------
create table public.tax_capital_gain_entries (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  gain_type text not null
    check (gain_type in ('stcg_111a','ltcg_112a','other_stcg','other_ltcg')),
  sale_value numeric(14,2) not null default 0 check (sale_value >= 0),
  cost numeric(14,2) not null default 0 check (cost >= 0),
  expenses numeric(14,2) not null default 0 check (expenses >= 0),
  exemption_claimed numeric(14,2) not null default 0 check (exemption_claimed >= 0),
  taxable_gain numeric(14,2) not null default 0,
  source_type text not null default 'manual'
    check (source_type in (
      'manual','AIS','26AS','Form16','prefilled_json','broker_report',
      'bank_certificate','adjustment')),
  source_document_id uuid references public.case_documents(id) on delete set null,
  source_file_id uuid references public.uploaded_files(id) on delete set null,
  notes text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tax_capital_gain_entries_updated_at
  before update on public.tax_capital_gain_entries
  for each row execute function app.set_updated_at();

create index idx_tax_capital_gain_entries_tax_case_id on public.tax_capital_gain_entries (tax_case_id);
create index idx_tax_capital_gain_entries_gain_type on public.tax_capital_gain_entries (gain_type);
create index idx_tax_capital_gain_entries_source_document_id on public.tax_capital_gain_entries (source_document_id);
create index idx_tax_capital_gain_entries_source_file_id on public.tax_capital_gain_entries (source_file_id);

-- ------------------------------------------------------------
-- 6. tax_computation_snapshots — append-only engine input/output
--    snapshots for reproducibility (mirrors generated_pdfs pattern).
-- ------------------------------------------------------------
create table public.tax_computation_snapshots (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  rules_version text not null,
  input_snapshot jsonb not null,
  output_snapshot jsonb not null,
  is_final boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index idx_tax_computation_snapshots_tax_case_id on public.tax_computation_snapshots (tax_case_id);
create index idx_tax_computation_snapshots_is_final on public.tax_computation_snapshots (is_final);
create index idx_tax_computation_snapshots_created_at on public.tax_computation_snapshots (created_at);

-- ------------------------------------------------------------
-- 7. tax_validation_findings — reconciliation / validation results.
--    Mutable status (open/resolved/dismissed); no updated_at column.
-- ------------------------------------------------------------
create table public.tax_validation_findings (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  code text not null,
  severity text not null check (severity in ('info','warning','blocker')),
  area text not null,
  message text not null,
  source_value numeric(14,2),
  entered_value numeric(14,2),
  difference numeric(14,2),
  suggested_action text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id)
);

create index idx_tax_validation_findings_tax_case_id on public.tax_validation_findings (tax_case_id);
create index idx_tax_validation_findings_severity on public.tax_validation_findings (severity);
create index idx_tax_validation_findings_status on public.tax_validation_findings (status);
create index idx_tax_validation_findings_code on public.tax_validation_findings (code);

-- ------------------------------------------------------------
-- 8. tax_readiness_items — filing-readiness checklist per tax case
-- ------------------------------------------------------------
create table public.tax_readiness_items (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  code text not null,
  label text not null,
  status text not null default 'pending'
    check (status in ('pending','blocked','complete','waived')),
  blocked_by_finding_ids uuid[] not null default '{}',
  completed_at timestamptz,
  completed_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tax_case_id, code)
);

create trigger trg_tax_readiness_items_updated_at
  before update on public.tax_readiness_items
  for each row execute function app.set_updated_at();

create index idx_tax_readiness_items_tax_case_id on public.tax_readiness_items (tax_case_id);
create index idx_tax_readiness_items_status on public.tax_readiness_items (status);

-- ============================================================
-- RLS — deny by default, staff/admin read+write. No anon policies.
-- Mirrors the 000002 core-business-table pattern exactly.
-- tax_computation_snapshots is append-only (select+insert only).
-- ============================================================
alter table public.tax_cases enable row level security;
alter table public.tax_income_entries enable row level security;
alter table public.tax_tax_paid_entries enable row level security;
alter table public.tax_deduction_entries enable row level security;
alter table public.tax_capital_gain_entries enable row level security;
alter table public.tax_computation_snapshots enable row level security;
alter table public.tax_validation_findings enable row level security;
alter table public.tax_readiness_items enable row level security;

-- tax_cases
create policy tax_cases_select on public.tax_cases
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_cases_insert on public.tax_cases
  for insert to authenticated with check (app.is_staff_or_admin());
create policy tax_cases_update on public.tax_cases
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- tax_income_entries
create policy tax_income_entries_select on public.tax_income_entries
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_income_entries_insert on public.tax_income_entries
  for insert to authenticated with check (app.is_staff_or_admin());
create policy tax_income_entries_update on public.tax_income_entries
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- tax_tax_paid_entries
create policy tax_tax_paid_entries_select on public.tax_tax_paid_entries
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_tax_paid_entries_insert on public.tax_tax_paid_entries
  for insert to authenticated with check (app.is_staff_or_admin());
create policy tax_tax_paid_entries_update on public.tax_tax_paid_entries
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- tax_deduction_entries
create policy tax_deduction_entries_select on public.tax_deduction_entries
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_deduction_entries_insert on public.tax_deduction_entries
  for insert to authenticated with check (app.is_staff_or_admin());
create policy tax_deduction_entries_update on public.tax_deduction_entries
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- tax_capital_gain_entries
create policy tax_capital_gain_entries_select on public.tax_capital_gain_entries
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_capital_gain_entries_insert on public.tax_capital_gain_entries
  for insert to authenticated with check (app.is_staff_or_admin());
create policy tax_capital_gain_entries_update on public.tax_capital_gain_entries
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- tax_computation_snapshots — append-only (select + insert only)
create policy tax_computation_snapshots_select on public.tax_computation_snapshots
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_computation_snapshots_insert on public.tax_computation_snapshots
  for insert to authenticated with check (app.is_staff_or_admin());

-- tax_validation_findings
create policy tax_validation_findings_select on public.tax_validation_findings
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_validation_findings_insert on public.tax_validation_findings
  for insert to authenticated with check (app.is_staff_or_admin());
create policy tax_validation_findings_update on public.tax_validation_findings
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- tax_readiness_items
create policy tax_readiness_items_select on public.tax_readiness_items
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_readiness_items_insert on public.tax_readiness_items
  for insert to authenticated with check (app.is_staff_or_admin());
create policy tax_readiness_items_update on public.tax_readiness_items
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

-- ============================================================
-- Grants — service_role is covered by default privileges
-- (20260704120000). authenticated must opt in explicitly. anon: none.
-- ============================================================
grant select, insert, update on
  public.tax_cases,
  public.tax_income_entries,
  public.tax_tax_paid_entries,
  public.tax_deduction_entries,
  public.tax_capital_gain_entries,
  public.tax_validation_findings,
  public.tax_readiness_items
to authenticated;

-- Append-only: select + insert, no update/delete (matches policy set).
grant select, insert on public.tax_computation_snapshots to authenticated;

-- Hard DELETE is never used by the app (matches 000002).
revoke delete on
  public.tax_cases,
  public.tax_income_entries,
  public.tax_tax_paid_entries,
  public.tax_deduction_entries,
  public.tax_capital_gain_entries,
  public.tax_computation_snapshots,
  public.tax_validation_findings,
  public.tax_readiness_items
from authenticated;

-- Defensive: anon gets nothing on the new tables (belt & suspenders).
revoke all on
  public.tax_cases,
  public.tax_income_entries,
  public.tax_tax_paid_entries,
  public.tax_deduction_entries,
  public.tax_capital_gain_entries,
  public.tax_computation_snapshots,
  public.tax_validation_findings,
  public.tax_readiness_items
from anon;
