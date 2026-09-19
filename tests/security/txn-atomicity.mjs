// K.2.8.8B — Transactional atomicity + concurrency security tests (LOCAL-ONLY).
//
// Proves two invariants the guarded RPCs must hold:
//   T1/T2  An injected audit / history write failure ROLLS BACK the whole
//          protected business transition (fail-closed) — the business row is
//          left unchanged and no partial audit/history remains.
//   T3     A ledger mutation concurrent with a finalization cannot leave a
//          finalized case with a post-finalization edit (the ledger write is
//          serialized by the FOR SHARE lock against finalize's FOR UPDATE).
//   T4     Idempotency binding: replaying an event_id for a DIFFERENT target
//          FAILS (does not silently reuse the earlier result).
//
// SAFETY: local only. Uses a real staff JWT for RPC calls; the service role /
// psql-as-postgres only for fixture seeding, fault injection (temporary poison
// triggers, always cleaned up) and forensic reads. Target MUST be local.
import { execFileSync, spawn } from "node:child_process";
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

// --- PostgREST helpers ---
async function http(method, path, { token, apikey, body } = {}) {
  const headers = { apikey: apikey ?? ANON, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  let json; try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  return { status: res.status, body: json };
}
// service role: apikey AND bearer must both be the service key (PostgREST resolves
// the role from the apikey when both are present).
const svc = (m, p, b) => http(m, p, { apikey: SERVICE, token: SERVICE, body: b });
const rpc = (fn, token, args) => http("POST", `/rest/v1/rpc/${fn}`, { token, body: args });
async function svcRep(path, body) {
  return (await fetch(API + path, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  }).then((r) => r.json()))[0];
}
async function auth(email, password) {
  const r = await fetch(API + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).access_token;
}

// --- psql helpers ---
function psql(sql, { onErrorStop = false } = {}) {
  const args = ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA"];
  if (onErrorStop) args.push("-v", "ON_ERROR_STOP=1");
  args.push("-c", sql);
  return execFileSync("docker", args, { encoding: "utf8" });
}
function psqlSpawn(sql) {
  // background transaction that holds a lock while it sleeps
  const p = spawn("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql],
    { stdio: "ignore" });
  return new Promise((resolve) => p.on("close", (code) => resolve(code)));
}
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// --- assertion harness ---
let pass = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}
const q1 = (sql) => psql(sql).trim();

