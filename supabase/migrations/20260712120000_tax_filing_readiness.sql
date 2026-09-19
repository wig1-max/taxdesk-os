-- ============================================================
-- TaxDesk OS — 20260712120000 Tax Desk filing readiness + finalization (K.2.8)
--
-- Adds the fields the deterministic Filing Readiness view, internal
-- finalization, and audited reopen need. Purely ADDITIVE + IDEMPOTENT;
-- preserves existing rows. NO RLS/grant change — tax_cases and
-- tax_readiness_items already grant staff/admin select/insert/update, hard
-- DELETE is already revoked, and anon has nothing.
--
-- "Finalized" = the internal TaxDesk OS tax-preparation record is LOCKED.
-- It does NOT mean the return was filed, accepted, e-verified, certified, or
-- that tax was paid. filing_status is intentionally NOT touched here.
-- ============================================================

-- ------------------------------------------------------------
-- 1. tax_cases — finalization binding + validation-run evidence
--
-- Already present (K.2.1): finalized_at, finalized_by, reopened_at,
-- reopened_by, reopen_reason. Missing: the snapshot the finalization is
-- bound to, a safe finalization note, and a reliable "latest validation run"
-- timestamp (the deterministic freshness check needs a timestamp that does
-- NOT depend on reading the append-only audit table under RLS).
-- ------------------------------------------------------------
alter table public.tax_cases
  add column if not exists finalized_snapshot_id uuid
    references public.tax_computation_snapshots(id),
  add column if not exists finalization_note text,
  add column if not exists validation_last_run_at timestamptz,
  add column if not exists validation_last_run_by uuid references public.users(id),
  add column if not exists validation_rules_version text;

create index if not exists idx_tax_cases_finalized_snapshot_id
  on public.tax_cases (finalized_snapshot_id);

-- ------------------------------------------------------------
-- 2. tax_readiness_items — current-state readiness rows (upsert target)
--
-- Reuse: code = item_key, label = title, blocked_by_finding_ids,
-- completed_at/by, updated_at, and the existing unique (tax_case_id, code)
-- as the deterministic upsert identity. Add the K.2.8 rule metadata.
-- ------------------------------------------------------------
alter table public.tax_readiness_items
  add column if not exists category text,
  add column if not exists is_blocking boolean not null default false,
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists last_checked_at timestamptz,
  add column if not exists rules_version text;

-- Widen the status vocabulary for the K.2.8 readiness rules while KEEPING the
-- legacy K.2.1 values so any pre-existing row stays valid. Idempotent.
alter table public.tax_readiness_items
  drop constraint if exists tax_readiness_items_status_check;
alter table public.tax_readiness_items
  add constraint tax_readiness_items_status_check
  check (status in (
    -- legacy K.2.1 values (retained for compatibility)
    'pending','blocked','complete','waived',
    -- K.2.8 readiness vocabulary
    'passed','warning','not_applicable'));

create index if not exists idx_tax_readiness_items_is_blocking
  on public.tax_readiness_items (is_blocking);
