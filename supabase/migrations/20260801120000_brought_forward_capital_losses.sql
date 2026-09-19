-- ============================================================
-- TaxDesk OS — 20260801120000 Brought-forward capital-loss ledger
-- (K4-10, the multi-year half of Wave-4 priority #5; `K4-09` shipped the
-- within-year half)
--
-- Additive-only. NEW table `tax_brought_forward_loss_entries` — one row per
-- (originating assessment year x STCL/LTCL) carry-forward record.
--
-- WHY THOSE TWO COLUMNS ARE THE ROW'S IDENTITY, not decoration: a bare
-- amount is not a carry-forward record. Section 74(2) allows a capital loss
-- to be carried forward for the EIGHT assessment years immediately
-- succeeding the assessment year in which it was first computed, so the
-- expiry test needs `originating_assessment_year`; and Section 74(1)(a)/(b)
-- give a short-term and a long-term loss DIFFERENT lawful destinations, so
-- the allocation test needs `loss_type`. Neither can be recovered from an
-- amount alone.
--
-- `filing_eligibility` records the Section 139(3)/80 condition — a loss is
-- carryable at all only if the loss return was filed by the due date.
-- `K4-09` explicitly left that unmodelled. It DEFAULTS TO 'unverified' and
-- the adapter FAILS CLOSED on 'unverified' (the case is refused, not
-- computed with an assumed-eligible loss). There is deliberately no
-- 'eligible' default: an unchecked box must never read as a verified fact.
--
-- `loss_provenance` distinguishes a prior FINALIZED case in this system from
-- a staff-declared figure. They do not carry the same assurance and the
-- difference is surfaced to the preparer rather than flattened.
--
-- `elected_set_off_target` is the taxpayer-election path required by the
-- `K4-10` release boundary (D112) and directly supported by the official
-- utility's own behaviour: `CG_Calc.doSetoff` branches on
-- `CG_TableE_Checkbox` into a USER-ENTERED Schedule CG Table E allocation
-- (D114), so the utility treats its own sequence as a default over a
-- taxpayer-supplied one. NULL means "no election — the versioned
-- `portal_default_ay2026_27` policy applies". Non-NULL selects the
-- `taxpayer_elected` policy, which carries a professional-review flag and an
-- audit flag, and which STOPS FOR REVIEW when the election does not
-- reproduce current portal behaviour. The DB stores the election; it never
-- adjudicates it — the engine and adapter do (same division of
-- responsibility as every other tax judgement here).
--
-- LEDGER-TABLE OBLIGATIONS (D85 / AUDIT-03-F1). This table wires
-- `app.enforce_ledger_finalized_lock()` and `app.set_ledger_actor()` IN THIS
-- MIGRATION, not in a later remediation. `K4-06` created
-- `tax_house_property_entries` without them, which left the "a finalized
-- case is read-only" control absent at the DB layer for that table (the RLS
-- policies on every ledger table carry no finalized predicate — the control
-- lives ENTIRELY in the trigger) and became the most serious gap any audit
-- here has found. The table is also named `tax_*_entries` deliberately:
-- `scripts/deployment-parity-check.mjs` DERIVES the ledger-table set from
-- the catalog by that pattern and asserts both triggers on each, so this
-- table cannot silently ship unwired. It is additionally added to
-- `LEDGER_TABLES` in `tests/security/hostile-postgrest.mjs`.
-- ============================================================

