-- K3-30 — One-source propose -> review -> promote workflow (Wave 3, narrow slice).
--
-- Adds the FIRST product path where an imported fact can become preparation
-- truth. Deliberately narrow (D17 stands): exactly one synthetic Form-16-shaped
-- source, exactly two facts (salary income + salary TDS) — the same two facts
-- `source-schema.ts`'s Form16 package already declares. Nothing here parses,
-- fetches, OCRs, or extracts a document; the adapter version below names a
-- SYNTHETIC, hand-entered candidate fact, never a real parser.
--
-- Three guarded RPCs (SECURITY DEFINER, owner app_writer, mirrors the
-- ingestion-gates / reviewer-signoff convention):
--   * propose_source_fact         — records a versioned, non-authoritative
--                                   candidate fact against an ALREADY-INGESTED
--                                   case document. Never touches a ledger.
--   * decide_source_proposal      — explicit human accept/reject. Re-verifies
--                                   auth, finalized state, and current status
--                                   under a row lock (FOR UPDATE).
--   * promote_source_proposal_pair — the only path a proposal can become
--                                   ledger truth. Requires BOTH facts for the
--                                   same document to be `accepted`; inserts the
--                                   income + tax_paid rows and marks both
--                                   proposals `promoted` with immutable lineage
--                                   to the proposal id, in ONE transaction.
--                                   Idempotent (a second call returns the
--                                   original rows, creates nothing new).
--
-- SYNTHETIC DATA ONLY. No engine/adapter/computation semantic changed; no
-- snapshot/approval/readiness/filing behavior changed.

-- ------------------------------------------------------------
-- 0. tax_source_proposals — the versioned proposal envelope.
-- ------------------------------------------------------------
create table if not exists public.tax_source_proposals (
  id uuid primary key default gen_random_uuid(),
  tax_case_id uuid not null references public.tax_cases(id) on delete cascade,
  case_document_id uuid not null references public.case_documents(id),

  proposal_format_version text not null default 'TAX_SOURCE_PROPOSAL_V1'
    check (proposal_format_version = 'TAX_SOURCE_PROPOSAL_V1'),
  -- Pinned to the ONE supported source in this narrow slice. A different kind
  -- or an unpinned version is a malformed-version refusal, never a guess.
  source_schema_kind text not null
    check (source_schema_kind = 'Form16'),
  source_schema_version text not null
    check (source_schema_version = 'FORM16_V0_PLANNED'),
  -- Synthetic, hand-entered candidate identity — NOT a parser, NOT OCR.
  adapter_version text not null
    check (adapter_version = 'SYNTHETIC_FORM16_PROPOSAL_ADAPTER_V1'),

  fact_kind text not null
    check (fact_kind in ('income.salary', 'tax_paid.salary_tds')),
  proposed_value numeric(14,2) not null check (proposed_value >= 0),

  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'rejected', 'promoted')),
  decision_reason text,
  decided_by uuid references public.users(id),
  decided_at timestamptz,

  -- Immutable lineage once promoted. Never updated again after being set.
  promoted_ledger_kind text check (promoted_ledger_kind in ('income', 'tax_paid')),
  promoted_ledger_entry_id uuid,
  promoted_at timestamptz,
  promoted_by uuid references public.users(id),

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_tax_source_proposals_reject_reason check (
    status <> 'rejected' or (decision_reason is not null and length(trim(decision_reason)) > 0)
  ),
  constraint chk_tax_source_proposals_promoted_lineage check (
    status <> 'promoted' or (promoted_ledger_kind is not null and promoted_ledger_entry_id is not null)
  )
);

create trigger trg_tax_source_proposals_updated_at
  before update on public.tax_source_proposals
  for each row execute function app.set_updated_at();

create index if not exists idx_tax_source_proposals_tax_case_id
  on public.tax_source_proposals (tax_case_id);
create index if not exists idx_tax_source_proposals_case_document_id
  on public.tax_source_proposals (case_document_id);
create index if not exists idx_tax_source_proposals_status
  on public.tax_source_proposals (status);

-- At most one LIVE (non-rejected) proposal per fact per document. A rejected
-- proposal may be superseded by a fresh one (staff fixing a wrong reading);
-- the newest non-rejected row is always "the" current proposal for that fact.
create unique index if not exists uq_tax_source_proposals_live_fact
  on public.tax_source_proposals (case_document_id, fact_kind)
  where status <> 'rejected';

alter table public.tax_source_proposals enable row level security;

