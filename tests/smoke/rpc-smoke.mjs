// K.2.8.8B — Guarded-RPC application smoke test (LOCAL-ONLY).
//
// Verifies the guarded write APIs (Migration A) work end-to-end through
// PostgREST and produce the expected audit (+ history) rows, and that ordinary
// staff edits still work. It asserts ONLY legitimate operations — NO hostile /
// enforcement assertions — so it passes both:
//   * with Migration A alone + legacy grants intact (Commit 1), and
//   * with Migration A + Migration B enforcement (Commit 2).
//
// Run: node --env-file=.env.local tests/smoke/rpc-smoke.mjs
// Exit code is non-zero on any failure.
import crypto from "node:crypto";
import fs from "node:fs";

const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321/.test(API)) throw new Error(`Refusing non-local target: ${API}`);

function env(k) {
  if (process.env[k]) return process.env[k];
  const m = fs.readFileSync(".env.local", "utf8").match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}
const ANON = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");

async function http(method, path, { token, apikey, body, prefer } = {}) {
  const headers = { apikey: apikey ?? ANON, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  let json; try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  return { status: res.status, body: json };
}
const svc = (m, p, b, prefer) => http(m, p, { apikey: SERVICE, token: SERVICE, body: b, prefer });
const rest = (m, p, o = {}) => http(m, p, { apikey: ANON, ...o });
const rpc = (fn, token, args) => rest("POST", `/rest/v1/rpc/${fn}`, { token, body: args });
async function svcRep(path, body) {
  return (await svc("POST", path, body, "return=representation")).body[0];
}
async function auth(email, password) {
  const r = await fetch(API + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).access_token;
}

let pass = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}
async function readRow(t, id, cols = "*") {
  const r = await svc("GET", `/rest/v1/${t}?id=eq.${id}&select=${cols}`);
  return Array.isArray(r.body) && r.body[0] ? r.body[0] : null;
}
async function countAudit(caseId, action) {
  const r = await svc("GET", `/rest/v1/audit_logs?case_id=eq.${caseId}&action=eq.${action}&select=id`);
  return Array.isArray(r.body) ? r.body.length : 0;
}
async function countHistory(caseId) {
  const r = await svc("GET", `/rest/v1/case_status_history?case_id=eq.${caseId}&select=id`);
  return Array.isArray(r.body) ? r.body.length : 0;
}

