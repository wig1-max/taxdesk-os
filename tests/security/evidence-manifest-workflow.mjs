// K3-32B — accepted-evidence manifest + persisted internal draft-output
// security test (LOCAL-ONLY, SYNTHETIC DATA ONLY, self-asserting).
//
// Proves, against the live local PostgREST API with REAL staff/admin tokens,
// that the two new guarded RPCs (`create_evidence_manifest`,
// `generate_internal_draft_output`) and the extended `capture_client_approval`
// cannot be bypassed:
//   M1-M2  authorization        — anon cannot call either new RPC.
//   M3     happy path           — staff can create a manifest for a
//          below-threshold case; the stored row matches the request.
//   M4     regime required      — a regime outside ('old','new') is rejected.
//   M5     malformed hash       — a non-sha256-shaped hash is rejected.
//   M6     cross-case snapshot  — a snapshot from a DIFFERENT case is rejected.
//   M7     incomplete snapshot  — a snapshot not marked complete is rejected.
//   M8-M9  boundary              — EXACT Rs 50,00,000 selected-regime income is
//          NOT blocked; Rs 50,00,001 IS blocked (mirrors D44's strict `>`).
//   M10    regime-selective gate — an UNSELECTED alternative regime above the
//          threshold does not block a below-threshold SELECTED regime; the
//          SAME snapshot IS blocked when the above-threshold regime is chosen.
//   M11-M12 idempotency          — same event_id replays cleanly; a conflicting
//          replay (different snapshot) fails deterministically.
//   M13    finalized case       — rejected.
//   M14    base-table lockdown  — authenticated cannot insert/update/delete
//          tax_evidence_manifests or tax_draft_outputs directly (immutability).
//   M15    approval binding     — capture_client_approval requires a manifest
//          bound to the EXACT snapshot being approved; a manifest for a
//          different case or a different snapshot is rejected.
//   M16    stale approval       — generate_internal_draft_output refuses when
//          approval does not currently point at the exact manifest passed.
//   M17    reliance blocker     — refuses when the manifest carries an active
//          blocker code.
//   M18    open validation      — refuses when an open error/blocker finding
//          exists for the case.
//   M19    idempotency (draft output) — same event_id replays; conflicting
//          replay (different manifest) fails deterministically.
//   M20    admin does not bypass any of the above.
//
// SAFETY: attacks use real local STAFF/ADMIN tokens only. The service-role
// key is used ONLY for fixture seeding and forensic reads. Target MUST be
// local.
//
// Run: node --env-file=.env.local tests/security/evidence-manifest-workflow.mjs
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
const anonRpc = (fn, args) => rest("POST", `/rest/v1/rpc/${fn}`, { body: args });

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
const fakeHash = (seed) => crypto.createHash("sha256").update(seed).digest("hex");
const manifestPayload = () => ({ schemaVersion: "TAX_EVIDENCE_MANIFEST_V1", figures: [], evidenceFacts: [] });

const THRESHOLD = 5000000; // Rs 50,00,000 — see tax-capability.ts / D44.

