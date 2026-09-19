-- ============================================================
-- TaxDesk OS — 000001 initial schema
-- 22 tables + 3 views. No RLS here (000002). No Aadhaar number
-- column exists anywhere in this schema, by design.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create schema if not exists app;

-- updated_at maintenance for mutable tables
create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- users (extends auth.users; invite-only, no self-signup)
-- ------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email citext unique not null,
  phone text,
  role text not null check (role in ('admin','staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger trg_users_updated_at
  before update on public.users
  for each row execute function app.set_updated_at();

-- ------------------------------------------------------------
-- clients — PAN app-encrypted (pan_encrypted bytea + pan_last4).
-- NO Aadhaar column. Never add one.
-- ------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  display_code text unique,
  full_name text not null,
  primary_phone text not null,
  email citext,
  pan_encrypted bytea,
  pan_last4 text check (pan_last4 is null or length(pan_last4) = 4),
  date_of_birth date,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  pincode text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  kyc_status text not null default 'pending'
    check (kyc_status in ('pending','partial','done')),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function app.set_updated_at();

create index idx_clients_full_name_trgm on public.clients using gin (full_name gin_trgm_ops);
create index idx_clients_phone_trgm on public.clients using gin (primary_phone gin_trgm_ops);
create index idx_clients_pan_last4 on public.clients (pan_last4);
create index idx_clients_created_by on public.clients (created_by);

-- ------------------------------------------------------------
-- client_contacts
-- ------------------------------------------------------------
create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  relation text,
  phone text,
  email citext,
  is_whatsapp boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger trg_client_contacts_updated_at
  before update on public.client_contacts
  for each row execute function app.set_updated_at();

create index idx_client_contacts_client_id on public.client_contacts (client_id);

-- ------------------------------------------------------------
-- services — status flows live in JSONB for v1 (seeded in 000004)
-- ------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  workflow_type text not null check (workflow_type in ('full','lead','generic')),
  status_flow jsonb not null default '{}'::jsonb,
  default_fee_config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_services_updated_at
  before update on public.services
  for each row execute function app.set_updated_at();

-- ------------------------------------------------------------
-- cases — Aadhaar uploads are default-deny: aadhaar_required must
-- be explicitly set with a reason before the upload UI offers it.
-- ------------------------------------------------------------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  display_code text unique,
  client_id uuid not null references public.clients(id),
  service_id uuid not null references public.services(id),
  title text,
  status text not null,
  next_action text,
  next_action_due date,
  next_action_owner uuid references public.users(id),
  owner_id uuid not null references public.users(id),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  lead_source text check (lead_source is null or lead_source in
    ('walk_in','referral','existing','campaign','other')),
  service_data jsonb not null default '{}'::jsonb,
  aadhaar_required boolean not null default false,
  aadhaar_required_reason text,
  on_hold_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_cases_aadhaar_reason check (
    aadhaar_required = false
    or (aadhaar_required_reason is not null and length(trim(aadhaar_required_reason)) > 0)
  )
);

create trigger trg_cases_updated_at
  before update on public.cases
  for each row execute function app.set_updated_at();

create index idx_cases_client_id on public.cases (client_id);
create index idx_cases_service_id on public.cases (service_id);
create index idx_cases_owner_id on public.cases (owner_id);
create index idx_cases_next_action_owner on public.cases (next_action_owner);
create index idx_cases_status on public.cases (status);
create index idx_cases_next_action_due on public.cases (next_action_due);
create index idx_cases_service_status on public.cases (service_id, status);
create index idx_cases_active on public.cases (next_action_due)
  where deleted_at is null and completed_at is null;

-- ------------------------------------------------------------
-- case_status_history — append-only
-- ------------------------------------------------------------
create table public.case_status_history (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  changed_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index idx_case_status_history_case_id on public.case_status_history (case_id);
create index idx_case_status_history_changed_by on public.case_status_history (changed_by);

-- ------------------------------------------------------------
-- document_requirements — master checklist templates per service
-- ------------------------------------------------------------
create table public.document_requirements (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id),
  code text not null,
  name text not null,
  description text,
  is_required boolean not null default true,
  condition_note text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, code)
);

