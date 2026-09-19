# Schema notes (Phase C decisions)

Quick reference for Phase D implementers. Full rationale in the Phase A
spec (+ Appendix C) and `supabase/README.md`.

**PAN.** `clients.pan_encrypted bytea` + `pan_last4`. Encryption is
app-layer AES-256-GCM (`src/lib/crypto/pan.ts`), never SQL. Since 000005,
`authenticated` has NO privilege path to PAN: no SELECT/INSERT/UPDATE on
`pan_encrypted`, no INSERT/UPDATE on `pan_last4` (SELECT kept for search/
mask). Use `clients_safe` for all reads. Phase D contract: normal client
CRUD (session client) writes non-PAN columns only; `setClientPan`
(service role) validates + encrypts + writes both PAN columns atomically
+ audits with masked values; `revealClientPan` is admin-only, audited,
returns the value once.

**PAN transaction rule (binding for Phase D).** Client create/update with
PAN is ONE user-facing operation — the UI must never silently save the
client while dropping the PAN.

*Preferred design — atomic, no compensation needed:* when the form
includes a PAN, the server action (after auth + role check + Zod
validation) encrypts server-side and performs the ENTIRE insert/update as
a SINGLE statement via the service-role client, including `pan_encrypted`
+ `pan_last4`. One statement = one implicit transaction; the row and its
PAN succeed or fail together. Column grants only constrain
`authenticated`, not the service role, so no split write is required.
Audit as `client.created_with_pan` / `client.pan_updated` (masked
values). Without a PAN, the action uses the normal session client.

*Fallback — if any code path ever must split the writes* (e.g. session
insert + later `setClientPan`): on PAN-write failure the action MUST
return `{ ok: true, panSaved: false, panError }`; the UI shows a BLOCKING
warning ("Client saved, PAN NOT saved — retry"), never a plain success;
the failure is audited (`client.pan_write_failed`); retry goes through
`setClientPan`. The client-detail page must visibly flag "PAN pending"
whenever `pan_last4 is null` but staff indicated a PAN exists.

Action result contract:
`{ ok: boolean; clientId?: string; panSaved: boolean; panError?: string }`
— `panSaved` is `true` when no PAN was supplied or the PAN write
succeeded; `false` exclusively signals the compensation path.

**Aadhaar.** No number column anywhere (smoke-tested). Flags only:
`cases.aadhaar_required` (+ mandatory reason, CHECK-enforced),
`uploaded_files.contains_aadhaar`, `early_purge_recommended_at`,
`purged_at`. Partial index `idx_uploaded_files_purge_queue` = the purge
queue. Checklist `aadhaar_card` items exist but `is_required=false` with a
DEFAULT DENY condition note.

**Fees.** `expected_fee`, `final_fee`, `computed_total` are stored
generated columns (single-row math). `balance_fee_due` requires the
payments ledger → view `fee_balances` (`effective_total = coalesce(
override_total, computed_total)`; refunds subtract). Phase D's UI reads
the view; `computeIepfFee()` in `lib/validation/fees.ts` mirrors the math
for client-side display and unit tests — keep them in sync.

**Status flows.** JSONB on `services` (`StatusFlow` type in `types.ts`).
DB does not validate `cases.status` against the flow — the single
choke-point is Phase D's `transitionCase()` server action, which must:
validate legality, require `confirmed_manual_action` for
`filing_confirmation_required` statuses, enforce IEPF
`guards.before_iepf5_preparation` (identity review complete via
`identity_reviews_completeness`, agreements verified, upfront fee
recorded), write `case_status_history`, set default next action, audit.

**Soft delete.** Admin-only on clients/cases/uploaded_files/fees/
physical_documents via trigger `app.enforce_soft_delete_admin()` (checks
`current_user = 'authenticated'` so the service role and psql admins are
exempt). Other tables: staff may soft-delete (client_contacts, followups,
case_documents).

**Append-only.** case_status_history, consent_records, payments,
generated_pdfs, case_messages, audit_logs: no UPDATE/DELETE policies and
privileges revoked. audit_logs additionally: admin-read, service-role
write only — all writes must go through the Phase D `audit()` helper,
which masks sensitive values before insert.

**Display codes.** `display_code` columns are plain unique text; Phase D
generates them (`TDX-C-####`, `TDX-<SVC>-<FY>-####`) in the create server
actions. No DB sequence — avoids gaps/format coupling.

**Upload links.** `token_hash` only (SHA-256 of the raw token). CHECKs:
expiry ≤ created_at + 7 days, max_uploads ≤ 25. Public route (Phase D)
validates token server-side with the service role; there are NO anon
policies and none may be added.