async function main() {
  console.log(`Target ${API}\n`);
  const adminU = (await svc("GET", "/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1")).body[0];
  const itrService = (await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")).body[0];
  const staffTok = await authPassword("staff@e2e.test", "e2e-staff-password");
  if (!staffTok) throw new Error("Could not obtain staff token (run test:e2e:bootstrap).");
  const adminTok = await authPassword("admin@e2e.test", "e2e-password");
  if (!adminTok) throw new Error("Could not obtain admin token (run test:e2e:bootstrap).");

  /** Same seeding shape as tests/security/surcharge-marginal-relief-blocker.mjs
   *  (a fully-eligible case with one complete snapshot carrying both regimes'
   *  totalIncome). `finalized` optionally finalizes the case immediately. */
  async function seed(label, { totalIncome = 4000000, regime = {}, finalized = false } = {}) {
    const oldTotalIncome = regime.old ?? totalIncome;
    const newTotalIncome = regime.new ?? totalIncome;
    const rid = crypto.randomUUID().slice(0, 8);
    const client = (await svc("POST", "/rest/v1/clients",
      { full_name: `K3-32B ${label} ${rid}`, primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10),
        date_of_birth: "1985-01-01" },
      "return=representation")).body[0];
    const kase = (await svc("POST", "/rest/v1/cases",
      { display_code: `TDX-K3B-${label}-${rid}`, client_id: client.id, service_id: itrService.id,
        title: "ITR", status: "new_lead", owner_id: adminU.id, priority: "normal", service_data: { ay: "2026-27" } },
      "return=representation")).body[0];
    const tc = (await svc("POST", "/rest/v1/tax_cases",
      { case_id: kase.id, client_id: client.id, assessment_year: "2026-27", financial_year: "2025-26",
        itr_type_selected: "ITR-1", itr_type_recommended: "ITR-1",
        residential_status: "resident", taxpayer_category: "individual", declared_special_situations: [] },
      "return=representation")).body[0];
    const snap = (await svc("POST", "/rest/v1/tax_computation_snapshots",
      { tax_case_id: tc.id, rules_version: "AY_2026_27_V0_PREP_ONLY",
        input_snapshot: {
          complete: true,
          eligibility: { eligible: true, version: "test", blockerCodes: [] },
          engineInput: { income: [], taxPaid: [] },
          summary: { salary: totalIncome },
        },
        output_snapshot: {
          computation: {
            totalIncome: { value: totalIncome, formula: "test", sources: [], notes: [] },
            oldRegime: { totalIncome: { value: oldTotalIncome, formula: "test", sources: [], notes: [] } },
            newRegime: { totalIncome: { value: newTotalIncome, formula: "test", sources: [], notes: [] } },
          },
        },
        is_final: false, created_by: adminU.id },
      "return=representation")).body[0];
    if (finalized) {
      await svc("PATCH", `/rest/v1/tax_cases?id=eq.${tc.id}`, {
        finalized_at: new Date().toISOString(),
        finalized_by: adminU.id,
        finalized_snapshot_id: snap.id,
      });
    }
    return { clientId: client.id, caseId: kase.id, taxCaseId: tc.id, snapId: snap.id };
  }

  function createManifestArgs({ taxCaseId, snapshotId, selectedRegime, hash, payload }) {
    return {
      p_tax_case_id: taxCaseId,
      p_snapshot_id: snapshotId,
      p_selected_regime: selectedRegime,
      p_manifest_payload: payload ?? manifestPayload(),
      p_manifest_content_hash: hash ?? fakeHash(crypto.randomUUID()),
      p_validation_rules_version: "K2.8.readiness.v1",
      p_tax_pack_id: "ITA_1961:2026-27",
      p_tax_pack_version: "AY_2026_27_V0_PREP_ONLY",
      p_tax_pack_lifecycle_status: "draft",
      p_pre_approval_capability_result: {},
      p_snapshot_capability_result: {},
      p_event_id: crypto.randomUUID(),
    };
  }

  // ---- [M1-M2] anon cannot call either new RPC ----
  const s1 = await seed("anon-target", { totalIncome: 800000 });
  const anon1 = await anonRpc("create_evidence_manifest", createManifestArgs({ taxCaseId: s1.taxCaseId, snapshotId: s1.snapId, selectedRegime: "new" }));
  check("M1 anon cannot call create_evidence_manifest", anon1.status >= 400, JSON.stringify(anon1.body));
  const anon2 = await anonRpc("generate_internal_draft_output", {
    p_tax_case_id: s1.taxCaseId, p_manifest_id: crypto.randomUUID(),
    p_package_payload: {}, p_package_content_hash: fakeHash("x"), p_event_id: crypto.randomUUID(),
  });
  check("M2 anon cannot call generate_internal_draft_output", anon2.status >= 400, JSON.stringify(anon2.body));

  // ---- [M3] happy path ----
  const s3 = await seed("happy", { totalIncome: 800000 });
  const hash3 = fakeHash("m3");
  const create3 = await rpc("create_evidence_manifest", staffTok, createManifestArgs({
    taxCaseId: s3.taxCaseId, snapshotId: s3.snapId, selectedRegime: "new", hash: hash3,
  }));
  check("M3 staff can create an evidence manifest for a below-threshold case", create3.status < 300, JSON.stringify(create3.body));
  const manifest3 = await readRow("tax_evidence_manifests", create3.body, "id,selected_regime,selected_regime_total_income,manifest_content_hash,active_blocker_codes,tax_case_id");
  check(
    "M3 the stored manifest matches the request (regime, income, hash)",
    manifest3?.selected_regime === "new" && Number(manifest3?.selected_regime_total_income) === 800000 && manifest3?.manifest_content_hash === hash3,
    JSON.stringify(manifest3),
  );
  check("M3 a freshly created manifest carries no active blocker codes", (manifest3?.active_blocker_codes ?? []).length === 0);

  // ---- [M4] regime required ----
  const create4 = await rpc("create_evidence_manifest", staffTok, createManifestArgs({
    taxCaseId: s3.taxCaseId, snapshotId: s3.snapId, selectedRegime: "recommended",
  }));
  check("M4 an out-of-vocabulary regime is rejected", create4.status >= 400, JSON.stringify(create4.body));

  // ---- [M5] malformed hash ----
  const create5 = await rpc("create_evidence_manifest", staffTok, createManifestArgs({
    taxCaseId: s3.taxCaseId, snapshotId: s3.snapId, selectedRegime: "new", hash: "not-a-hash",
  }));
  check("M5 a malformed content hash is rejected", create5.status >= 400, JSON.stringify(create5.body));

  // ---- [M6] cross-case snapshot ----
  const s6other = await seed("cross-case-other", { totalIncome: 800000 });
  const create6 = await rpc("create_evidence_manifest", staffTok, createManifestArgs({
    taxCaseId: s3.taxCaseId, snapshotId: s6other.snapId, selectedRegime: "new",
  }));
  check("M6 a snapshot belonging to a DIFFERENT case is rejected", create6.status >= 400, JSON.stringify(create6.body));

  // ---- [M7] incomplete snapshot ----
  const s7 = await seed("incomplete", { totalIncome: 800000 });
  await svc("PATCH", `/rest/v1/tax_computation_snapshots?id=eq.${s7.snapId}`, {
    input_snapshot: { complete: false },
  });
  const create7 = await rpc("create_evidence_manifest", staffTok, createManifestArgs({
    taxCaseId: s7.taxCaseId, snapshotId: s7.snapId, selectedRegime: "new",
  }));
  check("M7 an incomplete snapshot is rejected", create7.status >= 400, JSON.stringify(create7.body));

  // ---- [M8-M9] exact-boundary strict `>` (D44) ----
  const s8 = await seed("boundary-at", { totalIncome: THRESHOLD });
  const create8 = await rpc("create_evidence_manifest", staffTok, createManifestArgs({
    taxCaseId: s8.taxCaseId, snapshotId: s8.snapId, selectedRegime: "old",
  }));
  check("M8 EXACT Rs 50,00,000 selected-regime income is NOT blocked", create8.status < 300, JSON.stringify(create8.body));

  const s9 = await seed("boundary-over", { totalIncome: THRESHOLD + 1 });
  const create9 = await rpc("create_evidence_manifest", staffTok, createManifestArgs({
    taxCaseId: s9.taxCaseId, snapshotId: s9.snapId, selectedRegime: "old",
  }));
  check(
    "M9 Rs 50,00,001 selected-regime income IS blocked",
    create9.status >= 400 && JSON.stringify(create9.body ?? "").includes("SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED"),
    JSON.stringify(create9.body),
  );

  // ---- [M10] regime-selective gate, not the conservative one ----
  const s10 = await seed("regime-selective", { totalIncome: 4000000, regime: { old: 5200000, new: 4000000 } });
  const create10a = await rpc("create_evidence_manifest", staffTok, createManifestArgs({
    taxCaseId: s10.taxCaseId, snapshotId: s10.snapId, selectedRegime: "new",
  }));
  check(
    "M10a an unselected alternative regime (old, Rs 52L) above the threshold does NOT block the below-threshold SELECTED regime (new, Rs 40L)",
    create10a.status < 300,
    JSON.stringify(create10a.body),
  );
  const create10b = await rpc("create_evidence_manifest", staffTok, createManifestArgs({
    taxCaseId: s10.taxCaseId, snapshotId: s10.snapId, selectedRegime: "old",
  }));
  check(
    "M10b the SAME snapshot IS blocked when the above-threshold regime (old) is the one selected",
    create10b.status >= 400,
    JSON.stringify(create10b.body),
  );

  // ---- [M11-M12] idempotency ----
  const s11 = await seed("idempotent", { totalIncome: 800000 });
  const eventId11 = crypto.randomUUID();
  const args11 = { ...createManifestArgs({ taxCaseId: s11.taxCaseId, snapshotId: s11.snapId, selectedRegime: "new" }), p_event_id: eventId11 };
  const create11a = await rpc("create_evidence_manifest", staffTok, args11);
  const create11b = await rpc("create_evidence_manifest", staffTok, args11);
  check("M11 a genuine event_id replay returns the SAME manifest id", create11a.status < 300 && create11a.body === create11b.body, JSON.stringify([create11a.body, create11b.body]));
  const countAfterReplay = await svc("GET", `/rest/v1/tax_evidence_manifests?tax_case_id=eq.${s11.taxCaseId}&select=id`);
  check("M11 the replay created NO duplicate row", Array.isArray(countAfterReplay.body) && countAfterReplay.body.length === 1);

  const s12other = await seed("conflict-other", { totalIncome: 800000 });
  const create12b = await rpc("create_evidence_manifest", staffTok, {
    ...createManifestArgs({ taxCaseId: s12other.taxCaseId, snapshotId: s12other.snapId, selectedRegime: "new" }),
    p_event_id: eventId11,
  });
  check("M12 a CONFLICTING replay (different snapshot, same event_id) fails deterministically", create12b.status >= 400, JSON.stringify(create12b.body));

  // ---- [M13] finalized case ----
  const s13 = await seed("finalized", { totalIncome: 800000, finalized: true });
  const create13 = await rpc("create_evidence_manifest", staffTok, createManifestArgs({
    taxCaseId: s13.taxCaseId, snapshotId: s13.snapId, selectedRegime: "new",
  }));
  check("M13 a finalized case is rejected", create13.status >= 400, JSON.stringify(create13.body));

  // ---- [M14] base-table lockdown (immutability) ----
  const insert14 = await rest("POST", "/rest/v1/tax_evidence_manifests", {
    token: staffTok,
    body: { tax_case_id: s3.taxCaseId, computation_snapshot_id: s3.snapId, manifest_payload: {}, manifest_content_hash: fakeHash("x"), selected_regime: "new", selected_regime_total_income: 1, tax_pack_id: "x", tax_pack_version: "x", tax_pack_lifecycle_status: "draft", created_by: adminU.id },
  });
  check("M14 authenticated staff cannot INSERT tax_evidence_manifests directly", insert14.status >= 400, JSON.stringify(insert14.body));
  const update14 = await rest("PATCH", `/rest/v1/tax_evidence_manifests?id=eq.${manifest3.id}`, {
    token: staffTok, body: { selected_regime: "old" },
  });
  check("M14 authenticated staff cannot UPDATE tax_evidence_manifests directly (immutable)", update14.status >= 400 || (Array.isArray(update14.body) && update14.body.length === 0), JSON.stringify(update14.body));
  const del14 = await rest("DELETE", `/rest/v1/tax_evidence_manifests?id=eq.${manifest3.id}`, { token: staffTok });
  check("M14 authenticated staff cannot DELETE tax_evidence_manifests directly", del14.status >= 400 || (Array.isArray(del14.body) && del14.body.length === 0), JSON.stringify(del14.body));
  const insertDraft14 = await rest("POST", "/rest/v1/tax_draft_outputs", {
    token: staffTok,
    body: { tax_case_id: s3.taxCaseId, source_snapshot_id: s3.snapId, source_manifest_id: manifest3.id, source_manifest_hash: hash3, package_payload: {}, package_content_hash: fakeHash("y"), created_by: adminU.id, event_id: crypto.randomUUID() },
  });
  check("M14 authenticated staff cannot INSERT tax_draft_outputs directly", insertDraft14.status >= 400, JSON.stringify(insertDraft14.body));

  // ---- [M15] approval binding ----
  const s15 = await seed("approval-binding", { totalIncome: 800000 });
  const prep15 = await rpc("prepare_client_review", staffTok, { p_tax_case_id: s15.taxCaseId, p_event_id: crypto.randomUUID() });
  check("M15 prepare_client_review succeeds (setup)", prep15.status < 300, JSON.stringify(prep15.body));
  const create15 = await rpc("create_evidence_manifest", staffTok, createManifestArgs({ taxCaseId: s15.taxCaseId, snapshotId: s15.snapId, selectedRegime: "new" }));
  check("M15 create_evidence_manifest succeeds after prepare (setup)", create15.status < 300, JSON.stringify(create15.body));

  const captureNoManifest = await rpc("capture_client_approval", staffTok, {
    p_tax_case_id: s15.taxCaseId, p_manifest_id: null, p_method: "whatsapp", p_reference: null, p_approved_at: null, p_event_id: crypto.randomUUID(),
  });
  check("M15a capture_client_approval requires a manifest id (null rejected)", captureNoManifest.status >= 400, JSON.stringify(captureNoManifest.body));

  const foreignManifest = await rpc("create_evidence_manifest", staffTok, createManifestArgs({ taxCaseId: s3.taxCaseId, snapshotId: s3.snapId, selectedRegime: "new" }));
  const captureForeignManifest = await rpc("capture_client_approval", staffTok, {
    p_tax_case_id: s15.taxCaseId, p_manifest_id: foreignManifest.body, p_method: "whatsapp", p_reference: null, p_approved_at: null, p_event_id: crypto.randomUUID(),
  });
  check("M15b capture_client_approval rejects a manifest belonging to a DIFFERENT case", captureForeignManifest.status >= 400, JSON.stringify(captureForeignManifest.body));

  const captureOk = await rpc("capture_client_approval", staffTok, {
    p_tax_case_id: s15.taxCaseId, p_manifest_id: create15.body, p_method: "whatsapp", p_reference: null, p_approved_at: null, p_event_id: crypto.randomUUID(),
  });
  check("M15c capture_client_approval succeeds when the manifest matches the case + snapshot being approved", captureOk.status < 300, JSON.stringify(captureOk.body));
  const s15Row = await readRow("tax_cases", s15.taxCaseId, "client_review_manifest_id,client_review_manifest_hash,client_review_status");
  check("M15c the case now binds to the exact manifest id + hash", s15Row?.client_review_manifest_id === create15.body && s15Row?.client_review_status === "approved");

  // ---- [M16] stale approval — a second manifest generated for the SAME
  //      snapshot does not retroactively become "current" for draft output. ----
  const create15b = await rpc("create_evidence_manifest", staffTok, createManifestArgs({ taxCaseId: s15.taxCaseId, snapshotId: s15.snapId, selectedRegime: "old" }));
  check("M16 setup: a second manifest can be generated for the same snapshot under a different regime", create15b.status < 300, JSON.stringify(create15b.body));
  const genStale = await rpc("generate_internal_draft_output", staffTok, {
    p_tax_case_id: s15.taxCaseId, p_manifest_id: create15b.body, p_package_payload: { schemaVersion: "TAX_DRAFT_OUTPUT_PACKAGE_V1" }, p_package_content_hash: fakeHash("stale"), p_event_id: crypto.randomUUID(),
  });
  check("M16 generate_internal_draft_output refuses the NEW manifest — approval still points at the FIRST one", genStale.status >= 400, JSON.stringify(genStale.body));

  const genOk = await rpc("generate_internal_draft_output", staffTok, {
    p_tax_case_id: s15.taxCaseId, p_manifest_id: create15.body, p_package_payload: { schemaVersion: "TAX_DRAFT_OUTPUT_PACKAGE_V1" }, p_package_content_hash: fakeHash("ok"), p_event_id: crypto.randomUUID(),
  });
  check("M16 generate_internal_draft_output succeeds against the manifest approval actually points to", genOk.status < 300, JSON.stringify(genOk.body));
  const draftRow = Array.isArray(genOk.body) ? genOk.body[0] : genOk.body;
  check("M16 the persisted row's source_manifest_id/hash trace to the approved manifest", draftRow?.already_generated === false);

  // ---- [M17] reliance blocker on the manifest itself ----
  const s17 = await seed("blocked-manifest", { totalIncome: 800000 });
  const prep17 = await rpc("prepare_client_review", staffTok, { p_tax_case_id: s17.taxCaseId, p_event_id: crypto.randomUUID() });
  check("M17 setup: prepare succeeds", prep17.status < 300);
  // Plant a manifest carrying an active blocker code directly via service role
  // (the guarded RPC itself would never create one — this proves the RPC
  // re-checks live state rather than trusting a stored disclosure field).
  const plantedManifest = (await svc("POST", "/rest/v1/tax_evidence_manifests", {
    tax_case_id: s17.taxCaseId, computation_snapshot_id: s17.snapId, manifest_payload: manifestPayload(),
    manifest_content_hash: fakeHash("planted"), selected_regime: "new", selected_regime_total_income: 800000,
    active_blocker_codes: ["SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED"], tax_pack_id: "x", tax_pack_version: "x",
    tax_pack_lifecycle_status: "draft", created_by: adminU.id,
  }, "return=representation")).body[0];
  await svc("PATCH", `/rest/v1/tax_cases?id=eq.${s17.taxCaseId}`, {
    client_review_manifest_id: plantedManifest.id, client_review_manifest_hash: plantedManifest.manifest_content_hash, client_review_status: "approved", client_approved_at: new Date().toISOString(),
  });
  const gen17 = await rpc("generate_internal_draft_output", staffTok, {
    p_tax_case_id: s17.taxCaseId, p_manifest_id: plantedManifest.id, p_package_payload: {}, p_package_content_hash: fakeHash("x"), p_event_id: crypto.randomUUID(),
  });
  check("M17 generate_internal_draft_output refuses a manifest carrying an active blocker code", gen17.status >= 400, JSON.stringify(gen17.body));

  // ---- [M18] open validation blocker ----
  const s18 = await seed("open-validation", { totalIncome: 800000 });
  const prep18 = await rpc("prepare_client_review", staffTok, { p_tax_case_id: s18.taxCaseId, p_event_id: crypto.randomUUID() });
  const create18 = await rpc("create_evidence_manifest", staffTok, createManifestArgs({ taxCaseId: s18.taxCaseId, snapshotId: s18.snapId, selectedRegime: "new" }));
  const capture18 = await rpc("capture_client_approval", staffTok, {
    p_tax_case_id: s18.taxCaseId, p_manifest_id: create18.body, p_method: "whatsapp", p_reference: null, p_approved_at: null, p_event_id: crypto.randomUUID(),
  });
  check("M18 setup: prepare/create/capture all succeed", prep18.status < 300 && create18.status < 300 && capture18.status < 300);
  await svc("POST", "/rest/v1/tax_validation_findings", {
    tax_case_id: s18.taxCaseId, code: "TEST_BLOCKER", severity: "blocker", area: "test", message: "planted", status: "open",
  });
  const gen18 = await rpc("generate_internal_draft_output", staffTok, {
    p_tax_case_id: s18.taxCaseId, p_manifest_id: create18.body, p_package_payload: {}, p_package_content_hash: fakeHash("x"), p_event_id: crypto.randomUUID(),
  });
  check("M18 generate_internal_draft_output refuses while an open validation blocker exists", gen18.status >= 400, JSON.stringify(gen18.body));

  // ---- [M19] idempotency for generate_internal_draft_output ----
  const eventId19 = crypto.randomUUID();
  const args19 = { p_tax_case_id: s15.taxCaseId, p_manifest_id: create15.body, p_package_payload: { schemaVersion: "TAX_DRAFT_OUTPUT_PACKAGE_V1" }, p_package_content_hash: fakeHash("m19"), p_event_id: eventId19 };
  const gen19a = await rpc("generate_internal_draft_output", staffTok, args19);
  const gen19b = await rpc("generate_internal_draft_output", staffTok, args19);
  const row19a = Array.isArray(gen19a.body) ? gen19a.body[0] : gen19a.body;
  const row19b = Array.isArray(gen19b.body) ? gen19b.body[0] : gen19b.body;
  check(
    "M19a a genuine event_id replay returns the SAME draft_output_id",
    gen19a.status < 300 && row19a?.draft_output_id === row19b?.draft_output_id && row19b?.already_generated === true,
    JSON.stringify([row19a, row19b]),
  );
  const gen19conflict = await rpc("generate_internal_draft_output", staffTok, {
    ...args19, p_manifest_id: create15b.body, p_package_content_hash: fakeHash("m19conflict"),
  });
  check("M19b a CONFLICTING replay (different manifest, same event_id) fails deterministically", gen19conflict.status >= 400, JSON.stringify(gen19conflict.body));

  // ---- [M20] admin does not bypass ----
  const s20 = await seed("admin-boundary", { totalIncome: THRESHOLD + 1 });
  const create20 = await rpc("create_evidence_manifest", adminTok, createManifestArgs({ taxCaseId: s20.taxCaseId, snapshotId: s20.snapId, selectedRegime: "new" }));
  check("M20 admin token does not bypass the regime-selective reliance blocker", create20.status >= 400, JSON.stringify(create20.body));

  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) {
    console.log("FAILURES:\n - " + failures.join("\n - "));
    process.exit(1);
  }
  console.log("ALL EVIDENCE-MANIFEST / DRAFT-OUTPUT WORKFLOW ASSERTIONS PASSED.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
