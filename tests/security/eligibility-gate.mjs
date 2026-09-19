// K.2.8.9A — Computation eligibility gate security test (LOCAL-ONLY, self-asserting).
//
// Proves, against the live local PostgREST API, that the eligibility boundary
// cannot be bypassed: a real authenticated STAFF token cannot forge profile
// columns, cannot prepare client review / capture approval / finalize while the
// case is ineligible (even by calling the guarded RPCs directly), and that the
// guarded save_taxpayer_profile RPC attributes the actor from auth.uid() and
// writes audit. Eligible cases still progress; blocked attempts leave no writes.
//
// SAFETY: attacks use a real local STAFF token only. The service-role key is
// used ONLY for fixture seeding and forensic reads. Target MUST be local.
//
// Run: node --env-file=.env.local tests/security/eligibility-gate.mjs
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
const svc = (method, path, body, prefer) => http(method, path, { apikey: SERVICE, token: SERVICE, body, prefer });
const rpc = (fn, token, args) => rest("POST", `/rest/v1/rpc/${fn}`, { token, body: args });

async function authPassword(email, password) {
  const res = await fetch(API + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  return j.access_token;
}

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
  const r = await svc("GET", `/rest/v1/audit_logs?case_id=eq.${caseId}&action=eq.${action}&select=id,actor_id`);
  return Array.isArray(r.body) ? r.body : [];
}

