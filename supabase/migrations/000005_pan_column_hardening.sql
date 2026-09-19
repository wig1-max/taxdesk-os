-- ============================================================
-- TaxDesk OS — 000005 PAN column hardening (Phase C patch)
--
-- Supersedes the write-privilege posture of 000002 for
-- public.clients. 000002 already blocked authenticated SELECT on
-- pan_encrypted; this migration blocks authenticated INSERT and
-- UPDATE on the PAN columns as well.
--
-- PostgreSQL has no "revoke one column" — the clean equivalent is:
-- revoke the table-level privilege, then GRANT an explicit column
-- list that omits the protected columns. That is what this does.
--
-- DESIGN DECISION: pan_last4 is ALSO write-protected (not just
-- pan_encrypted). The two must always be written together by the
-- same code path, or last4 could drift from the ciphertext and the
-- masked UI would silently show the wrong digits. pan_last4 stays
-- SELECTable (search + masked display need it).
--
-- ============================================================
-- INTENDED PAN WRITE/READ PATH (binding for Phase D)
-- ============================================================
-- * Browser-side Supabase calls can NEVER write raw or encrypted
--   PAN: the grants below make it impossible, not just discouraged.
-- * Normal client CRUD (session client, RLS-scoped) writes every
--   clients column EXCEPT pan_encrypted / pan_last4.
-- * PAN create/update goes through ONE dedicated Phase D server
--   action ("setClientPan"):
--     1. authenticate + confirm staff/admin role,
--     2. Zod-validate PAN format server-side,
--     3. encrypt with lib/crypto/pan.ts (AES-256-GCM, node:crypto,
--        key server-side only),
--     4. write pan_encrypted + pan_last4 atomically via the
--        SERVICE ROLE client,
--     5. audit() the action with MASKED values (never the PAN).
-- * PAN reveal ("revealClientPan") is a separate server action:
--   ADMIN-ONLY, reads pan_encrypted via the service role, decrypts
--   server-side, audits the reveal (who/when/why), returns the
--   value once — never cached, never in a list query.
-- * Never decrypt PAN in SQL. No pgcrypto on PAN, ever.
-- ============================================================

-- Remove table-wide write privileges (000002 left these from
-- Supabase's default grants).
revoke insert, update on public.clients from authenticated;

-- Re-grant every column EXCEPT pan_encrypted and pan_last4.
-- (created_at/updated_at excluded too: defaults + trigger own them.)
grant insert (
  id, display_code, full_name, primary_phone, email,
  date_of_birth, address_line1, address_line2, city, state, pincode,
  kyc_status, notes, created_by
) on public.clients to authenticated;

grant update (
  display_code, full_name, primary_phone, email,
  date_of_birth, address_line1, address_line2, city, state, pincode,
  kyc_status, notes,
  deleted_at  -- soft delete/restore; admin-gated by trigger
              -- app.enforce_soft_delete_admin() from 000002
) on public.clients to authenticated;

-- Document intent at the schema level.
comment on column public.clients.pan_encrypted is
  'AES-256-GCM ciphertext written ONLY by the service-role setClientPan server action. No authenticated SELECT/INSERT/UPDATE (column grants, 000005). Never decrypt in SQL. Reveal = admin-only audited server action.';

comment on column public.clients.pan_last4 is
  'Written ONLY together with pan_encrypted by the service-role setClientPan server action (000005) so it cannot drift from the ciphertext. SELECTable for search and masked display (XXXXXX####).';

comment on view public.clients_safe is
  'Read path for client data. Excludes pan_encrypted by construction; exposes pan_last4/pan_masked only. security_invoker: base-table RLS and column grants still apply.';
