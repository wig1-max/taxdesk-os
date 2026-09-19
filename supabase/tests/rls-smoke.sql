-- ============================================================
-- TaxDesk OS — RLS smoke tests (local/dev only)
-- Run:  psql "$DATABASE_URL" -f supabase/tests/rls-smoke.sql
-- The whole file runs inside one transaction and ROLLS BACK —
-- it leaves no residue. Every check raises an exception on FAIL
-- and a NOTICE on PASS.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. RLS is enabled on every public table
-- ------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(tablename, ', ') into v_bad
  from pg_tables
  where schemaname = 'public' and not rowsecurity;
  if v_bad is not null then
    raise exception 'FAIL: RLS disabled on: %', v_bad;
  end if;
  raise notice 'PASS: RLS enabled on all public tables';
end $$;

-- ------------------------------------------------------------
-- 2. clients_safe does not expose pan_encrypted
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients_safe'
      and column_name = 'pan_encrypted'
  ) then
    raise exception 'FAIL: clients_safe exposes pan_encrypted';
  end if;
  raise notice 'PASS: clients_safe hides pan_encrypted';
end $$;

-- ------------------------------------------------------------
-- 3. authenticated has NO privilege of any kind on the PAN columns
--    (000005): no column grants on pan_encrypted (SELECT/INSERT/
--    UPDATE) or pan_last4 (INSERT/UPDATE), and no table-wide
--    SELECT/INSERT/UPDATE grant on clients that would bypass the
--    column lists.
-- ------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(column_name || ':' || privilege_type, ', ') into v_bad
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'clients'
    and grantee = 'authenticated'
    and (
      (column_name = 'pan_encrypted' and privilege_type in ('SELECT','INSERT','UPDATE'))
      or (column_name = 'pan_last4' and privilege_type in ('INSERT','UPDATE'))
    );
  if v_bad is not null then
    raise exception 'FAIL: PAN column privileges for authenticated: %', v_bad;
  end if;

  select string_agg(privilege_type, ', ') into v_bad
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'clients'
    and grantee = 'authenticated'
    and privilege_type in ('SELECT','INSERT','UPDATE');
  if v_bad is not null then
    raise exception 'FAIL: table-wide grant on clients bypasses PAN column lists: %', v_bad;
  end if;

  raise notice 'PASS: PAN columns locked for authenticated (read + write)';
end $$;

-- ------------------------------------------------------------
-- 4. No Aadhaar-number-like column exists anywhere.
--    Allowed flags only: contains_aadhaar, aadhaar_required,
--    aadhaar_required_reason.
-- ------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(table_name || '.' || column_name, ', ') into v_bad
  from information_schema.columns
  where table_schema = 'public'
    and column_name ilike '%aadhaar%'
    and column_name not in ('contains_aadhaar','aadhaar_required','aadhaar_required_reason');
  if v_bad is not null then
    raise exception 'FAIL: unexpected aadhaar column(s): %', v_bad;
  end if;
  raise notice 'PASS: no Aadhaar number columns (flags only)';
end $$;

-- ------------------------------------------------------------
-- 5. Storage buckets exist and are private
-- ------------------------------------------------------------
do $$
declare v_bad text;
begin
  if (select count(*) from storage.buckets where id in ('case-files','generated-pdfs')) <> 2 then
    raise exception 'FAIL: expected buckets case-files and generated-pdfs';
  end if;
  select string_agg(id, ', ') into v_bad from storage.buckets where public;
  if v_bad is not null then
    raise exception 'FAIL: PUBLIC bucket(s) found: %', v_bad;
  end if;
  raise notice 'PASS: both buckets exist and no bucket is public';
end $$;

-- ------------------------------------------------------------
-- 6. Append-only tables have no UPDATE/DELETE policies
-- ------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(distinct tablename || ':' || cmd, ', ') into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('case_status_history','consent_records','payments',
                      'generated_pdfs','case_messages','audit_logs')
    and cmd in ('UPDATE','DELETE');
  if v_bad is not null then
    raise exception 'FAIL: mutating policies on append-only tables: %', v_bad;
  end if;
  raise notice 'PASS: append-only tables have no UPDATE/DELETE policies';
end $$;

-- ------------------------------------------------------------
-- 7. anon role: zero table privileges in public schema
-- ------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(distinct table_name, ', ') into v_bad
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon';
  if v_bad is not null then
    raise exception 'FAIL: anon has grants on: %', v_bad;
  end if;
  raise notice 'PASS: anon has no grants in public schema';
end $$;

-- ------------------------------------------------------------
-- 8. anon role cannot read business tables (live check)
-- ------------------------------------------------------------
do $$
begin
  set local role anon;
  begin
    perform count(*) from public.clients;
    raise exception 'FAIL: anon selected from clients';
  exception
    when insufficient_privilege then null; -- expected
  end;
  reset role;
  raise notice 'PASS: anon blocked from clients';
end $$;

