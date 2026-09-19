-- ============================================================
-- TaxDesk OS — 20260821120000 House-sale LTCG declarations (K4-23 / D337)
--
-- Additive-only on `tax_capital_gain_entries`. Widens the
-- `house_sale_declarations` vocabulary by the TWO attestations `D337`
-- items 7 and 11 require on the LONG-TERM path only:
--
--   amounts_are_assessee_share  — consideration, stamp duty value, expenses
--                                 and costs already represent the assessee's
--                                 proportionate share. `D337` chose this over
--                                 requiring sole ownership.
--   stamp_duty_value_accepted   — the stamp duty value is accepted and there
--                                 is no s.50C(2) fair-market-value claim,
--                                 dispute, appeal, reference or pending
--                                 valuation.
--
-- A SHORT-TERM row is unaffected: the engine requires these two only when
-- the holding is long-term, so every K4-21 row that computes today still
-- computes with exactly its four existing declarations.
--
-- Also moves the `tax_pack_key` default to the `D276` bump this slice owes
-- (V4 -> V5), the same step migration 20260818140000 took for V3 -> V4.
--
-- LOCAL-ONLY. Production stays at its current applied count until the owner
-- newly authorises an apply (`D34`). No production, remote or deployment
-- action is taken by this file.
-- ============================================================

alter table public.tax_capital_gain_entries
  drop constraint if exists tax_capital_gain_entries_house_sale_declarations_check;

alter table public.tax_capital_gain_entries
  add constraint tax_capital_gain_entries_house_sale_declarations_check
  check (
    house_sale_declarations <@ array[
      'not_agricultural_land',
      'not_depreciable_asset',
      'interest_not_in_cost',
      'agreement_and_registration_same_date',
      'amounts_are_assessee_share',
      'stamp_duty_value_accepted'
    ]::text[]
  );

comment on column public.tax_capital_gain_entries.house_sale_declarations is
  'K4-21 + K4-23: closed not-this-fact set. The four K4-21 members are required for ANY house_sale row. The two K4-23 members (amounts_are_assessee_share, stamp_duty_value_accepted) are required additionally when the holding is LONG-TERM; a short-term row does not need them.';

alter table public.tax_cases
  alter column tax_pack_key set default
    'IN:ITA_1961:assessment_year:2026-27:AY_2026_27_V5_PREP_ONLY';