create table public.tax_brought_forward_loss_entries (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  -- The assessment year in which the loss was FIRST COMPUTED (Section 74(2)).
  -- Stored in the same 'YYYY-YY' shape `tax_cases.assessment_year` uses. No
  -- check-constraint enumeration: unlike the current AY (a closed set this
  -- product computes for), an ORIGINATING year is historical data and the
  -- admissible range moves every year — the eight-AY window is evaluated in
  -- one pure, tested helper (`src/lib/tax-desk/brought-forward-losses.ts`),
  -- never duplicated as a second authority in SQL.
  originating_assessment_year text not null
    check (originating_assessment_year ~ '^[0-9]{4}-[0-9]{2}$'),
  -- Section 74(1)(a) short-term / 74(1)(b) long-term. Half of the row's identity.
  loss_type text not null check (loss_type in ('stcl', 'ltcl')),
  -- Unabsorbed loss brought forward, as a POSITIVE magnitude. A carry-forward
  -- record is a quantity of loss, not a signed gain, so the sign lives in
  -- `loss_type` and never in the number.
  amount numeric(14,2) not null default 0 check (amount >= 0),
  -- Section 139(3)/80. 'unverified' is the conservative default and FAILS
  -- CLOSED downstream; it is never treated as eligible.
  filing_eligibility text not null default 'unverified'
    check (filing_eligibility in ('verified_timely', 'unverified', 'not_eligible')),
  loss_provenance text not null default 'staff_declared'
    check (loss_provenance in ('prior_finalized_case_in_system', 'staff_declared')),
  -- Set only when `loss_provenance = 'prior_finalized_case_in_system'`. Not
  -- enforced as a conditional constraint here: the pure classifier is the
  -- single authority that decides whether the pointer substantiates the
  -- claimed provenance, and a DB constraint would be a second one.
  prior_tax_case_id uuid references public.tax_cases(id) on delete set null,
  -- NULL = no election (portal-default policy). Non-NULL = taxpayer_elected.
  elected_set_off_target text
    check (elected_set_off_target in ('stcg_111a', 'ltcg_112a')),
  source_type text not null default 'manual'
    check (source_type in (
      'manual','AIS','26AS','Form16','prefilled_json','broker_report',
      'bank_certificate','adjustment')),
  source_document_id uuid references public.case_documents(id) on delete set null,
  source_file_id uuid references public.uploaded_files(id) on delete set null,
  -- Evidence that the loss return was filed by the due date (the Section
  -- 139(3)/80 condition) — a SEPARATE evidence slot from the general
  -- source_document_id, mirroring tax_deduction_entries.proof_case_document_id.
  proof_case_document_id uuid references public.case_documents(id) on delete set null,
  notes text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.users(id),
  delete_reason text
);

create trigger trg_tax_brought_forward_loss_entries_updated_at
  before update on public.tax_brought_forward_loss_entries
  for each row execute function app.set_updated_at();

-- D85 / AUDIT-03-F1: both ledger triggers, in the SAME migration that creates
-- the table. Names and timing are byte-equivalent to what
-- `20260712140000_authz_boundary_enforcement.sql` §2b/§2c emits for a sibling
-- ledger, so this table is indistinguishable from its siblings in `pg_trigger`.
drop trigger if exists trg_tax_brought_forward_loss_entries_finalized_lock
  on public.tax_brought_forward_loss_entries;
create trigger trg_tax_brought_forward_loss_entries_finalized_lock
  before insert or update on public.tax_brought_forward_loss_entries
  for each row execute function app.enforce_ledger_finalized_lock();

drop trigger if exists trg_tax_brought_forward_loss_entries_actor
  on public.tax_brought_forward_loss_entries;
create trigger trg_tax_brought_forward_loss_entries_actor
  before insert or update on public.tax_brought_forward_loss_entries
  for each row execute function app.set_ledger_actor();

create index idx_tax_bf_loss_entries_tax_case_id
  on public.tax_brought_forward_loss_entries (tax_case_id);
create index idx_tax_bf_loss_entries_loss_type
  on public.tax_brought_forward_loss_entries (loss_type);
create index idx_tax_bf_loss_entries_originating_ay
  on public.tax_brought_forward_loss_entries (originating_assessment_year);
create index idx_tax_bf_loss_entries_source_document_id
  on public.tax_brought_forward_loss_entries (source_document_id);
create index idx_tax_bf_loss_entries_proof_case_document_id
  on public.tax_brought_forward_loss_entries (proof_case_document_id);
create index idx_tax_bf_loss_entries_live
  on public.tax_brought_forward_loss_entries (tax_case_id) where deleted_at is null;

alter table public.tax_brought_forward_loss_entries enable row level security;

create policy tax_brought_forward_loss_entries_select on public.tax_brought_forward_loss_entries
  for select to authenticated using (app.is_staff_or_admin());
create policy tax_brought_forward_loss_entries_insert on public.tax_brought_forward_loss_entries
  for insert to authenticated with check (app.is_staff_or_admin());
create policy tax_brought_forward_loss_entries_update on public.tax_brought_forward_loss_entries
  for update to authenticated
  using (app.is_staff_or_admin()) with check (app.is_staff_or_admin());

grant select, insert, update on public.tax_brought_forward_loss_entries to authenticated;
revoke delete on public.tax_brought_forward_loss_entries from authenticated;
revoke all on public.tax_brought_forward_loss_entries from anon;
