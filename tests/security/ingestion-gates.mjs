// Phase 8 — Ingestion atomicity / idempotency / authorization security tests
// (LOCAL-ONLY, SYNTHETIC DATA ONLY).
//
// Proves the guarded `ingest_client_upload` RPC holds the pre-ingestion gates:
//   I1  PARTIAL FAILURE  — an injected consent/audit write failure ROLLS BACK
//       the whole ingestion (no metadata orphan, quota unchanged, checklist
//       unflipped) → the route then removes the one storage object it wrote.
//   I2  DUPLICATE/REPLAY — the same content for the same item ingests exactly
//       once: replay returns the original file id (is_duplicate=true), no second
//       row, no double quota, no re-flip.
//   I3  QUOTA RACE       — two concurrent uploads at the cap serialize under the
//       FOR UPDATE lock; exactly one succeeds; uploads_used never exceeds max.
//   I4  TOKEN REPLAY     — a revoked / expired / exhausted link is rejected.
//   I5  UNAUTHORIZED     — a checklist item outside the link / from another case
//       is rejected (cross-case guard); never trusts a caller-supplied case.
//   I6  FINALIZED CASE   — ingestion against a finalized tax case is rejected.
//   I7  MIME GUARD       — a disallowed content type is rejected at the DB gate
//       (app-layer sniff/mismatch is covered by ingest-core unit tests).
//
// SAFETY: local only. Service role for fixture seeding, fault injection
// (temporary poison triggers, always cleaned up) and forensic reads.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321/.test(API)) throw new Error(`Refusing non-local target: ${API}`);
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_taxdesk-os";

function env(k) {
  if (process.env[k]) return process.env[k];
  const m = fs.readFileSync(".env.local", "utf8").match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}
const ANON = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");

async function http(method, path, { token, apikey, body } = {}) {
  const headers = { apikey: apikey ?? ANON, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  let json; try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  return { status: res.status, body: json };
}
const svc = (m, p, b) => http(m, p, { apikey: SERVICE, token: SERVICE, body: b });
// service-role RPC: apikey AND bearer both service key.
const svcRpc = (fn, args) => http("POST", `/rest/v1/rpc/${fn}`, { apikey: SERVICE, token: SERVICE, body: args });
async function svcRep(path, body) {
  return (await fetch(API + path, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  }).then((r) => r.json()))[0];
}

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql], { encoding: "utf8" });
}
const q1 = (sql) => psql(sql).trim();

