-- K4-19 — Section 89(1) arrears relief becomes a DECLARABLE situation.
--
-- WHY THIS MIGRATION EXISTS.
-- Section 89(1) relief on salary or pension received in arrears or in advance
-- (Rule 21A, claimed on Form 10E) is not computed by this engine at all, and
-- cannot be: Rule 21A(2) needs each earlier previous year's rate schedule --
-- fixed by that year's own Finance Act -- plus that year's total income, and
-- this product holds one year of rate parameters and no multi-year state.
--
-- Unlike every other unsupported area, the fact is NOT DERIVABLE FROM THE DATA.
-- Rs. 8,00,000 of salary looks identical whether or not Rs. 3,00,000 of it is
-- arrears, so no income-derived detector of the `TAX-SAFE-01` kind is possible.
-- The only mechanism that can hold such a case back is a DECLARATION, and the
-- product already has exactly the right one: `tax_cases.declared_special_
-- situations`, which the K.2.8.9A eligibility gate already routes to manual
-- professional preparation. This migration adds one member to that vocabulary.
--
-- WHAT THIS DOES NOT DO, stated because the omission is the point.
-- It does NOT detect arrears, and it cannot. A preparer who never declares the
-- situation is not blocked by anything here -- that case is covered only by the
-- universal Computation disclosure `K4-19` also ships, which is a notice and
-- not a control. The residual is real; it is not closed by this migration and
-- must not be described as if it were.
--
-- SAFETY SHAPE. This is a WIDENING of a CHECK constraint -- every value that
-- satisfied the old constraint satisfies the new one, so no existing row can
-- become invalid and no data is read, written, moved or deleted. It is additive
-- and forward-only. There is no backfill because there is nothing to backfill:
-- absence of the declaration is the correct existing state for every row, and
-- inferring the declaration for anyone would be inventing a client fact.
--
-- Local-only (`D34`): applied with `migration up --local` after `db:guard`
-- reported no linked project. Applying it anywhere else needs a new, exact
-- production authorization.

alter table public.tax_cases
  drop constraint if exists chk_tax_cases_declared_situations;

alter table public.tax_cases
  add constraint chk_tax_cases_declared_situations
  check (declared_special_situations <@ array[
    'business_or_professional_income','foreign_income_or_assets','virtual_digital_assets',
    'futures_and_options','clubbing_of_income','brought_forward_losses',
    'agricultural_special_rate','nonresident_special_rate','surcharge_or_marginal_relief',
    -- K4-19: salary or pension received in arrears / in advance, where Section
    -- 89(1) relief under Rule 21A may be due and Form 10E may be required.
    -- Declaring it routes the case to manual professional preparation through
    -- the existing gate -- no new RPC, no new column, no new code path.
    'salary_arrears_section_89',
    'other_unsupported'
  ]::text[]);

comment on constraint chk_tax_cases_declared_situations on public.tax_cases is
  'K4-19: the closed vocabulary of declared special situations. Kept in lockstep '
  'with SPECIAL_SITUATIONS in src/lib/tax-desk/eligibility.ts, which tests/db '
  'pins in both directions -- a member added to either side alone is a failure, '
  'never a silently unaccepted declaration.';