-- ------------------------------------------------------------
-- 9. Simulated STAFF user: normal work allowed, boundaries hold.
--    Creates a throwaway auth user — rolled back with the txn.
--    (Local dev only; auth.users minimal insert.)
-- ------------------------------------------------------------
do $$
declare v_uid uuid := gen_random_uuid();
declare v_n int;
begin
  insert into auth.users (id, email) values (v_uid, v_uid || '@smoke.test');
  insert into public.users (id, full_name, email, role)
  values (v_uid, 'Smoke Staff', v_uid || '@smoke.test', 'staff');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- staff CAN read clients_safe
  select count(*) into v_n from public.clients_safe;

  -- staff CANNOT see audit logs (RLS filters to zero, no error)
  select count(*) into v_n from public.audit_logs;
  if v_n <> 0 then
    raise exception 'FAIL: staff can read audit_logs rows';
  end if;

  -- staff CANNOT update settings (no policy row matches -> 0 rows)
  update public.settings set value = '{}'::jsonb where key = 'company_profile';
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: staff updated settings';
  end if;

  -- staff CANNOT update append-only payments (privilege revoked)
  begin
    update public.payments set notes = 'x';
    raise exception 'FAIL: staff updated payments';
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- staff CANNOT insert audit_logs directly
  begin
    insert into public.audit_logs (action, entity_type, entity_id)
    values ('x','y','z');
    raise exception 'FAIL: staff inserted into audit_logs';
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- staff CANNOT select pan_encrypted
  begin
    perform pan_encrypted from public.clients limit 1;
    raise exception 'FAIL: staff read pan_encrypted';
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- staff CAN insert a client via the normal (non-PAN) column path
  insert into public.clients (full_name, primary_phone, notes)
  values ('Smoke Insert Client', '9800009999', 'rls-smoke temp row');

  -- staff CAN update normal fields
  update public.clients set notes = 'rls-smoke updated'
  where full_name = 'Smoke Insert Client';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'FAIL: staff could not update normal client fields';
  end if;

  -- staff CANNOT insert pan_encrypted (live check, 000005)
  begin
    insert into public.clients (full_name, primary_phone, pan_encrypted)
    values ('X', '9800009998', '\x00'::bytea);
    raise exception 'FAIL: staff inserted pan_encrypted';
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- staff CANNOT update pan_encrypted (privilege is checked at
  -- plan time, so WHERE false still proves the block)
  begin
    update public.clients set pan_encrypted = '\x00'::bytea where false;
    raise exception 'FAIL: staff updated pan_encrypted';
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- staff CANNOT write pan_last4 either (must never drift from ciphertext)
  begin
    update public.clients set pan_last4 = '9999' where false;
    raise exception 'FAIL: staff updated pan_last4';
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- staff CANNOT soft-delete a client (admin-only trigger, Phase F)
  begin
    update public.clients set deleted_at = now()
    where full_name = 'Smoke Insert Client';
    raise exception 'FAIL: staff soft-deleted a client';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if; -- trigger error expected
  end;

  -- staff CANNOT mutate config tables (services / templates): RLS
  -- matches zero rows, so updates silently affect nothing.
  update public.services set name = name || ' X' where code = 'itr';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL: staff updated services'; end if;

  update public.message_templates set is_active = false where code = 'welcome';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL: staff updated message_templates'; end if;

  update public.pdf_templates set is_active = false where code = 'itr_computation';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL: staff updated pdf_templates'; end if;

  reset role;
  raise notice 'PASS: staff boundaries hold (audit/settings/templates/soft-delete/PAN)';
end $$;

-- ------------------------------------------------------------
-- 10. Storage: no client-facing policies exist on storage.objects.
--     With RLS on and zero policies, anon/authenticated cannot
--     touch objects directly — only server routes (service role)
--     can. Any policy appearing here is a regression.
-- ------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(policyname, ', ') into v_bad
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects';
  if v_bad is not null then
    raise exception 'FAIL: unexpected storage.objects policies: %', v_bad;
  end if;
  raise notice 'PASS: storage.objects has no client-facing policies';
end $$;

-- ------------------------------------------------------------
-- 11. Tax Desk (K.2.1) tables follow the staff/admin access pattern.
--     anon blocked (no grant); active staff can read; inactive users
--     see zero rows (RLS filters via app.current_role()).
-- ------------------------------------------------------------
do $$
declare v_tbl text;
begin
  -- anon cannot read any tax table (privilege denied).
  set local role anon;
  foreach v_tbl in array array[
    'tax_cases','tax_income_entries','tax_tax_paid_entries',
    'tax_deduction_entries','tax_capital_gain_entries',
    'tax_computation_snapshots','tax_validation_findings','tax_readiness_items'
  ] loop
    begin
      execute format('select count(*) from public.%I', v_tbl);
      raise exception 'FAIL: anon selected from %', v_tbl;
    exception
      when insufficient_privilege then null; -- expected
    end;
  end loop;
  reset role;
  raise notice 'PASS: anon blocked from all tax_* tables';
end $$;

do $$
declare v_uid uuid := gen_random_uuid();
declare v_inactive uuid := gen_random_uuid();
declare v_tbl text;
declare v_n int;
begin
  -- Active staff user.
  insert into auth.users (id, email) values (v_uid, v_uid || '@smoke.test');
  insert into public.users (id, full_name, email, role)
  values (v_uid, 'Smoke Tax Staff', v_uid || '@smoke.test', 'staff');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Active staff CAN read every tax table (RLS allows; empty is fine).
  foreach v_tbl in array array[
    'tax_cases','tax_income_entries','tax_tax_paid_entries',
    'tax_deduction_entries','tax_capital_gain_entries',
    'tax_computation_snapshots','tax_validation_findings','tax_readiness_items'
  ] loop
    execute format('select count(*) from public.%I', v_tbl);
  end loop;

  reset role;

  -- Inactive user: RLS must yield zero rows on tax_cases.
  insert into auth.users (id, email) values (v_inactive, v_inactive || '@smoke.test');
  insert into public.users (id, full_name, email, role, is_active)
  values (v_inactive, 'Smoke Inactive', v_inactive || '@smoke.test', 'staff', false);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_inactive, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.tax_cases;
  if v_n <> 0 then
    raise exception 'FAIL: inactive user read tax_cases rows';
  end if;

  reset role;
  raise notice 'PASS: active staff read tax_* tables; inactive user filtered to zero';
end $$;

rollback;
\echo 'RLS smoke tests finished (transaction rolled back — no residue).'
