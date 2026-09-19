# TaxDesk OS — Security Review (Phase F)

Reviewed: 2026-07-04 · Reviewer: Phase F pass (code-level). Statuses:
**Pass** / **Needs fix** / **Deferred (reason)**.

| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | Auth | **Pass** | Supabase Auth, invite-only (admin creates users), middleware session gate, `requireUser` checks active profile, sign-in blocks inactive users, sessions in httpOnly cookies. MFA available in Supabase — enable for admin accounts at launch (owner action). |
| 2 | Roles | **Pass** | Two roles; admin gates on settings/audit/purge via `requireAdmin` (server-side) + RLS `app.is_admin()`. Role changes admin-only + audited. |
| 3 | RLS | **Pass** | Enabled on all 22 tables, deny-by-default, zero anon policies/grants, smoke-tested (rls-smoke §1–§10). Append-only tables have no UPDATE/DELETE policies and revoked privileges. |
| 4 | PAN encryption | **Pass** | AES-256-GCM via node:crypto, key server-only; `authenticated` has NO read or write path to `pan_encrypted` and no write to `pan_last4` (000005 column grants); atomic write contract (C6) unit-tested; reveal admin-only + audited; masked everywhere in UI (E2E-asserted). |
| 5 | Aadhaar policy | **Pass** | No number column (SQL-asserted); default-deny uploads enforced in UI, ad-hoc item block, AND server-side re-check in the public route; consent + flag + early-purge queue with typed-confirmation admin purge. |
| 6 | File storage | **Pass** | Two private buckets, no client-facing storage policies (smoke §10), bucket-level size/MIME limits mirror app checks. |
| 7 | Signed URLs | **Pass** | 300s TTL, issued only by session-authenticated routes after RLS row check, every issuance audited, per-user rate cap. No public URLs anywhere. |
| 8 | Upload links | **Pass** | 256-bit tokens, SHA-256 hash at rest, raw shown once; expiry ≤7d + max-use ≤25 (DB CHECKs) + revocation; uniform information-poor errors; magic-byte sniffing; filename sanitized; consent mandatory. |
| 9 | Audit logs | **Pass** | Append-only, admin-read, service-role-write; unconditional deep masking (unit-tested); coverage across all sensitive actions incl. purge. |
| 10 | Service-role usage | **Pass** | Confined to: public upload (post-token-validation), signed URLs, PAN write/reveal, audit writes, purge. Each call site validates permissions itself; `server-only` import guard on admin client and crypto. |
| 11 | Env variables | **Pass** | No secrets in client bundles (`NEXT_PUBLIC_` only for URL + anon key); `.env*` git-ignored; `.env.example` documents ownership of each key. |
| 12 | Dependency risk | **Deferred (monitor)** | `npm audit` clean at review time in sandbox for installed set; full audit must be re-run locally after `npm install` (see README). Boring, mainstream deps only. Re-audit monthly. |
| 13 | Client-side data exposure | **Pass** | Public upload page reveals only allowed pending-document names; dashboards show masked PAN; no `dangerouslySetInnerHTML` anywhere (lint rule `react/no-danger: error`). |
| 14 | Logging | **Pass** | Server logs carry error messages, never PAN/Aadhaar values; audit failure logs are metadata-only. Avoid adding console logging of row payloads in future work. |
| 15 | Error messages | **Pass** | Public routes return uniform 404/410/429 without internals; staff UI shows friendly banners; no stack traces to browsers. |
| 16 | Backup/recovery | **Pass (process)** | Runbook §4 defines DB + storage + key backup and quarterly restore drills. Effectiveness depends on the owner actually doing it — calendar it. |
| 17 | Staff offboarding | **Pass (process)** | Deactivation is instant (is_active + RLS helper); runbook §6 checklist. |
| 18 | Production deployment | **Pass (checklist)** | Runbook §2; separate dev/prod projects, Upstash required, smoke suites pre-launch. |
| 19 | Rate limiting | **Pass with condition** | Distributed via Upstash when configured; degrades to per-instance with a loud warning otherwise. CONDITION: Upstash env vars are mandatory before real launch. |
| 20 | Virus/malware scanning of uploads | **Deferred (v2)** | Magic-byte + MIME + size checks stop disguised executables; files are never executed/served inline (signed URL download only). A scanning step (e.g. ClamAV worker) is a documented residual risk, acceptable for a small office pilot. |
| 21 | PAN key rotation tooling | **Deferred (v2)** | Rotation procedure documented (runbook §5); scripted re-encryption not yet built. Acceptable: single-key custody with password-manager backup. |
| 22 | Session hardening (MFA enforcement) | **Deferred (owner action)** | Enable MFA for admin accounts in Supabase Auth settings at launch. |

**High-risk items open: none.** Items 19's condition and 12's re-run are
launch-gate checks listed in the README pre-launch checklist.
