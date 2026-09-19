// Phase 8 follow-up (K3-01 residual-risk fix) — STORAGE-ORPHAN RECONCILIATION
// (LOCAL-ONLY, SYNTHETIC DATA ONLY).
//
// The atomic ingestion RPC is transactional but object storage is NOT part of
// that transaction, so the public upload route compensates by removing the
// stored object on an RPC error or a duplicate (route.ts). That compensation is
// best-effort: if the `storage.remove` itself fails (e.g. a transient storage
// outage) after a DB rollback/duplicate, a single UNREFERENCED object can remain
// in the private `case-files` bucket — invisible to the app (no uploaded_files
// row) and harmless to correctness, but worth reconciling before real-client use.
//
// This suite proves the reconciliation CONTRACT that closes that residual risk:
//   O1  DETECTION      — a case-files object with NO uploaded_files row (of any
//       state) is flagged as an orphan; a legit object WITH a row is not.
//   O2  SAFETY WINDOW  — a freshly-created object is NOT flagged while inside the
//       age threshold (so an in-flight upload, stored but pre-RPC-commit, is
//       never mistaken for an orphan and removed).
//   O3  GUARDED REMOVE — reconciling with removal deletes ONLY the aged orphan,
//       writes an audit row, and leaves the referenced control object + its row
//       untouched.
//
// The detection query + guarded-removal procedure are documented for operators in
// docs/backup-restore.md (orphaned storage object reconciliation).
//
// SAFETY: local only. Service role for fixture seeding, storage I/O, and audit.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321/.test(API)) throw new Error(`Refusing non-local target: ${API}`);
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_taxdesk-os";
const BUCKET = "case-files";

function env(k) {
  if (process.env[k]) return process.env[k];
  const m = fs.readFileSync(".env.local", "utf8").match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql], { encoding: "utf8" });
}
const q1 = (sql) => psql(sql).trim();

async function svcRep(path, body) {
  return (await fetch(API + path, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  }).then((r) => r.json()))[0];
}
const svcGet = (path) =>
  fetch(API + path, { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE } }).then((r) => r.json());

// --- storage REST (service role) ---
async function storagePut(objPath, bytes) {
  const res = await fetch(`${API}/storage/v1/object/${BUCKET}/${objPath}`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/pdf", "x-upsert": "true" },
    body: bytes,
  });
  if (!res.ok) throw new Error(`storage put failed ${res.status}: ${await res.text()}`);
}
async function storageRemove(objPath) {
  const res = await fetch(`${API}/storage/v1/object/${BUCKET}/${objPath}`, {
    method: "DELETE",
    headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE },
  });
  return res.ok;
}
const objectExists = (objPath) =>
  q1(`select count(*) from storage.objects where bucket_id='${BUCKET}' and name='${objPath.replace(/'/g, "''")}';`) === "1";

// The authoritative orphan-detection query (also in the runbook). An orphan =
// a case-files object, older than the safety window, whose path is referenced by
// NO uploaded_files row at all (live OR soft-deleted) — precisely the
// compensation-failure leftover. Soft-deleted-but-retained files keep their row,
// so they are never flagged.
function findOrphans(ageMinutes) {
  const out = q1(`
    select o.name from storage.objects o
    where o.bucket_id='${BUCKET}'
      and o.created_at < now() - interval '${Number(ageMinutes)} minutes'
      and not exists (select 1 from public.uploaded_files f where f.storage_path = o.name)
    order by o.created_at;`);
  return out ? out.split("\n").filter(Boolean) : [];
}

// Reference reconciliation implementation: detect aged orphans and, when
// doRemove, delete each object and write ONE audit row per removal (system actor,
// no PII — the path carries only case + random ids).
async function reconcileOrphans({ ageMinutes = 60, doRemove = false } = {}) {
  const orphans = findOrphans(ageMinutes);
  if (!doRemove) return orphans;
  const removed = [];
  for (const name of orphans) {
    if (await storageRemove(name)) {
      const caseId = name.split("/")[1] ?? null; // cases/{caseId}/{uuid}.ext
      await svcRep("/rest/v1/audit_logs", {
        actor_id: null,
        actor_role: "system",
        action: "storage.orphan_reconciled",
        entity_type: "storage.objects",
        entity_id: name,
        case_id: caseId,
        after: { bucket: BUCKET, reason: "unreferenced_object_reconciled" },
      });
      removed.push(name);
    }
  }
  return removed;
}