let pass = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// Seed a case + one required checklist item + an upload link that allows it.
async function seedUploadable(label, adminId, { maxUploads = 10, uploadsUsed = 0, finalized = false } = {}) {
  const rid = crypto.randomUUID().slice(0, 8);
  const client = await svcRep("/rest/v1/clients", { full_name: `P8-ingest ${label} ${rid}`, primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10), date_of_birth: "1990-05-05" });
  const kase = await svcRep("/rest/v1/cases", { display_code: `TDX-P8-${label}-${rid}`, client_id: client.id, service_id: (await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")).body[0].id, title: "ITR", status: "new_lead", owner_id: adminId, priority: "normal", service_data: { ay: "2026-27" } });
  const doc = await svcRep("/rest/v1/case_documents", { case_id: kase.id, name: `Bank statement ${rid}`, is_required: true, status: "requested" });
  const link = await svcRep("/rest/v1/upload_links", {
    case_id: kase.id,
    token_hash: crypto.createHash("sha256").update(rid + label).digest("hex"),
    allowed_document_ids: [doc.id],
    expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    max_uploads: maxUploads,
    uploads_used: uploadsUsed,
    created_by: adminId,
  });
  if (finalized) {
    const tc = await svcRep("/rest/v1/tax_cases", { case_id: kase.id, client_id: client.id, assessment_year: "2026-27", financial_year: "2025-26", itr_type_selected: "ITR-1", residential_status: "resident", taxpayer_category: "individual" });
    const snap = await svcRep("/rest/v1/tax_computation_snapshots", { tax_case_id: tc.id, rules_version: "AY_2026_27_V0_PREP_ONLY", input_snapshot: { complete: true }, output_snapshot: {}, is_final: true, created_by: adminId });
    psql(`update public.tax_cases set finalized_at=now(), finalized_by='${adminId}', finalized_snapshot_id='${snap.id}' where id='${tc.id}';`);
  }
  return { caseId: kase.id, clientId: client.id, docId: doc.id, linkId: link.id };
}

const ingestArgs = (f, sha, over = {}) => ({
  p_upload_link_id: f.linkId,
  p_case_document_id: f.docId,
  p_storage_path: `cases/${f.caseId}/${crypto.randomUUID()}.pdf`,
  p_original_filename: "statement.pdf",
  p_mime_type: "application/pdf",
  p_size_bytes: 12345,
  p_sha256: sha,
  p_contains_aadhaar: false,
  p_consent_text_version: "v1",
  p_ip_hash: "iphash",
  p_event_id: crypto.randomUUID(),
  ...over,
});

async function main() {
  const adminId = (await svc("GET", "/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1")).body[0].id;

  console.log("\n[I1] Partial failure (injected consent write error) rolls the whole ingestion back");
  {
    const f = await seedUploadable("PARTIAL", adminId);
    const sha = crypto.randomBytes(16).toString("hex");
    psql(`create or replace function public.__p8_poison_consent() returns trigger language plpgsql as $$
          begin raise exception 'P8 injected consent failure'; return new; end $$;
          drop trigger if exists __p8_poison_consent_trg on public.consent_records;
          create trigger __p8_poison_consent_trg before insert on public.consent_records for each row execute function public.__p8_poison_consent();`);
    let res;
    try { res = await svcRpc("ingest_client_upload", ingestArgs(f, sha)); }
    finally { psql(`drop trigger if exists __p8_poison_consent_trg on public.consent_records; drop function if exists public.__p8_poison_consent();`); }
    const fileN = q1(`select count(*) from public.uploaded_files where case_id='${f.caseId}';`);
    const used = q1(`select uploads_used from public.upload_links where id='${f.linkId}';`);
    const st = q1(`select status from public.case_documents where id='${f.docId}';`);
    check("I1 RPC failed (HTTP >=400)", res.status >= 400, `HTTP ${res.status}`);
    check("I1 no metadata orphan (0 uploaded_files rows)", fileN === "0", `files=${fileN}`);
    check("I1 quota NOT incremented (uploads_used=0)", used === "0", `used=${used}`);
    check("I1 checklist NOT flipped (still requested)", st === "requested", st);
  }

  console.log("\n[I2] Duplicate / replay — same content ingests exactly once");
  {
    const f = await seedUploadable("DUP", adminId);
    const sha = crypto.randomBytes(16).toString("hex");
    const r1 = await svcRpc("ingest_client_upload", ingestArgs(f, sha));
    const r2 = await svcRpc("ingest_client_upload", ingestArgs(f, sha)); // same sha, new event/path
    const id1 = r1.body?.[0]?.file_id, dup1 = r1.body?.[0]?.is_duplicate;
    const id2 = r2.body?.[0]?.file_id, dup2 = r2.body?.[0]?.is_duplicate;
    const fileN = q1(`select count(*) from public.uploaded_files where case_id='${f.caseId}' and deleted_at is null;`);
    const used = q1(`select uploads_used from public.upload_links where id='${f.linkId}';`);
    const auditN = q1(`select count(*) from public.audit_logs where case_id='${f.caseId}' and action='file.uploaded_via_link';`);
    check("I2 first upload succeeded, not a duplicate", r1.status < 300 && dup1 === false && !!id1, `HTTP ${r1.status} dup=${dup1}`);
    check("I2 replay flagged duplicate, same file id", r2.status < 300 && dup2 === true && id2 === id1, `dup=${dup2} id match=${id2 === id1}`);
    check("I2 exactly ONE stored file", fileN === "1", `files=${fileN}`);
    check("I2 quota counted ONCE", used === "1", `used=${used}`);
    check("I2 single audit row (no re-audit on replay)", auditN === "1", `audit=${auditN}`);

    // A one-use link must still acknowledge a safe retry if the first HTTP
    // response was lost. The duplicate lookup intentionally precedes the cap.
    const capped = await seedUploadable("DUPCAP", adminId, { maxUploads: 1 });
    const cappedSha = crypto.randomBytes(16).toString("hex");
    const cappedFirst = await svcRpc("ingest_client_upload", ingestArgs(capped, cappedSha));
    const cappedRetry = await svcRpc("ingest_client_upload", ingestArgs(capped, cappedSha));
    check(
      "I2 exhausted one-use link still acknowledges an idempotent retry",
      cappedFirst.status < 300 && cappedRetry.status < 300 && cappedRetry.body?.[0]?.is_duplicate === true,
      `HTTP ${cappedFirst.status}, ${cappedRetry.status}`,
    );
    check(
      "I2 exhausted retry did not increment quota again",
      q1(`select uploads_used from public.upload_links where id='${capped.linkId}';`) === "1",
    );
  }

  console.log("\n[I3] Quota race — two concurrent uploads at the cap; exactly one wins");
  {
    const f = await seedUploadable("RACE", adminId, { maxUploads: 1, uploadsUsed: 0 });
    const [a, b] = await Promise.all([
      svcRpc("ingest_client_upload", ingestArgs(f, crypto.randomBytes(16).toString("hex"))),
      svcRpc("ingest_client_upload", ingestArgs(f, crypto.randomBytes(16).toString("hex"))),
    ]);
    const okCount = [a, b].filter((r) => r.status < 300).length;
    const used = q1(`select uploads_used from public.upload_links where id='${f.linkId}';`);
    const fileN = q1(`select count(*) from public.uploaded_files where case_id='${f.caseId}';`);
    check("I3 exactly one concurrent upload succeeded", okCount === 1, `ok=${okCount} (${a.status},${b.status})`);
    check("I3 quota never exceeded cap (uploads_used=1, max=1)", used === "1", `used=${used}`);
    check("I3 exactly one file stored", fileN === "1", `files=${fileN}`);
  }

  console.log("\n[I4] Token replay — revoked / expired / exhausted link rejected");
  {
    const rev = await seedUploadable("REVOKED", adminId);
    psql(`update public.upload_links set revoked_at=now() where id='${rev.linkId}';`);
    const rRev = await svcRpc("ingest_client_upload", ingestArgs(rev, crypto.randomBytes(16).toString("hex")));
    const exp = await seedUploadable("EXPIRED", adminId);
    psql(`update public.upload_links set created_at=now() - interval '3 hours', expires_at=now() - interval '1 hour' where id='${exp.linkId}';`);
    const rExp = await svcRpc("ingest_client_upload", ingestArgs(exp, crypto.randomBytes(16).toString("hex")));
    const exh = await seedUploadable("EXHAUSTED", adminId, { maxUploads: 1, uploadsUsed: 1 });
    const rExh = await svcRpc("ingest_client_upload", ingestArgs(exh, crypto.randomBytes(16).toString("hex")));
    check("I4 revoked link rejected", rRev.status >= 400, `HTTP ${rRev.status}`);
    check("I4 expired link rejected", rExp.status >= 400, `HTTP ${rExp.status}`);
    check("I4 exhausted link rejected", rExh.status >= 400, `HTTP ${rExh.status}`);
    check("I4 revoked link created no file", q1(`select count(*) from public.uploaded_files where case_id='${rev.caseId}';`) === "0");
  }

  console.log("\n[I5] Unauthorized — cross-case / not-in-link document rejected");
  {
    const f = await seedUploadable("AUTH", adminId);
    const other = await seedUploadable("OTHER", adminId);
    // (a) a document that belongs to ANOTHER case, not this link
    const rCross = await svcRpc("ingest_client_upload", ingestArgs(f, crypto.randomBytes(16).toString("hex"), { p_case_document_id: other.docId }));
    // (b) forge the allow-list to include a foreign doc → case_documents lookup (case_id match) still rejects
    psql(`update public.upload_links set allowed_document_ids = array_append(allowed_document_ids, '${other.docId}') where id='${f.linkId}';`);
    const rForge = await svcRpc("ingest_client_upload", ingestArgs(f, crypto.randomBytes(16).toString("hex"), { p_case_document_id: other.docId }));
    check("I5 document outside the link rejected", rCross.status >= 400, `HTTP ${rCross.status}`);
    check("I5 cross-case document rejected even if allow-list forged", rForge.status >= 400, `HTTP ${rForge.status}`);
    check("I5 no file written to the foreign case", q1(`select count(*) from public.uploaded_files where case_id='${other.caseId}';`) === "0");
  }

  console.log("\n[I6] Finalized case — ingestion rejected");
  {
    const f = await seedUploadable("FINAL", adminId, { finalized: true });
    const r = await svcRpc("ingest_client_upload", ingestArgs(f, crypto.randomBytes(16).toString("hex")));
    check("I6 ingestion on a finalized case rejected", r.status >= 400, `HTTP ${r.status}`);
    check("I6 no file written to the finalized case", q1(`select count(*) from public.uploaded_files where case_id='${f.caseId}';`) === "0");
  }

  console.log("\n[I7] MIME guard — disallowed content type rejected at the DB gate");
  {
    const f = await seedUploadable("MIME", adminId);
    const r = await svcRpc("ingest_client_upload", ingestArgs(f, crypto.randomBytes(16).toString("hex"), { p_mime_type: "application/x-msdownload" }));
    check("I7 disallowed mime rejected", r.status >= 400, `HTTP ${r.status}`);
    check("I7 no file written for the bad mime", q1(`select count(*) from public.uploaded_files where case_id='${f.caseId}';`) === "0");
  }

  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  console.log("ALL INGESTION-GATE ASSERTIONS PASSED.");
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
