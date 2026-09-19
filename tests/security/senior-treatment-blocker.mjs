// K4-01 — senior / super-senior citizen safety-boundary security test
// (LOCAL-ONLY, self-asserting). CONDITION NARROWED in K4-05 — see below.
//
// Proves, against the live local PostgREST API with REAL staff/admin tokens,
// that the database boundary (supabase/migrations/
// 20260725130000_senior_treatment_safety_boundary.sql,
// 20260726130000_senior_treatment_old_regime_reliance_ready.sql)
// independently enforces the SAME senior/super-senior reliance rule as
// src/lib/tax-desk/senior-treatment.ts's evaluateSeniorTreatmentRisk():
//
//   - K4-05: a RESIDENT senior/super-senior taxpayer selecting the OLD
//     regime for an accepted-evidence manifest is NO LONGER BLOCKED SOLELY
//     FOR AGE — the full later-computation dossier (§10.1-§10.4) is closed,
//     including this session's own "80D_PARENTS" parent-premium bucket —
//     and the manifest → capture_client_approval → finalize_tax_case chain
//     now succeeds end to end, where it previously refused;
//   - a below-60 resident taxpayer is completely unaffected (always allowed);
//   - a NON-resident taxpayer is never assigned resident senior treatment
//     merely from age (no senior-specific block fires — always allowed);
//   - an UNRESOLVED residential status STILL fails closed
//     (RESIDENTIAL_STATUS_UNRESOLVED) — the ONLY code this evaluator can
//     still produce, UNCHANGED by K4-05;
//   - neither staff nor admin can bypass that remaining residency block;
//   - the (now-unblocked) senior case still composes cleanly with the
//     surcharge/marginal-relief blocker (TAX-SAFE-01) — a co-occurring high
//     income is still caught by THAT gate, proving K4-05 did not
//     accidentally widen a DIFFERENT blocker's own coverage;
//   - a rejected mutation (residency-unresolved) leaves no partial state;
//   - event-id idempotency still holds for a successful manifest creation;
//   - historical manifests remain immutable (no UPDATE grant for anyone).
//
// SAFETY: attacks use real local STAFF/ADMIN tokens only. The service-role
// key is used ONLY for fixture seeding and forensic reads. Target MUST be
// local.
//
// Run: node --env-file=.env.local tests/security/senior-treatment-blocker.mjs
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

const SENIOR_CODE = "SENIOR_TREATMENT_UNSUPPORTED";
const RESIDENCY_CODE = "RESIDENTIAL_STATUS_UNRESOLVED";
const SURCHARGE_CODE = "SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED";
const AY = "2026-27";
// DOB fixtures against previous-year-end 2026-03-31 (see senior-treatment.ts
// golden boundary cases — the same fixtures the unit tests use).
const DOB_BELOW_60 = "1966-04-01";
const DOB_SENIOR = "1966-03-31"; // turns 60 exactly at previous-year end
const DOB_SUPER_SENIOR = "1946-03-31"; // turns 80 exactly at previous-year end