async function seedReadyCase(label, adminId) {
  const rid = crypto.randomUUID().slice(0, 8);
  const client = await svcRep("/rest/v1/clients", { full_name: `K288B-txn ${label} ${rid}`, primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10), date_of_birth: "1990-05-05" });
  const kase = await svcRep("/rest/v1/cases", { display_code: `TDX-K288B-TXN-${label}-${rid}`, client_id: client.id, service_id: (await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")).body[0].id, title: "ITR", status: "new_lead", owner_id: adminId, priority: "normal", service_data: { ay: "2026-27" } });
  const tc = await svcRep("/rest/v1/tax_cases", { case_id: kase.id, client_id: client.id, assessment_year: "2026-27", financial_year: "2025-26", itr_type_selected: "ITR-1", residential_status: "resident", taxpayer_category: "individual" });
  const inc = await svcRep("/rest/v1/tax_income_entries", { tax_case_id: tc.id, income_head: "salary", amount: 800000, source_type: "Form16", created_by: adminId, updated_by: adminId });
  // AUDIT-05-F4: an empty `output_snapshot` now fails CLOSED at the surcharge
  // backstop (it used to pass because `greatest()` of two NULLs is NULL), so
  // this fixture states regime totals rather than omitting them. ₹0 is the
  // figure CONSISTENT WITH THIS SNAPSHOT: its stored `engineInput` is empty
  // (`income: []`), which is what the snapshot was always claiming. The ledger
  // row above is deliberately NOT reflected here — these suites test RPC
  // atomicity, not computation fidelity, and the snapshot has never mirrored
  // the ledger. Either way ₹0 is far below the ₹50,00,000 gate, so no scenario
  // in this suite changes verdict.
  const snap = await svcRep("/rest/v1/tax_computation_snapshots", { tax_case_id: tc.id, rules_version: "AY_2026_27_V0_PREP_ONLY", input_snapshot: { complete: true, engineInput: { income: [], taxPaid: [] } }, output_snapshot: { computation: { oldRegime: { totalIncome: { value: 0 } }, newRegime: { totalIncome: { value: 0 } } } }, is_final: false, created_by: adminId });
  return { caseId: kase.id, taxCaseId: tc.id, incomeId: inc.id, snapId: snap.id };
}

async function main() {
  const adminId = (await svc("GET", "/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1")).body[0].id;
  const staffId = (await svc("GET", "/rest/v1/users?role=eq.staff&is_active=eq.true&select=id&limit=1")).body[0].id;
  const staffTok = await auth("staff@e2e.test", "e2e-staff-password");
  if (!staffTok) throw new Error("no staff token (run test:e2e:bootstrap)");

  // =====================================================================
  console.log("\n[T1] Injected AUDIT failure rolls back finalize (fail-closed)");
  {
    const c = await seedReadyCase("AUDIT", adminId);
    psql(`create or replace function public.__k288b_poison_audit() returns trigger language plpgsql as $$
          begin if new.action = 'tax_case.finalized' then raise exception 'K288B injected audit failure'; end if; return new; end $$;
          drop trigger if exists __k288b_poison_audit_trg on public.audit_logs;
          create trigger __k288b_poison_audit_trg before insert on public.audit_logs for each row execute function public.__k288b_poison_audit();`);
    let res;
    try {
      res = await rpc("finalize_tax_case", staffTok, { p_tax_case_id: c.taxCaseId, p_snapshot_id: c.snapId, p_note: "x", p_confirm: true, p_event_id: crypto.randomUUID() });
    } finally {
      psql(`drop trigger if exists __k288b_poison_audit_trg on public.audit_logs; drop function if exists public.__k288b_poison_audit();`);
    }
    const finalizedAt = q1(`select coalesce(finalized_at::text,'NULL') from public.tax_cases where id='${c.taxCaseId}';`);
    const auditN = q1(`select count(*) from public.audit_logs where case_id='${c.caseId}' and action='tax_case.finalized';`);
    check("T1 finalize RPC failed (HTTP >=400)", res.status >= 400, `HTTP ${res.status}`);
    check("T1 business state rolled back (finalized_at still NULL)", finalizedAt === "NULL", finalizedAt);
    check("T1 no partial audit row written", auditN === "0", `audit=${auditN}`);
  }

  console.log("\n[T2] Injected HISTORY failure rolls back transition (fail-closed)");
  {
    const c = await seedReadyCase("HIST", adminId);
    psql(`create or replace function public.__k288b_poison_hist() returns trigger language plpgsql as $$
          begin raise exception 'K288B injected history failure'; return new; end $$;
          drop trigger if exists __k288b_poison_hist_trg on public.case_status_history;
          create trigger __k288b_poison_hist_trg before insert on public.case_status_history for each row execute function public.__k288b_poison_hist();`);
    const histBefore = q1(`select count(*) from public.case_status_history where case_id='${c.caseId}';`);
    let res;
    try {
      res = await rpc("transition_case_status", staffTok, { p_case_id: c.caseId, p_from_status: "new_lead", p_to_status: "basic_details_pending", p_reason: null, p_confirmed_manual: false, p_next_action: "x", p_next_action_due: null, p_on_hold_reason: null, p_completed: false, p_event_id: crypto.randomUUID() });
    } finally {
      psql(`drop trigger if exists __k288b_poison_hist_trg on public.case_status_history; drop function if exists public.__k288b_poison_hist();`);
    }
    const status = q1(`select status from public.cases where id='${c.caseId}';`);
    const histAfter = q1(`select count(*) from public.case_status_history where case_id='${c.caseId}';`);
    const auditN = q1(`select count(*) from public.audit_logs where case_id='${c.caseId}' and action='case.status_changed';`);
    check("T2 transition RPC failed (HTTP >=400)", res.status >= 400, `HTTP ${res.status}`);
    check("T2 business state rolled back (status unchanged)", status === "new_lead", status);
    check("T2 no history row written", histAfter === histBefore, `hist ${histBefore}->${histAfter}`);
    check("T2 no partial audit row written", auditN === "0", `audit=${auditN}`);
  }

  console.log("\n[T3] Concurrent finalize vs ledger mutation — no post-finalization edit");
  {
    const c = await seedReadyCase("CONC", adminId);
    // Session A (background): take the tax_cases row write-lock (as finalize's
    // FOR UPDATE does) and hold it while finalizing, then commit after a pause.
    const aDone = psqlSpawn(
      `begin; update public.tax_cases set finalized_at=now(), finalized_by='${adminId}', finalized_snapshot_id='${c.snapId}' where id='${c.taxCaseId}'; select pg_sleep(3); commit;`);
    sleepSync(900); // ensure A holds the lock
    // Session B: staff-context ledger edit. Its finalized-lock trigger takes a
    // FOR SHARE lock on the same row → blocks on A → after A commits, sees the
    // case finalized → raises. B must fail; the ledger row must stay unchanged.
    let bFailed = false, bErr = "";
    try {
      psql(
        `begin; select set_config('request.jwt.claims', '{"sub":"${staffId}","role":"authenticated"}', true); set local role authenticated; update public.tax_income_entries set amount=777 where id='${c.incomeId}'; commit;`,
        { onErrorStop: true });
    } catch (e) { bFailed = true; bErr = String(e.stderr || e.message || ""); }
    await aDone;
    const finalizedAt = q1(`select coalesce(finalized_at::text,'NULL') from public.tax_cases where id='${c.taxCaseId}';`);
    const amount = q1(`select amount::int from public.tax_income_entries where id='${c.incomeId}';`);
    check("T3 finalization committed (precondition)", finalizedAt !== "NULL", finalizedAt);
    check("T3 concurrent ledger edit was rejected", bFailed && /finalized/i.test(bErr), bFailed ? "(finalized-lock)" : "edit succeeded");
    check("T3 no post-finalization edit (ledger amount unchanged = 800000)", amount === "800000", `amount=${amount}`);
  }

  console.log("\n[T4] Idempotency binding — replaying an event_id for a different target FAILS");
  {
    const c1 = await seedReadyCase("IDEM1", adminId);
    const c2 = await seedReadyCase("IDEM2", adminId);
    const evt = crypto.randomUUID();
    const r1 = await rpc("finalize_tax_case", staffTok, { p_tax_case_id: c1.taxCaseId, p_snapshot_id: c1.snapId, p_note: "x", p_confirm: true, p_event_id: evt });
    // same event_id, DIFFERENT target → must be rejected, and must NOT finalize c2
    const r2 = await rpc("finalize_tax_case", staffTok, { p_tax_case_id: c2.taxCaseId, p_snapshot_id: c2.snapId, p_note: "x", p_confirm: true, p_event_id: evt });
    const c1fin = q1(`select coalesce(finalized_at::text,'NULL') from public.tax_cases where id='${c1.taxCaseId}';`);
    const c2fin = q1(`select coalesce(finalized_at::text,'NULL') from public.tax_cases where id='${c2.taxCaseId}';`);
    check("T4 first finalize succeeded", r1.status < 300 && c1fin !== "NULL", `HTTP ${r1.status}`);
    check("T4 replay for a different target REJECTED", r2.status >= 400, `HTTP ${r2.status}`);
    check("T4 second target NOT silently finalized", c2fin === "NULL", c2fin);
    // genuine replay (same target, same event) is still idempotent (no error, no dup)
    const r1b = await rpc("finalize_tax_case", staffTok, { p_tax_case_id: c1.taxCaseId, p_snapshot_id: c1.snapId, p_note: "x", p_confirm: true, p_event_id: evt });
    const c1auditN = q1(`select count(*) from public.audit_logs where case_id='${c1.caseId}' and action='tax_case.finalized';`);
    check("T4 genuine replay stays idempotent (same target, 1 audit row)", r1b.status < 300 && c1auditN === "1", `HTTP ${r1b.status} audit=${c1auditN}`);
  }

  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  console.log("ALL TXN-ATOMICITY & CONCURRENCY ASSERTIONS PASSED.");
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
