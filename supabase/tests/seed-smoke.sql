-- ============================================================
-- TaxDesk OS — seed smoke tests
-- Run AFTER migrations (and optionally seed.sql):
--   psql "$DATABASE_URL" -f supabase/tests/seed-smoke.sql
-- Read-only; safe anywhere.
-- ============================================================

do $$
declare v_n int;
begin
  -- 8 services
  select count(*) into v_n from public.services;
  if v_n <> 8 then raise exception 'FAIL: expected 8 services, got %', v_n; end if;

  -- every service has a parseable status flow with an initial status
  select count(*) into v_n from public.services
  where status_flow ? 'initial' and jsonb_array_length(status_flow->'statuses') > 0;
  if v_n <> 8 then raise exception 'FAIL: service(s) missing status flow'; end if;

  -- checklists
  select count(*) into v_n from public.document_requirements dr
    join public.services s on s.id = dr.service_id where s.code = 'itr';
  if v_n < 13 then raise exception 'FAIL: ITR checklist has % items (<13)', v_n; end if;

  select count(*) into v_n from public.document_requirements dr
    join public.services s on s.id = dr.service_id where s.code = 'iepf';
  if v_n < 20 then raise exception 'FAIL: IEPF checklist has % items (<20)', v_n; end if;

  select count(*) into v_n from public.document_requirements dr
    join public.services s on s.id = dr.service_id
    where s.code in ('gst','mutual_fund','insurance','loan_dsa');
  if v_n < 18 then raise exception 'FAIL: starter checklists incomplete (%)', v_n; end if;

  -- Aadhaar checklist items must be optional (default-deny policy)
  select count(*) into v_n from public.document_requirements
  where code = 'aadhaar_card' and is_required = true;
  if v_n <> 0 then raise exception 'FAIL: aadhaar_card marked required somewhere'; end if;

  -- 6 PDF templates
  select count(*) into v_n from public.pdf_templates where code in
    ('itr_computation','itr_approval','iepf_visit_checklist',
     'iepf_authorization','iepf_fee_agreement','pending_docs_letter');
  if v_n <> 6 then raise exception 'FAIL: expected 6 pdf templates, got %', v_n; end if;

  -- 11 message templates
  select count(*) into v_n from public.message_templates where code in
    ('welcome','doc_checklist','doc_reminder','computation_approval',
     'iepf_authorization','upfront_fee','filing_done','iepf_srn',
     'objection_update','balance_fee','review_referral');
  if v_n <> 11 then raise exception 'FAIL: expected 11 message templates, got %', v_n; end if;

  -- settings keys
  select count(*) into v_n from public.settings where key in
    ('company_profile','upload_link_defaults','retention_policy','consent_text_versions');
  if v_n <> 4 then raise exception 'FAIL: expected 4 settings keys, got %', v_n; end if;

  -- IEPF default fee config
  if not exists (
    select 1 from public.services
    where code = 'iepf'
      and (default_fee_config->>'percent')::numeric = 15
      and (default_fee_config->>'upfront')::numeric = 5000
  ) then
    raise exception 'FAIL: IEPF default fee config wrong';
  end if;

  -- demo clients (if seed.sql was run) must be obviously synthetic
  select count(*) into v_n from public.clients
  where display_code like 'TDX-C-DEMO%' and notes not ilike '%SYNTHETIC%';
  if v_n <> 0 then raise exception 'FAIL: demo client without SYNTHETIC marker'; end if;

  raise notice 'PASS: all seed smoke checks';
end $$;

-- Idempotency check (manual): re-apply 000004 and re-run seed.sql,
-- then confirm counts are unchanged:
--   select count(*) from public.services;                -- 8
--   select count(*) from public.document_requirements;   -- unchanged
--   select count(*) from public.payments;                -- unchanged (guarded insert)