async function main() {
  console.log(`Target ${API}\n`);
  const adminU = (await svc("GET", "/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1")).body[0];
  const itrService = (await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")).body[0];
  const staffTok = await authPassword("staff@e2e.test", "e2e-staff-password");
  if (!staffTok) throw new Error("Could not obtain staff token (run test:e2e:bootstrap).");
  const adminTok = await authPassword("admin@e2e.test", "e2e-password");
  if (!adminTok) throw new Error("Could not obtain admin token (run test:e2e:bootstrap).");

  /** Seed a fully-eligible case with ONE complete snapshot whose
   *  output_snapshot.computation carries both regimes' totalIncome, and a
   *  configurable client date_of_birth / tax_cases.residential_status —
   *  everything app.tax_case_senior_treatment_blocked_for_case_regime reads
   *  directly from the database, never from a caller-supplied claim. */
  async function seed(label, { dob = DOB_BELOW_60, residentialStatus = "resident", totalIncome = 800000 } = {}) {
    const rid = crypto.randomUUID().slice(0, 8);
    const clientBody = {
      full_name: `K4-01 ${label} ${rid}`,
      primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10),
    };
    if (dob !== null) clientBody.date_of_birth = dob;
    const client = (await svc("POST", "/rest/v1/clients", clientBody, "return=representation")).body[0];
    const kase = (await svc("POST", "/rest/v1/cases",
      { display_code: `TDX-K401-${label}-${rid}`, client_id: client.id, service_id: itrService.id,
        title: "ITR", status: "new_lead", owner_id: adminU.id, priority: "normal", service_data: { ay: AY } },
      "return=representation")).body[0];
    const tcBody = {
      case_id: kase.id, client_id: client.id, assessment_year: AY, financial_year: "2025-26",
      itr_type_selected: "ITR-1", itr_type_recommended: "ITR-1",
      taxpayer_category: "individual", declared_special_situations: [],
    };
    if (residentialStatus !== null) tcBody.residential_status = residentialStatus;
    const tc = (await svc("POST", "/rest/v1/tax_cases", tcBody, "return=representation")).body[0];
    await svc("POST", "/rest/v1/tax_income_entries",
      { tax_case_id: tc.id, income_head: "salary", amount: totalIncome, source_type: "Form16",
        created_by: adminU.id, updated_by: adminU.id }, "return=representation");
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
            oldRegime: { totalIncome: { value: totalIncome, formula: "test", sources: [], notes: [] } },
            newRegime: { totalIncome: { value: totalIncome, formula: "test", sources: [], notes: [] } },
          },
        },
        is_final: false, created_by: adminU.id },
      "return=representation")).body[0];
    return { clientId: client.id, caseId: kase.id, taxCaseId: tc.id, snapId: snap.id };
  }

  async function prep(token, taxCaseId) {
    return rpc("prepare_client_review", token, { p_tax_case_id: taxCaseId, p_event_id: crypto.randomUUID() });
  }
  async function createManifest(token, taxCaseId, snapshotId, regime, eventId = crypto.randomUUID()) {
    return rpc("create_evidence_manifest", token, {
      p_tax_case_id: taxCaseId,
      p_snapshot_id: snapshotId,
      p_selected_regime: regime,
      p_manifest_payload: { schemaVersion: "TAX_EVIDENCE_MANIFEST_V1", figures: [], evidenceFacts: [] },
      p_manifest_content_hash: crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex"),
      p_validation_rules_version: "K2.8.readiness.v1",
      p_tax_pack_id: "ITA_1961:2026-27",
      p_tax_pack_version: "AY_2026_27_V0_PREP_ONLY",
      p_tax_pack_lifecycle_status: "draft",
      p_pre_approval_capability_result: {},
      p_snapshot_capability_result: {},
      p_event_id: eventId,
    });
  }
  async function capture(token, taxCaseId, manifestId) {
    return rpc("capture_client_approval", token, {
      p_tax_case_id: taxCaseId,
      p_manifest_id: manifestId,
      p_method: "whatsapp",
      p_reference: null,
      p_approved_at: null,
      p_event_id: crypto.randomUUID(),
    });
  }
  async function finalize(token, taxCaseId, snapshotId) {
    return rpc("finalize_tax_case", token, {
      p_tax_case_id: taxCaseId,
      p_snapshot_id: snapshotId,
      p_note: "test",
      p_confirm: true,
      p_event_id: crypto.randomUUID(),
    });
  }

  // ---- [1] Below-60 resident control: fully unaffected end to end ----
  const control = await seed("control", { dob: DOB_BELOW_60, residentialStatus: "resident" });
  const p1 = await prep(staffTok, control.taxCaseId);
  check("1a below-60 control: prepare_client_review succeeds", p1.status < 300, JSON.stringify(p1.body));
  const m1 = await createManifest(staffTok, control.taxCaseId, control.snapId, "old");
  check("1b below-60 control: create_evidence_manifest (old regime) succeeds", m1.status < 300, JSON.stringify(m1.body));
  const c1 = await capture(staffTok, control.taxCaseId, m1.body);
  check("1c below-60 control: capture_client_approval succeeds", c1.status < 300, JSON.stringify(c1.body));
  const f1 = await finalize(staffTok, control.taxCaseId, control.snapId);
  check("1d below-60 control: finalize_tax_case succeeds", f1.status < 300, JSON.stringify(f1.body));

  // ---- [2] K4-05: resident senior, OLD regime — NO LONGER BLOCKED. This is
  //      the direct end-to-end proof the K4-05 session prompt required:
  //      closing the 80D parent-premium gap narrows SENIOR_TREATMENT_UNSUPPORTED's
  //      condition — the full manifest -> approval -> finalize chain now
  //      succeeds, where the identical scenario refused before this session. ----
  const seniorOld = await seed("senior-old", { dob: DOB_SENIOR, residentialStatus: "resident" });
  await prep(staffTok, seniorOld.taxCaseId);
  const m2 = await createManifest(staffTok, seniorOld.taxCaseId, seniorOld.snapId, "old");
  check(
    "2 resident senior selecting OLD regime is NO LONGER BLOCKED (K4-05): create_evidence_manifest succeeds",
    m2.status < 300 && !JSON.stringify(m2.body ?? "").includes(SENIOR_CODE),
    JSON.stringify(m2.body),
  );
  const c2 = await capture(staffTok, seniorOld.taxCaseId, m2.body);
  check("2b resident senior OLD regime: capture_client_approval succeeds (K4-05)", c2.status < 300, JSON.stringify(c2.body));
  const f2 = await finalize(staffTok, seniorOld.taxCaseId, seniorOld.snapId);
  check("2c resident senior OLD regime: finalize_tax_case succeeds (K4-05)", f2.status < 300, JSON.stringify(f2.body));
  const seniorOldManifest = await readRow(
    "tax_evidence_manifests",
    m2.body,
    "id,tax_case_id,selected_regime",
  );
  check(
    "2d exactly one real manifest row exists for the now-successful senior OLD-regime case",
    seniorOldManifest?.tax_case_id === seniorOld.taxCaseId && seniorOldManifest?.selected_regime === "old",
  );

  // ---- [3] K4-05: resident SUPER-senior, OLD regime — also NO LONGER
  //      BLOCKED, proving the narrowing applies to BOTH age bands this
  //      evaluator recognizes, not just "senior". ----
  const superSeniorOld = await seed("super-senior-old", { dob: DOB_SUPER_SENIOR, residentialStatus: "resident" });
  await prep(staffTok, superSeniorOld.taxCaseId);
  const m3 = await createManifest(staffTok, superSeniorOld.taxCaseId, superSeniorOld.snapId, "old");
  check(
    "3 resident super-senior selecting OLD regime is NO LONGER BLOCKED (K4-05)",
    m3.status < 300 && !JSON.stringify(m3.body ?? "").includes(SENIOR_CODE),
    JSON.stringify(m3.body),
  );

  // ---- [4] Resident senior, pre-approval stage (no regime selected yet):
  //      prepare_client_review was never blocked here even before K4-05 (the
  //      pre-approval comparison caveat was always a non-blocking TypeScript/
  //      readiness-layer disclosure, never a database hard-block) — still
  //      true, unaffected by this session. ----
  const seniorPrep = await seed("senior-prep", { dob: DOB_SENIOR, residentialStatus: "resident" });
  const p4 = await prep(staffTok, seniorPrep.taxCaseId);
  check(
    "4 resident senior: prepare_client_review (pre-approval stage) is NOT blocked",
    p4.status < 300,
    JSON.stringify(p4.body),
  );

  // ---- [5] Resident senior, NEW regime: NOT blocked solely for age — this
  //      was already true before K4-05 and remains true (the NEW regime's
  //      slabs are age-neutral). ----
  const m5 = await createManifest(staffTok, seniorPrep.taxCaseId, seniorPrep.snapId, "new");
  check(
    "5 resident senior selecting NEW regime is NOT blocked solely for age",
    m5.status < 300,
    JSON.stringify(m5.body),
  );
  const c5 = await capture(staffTok, seniorPrep.taxCaseId, m5.body);
  check("5b capture_client_approval succeeds for the senior NEW-regime case", c5.status < 300, JSON.stringify(c5.body));
  const f5 = await finalize(staffTok, seniorPrep.taxCaseId, seniorPrep.snapId);
  check("5c finalize_tax_case succeeds for the senior NEW-regime case", f5.status < 300, JSON.stringify(f5.body));

  // ---- [6] Non-resident taxpayer, senior by age, OLD regime: NOT assigned
  //      resident senior treatment merely from age (no SENIOR-specific block
  //      fires — ordinary non-resident capability governs instead, which
  //      eligibility.ts already withholds upstream in the real product flow;
  //      this suite tests the SQL boundary in isolation, bypassing the
  //      upstream withholding to prove THIS function's own behavior).
  //      Unaffected by K4-05 — this was already unblocked before. ----
  const nonResidentSenior = await seed("non-resident-senior", { dob: DOB_SENIOR, residentialStatus: "non_resident" });
  await prep(staffTok, nonResidentSenior.taxCaseId);
  const m6 = await createManifest(staffTok, nonResidentSenior.taxCaseId, nonResidentSenior.snapId, "old");
  check(
    "6 non-resident senior-by-age selecting OLD regime is NOT blocked by the senior rule (no resident senior treatment assigned from age alone)",
    m6.status < 300 && !JSON.stringify(m6.body ?? "").includes(SENIOR_CODE),
    JSON.stringify(m6.body),
  );

  // ---- [7] Unresolved residential status: STILL fails closed. This is the
  //      ONLY condition app.tax_case_senior_treatment_blocked_for_case_regime
  //      can still return non-null for after K4-05 — proven directly. ----
  const unresolvedResidency = await seed("unresolved-residency", { dob: DOB_SENIOR, residentialStatus: null });
  // residential_status is null on this case — the profile is otherwise
  // eligible-shaped so prepare_client_review can proceed to the manifest
  // stage (this suite deliberately isolates the SQL boundary; the real
  // product flow already withholds a missing-residential-status case
  // entirely via eligibility.ts upstream).
  await prep(staffTok, unresolvedResidency.taxCaseId);
  const m7 = await createManifest(staffTok, unresolvedResidency.taxCaseId, unresolvedResidency.snapId, "new");
  check(
    "7 unresolved residential status STILL fails closed (RESIDENTIAL_STATUS_UNRESOLVED) even for the NEW regime — unaffected by K4-05",
    m7.status >= 400 && JSON.stringify(m7.body ?? "").includes(RESIDENCY_CODE),
    JSON.stringify(m7.body),
  );

  // ---- [8] Staff cannot bypass the ONE remaining block (residency
  //      unresolved) — already proven at [7]; re-asserted for the OLD
  //      regime too, since [7] used "new". ----
  const staffResidencyOld = await createManifest(staffTok, unresolvedResidency.taxCaseId, unresolvedResidency.snapId, "old");
  check(
    "8 staff token cannot bypass the residential-status-unresolved block (OLD regime too)",
    staffResidencyOld.status >= 400 && JSON.stringify(staffResidencyOld.body ?? "").includes(RESIDENCY_CODE),
    JSON.stringify(staffResidencyOld.body),
  );

  // ---- [9] Admin cannot bypass it either — no admin-only escape hatch for
  //      the residency-unresolved block. (A resident senior/super-senior
  //      OLD-regime case is no longer blocked for EITHER role after K4-05 —
  //      re-asserted here directly, mirroring [2]/[3] but with the admin
  //      token, proving the narrowing is role-independent too.) ----
  const adminSeniorOld = await seed("admin-senior-old", { dob: DOB_SENIOR, residentialStatus: "resident" });
  await prep(adminTok, adminSeniorOld.taxCaseId);
  const m9 = await createManifest(adminTok, adminSeniorOld.taxCaseId, adminSeniorOld.snapId, "old");
  check(
    "9a admin token: resident senior OLD regime is ALSO no longer blocked (K4-05, role-independent)",
    m9.status < 300 && !JSON.stringify(m9.body ?? "").includes(SENIOR_CODE),
    JSON.stringify(m9.body),
  );
  const adminResidencyUnresolved = await seed("admin-residency-unresolved", { dob: DOB_SENIOR, residentialStatus: null });
  await prep(adminTok, adminResidencyUnresolved.taxCaseId);
  const m9b = await createManifest(adminTok, adminResidencyUnresolved.taxCaseId, adminResidencyUnresolved.snapId, "old");
  check(
    "9b admin token cannot bypass the residential-status-unresolved block either",
    m9b.status >= 400 && JSON.stringify(m9b.body ?? "").includes(RESIDENCY_CODE),
    JSON.stringify(m9b.body),
  );

  // ---- [10] A stale/direct RPC call cannot bypass — calling the guarded RPC
  //      directly (not through any UI) still enforces the block; a direct
  //      table INSERT (bypassing the RPC entirely) is independently denied
  //      by privilege (authenticated has no INSERT grant on
  //      tax_evidence_manifests — K3-32B invariant, re-checked here). ----
  const directInsert = await rest("POST", "/rest/v1/tax_evidence_manifests", {
    token: staffTok,
    body: {
      tax_case_id: adminResidencyUnresolved.taxCaseId,
      computation_snapshot_id: adminResidencyUnresolved.snapId,
      manifest_payload: {},
      manifest_content_hash: crypto.createHash("sha256").update("x").digest("hex"),
      selected_regime: "old",
      selected_regime_total_income: 0,
      tax_pack_id: "x", tax_pack_version: "x", tax_pack_lifecycle_status: "draft",
      created_by: adminU.id,
    },
  });
  check(
    "10 a direct table INSERT (bypassing the guarded RPC) is denied by privilege, not just application logic",
    directInsert.status >= 400,
    JSON.stringify(directInsert.body),
  );

  // ---- [11]/[12] Composition with the surcharge blocker: K4-05 removed the
  //      senior-specific block, but the SEPARATE surcharge/marginal-relief
  //      blocker (TAX-SAFE-01) still independently catches a co-occurring
  //      high income — proving K4-05 did not accidentally widen surcharge's
  //      own coverage or otherwise mask it. ----
  const seniorAndSurcharge = await seed("senior-and-surcharge", {
    dob: DOB_SENIOR,
    residentialStatus: "resident",
    totalIncome: 6000000, // above the Rs 50,00,000 surcharge threshold
  });
  await prep(staffTok, seniorAndSurcharge.taxCaseId);
  const m11 = await createManifest(staffTok, seniorAndSurcharge.taxCaseId, seniorAndSurcharge.snapId, "old");
  check(
    "11 senior (OLD regime) + high income: blocked by SURCHARGE ALONE now (K4-05 removed the senior code; the surcharge code still fires independently)",
    m11.status >= 400 &&
      JSON.stringify(m11.body ?? "").includes(SURCHARGE_CODE) &&
      !JSON.stringify(m11.body ?? "").includes(SENIOR_CODE),
    JSON.stringify(m11.body),
  );
  // A below-60 case at the SAME high income is blocked by surcharge alone
  // (no senior code, unaffected by K4-05) — proving the surcharge check is
  // independently reached and not itself masked by an unrelated senior
  // finding (or its absence).
  const surchargeOnly = await seed("surcharge-only", {
    dob: DOB_BELOW_60,
    residentialStatus: "resident",
    totalIncome: 6000000,
  });
  await prep(staffTok, surchargeOnly.taxCaseId);
  const m12 = await createManifest(staffTok, surchargeOnly.taxCaseId, surchargeOnly.snapId, "old");
  check(
    "12 below-60 + high income is blocked by SURCHARGE alone (senior code absent, surcharge code present) — unaffected by K4-05",
    m12.status >= 400 &&
      JSON.stringify(m12.body ?? "").includes(SURCHARGE_CODE) &&
      !JSON.stringify(m12.body ?? "").includes(SENIOR_CODE),
    JSON.stringify(m12.body),
  );

  // ---- [13] Rejected mutations leave no partial state (re-verified on the
  //      residency-unresolved admin-bypass attempt from [9b] — the ONLY
  //      rejection left to check now that the OLD senior-blocked case from
  //      the pre-K4-05 suite no longer rejects). ----
  const adminResidencyCaseAfter = await readRow(
    "tax_cases",
    adminResidencyUnresolved.taxCaseId,
    "client_review_manifest_id,client_approved_at,finalized_at",
  );
  check(
    "13 no partial approval/finalization state was written for the rejected [9b] attempt",
    adminResidencyCaseAfter?.client_review_manifest_id === null &&
      adminResidencyCaseAfter?.client_approved_at === null &&
      adminResidencyCaseAfter?.finalized_at === null,
  );

  // ---- [14] Event idempotency: replaying the SAME event_id for a
  //      successful manifest creation returns the SAME manifest, not a
  //      duplicate or an error. ----
  const idemCase = await seed("idempotency", { dob: DOB_BELOW_60, residentialStatus: "resident" });
  await prep(staffTok, idemCase.taxCaseId);
  const idemEventId = crypto.randomUUID();
  const m14a = await createManifest(staffTok, idemCase.taxCaseId, idemCase.snapId, "new", idemEventId);
  const m14b = await createManifest(staffTok, idemCase.taxCaseId, idemCase.snapId, "new", idemEventId);
  check("14a first manifest-creation call succeeds", m14a.status < 300, JSON.stringify(m14a.body));
  check(
    "14b replaying the same event_id returns the SAME manifest id (idempotent, not a duplicate)",
    m14b.status < 300 && m14b.body === m14a.body,
    JSON.stringify({ first: m14a.body, replay: m14b.body }),
  );
  const idemManifestCount = await svc(
    "GET",
    `/rest/v1/tax_evidence_manifests?tax_case_id=eq.${idemCase.taxCaseId}&select=id`,
  );
  check("14c exactly one manifest row exists for the idempotent pair", (idemManifestCount.body ?? []).length === 1);

  // ---- [15] Historical manifests are immutable — no UPDATE grant exists for
  //      ANY role (re-asserts the K3-32B invariant this session's new senior-
  //      treatment fields also live inside, since they are additive JSONB
  //      keys on the SAME immutable payload/table). ----
  const updateAttempt = await rest("PATCH", `/rest/v1/tax_evidence_manifests?id=eq.${m14a.body}`, {
    token: staffTok,
    body: { selected_regime: "old" },
  });
  check(
    "15 a historical manifest cannot be updated by any authenticated role (immutability holds for the new senior-treatment fields too)",
    updateAttempt.status >= 400,
    JSON.stringify(updateAttempt.body),
  );

  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) {
    console.log("FAILURES:\n - " + failures.join("\n - "));
    process.exit(1);
  }
  console.log("ALL SENIOR-TREATMENT BLOCKER ASSERTIONS PASSED.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
