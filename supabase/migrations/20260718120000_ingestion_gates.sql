-- Remediation Phase 8 — K.3 pre-ingestion gates.
--
-- Makes client-document ingestion ATOMIC and IDEMPOTENT via a single guarded
-- RPC that owns every protected write (metadata + consent + quota + checklist
-- status + audit) in ONE transaction. Before this, the public upload route did
-- five sequential service-role writes with only best-effort compensation, so a
-- mid-sequence failure could leave an orphaned file row, a double-counted
-- quota, or a checklist flipped with no stored document; and a replayed/
-- duplicate upload created a second document, double-counted quota, and
-- re-flipped the checklist.
--
-- Design:
--   * Content-addressed duplicate protection — a partial UNIQUE index on
--     (case_id, case_document_id, sha256) for live rows, plus an in-RPC check,
--     so the same file for the same checklist item is ingested exactly once.
--   * Quota is incremented under a FOR UPDATE lock on the upload_links row, so
--     concurrent uploads near the cap serialize and can never exceed max_uploads.
--   * Finalized-case writes are rejected (the parent case's tax_case is
--     read-only once finalized).
--   * Cross-case / unauthorized targets are rejected (the checklist item must
--     belong to the link's case and be in the link's allowed set).
--   * The whole body is one transaction (plpgsql function) → any raise (incl.
--     an injected trigger failure) rolls the ENTIRE ingestion back: no orphan.
--
-- SYNTHETIC DATA ONLY — real-client ingestion stays gated until this lands.
-- Fully idempotent (create-or-replace / if-not-exists) so it can be applied via
-- `docker exec psql` on hosts where `supabase db reset` wedges.

-- ------------------------------------------------------------
-- 0. Least-privilege table grants the RPC body needs (owner = app_writer).
-- ------------------------------------------------------------
grant select, insert on public.uploaded_files to app_writer;
grant insert on public.consent_records to app_writer;
grant select, update on public.upload_links to app_writer;
grant select, update on public.case_documents to app_writer;

-- ------------------------------------------------------------
-- 1. Content-addressed duplicate backstop. A live (non-deleted) file with the
--    same content for the same checklist item can exist at most once — the
--    concurrency backstop behind the in-RPC dedup check (mirrors how the FOR
--    UPDATE lock backstops the quota check).
-- ------------------------------------------------------------
create unique index if not exists uq_uploaded_files_case_doc_sha
  on public.uploaded_files (case_id, case_document_id, sha256)
  where deleted_at is null and sha256 is not null and case_document_id is not null;

