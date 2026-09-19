// TAX-SAFE-01 (boundary corrected in TAX-SAFE-01A, NARROWED in K4-11) —
// surcharge / marginal-relief reliance blocker security test (LOCAL-ONLY,
// self-asserting).
//
// K4-11 changed WHAT the DB layer reads, not the threshold. Crossing
// Rs 50,00,000 is now necessary but no longer sufficient: the RPC additionally
// consults the engine's OWN verdict, stored on the snapshot as
// output_snapshot.computation.surchargeTreatmentSupported, and blocks unless
// that verdict is exactly `true`. This is deliberately a READ of a stored
// boolean, never a second PL/pgSQL derivation of the surcharge window (D44 —
// one canonical derivation, no fifth authority). [S8] pins both directions of
// that read, plus the fail-closed behaviour when the key is null or absent —
// which is also what every pre-K4-11 snapshot looks like, and is exactly what
// S1/S3/S4/S6/S7 above go on exercising unchanged.
//
// Proves, against the live local PostgREST API with a REAL staff token, that
// a case whose latest complete computation snapshot's OWN computed total
// income (conservative higher of old/new regime) EXCEEDS the sourced risk
// threshold (Rs 50,00,000 — see src/lib/tax-desk/tax-capability.ts and
// supabase/migrations/20260724120000_surcharge_marginal_relief_blocker.sql)
// cannot be represented as approval-ready: prepare_client_review,
// capture_client_approval and finalize_tax_case all reject it EVEN WHEN
// CALLED DIRECTLY (never relying on a disabled UI button alone); that a case
// EXACTLY AT the threshold is NOT blocked by this rule (TAX-SAFE-01A —
// exactly Rs 50,00,000 attracts nil surcharge, strict `>` not `>=`); that
// admin does not bypass the above-threshold block; and that a low-risk case
// well below the threshold is completely unaffected end to end (prepare ->
// capture -> finalize all succeed).
//
// SAFETY: attacks use real local STAFF/ADMIN tokens only. The service-role
// key is used ONLY for fixture seeding and forensic reads. Target MUST be
// local.
//
// Run: node --env-file=.env.local tests/security/surcharge-marginal-relief-blocker.mjs
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

const BLOCKER_CODE = "SURCHARGE_MARGINAL_RELIEF_UNSUPPORTED";
const THRESHOLD = 5000000; // Rs 50,00,000 — see the migration/module header.