let pass = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

async function seedCase(label, adminId) {
  const rid = crypto.randomUUID().slice(0, 8);
  const client = await svcRep("/rest/v1/clients", { full_name: `P8-orphan ${label} ${rid}`, primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10), date_of_birth: "1990-05-05" });
  const serviceId = (await svcGet("/rest/v1/services?code=eq.itr&select=id&limit=1"))[0].id;
  const kase = await svcRep("/rest/v1/cases", { display_code: `TDX-P8O-${label}-${rid}`, client_id: client.id, service_id: serviceId, title: "ITR", status: "new_lead", owner_id: adminId, priority: "normal", service_data: { ay: "2026-27" } });
  return { caseId: kase.id, clientId: client.id };
}

async function main() {
  const adminId = (await svcGet("/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1"))[0].id;
  const { caseId } = await seedCase("RECON", adminId);
  const bytes = new Uint8Array(crypto.randomBytes(64));

  // Control: a stored object WITH a live uploaded_files row (a normal upload).
  const controlPath = `cases/${caseId}/${crypto.randomUUID()}.pdf`;
  await storagePut(controlPath, bytes);
  await svcRep("/rest/v1/uploaded_files", {
    case_id: caseId, storage_path: controlPath, original_filename: "control.pdf",
    mime_type: "application/pdf", size_bytes: bytes.length, sha256: crypto.randomBytes(16).toString("hex"),
    uploaded_via: "client_link", contains_aadhaar: false,
  });

  // Orphan: a stored object with NO uploaded_files row (compensation-failure leftover).
  const orphanPath = `cases/${caseId}/${crypto.randomUUID()}.pdf`;
  await storagePut(orphanPath, bytes);

  console.log("\n[O1] Detection — the unreferenced object is an orphan; the referenced one is not");
  {
    const orphans0 = findOrphans(0); // no age gate → fresh objects visible
    check("O1 orphan (no uploaded_files row) is detected", orphans0.includes(orphanPath));
    check("O1 control (has a live row) is NOT flagged", !orphans0.includes(controlPath));
  }

  console.log("\n[O2] Safety window — a fresh object is not flagged inside the age threshold");
  {
    const orphans60 = findOrphans(60); // 60-min window → freshly-created objects excluded
    check("O2 fresh orphan is NOT flagged within the 60-min window", !orphans60.includes(orphanPath),
      `flagged=${orphans60.includes(orphanPath)}`);
  }

  console.log("\n[O3] Guarded removal — only the aged orphan is deleted + audited; control untouched");
  {
    const auditBefore = q1(`select count(*) from public.audit_logs where action='storage.orphan_reconciled' and entity_id='${orphanPath}';`);
    const removed = await reconcileOrphans({ ageMinutes: 0, doRemove: true });
    const auditAfter = q1(`select count(*) from public.audit_logs where action='storage.orphan_reconciled' and entity_id='${orphanPath}';`);
    check("O3 reconcile removed the orphan object", removed.includes(orphanPath) && !objectExists(orphanPath));
    check("O3 one audit row written for the removal", auditBefore === "0" && auditAfter === "1", `before=${auditBefore} after=${auditAfter}`);
    check("O3 control object still present", objectExists(controlPath));
    check("O3 control uploaded_files row untouched",
      q1(`select count(*) from public.uploaded_files where storage_path='${controlPath}' and deleted_at is null;`) === "1");
  }

  // Cleanup (leave the local DB as we found it: no seeded orphans/objects left).
  await storageRemove(controlPath);
  psql(`delete from public.uploaded_files where storage_path='${controlPath}';
        delete from public.audit_logs where action='storage.orphan_reconciled' and entity_id='${orphanPath}';`);

  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  console.log("ALL STORAGE-ORPHAN RECONCILIATION ASSERTIONS PASSED.");
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