-- ------------------------------------------------------------
-- 2. The guarded ingestion RPC. Returns the file id + whether the call was a
--    (idempotent) duplicate. SECURITY DEFINER so the public upload route can
--    invoke it with the service role; every protected write is inside.
-- ------------------------------------------------------------
create or replace function public.ingest_client_upload(
  p_upload_link_id      uuid,
  p_case_document_id    uuid,
  p_storage_path        text,
  p_original_filename   text,
  p_mime_type           text,
  p_size_bytes          bigint,
  p_sha256              text,
  p_contains_aadhaar    boolean,
  p_consent_text_version text,
  p_ip_hash             text,
  p_event_id            uuid
) returns table (file_id uuid, is_duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link          public.upload_links%rowtype;
  v_case_id       uuid;
  v_client_id     uuid;
  v_doc_name      text;
  v_is_aadhaar    boolean;
  v_aadhaar_req   boolean;
  v_finalized     timestamptz;
  v_existing      uuid;
  v_file_id       uuid;
begin
  -- Input presence.
  if p_event_id is null then
    raise exception 'An event id is required.' using errcode = '22023';
  end if;
  if p_upload_link_id is null or p_case_document_id is null
     or p_storage_path is null or p_sha256 is null then
    raise exception 'Missing required ingestion inputs.' using errcode = '22023';
  end if;
  if p_mime_type not in
     ('application/pdf','image/jpeg','image/png','image/webp','image/heic') then
    raise exception 'Unsupported content type.' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 15728640 then
    raise exception 'File too large.' using errcode = '22023';
  end if;

  -- Lock the link row: serializes concurrent uploads on the same link so the
  -- quota check + increment are atomic (no over-cap race).
  select * into v_link from public.upload_links
    where id = p_upload_link_id
    for update;
  if v_link.id is null then
    raise exception 'Upload link not found.' using errcode = 'P0002';
  end if;

  -- Link must currently be valid (not revoked / expired / exhausted). This is
  -- the token-replay + exhaustion gate, re-checked under the lock.
  if v_link.revoked_at is not null then
    raise exception 'Upload link is no longer active.' using errcode = '42501';
  end if;
  if v_link.expires_at <= now() then
    raise exception 'Upload link is no longer active.' using errcode = '42501';
  end if;
  v_case_id := v_link.case_id;

  -- Target checklist item must belong to THIS link's case and be allowed by the
  -- link (cross-case / unauthorized guard). Never trust the caller's case id.
  if not (p_case_document_id = any (v_link.allowed_document_ids)) then
    raise exception 'Document is not part of this upload link.' using errcode = '42501';
  end if;
  select name into v_doc_name from public.case_documents
    where id = p_case_document_id
      and case_id = v_case_id
      and deleted_at is null;
  if v_doc_name is null then
    raise exception 'Document is not part of this upload link.' using errcode = '42501';
  end if;

  -- Parent case + Aadhaar default-deny.
  select client_id, aadhaar_required into v_client_id, v_aadhaar_req
    from public.cases where id = v_case_id;
  if v_client_id is null then
    raise exception 'Case not found.' using errcode = 'P0002';
  end if;
  v_is_aadhaar := v_doc_name ~* 'aadhaar';
  if v_is_aadhaar and not coalesce(v_aadhaar_req, false) then
    raise exception 'This document type is not enabled for upload.' using errcode = '42501';
  end if;

  -- Finalized-case guard: a finalized tax case is read-only, so no new
  -- documents may be ingested against it.
  select finalized_at into v_finalized
    from public.tax_cases where case_id = v_case_id;
  if v_finalized is not null then
    raise exception 'This case is finalized and cannot accept new documents.'
      using errcode = '42501';
  end if;

  -- Idempotency / duplicate protection (content-addressed): the same file for
  -- the same checklist item is ingested once. A replay returns the original
  -- row and touches NOTHING (no second file, no double quota, no re-flip).
  select id into v_existing from public.uploaded_files
    where case_id = v_case_id
      and case_document_id = p_case_document_id
      and sha256 = p_sha256
      and deleted_at is null
    limit 1;
  if v_existing is not null then
    file_id := v_existing;
    is_duplicate := true;
    return next;
    return;
  end if;

  -- Check exhaustion only after the duplicate lookup. This preserves safe
  -- idempotent retries when a successful one-use upload lost its HTTP response:
  -- the caller gets the original result, but cannot create another file.
  if v_link.uploads_used >= v_link.max_uploads then
    raise exception 'Upload link is no longer active.' using errcode = '42501';
  end if;

  -- Metadata row.
  insert into public.uploaded_files
    (case_id, case_document_id, storage_path, original_filename, mime_type,
     size_bytes, sha256, uploaded_via, upload_link_id, uploaded_by, contains_aadhaar)
  values
    (v_case_id, p_case_document_id, p_storage_path,
     left(coalesce(p_original_filename, 'document'), 255), p_mime_type,
     p_size_bytes, p_sha256, 'client_link', v_link.id, null, v_is_aadhaar)
  returning id into v_file_id;

  -- Consent record (append-only).
  insert into public.consent_records
    (client_id, case_id, upload_link_id, consent_type, purpose,
     consent_text_version, given_via, ip_hash)
  values
    (v_client_id, v_case_id, v_link.id, 'document_upload',
     'Document upload for case processing: ' || v_doc_name,
     coalesce(p_consent_text_version, 'v1'), 'upload_page', p_ip_hash);

  -- Quota counter (atomic under the FOR UPDATE lock taken above).
  update public.upload_links
    set uploads_used = uploads_used + 1
    where id = v_link.id;

  -- Checklist status: only advance an un-collected item to received.
  update public.case_documents
    set status = 'received'
    where id = p_case_document_id
      and status in ('pending','requested','rejected');

  -- Audit (inside the txn: no ingestion without its audit trail, and none left
  -- behind on rollback). event_id makes the audit row unique per logical upload.
  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, ip_hash, event_id)
  values
    (null, 'system', 'file.uploaded_via_link', 'uploaded_files', v_file_id::text, v_case_id,
     jsonb_build_object(
       'document', v_doc_name,
       'mime', p_mime_type,
       'size', p_size_bytes,
       'contains_aadhaar', v_is_aadhaar,
       'upload_link_id', v_link.id),
     p_ip_hash, p_event_id);

  insert into public.audit_logs
    (actor_id, actor_role, action, entity_type, entity_id, case_id, after, ip_hash)
  values
    (null, 'system', 'consent.recorded', 'consent_records', v_file_id::text, v_case_id,
     jsonb_build_object('consent_type', 'document_upload', 'given_via', 'upload_page'),
     p_ip_hash);

  file_id := v_file_id;
  is_duplicate := false;
  return next;
  return;

exception
  -- A genuine concurrent duplicate (two identical files racing past the dedup
  -- SELECT) trips the partial unique index. Resolve it the same way as a serial
  -- duplicate: return the row that won, touch nothing.
  when unique_violation then
    select id into v_existing from public.uploaded_files
      where case_id = v_case_id
        and case_document_id = p_case_document_id
        and sha256 = p_sha256
        and deleted_at is null
      limit 1;
    if v_existing is null then
      raise;
    end if;
    file_id := v_existing;
    is_duplicate := true;
    return next;
    return;
end;
$$;

-- ------------------------------------------------------------
-- 3. Ownership + grants. Owner app_writer (SECURITY DEFINER runs as owner);
--    invokable by the service role (public upload route) and staff.
-- ------------------------------------------------------------
grant create on schema public to app_writer;
do $$
declare
  sig text := 'public.ingest_client_upload(uuid,uuid,text,text,text,bigint,text,boolean,text,text,uuid)';
begin
  execute 'alter function ' || sig || ' owner to app_writer';
  execute 'revoke all on function ' || sig || ' from public';
  execute 'revoke all on function ' || sig || ' from anon';
  execute 'grant execute on function ' || sig || ' to service_role';
  execute 'grant execute on function ' || sig || ' to authenticated';
end $$;
revoke create on schema public from app_writer;
