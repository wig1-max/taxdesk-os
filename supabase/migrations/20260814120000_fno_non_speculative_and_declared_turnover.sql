-- ============================================================
-- TaxDesk OS — K4-18 source-first F&O / intraday slice
--
-- Two additive changes, both required by the official-source work recorded in
-- the k4-18-fno-source-research design notes.
--
-- 1. TWO NEW ACTIVITY CLASSIFICATIONS.
--
--    Section 43(5) proviso (d) provides that "an eligible transaction in
--    respect of trading in derivatives referred to in clause (ac) of section 2
--    of the Securities Contracts (Regulation) Act, 1956 ... carried out in a
--    recognised stock exchange" shall NOT be deemed a speculative transaction.
--    Explanation 1 makes "eligible transaction" conjunctive and per-transaction
--    (screen-based through a SEBI-registered intermediary, AND a time-stamped
--    contract note bearing the unique client identity number and PAN).
--
--    `fno_non_speculative_s43_5_d` is the preparer's affirmation that EVERY
--    transaction in the undertaking meets Explanation 1. Such an undertaking is
--    an ordinary business under the head and joins the bounded Section 70(1)
--    pool K4-17 built.
--
--    `intraday_speculative_s43_5` names intraday equity explicitly. A
--    cash-segment contract squared off without delivery is settled "otherwise
--    than by the actual delivery or transfer of the commodity or scrips" and so
--    falls in the Section 43(5) MAIN limb. It REFUSES: Explanation 2 to Section
--    28 deems a speculation business distinct and separate, and Section 73(1)
--    quarantines its loss. No speculation pool is implemented.
--
--    The pre-existing `futures_and_options` member is RETAINED and still
--    refuses. It is the honest "this is F&O and I am not affirming proviso (d)
--    for every transaction" answer, and proviso (d) is conditional — unaffirmed
--    derivative activity falls back to the main limb.
--
-- 2. A DECLARED SECTION 44AB TURNOVER COLUMN.
--
--    Section 44AB(a) tests "total sales, turnover or gross receipts". For a
--    derivatives undertaking, books revenue is NOT that figure, and no official
--    source defines what is: not the 1961 Act (s.44AB's own Explanation defines
--    only "accountant" and "specified date"), not the Income-tax Act 2025, not
--    the CBDT-notified Income-tax Rules 2026, no CBDT circular, notification or
--    instruction, and neither the ITR-3 instructions nor Form 3CD. The method in
--    professional use is the ICAI Guidance Note's, which is professional
--    judgement and not law.
--
--    The product therefore does not derive this figure. The preparer declares
--    it and the engine applies the statutory threshold to what was declared. The
--    column is NULLABLE because it is meaningless for an ordinary undertaking
--    (whose books revenue IS its turnover) and because existing rows must stay
--    recordable without being reinterpreted. NULL on a row that needs it fails
--    CLOSED in the adapter — books revenue is never substituted.
--
--    A non-negative CHECK is enforced here as well as in the adapter: turnover
--    is a gross measure under every recognised method, and a negative figure
--    would understate the aggregate, which is the dangerous direction (it turns
--    an audit case into a no-audit-required one).
--
-- Additive and forward-only, per the repository convention (D3). No existing
-- row is rewritten and no stored value is reinterpreted.
-- ============================================================

alter table public.tax_business_books_entries
  drop constraint if exists tax_business_books_entries_activity_classification_check;

alter table public.tax_business_books_entries
  add constraint tax_business_books_entries_activity_classification_check
  check (activity_classification in (
    'ordinary_business_or_profession',
    'fno_non_speculative_s43_5_d',
    'futures_and_options',
    'intraday_speculative_s43_5',
    'speculation_business_s73',
    'specified_business_s35ad'
  ));

comment on column public.tax_business_books_entries.activity_classification is
  'K4-18: affirmative activity/loss-pool classification. Computable: ordinary_business_or_profession and fno_non_speculative_s43_5_d (Section 43(5) proviso (d), every transaction affirmed an eligible transaction under Explanation 1). NULL, futures_and_options, intraday_speculative_s43_5, speculation-business and specified-business values refuse automatic computation.';

alter table public.tax_business_books_entries
  add column declared_turnover numeric(14, 2)
  check (declared_turnover is null or declared_turnover >= 0);

comment on column public.tax_business_books_entries.declared_turnover is
  'K4-18: preparer-declared Section 44AB "total sales, turnover or gross receipts" for a classification whose books revenue is not that figure (currently fno_non_speculative_s43_5_d). No statutory, CBDT or return-form source defines derivative turnover, so the product never derives it; the engine applies the statutory threshold to this declared figure. NULL on a row that requires it refuses the whole books head.';