create trigger trg_document_requirements_updated_at
  before update on public.document_requirements
  for each row execute function app.set_updated_at();

create index idx_document_requirements_service_id on public.document_requirements (service_id);

-- ------------------------------------------------------------
-- case_documents — checklist instances per case
-- ------------------------------------------------------------
create table public.case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  requirement_id uuid references public.document_requirements(id),
  name text not null,
  status text not null default 'pending' check (status in
    ('pending','requested','received','verified','waived','rejected')),
  is_required boolean not null default true,
  waived_reason text,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_case_documents_waived_reason check (
    status <> 'waived' or (waived_reason is not null and length(trim(waived_reason)) > 0)
  )
);

create trigger trg_case_documents_updated_at
  before update on public.case_documents
  for each row execute function app.set_updated_at();

create index idx_case_documents_case_id on public.case_documents (case_id);
create index idx_case_documents_requirement_id on public.case_documents (requirement_id);
create index idx_case_documents_status on public.case_documents (status);
create index idx_case_documents_case_status on public.case_documents (case_id, status);

-- ------------------------------------------------------------
-- upload_links — hashed tokens only; raw token never stored
-- ------------------------------------------------------------
create table public.upload_links (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  token_hash text unique not null,
  allowed_document_ids uuid[] not null default '{}',
  expires_at timestamptz not null,
  max_uploads integer not null default 10 check (max_uploads between 1 and 25),
  uploads_used integer not null default 0 check (uploads_used >= 0),
  revoked_at timestamptz,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_upload_links_expiry check (
    expires_at > created_at
    and expires_at <= created_at + interval '7 days'
  )
);

create trigger trg_upload_links_updated_at
  before update on public.upload_links
  for each row execute function app.set_updated_at();

create index idx_upload_links_case_id on public.upload_links (case_id);
create index idx_upload_links_created_by on public.upload_links (created_by);
create index idx_upload_links_expires_at on public.upload_links (expires_at);

-- ------------------------------------------------------------
-- uploaded_files — one row per object in the private bucket.
-- contains_aadhaar marks files for the early-purge queue.
-- ------------------------------------------------------------
create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  case_document_id uuid references public.case_documents(id),
  storage_path text unique not null,
  original_filename text not null,
  mime_type text not null check (mime_type in
    ('application/pdf','image/jpeg','image/png','image/webp','image/heic')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  sha256 text,
  uploaded_via text not null check (uploaded_via in ('staff','client_link')),
  upload_link_id uuid references public.upload_links(id),
  uploaded_by uuid references public.users(id),
  review_status text not null default 'uploaded'
    check (review_status in ('uploaded','verified','rejected')),
  rejected_reason text,
  contains_aadhaar boolean not null default false,
  early_purge_recommended_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_uploaded_files_rejected_reason check (
    review_status <> 'rejected' or (rejected_reason is not null and length(trim(rejected_reason)) > 0)
  )
);

create trigger trg_uploaded_files_updated_at
  before update on public.uploaded_files
  for each row execute function app.set_updated_at();

create index idx_uploaded_files_case_id on public.uploaded_files (case_id);
create index idx_uploaded_files_case_document_id on public.uploaded_files (case_document_id);
create index idx_uploaded_files_upload_link_id on public.uploaded_files (upload_link_id);
create index idx_uploaded_files_uploaded_by on public.uploaded_files (uploaded_by);
create index idx_uploaded_files_review_status on public.uploaded_files (review_status);
create index idx_uploaded_files_purge_queue on public.uploaded_files (early_purge_recommended_at)
  where contains_aadhaar = true and purged_at is null;