async function main() {
  console.log(`Target ${API}\n`);
  const adminU = (await svc("GET", "/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1")).body[0];
  const itrService = (await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")).body[0];
  const staffTok = await authPassword("staff@e2e.test", "e2e-staff-password");
  if (!staffTok) throw new Error("Could not obtain staff token (run test:e2e:bootstrap).");
  const adminTok = await authPassword("admin@e2e.test", "e2e-password");
  if (!adminTok) throw new Error("Could not obtain admin token (run test:e2e:bootstrap).");

  /** Seed a fully-eligible case (complete profile, no declared special
   *  situations, no open validation findings) with ONE complete snapshot
   *  whose output_snapshot.computation carries BOTH regimes' totalIncome
   *  (TAX-SAFE-01A — the RPC takes the conservative higher of the two, never
   *  only the top-level recommended-regime totalIncome). `regime` optionally
   *  overrides the old/new figures independently to prove the base is a
   *  true max(), not a re-read of one regime alone.
   *
   *  K4-11: `surchargeSupported` seeds the engine's own surcharge verdict.
   *  Left `undefined` by DEFAULT and then OMITTED from the payload entirely,
   *  so every scenario written before this session keeps exercising the
   *  fail-closed path a pre-K4-11 snapshot takes. Pass `true`/`false`/`null`
   *  to pin the narrowing explicitly.
   *
   *  MAINT-05 / AUDIT-05-F4: `opts.omitRegimeTotals` drops both regime totals
   *  entirely, producing the malformed snapshot the backstop used to release
   *  (`greatest()` of two NULLs is NULL, which the helper read as "not
   *  blocked"). Used by [S10]. `opts.omitRegime` drops exactly ONE regime's
   *  total, which is the only way to reach the SELECTED-regime helper's own
   *  fail-closed path independently of its conservative sibling — used by
   *  [S11]. */
  async function seed(label, totalIncome, regime = {}, surchargeSupported = undefined, opts = {}) {
    // K4-12: `opts.rebateReliefSupported` seeds the engine's SEPARATE section
    // 87A verdict. Left undefined by DEFAULT and then omitted from the payload
    // entirely, so every scenario written before K4-12 keeps seeding a snapshot
    // that carries no 87A verdict — which is exactly what a pre-K4-12 snapshot
    // looks like, and which is harmless for them because all their incomes sit
    // far outside the ₹12,00,000–₹12,70,589 relief window.
    const oldTotalIncome = regime.old ?? totalIncome;
    const newTotalIncome = regime.new ?? totalIncome;
    const rid = crypto.randomUUID().slice(0, 8);
    const client = (await svc("POST", "/rest/v1/clients",
      { full_name: `TAXSAFE01 ${label} ${rid}`, primary_phone: ("9" + rid.replace(/\D/g, "").padEnd(9, "0")).slice(0, 10),
        date_of_birth: "1985-01-01" },
      "return=representation")).body[0];
    const kase = (await svc("POST", "/rest/v1/cases",
      { display_code: `TDX-TAXSAFE01-${label}-${rid}`, client_id: client.id, service_id: itrService.id,
        title: "ITR", status: "new_lead", owner_id: adminU.id, priority: "normal", service_data: { ay: "2026-27" } },
      "return=representation")).body[0];
    const tc = (await svc("POST", "/rest/v1/tax_cases",
      { case_id: kase.id, client_id: client.id, assessment_year: "2026-27", financial_year: "2025-26",
        itr_type_selected: "ITR-1", itr_type_recommended: "ITR-1",
        residential_status: "resident", taxpayer_category: "individual", declared_special_situations: [] },
      "return=representation")).body[0];
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
            ...(opts.omitRegimeTotals
              ? {}
              : {
                  ...(opts.omitRegime === "old"
                    ? {}
                    : { oldRegime: { totalIncome: { value: oldTotalIncome, formula: "test", sources: [], notes: [] } } }),
                  ...(opts.omitRegime === "new"
                    ? {}
                    : { newRegime: { totalIncome: { value: newTotalIncome, formula: "test", sources: [], notes: [] } } }),
                }),
            ...(surchargeSupported === undefined ? {} : { surchargeTreatmentSupported: surchargeSupported }),
            ...(opts.rebateReliefSupported === undefined
              ? {}
              : { rebateReliefTreatmentSupported: opts.rebateReliefSupported }),
          },
        },
        is_final: false, created_by: adminU.id },
      "return=representation")).body[0];
    return { clientId: client.id, caseId: kase.id, taxCaseId: tc.id, snapId: snap.id };
  }

  // K3-32B: capture_client_approval now REQUIRES an accepted-evidence
  // manifest bound to the exact snapshot being approved. `viaRpc` creates one
  // through the REAL guarded `create_evidence_manifest` RPC (used for cases
  // this test expects to be reachable, e.g. the low-risk/at-threshold
  // controls). `plantDirect` inserts one via service-role directly — used
  // ONLY for [S3], which deliberately proves capture_client_approval's OWN
  // surcharge re-check independent of prepare/manifest-creation; a manifest
  // can never be created through the real RPC for an above-threshold
  // snapshot (create_evidence_manifest enforces the identical regime-
  // selective gate), so planting one directly isolates exactly what S3 was
  // always testing — capture's independent defense-in-depth check — from
  // this session's new, unrelated manifest-existence precondition.
  async function manifestViaRpc(taxCaseId, snapshotId, regime = "new") {
    const r = await rpc("create_evidence_manifest", staffTok, {
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
      p_event_id: crypto.randomUUID(),
    });
    if (r.status >= 300) throw new Error(`manifestViaRpc failed: ${JSON.stringify(r.body)}`);
    return r.body;
  }
  async function plantManifestDirect(taxCaseId, snapshotId) {
    const row = (await svc("POST", "/rest/v1/tax_evidence_manifests",
      { tax_case_id: taxCaseId, computation_snapshot_id: snapshotId,
        manifest_payload: { schemaVersion: "TAX_EVIDENCE_MANIFEST_V1", figures: [], evidenceFacts: [] },
        manifest_content_hash: crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex"),
        selected_regime: "new", selected_regime_total_income: 0,
        tax_pack_id: "ITA_1961:2026-27", tax_pack_version: "AY_2026_27_V0_PREP_ONLY", tax_pack_lifecycle_status: "draft",
        created_by: adminU.id },
      "return=representation")).body[0];
    return row.id;
  }

  // ---- [S1] Just-above-threshold case: prepare_client_review rejected ----
  const high = await seed("high", THRESHOLD + 1);
  const prep1 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: high.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S1 prepare_client_review rejects a just-above-threshold case",
    prep1.status >= 400 && JSON.stringify(prep1.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(prep1.body),
  );
  const highCaseAfterPrep = await readRow("tax_cases", high.taxCaseId, "client_review_status,client_review_snapshot_id");
  check(
    "S1 no review state was written for the rejected prepare",
    highCaseAfterPrep?.client_review_status === "not_started" && highCaseAfterPrep?.client_review_snapshot_id === null,
  );

  // ---- [S2] Exactly-at-threshold case: NOT blocked by this rule
  //      (TAX-SAFE-01A — strict `>`, not `>=`). prepare -> capture -> finalize
  //      all succeed, exactly like the low-risk control (S5). ----
  const atThreshold = await seed("at-threshold", THRESHOLD);
  const prep2 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: atThreshold.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S2a prepare_client_review permits a case exactly AT the threshold (Rs 50,00,000)",
    prep2.status < 300,
    JSON.stringify(prep2.body),
  );
  const atThresholdManifest = await manifestViaRpc(atThreshold.taxCaseId, atThreshold.snapId);
  const capture3 = await rpc("capture_client_approval", staffTok, {
    p_tax_case_id: atThreshold.taxCaseId,
    p_manifest_id: atThresholdManifest,
    p_method: "whatsapp",
    p_reference: null,
    p_approved_at: null,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S2b capture_client_approval does not reject a case exactly AT the threshold solely under this rule",
    capture3.status < 300,
    JSON.stringify(capture3.body),
  );
  const finalize3 = await rpc("finalize_tax_case", staffTok, {
    p_tax_case_id: atThreshold.taxCaseId,
    p_snapshot_id: atThreshold.snapId,
    p_note: "test",
    p_confirm: true,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S2c finalize_tax_case does not reject a case exactly AT the threshold solely under this rule",
    finalize3.status < 300,
    JSON.stringify(finalize3.body),
  );
  const atThresholdCaseAfterFinalize = await readRow("tax_cases", atThreshold.taxCaseId, "finalized_at");
  check("S2d the exactly-at-threshold case is actually finalized", !!atThresholdCaseAfterFinalize?.finalized_at);

  // ---- [S3] capture_client_approval independently rejects the high case,
  //      even when review state was already prepared by a DIRECT service-role
  //      write (simulating a pre-existing prepared pack) — proves capture does
  //      not merely inherit prepare's refusal but enforces its own check. ----
  const highManifest = await plantManifestDirect(high.taxCaseId, high.snapId);
  await svc("PATCH", `/rest/v1/tax_cases?id=eq.${high.taxCaseId}`, {
    client_review_status: "prepared",
    client_review_snapshot_id: high.snapId,
  });
  const capture1 = await rpc("capture_client_approval", staffTok, {
    p_tax_case_id: high.taxCaseId,
    p_manifest_id: highManifest,
    p_method: "whatsapp",
    p_reference: null,
    p_approved_at: null,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S3 capture_client_approval independently rejects the high-income case",
    capture1.status >= 400 && JSON.stringify(capture1.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(capture1.body),
  );
  const highCaseAfterCapture = await readRow("tax_cases", high.taxCaseId, "client_review_status,client_approved_at");
  check(
    "S3 no approval was written for the rejected capture",
    highCaseAfterCapture?.client_review_status === "prepared" && highCaseAfterCapture?.client_approved_at === null,
  );

  // ---- [S4] finalize_tax_case independently rejects the high case ----
  const finalize1 = await rpc("finalize_tax_case", staffTok, {
    p_tax_case_id: high.taxCaseId,
    p_snapshot_id: high.snapId,
    p_note: "test",
    p_confirm: true,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S4 finalize_tax_case rejects the high-income case",
    finalize1.status >= 400 && JSON.stringify(finalize1.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(finalize1.body),
  );
  const highCaseAfterFinalize = await readRow("tax_cases", high.taxCaseId, "finalized_at");
  check("S4 no finalize was written for the rejected attempt", highCaseAfterFinalize?.finalized_at === null);

  // ---- [S5] Control: a low-risk case (well below threshold) is completely
  //      unaffected — prepare -> capture -> finalize all succeed. ----
  const low = await seed("low", 800000);
  const prep3 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: low.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check("S5a prepare_client_review succeeds for a low-risk case", prep3.status < 300, JSON.stringify(prep3.body));

  const lowManifest = await manifestViaRpc(low.taxCaseId, low.snapId);
  const capture2 = await rpc("capture_client_approval", staffTok, {
    p_tax_case_id: low.taxCaseId,
    p_manifest_id: lowManifest,
    p_method: "whatsapp",
    p_reference: null,
    p_approved_at: null,
    p_event_id: crypto.randomUUID(),
  });
  check("S5b capture_client_approval succeeds for a low-risk case", capture2.status < 300, JSON.stringify(capture2.body));

  const finalize2 = await rpc("finalize_tax_case", staffTok, {
    p_tax_case_id: low.taxCaseId,
    p_snapshot_id: low.snapId,
    p_note: "test",
    p_confirm: true,
    p_event_id: crypto.randomUUID(),
  });
  check("S5c finalize_tax_case succeeds for a low-risk case", finalize2.status < 300, JSON.stringify(finalize2.body));
  const lowCaseAfterFinalize = await readRow("tax_cases", low.taxCaseId, "finalized_at");
  check("S5d the low-risk case is actually finalized", !!lowCaseAfterFinalize?.finalized_at);

  // ---- [S6] Admin does not bypass the above-threshold blocker — the RPC
  //      checks app.is_staff_or_admin() but the surcharge-risk assertion
  //      applies uniformly, with no admin-only escape hatch. ----
  const adminCase = await seed("admin-bypass", THRESHOLD + 1);
  const prep4 = await rpc("prepare_client_review", adminTok, {
    p_tax_case_id: adminCase.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S6 admin token does not bypass prepare_client_review's above-threshold block",
    prep4.status >= 400 && JSON.stringify(prep4.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(prep4.body),
  );

  // ---- [S7] The blocker uses the CONSERVATIVE HIGHER of old/new regime
  //      total income, never only one regime's figure (TAX-SAFE-01A) — a
  //      case whose old-regime figure is well below the threshold but whose
  //      new-regime figure crosses it (or vice versa) is still blocked. ----
  const mixedOldHigh = await seed("mixed-old-high", 4000000, { old: THRESHOLD + 1, new: 3000000 });
  const prep5 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: mixedOldHigh.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S7a blocked when only the OLD regime's total income crosses the threshold",
    prep5.status >= 400 && JSON.stringify(prep5.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(prep5.body),
  );

  const mixedNewHigh = await seed("mixed-new-high", 4000000, { old: 3000000, new: THRESHOLD + 1 });
  const prep6 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: mixedNewHigh.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S7b blocked when only the NEW regime's total income crosses the threshold",
    prep6.status >= 400 && JSON.stringify(prep6.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(prep6.body),
  );

  const mixedBothBelow = await seed("mixed-both-below", 4000000, { old: THRESHOLD, new: THRESHOLD });
  const prep7 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: mixedBothBelow.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S7c not blocked when BOTH regimes sit exactly at the threshold",
    prep7.status < 300,
    JSON.stringify(prep7.body),
  );

  // ---- [S8] K4-11 narrowing. Above the threshold the RPC now additionally
  //      reads the engine's OWN verdict off the stored snapshot. `true`
  //      releases the block; anything else — false, JSON null, or an absent
  //      key — keeps it. The verdict is READ, never re-derived in PL/pgSQL
  //      (D44), so these four cases are the whole of the DB-side contract. ----
  const insideWindow = await seed("inside-window", THRESHOLD + 1, {}, true);
  const prep8 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: insideWindow.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S8a above-threshold case is NOT blocked when the engine's surcharge verdict is true (K4-11 narrowing)",
    prep8.status < 300,
    JSON.stringify(prep8.body),
  );

  const verdictFalse = await seed("verdict-false", THRESHOLD + 1, {}, false);
  const prep9 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: verdictFalse.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S8b above-threshold case IS blocked when the engine's surcharge verdict is false",
    prep9.status >= 400 && JSON.stringify(prep9.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(prep9.body),
  );

  const verdictNull = await seed("verdict-null", THRESHOLD + 1, {}, null);
  const prep10 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: verdictNull.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S8c above-threshold case IS blocked when the surcharge verdict is JSON null (fails closed)",
    prep10.status >= 400 && JSON.stringify(prep10.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(prep10.body),
  );

  // S8d asserts the pre-K4-11 snapshot shape directly rather than leaving it
  // implied by S1/S3/S4/S6/S7: no verdict key at all must still block. A
  // migration that "defaulted" a missing verdict to permitted would silently
  // unblock every snapshot taken before this session.
  const verdictAbsent = await seed("verdict-absent", THRESHOLD + 1);
  const absentSnap = await readRow("tax_computation_snapshots", verdictAbsent.snapId, "output_snapshot");
  check(
    "S8d the absent-verdict fixture genuinely omits the key (guards the fixture itself)",
    absentSnap?.output_snapshot?.computation !== undefined &&
      !("surchargeTreatmentSupported" in absentSnap.output_snapshot.computation),
    JSON.stringify(absentSnap?.output_snapshot?.computation ?? null),
  );
  const prep11 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: verdictAbsent.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S8d above-threshold pre-K4-11 snapshot (no verdict key) IS still blocked",
    prep11.status >= 400 && JSON.stringify(prep11.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(prep11.body),
  );

  // ---- [S9] AUDIT-05-F1. The two surcharge helpers must apply the SAME
  //      release condition (the engine's stored verdict) while keeping their
  //      intentionally DIFFERENT income bases (D47). Before MAINT-05,
  //      `app.tax_case_surcharge_risk_blocked_for_regime` never read the
  //      verdict, so `create_evidence_manifest` — its only caller — refused
  //      EVERY case above Rs 50,00,000. Since `capture_client_approval`
  //      requires a manifest bound to the exact snapshot, no in-window case
  //      could be approved or finalized: K4-11's capability was inoperative.
  //
  //      Neither helper is reachable over PostgREST (both live in `app`), so
  //      they are asserted through their real callers — which is the behaviour
  //      that actually matters. ----
  const s9InWindow = await seed("f1-in-window", THRESHOLD + 2000000, {}, true);
  const prepS9 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: s9InWindow.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S9a CONSERVATIVE helper releases an in-window case (verdict true)",
    prepS9.status < 300,
    JSON.stringify(prepS9.body),
  );
  let s9ManifestOld = null;
  let s9ManifestNew = null;
  let s9Error = "";
  try {
    s9ManifestOld = await manifestViaRpc(s9InWindow.taxCaseId, s9InWindow.snapId, "old");
    s9ManifestNew = await manifestViaRpc(s9InWindow.taxCaseId, s9InWindow.snapId, "new");
  } catch (e) {
    s9Error = String(e?.message ?? e);
  }
  check(
    "S9b SELECTED-REGIME helper releases the SAME in-window case under BOTH regimes (AUDIT-05-F1 regression)",
    !!s9ManifestOld && !!s9ManifestNew,
    s9Error,
  );

  // The release condition agrees; the income BASE still differs on purpose.
  // A case whose UNSELECTED regime is above the ceiling has verdict `false`
  // (computeTax conjoins both regimes), so both helpers block — the divergence
  // D47 describes is a difference in WHICH income each reads, never a licence
  // for one to release what the other refuses on the same verdict.
  const s9Refused = await seed("f1-verdict-false", THRESHOLD + 2000000, {}, false);
  const s9RefusedManifest = await rpc("create_evidence_manifest", staffTok, {
    p_tax_case_id: s9Refused.taxCaseId,
    p_snapshot_id: s9Refused.snapId,
    p_selected_regime: "new",
    p_manifest_payload: { schemaVersion: "TAX_EVIDENCE_MANIFEST_V1", figures: [], evidenceFacts: [] },
    p_manifest_content_hash: crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex"),
    p_validation_rules_version: "K2.8.readiness.v1",
    p_tax_pack_id: "ITA_1961:2026-27",
    p_tax_pack_version: "AY_2026_27_V0_PREP_ONLY",
    p_tax_pack_lifecycle_status: "draft",
    p_pre_approval_capability_result: {},
    p_snapshot_capability_result: {},
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S9c SELECTED-REGIME helper STILL blocks an above-threshold case whose verdict is false",
    s9RefusedManifest.status >= 400 && JSON.stringify(s9RefusedManifest.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(s9RefusedManifest.body),
  );
  // AUDIT-05-F1(b) — the refusal message must no longer claim surcharge is
  // "not implemented for this income level". Since K4-11 it IS implemented for
  // a case between Rs 50,00,000 and Rs 2,00,00,000; a case is refused because
  // the ENGINE reported no complete treatment, which is what it now says.
  check(
    "S9d the refusal message no longer makes the untrue not-implemented-for-this-income-level claim",
    !/not implemented for this income level/i.test(JSON.stringify(s9RefusedManifest.body ?? "")) &&
      /did not report a complete surcharge/i.test(JSON.stringify(s9RefusedManifest.body ?? "")),
    JSON.stringify(s9RefusedManifest.body),
  );

  // ---- [S10] AUDIT-05-F4. The backstop must fail CLOSED on input it cannot
  //      read, not fall through to "not blocked". ----
  const s10NoTotals = await seed("f4-no-regime-totals", THRESHOLD + 2000000, {}, true, {
    omitRegimeTotals: true,
  });
  const s10Snap = await readRow("tax_computation_snapshots", s10NoTotals.snapId, "output_snapshot");
  check(
    "S10a the malformed fixture genuinely omits BOTH regime totals (guards the fixture itself)",
    s10Snap?.output_snapshot?.computation !== undefined &&
      !("oldRegime" in s10Snap.output_snapshot.computation) &&
      !("newRegime" in s10Snap.output_snapshot.computation),
    JSON.stringify(s10Snap?.output_snapshot?.computation ?? null),
  );
  const prepS10 = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: s10NoTotals.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S10b a snapshot with NO regime total incomes is BLOCKED, not released (AUDIT-05-F4(a) fail-closed)",
    prepS10.status >= 400 && JSON.stringify(prepS10.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(prepS10.body),
  );

  // F4(b): `->>` renders a JSON boolean `true` and a JSON string `"true"`
  // identically as the SQL text 'true', so the old `IS DISTINCT FROM 'true'`
  // test released BOTH. The comparison is now against the JSON boolean itself.
  const s10StringVerdict = await seed("f4-string-verdict", THRESHOLD + 2000000, {}, "true");
  const s10StringSnap = await readRow("tax_computation_snapshots", s10StringVerdict.snapId, "output_snapshot");
  check(
    "S10c the string-verdict fixture really stores a JSON STRING, not a boolean (guards the fixture itself)",
    s10StringSnap?.output_snapshot?.computation?.surchargeTreatmentSupported === "true",
    JSON.stringify(s10StringSnap?.output_snapshot?.computation?.surchargeTreatmentSupported ?? null),
  );
  const prepS10c = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: s10StringVerdict.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    'S10d a JSON STRING "true" verdict does NOT release the block (AUDIT-05-F4(b))',
    prepS10c.status >= 400 && JSON.stringify(prepS10c.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(prepS10c.body),
  );

  // ---- [S11] The SELECTED-REGIME helper, exercised on its OWN terms.
  //      [S9]/[S10] above seed EQUAL old/new totals and reach the conservative
  //      helper through `prepare_client_review`, so they prove the shared
  //      release condition but NOT that the two helpers still read DIFFERENT
  //      income (D47) and NOT the selected-regime helper's own fail-closed
  //      path. `create_evidence_manifest` has no client-review precondition, so
  //      it reaches `_for_regime` directly — which is what these assert. ----
  const helper = async (taxCaseId, snapId, regime) =>
    rpc("create_evidence_manifest", staffTok, {
      p_tax_case_id: taxCaseId,
      p_snapshot_id: snapId,
      p_selected_regime: regime,
      p_manifest_payload: { schemaVersion: "TAX_EVIDENCE_MANIFEST_V1", figures: [], evidenceFacts: [] },
      p_manifest_content_hash: crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex"),
      p_validation_rules_version: "K2.8.readiness.v1",
      p_tax_pack_id: "ITA_1961:2026-27",
      p_tax_pack_version: "AY_2026_27_V0_PREP_ONLY",
      p_tax_pack_lifecycle_status: "draft",
      p_pre_approval_capability_result: {},
      p_snapshot_capability_result: {},
      p_event_id: crypto.randomUUID(),
    });

  // DIVERGENT regimes: OLD below the threshold, NEW above it, verdict ABSENT.
  // The conservative helper takes the higher and blocks; the selected-regime
  // helper reads only the regime actually chosen. Both directions asserted, so
  // collapsing the two bases onto one income figure fails here.
  const divergent = await seed("f1-divergent-base", THRESHOLD, { old: 4000000, new: 6000000 });
  const prepDivergent = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: divergent.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S11a CONSERVATIVE helper blocks a divergent case on the HIGHER regime (base unchanged, D44)",
    prepDivergent.status >= 400 && JSON.stringify(prepDivergent.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(prepDivergent.body),
  );
  const divergentOld = await helper(divergent.taxCaseId, divergent.snapId, "old");
  check(
    "S11b SELECTED-REGIME helper permits the SAME case under the OLD regime (Rs 40,00,000 — D47's different base is preserved)",
    divergentOld.status < 300,
    JSON.stringify(divergentOld.body),
  );
  const divergentNew = await helper(divergent.taxCaseId, divergent.snapId, "new");
  check(
    "S11c SELECTED-REGIME helper blocks the SAME case under the NEW regime (Rs 60,00,000, verdict absent)",
    divergentNew.status >= 400 && JSON.stringify(divergentNew.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(divergentNew.body),
  );

  // The selected-regime helper's OWN fail-closed path (AUDIT-05-F4(a)): the
  // SELECTED regime's total is missing while the other regime's is present, so
  // only `_for_regime` can catch it. It used to return "not blocked" here.
  const missingSelected = await seed("f4-missing-selected-total", THRESHOLD + 2000000, {}, true, {
    omitRegime: "new",
  });
  const missingSnap = await readRow("tax_computation_snapshots", missingSelected.snapId, "output_snapshot");
  check(
    "S11d the one-sided fixture really omits ONLY the new regime (guards the fixture itself)",
    missingSnap?.output_snapshot?.computation?.oldRegime !== undefined &&
      missingSnap?.output_snapshot?.computation?.newRegime === undefined,
    JSON.stringify(Object.keys(missingSnap?.output_snapshot?.computation ?? {})),
  );
  const missingSelectedManifest = await helper(missingSelected.taxCaseId, missingSelected.snapId, "new");
  check(
    "S11e SELECTED-REGIME helper fails CLOSED when the SELECTED regime's own total is absent (AUDIT-05-F4(a))",
    missingSelectedManifest.status >= 400 &&
      JSON.stringify(missingSelectedManifest.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(missingSelectedManifest.body),
  );

  // F4(b) through the selected-regime path specifically, not only the
  // conservative one.
  const stringVerdictRegime = await seed("f4-string-verdict-regime", THRESHOLD + 2000000, {}, "true");
  const stringVerdictManifest = await helper(stringVerdictRegime.taxCaseId, stringVerdictRegime.snapId, "new");
  check(
    'S11f SELECTED-REGIME helper does not release on a JSON STRING "true" verdict either (AUDIT-05-F4(b))',
    stringVerdictManifest.status >= 400 &&
      JSON.stringify(stringVerdictManifest.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(stringVerdictManifest.body),
  );

  // ---- [S12] K4-12. The SEPARATE section 87A REBATE-threshold relief gate.
  //      Every income here is ~₹12 lakh, three orders of magnitude BELOW the
  //      ₹50,00,000 surcharge threshold, so the surcharge blocker cannot fire
  //      for any of them — which is what makes these a clean isolation of the
  //      new gate rather than a re-test of the old one. That disjointness is
  //      itself asserted in S12a.
  const REBATE_CODE = "REBATE_MARGINAL_RELIEF_UNSUPPORTED";
  const IN_WINDOW = { old: 1245000, new: 1220000 };

  const rebateNoVerdict = await seed("rebate-no-verdict", 1220000, IN_WINDOW);
  const rebateNoVerdictPrep = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: rebateNoVerdict.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S12a in-window case with NO 87A verdict (a pre-K4-12 snapshot) is refused by prepare_client_review",
    rebateNoVerdictPrep.status >= 400 && JSON.stringify(rebateNoVerdictPrep.body ?? "").includes(REBATE_CODE),
    JSON.stringify(rebateNoVerdictPrep.body),
  );
  check(
    "S12a' …and it is refused under the REBATE code, not the surcharge one — the two are not conflated",
    !JSON.stringify(rebateNoVerdictPrep.body ?? "").includes(BLOCKER_CODE),
    JSON.stringify(rebateNoVerdictPrep.body),
  );

  const rebateFalse = await seed("rebate-false", 1220000, IN_WINDOW, undefined, { rebateReliefSupported: false });
  const rebateFalsePrep = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: rebateFalse.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S12b an explicit UNsupported 87A verdict is refused",
    rebateFalsePrep.status >= 400 && JSON.stringify(rebateFalsePrep.body ?? "").includes(REBATE_CODE),
    JSON.stringify(rebateFalsePrep.body),
  );

  const rebateString = await seed("rebate-string", 1220000, IN_WINDOW, undefined, { rebateReliefSupported: "true" });
  const rebateStringPrep = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: rebateString.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    'S12c a JSON STRING "true" verdict does NOT release the 87A gate either (AUDIT-05-F4(b) applied to the new helper)',
    rebateStringPrep.status >= 400 && JSON.stringify(rebateStringPrep.body ?? "").includes(REBATE_CODE),
    JSON.stringify(rebateStringPrep.body),
  );

  // THE narrowing: the only thing that releases an in-window case.
  const rebateOk = await seed("rebate-supported", 1220000, IN_WINDOW, undefined, { rebateReliefSupported: true });
  const rebateOkPrep = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: rebateOk.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S12d an in-window case WITH a supported 87A verdict is released",
    rebateOkPrep.status < 400,
    JSON.stringify(rebateOkPrep.body),
  );

  // Boundary: exactly the ₹12,00,000 ceiling is clause (a) territory, where no
  // relief question arises — it must NOT be blocked, even with no verdict.
  const rebateAtCeiling = await seed("rebate-at-ceiling", 1200000, { old: 1200000, new: 1200000 });
  const rebateAtCeilingPrep = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: rebateAtCeiling.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S12e EXACTLY ₹12,00,000 is not blocked — clause (a) applies and no relief arises",
    rebateAtCeilingPrep.status < 400,
    JSON.stringify(rebateAtCeilingPrep.body),
  );

  // The upper edge is what stops this blocker from sweeping up every ordinary
  // case above ₹12,00,000 whose snapshot predates K4-12.
  const rebateAboveWindow = await seed("rebate-above-window", 3000000, { old: 3000000, new: 3000000 });
  const rebateAboveWindowPrep = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: rebateAboveWindow.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S12f an ordinary case ABOVE the relief window is untouched, verdict or no verdict",
    rebateAboveWindowPrep.status < 400,
    JSON.stringify(rebateAboveWindowPrep.body),
  );

  // Admin is not a bypass, and finalize re-checks independently of prepare.
  const rebateAdmin = await seed("rebate-admin", 1220000, IN_WINDOW);
  const rebateAdminPrep = await rpc("prepare_client_review", adminTok, {
    p_tax_case_id: rebateAdmin.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S12g admin does not bypass the 87A gate",
    rebateAdminPrep.status >= 400 && JSON.stringify(rebateAdminPrep.body ?? "").includes(REBATE_CODE),
    JSON.stringify(rebateAdminPrep.body),
  );

  const rebateFinal = await seed("rebate-finalize", 1220000, IN_WINDOW);
  const rebateFinalRes = await rpc("finalize_tax_case", adminTok, {
    p_tax_case_id: rebateFinal.taxCaseId,
    p_snapshot_id: rebateFinal.snapId,
    p_note: "k4-12 security probe",
    p_confirm: true,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S12h finalize_tax_case independently refuses an in-window case (defense in depth, not prepare alone)",
    rebateFinalRes.status >= 400 && JSON.stringify(rebateFinalRes.body ?? "").includes(REBATE_CODE),
    JSON.stringify(rebateFinalRes.body),
  );

  const rebateManifest = await seed("rebate-manifest", 1220000, IN_WINDOW);
  // Called through the raw RPC rather than `manifestViaRpc`, which THROWS on a
  // non-2xx — correct for the scenarios that expect a manifest to be created,
  // useless for one that expects a refusal to inspect.
  const rebateManifestRes = await rpc("create_evidence_manifest", staffTok, {
    p_tax_case_id: rebateManifest.taxCaseId,
    p_snapshot_id: rebateManifest.snapId,
    p_selected_regime: "new",
    p_manifest_payload: { schemaVersion: "TAX_EVIDENCE_MANIFEST_V1", figures: [], evidenceFacts: [] },
    p_manifest_content_hash: crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex"),
    p_validation_rules_version: "K2.8.readiness.v1",
    p_tax_pack_id: "ITA_1961:2026-27",
    p_tax_pack_version: "AY_2026_27_V0_PREP_ONLY",
    p_tax_pack_lifecycle_status: "draft",
    p_pre_approval_capability_result: {},
    p_snapshot_capability_result: {},
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S12i create_evidence_manifest independently refuses an in-window case",
    rebateManifestRes.status >= 400 && JSON.stringify(rebateManifestRes.body ?? "").includes(REBATE_CODE),
    JSON.stringify(rebateManifestRes.body),
  );

  // The relief reaches the NEW regime only, so the gate reads the new-regime
  // figure — an OLD-regime income inside the band must not block on its own.
  const rebateOldOnly = await seed("rebate-old-only", 1220000, { old: 1220000, new: 3000000 });
  const rebateOldOnlyPrep = await rpc("prepare_client_review", staffTok, {
    p_tax_case_id: rebateOldOnly.taxCaseId,
    p_event_id: crypto.randomUUID(),
  });
  check(
    "S12j an OLD-regime income inside the band does not block — the relief is new-regime-only",
    rebateOldOnlyPrep.status < 400,
    JSON.stringify(rebateOldOnlyPrep.body),
  );

  console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
  if (failures.length) {
    console.log("FAILURES:\n - " + failures.join("\n - "));
    process.exit(1);
  }
  console.log("ALL SURCHARGE/MARGINAL-RELIEF BLOCKER ASSERTIONS PASSED.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
