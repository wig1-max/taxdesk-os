-- ============================================================
-- TaxDesk OS — 20260731120000 Section 44AD presumptive BUSINESS
-- income (K4-08, Wave-4 priority #4, `k4-common-case-coverage-and-
-- priorities.md` item #4)
--
-- Additive-only. Adds TWO new `income_head` check-constraint values,
-- 'presumptive_business_44ad_digital' and
-- 'presumptive_business_44ad_cash', so staff can tag ledger rows as
-- Section 44AD turnover split by receipt mode.
--
-- SHAPE RATIONALE (decision D90). Section 44AD applies TWO deemed-
-- profit rates to TWO PORTIONS of turnover — 6% on the portion
-- received through banking / prescribed electronic modes and 8% on the
-- remainder — unlike Section 44ADA, which applies ONE rate (50%) to the
-- whole. So 44AD needs two AMOUNTS, not K4-07's one amount plus a
-- boolean modifier (`receipts_via_banking_channels`), and not K4-06's
-- dedicated table (which existed because house property carries several
-- distinct facts — usage, rent, municipal tax, interest — that cannot
-- fit a single-amount row).
--
-- Two heads on the EXISTING single-amount `tax_income_entries` table is
-- the honest fit: each row is genuinely one amount carrying one rate.
-- It also makes the eligibility test strictly better than 44ADA's. The
-- enhanced Rs.3,00,00,000 ceiling applies when cash receipts do not
-- exceed 5% of total receipts; with the split declared as amounts that
-- share is DERIVED (cash / (cash + digital)) rather than asserted by a
-- staff checkbox, so no one can tick a box the numbers contradict.
--
-- Consequently this migration adds NO column, NO table, NO RLS policy
-- and NO trigger: `tax_income_entries` already carries its RLS
-- policies, the `app.set_updated_at()` trigger, and — unlike K4-06's
-- new table (AUDIT-03-F1) — the `app.enforce_ledger_finalized_lock()`
-- and `app.set_ledger_actor()` triggers, generically over every column.
-- No new entry in `LEDGER_TABLES` is required for the same reason.
--
-- Every EXISTING row is left exactly as it reads: no existing
-- `income_head` value is touched, added, removed or renamed.
-- ============================================================

alter table public.tax_income_entries
  drop constraint if exists tax_income_entries_income_head_check;
alter table public.tax_income_entries
  add constraint tax_income_entries_income_head_check
  check (income_head in (
    'salary','savings_interest','fd_interest','dividend','other_sources',
    'exempt_income','house_property','business_income',
    'presumptive_professional_44ada',
    'presumptive_business_44ad_digital','presumptive_business_44ad_cash'));

comment on constraint tax_income_entries_income_head_check on public.tax_income_entries is
  'K4-08: the closed income-head vocabulary. The two presumptive_business_44ad_* values are Section 44AD turnover split by receipt mode — digital (banking / prescribed electronic modes, 6% deemed profit) and cash (8%) — kept as separate heads because 44AD applies two rates to two portions of turnover, which also lets the 5%-cash eligibility test be derived from declared amounts rather than staff-asserted. See decision D90.';