-- ------------------------------------------------------------
-- consent_records — append-only
-- ------------------------------------------------------------
create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  case_id uuid references public.cases(id),
  upload_link_id uuid references public.upload_links(id),
  consent_type text not null check (consent_type in
    ('document_upload','data_processing','communication')),
  purpose text not null,
  consent_text_version text not null,
  given_via text not null check (given_via in
    ('upload_page','in_office_form','whatsapp_confirmation')),
  ip_hash text,
  created_at timestamptz not null default now()
);

create index idx_consent_records_client_id on public.consent_records (client_id);
create index idx_consent_records_case_id on public.consent_records (case_id);
create index idx_consent_records_upload_link_id on public.consent_records (upload_link_id);

-- ------------------------------------------------------------
-- fees — IEPF revenue pipeline. expected_fee / final_fee /
-- computed_total are STORED GENERATED columns (single-row math
-- only). balance_fee_due needs the payments ledger, so it lives
-- in the fee_balances view below, not in a column.
-- ------------------------------------------------------------
create table public.fees (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  fee_type text not null check (fee_type in ('fixed','percent_of_recovery')),
  description text,
  fixed_amount numeric(12,2) check (fixed_amount is null or fixed_amount >= 0),
  percent numeric(5,2) check (percent is null or (percent >= 0 and percent <= 100)),
  estimated_claim_value numeric(14,2) check (estimated_claim_value is null or estimated_claim_value >= 0),
  actual_recovered_value numeric(14,2) check (actual_recovered_value is null or actual_recovered_value >= 0),
  upfront_amount numeric(12,2) not null default 0 check (upfront_amount >= 0),
  confidence text not null default 'medium' check (confidence in ('low','medium','high')),
  expected_closure_month date,
  expected_fee numeric(12,2) generated always as (
    case
      when fee_type = 'percent_of_recovery'
           and estimated_claim_value is not null and percent is not null
      then round(estimated_claim_value * percent / 100.0, 2)
    end
  ) stored,
  final_fee numeric(12,2) generated always as (
    case
      when fee_type = 'percent_of_recovery'
           and actual_recovered_value is not null and percent is not null
      then round(actual_recovered_value * percent / 100.0, 2)
    end
  ) stored,
  computed_total numeric(12,2) generated always as (
    case
      when fee_type = 'fixed' then fixed_amount
      when fee_type = 'percent_of_recovery' then coalesce(
        case when actual_recovered_value is not null and percent is not null
             then round(actual_recovered_value * percent / 100.0, 2) end,
        case when estimated_claim_value is not null and percent is not null
             then round(estimated_claim_value * percent / 100.0, 2) end
      )
    end
  ) stored,
  override_total numeric(12,2) check (override_total is null or override_total >= 0),
  override_reason text,
  status text not null default 'draft' check (status in
    ('draft','agreed','partially_paid','paid','waived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_fees_override_reason check (
    override_total is null or (override_reason is not null and length(trim(override_reason)) > 0)
  ),
  constraint chk_fees_type_fields check (
    (fee_type = 'fixed' and fixed_amount is not null)
    or (fee_type = 'percent_of_recovery' and percent is not null)
  )
);

create trigger trg_fees_updated_at
  before update on public.fees
  for each row execute function app.set_updated_at();

create index idx_fees_case_id on public.fees (case_id);
create index idx_fees_status on public.fees (status);

-- ------------------------------------------------------------
-- payments — append-only ledger; corrections via reversing rows
-- ------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  fee_id uuid not null references public.fees(id),
  case_id uuid not null references public.cases(id),
  amount numeric(12,2) not null check (amount > 0),
  direction text not null default 'received' check (direction in ('received','refunded')),
  method text not null check (method in ('cash','upi','bank_transfer','cheque','other')),
  reference text,
  paid_on date not null,
  recorded_by uuid not null references public.users(id),
  notes text,
  created_at timestamptz not null default now()
);

create index idx_payments_fee_id on public.payments (fee_id);
create index idx_payments_case_id on public.payments (case_id);
create index idx_payments_recorded_by on public.payments (recorded_by);

