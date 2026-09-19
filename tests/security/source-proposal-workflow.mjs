// K3-30 — One-source propose -> review -> promote security test
// (LOCAL-ONLY, SYNTHETIC DATA ONLY, self-asserting).
//
// Proves, against the live local PostgREST API, that the three guarded RPCs
// (`propose_source_fact`, `decide_source_proposal`, `promote_source_proposal_pair`)
// cannot be bypassed:
//   P1  authorization        — anon cannot call any of the three RPCs.
//   P2  cross-case           — a document from a DIFFERENT case is rejected.
//   P3  not-yet-uploaded     — a document with no uploaded_files row is rejected.
//   P4  malformed version    — a wrong source-schema/adapter version is rejected.
//   P5  unsupported fact     — a fact kind outside the closed vocabulary is rejected.
//   P6  duplicate live       — two live (non-rejected) proposals for the same
//       fact+document cannot coexist; a re-proposal after rejection succeeds.
//   P7  finalized case       — propose / decide / promote are all rejected.
//   P8  stale decision       — deciding an already-decided proposal is rejected.
//   P9  reject requires reason.
//   P10 replay/idempotency   — same event_id + same decision replays cleanly;
//       same event_id + a FLIPPED decision fails deterministically (conflict).
//   P11 incomplete pair      — promotion refuses when only one fact is accepted,
//       when a fact is still merely proposed, and when a fact was rejected.
//   P12 atomic promotion     — accepted pair promotes into EXACTLY one income +
//       one tax_paid row with immutable lineage; a second promote call is
//       idempotent (same ids, no duplicate rows).
//   P13 base-table lockdown  — authenticated staff cannot write tax_source_proposals
//       directly (insert/update/delete all blocked); only the RPCs can.
//   P14 unpromoted inert     — (K3-31.C) proposed / accepted-but-not-promoted /
//       rejected facts create ZERO ledger rows, in every state, with a control
//       assertion that the SAME case's pair does create rows once promoted.
//
// Run: node --env-file=.env.local tests/security/source-proposal-workflow.mjs
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321/.test(API)) {
  throw new Error(`Refusing non-local target: ${API}`);
}
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_taxdesk-os";

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
const anonRpc = (fn, args) => rest("POST", `/rest/v1/rpc/${fn}`, { body: args }); // no bearer at all

async function svcRep(path, body) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  const arr = await r.json();
  return Array.isArray(arr) ? arr[0] : arr;
}

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql], {
    encoding: "utf8",
  });
}
const q1 = (sql) => psql(sql).trim();

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

const FORM16_VERSION = "FORM16_V0_PLANNED";
const ADAPTER_VERSION = "SYNTHETIC_FORM16_PROPOSAL_ADAPTER_V1";