-- Base-table read is staff/admin (mirrors every other Tax Desk table). There is
-- NO authenticated insert/update/delete policy or grant at all — every write
-- goes through one of the three guarded RPCs below (mirrors
-- tax_reviewer_credentials / tax_case_reviews).
drop policy if exists tax_source_proposals_select on public.tax_source_proposals;
create policy tax_source_proposals_select on public.tax_source_proposals
  for select to authenticated using (app.is_staff_or_admin());

revoke all on public.tax_source_proposals from anon;
revoke insert, update, delete on public.tax_source_proposals from authenticated;
grant select on public.tax_source_proposals to authenticated;   -- gated by staff-only RLS
grant select, insert, update on public.tax_source_proposals to app_writer;

-- app_writer needs read access to the tables the RPCs join/verify against, and
-- write access to the two ledger tables the promotion RPC inserts into.
grant select on public.case_documents to app_writer;
grant select, insert on public.tax_income_entries to app_writer;
grant select, insert on public.tax_tax_paid_entries to app_writer;

-- ------------------------------------------------------------
-- 1. propose_source_fact — records a non-authoritative candidate fact.
--    Requires the target document to already be ingested (a live
--    uploaded_files row); creation alone never touches a ledger or computation.
-- ------------------------------------------------------------
create or replace function public.propose_source_fact(
  p_tax_case_id           uuid,
  p_case_document_id      uuid,
  p_fact_kind             text,
  p_proposed_value        numeric,
  p_source_schema_version text,
  p_adapter_version       text,
  p_event_id              uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_case_id     uuid;
  v_finalized   timestamptz;
  v_doc_case_id uuid;
  v_has_file    boolean;
  v_existing    uuid;
  v_proposal_id uuid;
  v_entity      text := coalesce(p_case_document_id::text, '') || ':' || coalesce(p_fact_kind, '');
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if p_fact_kind not in ('income.salary', 'tax_paid.salary_tds') then
    raise exception 'Unsupported fact kind.' using errcode = '22023';
  end if;
  if p_source_schema_version is distinct from 'FORM16_V0_PLANNED' then
    raise exception 'Unsupported source schema version.' using errcode = '22023';
  end if;
  if p_adapter_version is distinct from 'SYNTHETIC_FORM16_PROPOSAL_ADAPTER_V1' then
    raise exception 'Unsupported adapter version.' using errcode = '22023';
  end if;
  if p_proposed_value is null or p_proposed_value < 0 then
    raise exception 'Proposed value must be a non-negative amount.' using errcode = '22023';
  end if;

  -- entity encodes BOTH document and fact kind, so a misused event_id across
  -- two different facts is caught by event_already_applied's own mismatch
  -- check rather than silently resolving to the wrong proposal.
  if app.event_already_applied(p_event_id, 'tax_source_proposal.created', v_actor, v_entity) then
    select id into v_proposal_id from public.tax_source_proposals
      where case_document_id = p_case_document_id and fact_kind = p_fact_kind
      order by created_at desc limit 1;
    return v_proposal_id;
  end if;

  select tc.case_id, tc.finalized_at into v_case_id, v_finalized
    from public.tax_cases tc where tc.id = p_tax_case_id for update;
  if v_case_id is null then
    raise exception 'Tax case not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized and read-only.' using errcode = '42501';
  end if;

  select cd.case_id into v_doc_case_id from public.case_documents cd
    where cd.id = p_case_document_id and cd.deleted_at is null;
  if v_doc_case_id is null then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  if v_doc_case_id <> v_case_id then
    raise exception 'Document does not belong to this case.' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.uploaded_files uf
    where uf.case_document_id = p_case_document_id and uf.deleted_at is null
  ) into v_has_file;
  if not v_has_file then
    raise exception 'This document has not been uploaded yet.' using errcode = '22023';
  end if;

  -- Lock any existing live proposal for this exact fact before checking (the
  -- partial unique index is the concurrency backstop caught in the exception
  -- handler below).
  select id into v_existing from public.tax_source_proposals
    where case_document_id = p_case_document_id and fact_kind = p_fact_kind and status <> 'rejected'
    for update;
  if v_existing is not null then
    raise exception 'A live proposal for this fact already exists for this document.' using errcode = '23505';
  end if;

  insert into public.tax_source_proposals
    (tax_case_id, case_document_id, source_schema_kind, source_schema_version,
     adapter_version, fact_kind, proposed_value, created_by)
  values
    (p_tax_case_id, p_case_document_id, 'Form16', p_source_schema_version,
     p_adapter_version, p_fact_kind, p_proposed_value, v_actor)
  returning id into v_proposal_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_source_proposal.created', 'tax_source_proposals', v_entity, v_case_id,
     jsonb_build_object('proposal_id', v_proposal_id, 'tax_case_id', p_tax_case_id,
                        'case_document_id', p_case_document_id, 'fact_kind', p_fact_kind,
                        'proposed_value', p_proposed_value),
     p_event_id);

  return v_proposal_id;
