-- ============================================================
-- TaxDesk OS — DEV-ONLY synthetic seed. NEVER run in production.
--
-- 100% fake data. Names are obviously synthetic (Testwala/Demo/
-- Sample). PANs use a valid FORMAT but are synthetic; only
-- pan_last4 is seeded — pan_encrypted stays NULL because PAN
-- encryption is app-layer (node:crypto), not SQL.
--
-- Idempotent: re-running updates in place (stable display codes).
--
-- Demo CASES require at least one row in public.users (owner_id is
-- NOT NULL and FKs auth.users). Bootstrap an admin first (see
-- supabase/README.md), then re-run this file to get demo cases.
-- Without a user, only demo clients are seeded and a NOTICE is
-- raised — nothing fails.
-- ============================================================

-- ------------------------------------------------------------
-- Demo clients (synthetic)
-- ------------------------------------------------------------
insert into public.clients
  (display_code, full_name, primary_phone, email, pan_last4, date_of_birth,
   address_line1, city, state, pincode, kyc_status, notes)
values
  ('TDX-C-DEMO1', 'Ramesh Testwala', '9800000001', 'ramesh.testwala@example.com',
   '001T', '1958-04-12', '12 Demo Colony', 'Gurugram', 'Haryana', '134109',
   'done', 'SYNTHETIC DEMO CLIENT — fake PAN format TESTP0001T'),
  ('TDX-C-DEMO2', 'Priya Demo', '9800000002', 'priya.demo@example.com',
   '002D', '1985-09-23', '45 Sample Street', 'Chandigarh', 'Chandigarh', '160017',
   'partial', 'SYNTHETIC DEMO CLIENT — fake PAN format TESTP0002D'),
  ('TDX-C-DEMO3', 'Iqbal Sample', '9800000003', 'iqbal.sample@example.com',
   '003S', '1972-01-30', '7 Placeholder Road', 'Gurugram', 'Haryana', '134112',
   'pending', 'SYNTHETIC DEMO CLIENT — fake PAN format TESTP0003S')
on conflict (display_code) do update
set full_name = excluded.full_name,
    primary_phone = excluded.primary_phone,
    email = excluded.email,
    pan_last4 = excluded.pan_last4,
    notes = excluded.notes;

-- ------------------------------------------------------------
-- Demo cases + related rows (only if a user exists)
-- ------------------------------------------------------------
do $$
declare
  v_owner uuid;
  v_itr uuid;
  v_iepf uuid;
  v_ramesh uuid;
  v_priya uuid;
  v_case_iepf uuid;
  v_case_itr uuid;
  v_fee uuid;
begin
  select id into v_owner from public.users
    where is_active and deleted_at is null
    order by created_at limit 1;

  if v_owner is null then
    raise notice 'seed.sql: no user in public.users yet — skipped demo cases. Bootstrap an admin (see supabase/README.md), then re-run.';
    return;
  end if;

  select id into v_itr from public.services where code = 'itr';
  select id into v_iepf from public.services where code = 'iepf';
  select id into v_ramesh from public.clients where display_code = 'TDX-C-DEMO1';
  select id into v_priya from public.clients where display_code = 'TDX-C-DEMO2';

  -- IEPF demo case for Ramesh Testwala
  insert into public.cases
    (display_code, client_id, service_id, title, status, next_action,
     next_action_due, owner_id, priority, lead_source, service_data)
  values
    ('TDX-IEPF-DEMO1', v_ramesh, v_iepf, 'IEPF claim — Demo Industries Ltd',
     'documents_pending', 'Send visit checklist and upload link',
     current_date + 2, v_owner, 'high', 'referral',
     '{"company":"Demo Industries Ltd","folio":"DEMO0042","shares":150,"note":"synthetic"}'::jsonb)
  on conflict (display_code) do update set updated_at = now()
  returning id into v_case_iepf;

  if v_case_iepf is null then
    select id into v_case_iepf from public.cases where display_code = 'TDX-IEPF-DEMO1';
  end if;

  -- Instantiate the IEPF checklist for the demo case (idempotent)
  insert into public.case_documents (case_id, requirement_id, name, is_required)
  select v_case_iepf, dr.id, dr.name, dr.is_required
  from public.document_requirements dr
  where dr.service_id = v_iepf and dr.is_active
    and not exists (
      select 1 from public.case_documents cd
      where cd.case_id = v_case_iepf and cd.requirement_id = dr.id
    );

  -- Identity review shell (one per IEPF case)
  insert into public.identity_reviews (case_id)
  values (v_case_iepf)
  on conflict (case_id) do nothing;

  -- IEPF fee row: 15% of estimated 2,40,000 = 36,000 expected
  insert into public.fees
    (case_id, fee_type, description, percent, estimated_claim_value,
     upfront_amount, confidence, expected_closure_month, status)
  select v_case_iepf, 'percent_of_recovery', 'IEPF recovery fee (demo)',
         15.00, 240000.00, 5000.00, 'medium',
         date_trunc('month', current_date + interval '8 months')::date, 'agreed'
  where not exists (select 1 from public.fees where case_id = v_case_iepf)
  returning id into v_fee;

  -- Upfront payment received (append-only; guard for idempotency)
  if v_fee is not null then
    insert into public.payments
      (fee_id, case_id, amount, direction, method, reference, paid_on, recorded_by, notes)
    values
      (v_fee, v_case_iepf, 5000.00, 'received', 'upi', 'DEMO-UPI-REF-001',
       current_date - 3, v_owner, 'Demo upfront fee');
  end if;

  -- Physical custody demo: original share certificate in office
  insert into public.physical_documents
    (case_id, name, description, received_date, received_by, storage_location,
     custody_status, return_required, created_by)
  select v_case_iepf, 'Original share certificate — Demo Industries Ltd',
         'SYNTHETIC demo entry', current_date - 3, v_owner,
         'Almirah 1 / File DEMO-01', 'in_custody', true, v_owner
  where not exists (
    select 1 from public.physical_documents
    where case_id = v_case_iepf and name like 'Original share certificate%'
  );

  -- Follow-up
  insert into public.followups (case_id, due_date, note, assigned_to, created_by)
  select v_case_iepf, current_date + 2, 'Call Ramesh ji about pending documents (demo)', v_owner, v_owner
  where not exists (select 1 from public.followups where case_id = v_case_iepf);

  -- ITR demo case for Priya Demo
  insert into public.cases
    (display_code, client_id, service_id, title, status, next_action,
     next_action_due, owner_id, priority, lead_source, service_data)
  values
    ('TDX-ITR-DEMO1', v_priya, v_itr, 'ITR AY 2026-27 (demo)',
     'computation_in_progress', 'Prepare computation summary',
     current_date + 1, v_owner, 'normal', 'existing',
     '{"ay":"2026-27","regime":"new","note":"synthetic"}'::jsonb)
  on conflict (display_code) do update set updated_at = now()
  returning id into v_case_itr;

  if v_case_itr is null then
    select id into v_case_itr from public.cases where display_code = 'TDX-ITR-DEMO1';
  end if;

  insert into public.case_documents (case_id, requirement_id, name, is_required)
  select v_case_itr, dr.id, dr.name, dr.is_required
  from public.document_requirements dr
  where dr.service_id = v_itr and dr.is_active
    and not exists (
      select 1 from public.case_documents cd
      where cd.case_id = v_case_itr and cd.requirement_id = dr.id
    );

  raise notice 'seed.sql: demo cases seeded (owner %)', v_owner;
end $$;
