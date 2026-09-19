// K.2.8.8B — Authorization-boundary regression test (LOCAL-ONLY, self-asserting).
//
// Proves, against the live local PostgREST API, that the F-001 remediation
// holds: a real authenticated STAFF token (or anon / inactive) cannot bypass
// finalized-locks, admin-only reopen, transition validity, snapshot binding,
// or audit/history — while ordinary staff edits and the guarded RPCs still
// work and every material transition produces audit (+ history where relevant).
//
// SAFETY: attacks use a real local STAFF/inactive/anon token only. The
// service-role key is used ONLY for fixture seeding and forensic reads, never
// for an exploit attempt. Target MUST be local 127.0.0.1:55321.
//
// Run: node --env-file=.env.local tests/security/hostile-postgrest.mjs
// Exit code is non-zero if any assertion fails (CI/regression gate).
import fs from "node:fs";
import crypto from "node:crypto";

const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321/.test(API)) {
  throw new Error(`Refusing non-local target: ${API}`);
}

function envFallback(key) {
  if (process.env[key]) return process.env[key];
  try {
    const env = fs.readFileSync(".env.local", "utf8");
    const m = env.match(new RegExp("^" + key + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}
const ANON = envFallback("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = envFallback("SUPABASE_SERVICE_ROLE_KEY");
if (!ANON || !SERVICE) throw new Error("Missing ANON / SERVICE key in env / .env.local");

async function http(method, path, { token, apikey, body, prefer } = {}) {
  const headers = { apikey: apikey ?? ANON, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch {
    json = txt;
  }
  return { status: res.status, body: json };
}
const rest = (method, path, opts = {}) => http(method, path, { apikey: ANON, ...opts });
const svc = (method, path, body, prefer) =>
  http(method, path, { apikey: SERVICE, token: SERVICE, body, prefer });

async function authPassword(email, password) {
  const res = await fetch(API + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  return j.access_token;
}

// --- assertion harness -------------------------------------------------
let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? " — " + detail : ""}`);
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

async function readRow(table, id, cols = "*") {
  const r = await svc("GET", `/rest/v1/${table}?id=eq.${id}&select=${cols}`);
  return Array.isArray(r.body) && r.body[0] ? r.body[0] : null;
}
async function countAudit(caseId, action) {
  const q = action
    ? `/rest/v1/audit_logs?case_id=eq.${caseId}&action=eq.${action}&select=id`
    : `/rest/v1/audit_logs?case_id=eq.${caseId}&select=id`;
  const r = await svc("GET", q);
  return Array.isArray(r.body) ? r.body.length : 0;
}
async function countHistory(caseId) {
  const r = await svc("GET", `/rest/v1/case_status_history?case_id=eq.${caseId}&select=id`);
  return Array.isArray(r.body) ? r.body.length : 0;
}

// --- ledger coverage for §[B] -------------------------------------------
// AUDIT-03-F1 / MAINT-03: §[B] previously hardcoded `tax_income_entries` in
// all three assertions, so a NEW ledger table could be (and was) created
// without `app.enforce_ledger_finalized_lock()` / `app.set_ledger_actor()`
// and no gate noticed — the finalized-case read-only control
// (`PROJECT_CONSTITUTION.md` §2 rule 8) lives entirely in that trigger,
// because the RLS policies carry no finalized predicate on any ledger.
// B1/B2/B3 now run against EVERY ledger table.
//
// Adding another ledger means adding one entry here. The derived per-table
// trigger assertion in `scripts/deployment-parity-check.mjs` is the other
// half: it fails on any ledger table missing either trigger, without this
// list needing to be kept in sync by hand.
const LEDGER_TABLES = [
  {
    table: "tax_income_entries",
    insert: { income_head: "salary", amount: 999999, source_type: "manual" },
    amend: { amount: 111111 },
  },
  {
    table: "tax_tax_paid_entries",
    insert: { tax_paid_type: "salary_tds", amount: 999999, source_type: "manual" },
    amend: { amount: 111111 },
  },
  {
    table: "tax_deduction_entries",
    insert: { deduction_type: "80C", amount: 999999, source_type: "manual" },
    amend: { amount: 111111 },
  },
  {
    table: "tax_capital_gain_entries",
    insert: {
      gain_type: "stcg_111a", sale_value: 999999, cost: 0, expenses: 0,
      exemption_claimed: 0, taxable_gain: 999999, source_type: "manual",
    },
    amend: { taxable_gain: 111111 },
  },
  {
    table: "tax_house_property_entries",
    insert: {
      usage: "let_out", annual_rent_received: 999999, municipal_taxes_paid: 0,
      home_loan_interest: 0, source_type: "manual",
    },
    amend: { annual_rent_received: 111111 },
  },
  {
    table: "tax_business_books_entries",
    insert: {
      revenue: 999999, expenses: 111111, is_profession: false,
      adjustments: ["none_s30_43d"],
      activity_classification: "ordinary_business_or_profession",
      source_type: "manual",
    },
    amend: { revenue: 111111 },
  },
  // K4-10 (D85 / AUDIT-03-F1). A new ledger table joins this list in the SAME
  // session that creates it. `tax_house_property_entries` did not, and the
  // "a finalized case is read-only" control was absent at the DB layer for that
  // table until MAINT-03 — the most serious gap any audit here has found.
  {
    table: "tax_brought_forward_loss_entries",
    insert: {
      originating_assessment_year: "2022-23", loss_type: "ltcl", amount: 999999,
      filing_eligibility: "verified_timely", loss_provenance: "staff_declared",
      source_type: "manual",
    },
    amend: { amount: 111111 },
  },
];

/** A hostile write must NOT change the target row (403/401, or 2xx/0 rows). */
async function expectBlocked(name, { token, table, rowId, method, path, fields, prefer }) {
  const before = method === "POST" ? null : await readRow(table, rowId);
  const res = await rest(method, path, { token, body: fields, prefer: prefer ?? "return=representation" });
  let changed = false;
  if (method === "POST") {
    changed = res.status === 201 && Array.isArray(res.body) && !!res.body[0]?.id;
    if (changed) await svc("DELETE", `/rest/v1/${table}?id=eq.${res.body[0].id}`); // clean forged row if any
  } else {
    const after = await readRow(table, rowId);
    if (before && after) {
      for (const k of Object.keys(fields || {})) {
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed = true;
      }
    }
  }
  check(name, !changed, changed ? `write took effect (HTTP ${res.status})` : "");
}

async function main() {
  console.log(`Target ${API}\n`);

  const adminU = (await svc("GET", "/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1")).body[0];
  const staffU = (await svc("GET", "/rest/v1/users?role=eq.staff&is_active=eq.true&select=id&limit=1")).body[0];
  const staffTok = await authPassword("staff@e2e.test", "e2e-staff-password");
  const adminTok = await authPassword("admin@e2e.test", "e2e-password");
  if (!staffTok || !adminTok) throw new Error("Could not obtain staff/admin tokens (run test:e2e:bootstrap).");

  // inactive staff (create-if-absent, force inactive)
  let inactiveTok = null;
  try {
    await http("POST", "/auth/v1/admin/users", {
      apikey: SERVICE,
      token: SERVICE,
      body: { email: "inactive-staff@k288b.test", password: "k288b-inactive-pw", email_confirm: true },
    });
    inactiveTok = await authPassword("inactive-staff@k288b.test", "k288b-inactive-pw");
    if (inactiveTok) {
      const sub = JSON.parse(Buffer.from(inactiveTok.split(".")[1], "base64").toString()).sub;
      await svc("POST", "/rest/v1/users",
        { id: sub, email: "inactive-staff@k288b.test", full_name: "Inactive", role: "staff", is_active: false },
        "resolution=merge-duplicates");
      await svc("PATCH", `/rest/v1/users?id=eq.${sub}`, { role: "staff", is_active: false });
    }
  } catch { /* ignore */ }

  const itrService = (await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")).body[0];

  // ---- seed helper: general case + tax_case (+snapshot, +optional finalize) ----
  async function seed({ finalize = false, withSnapshot = false, label }) {
    const rid = crypto.randomUUID().slice(0, 8);
    const client = (await svc("POST", "/rest/v1/clients",
      { full_name: `K288B ${label} ${rid}`, primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10),
        date_of_birth: "1990-05-05" },
      "return=representation")).body[0];
    const kase = (await svc("POST", "/rest/v1/cases",
      { display_code: `TDX-K288B-${label}-${rid}`, client_id: client.id, service_id: itrService.id,
        title: "ITR", status: "new_lead", owner_id: adminU.id, priority: "normal", service_data: { ay: "2026-27" } },
      "return=representation")).body[0];
    const tc = (await svc("POST", "/rest/v1/tax_cases",
      { case_id: kase.id, client_id: client.id, assessment_year: "2026-27", financial_year: "2025-26",
        itr_type_selected: "ITR-1", itr_type_recommended: "ITR-1",
        // Complete taxpayer profile so the case is ELIGIBLE (K.2.8.9A) and the
        // legitimate prepare/finalize RPC flows below still succeed.
        residential_status: "resident", taxpayer_category: "individual" },
      "return=representation")).body[0];
    const inc = (await svc("POST", "/rest/v1/tax_income_entries",
      { tax_case_id: tc.id, income_head: "salary", amount: 800000, source_type: "Form16",
        created_by: adminU.id, updated_by: adminU.id },
      "return=representation")).body[0];
    // One live row per ledger table, so §[B]'s amend/soft-delete attacks have
    // a real target on EVERY ledger (AUDIT-03-F1). Seeded with the service
    // role, which the finalized-lock trigger deliberately trusts, so this
    // still works after the case below is finalized.
    const ledgerIds = {};
    for (const { table, insert } of LEDGER_TABLES) {
      ledgerIds[table] = (await svc("POST", `/rest/v1/${table}`,
        { tax_case_id: tc.id, ...insert, created_by: adminU.id, updated_by: adminU.id },
        "return=representation")).body[0].id;
    }
    let snapId = null;
    if (withSnapshot || finalize) {
      snapId = (await svc("POST", "/rest/v1/tax_computation_snapshots",
        { tax_case_id: tc.id, rules_version: "AY_2026_27_V0_PREP_ONLY",
          input_snapshot: { complete: true, engineInput: { income: [], taxPaid: [] }, summary: { salary: 800000 } },
          // AUDIT-05-F4: regime totals are now REQUIRED by the surcharge
          // backstop (absent fails closed), so this fixture states realistic
          // ones for the ₹8,00,000 salary it seeds. Both are far below the
          // ₹50,00,000 gate, so no scenario in this suite changes verdict.
          output_snapshot: { computation: { refundOrPayable: { value: -60000 },
            oldRegime: { totalIncome: { value: 750000 } }, newRegime: { totalIncome: { value: 725000 } } } },
          is_final: false, created_by: adminU.id },
        "return=representation")).body[0].id;
    }
    if (finalize) {
      await svc("PATCH", `/rest/v1/tax_cases?id=eq.${tc.id}`, {
        client_review_status: "approved", client_review_snapshot_id: snapId,
        client_approved_at: new Date().toISOString(), client_approval_captured_by: adminU.id,
        client_approval_method: "whatsapp", finalized_at: new Date().toISOString(),
        finalized_by: adminU.id, finalized_snapshot_id: snapId, finalization_note: "seed",
      });
    }
    return { clientId: client.id, caseId: kase.id, taxCaseId: tc.id, incomeId: inc.id, ledgerIds, snapId };
  }

  const rpc = (fn, token, args) =>
    rest("POST", `/rest/v1/rpc/${fn}`, { token, body: args });

  const normal = await seed({ withSnapshot: true, label: "NORMAL" });
  const finalized = await seed({ finalize: true, label: "FINAL" });

  // =========================================================================
  console.log("\n[A] Hostile: staff cannot forge protected tax_cases columns");
  await expectBlocked("A1 forge finalized_at", { token: staffTok, table: "tax_cases", rowId: normal.taxCaseId,
    method: "PATCH", path: `/rest/v1/tax_cases?id=eq.${normal.taxCaseId}`,
    fields: { finalized_at: new Date().toISOString(), finalized_by: staffU.id, finalization_note: "forged" } });
  await expectBlocked("A2 forge review approved", { token: staffTok, table: "tax_cases", rowId: normal.taxCaseId,
    method: "PATCH", path: `/rest/v1/tax_cases?id=eq.${normal.taxCaseId}`,
    fields: { client_review_status: "approved", client_approved_at: new Date().toISOString() } });
  await expectBlocked("A3 forge validation freshness", { token: staffTok, table: "tax_cases", rowId: normal.taxCaseId,
    method: "PATCH", path: `/rest/v1/tax_cases?id=eq.${normal.taxCaseId}`,
    fields: { validation_last_run_at: new Date().toISOString() } });
  await expectBlocked("A4 forge itr_type (no ordinary tax_cases UPDATE)", { token: staffTok, table: "tax_cases",
    rowId: normal.taxCaseId, method: "PATCH", path: `/rest/v1/tax_cases?id=eq.${normal.taxCaseId}`,
    fields: { itr_type_selected: "ITR-9" } });

  console.log("\n[B] Hostile: staff cannot mutate a finalized case's ledger (EVERY ledger table)");
  for (const { table, insert, amend } of LEDGER_TABLES) {
    const rowId = finalized.ledgerIds[table];
    await expectBlocked(`B1 insert ledger on finalized — ${table}`, { token: staffTok, table, method: "POST",
      path: `/rest/v1/${table}`,
      fields: { tax_case_id: finalized.taxCaseId, ...insert,
        created_by: staffU.id, updated_by: staffU.id } });
    await expectBlocked(`B2 update ledger on finalized — ${table}`, { token: staffTok, table,
      rowId, method: "PATCH", path: `/rest/v1/${table}?id=eq.${rowId}`,
      fields: amend });
    await expectBlocked(`B3 soft-remove ledger on finalized — ${table}`, { token: staffTok, table,
      rowId, method: "PATCH", path: `/rest/v1/${table}?id=eq.${rowId}`,
      fields: { deleted_at: new Date().toISOString() } });
  }

  console.log("\n[C] Hostile: staff cannot reopen (clear finalization)");
  await expectBlocked("C1 direct clear finalized", { token: staffTok, table: "tax_cases", rowId: finalized.taxCaseId,
    method: "PATCH", path: `/rest/v1/tax_cases?id=eq.${finalized.taxCaseId}`,
    fields: { finalized_at: null, finalized_by: null, finalized_snapshot_id: null,
      reopened_at: new Date().toISOString(), reopened_by: staffU.id, reopen_reason: "forced" } });
  {
    // staff calling the admin-only RPC directly must be rejected (role gate in body)
    const r = await rpc("reopen_tax_case", staffTok,
      { p_tax_case_id: finalized.taxCaseId, p_reason: "x", p_confirm: true, p_event_id: crypto.randomUUID() });
    const still = await readRow("tax_cases", finalized.taxCaseId, "finalized_at");
    check("C2 reopen_tax_case RPC rejects staff", r.status >= 400 && !!still.finalized_at, `HTTP ${r.status}`);
  }

  console.log("\n[D] Hostile: staff cannot forge validation findings");
  const seededFinding = (await svc("POST", "/rest/v1/tax_validation_findings",
    { tax_case_id: normal.taxCaseId, code: "seed.rule", finding_key: "seed-" + crypto.randomUUID().slice(0, 6),
      area: "ledger", severity: "error", title: "Seed", message: "seed", status: "open" },
    "return=representation")).body[0];
  await expectBlocked("D1 resolve finding directly", { token: staffTok, table: "tax_validation_findings",
    rowId: seededFinding.id, method: "PATCH", path: `/rest/v1/tax_validation_findings?id=eq.${seededFinding.id}`,
    fields: { status: "resolved", resolved_at: new Date().toISOString(), resolved_by: staffU.id } });
  await expectBlocked("D2 insert forged resolved finding", { token: staffTok, table: "tax_validation_findings",
    method: "POST", path: `/rest/v1/tax_validation_findings`,
    fields: { tax_case_id: normal.taxCaseId, code: "forged", finding_key: "forged-" + crypto.randomUUID().slice(0, 6),
      area: "ledger", severity: "info", title: "f", message: "f", status: "resolved" } });

  console.log("\n[E] Hostile: staff cannot forge readiness / computation snapshots");
  await expectBlocked("E1 insert passed readiness item", { token: staffTok, table: "tax_readiness_items", method: "POST",
    path: `/rest/v1/tax_readiness_items`,
    fields: { tax_case_id: normal.taxCaseId, code: "computation.snapshot_complete", label: "x",
      category: "computation", status: "passed", is_blocking: true, details: {}, last_checked_at: new Date().toISOString() } });
  await expectBlocked("E2 insert forged complete snapshot", { token: staffTok, table: "tax_computation_snapshots",
    method: "POST", path: `/rest/v1/tax_computation_snapshots`,
    fields: { tax_case_id: normal.taxCaseId, rules_version: "x", input_snapshot: { complete: true },
      output_snapshot: {}, is_final: false, created_by: staffU.id } });

  console.log("\n[F] Hostile: staff cannot forge review lifecycle / [G] direct filed transition");
  await expectBlocked("F1 forge review sent", { token: staffTok, table: "tax_cases", rowId: normal.taxCaseId,
    method: "PATCH", path: `/rest/v1/tax_cases?id=eq.${normal.taxCaseId}`,
    fields: { client_review_status: "sent", client_review_sent_at: new Date().toISOString() } });
  await expectBlocked("G1 direct set cases.status=filed", { token: staffTok, table: "cases", rowId: normal.caseId,
    method: "PATCH", path: `/rest/v1/cases?id=eq.${normal.caseId}`, fields: { status: "filed" } });
  {
    // even via the RPC, jumping straight to filed requires manual confirmation
    const r = await rpc("transition_case_status", staffTok, {
      p_case_id: normal.caseId, p_from_status: "new_lead", p_to_status: "filed", p_reason: "x",
      p_confirmed_manual: false, p_next_action: "x", p_next_action_due: null, p_on_hold_reason: null,
      p_completed: false, p_event_id: crypto.randomUUID(),
    });
    const still = await readRow("cases", normal.caseId, "status");
    check("G2 transition RPC needs manual-filing confirmation", r.status >= 400 && still.status === "new_lead", `HTTP ${r.status}`);
  }

  console.log("\n[H] Hostile: role/security controls hold; [I] anon + inactive denied");
  await expectBlocked("H1 staff self-promote to admin", { token: staffTok, table: "users", rowId: staffU.id,
    method: "PATCH", path: `/rest/v1/users?id=eq.${staffU.id}`, fields: { role: "admin" } });
  await expectBlocked("H2 staff deactivate admin", { token: staffTok, table: "users", rowId: adminU.id,
    method: "PATCH", path: `/rest/v1/users?id=eq.${adminU.id}`, fields: { is_active: false } });
  {
    const r = await rest("PATCH", `/rest/v1/tax_cases?id=eq.${normal.taxCaseId}`,
      { token: null, body: { itr_type_selected: "ITR-9" } });
    check("I1 anon denied", r.status === 401);
  }
  if (inactiveTok) {
    await expectBlocked("I2 inactive staff denied", { token: inactiveTok, table: "tax_cases", rowId: normal.taxCaseId,
      method: "PATCH", path: `/rest/v1/tax_cases?id=eq.${normal.taxCaseId}`, fields: { itr_type_selected: "ITR-9" } });
  }

  // =========================================================================
  console.log("\n[J] Legitimate: ordinary staff edits still work");
  {
    const r = await rest("POST", `/rest/v1/tax_income_entries`, {
      token: staffTok, prefer: "return=representation",
      body: { tax_case_id: normal.taxCaseId, income_head: "fd_interest", amount: 12000, source_type: "manual" },
    });
    check("J1 staff insert ledger on non-finalized case", r.status === 201 && !!r.body?.[0]?.id, `HTTP ${r.status}`);
    // actor forced to the caller by trigger (not the client-supplied value)
    if (r.body?.[0]?.id) {
      const row = await readRow("tax_income_entries", r.body[0].id, "created_by,updated_by");
      check("J1b actor attribution forced to staff", row.created_by === staffU.id && row.updated_by === staffU.id);
    }
  }
  {
    const r = await rest("PATCH", `/rest/v1/clients?id=eq.${normal.clientId}`, {
      token: staffTok, prefer: "return=minimal", body: { notes: "ordinary edit" },
    });
    check("J2 staff edit client notes", r.status === 204);
  }

  console.log("\n[K] Legitimate guarded RPCs succeed AND write audit/history");
  {
    // prepare_client_review on the case with a complete snapshot
    const aB = await countAudit(normal.caseId, "tax_client_review.prepared");
    const r = await rpc("prepare_client_review", staffTok,
      { p_tax_case_id: normal.taxCaseId, p_event_id: crypto.randomUUID() });
    const aA = await countAudit(normal.caseId, "tax_client_review.prepared");
    const tc = await readRow("tax_cases", normal.taxCaseId, "client_review_status");
    check("K1 prepare_client_review ok + audit+1", r.status < 300 && aA - aB === 1 && tc.client_review_status === "prepared",
      `HTTP ${r.status} audit+=${aA - aB} status=${tc.client_review_status}`);
  }
  {
    // resolve the seeded blocking finding through the RPC
    const aB = await countAudit(normal.caseId, "tax_validation.finding_resolved");
    const r = await rpc("resolve_tax_finding", staffTok,
      { p_finding_id: seededFinding.id, p_note: "resolved via rpc", p_event_id: crypto.randomUUID() });
    const aA = await countAudit(normal.caseId, "tax_validation.finding_resolved");
    const f = await readRow("tax_validation_findings", seededFinding.id, "status");
    check("K2 resolve_tax_finding ok + audit+1", r.status < 300 && aA - aB === 1 && f.status === "resolved",
      `HTTP ${r.status} audit+=${aA - aB} status=${f.status}`);
  }
  {
    // finalize the (now unblocked) normal case through the RPC
    const aB = await countAudit(normal.caseId, "tax_case.finalized");
    const evt = crypto.randomUUID();
    const r = await rpc("finalize_tax_case", staffTok,
      { p_tax_case_id: normal.taxCaseId, p_snapshot_id: normal.snapId, p_note: "final", p_confirm: true, p_event_id: evt });
    const aA = await countAudit(normal.caseId, "tax_case.finalized");
    const tc = await readRow("tax_cases", normal.taxCaseId, "finalized_at,finalized_snapshot_id");
    check("K3 finalize_tax_case ok + audit+1 + locked",
      r.status < 300 && aA - aB === 1 && !!tc.finalized_at && tc.finalized_snapshot_id === normal.snapId,
      `HTTP ${r.status} audit+=${aA - aB}`);
    // idempotent replay: same event_id → no second audit row
    await rpc("finalize_tax_case", staffTok,
      { p_tax_case_id: normal.taxCaseId, p_snapshot_id: normal.snapId, p_note: "final", p_confirm: true, p_event_id: evt });
    const aR = await countAudit(normal.caseId, "tax_case.finalized");
    check("K4 finalize is idempotent per event_id", aR - aB === 1, `audit total delta=${aR - aB}`);
  }
  {
    // admin reopen through the guarded RPC
    const aB = await countAudit(normal.caseId, "tax_case.reopened");
    const r = await rpc("reopen_tax_case", adminTok,
      { p_tax_case_id: normal.taxCaseId, p_reason: "admin reopen", p_confirm: true, p_event_id: crypto.randomUUID() });
    const aA = await countAudit(normal.caseId, "tax_case.reopened");
    const tc = await readRow("tax_cases", normal.taxCaseId, "finalized_at,client_review_status");
    check("K5 admin reopen_tax_case ok + audit+1 + unlocked",
      r.status < 300 && aA - aB === 1 && !tc.finalized_at && tc.client_review_status === "superseded",
      `HTTP ${r.status} audit+=${aA - aB}`);
  }
  {
    // legal general-case transition through the RPC writes history + audit
    const hB = await countHistory(normal.caseId);
    const aB = await countAudit(normal.caseId, "case.status_changed");
    const r = await rpc("transition_case_status", staffTok, {
      p_case_id: normal.caseId, p_from_status: "new_lead", p_to_status: "basic_details_pending",
      p_reason: null, p_confirmed_manual: false, p_next_action: "Collect details", p_next_action_due: null,
      p_on_hold_reason: null, p_completed: false, p_event_id: crypto.randomUUID(),
    });
    const hA = await countHistory(normal.caseId);
    const aA = await countAudit(normal.caseId, "case.status_changed");
    const c = await readRow("cases", normal.caseId, "status");
    check("K6 transition_case_status ok + history+1 + audit+1",
      r.status < 300 && hA - hB === 1 && aA - aB === 1 && c.status === "basic_details_pending",
      `HTTP ${r.status} hist+=${hA - hB} audit+=${aA - aB}`);
  }

  // ---- summary ----
  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) {
    console.log("FAILURES:\n - " + failures.join("\n - "));
    process.exit(1);
  }
  console.log("ALL AUTHORIZATION-BOUNDARY ASSERTIONS PASSED (0 bypasses).");
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
