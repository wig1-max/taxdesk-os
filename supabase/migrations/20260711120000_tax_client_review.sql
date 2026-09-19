-- ============================================================
-- TaxDesk OS — 20260711120000 Tax Desk client review pack (K.2.7)
--
-- Adds the snapshot-bound "client review / approval" lifecycle to the
-- existing K.2.1 tax_cases table. Purely ADDITIVE + IDEMPOTENT; preserves
-- existing rows. NO RLS/grant change (staff/admin select/insert/update
-- already granted on tax_cases; hard DELETE already revoked; anon has none).
--
-- AUTHORITATIVE FIELD:
--   client_review_status is the SINGLE authoritative client-review lifecycle
--   field for the whole application (case detail, cases list, dashboard metric,
--   and the Client Review page/actions all read it). It carries the richer K.2.7
--   vocabulary (not_started/prepared/sent/approved/changes_requested/superseded)
--   and, unlike the old flag, binds approval to ONE immutable snapshot via
--   client_review_snapshot_id — approval never silently carries to a newer
--   snapshot.
--
--   The K.2.1 tax_cases.client_approval_status column
--   (not_sent/sent/approved/changes_requested, default 'not_sent') is RETAINED
--   ONLY for schema/backward compatibility. No current Tax Desk UI, query, or
--   metric depends on it — it is not repurposed, not dropped, and not updated by
--   the K.2.7 actions. Existing rows are backfilled ONCE into
--   client_review_status below so state carries over cleanly.
-- ============================================================

alter table public.tax_cases
  add column if not exists client_review_snapshot_id uuid
    references public.tax_computation_snapshots(id),
  add column if not exists client_review_status text not null default 'not_started',
  add column if not exists client_review_sent_at timestamptz,
  add column if not exists client_review_sent_by uuid references public.users(id),
  add column if not exists client_approved_at timestamptz,
  add column if not exists client_approval_captured_by uuid references public.users(id),
  add column if not exists client_approval_method text,
  add column if not exists client_approval_reference text,
  add column if not exists client_changes_requested_at timestamptz,
  add column if not exists client_changes_requested_by uuid references public.users(id),
  add column if not exists client_changes_summary text;

-- Review lifecycle vocabulary. Deliberately EXCLUDES any "filing_ready" value
-- (filing readiness is a later phase). Idempotent (drop + re-add).
alter table public.tax_cases
  drop constraint if exists tax_cases_client_review_status_check;
alter table public.tax_cases
  add constraint tax_cases_client_review_status_check
  check (client_review_status in (
    'not_started','prepared','sent','approved','changes_requested','superseded'));

-- One-time backfill of legacy client_approval_status into the authoritative
-- client_review_status so existing production rows carry their state over.
-- Guarded on client_review_status = 'not_started' (the freshly added default)
-- so it is SAFE + IDEMPOTENT: a re-run (or a row already advanced by K.2.7)
-- is never overwritten. not_sent maps to the default 'not_started' and so
-- needs no update. All target values satisfy the check constraint above.
update public.tax_cases
   set client_review_status = case client_approval_status
     when 'sent' then 'sent'
     when 'approved' then 'approved'
     when 'changes_requested' then 'changes_requested'
     else client_review_status
   end
 where client_review_status = 'not_started'
   and client_approval_status in ('sent','approved','changes_requested');

-- Approval method vocabulary (nullable — only set when approval is captured).
alter table public.tax_cases
  drop constraint if exists tax_cases_client_approval_method_check;
alter table public.tax_cases
  add constraint tax_cases_client_approval_method_check
  check (client_approval_method is null or client_approval_method in (
    'whatsapp','email','phone','in_person','signed_document','other'));

-- Indexes on the fields the review view / actions filter and join on.
create index if not exists idx_tax_cases_client_review_status
  on public.tax_cases (client_review_status);
create index if not exists idx_tax_cases_client_review_snapshot_id
  on public.tax_cases (client_review_snapshot_id);