-- ------------------------------------------------------------
-- pdf_templates
-- ------------------------------------------------------------
create table public.pdf_templates (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  service_id uuid references public.services(id),
  body_config jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_pdf_templates_updated_at
  before update on public.pdf_templates
  for each row execute function app.set_updated_at();

create index idx_pdf_templates_service_id on public.pdf_templates (service_id);

-- ------------------------------------------------------------
-- generated_pdfs — append-only, with data snapshot for reproducibility
-- ------------------------------------------------------------
create table public.generated_pdfs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  template_id uuid not null references public.pdf_templates(id),
  storage_path text unique not null,
  snapshot_data jsonb not null default '{}'::jsonb,
  generated_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index idx_generated_pdfs_case_id on public.generated_pdfs (case_id);
create index idx_generated_pdfs_template_id on public.generated_pdfs (template_id);
create index idx_generated_pdfs_generated_by on public.generated_pdfs (generated_by);

-- ------------------------------------------------------------
-- message_templates
-- ------------------------------------------------------------
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  service_id uuid references public.services(id),
  body text not null,
  variables text[] not null default '{}',
  language text not null default 'hinglish',
  version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_message_templates_updated_at
  before update on public.message_templates
  for each row execute function app.set_updated_at();

create index idx_message_templates_service_id on public.message_templates (service_id);

-- ------------------------------------------------------------
-- case_messages — append-only log of composed/copied messages
-- ------------------------------------------------------------
create table public.case_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  template_id uuid references public.message_templates(id),
  rendered_body text not null,
  copied_at timestamptz,
  composed_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index idx_case_messages_case_id on public.case_messages (case_id);
create index idx_case_messages_template_id on public.case_messages (template_id);
create index idx_case_messages_composed_by on public.case_messages (composed_by);

-- ------------------------------------------------------------
-- followups
-- ------------------------------------------------------------
create table public.followups (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  due_date date not null,
  note text not null,
  assigned_to uuid references public.users(id),
  status text not null default 'open' check (status in ('open','done','cancelled')),
  completed_at timestamptz,
  completed_by uuid references public.users(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger trg_followups_updated_at
  before update on public.followups
  for each row execute function app.set_updated_at();

create index idx_followups_case_id on public.followups (case_id);
create index idx_followups_due_date on public.followups (due_date);
create index idx_followups_assigned_to on public.followups (assigned_to);
create index idx_followups_open_due on public.followups (due_date)
  where status = 'open' and deleted_at is null;

-- ------------------------------------------------------------
-- audit_logs — append-only, admin-read. before/after payloads
-- must be masked by the app-layer audit() helper before insert.
-- Raw PAN or Aadhaar-like data must never be written here.
-- ------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.users(id),
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  case_id uuid,
  before jsonb,
  after jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_created_at on public.audit_logs (created_at desc);
create index idx_audit_logs_entity on public.audit_logs (entity_type, entity_id);
create index idx_audit_logs_case_id on public.audit_logs (case_id);
create index idx_audit_logs_actor_id on public.audit_logs (actor_id);

-- ------------------------------------------------------------
-- settings
-- ------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_settings_updated_at
  before update on public.settings
  for each row execute function app.set_updated_at();

-- ------------------------------------------------------------
-- physical_documents — custody of original paper documents
-- ------------------------------------------------------------
create table public.physical_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  name text not null,
  description text,
  received_date date,
  received_by uuid references public.users(id),
  storage_location text,
  custody_status text not null default 'expected' check (custody_status in
    ('expected','in_custody','dispatched','returned_to_client','lost')),
  return_required boolean not null default false,
  returned_date date,
  returned_to text,
  courier_name text,
  tracking_number text,
  dispatched_date date,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_physical_documents_dispatched check (
    custody_status <> 'dispatched'
    or (courier_name is not null and tracking_number is not null and dispatched_date is not null)
  ),
  constraint chk_physical_documents_returned check (
    custody_status <> 'returned_to_client'
    or (returned_date is not null and returned_to is not null)
  )
);

create trigger trg_physical_documents_updated_at
  before update on public.physical_documents
  for each row execute function app.set_updated_at();

create index idx_physical_documents_case_id on public.physical_documents (case_id);
create index idx_physical_documents_received_by on public.physical_documents (received_by);
create index idx_physical_documents_custody on public.physical_documents (custody_status)
  where deleted_at is null;

-- ------------------------------------------------------------
-- identity_reviews — one per IEPF case
-- ------------------------------------------------------------
create table public.identity_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid unique not null references public.cases(id) on delete cascade,
  pan_name_match text not null default 'not_checked'
    check (pan_name_match in ('not_checked','match','mismatch','na')),
  cml_name_match text not null default 'not_checked'
    check (cml_name_match in ('not_checked','match','mismatch','na')),
  certificate_name_match text not null default 'not_checked'
    check (certificate_name_match in ('not_checked','match','mismatch','na')),
  bank_name_match text not null default 'not_checked'
    check (bank_name_match in ('not_checked','match','mismatch','na')),
  address_mismatch text not null default 'not_checked'
    check (address_mismatch in ('not_checked','no','yes')),
  signature_mismatch_risk text not null default 'unknown'
    check (signature_mismatch_risk in ('unknown','low','medium','high')),
  same_person_affidavit_needed boolean not null default false,
  change_of_address_affidavit_needed boolean not null default false,
  notes text,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_identity_reviews_updated_at
  before update on public.identity_reviews
  for each row execute function app.set_updated_at();

create index idx_identity_reviews_case_id on public.identity_reviews (case_id);
create index idx_identity_reviews_reviewed_by on public.identity_reviews (reviewed_by);

-- ============================================================
-- Views (security_invoker: underlying RLS + grants apply)
-- ============================================================

-- clients_safe: everything staff need, WITHOUT pan_encrypted.
-- Column-level grants in 000002 additionally block pan_encrypted
-- from authenticated SELECT on the base table.
create view public.clients_safe
with (security_invoker = true) as
select
  id,
  display_code,
  full_name,
  primary_phone,
  email,
  pan_last4,
  case when pan_last4 is not null then 'XXXXXX' || pan_last4 end as pan_masked,
  date_of_birth,
  address_line1,
  address_line2,
  city,
  state,
  pincode,
  kyc_status,
  notes,
  created_by,
  created_at,
  updated_at,
  deleted_at
from public.clients;

-- identity_reviews_completeness: drives the Phase D guardrail that
-- blocks IEPF-5 preparation until every check has been made.
create view public.identity_reviews_completeness
with (security_invoker = true) as
select
  ir.id,
  ir.case_id,
  (ir.pan_name_match <> 'not_checked'
    and ir.cml_name_match <> 'not_checked'
    and ir.certificate_name_match <> 'not_checked'
    and ir.bank_name_match <> 'not_checked'
    and ir.address_mismatch <> 'not_checked'
    and ir.signature_mismatch_risk <> 'unknown') as is_complete,
  (ir.pan_name_match = 'mismatch'
    or ir.cml_name_match = 'mismatch'
    or ir.certificate_name_match = 'mismatch'
    or ir.bank_name_match = 'mismatch'
    or ir.address_mismatch = 'yes'
    or ir.signature_mismatch_risk in ('medium','high')) as has_issues
from public.identity_reviews ir;

-- fee_balances: effective total and balance due, joining the
-- append-only payments ledger (refunds subtract).
create view public.fee_balances
with (security_invoker = true) as
select
  f.id as fee_id,
  f.case_id,
  f.fee_type,
  f.status,
  f.expected_fee,
  f.final_fee,
  coalesce(f.override_total, f.computed_total) as effective_total,
  coalesce(p.net_paid, 0) as payments_received,
  greatest(
    coalesce(coalesce(f.override_total, f.computed_total), 0) - coalesce(p.net_paid, 0),
    0
  ) as balance_fee_due
from public.fees f
left join (
  select
    fee_id,
    sum(case when direction = 'received' then amount else -amount end) as net_paid
  from public.payments
  group by fee_id
) p on p.fee_id = f.id
where f.deleted_at is null;
