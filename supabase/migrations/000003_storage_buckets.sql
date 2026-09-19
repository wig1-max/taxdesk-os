-- ============================================================
-- TaxDesk OS — 000003 storage buckets
--
-- Two PRIVATE buckets. No public buckets. No storage.objects
-- policies are created for anon or authenticated: with RLS on and
-- zero policies, direct client access is fully denied. All object
-- reads/writes happen through Phase D server routes using the
-- service role (which validates upload tokens / issues short-lived
-- signed URLs, both audited).
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'case-files',
    'case-files',
    false,
    15728640, -- 15 MB, mirrors uploaded_files CHECK
    array['application/pdf','image/jpeg','image/png','image/webp','image/heic']
  ),
  (
    'generated-pdfs',
    'generated-pdfs',
    false,
    15728640,
    array['application/pdf']
  )
on conflict (id) do update
set
  public = false, -- re-assert privacy even if someone flipped it
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Deliberately NO create policy statements on storage.objects.
-- Do not add permissive storage policies in later migrations.
