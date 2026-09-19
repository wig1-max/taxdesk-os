-- ============================================================
-- TaxDesk OS — 20260818130000 Section 32 depreciation (K4-20)
--
-- Additive-only on the existing `tax_business_books_entries` table.
-- `D237` requires a per-adjustment model the moment any s.30-43D
-- adjustment computes. The single-select `adjustments` column becomes a
-- text[] set; `none_s30_43d` stays exclusive of every other member.
-- Existing rows wrap as a one-element array, so every currently-computable
-- `none_s30_43d` row stays byte-identical.
--
-- Depreciation facts sit on the SAME row (no child table, no new RLS):
-- book-depreciation add-back, the s.32(1)(iia) question, and a jsonb
-- array of Appendix I standing-class blocks. The adapter is the single
-- authority on when those facts are required; the DB only refuses
-- structurally impossible values.
--
-- Local-only until the owner newly authorises a production apply.
-- Production stays 47/47.
-- ============================================================

alter table public.tax_business_books_entries
  drop constraint if exists tax_business_books_entries_adjustments_check;

alter table public.tax_business_books_entries
  alter column adjustments type text[]
  using case
    when adjustments is null then array[]::text[]
    else array[adjustments]
  end;

alter table public.tax_business_books_entries
  add constraint tax_business_books_entries_adjustments_check
  check (
    adjustments <> '{}'::text[]
    and adjustments <@ array[
      'none_s30_43d',
      'depreciation_s32',
      'disallowance_s37_s40_s43b',
      'presumptive_transition'
    ]::text[]
    and (
      not ('none_s30_43d' = any (adjustments))
      or cardinality(adjustments) = 1
    )
  );

comment on column public.tax_business_books_entries.adjustments is
  'K4-20: SET of Sections 30-43D declarations. none_s30_43d is exclusive. depreciation_s32 computes only with standing-class blocks, a book-depreciation add-back and an explicit no-s.32(1)(iia) answer. NOT NULL, no default.';

alter table public.tax_business_books_entries
  add column if not exists book_depreciation numeric(14,2)
    check (book_depreciation is null or book_depreciation >= 0);

comment on column public.tax_business_books_entries.book_depreciation is
  'K4-20: book depreciation charged in the P&L. Required by the adapter when adjustments contains depreciation_s32. Added back before the Section 32(1)(ii) allowance is deducted.';

alter table public.tax_business_books_entries
  add column if not exists claims_additional_depreciation boolean;

comment on column public.tax_business_books_entries.claims_additional_depreciation is
  'K4-20: whether Section 32(1)(iia) additional depreciation arises. Required by the adapter when adjustments contains depreciation_s32. true refuses — that limb is not implemented.';

alter table public.tax_business_books_entries
  add column if not exists depreciation_blocks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(depreciation_blocks) = 'array');

comment on column public.tax_business_books_entries.depreciation_blocks is
  'K4-20: Appendix I standing-class blocks {asset_class, wdv, put_to_use}. Required (non-empty) by the adapter when adjustments contains depreciation_s32. An unreadable class refuses.';

alter table public.tax_cases
  alter column tax_pack_key set default
    'IN:ITA_1961:assessment_year:2026-27:AY_2026_27_V3_PREP_ONLY';
