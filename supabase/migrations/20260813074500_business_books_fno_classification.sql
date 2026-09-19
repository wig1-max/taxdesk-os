-- ============================================================
-- TaxDesk OS — K4-17 explicit F&O classification
--
-- Section 43(5) can exclude eligible exchange-traded derivatives from the
-- statutory definition of a speculative transaction. That does not make F&O
-- part of K4-17's bounded ordinary-books slice: the product still marks the
-- whole F&O category unsupported. Extend the closed vocabulary so a preparer
-- can declare that fact and the adapter can refuse it explicitly.
-- ============================================================

alter table public.tax_business_books_entries
  drop constraint if exists tax_business_books_entries_activity_classification_check;

alter table public.tax_business_books_entries
  add constraint tax_business_books_entries_activity_classification_check
  check (activity_classification in (
    'ordinary_business_or_profession',
    'futures_and_options',
    'speculation_business_s73',
    'specified_business_s35ad'
  ));

comment on column public.tax_business_books_entries.activity_classification is
  'K4-17: affirmative activity/loss-pool classification. NULL, futures_and_options, speculation-business and specified-business values refuse automatic computation; only ordinary_business_or_profession is computable.';
