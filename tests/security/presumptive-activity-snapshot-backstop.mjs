// TAX-SAFE-03 — LOCAL-ONLY guarded-boundary security proof.
//
// Proves all four reliance boundaries fail closed for:
//   * a legacy complete presumptive snapshot with no activity contract;
//   * a malformed verdict (`"true"`, not a JSON boolean);
//   * an eligible snapshot followed by an ineligible live activity change.
// Also carries eligible 44AD and 44ADA cases through prepare -> manifest ->
// approval -> finalization. Every attack uses a real staff token; the local
// service role is fixture setup/forensic read only.
import crypto from "node:crypto";
import fs from "node:fs";

const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321/.test(API)) {
  throw new Error(`Refusing non-local target: ${API}`);
}

function envFallback(key) {
  if (process.env[key]) return process.env[key];
  try {
    const env = fs.readFileSync(".env.local", "utf8");
    const match = env.match(new RegExp(`^${key}=(.*)$`, "m"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

const ANON = envFallback("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = envFallback("SUPABASE_SERVICE_ROLE_KEY");
if (!ANON || !SERVICE) throw new Error("Missing local Supabase keys.");

async function http(method, path, { token, apikey, body, prefer } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: {
      apikey: apikey ?? ANON,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

const svc = (method, path, body, prefer) =>
  http(method, path, { apikey: SERVICE, token: SERVICE, body, prefer });
const rpc = (fn, token, body) =>
  http("POST", `/rest/v1/rpc/${fn}`, { token, body });

async function authPassword(email, password) {
  const response = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await response.json()).access_token;
}

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const CONTRACT_VERSION = "TAX_SAFE_03.presumptive_activity_snapshot.v1";
const BLOCK_CODES = {
  legacy: "PRESUMPTIVE_ACTIVITY_SNAPSHOT_MALFORMED",
  malformed: "PRESUMPTIVE_ACTIVITY_SNAPSHOT_MALFORMED",
  stale: "PRESUMPTIVE_ACTIVITY_SNAPSHOT_STALE",
};

async function main() {
  console.log(`Target ${API}\n`);
  const staffToken = await authPassword("staff@e2e.test", "e2e-staff-password");
  if (!staffToken) throw new Error("Could not obtain local staff token; run E2E bootstrap.");
  const admin = (
    await svc("GET", "/rest/v1/users?role=eq.admin&is_active=eq.true&select=id&limit=1")
  ).body[0];
  const service = (
    await svc("GET", "/rest/v1/services?code=eq.itr&select=id&limit=1")
  ).body[0];

  async function seed(scheme) {
    const id = crypto.randomUUID();
    const short = id.slice(0, 8);
    const isAda = scheme === "44ADA";
    const head = isAda
      ? "presumptive_professional_44ada"
      : "presumptive_business_44ad_digital";
    const activity = isAda ? "specified_profession_44aa_1" : "other_business";
    const amount = isAda ? 1_200_000 : 1_000_000;
    const client = (
      await svc(
        "POST",
        "/rest/v1/clients",
        {
          full_name: `TAXSAFE03 ${scheme} ${short}`,
          primary_phone: `9${short.replace(/\D/g, "").padEnd(9, "0")}`.slice(0, 10),
          date_of_birth: "1990-05-05",
        },
        "return=representation",
      )
    ).body[0];
    const parent = (
      await svc(
        "POST",
        "/rest/v1/cases",
        {
          display_code: `TDX-TAXSAFE03-${short}`,
          client_id: client.id,
          service_id: service.id,
          title: "ITR",
          status: "new_lead",
          owner_id: admin.id,
          priority: "normal",
          service_data: { ay: "2026-27" },
        },
        "return=representation",
      )
    ).body[0];
    const taxCase = (
      await svc(
        "POST",
        "/rest/v1/tax_cases",
        {
          case_id: parent.id,
          client_id: client.id,
          assessment_year: "2026-27",
          financial_year: "2025-26",
          itr_type_selected: "ITR-4",
          itr_type_recommended: "ITR-4",
          residential_status: "resident",
          taxpayer_category: "individual",
          declared_special_situations: [],
        },
        "return=representation",
      )
    ).body[0];
    const income = (
      await svc(
        "POST",
        "/rest/v1/tax_income_entries",
        {
          tax_case_id: taxCase.id,
          income_head: head,
          amount,
          source_type: "manual",
          receipts_via_banking_channels: isAda,
          presumptive_activity_type: activity,
          created_by: admin.id,
          updated_by: admin.id,
        },
        "return=representation",
      )
    ).body[0];
    const contract = {
      version: CONTRACT_VERSION,
      eligible: true,
      rows: [
        {
          ledgerId: income.id,
          incomeHead: head,
          amount,
          activityType: activity,
          bankingChannelsConfirmed: isAda,
        },
      ],
    };
    const inputSnapshot = {
      complete: true,
      eligibility: { eligible: true, version: "test", blockerCodes: [] },
      engineInput: {
        assessmentYear: "2026-27",
        financialYear: "2025-26",
        selectedItrType: "ITR-4",
        income: [
          {
            id: income.id,
            category: head,
            amount,
            sourceType: "manual",
          },
        ],
        taxPaid: [],
        deductions: [],
        capitalGains: [],
        sourceRecordIds: [income.id],
        presumptiveActivityEligibility: contract,
      },
      summary: {},
    };
    const snapshot = (
      await svc(
        "POST",
        "/rest/v1/tax_computation_snapshots",
        {
          tax_case_id: taxCase.id,
          rules_version: "AY_2026_27_V0_PREP_ONLY",
          input_snapshot: inputSnapshot,
          output_snapshot: {
            computation: {
              oldRegime: { totalIncome: { value: 100_000 } },
              newRegime: { totalIncome: { value: 100_000 } },
              surchargeTreatmentSupported: true,
              rebateReliefTreatmentSupported: true,
            },
          },
          is_final: false,
          created_by: admin.id,
        },
        "return=representation",
      )
    ).body[0];
    return {
      caseId: parent.id,
      taxCaseId: taxCase.id,
      incomeId: income.id,
      snapshotId: snapshot.id,
      inputSnapshot,
    };
  }

  const manifestArgs = (fixture) => ({
    p_tax_case_id: fixture.taxCaseId,
    p_snapshot_id: fixture.snapshotId,
    p_selected_regime: "new",
    p_manifest_payload: {
      schemaVersion: "TAX_EVIDENCE_MANIFEST_V1",
      figures: [],
      evidenceFacts: [],
    },
    p_manifest_content_hash: crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex"),
    p_validation_rules_version: "K2.8.readiness.v1",
    p_tax_pack_id: "ITA_1961:2026-27",
    p_tax_pack_version: "AY_2026_27_V0_PREP_ONLY",
    p_tax_pack_lifecycle_status: "draft",
    p_pre_approval_capability_result: {},
    p_snapshot_capability_result: {},
    p_event_id: crypto.randomUUID(),
  });

  async function prepare(fixture) {
    return rpc("prepare_client_review", staffToken, {
      p_tax_case_id: fixture.taxCaseId,
      p_event_id: crypto.randomUUID(),
    });
  }
  async function createManifest(fixture) {
    return rpc("create_evidence_manifest", staffToken, manifestArgs(fixture));
  }
  async function capture(fixture, manifestId) {
    return rpc("capture_client_approval", staffToken, {
      p_tax_case_id: fixture.taxCaseId,
      p_manifest_id: manifestId,
      p_method: "whatsapp",
      p_reference: "synthetic-local-test",
      p_approved_at: new Date().toISOString(),
      p_event_id: crypto.randomUUID(),
    });
  }
  async function finalize(fixture) {
    return rpc("finalize_tax_case", staffToken, {
      p_tax_case_id: fixture.taxCaseId,
      p_snapshot_id: fixture.snapshotId,
      p_note: "synthetic local TAX-SAFE-03 proof",
      p_confirm: true,
      p_event_id: crypto.randomUUID(),
    });
  }

  async function plant(fixture, kind) {
    if (kind === "stale") {
      await svc(
        "PATCH",
        `/rest/v1/tax_income_entries?id=eq.${fixture.incomeId}`,
        { presumptive_activity_type: "commission_or_brokerage" },
      );
      return;
    }
    const changed = structuredClone(fixture.inputSnapshot);
    if (kind === "legacy") {
      delete changed.engineInput.presumptiveActivityEligibility;
    } else {
      changed.engineInput.presumptiveActivityEligibility.eligible = "true";
    }
    await svc(
      "PATCH",
      `/rest/v1/tax_computation_snapshots?id=eq.${fixture.snapshotId}`,
      { input_snapshot: changed },
    );
  }

  async function assertRejected(name, response, code) {
    check(
      name,
      response.status >= 400 && JSON.stringify(response.body).includes(code),
      `HTTP ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  for (const scheme of ["44AD", "44ADA"]) {
    const fixture = await seed(scheme);
    const prep = await prepare(fixture);
    check(`${scheme} positive: prepare succeeds`, prep.status < 300, JSON.stringify(prep.body));
    const manifest = await createManifest(fixture);
    check(`${scheme} positive: manifest succeeds`, manifest.status < 300, JSON.stringify(manifest.body));
    const approval = await capture(fixture, manifest.body);
    check(`${scheme} positive: approval succeeds`, approval.status < 300, JSON.stringify(approval.body));
    const final = await finalize(fixture);
    check(`${scheme} positive: finalize succeeds`, final.status < 300, JSON.stringify(final.body));
  }

  for (const kind of ["legacy", "malformed", "stale"]) {
    const code = BLOCK_CODES[kind];

    const prepFixture = await seed("44AD");
    await plant(prepFixture, kind);
    await assertRejected(`${kind}: prepare fails closed`, await prepare(prepFixture), code);
    const prepState = (
      await svc("GET", `/rest/v1/tax_cases?id=eq.${prepFixture.taxCaseId}&select=client_review_status`)
    ).body[0];
    check(`${kind}: prepare leaves no partial write`, prepState.client_review_status === "not_started");

    const manifestFixture = await seed("44AD");
    await plant(manifestFixture, kind);
    await assertRejected(`${kind}: manifest fails closed`, await createManifest(manifestFixture), code);
    const manifestRows = (
      await svc("GET", `/rest/v1/tax_evidence_manifests?tax_case_id=eq.${manifestFixture.taxCaseId}&select=id`)
    ).body;
    check(`${kind}: manifest leaves no partial write`, manifestRows.length === 0);

    const captureFixture = await seed("44AD");
    const capturePrep = await prepare(captureFixture);
    const captureManifest = await createManifest(captureFixture);
    if (capturePrep.status >= 300 || captureManifest.status >= 300) {
      throw new Error(`capture setup failed for ${kind}`);
    }
    await plant(captureFixture, kind);
    await assertRejected(
      `${kind}: approval fails closed independently`,
      await capture(captureFixture, captureManifest.body),
      code,
    );
    const captureState = (
      await svc("GET", `/rest/v1/tax_cases?id=eq.${captureFixture.taxCaseId}&select=client_review_status`)
    ).body[0];
    check(`${kind}: approval leaves no partial write`, captureState.client_review_status === "prepared");

    const finalFixture = await seed("44AD");
    await plant(finalFixture, kind);
    await assertRejected(
      `${kind}: finalization fails closed independently`,
      await finalize(finalFixture),
      code,
    );
    const finalState = (
      await svc("GET", `/rest/v1/tax_cases?id=eq.${finalFixture.taxCaseId}&select=finalized_at`)
    ).body[0];
    check(`${kind}: finalization leaves no partial write`, finalState.finalized_at === null);
  }

  console.log(`\n==== ${passed} passed, ${failures.length} failed ====`);
  if (failures.length > 0) {
    console.log(`FAILURES:\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  console.log("ALL PRESUMPTIVE ACTIVITY SNAPSHOT BACKSTOP CHECKS PASSED.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