async function main() {
  console.log(`Target ${API}\n`);
  const adminU = (await svc("GET", "/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1")).body[0];
  const staffU = (await svc("GET", "/rest/v1/users?role=eq.staff&is_active=eq.true&select=id&limit=1")).body[0];
  const staffTok = await authPassword("staff@e2e.test", "e2e-staff-password");
  if (!staffTok) throw new Error("Could not obtain staff token (run test:e2e:bootstrap).");
  const itrService = (await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")).body[0];

  // Seed a case WITH meaningful data + a complete snapshot but NO taxpayer
  // profile (residential_status/category null) — i.e. INELIGIBLE by profile.
  async function seed(label, { withDob = false } = {}) {
    const rid = crypto.randomUUID().slice(0, 8);
    const client = (await svc("POST", "/rest/v1/clients",
      { full_name: `K289A ${label} ${rid}`, primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10),
        date_of_birth: withDob ? "1990-05-05" : null },
      "return=representation")).body[0];
    const kase = (await svc("POST", "/rest/v1/cases",
      { display_code: `TDX-K289A-${label}-${rid}`, client_id: client.id, service_id: itrService.id,
        title: "ITR", status: "new_lead", owner_id: adminU.id, priority: "normal", service_data: { ay: "2026-27" } },
      "return=representation")).body[0];
    const tc = (await svc("POST", "/rest/v1/tax_cases",
      { case_id: kase.id, client_id: client.id, assessment_year: "2026-27", financial_year: "2025-26",
        itr_type_selected: "ITR-1", itr_type_recommended: "ITR-1" },
      "return=representation")).body[0];
    await svc("POST", "/rest/v1/tax_income_entries",
      { tax_case_id: tc.id, income_head: "salary", amount: 800000, source_type: "Form16",
        created_by: adminU.id, updated_by: adminU.id }, "return=representation");
    const snapId = (await svc("POST", "/rest/v1/tax_computation_snapshots",
      { tax_case_id: tc.id, rules_version: "AY_2026_27_V0_PREP_ONLY",
        input_snapshot: { complete: true, eligibility: { eligible: true }, engineInput: { income: [], taxPaid: [] }, summary: { salary: 800000 } },
        // AUDIT-05-F4: the surcharge backstop now fails CLOSED when a snapshot
        // carries no regime total incomes, so this fixture states them rather
        // than relying on the old fail-open path. ₹7,50,000 is what the ₹8,00,000
        // salary above actually produces after the standard deduction — a
        // realistic figure, comfortably below the ₹50,00,000 gate either way.
        output_snapshot: { computation: { refundOrPayable: { value: -60000 },
          oldRegime: { totalIncome: { value: 750000 } }, newRegime: { totalIncome: { value: 725000 } } } },
        is_final: false, created_by: adminU.id },
      "return=representation")).body[0].id;
    return { clientId: client.id, caseId: kase.id, taxCaseId: tc.id, snapId };
  }

  const c = await seed("MAIN", { withDob: true });

  console.log("[A] Ineligible-by-profile case cannot progress via direct RPC");
  {
    const r = await rpc("prepare_client_review", staffTok, { p_tax_case_id: c.taxCaseId, p_event_id: crypto.randomUUID() });
    const tc = await readRow("tax_cases", c.taxCaseId, "client_review_status,client_review_snapshot_id");
    check("A1 prepare_client_review rejected while ineligible",
      r.status >= 400 && (tc.client_review_status === "not_started" || tc.client_review_status === null) && !tc.client_review_snapshot_id,
      `HTTP ${r.status} status=${tc.client_review_status}`);
    check("A1b rejection names the blocker code", /not eligible/i.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 120));
  }
  {
    const r = await rpc("finalize_tax_case", staffTok,
      { p_tax_case_id: c.taxCaseId, p_snapshot_id: c.snapId, p_note: "attempt to finalize", p_confirm: true, p_event_id: crypto.randomUUID() });
    const tc = await readRow("tax_cases", c.taxCaseId, "finalized_at");
    check("A2 finalize_tax_case rejected while ineligible + no partial write",
      r.status >= 400 && !tc.finalized_at, `HTTP ${r.status}`);
  }

  console.log("\n[B] Staff cannot forge profile columns via direct PostgREST");
  {
    const before = await readRow("tax_cases", c.taxCaseId, "residential_status,taxpayer_category,declared_special_situations");
    const r = await rest("PATCH", `/rest/v1/tax_cases?id=eq.${c.taxCaseId}`,
      { token: staffTok, prefer: "return=representation",
        body: { residential_status: "resident", taxpayer_category: "individual", declared_special_situations: [] } });
    const after = await readRow("tax_cases", c.taxCaseId, "residential_status,taxpayer_category,declared_special_situations");
    check("B1 direct forge of profile columns blocked",
      r.status >= 400 && after.residential_status === before.residential_status && after.taxpayer_category === before.taxpayer_category,
      `HTTP ${r.status} res=${after.residential_status}`);
  }

  console.log("\n[C] save_taxpayer_profile RPC: guarded, attributed, audited");
  {
    const aB = (await countAudit(c.caseId, "taxpayer_profile.updated")).length;
    const evt = crypto.randomUUID();
    const r = await rpc("save_taxpayer_profile", staffTok, {
      p_tax_case_id: c.taxCaseId, p_date_of_birth: "1990-05-05", p_residential_status: "resident",
      p_taxpayer_category: "individual", p_declared_situations: [], p_event_id: evt,
    });
    const audits = await countAudit(c.caseId, "taxpayer_profile.updated");
    const tc = await readRow("tax_cases", c.taxCaseId, "residential_status,taxpayer_category");
    check("C1 save_taxpayer_profile ok + columns set + audit+1",
      r.status < 300 && audits.length - aB === 1 && tc.residential_status === "resident" && tc.taxpayer_category === "individual",
      `HTTP ${r.status} audit+=${audits.length - aB}`);
    check("C2 actor attributed to caller (auth.uid), not a parameter",
      audits.every((a) => a.actor_id === staffU.id));
    // idempotent replay: same event_id → no second audit row
    await rpc("save_taxpayer_profile", staffTok, {
      p_tax_case_id: c.taxCaseId, p_date_of_birth: "1990-05-05", p_residential_status: "resident",
      p_taxpayer_category: "individual", p_declared_situations: [], p_event_id: evt,
    });
    const audits2 = await countAudit(c.caseId, "taxpayer_profile.updated");
    check("C3 profile save idempotent per event_id", audits2.length - aB === 1, `delta=${audits2.length - aB}`);
    check("C4 eligibility unblocked transition audited",
      (await countAudit(c.caseId, "tax_eligibility.unblocked")).length >= 1);
  }

  console.log("\n[D] Now eligible: the supported workflow progresses");
  {
    const r = await rpc("prepare_client_review", staffTok, { p_tax_case_id: c.taxCaseId, p_event_id: crypto.randomUUID() });
    const tc = await readRow("tax_cases", c.taxCaseId, "client_review_status,client_review_snapshot_id");
    check("D1 prepare_client_review succeeds when eligible",
      r.status < 300 && tc.client_review_status === "prepared" && tc.client_review_snapshot_id === c.snapId, `HTTP ${r.status}`);
  }

  console.log("\n[E] Stale-derived: declaring an unsupported situation re-blocks progression");
  {
    // Add a declared special situation → case becomes ineligible again.
    await rpc("save_taxpayer_profile", staffTok, {
      p_tax_case_id: c.taxCaseId, p_date_of_birth: "1990-05-05", p_residential_status: "resident",
      p_taxpayer_category: "individual", p_declared_situations: ["foreign_income_or_assets"], p_event_id: crypto.randomUUID(),
    });
    const cap = await rpc("capture_client_approval", staffTok, {
      p_tax_case_id: c.taxCaseId, p_method: "whatsapp", p_reference: "ref", p_approved_at: null, p_event_id: crypto.randomUUID(),
    });
    const tc = await readRow("tax_cases", c.taxCaseId, "client_review_status");
    check("E1 capture_client_approval rejected after declaring unsupported situation",
      cap.status >= 400 && tc.client_review_status !== "approved", `HTTP ${cap.status} status=${tc.client_review_status}`);
    const fin = await rpc("finalize_tax_case", staffTok,
      { p_tax_case_id: c.taxCaseId, p_snapshot_id: c.snapId, p_note: "attempt", p_confirm: true, p_event_id: crypto.randomUUID() });
    const tc2 = await readRow("tax_cases", c.taxCaseId, "finalized_at");
    check("E2 finalize re-blocked after declared situation", fin.status >= 400 && !tc2.finalized_at, `HTTP ${fin.status}`);
    check("E3 eligibility blocked transition audited",
      (await countAudit(c.caseId, "tax_eligibility.blocked")).length >= 1);
  }

  console.log("\n[F] save_taxpayer_profile is blocked once the case is finalized");
  {
    // Clear the declared situation, finalize legitimately via RPC, then attempt a profile edit.
    await rpc("save_taxpayer_profile", staffTok, {
      p_tax_case_id: c.taxCaseId, p_date_of_birth: "1990-05-05", p_residential_status: "resident",
      p_taxpayer_category: "individual", p_declared_situations: [], p_event_id: crypto.randomUUID(),
    });
    await rpc("finalize_tax_case", staffTok,
      { p_tax_case_id: c.taxCaseId, p_snapshot_id: c.snapId, p_note: "final for profile-lock test", p_confirm: true, p_event_id: crypto.randomUUID() });
    const locked = await readRow("tax_cases", c.taxCaseId, "finalized_at");
    const r = await rpc("save_taxpayer_profile", staffTok, {
      p_tax_case_id: c.taxCaseId, p_date_of_birth: "1985-01-01", p_residential_status: "non_resident",
      p_taxpayer_category: "huf", p_declared_situations: [], p_event_id: crypto.randomUUID(),
    });
    const after = await readRow("tax_cases", c.taxCaseId, "residential_status,taxpayer_category");
    check("F1 profile edit blocked on finalized case",
      !!locked.finalized_at && r.status >= 400 && after.residential_status === "resident" && after.taxpayer_category === "individual",
      `HTTP ${r.status}`);
  }

  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) {
    console.log("FAILURES:\n - " + failures.join("\n - "));
    process.exit(1);
  }
  console.log("ALL ELIGIBILITY-GATE ASSERTIONS PASSED (0 bypasses).");
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