exception
  when unique_violation then
    raise exception 'A live proposal for this fact already exists for this document.' using errcode = '23505';
end;
$$;

-- ------------------------------------------------------------
-- 2. decide_source_proposal — explicit human accept/reject.
-- ------------------------------------------------------------
create or replace function public.decide_source_proposal(
  p_proposal_id uuid,
  p_decision    text,  -- 'accept' | 'reject'
  p_reason      text,
  p_event_id    uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_case_id     uuid;
  v_tax_case_id uuid;
  v_finalized   timestamptz;
  v_status      text;
  v_new_status  text;
  v_reason      text := nullif(btrim(coalesce(p_reason, '')), '');
  v_recorded_decision text;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if p_decision not in ('accept', 'reject') then
    raise exception 'Invalid decision.' using errcode = '22023';
  end if;
  if p_decision = 'reject' and v_reason is null then
    raise exception 'A reason is required to reject a proposal.' using errcode = '22023';
  end if;
  v_new_status := case when p_decision = 'accept' then 'accepted' else 'rejected' end;

  if app.event_already_applied(p_event_id, 'tax_source_proposal.decided', v_actor, p_proposal_id::text) then
    -- The generic helper matches on (action, actor, entity) only, which does
    -- NOT encode which decision was recorded, so a reused event_id with a
    -- FLIPPED decision must be caught explicitly here — an opposing decision
    -- must fail deterministically, never silently "succeed" as a no-op.
    select a.after ->> 'decision' into v_recorded_decision
      from public.audit_logs a where a.event_id = p_event_id limit 1;
    if v_recorded_decision is distinct from p_decision then
      raise exception 'event_id % was already used to record a different decision (recorded=%).',
        p_event_id, v_recorded_decision using errcode = '23505';
    end if;
    return p_proposal_id;
  end if;

  select p.tax_case_id, p.status, tc.case_id, tc.finalized_at
    into v_tax_case_id, v_status, v_case_id, v_finalized
    from public.tax_source_proposals p
    join public.tax_cases tc on tc.id = p.tax_case_id
    where p.id = p_proposal_id
    for update of p;
  if v_tax_case_id is null then
    raise exception 'Proposal not found.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized and read-only.' using errcode = '42501';
  end if;
  if v_status <> 'proposed' then
    raise exception 'This proposal has already been decided (status=%).', v_status using errcode = '22023';
  end if;

  update public.tax_source_proposals set
    status          = v_new_status,
    decision_reason = v_reason,
    decided_by      = v_actor,
    decided_at      = now()
  where id = p_proposal_id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_source_proposal.decided', 'tax_source_proposals', p_proposal_id::text, v_case_id,
     jsonb_build_object('proposal_id', p_proposal_id, 'decision', p_decision, 'has_reason', v_reason is not null),
     p_event_id);

  return p_proposal_id;
end;
$$;

