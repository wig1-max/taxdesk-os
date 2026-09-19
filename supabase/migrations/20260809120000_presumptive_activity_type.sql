-- ============================================================
-- TaxDesk OS — 20260809120000 Presumptive ELIGIBLE-ACTIVITY type
-- (K4-13, decision D217)
--
-- Adds ONE new nullable `presumptive_activity_type` column to
-- `tax_income_entries`, meaningful ONLY on the three presumptive
-- income heads ('presumptive_professional_44ada',
-- 'presumptive_business_44ad_digital',
-- 'presumptive_business_44ad_cash') and ignored/NULL on every other
-- row. It records WHICH activity the turnover or gross receipts come
-- from, so the engine can finally apply the eligible-activity test that
-- K4-07 and K4-08 both recorded, openly, as not covered.
--
-- SHAPE RATIONALE (decision D218). PER ROW, not per case, and not on
-- the taxpayer profile. A case may hold both a Section 44AD business
-- and a Section 44ADA profession at the same time — the product
-- already computes both heads on one case — and the two schemes need
-- OPPOSITE answers for the same declared activity (Section 44AD(6)(i)
-- excludes a Section 44AA(1) profession; Section 44ADA(1) requires
-- one). A single case-level field cannot express that at all, and a
-- taxpayer with, say, a retail shop plus agency commission would have
-- to be either blocked entirely or answered wrongly. Per-row mirrors
-- the shape K4-05 (`insured_party_senior`) and K4-07
-- (`receipts_via_banking_channels`) already established on these
-- ledger tables: an amount plus a per-row modifier that qualifies it.
--
-- Per-row records the activity's TYPE, not a business's IDENTITY, so
-- it does NOT by itself fix K4-08's conservative aggregation of
-- turnover across businesses for the ceiling test — two rows both
-- typed 'other_business' may be one shop or two. That remains a
-- documented simplification; this migration is a prerequisite for
-- fixing it later, not the fix.
--
-- ADDITIVE IN SCHEMA, RESTRICTIVE IN BEHAVIOUR — read this before
-- deploying. The column is nullable and every existing row keeps
-- reading exactly as it does today, so no existing row is rewritten.
-- But NULL means "activity not declared", and the adapter now treats
-- an undeclared activity as a REFUSAL rather than a presumption of
-- eligibility: such a row is excluded from the computation and the
-- case cannot be snapshotted, approved or finalized. That is the whole
-- point of the change (D217 — the gap FAILED OPEN, returning a legally
-- wrong deemed profit for an ineligible activity). Any presumptive row
-- that already exists therefore stops computing until its activity is
-- declared. At the time of writing no seeded or E2E fixture row uses a
-- presumptive head at all, so the practical blast radius is zero.
--
-- There is deliberately NO default value and NO 'unknown' member in
-- the vocabulary: a default is precisely the presumption of
-- eligibility this column exists to remove.
--
-- No new table, no RLS policy and no trigger — `tax_income_entries`
-- already carries its RLS policies plus the `app.set_updated_at()`,
-- `app.enforce_ledger_finalized_lock()` and `app.set_ledger_actor()`
-- triggers, all of which apply generically over every column. No new
-- `LEDGER_TABLES` entry is required for the same reason. No guarded
-- RPC is added: this is Shape A scoped support (D88) — a case outside
-- the supported scope is held back by the adapter setting
-- `complete === false`, which is the same mechanism the existing
-- ceiling exclusions already use, NOT by a surcharge-style stored
-- boolean read by SQL consumers.
-- ============================================================

alter table public.tax_income_entries
  add column if not exists presumptive_activity_type text;

alter table public.tax_income_entries
  drop constraint if exists tax_income_entries_presumptive_activity_type_check;
alter table public.tax_income_entries
  add constraint tax_income_entries_presumptive_activity_type_check
  check (presumptive_activity_type is null or presumptive_activity_type in (
    'specified_profession_44aa_1','commission_or_brokerage','agency_business',
    'goods_carriage_44ae','other_business'));

comment on column public.tax_income_entries.presumptive_activity_type is
  'K4-13 (D217/D218): meaningful ONLY on the three presumptive income heads — which activity the turnover / gross receipts arise from, so the eligible-activity test can be applied. Section 44AD(6) excludes (i) a Section 44AA(1) profession, (ii) commission or brokerage, (iii) agency business; the Explanation to Section 44AD separately excludes goods carriage referred to in Section 44AE from the definition of "eligible business". Section 44ADA(1) is the mirror image of 44AD(6)(i) — it REQUIRES a Section 44AA(1) profession. NULL means not declared, which BLOCKS the presumptive computation (fail closed) and is never read as eligible. No default, and no "unknown" member, deliberately.';
