-- ============================================================
-- TaxDesk OS — 20260810120000 Books-based business/profession ledger
-- (K4-14, Wave-4 priority #6 slice 1,
-- `k4-common-case-coverage-and-priorities.md` §3 row 6 / §3.1)
--
-- Additive-only. NEW table `tax_business_books_entries` — one row PER
-- BUSINESS, carrying several jointly-meaningful facts (revenue, expenses,
-- business-vs-profession, and the Sections 30-43D declaration), so it takes
-- the multi-column-per-row shape of `tax_house_property_entries` /
-- `tax_capital_gain_entries` rather than the single-`amount` shape of
-- `tax_income_entries`. The existing `business_income` value in
-- `tax_income_entries.income_head` stays in that vocabulary, untouched, as
-- an uncomputed placeholder for historical rows — this migration does not
-- migrate, reinterpret or remove a single existing row.
--
-- Session scope: ONE business per case. As with house property, that limit
-- is NOT enforced by a DB constraint: the ADAPTER (`computation-adapter.ts`,
-- `MULTIPLE_BUSINESS_BOOKS_NOT_MODELLED`) is the single authority on how
-- many live rows it can safely compute, and a second copy of that rule in a
-- check constraint could drift from it.
--
-- `adjustments` is the load-bearing column. Section 29 computes this head
-- "in accordance with the provisions contained in sections 30 to 43D" and
-- the engine implements NONE of Sections 30-43D, so a books figure is only
-- computable where the preparer has declared that no such adjustment arises.
-- It is therefore NOT NULL WITHOUT A DEFAULT — deliberately unlike
-- `presumptive_activity_type` (K4-13), which is nullable because it is
-- meaningful on only three of eleven income heads. Here every row of the
-- table needs the answer, so the column that would let a row exist without
-- one is the column that would let the computation fail open. A default of
-- any kind would BE the assumption the vocabulary exists to prevent.
-- ============================================================

create table public.tax_business_books_entries (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  -- Declared gross revenue / turnover / gross receipts for the year. Also the
  -- figure tested against the Section 44AB threshold by the ADAPTER (₹1cr
  -- business / ₹50L profession) — never at the DB layer, and never against
  -- the proviso's ₹10cr figure, whose cash-PAYMENTS limb no ledger here can
  -- verify.
  revenue numeric(14,2) not null default 0 check (revenue >= 0),
  -- Declared total expenses charged in the books for the year. A row where
  -- this exceeds `revenue` is a business LOSS: allowed to EXIST here (the
  -- fact is real and must be recordable), and refused by the adapter, which
  -- excludes it rather than treating it as ₹0 income.
  expenses numeric(14,2) not null default 0 check (expenses >= 0),
  -- Selects which Section 44AB threshold the adapter applies. Defaulted to
  -- false (business) because that is the LOWER-risk reading: it applies the
  -- ₹1,00,00,000 threshold, and a profession wrongly left at the default is
  -- tested against a threshold it is far more likely to clear — the opposite
  -- default would silently relax the ₹50,00,000 test.
  is_profession boolean not null default false,
  -- What the accounts require under Sections 30-43D. NOT NULL, NO DEFAULT —
  -- see the header. Exactly one member ('none_s30_43d') is computable; every
  -- other member, and a NULL that this constraint makes impossible, refuses.
  adjustments text not null
    check (adjustments in (
      'none_s30_43d', 'depreciation_s32', 'disallowance_s37_s40_s43b',
      'presumptive_transition')),
  source_type text not null default 'manual'
    check (source_type in (
      'manual','AIS','26AS','Form16','prefilled_json','broker_report',
      'bank_certificate','adjustment')),
  source_document_id uuid references public.case_documents(id) on delete set null,
  source_file_id uuid references public.uploaded_files(id) on delete set null,
  -- Separate evidence slot for the accounts themselves (P&L / balance sheet),
  -- distinct from the general source document — mirrors
  -- tax_house_property_entries.proof_case_document_id.
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

comment on column public.tax_business_books_entries.adjustments is
  'K4-14: what the books require under Sections 30-43D. Only ''none_s30_43d'' is computable; every other value refuses. NOT NULL with no default by design — absence is not a member.';

create trigger trg_tax_business_books_entries_updated_at
  before update on public.tax_business_books_entries
  for each row execute function app.set_updated_at();

-- D85 / AUDIT-03-F1: both ledger triggers, in the SAME migration that creates
-- the table. `K4-06` shipped `tax_house_property_entries` without these and it
-- became the most serious gap any audit here has found; names and timing below
-- are byte-equivalent to what `20260712140000_authz_boundary_enforcement.sql`
-- §2b/§2c emits for a sibling ledger, so this table is indistinguishable from
-- its siblings in `pg_trigger`.
drop trigger if exists trg_tax_business_books_entries_finalized_lock
  on public.tax_business_books_entries;
create trigger trg_tax_business_books_entries_finalized_lock
  before insert or update on public.tax_business_books_entries
  for each row execute function app.enforce_ledger_finalized_lock();

drop trigger if exists trg_tax_business_books_entries_actor
  on public.tax_business_books_entries;
create trigger trg_tax_business_books_entries_actor
  before insert or update on public.tax_business_books_entries
  for each row execute function app.set_ledger_actor();

create index idx_tax_business_books_entries_tax_case_id
  on public.tax_business_books_entries (tax_case_id);
create index idx_tax_business_books_entries_adjustments
  on public.tax_business_books_entries (adjustments);
create index idx_tax_business_books_entries_source_document_id
  on public.tax_business_books_entries (source_document_id);
create index idx_tax_business_books_entries_proof_case_document_id
  on public.tax_business_books_entries (proof_case_document_id);
create index idx_tax_business_books_entries_live
  on public.tax_business_books_entries (tax_case_id) where deleted_at is null;

alter table public.tax_business_books_entries enable row level security;

create policy tax_business_books_entries_select on public.tax_business_books_entries
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_business_books_entries_insert on public.tax_business_books_entries
  for insert to authenticated with check (app.is_staff_or_admin());
create policy tax_business_books_entries_update on public.tax_business_books_entries
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

grant select, insert, update on public.tax_business_books_entries to authenticated;
revoke delete on public.tax_business_books_entries from authenticated;
revoke all on public.tax_business_books_entries from anon;
