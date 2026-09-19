-- ============================================================
-- TaxDesk OS — K4-17 books-business activity classification
--
-- Section 70(1) is subject to contrary provisions. Sections 73 and 73A keep
-- speculation-business and specified-business losses in restricted pools, so
-- a negative generic books row cannot enter the ordinary Section 70 pool on
-- silence. This additive nullable column lets existing rows remain recordable
-- without interpreting them; NULL fails closed in the adapter. New/updated
-- rows require an explicit value through the application schema.
-- ============================================================

alter table public.tax_business_books_entries
  add column activity_classification text
  check (activity_classification in (
    'ordinary_business_or_profession',
    'speculation_business_s73',
    'specified_business_s35ad'
  ));

comment on column public.tax_business_books_entries.activity_classification is
  'K4-17: affirmative Section 70 loss-pool classification. NULL, speculation-business and specified-business values refuse automatic computation; only ordinary_business_or_profession is computable.';

create index idx_tax_business_books_entries_activity_classification
  on public.tax_business_books_entries (activity_classification);
