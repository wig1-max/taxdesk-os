-- ============================================================
-- TaxDesk OS — 20260818140000 House-sale capital gains (K4-21)
--
-- Additive-only on `tax_capital_gain_entries`. Widens gain_type to
-- `house_sale` and adds the facts s.45 / s.48 / s.50C / s.2(42A) need.
-- other_stcg / other_ltcg stay placeholders. HOUSE_PROPERTY is unchanged
-- (that is s.22/23 GAV, not a sale).
--
-- Local-only until the owner newly authorises a production apply.
-- Production stays 47/47.
-- ============================================================

alter table public.tax_capital_gain_entries
  drop constraint if exists tax_capital_gain_entries_gain_type_check;

alter table public.tax_capital_gain_entries
  add constraint tax_capital_gain_entries_gain_type_check
  check (gain_type in ('stcg_111a','ltcg_112a','house_sale','other_stcg','other_ltcg'));

alter table public.tax_capital_gain_entries
  add column if not exists transfer_date date;

alter table public.tax_capital_gain_entries
  add column if not exists acquisition_date date;

alter table public.tax_capital_gain_entries
  add column if not exists stamp_duty_value numeric(14,2)
    check (stamp_duty_value is null or stamp_duty_value >= 0);

alter table public.tax_capital_gain_entries
  add column if not exists asset_kind text
    check (asset_kind is null or asset_kind in ('land','building','both'));

alter table public.tax_capital_gain_entries
  add column if not exists acquisition_mode text
    check (acquisition_mode is null or acquisition_mode in ('purchase'));

alter table public.tax_capital_gain_entries
  add column if not exists cost_of_improvement numeric(14,2) not null default 0
    check (cost_of_improvement >= 0);

alter table public.tax_capital_gain_entries
  add column if not exists house_sale_declarations text[] not null default '{}'::text[]
    check (
      house_sale_declarations <@ array[
        'not_agricultural_land',
        'not_depreciable_asset',
        'interest_not_in_cost',
        'agreement_and_registration_same_date'
      ]::text[]
    );

comment on column public.tax_capital_gain_entries.transfer_date is
  'K4-21: s.45(1) previous-year of transfer. Required by the adapter when gain_type is house_sale.';

comment on column public.tax_capital_gain_entries.house_sale_declarations is
  'K4-21: closed not-this-fact set. All four members required before a house_sale row computes.';

alter table public.tax_cases
  alter column tax_pack_key set default
    'IN:ITA_1961:assessment_year:2026-27:AY_2026_27_V4_PREP_ONLY';
