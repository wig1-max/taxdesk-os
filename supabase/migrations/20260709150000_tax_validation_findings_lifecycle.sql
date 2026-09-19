-- ============================================================
-- TaxDesk OS — 20260709150000 tax_validation_findings lifecycle (K.2.6)
--
-- Adds the columns the deterministic validation lifecycle needs on the
-- existing K.2.1 tax_validation_findings table. Purely additive + idempotent;
-- preserves existing rows. NO RLS/grant change (staff/admin select/insert/
-- update already granted; hard DELETE already revoked — findings are never
-- hard-deleted, only status-transitioned).
--
-- Reuse mapping (unchanged columns): code = rule_code, area = category,
-- created_at = first_seen_at, resolved_at/resolved_by already present.
-- ============================================================

alter table public.tax_validation_findings
  add column if not exists finding_key text,
  add column if not exists title text,
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists resolution_note text;

-- Severity vocabulary: K.2.6 uses error/warning/info. Keep legacy values so
-- the change is safe on any pre-existing row. Idempotent (drop + re-add).
alter table public.tax_validation_findings
  drop constraint if exists tax_validation_findings_severity_check;
alter table public.tax_validation_findings
  add constraint tax_validation_findings_severity_check
  check (severity in ('info', 'warning', 'error', 'blocker'));

-- Deterministic upsert: at most one system finding per (tax_case_id,
-- finding_key). finding_key is NULL for any ad-hoc/manual finding, and
-- Postgres treats NULLs as distinct, so a full unique index still allows
-- multiple NULL-key rows while giving system findings a stable upsert target.
create unique index if not exists uq_tax_validation_findings_key
  on public.tax_validation_findings (tax_case_id, finding_key);

create index if not exists idx_tax_validation_findings_last_seen
  on public.tax_validation_findings (last_seen_at);
