-- ============================================================
-- TaxDesk OS — TAX-SAFE-03: immutable presumptive-activity snapshot contract
-- and guarded reliance-boundary backstop.
--
-- Additive only. Existing immutable snapshots are never rewritten. A legacy
-- snapshot remains usable when neither it nor the live case contains non-zero
-- presumptive income. If either does, the versioned activity contract must be
-- present, well formed, eligible, internally consistent with the snapshot's
-- engine income, and exactly current against the live ledger rows.
--
-- Enforcement sits below the four existing guarded RPCs as BEFORE triggers on
-- their authoritative state transitions. This preserves their SECURITY
-- DEFINER/app_writer/search_path/auth/idempotency bodies byte-for-byte while
-- ensuring a future body drift cannot bypass the same database backstop:
--   prepare_client_review   -> tax_cases prepared transition
--   create_evidence_manifest -> tax_evidence_manifests insert
--   capture_client_approval -> tax_cases approved transition
--   finalize_tax_case       -> tax_cases finalized transition
-- No client payload supplies an activity verdict or freshness boolean.
-- ============================================================

create or replace function app.tax_case_presumptive_activity_snapshot_blocked(
  p_tax_case_id uuid,
  p_snapshot_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_contract jsonb;
  v_contract_rows jsonb;
  v_snapshot_income jsonb;
  v_snapshot_count integer;
  v_live_count integer;
  v_contract_count integer;
  v_bad_count integer;
begin
  select s.input_snapshot -> 'engineInput' -> 'presumptiveActivityEligibility',
         s.input_snapshot -> 'engineInput' -> 'income'
    into v_contract, v_snapshot_income
    from public.tax_computation_snapshots s
    where s.id = p_snapshot_id
      and s.tax_case_id = p_tax_case_id;

  if not found then
    return 'PRESUMPTIVE_ACTIVITY_SNAPSHOT_MALFORMED';
  end if;

  select count(*)
    into v_snapshot_count
    from jsonb_array_elements(
      case when jsonb_typeof(v_snapshot_income) = 'array'
        then v_snapshot_income else '[]'::jsonb end
    ) entry
    where entry ->> 'category' in (
      'presumptive_professional_44ada',
      'presumptive_business_44ad_digital',
      'presumptive_business_44ad_cash'
    );

  select count(*)
    into v_live_count
    from public.tax_income_entries income
    where income.tax_case_id = p_tax_case_id
      and income.deleted_at is null
      and income.amount <> 0
      and income.income_head in (
        'presumptive_professional_44ada',
        'presumptive_business_44ad_digital',
        'presumptive_business_44ad_cash'
      );

  -- Non-presumptive legacy snapshots are outside this contract and continue
  -- to work. The instant either side contains presumptive income, fail closed.
  if v_snapshot_count = 0 and v_live_count = 0 then
    return null;
  end if;

  if jsonb_typeof(v_contract) <> 'object'
     or v_contract ->> 'version' <> 'TAX_SAFE_03.presumptive_activity_snapshot.v1'
     or v_contract -> 'eligible' is distinct from 'true'::jsonb
     or jsonb_typeof(v_contract -> 'rows') <> 'array' then
    return 'PRESUMPTIVE_ACTIVITY_SNAPSHOT_MALFORMED';
  end if;
  v_contract_rows := v_contract -> 'rows';

  select count(*) into v_contract_count
    from jsonb_array_elements(v_contract_rows);
  if v_contract_count <> v_snapshot_count or v_contract_count <> v_live_count then
    return 'PRESUMPTIVE_ACTIVITY_SNAPSHOT_STALE';
  end if;

  -- Schema, closed vocabulary and scheme eligibility. Only a real JSON boolean
  -- releases the verdict; strings such as "true" fail above.
  select count(*)
    into v_bad_count
    from jsonb_array_elements(v_contract_rows) row_value
    where jsonb_typeof(row_value) <> 'object'
       or jsonb_typeof(row_value -> 'ledgerId') <> 'string'
       or jsonb_typeof(row_value -> 'incomeHead') <> 'string'
       or jsonb_typeof(row_value -> 'amount') <> 'number'
       or jsonb_typeof(row_value -> 'activityType') <> 'string'
       or jsonb_typeof(row_value -> 'bankingChannelsConfirmed') <> 'boolean'
       or row_value ->> 'incomeHead' not in (
         'presumptive_professional_44ada',
         'presumptive_business_44ad_digital',
         'presumptive_business_44ad_cash'
       )
       or row_value ->> 'activityType' not in (
         'specified_profession_44aa_1',
         'commission_or_brokerage',
         'agency_business',
         'goods_carriage_44ae',
         'other_business'
       )
       or (
         row_value ->> 'incomeHead' = 'presumptive_professional_44ada'
         and row_value ->> 'activityType' <> 'specified_profession_44aa_1'
       )
       or (
         row_value ->> 'incomeHead' in (
           'presumptive_business_44ad_digital',
           'presumptive_business_44ad_cash'
         )
         and row_value ->> 'activityType' <> 'other_business'
       );
  if v_bad_count <> 0 then
    return 'PRESUMPTIVE_ACTIVITY_SNAPSHOT_INELIGIBLE';
  end if;

  select count(*) - count(distinct row_value ->> 'ledgerId')
    into v_bad_count
    from jsonb_array_elements(v_contract_rows) row_value;
  if v_bad_count <> 0 then
    return 'PRESUMPTIVE_ACTIVITY_SNAPSHOT_MALFORMED';
  end if;

  -- The contract must describe exactly the presumptive engine rows that were
  -- actually computed by this immutable snapshot.
  select count(*)
    into v_bad_count
    from jsonb_array_elements(v_contract_rows) contract_row
    where not exists (
      select 1
        from jsonb_array_elements(
          case when jsonb_typeof(v_snapshot_income) = 'array'
            then v_snapshot_income else '[]'::jsonb end
        ) engine_row
        where engine_row ->> 'id' = contract_row ->> 'ledgerId'
          and engine_row ->> 'category' = contract_row ->> 'incomeHead'
          and jsonb_typeof(engine_row -> 'amount') = 'number'
          and (engine_row ->> 'amount')::numeric =
              (contract_row ->> 'amount')::numeric
    );
  if v_bad_count <> 0 then
    return 'PRESUMPTIVE_ACTIVITY_SNAPSHOT_MALFORMED';
  end if;

  -- Re-establish freshness from trusted live rows. All load-bearing
  -- presumptive facts are compared; no browser-provided value participates.
  select count(*)
    into v_bad_count
    from jsonb_array_elements(v_contract_rows) contract_row
    where not exists (
      select 1
        from public.tax_income_entries income
        where income.tax_case_id = p_tax_case_id
          and income.deleted_at is null
          and income.amount <> 0
          and income.id::text = contract_row ->> 'ledgerId'
          and income.income_head = contract_row ->> 'incomeHead'
          and income.amount = (contract_row ->> 'amount')::numeric
          and income.presumptive_activity_type =
              contract_row ->> 'activityType'
          and (
            income.income_head <> 'presumptive_professional_44ada'
            or (income.receipts_via_banking_channels is true) =
               ((contract_row ->> 'bankingChannelsConfirmed')::boolean)
          )
    );
  if v_bad_count <> 0 then
    return 'PRESUMPTIVE_ACTIVITY_SNAPSHOT_STALE';
  end if;

  return null;
end;
$function$;

revoke all on function app.tax_case_presumptive_activity_snapshot_blocked(uuid, uuid) from public;
revoke all on function app.tax_case_presumptive_activity_snapshot_blocked(uuid, uuid) from authenticated;
grant execute on function app.tax_case_presumptive_activity_snapshot_blocked(uuid, uuid) to app_writer;

create or replace function app.enforce_tax_case_presumptive_activity_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_blocked text;
  v_snapshot_id uuid;
  v_boundary text;
begin
  if new.finalized_at is not null
     and old.finalized_at is distinct from new.finalized_at then
    v_snapshot_id := new.finalized_snapshot_id;
    v_boundary := 'finalization';
  elsif new.client_review_status = 'approved'
     and (
       old.client_review_status is distinct from new.client_review_status
       or old.client_approved_at is distinct from new.client_approved_at
     ) then
    v_snapshot_id := new.client_review_snapshot_id;
    v_boundary := 'client approval';
  elsif new.client_review_status = 'prepared'
     and (
       old.client_review_status is distinct from new.client_review_status
       or old.client_review_snapshot_id is distinct from
          new.client_review_snapshot_id
     ) then
    v_snapshot_id := new.client_review_snapshot_id;
    v_boundary := 'review preparation';
  else
    return new;
  end if;

  v_blocked := app.tax_case_presumptive_activity_snapshot_blocked(
    new.id,
    v_snapshot_id
  );
  if v_blocked is not null then
    raise exception 'Presumptive activity evidence blocks % (%). Save a fresh complete snapshot after resolving every activity fact.',
      v_boundary, v_blocked using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_tax_case_presumptive_activity_snapshot on public.tax_cases;
create trigger trg_tax_case_presumptive_activity_snapshot
before update on public.tax_cases
for each row execute function app.enforce_tax_case_presumptive_activity_snapshot();

create or replace function app.enforce_manifest_presumptive_activity_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_blocked text;
begin
  v_blocked := app.tax_case_presumptive_activity_snapshot_blocked(
    new.tax_case_id,
    new.computation_snapshot_id
  );
  if v_blocked is not null then
    raise exception 'Presumptive activity evidence blocks manifest creation (%). Save a fresh complete snapshot after resolving every activity fact.',
      v_blocked using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_manifest_presumptive_activity_snapshot on public.tax_evidence_manifests;
create trigger trg_manifest_presumptive_activity_snapshot
before insert on public.tax_evidence_manifests
for each row execute function app.enforce_manifest_presumptive_activity_snapshot();

-- No public RPC body or grant changed. The existing functions remain
-- SECURITY DEFINER, app_writer-owned and search_path-pinned exactly as before.