async function main() {
  console.log(`RPC smoke test → ${API}\n`);
  const adminId = (await svc("GET", "/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1")).body[0].id;
  const staffTok = await auth("staff@e2e.test", "e2e-staff-password");
  const adminTok = await auth("admin@e2e.test", "e2e-password");
  if (!staffTok || !adminTok) throw new Error("could not obtain tokens (run test:e2e:bootstrap)");
  const itrId = (await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")).body[0].id;

  async function seed(label) {
    const rid = crypto.randomUUID().slice(0, 8);
    const client = await svcRep("/rest/v1/clients", { full_name: `K288B-smoke ${label} ${rid}`, primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10), date_of_birth: "1990-05-05" });
    const kase = await svcRep("/rest/v1/cases", { display_code: `TDX-K288B-SMOKE-${label}-${rid}`, client_id: client.id, service_id: itrId, title: "ITR", status: "new_lead", owner_id: adminId, priority: "normal", service_data: { ay: "2026-27" } });
    const tc = await svcRep("/rest/v1/tax_cases", { case_id: kase.id, client_id: client.id, assessment_year: "2026-27", financial_year: "2025-26", itr_type_selected: "ITR-1", residential_status: "resident", taxpayer_category: "individual" });
    await svcRep("/rest/v1/tax_income_entries", { tax_case_id: tc.id, income_head: "salary", amount: 800000, source_type: "Form16", created_by: adminId, updated_by: adminId });
    // AUDIT-05-F4: an empty `output_snapshot` now fails CLOSED at the surcharge
    // backstop, so this fixture states regime totals rather than omitting them.
    // ₹0 is the figure CONSISTENT WITH THIS SNAPSHOT — its stored `engineInput`
    // is empty (`income: []`). The ledger row seeded above is deliberately not
    // mirrored here; this is an RPC smoke test, not a computation-fidelity one.
    // ₹0 is far below the ₹50,00,000 gate either way.
    const snap = await svcRep("/rest/v1/tax_computation_snapshots", { tax_case_id: tc.id, rules_version: "AY_2026_27_V0_PREP_ONLY", input_snapshot: { complete: true, engineInput: { income: [], taxPaid: [] } }, output_snapshot: { computation: { oldRegime: { totalIncome: { value: 0 } }, newRegime: { totalIncome: { value: 0 } } } }, is_final: false, created_by: adminId });
    return { clientId: client.id, caseId: kase.id, taxCaseId: tc.id, snapId: snap.id };
  }

  console.log("[ordinary edits]");
  {
    const c = await seed("ORD");
    const r = await rest("POST", "/rest/v1/tax_income_entries", { token: staffTok, prefer: "return=representation", body: { tax_case_id: c.taxCaseId, income_head: "fd_interest", amount: 12000, source_type: "manual" } });
    check("staff ledger insert on non-finalized case", r.status === 201 && !!r.body?.[0]?.id, `HTTP ${r.status}`);
    const r2 = await rest("PATCH", `/rest/v1/clients?id=eq.${c.clientId}`, { token: staffTok, prefer: "return=minimal", body: { notes: "smoke" } });
    check("staff client notes edit", r2.status === 204, `HTTP ${r2.status}`);
  }

  console.log("\n[guarded RPCs produce audit / history]");
  {
    const c = await seed("REV");
    const aB = await countAudit(c.caseId, "tax_client_review.prepared");
    const r = await rpc("prepare_client_review", staffTok, { p_tax_case_id: c.taxCaseId, p_event_id: crypto.randomUUID() });
    const tc = await readRow("tax_cases", c.taxCaseId, "client_review_status");
    check("prepare_client_review ok + audit+1", r.status < 300 && (await countAudit(c.caseId, "tax_client_review.prepared")) - aB === 1 && tc.client_review_status === "prepared", `HTTP ${r.status}`);
  }
  {
    const c = await seed("FIND");
    const f = await svcRep("/rest/v1/tax_validation_findings", { tax_case_id: c.taxCaseId, code: "seed.rule", finding_key: "seed-" + crypto.randomUUID().slice(0, 6), area: "ledger", severity: "warning", title: "S", message: "s", status: "open" });
    const aB = await countAudit(c.caseId, "tax_validation.finding_resolved");
    const r = await rpc("resolve_tax_finding", staffTok, { p_finding_id: f.id, p_note: "resolved via smoke", p_event_id: crypto.randomUUID() });
    check("resolve_tax_finding ok + audit+1", r.status < 300 && (await countAudit(c.caseId, "tax_validation.finding_resolved")) - aB === 1 && (await readRow("tax_validation_findings", f.id, "status")).status === "resolved", `HTTP ${r.status}`);
  }
  {
    const c = await seed("FIN");
    const aB = await countAudit(c.caseId, "tax_case.finalized");
    const r = await rpc("finalize_tax_case", staffTok, { p_tax_case_id: c.taxCaseId, p_snapshot_id: c.snapId, p_note: "final", p_confirm: true, p_event_id: crypto.randomUUID() });
    const tc = await readRow("tax_cases", c.taxCaseId, "finalized_at");
    check("finalize_tax_case ok + audit+1 + locked", r.status < 300 && (await countAudit(c.caseId, "tax_case.finalized")) - aB === 1 && !!tc.finalized_at, `HTTP ${r.status}`);
    // admin reopen
    const rB = await countAudit(c.caseId, "tax_case.reopened");
    const rr = await rpc("reopen_tax_case", adminTok, { p_tax_case_id: c.taxCaseId, p_reason: "smoke reopen", p_confirm: true, p_event_id: crypto.randomUUID() });
    const tc2 = await readRow("tax_cases", c.taxCaseId, "finalized_at,client_review_status");
    check("reopen_tax_case (admin) ok + audit+1 + unlocked", rr.status < 300 && (await countAudit(c.caseId, "tax_case.reopened")) - rB === 1 && !tc2.finalized_at && tc2.client_review_status === "superseded", `HTTP ${rr.status}`);
  }
  {
    const c = await seed("TRN");
    const hB = await countHistory(c.caseId), aB = await countAudit(c.caseId, "case.status_changed");
    const r = await rpc("transition_case_status", staffTok, { p_case_id: c.caseId, p_from_status: "new_lead", p_to_status: "basic_details_pending", p_reason: null, p_confirmed_manual: false, p_next_action: "x", p_next_action_due: null, p_on_hold_reason: null, p_completed: false, p_event_id: crypto.randomUUID() });
    const cs = await readRow("cases", c.caseId, "status");
    check("transition_case_status ok + history+1 + audit+1", r.status < 300 && (await countHistory(c.caseId)) - hB === 1 && (await countAudit(c.caseId, "case.status_changed")) - aB === 1 && cs.status === "basic_details_pending", `HTTP ${r.status}`);
  }

  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  console.log("ALL GUARDED-RPC SMOKE ASSERTIONS PASSED.");
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