-- ------------------------------------------------------------
-- 3. promote_source_proposal_pair — the ONLY path into the ledgers.
--    Atomic + idempotent: requires BOTH facts accepted; inserts one income row
--    + one tax_paid row and marks both proposals promoted, all in one
--    transaction. A second call for an already-promoted document returns the
--    original rows and creates nothing new. A partial failure rolls back
--    everything (no salary-without-TDS or TDS-without-salary result).
-- ------------------------------------------------------------
create or replace function public.promote_source_proposal_pair(
  p_case_document_id uuid,
  p_event_id         uuid
) returns table (income_entry_id uuid, tax_paid_entry_id uuid, already_promoted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
  v_role  text := app.current_role();
  v_case_id     uuid;
  v_tax_case_id uuid;
  v_finalized   timestamptz;
  v_income  record;
  v_taxpaid record;
  v_income_id  uuid;
  v_taxpaid_id uuid;
begin
  if not app.is_staff_or_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;

  -- Lock every proposal row for this document up front (deterministic order by
  -- fact_kind avoids cross-document lock-order deadlocks). Includes any
  -- superseded (rejected) rows, which is harmless.
  perform 1 from public.tax_source_proposals
    where case_document_id = p_case_document_id
    order by fact_kind
    for update;

  select p.tax_case_id, tc.case_id, tc.finalized_at
    into v_tax_case_id, v_case_id, v_finalized
    from public.tax_source_proposals p
    join public.tax_cases tc on tc.id = p.tax_case_id
    where p.case_document_id = p_case_document_id
    limit 1;
  if v_tax_case_id is null then
    raise exception 'No proposals exist for this document.' using errcode = 'P0002';
  end if;
  if v_finalized is not null then
    raise exception 'This tax case is finalized and read-only.' using errcode = '42501';
  end if;

  -- The CURRENT proposal per fact is the newest non-rejected row (a rejected
  -- reading may have been superseded by a fresh, corrected proposal).
  select id, status, proposed_value, promoted_ledger_entry_id into v_income
    from public.tax_source_proposals
    where case_document_id = p_case_document_id and fact_kind = 'income.salary'
    order by created_at desc limit 1;
  select id, status, proposed_value, promoted_ledger_entry_id into v_taxpaid
    from public.tax_source_proposals
    where case_document_id = p_case_document_id and fact_kind = 'tax_paid.salary_tds'
    order by created_at desc limit 1;

  if v_income.id is null or v_taxpaid.id is null then
    raise exception 'Incomplete pair: both salary income and salary TDS must be proposed before promotion.'
      using errcode = '22023';
  end if;

  -- Idempotent replay: both already promoted -> return the existing rows.
  if v_income.status = 'promoted' and v_taxpaid.status = 'promoted' then
    income_entry_id := v_income.promoted_ledger_entry_id;
    tax_paid_entry_id := v_taxpaid.promoted_ledger_entry_id;
    already_promoted := true;
    return next;
    return;
  end if;

  -- A partially-promoted pair should be structurally impossible (both rows are
  -- flipped in the same transaction below); fail loud rather than silently
  -- completing only one side if it is ever observed.
  if v_income.status = 'promoted' or v_taxpaid.status = 'promoted' then
    raise exception 'Inconsistent promotion state for this document.' using errcode = 'XX000';
  end if;

  if v_income.status <> 'accepted' or v_taxpaid.status <> 'accepted' then
    raise exception 'Both facts must be accepted before promotion (income=%, tax_paid=%).',
      v_income.status, v_taxpaid.status using errcode = '22023';
  end if;

  insert into public.tax_income_entries
    (tax_case_id, income_head, amount, source_type, source_document_id, created_by, updated_by)
  values
    (v_tax_case_id, 'salary', v_income.proposed_value, 'Form16', p_case_document_id, v_actor, v_actor)
  returning id into v_income_id;

  insert into public.tax_tax_paid_entries
    (tax_case_id, tax_paid_type, amount, source_type, source_document_id, created_by, updated_by)
  values
    (v_tax_case_id, 'salary_tds', v_taxpaid.proposed_value, 'Form16', p_case_document_id, v_actor, v_actor)
  returning id into v_taxpaid_id;

  update public.tax_source_proposals set
    status = 'promoted', promoted_ledger_kind = 'income', promoted_ledger_entry_id = v_income_id,
    promoted_at = now(), promoted_by = v_actor
  where id = v_income.id;

  update public.tax_source_proposals set
    status = 'promoted', promoted_ledger_kind = 'tax_paid', promoted_ledger_entry_id = v_taxpaid_id,
    promoted_at = now(), promoted_by = v_actor
  where id = v_taxpaid.id;

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, event_id)
  values
    (v_actor, v_role, 'tax_source_proposal.promoted', 'tax_source_proposals', p_case_document_id::text, v_case_id,
     jsonb_build_object('case_document_id', p_case_document_id, 'tax_case_id', v_tax_case_id,
                        'income_entry_id', v_income_id, 'tax_paid_entry_id', v_taxpaid_id,
                        'income_proposal_id', v_income.id, 'tax_paid_proposal_id', v_taxpaid.id),
     p_event_id);

  income_entry_id := v_income_id;
  tax_paid_entry_id := v_taxpaid_id;
  already_promoted := false;
  return next;
  return;
end;
$$;

-- ------------------------------------------------------------
-- 4. Ownership + least-privilege grants.
-- ------------------------------------------------------------
grant create on schema public to app_writer;
do $$
declare
  fn text;
  fns text[] := array[
    'propose_source_fact(uuid,uuid,text,numeric,text,text,uuid)',
    'decide_source_proposal(uuid,text,text,uuid)',
    'promote_source_proposal_pair(uuid,uuid)'
  ];
begin
  foreach fn in array fns loop
    execute format('alter function public.%s owner to app_writer;', fn);
    execute format('revoke all on function public.%s from public;', fn);
    execute format('revoke all on function public.%s from anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;
revoke create on schema public from app_writer;
