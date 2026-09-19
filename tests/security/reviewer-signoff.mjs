// K.2.8.9B — Qualified-reviewer sign-off security test (LOCAL-ONLY, self-asserting).
//
// Proves, against the live local PostgREST API, that the manual-review sign-off
// boundary cannot be bypassed: only an ACTIVE qualified reviewer can sign off,
// a reviewer cannot sign off on a case they prepared (separation of duties),
// a return requires a reason, a case that does not require review cannot be
// signed off, credential management is admin-only, credential-sensitive fields
// are never exposed to ordinary staff, the sign-off ledger is append-only, the
// manual-review columns are protected, and a completed sign-off keeps its
// qualification snapshot after the credential is revoked.
//
// SAFETY: attacks use real local STAFF/ADMIN tokens only. The service-role key
// is used ONLY for fixture seeding and forensic reads. Target MUST be local.
//
// Run: node --env-file=.env.local tests/security/reviewer-signoff.mjs
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
  const adminTok = await authPassword("admin@e2e.test", "e2e-password");
  if (!staffTok || !adminTok) throw new Error("Could not obtain tokens (run test:e2e:bootstrap).");
  const itrService = (await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")).body[0];

  // Seed a case. `preparer` sets assigned_staff_id + the snapshot created_by.
  // `declared` (default a special situation) makes it require manual review;
  // pass declared:[] for a supported case that needs NO review.
  async function seed(label, { declared = ["foreign_income_or_assets"], preparer = adminU.id, resStatus = "resident" } = {}) {
    const rid = crypto.randomUUID().slice(0, 8);
    const client = (await svc("POST", "/rest/v1/clients",
      { full_name: `K289B ${label} ${rid}`, primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10),
        date_of_birth: "1990-05-05" }, "return=representation")).body[0];
    const kase = (await svc("POST", "/rest/v1/cases",
      { display_code: `TDX-K289B-${label}-${rid}`, client_id: client.id, service_id: itrService.id,
        title: "ITR", status: "new_lead", owner_id: adminU.id, priority: "normal", service_data: { ay: "2026-27" } },
      "return=representation")).body[0];
    const tc = (await svc("POST", "/rest/v1/tax_cases",
      { case_id: kase.id, client_id: client.id, assessment_year: "2026-27", financial_year: "2025-26",
        itr_type_selected: "ITR-1", residential_status: resStatus, taxpayer_category: "individual",
        declared_special_situations: declared, assigned_staff_id: preparer,
        taxpayer_profile_updated_by: preparer },
      "return=representation")).body[0];
    const snapId = (await svc("POST", "/rest/v1/tax_computation_snapshots",
      { tax_case_id: tc.id, rules_version: "AY_2026_27_V0_PREP_ONLY",
        input_snapshot: { complete: true, engineInput: {}, summary: {} },
        output_snapshot: { computation: {} }, is_final: false, created_by: preparer },
      "return=representation")).body[0].id;
    return { clientId: client.id, caseId: kase.id, taxCaseId: tc.id, snapId };
  }

  // Clean slate: ensure staff has NO credential at the start.
  await svc("DELETE", `/rest/v1/tax_reviewer_credentials?user_id=eq.${staffU.id}`);

  console.log("[A] A non-qualified staff member cannot sign off");
  const a = await seed("A");
  {
    const r = await rpc("record_reviewer_signoff", staffTok,
      { p_tax_case_id: a.taxCaseId, p_decision: "approved_for_progression", p_reason: null, p_event_id: crypto.randomUUID() });
    const tc = await readRow("tax_cases", a.taxCaseId, "manual_review_status");
    check("A1 signoff rejected for a non-qualified reviewer",
      r.status >= 400 && tc.manual_review_status === "none", `HTTP ${r.status} status=${tc.manual_review_status}`);
    check("A1b no review row written", (await svc("GET", `/rest/v1/tax_case_reviews?tax_case_id=eq.${a.taxCaseId}&select=id`)).body.length === 0);
  }

  console.log("\n[B] Credential management is admin-only + audited");
  {
    // Staff cannot create a credential.
    const rs = await rpc("upsert_reviewer_credential", staffTok,
      { p_user_id: staffU.id, p_qualification: "chartered_accountant", p_reference: "CA-STAFF", p_notes: null, p_event_id: crypto.randomUUID() });
    check("B1 staff cannot create a reviewer credential", rs.status >= 400, `HTTP ${rs.status}`);
    const none = (await svc("GET", `/rest/v1/tax_reviewer_credentials?user_id=eq.${staffU.id}&select=id`)).body;
    check("B1b no credential created by staff", none.length === 0);

    // Admin creates the staff reviewer credential.
    const ra = await rpc("upsert_reviewer_credential", adminTok,
      { p_user_id: staffU.id, p_qualification: "chartered_accountant", p_reference: "CA-123456", p_notes: null, p_event_id: crypto.randomUUID() });
    const cred = (await svc("GET", `/rest/v1/tax_reviewer_credentials?user_id=eq.${staffU.id}&select=id,status,credential_reference`)).body[0];
    check("B2 admin creates an active credential", ra.status < 300 && cred && cred.status === "active" && cred.credential_reference === "CA-123456", `HTTP ${ra.status}`);
    const savedAudit = await svc("GET", `/rest/v1/audit_logs?action=eq.tax_reviewer_credential.saved&entity_id=eq.${cred.id}&select=id,actor_id`);
    check("B2b credential save audited to the admin actor", savedAudit.body.length >= 1 && savedAudit.body.every((x) => x.actor_id === adminU.id));
  }

  console.log("\n[C] Credential-sensitive fields are hidden from ordinary staff");
  {
    // Staff read of the base table returns nothing (admin-only RLS).
    const base = await rest("GET", "/rest/v1/tax_reviewer_credentials?select=id,credential_reference", { token: staffTok });
    check("C1 staff base-table read exposes no credential rows", Array.isArray(base.body) && base.body.length === 0, JSON.stringify(base.body).slice(0, 80));
    // The curated view is readable but has NO reference column.
    const view = await rest("GET", `/rest/v1/qualified_reviewers?user_id=eq.${staffU.id}&select=*`, { token: staffTok });
    const row = Array.isArray(view.body) ? view.body[0] : null;
    check("C2 qualified_reviewers view is staff-readable and reference-free",
      !!row && !("credential_reference" in row) && !("reviewer_credential_reference_snapshot" in row),
      row ? Object.keys(row).join(",") : "no row");
  }

  console.log("\n[D] Self-review prevention (separation of duties)");
  {
    const d = await seed("D", { preparer: staffU.id }); // staff prepared it
    const r = await rpc("record_reviewer_signoff", staffTok,
      { p_tax_case_id: d.taxCaseId, p_decision: "approved_for_progression", p_reason: null, p_event_id: crypto.randomUUID() });
    const tc = await readRow("tax_cases", d.taxCaseId, "manual_review_status");
    check("D1 a reviewer cannot sign off on a case they prepared",
      r.status >= 400 && /separation of duties|they prepared/i.test(JSON.stringify(r.body)) && tc.manual_review_status === "none",
      `HTTP ${r.status}`);
  }

  console.log("\n[E] A case that does NOT require review cannot be signed off");
  {
    const e = await seed("E", { declared: [] }); // supported resident individual
    const r = await rpc("record_reviewer_signoff", staffTok,
      { p_tax_case_id: e.taxCaseId, p_decision: "approved_for_progression", p_reason: null, p_event_id: crypto.randomUUID() });
    check("E1 signoff rejected when review is not required", r.status >= 400 && /not require manual/i.test(JSON.stringify(r.body)), `HTTP ${r.status}`);
  }

  console.log("\n[F] Return-for-changes requires a reason; approve succeeds + is audited/immutable");
  let approved;
  {
    const f = await seed("F"); // prepared by admin → staff may review
    const noReason = await rpc("record_reviewer_signoff", staffTok,
      { p_tax_case_id: f.taxCaseId, p_decision: "returned_for_changes", p_reason: "   ", p_event_id: crypto.randomUUID() });
    check("F1 return without a reason is rejected", noReason.status >= 400 && /reason is required/i.test(JSON.stringify(noReason.body)), `HTTP ${noReason.status}`);

    const ret = await rpc("record_reviewer_signoff", staffTok,
      { p_tax_case_id: f.taxCaseId, p_decision: "returned_for_changes", p_reason: "Confirm the foreign-asset schedule.", p_event_id: crypto.randomUUID() });
    const tc1 = await readRow("tax_cases", f.taxCaseId, "manual_review_status,manual_review_id");
    check("F2 return-for-changes recorded", ret.status < 300 && tc1.manual_review_status === "changes_requested" && !!tc1.manual_review_id, `HTTP ${ret.status}`);

    // A returned case can be re-decided → approve.
    const evt = crypto.randomUUID();
    const app = await rpc("record_reviewer_signoff", staffTok,
      { p_tax_case_id: f.taxCaseId, p_decision: "approved_for_progression", p_reason: "Reviewed; approved for manual handling.", p_event_id: evt });
    const tc2 = await readRow("tax_cases", f.taxCaseId, "manual_review_status,manual_review_reviewer_id");
    check("F3 approve-for-progression recorded + reviewer attributed",
      app.status < 300 && tc2.manual_review_status === "approved" && tc2.manual_review_reviewer_id === staffU.id, `HTTP ${app.status}`);
    check("F3b approved sign-off audited", (await countAudit(f.caseId, "tax_manual_review.approved")).length >= 1);

    // Idempotent replay of the SAME approve event → no duplicate.
    await rpc("record_reviewer_signoff", staffTok,
      { p_tax_case_id: f.taxCaseId, p_decision: "approved_for_progression", p_reason: "dup", p_event_id: evt });
    const rows = (await svc("GET", `/rest/v1/tax_case_reviews?tax_case_id=eq.${f.taxCaseId}&decision=eq.approved_for_progression&select=id`)).body;
    check("F4 approve is idempotent per event_id", rows.length === 1, `rows=${rows.length}`);

    // Re-deciding an already-approved case is rejected (terminal).
    const again = await rpc("record_reviewer_signoff", staffTok,
      { p_tax_case_id: f.taxCaseId, p_decision: "returned_for_changes", p_reason: "late change", p_event_id: crypto.randomUUID() });
    check("F5 cannot re-decide an already-approved case", again.status >= 400 && /already/i.test(JSON.stringify(again.body)), `HTTP ${again.status}`);
    approved = f;
  }

  console.log("\n[G] Sign-off ledger + manual-review columns are immutable to direct writes");
  {
    // Direct DELETE/PATCH on the append-only ledger via staff token → blocked.
    const reviewRow = (await svc("GET", `/rest/v1/tax_case_reviews?tax_case_id=eq.${approved.taxCaseId}&select=id,decision&limit=1`)).body[0];
    const originalDecision = reviewRow.decision;
    const forgedDecision = originalDecision === "approved_for_progression" ? "returned_for_changes" : "approved_for_progression";
    const del = await rest("DELETE", `/rest/v1/tax_case_reviews?id=eq.${reviewRow.id}`, { token: staffTok, prefer: "return=representation" });
    const patch = await rest("PATCH", `/rest/v1/tax_case_reviews?id=eq.${reviewRow.id}`, { token: staffTok, prefer: "return=representation", body: { decision: forgedDecision } });
    const stillThere = await readRow("tax_case_reviews", reviewRow.id, "decision");
    check("G1 append-only sign-off ledger resists direct delete/patch",
      del.status >= 400 && patch.status >= 400 && stillThere && stillThere.decision === originalDecision,
      `del=${del.status} patch=${patch.status} decision unchanged=${stillThere?.decision === originalDecision}`);

    // Direct forge of the manual-review overlay columns on tax_cases → blocked.
    const g = await seed("G");
    const forge = await rest("PATCH", `/rest/v1/tax_cases?id=eq.${g.taxCaseId}`, { token: staffTok, prefer: "return=representation", body: { manual_review_status: "approved" } });
    const tc = await readRow("tax_cases", g.taxCaseId, "manual_review_status");
    check("G2 direct forge of manual_review_status blocked by the guard", forge.status >= 400 && tc.manual_review_status === "none", `HTTP ${forge.status}`);
  }

  console.log("\n[H] Revoked credential cannot sign off; the historical snapshot survives");
  {
    const cred = (await svc("GET", `/rest/v1/tax_reviewer_credentials?user_id=eq.${staffU.id}&select=id`)).body[0];
    const rev = await rpc("set_reviewer_credential_status", adminTok,
      { p_credential_id: cred.id, p_status: "revoked", p_reason: "Membership lapsed.", p_event_id: crypto.randomUUID() });
    check("H1 admin revokes the credential", rev.status < 300, `HTTP ${rev.status}`);

    const h = await seed("H");
    const r = await rpc("record_reviewer_signoff", staffTok,
      { p_tax_case_id: h.taxCaseId, p_decision: "approved_for_progression", p_reason: null, p_event_id: crypto.randomUUID() });
    check("H2 a revoked reviewer cannot sign off", r.status >= 400 && /not an active qualified/i.test(JSON.stringify(r.body)), `HTTP ${r.status}`);

    // The earlier approved case's review still carries the qualification snapshot.
    const priorReview = (await svc("GET", `/rest/v1/tax_case_reviews?tax_case_id=eq.${approved.taxCaseId}&decision=eq.approved_for_progression&select=reviewer_qualification_snapshot,reviewer_id`)).body[0];
    check("H3 completed sign-off retains its qualification snapshot after revocation",
      priorReview && priorReview.reviewer_qualification_snapshot === "chartered_accountant" && priorReview.reviewer_id === staffU.id,
      JSON.stringify(priorReview));
  }

  console.log("\n[I] assign_case_reviewer requires an active qualified reviewer");
  {
    // Re-activate staff so there is an active reviewer to assign.
    const cred = (await svc("GET", `/rest/v1/tax_reviewer_credentials?user_id=eq.${staffU.id}&select=id`)).body[0];
    await rpc("set_reviewer_credential_status", adminTok, { p_credential_id: cred.id, p_status: "active", p_reason: null, p_event_id: crypto.randomUUID() });

    const i = await seed("I");
    // A random user id is guaranteed to have no credential (deterministic across
    // runs regardless of which real users hold credentials).
    const bad = await rpc("assign_case_reviewer", staffTok, { p_tax_case_id: i.taxCaseId, p_reviewer_id: crypto.randomUUID(), p_event_id: crypto.randomUUID() });
    check("I1 cannot assign a non-qualified reviewer", bad.status >= 400 && /active qualified reviewer/i.test(JSON.stringify(bad.body)), `HTTP ${bad.status}`);

    const good = await rpc("assign_case_reviewer", staffTok, { p_tax_case_id: i.taxCaseId, p_reviewer_id: staffU.id, p_event_id: crypto.randomUUID() });
    const tc = await readRow("tax_cases", i.taxCaseId, "reviewer_id,manual_review_status");
    check("I2 assign an active reviewer → pending", good.status < 300 && tc.reviewer_id === staffU.id && tc.manual_review_status === "pending", `HTTP ${good.status}`);
    check("I2b assignment audited", (await countAudit(i.caseId, "tax_manual_review.assigned")).length >= 1);
  }

  console.log("\n[J] Finalized case → manual review is read-only");
  {
    const j = await seed("J");
    // Service-role force-finalize (bypasses the 9A gate for this guard test only).
    await svc("PATCH", `/rest/v1/tax_cases?id=eq.${j.taxCaseId}`, { finalized_at: new Date().toISOString(), finalized_by: adminU.id, finalized_snapshot_id: j.snapId });
    const r = await rpc("record_reviewer_signoff", staffTok,
      { p_tax_case_id: j.taxCaseId, p_decision: "approved_for_progression", p_reason: null, p_event_id: crypto.randomUUID() });
    check("J1 signoff rejected on a finalized case", r.status >= 400 && /finalized/i.test(JSON.stringify(r.body)), `HTTP ${r.status}`);
  }

  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) {
    console.log("FAILURES:\n - " + failures.join("\n - "));
    process.exit(1);
  }
  console.log("ALL REVIEWER-SIGNOFF ASSERTIONS PASSED (0 bypasses).");
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