async function main() {
  console.log(`Target ${API}\n`);
  const adminU = (await svc("GET", "/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1")).body[0];
  const staffTok = await authPassword("staff@e2e.test", "e2e-staff-password");
  const adminTok = await authPassword("admin@e2e.test", "e2e-password");
  if (!staffTok || !adminTok) throw new Error("Could not obtain tokens (run test:e2e:bootstrap).");
  const itrService = (await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")).body[0];

  // Seed a tax case with ONE case_document that already has a live uploaded file
  // (so it is eligible for a proposal), unless `uploaded:false`.
  async function seed(label, { uploaded = true, finalized = false } = {}) {
    const rid = crypto.randomUUID().slice(0, 8);
    const client = await svcRep("/rest/v1/clients", {
      full_name: `K330 ${label} ${rid}`,
      primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10),
      date_of_birth: "1990-05-05",
    });
    const kase = await svcRep("/rest/v1/cases", {
      display_code: `TDX-K330-${label}-${rid}`,
      client_id: client.id,
      service_id: itrService.id,
      title: "ITR",
      status: "new_lead",
      owner_id: adminU.id,
      priority: "normal",
      service_data: { ay: "2026-27" },
    });
    const doc = await svcRep("/rest/v1/case_documents", {
      case_id: kase.id,
      name: `Form 16 (synthetic) ${rid}`,
      is_required: true,
      status: "requested",
    });
    if (uploaded) {
      await svcRep("/rest/v1/uploaded_files", {
        case_id: kase.id,
        case_document_id: doc.id,
        storage_path: `cases/${kase.id}/${crypto.randomUUID()}.pdf`,
        original_filename: "form16.pdf",
        mime_type: "application/pdf",
        size_bytes: 12345,
        sha256: crypto.randomBytes(16).toString("hex"),
        uploaded_via: "staff",
        uploaded_by: adminU.id,
        contains_aadhaar: false,
      });
    }
    const tc = await svcRep("/rest/v1/tax_cases", {
      case_id: kase.id,
      client_id: client.id,
      assessment_year: "2026-27",
      financial_year: "2025-26",
      itr_type_selected: "ITR-1",
      residential_status: "resident",
      taxpayer_category: "individual",
    });
    if (finalized) {
      const snap = await svcRep("/rest/v1/tax_computation_snapshots", {
        tax_case_id: tc.id,
        rules_version: "AY_2026_27_V0_PREP_ONLY",
        input_snapshot: { complete: true },
        output_snapshot: {},
        is_final: true,
        created_by: adminU.id,
      });
      psql(
        `update public.tax_cases set finalized_at=now(), finalized_by='${adminU.id}', finalized_snapshot_id='${snap.id}' where id='${tc.id}';`,
      );
    }
    return { clientId: client.id, caseId: kase.id, taxCaseId: tc.id, docId: doc.id };
  }

  const proposeArgs = (f, factKind, value, over = {}) => ({
    p_tax_case_id: f.taxCaseId,
    p_case_document_id: f.docId,
    p_fact_kind: factKind,
    p_proposed_value: value,
    p_source_schema_version: FORM16_VERSION,
    p_adapter_version: ADAPTER_VERSION,
    p_event_id: crypto.randomUUID(),
    ...over,
  });

  console.log("[P1] Anonymous callers cannot reach any of the three RPCs");
  {
    const a = await seed("P1");
    const r1 = await anonRpc("propose_source_fact", proposeArgs(a, "income.salary", 100000));
    const r2 = await anonRpc("decide_source_proposal", { p_proposal_id: crypto.randomUUID(), p_decision: "accept", p_reason: null, p_event_id: crypto.randomUUID() });
    const r3 = await anonRpc("promote_source_proposal_pair", { p_case_document_id: a.docId, p_event_id: crypto.randomUUID() });
    check("P1a propose rejected for anon", r1.status >= 400, `HTTP ${r1.status}`);
    check("P1b decide rejected for anon", r2.status >= 400, `HTTP ${r2.status}`);
    check("P1c promote rejected for anon", r3.status >= 400, `HTTP ${r3.status}`);
    const rows = q1(`select count(*) from public.tax_source_proposals where tax_case_id='${a.taxCaseId}';`);
    check("P1d no proposal row created", rows === "0", `rows=${rows}`);
  }

  console.log("\n[P2] Cross-case: a document from a DIFFERENT case is rejected");
  {
    const a = await seed("P2a");
    const b = await seed("P2b");
    const r = await rpc("propose_source_fact", staffTok, proposeArgs({ ...a, docId: b.docId }, "income.salary", 100000));
    check("P2 cross-case document rejected", r.status >= 400 && /does not belong to this case/i.test(JSON.stringify(r.body)), `HTTP ${r.status}`);
  }

  console.log("\n[P3] A document with no uploaded file is rejected");
  {
    const a = await seed("P3", { uploaded: false });
    const r = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 100000));
    check("P3 not-yet-uploaded document rejected", r.status >= 400 && /not been uploaded/i.test(JSON.stringify(r.body)), `HTTP ${r.status}`);
  }

  console.log("\n[P4] Malformed source-schema / adapter version is rejected");
  {
    const a = await seed("P4");
    const r1 = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 100000, { p_source_schema_version: "FORM16_V9" }));
    const a2 = await seed("P4b");
    const r2 = await rpc("propose_source_fact", staffTok, proposeArgs(a2, "income.salary", 100000, { p_adapter_version: "SOME_OTHER_ADAPTER" }));
    check("P4a wrong source-schema version rejected", r1.status >= 400, `HTTP ${r1.status}`);
    check("P4b wrong adapter version rejected", r2.status >= 400, `HTTP ${r2.status}`);
  }

  console.log("\n[P5] An unsupported fact kind is rejected");
  {
    const a = await seed("P5");
    const r = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.house_property", 100000));
    check("P5 unsupported fact kind rejected", r.status >= 400 && /unsupported fact/i.test(JSON.stringify(r.body)), `HTTP ${r.status}`);
  }

  console.log("\n[P6] Duplicate live proposal is rejected; re-proposal after rejection succeeds");
  let p6ProposalId;
  {
    const a = await seed("P6");
    const r1 = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 800000));
    p6ProposalId = r1.body;
    const r2 = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 900000));
    check("P6a first proposal recorded", r1.status < 300, `HTTP ${r1.status}`);
    check("P6b a second LIVE proposal for the same fact is rejected", r2.status >= 400 && /already exists/i.test(JSON.stringify(r2.body)), `HTTP ${r2.status}`);

    // Reject the first, then a fresh proposal for the same fact must succeed.
    await rpc("decide_source_proposal", staffTok, { p_proposal_id: p6ProposalId, p_decision: "reject", p_reason: "Wrong amount, refiling.", p_event_id: crypto.randomUUID() });
    const r3 = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 850000));
    check("P6c re-proposal after rejection succeeds", r3.status < 300, `HTTP ${r3.status}`);
  }

  console.log("\n[P7] Finalized case rejects propose / decide / promote");
  {
    const a = await seed("P7", { finalized: true });
    const r1 = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 100000));
    check("P7a propose rejected on finalized case", r1.status >= 400 && /finalized/i.test(JSON.stringify(r1.body)), `HTTP ${r1.status}`);

    // Force-seed a proposal via service role (bypassing the guard) to exercise
    // decide/promote against a finalized case directly.
    const forced = await svcRep("/rest/v1/tax_source_proposals", {
      tax_case_id: a.taxCaseId, case_document_id: a.docId, source_schema_kind: "Form16",
      source_schema_version: FORM16_VERSION, adapter_version: ADAPTER_VERSION,
      fact_kind: "income.salary", proposed_value: 100000, created_by: adminU.id,
    });
    const r2 = await rpc("decide_source_proposal", staffTok, { p_proposal_id: forced.id, p_decision: "accept", p_reason: null, p_event_id: crypto.randomUUID() });
    check("P7b decide rejected on finalized case", r2.status >= 400 && /finalized/i.test(JSON.stringify(r2.body)), `HTTP ${r2.status}`);
    const r3 = await rpc("promote_source_proposal_pair", staffTok, { p_case_document_id: a.docId, p_event_id: crypto.randomUUID() });
    check("P7c promote rejected on finalized case", r3.status >= 400 && /finalized/i.test(JSON.stringify(r3.body)), `HTTP ${r3.status}`);
  }

  console.log("\n[P8] Deciding an already-decided proposal is rejected (stale)");
  {
    const a = await seed("P8");
    const created = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 700000));
    const id = created.body;
    await rpc("decide_source_proposal", staffTok, { p_proposal_id: id, p_decision: "accept", p_reason: null, p_event_id: crypto.randomUUID() });
    const again = await rpc("decide_source_proposal", staffTok, { p_proposal_id: id, p_decision: "reject", p_reason: "changed my mind", p_event_id: crypto.randomUUID() });
    check("P8 re-deciding an already-decided proposal is rejected", again.status >= 400 && /already been decided/i.test(JSON.stringify(again.body)), `HTTP ${again.status}`);
  }

  console.log("\n[P9] Rejecting without a reason is refused");
  {
    const a = await seed("P9");
    const created = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 700000));
    const r = await rpc("decide_source_proposal", staffTok, { p_proposal_id: created.body, p_decision: "reject", p_reason: "   ", p_event_id: crypto.randomUUID() });
    check("P9 reject without a reason rejected", r.status >= 400 && /reason is required/i.test(JSON.stringify(r.body)), `HTTP ${r.status}`);
  }

  console.log("\n[P10] Replay / idempotency: same event_id same decision replays; flipped decision conflicts");
  {
    const a = await seed("P10");
    const created = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 700000));
    const id = created.body;
    const evt = crypto.randomUUID();
    const first = await rpc("decide_source_proposal", staffTok, { p_proposal_id: id, p_decision: "accept", p_reason: null, p_event_id: evt });
    const replay = await rpc("decide_source_proposal", staffTok, { p_proposal_id: id, p_decision: "accept", p_reason: null, p_event_id: evt });
    check("P10a genuine replay (same event_id, same decision) succeeds idempotently", first.status < 300 && replay.status < 300, `first=${first.status} replay=${replay.status}`);
    const decidedCount = q1(`select count(*) from public.audit_logs where event_id='${evt}';`);
    check("P10b exactly one audit row for the replayed event_id", decidedCount === "1", `count=${decidedCount}`);

    const flipped = await rpc("decide_source_proposal", staffTok, { p_proposal_id: id, p_decision: "reject", p_reason: "flip attempt", p_event_id: evt });
    check("P10c a FLIPPED decision reusing the same event_id fails deterministically", flipped.status >= 400 && /different decision/i.test(JSON.stringify(flipped.body)), `HTTP ${flipped.status}`);
    const status = q1(`select status from public.tax_source_proposals where id='${id}';`);
    check("P10d status still reflects the original accept, not the flip attempt", status === "accepted", status);
  }

  console.log("\n[P11] Incomplete pair refuses promotion");
  {
    const a = await seed("P11");
    // Only propose+accept the income fact; never touch tax_paid.
    const inc = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 700000));
    await rpc("decide_source_proposal", staffTok, { p_proposal_id: inc.body, p_decision: "accept", p_reason: null, p_event_id: crypto.randomUUID() });
    const r1 = await rpc("promote_source_proposal_pair", staffTok, { p_case_document_id: a.docId, p_event_id: crypto.randomUUID() });
    check("P11a missing fact -> incomplete pair rejected", r1.status >= 400 && /incomplete pair/i.test(JSON.stringify(r1.body)), `HTTP ${r1.status}`);

    // Propose the TDS fact but leave it merely proposed (not accepted).
    await rpc("propose_source_fact", staffTok, proposeArgs(a, "tax_paid.salary_tds", 60000));
    const r2 = await rpc("promote_source_proposal_pair", staffTok, { p_case_document_id: a.docId, p_event_id: crypto.randomUUID() });
    check("P11b not-yet-accepted fact -> promotion rejected", r2.status >= 400 && /must be accepted/i.test(JSON.stringify(r2.body)), `HTTP ${r2.status}`);

    // Reject the TDS fact -> still incomplete/blocked.
    const tdsRow = q1(`select id from public.tax_source_proposals where case_document_id='${a.docId}' and fact_kind='tax_paid.salary_tds' order by created_at desc limit 1;`);
    await rpc("decide_source_proposal", staffTok, { p_proposal_id: tdsRow, p_decision: "reject", p_reason: "wrong figure", p_event_id: crypto.randomUUID() });
    const r3 = await rpc("promote_source_proposal_pair", staffTok, { p_case_document_id: a.docId, p_event_id: crypto.randomUUID() });
    check("P11c rejected fact still blocks promotion", r3.status >= 400 && /must be accepted/i.test(JSON.stringify(r3.body)), `HTTP ${r3.status}`);
  }

  console.log("\n[P12] Accepted pair promotes atomically; a second call is idempotent");
  {
    const a = await seed("P12");
    const inc = await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 812345));
    const tds = await rpc("propose_source_fact", staffTok, proposeArgs(a, "tax_paid.salary_tds", 61234));
    await rpc("decide_source_proposal", staffTok, { p_proposal_id: inc.body, p_decision: "accept", p_reason: null, p_event_id: crypto.randomUUID() });
    await rpc("decide_source_proposal", staffTok, { p_proposal_id: tds.body, p_decision: "accept", p_reason: null, p_event_id: crypto.randomUUID() });

    const promote1 = await rpc("promote_source_proposal_pair", staffTok, { p_case_document_id: a.docId, p_event_id: crypto.randomUUID() });
    const row1 = promote1.body?.[0];
    check("P12a promotion succeeds", promote1.status < 300 && row1 && !row1.already_promoted, `HTTP ${promote1.status} body=${JSON.stringify(promote1.body)}`);

    const incomeRows = (await svc("GET", `/rest/v1/tax_income_entries?tax_case_id=eq.${a.taxCaseId}&select=id,amount,income_head,source_type,source_document_id`)).body;
    const tdsRows = (await svc("GET", `/rest/v1/tax_tax_paid_entries?tax_case_id=eq.${a.taxCaseId}&select=id,amount,tax_paid_type,source_type,source_document_id`)).body;
    check("P12b exactly ONE income row created with the proposed amount", incomeRows.length === 1 && Number(incomeRows[0].amount) === 812345 && incomeRows[0].source_type === "Form16" && incomeRows[0].source_document_id === a.docId, JSON.stringify(incomeRows));
    check("P12c exactly ONE tax_paid row created with the proposed amount", tdsRows.length === 1 && Number(tdsRows[0].amount) === 61234 && tdsRows[0].source_type === "Form16", JSON.stringify(tdsRows));

    const lineage = (await svc("GET", `/rest/v1/tax_source_proposals?case_document_id=eq.${a.docId}&select=id,status,promoted_ledger_kind,promoted_ledger_entry_id`)).body;
    const allPromoted = lineage.every((p) => p.status === "promoted" && p.promoted_ledger_entry_id);
    check("P12d both proposals carry immutable promoted lineage", allPromoted, JSON.stringify(lineage));

    // Idempotent replay with a NEW event_id (a genuine retry after e.g. a lost
    // HTTP response) must return the SAME rows and create nothing new.
    const promote2 = await rpc("promote_source_proposal_pair", staffTok, { p_case_document_id: a.docId, p_event_id: crypto.randomUUID() });
    const row2 = promote2.body?.[0];
    check("P12e second promote call is idempotent (already_promoted, same ids)",
      promote2.status < 300 && row2 && row2.already_promoted === true &&
      row2.income_entry_id === row1.income_entry_id && row2.tax_paid_entry_id === row1.tax_paid_entry_id,
      JSON.stringify(row2));
    const incomeRows2 = (await svc("GET", `/rest/v1/tax_income_entries?tax_case_id=eq.${a.taxCaseId}&select=id`)).body;
    check("P12f no duplicate income row after the second promote", incomeRows2.length === 1, `count=${incomeRows2.length}`);
  }

  console.log("\n[P13] Base-table writes to tax_source_proposals are blocked for authenticated staff");
  {
    const a = await seed("P13");
    const ins = await rest("POST", "/rest/v1/tax_source_proposals", {
      token: staffTok,
      prefer: "return=representation",
      body: {
        tax_case_id: a.taxCaseId, case_document_id: a.docId, source_schema_kind: "Form16",
        source_schema_version: FORM16_VERSION, adapter_version: ADAPTER_VERSION,
        fact_kind: "income.salary", proposed_value: 100000, created_by: adminU.id,
      },
    });
    check("P13a direct INSERT blocked", ins.status >= 400, `HTTP ${ins.status}`);

    const forced = await svcRep("/rest/v1/tax_source_proposals", {
      tax_case_id: a.taxCaseId, case_document_id: a.docId, source_schema_kind: "Form16",
      source_schema_version: FORM16_VERSION, adapter_version: ADAPTER_VERSION,
      fact_kind: "income.salary", proposed_value: 100000, created_by: adminU.id,
    });
    const upd = await rest("PATCH", `/rest/v1/tax_source_proposals?id=eq.${forced.id}`, {
      token: staffTok, prefer: "return=representation", body: { status: "promoted" },
    });
    const del = await rest("DELETE", `/rest/v1/tax_source_proposals?id=eq.${forced.id}`, {
      token: staffTok, prefer: "return=representation",
    });
    const stillThere = q1(`select status from public.tax_source_proposals where id='${forced.id}';`);
    check("P13b direct UPDATE blocked", upd.status >= 400 && stillThere === "proposed", `HTTP ${upd.status} status=${stillThere}`);
    check("P13c direct DELETE blocked", del.status >= 400 && stillThere === "proposed", `HTTP ${del.status}`);
  }

  console.log("\n[P14] K3-31.C — unpromoted proposals never create a ledger row, in every non-promoted state");
  {
    const ledgerRowCount = (taxCaseId) => {
      const inc = q1(`select count(*) from public.tax_income_entries where tax_case_id='${taxCaseId}';`);
      const tds = q1(`select count(*) from public.tax_tax_paid_entries where tax_case_id='${taxCaseId}';`);
      return { inc: Number(inc), tds: Number(tds) };
    };

    // State: proposed (nobody has decided yet).
    const a = await seed("P14a");
    await rpc("propose_source_fact", staffTok, proposeArgs(a, "income.salary", 700000));
    await rpc("propose_source_fact", staffTok, proposeArgs(a, "tax_paid.salary_tds", 50000));
    const countsProposed = ledgerRowCount(a.taxCaseId);
    check(
      "P14a proposed-only facts create ZERO ledger rows",
      countsProposed.inc === 0 && countsProposed.tds === 0,
      JSON.stringify(countsProposed),
    );

    // State: accepted but never promoted.
    const b = await seed("P14b");
    const incB = await rpc("propose_source_fact", staffTok, proposeArgs(b, "income.salary", 700000));
    const tdsB = await rpc("propose_source_fact", staffTok, proposeArgs(b, "tax_paid.salary_tds", 50000));
    await rpc("decide_source_proposal", staffTok, { p_proposal_id: incB.body, p_decision: "accept", p_reason: null, p_event_id: crypto.randomUUID() });
    await rpc("decide_source_proposal", staffTok, { p_proposal_id: tdsB.body, p_decision: "accept", p_reason: null, p_event_id: crypto.randomUUID() });
    const countsAccepted = ledgerRowCount(b.taxCaseId);
    check(
      "P14b accepted-but-not-promoted facts create ZERO ledger rows (promotion is a SEPARATE explicit step)",
      countsAccepted.inc === 0 && countsAccepted.tds === 0,
      JSON.stringify(countsAccepted),
    );

    // State: rejected.
    const c = await seed("P14c");
    const incC = await rpc("propose_source_fact", staffTok, proposeArgs(c, "income.salary", 700000));
    const tdsC = await rpc("propose_source_fact", staffTok, proposeArgs(c, "tax_paid.salary_tds", 50000));
    await rpc("decide_source_proposal", staffTok, { p_proposal_id: incC.body, p_decision: "reject", p_reason: "wrong amount", p_event_id: crypto.randomUUID() });
    await rpc("decide_source_proposal", staffTok, { p_proposal_id: tdsC.body, p_decision: "reject", p_reason: "wrong amount", p_event_id: crypto.randomUUID() });
    const countsRejected = ledgerRowCount(c.taxCaseId);
    check(
      "P14c rejected facts create ZERO ledger rows",
      countsRejected.inc === 0 && countsRejected.tds === 0,
      JSON.stringify(countsRejected),
    );

    // Control: promoting case (b)'s now-accepted pair DOES create exactly one
    // row each — proving the count-zero assertions above are a real absence,
    // not a broken query.
    await rpc("promote_source_proposal_pair", staffTok, { p_case_document_id: b.docId, p_event_id: crypto.randomUUID() });
    const countsPromoted = ledgerRowCount(b.taxCaseId);
    check(
      "P14d control: the SAME case's pair, once promoted, DOES create exactly one row each",
      countsPromoted.inc === 1 && countsPromoted.tds === 1,
      JSON.stringify(countsPromoted),
    );
  }

  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) {
    console.log("FAILURES:\n - " + failures.join("\n - "));
    process.exit(1);
  }
  console.log("ALL SOURCE-PROPOSAL-WORKFLOW ASSERTIONS PASSED (0 bypasses).");
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
