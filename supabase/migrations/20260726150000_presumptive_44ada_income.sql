-- ============================================================
-- TaxDesk OS — 20260726150000 Section 44ADA presumptive professional
-- income (K4-07, Wave-4 priority #3, `k4-common-case-coverage-and-
-- priorities.md`)
--
-- Additive-only. Adds ONE new `income_head` check-constraint value,
-- 'presumptive_professional_44ada', so staff can tag a ledger row as
-- gross professional receipts eligible for Section 44ADA presumptive
-- taxation — and ONE new nullable `receipts_via_banking_channels`
-- boolean column, meaningful ONLY when
-- `income_head = 'presumptive_professional_44ada'` (ignored/NULL for
-- every other row), recording whether receipts were predominantly
-- through banking channels (cash receipts <= 5% of the total), which
-- determines the applicable gross-receipts ceiling (Rs.75,00,000 vs
-- Rs.50,00,000). Mirrors the shape/pattern of migration
-- 20260726120000 (K4-05's `insured_party_senior` column on
-- `tax_deduction_entries`) — a couple of jointly-meaningful facts (an
-- amount + one boolean modifier) fit the EXISTING single-amount
-- `tax_income_entries` shape; this is deliberately NOT a new dedicated
-- table (unlike K4-06's `tax_house_property_entries`, which needed
-- several distinct per-row facts — usage, rent, municipal tax,
-- interest — that don't fit a single-amount row). See decision D81
-- (the k3-tax-intelligence-program design notes) for the full shape
-- rationale.
--
-- Both changes default to leaving every EXISTING row exactly as it
-- already reads: no existing `income_head` value is touched, and the
-- new column defaults to NULL for every existing row (NULL/false is
-- treated conservatively by the adapter — the lower Rs.50,00,000
-- ceiling applies — never inferred as predominantly-digital).
--
-- No RLS/grant/trigger change — `tax_income_entries`'s existing RLS
-- policies and the `app.set_updated_at()` trigger already cover every
-- column on the table generically.
-- ============================================================

alter table public.tax_income_entries
  drop constraint if exists tax_income_entries_income_head_check;
alter table public.tax_income_entries
  add constraint tax_income_entries_income_head_check
  check (income_head in (
    'salary','savings_interest','fd_interest','dividend','other_sources',
    'exempt_income','house_property','business_income',
    'presumptive_professional_44ada'));

alter table public.tax_income_entries
  add column if not exists receipts_via_banking_channels boolean;

comment on column public.tax_income_entries.receipts_via_banking_channels is
  'K4-07: meaningful ONLY when income_head = ''presumptive_professional_44ada'' — whether gross receipts were predominantly (>=95%) via banking channels (cash <=5%), which raises the Section 44ADA eligibility ceiling from Rs.50,00,000 to Rs.75,00,000. NULL/false = conservative Rs.50,00,000 ceiling, never inferred true.';
