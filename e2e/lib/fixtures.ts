import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../../scripts/e2e-bootstrap.mjs";
import { buildEngineInput, type CaseMeta, type LedgerRows } from "../../src/lib/tax-desk/computation-adapter";
import { compareRegimes, computeTax, recommendItrForm } from "../../src/lib/tax-engine/ay-2026-27";
import { RULES_VERSION, SURCHARGE } from "../../src/lib/tax-engine/ay-2026-27/rules";
import {
  buildStoredComputationReplayInput,
  COMPUTATION_REPLAY_CONTRACT,
} from "../../src/lib/tax-pack/computation-replay-input";
import { TAX_INCOME_ENGINE_ROW_PROJECTION } from "../../src/lib/queries/tax-income-projection";
import { periodKindForLaw, storedTaxPackKeyForLaw } from "../../src/lib/tax-pack/case-pack";
import type { TaxLaw } from "../../src/lib/tax-pack/identity";

/**
 * Portable E2E fixtures — seed prerequisite records directly via the LOCAL
 * Supabase service-role client (replaces the brittle `docker exec … psql`
 * path from K.2.4). Local-only: refuses a hosted Supabase URL.
 *
 * Every fixture uses a unique deterministic id so re-runs never collide and
 * tests do not depend on execution order.
 */

let seq = 0;
/** Unique-per-call run id. */
export function nextRunId(): string {
  seq += 1;
  return `${Date.now().toString().slice(-8)}${seq}`;
}

let cached: SupabaseClient | null = null;
export function serviceClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "E2E fixtures need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local by playwright.config.ts).",
    );
  }
  assertLocalSupabase(url); // never seed against hosted Supabase
  cached = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return cached;
}

/**
 * Delete every tax_cases row (local-only, service role). Children — ledger
 * entries, snapshots, findings, readiness items, and sign-off reviews — are
 * removed by their `on delete cascade` FKs, so this is a clean reset of the
 * Tax Desk overlay WITHOUT a destructive `supabase db reset`.
 *
 * Used to establish the deterministic empty-state precondition for the shell
 * spec: the dashboard/list empty state ("No ITR prep cases yet") only renders
 * when zero tax_cases exist, and prior runs leave hundreds behind. Safe in the
 * serial suite because it runs before any spec that seeds a tax_case, and every
 * later spec seeds its own data with unique run ids (no cross-spec dependency
 * on rows created earlier). The parent `cases`/`clients` rows are left intact —
 * only the Tax Desk overlay drives the empty state.
 */
export async function deleteAllTaxCases(): Promise<void> {
  const db = serviceClient();
  // PostgREST requires a filter on DELETE; match every row via a non-null id.
  const { error } = await db.from("tax_cases").delete().not("id", "is", null);
  if (error) throw new Error(`deleteAllTaxCases failed: ${error.message}`);
}

/**
 * Prune accumulated `seedTaxCase` clients ("E2E Seed …") from PRIOR runs
 * (local-only, service role). Bounds test-data growth so the `/cases/new` Client
 * dropdown — capped at 500 rows ordered by `full_name`
 * (`src/app/(app)/cases/new/page.tsx`) — always includes a freshly-created
 * client. Without this the 550+ accumulated "E2E Seed" clients fill the window
 * and hide any newly-created client whose name sorts after "Seed" (prefixes T/U/Z
 * → specs 04/08/10/11/24 failed with "No option containing …"). Run ONCE per run
 * in the setup project, before any spec (K3-ENV-1).
 *
 * `cases.client_id` is RESTRICT, so the seeded cases are deleted first (their
 * `case_documents` + `tax_cases` + ledger/snapshot descendants cascade); the
 * clients then delete cleanly. Seeded cases normally carry no uploaded_files /
 * fees / payments / consent / pdf / message / physical-doc rows (`seedTaxCase`
 * itself creates none), and `audit_logs.case_id` has no FK, so the cascade is
 * clean for every OTHER `seedTaxCase`-based spec. `K3-33` is the one exception:
 * its full-chain spec deliberately drives a REAL client upload (via the
 * generated upload link) against a `seedTaxCase`-created case — the guarded
 * `ingest_client_upload` RPC inserts one `uploaded_files` row and one
 * `consent_records` row, both plain RESTRICT FKs on `case_id` with no cascade —
 * exposed the first time a `seedTaxCase` case was also used for a real upload.
 * Both are therefore deleted explicitly before `cases`, same discipline as
 * every other RESTRICT child this function already accounts for (see `D52`).
 * Only `seedTaxCase`-created clients are HARD-deleted — never `createClient`-
 * based ones (which may own restrict children) or non-E2E data.
 *
 * `K3-ENV-4`: the "E2E Seed %" pattern alone proved too narrow. Every OTHER
 * spec-created prefix (`E2E Upload`, `E2E TaxDocs`, `E2E TaxPrep`, `E2E Aadhaar`,
 * `E2E WithPan`, `E2E ItrGuard`, …) accumulated forever until it pushed past the
 * 500-row window and reintroduced the very failure this prune exists to prevent
 * (measured: 1711 clients, 589 sorting before any `E2E Upload …` name, of which
 * non-E2E = 0). Those clients CANNOT be hard-deleted safely — `consent_records`
 * restricts on `clients`, and `cases` is restricted by `case_messages`,
 * `consent_records`, `fees`, `generated_pdfs`, `payments`, `physical_documents`
 * and `uploaded_files` — so they are **soft-deleted** instead. `clients_safe`
 * already filters `deleted_at is null`, so a soft delete removes them from the
 * dropdown window with zero referential risk and no row destruction. Still
 * synthetic-only: the `E2E ` prefix is never used by real data.
 */
export async function pruneSeedTaxCaseClients(): Promise<number> {
  const db = serviceClient();
  const { data: seed, error: selErr } = await db
    .from("clients")
    .select("id")
    .like("full_name", "E2E Seed %");
  if (selErr) throw new Error(`pruneSeedTaxCaseClients select failed: ${selErr.message}`);
  const ids = (seed ?? []).map((r) => r.id as string);
  if (ids.length === 0) return 0;

  // Chunk so the PostgREST `in.(…)` filter URL stays a sane length.
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    // K3-33/D52: delete any real uploaded_files/consent_records this batch's
    // cases may carry BEFORE deleting the cases themselves — both are plain
    // RESTRICT FKs with no cascade (unlike case_documents/tax_cases below).
    // The guarded `ingest_client_upload` RPC (Phase 8) is the only writer of
    // either table for a real client upload, and inserts into exactly these
    // two — never case_messages/fees/generated_pdfs/payments/
    // physical_documents, which stay out of scope for this fix.
    const { data: caseRows, error: caseSelErr } = await db.from("cases").select("id").in("client_id", batch);
    if (caseSelErr) throw new Error(`pruneSeedTaxCaseClients cases select failed: ${caseSelErr.message}`);
    const caseIds = (caseRows ?? []).map((r) => r.id as string);
    if (caseIds.length > 0) {
      const { error: ufErr } = await db.from("uploaded_files").delete().in("case_id", caseIds);
      if (ufErr) throw new Error(`pruneSeedTaxCaseClients uploaded_files delete failed: ${ufErr.message}`);
      const { error: crErr } = await db.from("consent_records").delete().in("case_id", caseIds);
      if (crErr) throw new Error(`pruneSeedTaxCaseClients consent_records delete failed: ${crErr.message}`);
      // K3-33/D52 (continued): tax_source_proposals.case_document_id is also a
      // plain RESTRICT FK (no cascade) onto case_documents, which itself
      // cascades from cases — so a live proposal row (from the K3-30
      // propose/review/promote workflow) blocks the case_documents cascade
      // just as surely as an uploaded_files/consent_records row blocks cases
      // directly. Delete these first too.
      //
      // The ITR checklist alone seeds ~19 case_documents rows per case
      // (`itr_checklist_ay2026.sql`), so a full 100-case batch can carry
      // ~1900 rows — comfortably over PostgREST's `max_rows = 1000` default,
      // which TRUNCATES a plain `.select()` silently (no error, just a
      // partial page) rather than refusing. A first version of this fix used
      // one unpaginated select and missed every row past the 1000th,
      // reproducibly leaving a stray proposal behind to block the very
      // `cases` delete this function exists to perform. Paginate explicitly.
      const docIds: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: page, error: docSelErr } = await db
          .from("case_documents")
          .select("id")
          .in("case_id", caseIds)
          .range(offset, offset + 999);
        if (docSelErr) throw new Error(`pruneSeedTaxCaseClients case_documents select failed: ${docSelErr.message}`);
        for (const r of page ?? []) docIds.push(r.id as string);
        if (!page || page.length < 1000) break;
      }
      // Chunk so the PostgREST `in.(…)` filter URL stays a sane length.
      for (let j = 0; j < docIds.length; j += chunkSize) {
        const docBatch = docIds.slice(j, j + chunkSize);
        const { error: propErr } = await db.from("tax_source_proposals").delete().in("case_document_id", docBatch);
        if (propErr) throw new Error(`pruneSeedTaxCaseClients tax_source_proposals delete failed: ${propErr.message}`);
      }
    }
    const { error } = await db.from("cases").delete().in("client_id", batch);
    if (error) throw new Error(`pruneSeedTaxCaseClients cases delete failed: ${error.message}`);
  }
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    const { error } = await db.from("clients").delete().in("id", batch);
    if (error) throw new Error(`pruneSeedTaxCaseClients clients delete failed: ${error.message}`);
  }
  return ids.length;
}

/**
 * `K3-ENV-4`: soft-delete every OTHER accumulated `E2E %` client from prior runs
 * so none of them occupy the `/cases/new` 500-row window. See the note on
 * {@link pruneSeedTaxCaseClients} for why these are soft- rather than
 * hard-deleted. Idempotent: rows already soft-deleted are skipped.
 */
export async function softDeleteAccumulatedE2eClients(): Promise<number> {
  const db = serviceClient();
  const { data: rows, error: selErr } = await db
    .from("clients")
    .select("id")
    .like("full_name", "E2E %")
    .is("deleted_at", null);
  if (selErr) throw new Error(`softDeleteAccumulatedE2eClients select failed: ${selErr.message}`);
  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length === 0) return 0;

  const stamp = new Date().toISOString();
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    const { error } = await db.from("clients").update({ deleted_at: stamp }).in("id", batch);
    if (error) {
      throw new Error(`softDeleteAccumulatedE2eClients update failed: ${error.message}`);
    }
  }
  return ids.length;
}

/**
 * Normal (non-deferred) Tax Desk service codes — mirrors
 * `NORMAL_SERVICE_CODES` in `src/lib/services/catalog.ts` (that module is not
 * imported here to keep the E2E fixture layer decoupled from app source
 * resolution; `e2e/helpers.ts`'s `NORMAL_SERVICE_LABELS` already duplicates
 * this same knowledge by label rather than code).
 */
const NORMAL_SERVICE_CODES_E2E = ["itr", "gst"];

/**
 * Soft-delete accumulated synthetic DEFERRED-service (e.g. IEPF) cases from
 * PRIOR runs, scoped to `E2E %`-named clients only (local-only, service
 * role).
 *
 * Deferred-service cases get no other cleanup: `pruneSeedTaxCaseClients` /
 * `softDeleteAccumulatedE2eClients` only prune the `clients` table, never the
 * `cases` rows those clients own. They accumulate release over release until
 * `/cases?service=<code>` (`src/app/(app)/cases/page.tsx`) — ordered by
 * `next_action_due` ascending (nullsFirst:false), capped at 200 — has more
 * than 200 rows for that service, at which point a freshly created case
 * (always `next_action_due = null`, tied with every other null-due row) can
 * land outside the capped window (measured: 215 IEPF cases against a 200
 * cap). Soft-deleted rather than hard-deleted, same reasoning as
 * `pruneSeedTaxCaseClients`: `cases` is referenced by several
 * RESTRICT-constrained children, and the list query already filters on
 * `deleted_at is null`, so this is a clean, safe, idempotent removal from
 * every list view without touching any FK-restricted child or the client
 * itself.
 */
export async function pruneAccumulatedDeferredServiceCases(): Promise<number> {
  const db = serviceClient();
  const { data: rows, error: selErr } = await db
    .from("cases")
    .select("id, services!inner(code), clients!inner(full_name)")
    .is("deleted_at", null)
    .like("clients.full_name", "E2E %");
  if (selErr) throw new Error(`pruneAccumulatedDeferredServiceCases select failed: ${selErr.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = ((rows ?? []) as any[])
    .filter((r) => !NORMAL_SERVICE_CODES_E2E.includes(r.services?.code))
    .map((r) => r.id as string);
  if (ids.length === 0) return 0;

  const stamp = new Date().toISOString();
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    const { error } = await db.from("cases").update({ deleted_at: stamp }).in("id", batch);
    if (error) throw new Error(`pruneAccumulatedDeferredServiceCases update failed: ${error.message}`);
  }
  return ids.length;
}

export interface SeedIncome {
  income_head: string;
  amount: number;
  source_type?: string;
  mapFirstDoc?: boolean;
  /** Ledger note — MUST NOT appear in computation snapshots (tested). */
  notes?: string;
  receipts_via_banking_channels?: boolean | null;
  presumptive_activity_type?: string | null;
}
export interface SeedTaxPaid {
  tax_paid_type: string;
  amount: number;
  source_type?: string;
}
export interface SeedDeduction {
  deduction_type: string;
  amount: number;
  section_code?: string;
  source_type?: string;
}
export interface SeedCapitalGain {
  gain_type: string;
  taxable_gain: number;
  sale_value?: number;
  cost?: number;
  expenses?: number;
  exemption_claimed?: number;
  source_type?: string;
}

/** K4-10 / OPS-13: a prior-year Section 74 capital-loss record. */
export interface SeedBroughtForwardLoss {
  originating_assessment_year: string;
  loss_type: "stcl" | "ltcl";
  amount: number;
  filing_eligibility: "verified_timely" | "unverified" | "not_eligible";
  loss_provenance: "prior_finalized_case_in_system" | "staff_declared";
  elected_set_off_target?: "stcg_111a" | "ltcg_112a" | null;
  source_type?: string;
  mapFirstDoc?: boolean;
  mapProofDoc?: boolean;
}

/** K4-14: one books-based business or profession (Sections 28/29). */
export interface SeedBusinessBooks {
  revenue: number;
  expenses: number;
  is_profession?: boolean;
  /** REQUIRED, exactly as the column is: absence is not a member. */
  adjustments: string;
  /** REQUIRED K4-17 loss-pool classification; absence fails closed. */
  activity_classification: string;
  /** K4-18: preparer-declared Section 44AB turnover. Required by the adapter
   *  for a classification whose books revenue is NOT its turnover (currently
   *  `fno_non_speculative_s43_5_d`); omit for an ordinary undertaking. Omitting
   *  it on an F&O row is a legitimate fixture — it seeds the refusal. */
  declared_turnover?: number;
  source_type?: string;
}

/** Taxpayer profile override (K.2.8.9A). Omit for a default ELIGIBLE profile
 *  (resident individual, DOB set). Pass `null` to seed NO profile (ineligible).
 *  Pass a partial object to control individual fields (missing keys stay eligible). */
export interface SeedProfile {
  dateOfBirth?: string | null;
  residentialStatus?: string | null;
  taxpayerCategory?: string | null;
  declaredSituations?: string[];
}

export interface SeedOptions {
  itrTypeSelected?: string;
  finalized?: boolean;
  income?: SeedIncome[];
  taxPaid?: SeedTaxPaid[];
  deductions?: SeedDeduction[];
  capitalGains?: SeedCapitalGain[];
  broughtForwardLosses?: SeedBroughtForwardLoss[];
  /** K4-14: books-based business/profession rows. */
  businessBooks?: SeedBusinessBooks[];
  /** Taxpayer profile. Default: eligible. `null`: no profile (ineligible). */
  profile?: SeedProfile | null;
  /**
   * Statutory world. Default `ITA_1961`. `ITA_2025` seeds a TY case that
   * resolves unbound — there is no computation surface (`K4-PORT-08`).
   */
  law?: TaxLaw;
}

export interface SeededCase {
  runId: string;
  clientId: string;
  caseId: string;
  taxCaseId: string;
  clientName: string;
  /** Parent-case checklist doc name → id (for source mapping). */
  docByName: Record<string, string>;
}

/**
 * Seed a client + parent ITR case + its checklist + a tax_case (+ optional
 * ledger rows), returning their ids. Idempotent per call (unique run id).
 */
export async function seedTaxCase(opts: SeedOptions = {}): Promise<SeededCase> {
  const db = serviceClient();
  const runId = nextRunId();
  const clientName = `E2E Seed ${runId}`;

  const { data: owner } = await db
    .from("users")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!owner) throw new Error("seedTaxCase: no active admin user (run test:e2e:bootstrap first).");

  const { data: service } = await db.from("services").select("id").eq("code", "itr").maybeSingle();
  if (!service) throw new Error("seedTaxCase: itr service not found (run supabase db reset).");

  // Resolve the taxpayer profile (K.2.8.9A). Default = eligible resident
  // individual with a DOB; `profile: null` seeds no profile (ineligible).
  const P = opts.profile;
  const seedProfile =
    P === null
      ? null
      : {
          dob: P && "dateOfBirth" in P ? P.dateOfBirth : "1990-05-05",
          res: P && "residentialStatus" in P ? P.residentialStatus : "resident",
          cat: P && "taxpayerCategory" in P ? P.taxpayerCategory : "individual",
          situations: P?.declaredSituations ?? [],
        };

  const { data: client, error: clientErr } = await db
    .from("clients")
    .insert({
      full_name: clientName,
      primary_phone: `9${runId.slice(-9).padStart(9, "0")}`,
      date_of_birth: seedProfile ? seedProfile.dob : null,
    })
    .select("id")
    .single();
  if (clientErr || !client) throw new Error(`seedTaxCase client insert failed: ${clientErr?.message}`);

  const { data: kase, error: caseErr } = await db
    .from("cases")
    .insert({
      display_code: `TDX-ITR-E2E-${runId}`,
      client_id: client.id,
      service_id: service.id,
      title: "ITR Filing",
      status: "new_lead",
      owner_id: owner.id,
      priority: "normal",
      service_data: { ay: "2026-27", regime: "undecided" },
    })
    .select("id")
    .single();
  if (caseErr || !kase) throw new Error(`seedTaxCase case insert failed: ${caseErr?.message}`);

  // Instantiate the ITR checklist so the source-document dropdown has options.
  const { data: reqs } = await db
    .from("document_requirements")
    .select("id, name, is_required, services!inner(code)")
    .eq("services.code", "itr")
    .eq("is_active", true);
  const docByName: Record<string, string> = {};
  if (reqs && reqs.length > 0) {
    const { data: docs } = await db
      .from("case_documents")
      .insert(reqs.map((r) => ({ case_id: kase.id, requirement_id: r.id, name: r.name, is_required: r.is_required })))
      .select("id, name");
    for (const d of docs ?? []) docByName[d.name] = d.id;
  }

  const law = opts.law ?? "ITA_1961";
  const { data: taxCase, error: tcErr } = await db
    .from("tax_cases")
    .insert({
      case_id: kase.id,
      client_id: client.id,
      assessment_year: "2026-27",
      financial_year: "2025-26",
      law,
      period_kind: periodKindForLaw(law),
      tax_pack_key: storedTaxPackKeyForLaw(law),
      itr_type_selected: opts.itrTypeSelected ?? null,
      residential_status: seedProfile ? seedProfile.res : null,
      taxpayer_category: seedProfile ? seedProfile.cat : null,
      declared_special_situations: seedProfile ? seedProfile.situations : [],
    })
    .select("id")
    .single();
  if (tcErr || !taxCase) throw new Error(`seedTaxCase tax_case insert failed: ${tcErr?.message}`);

  const firstDocId = Object.values(docByName)[0] ?? null;

  if (opts.income?.length) {
    await db.from("tax_income_entries").insert(
      opts.income.map((e) => ({
        tax_case_id: taxCase.id,
        income_head: e.income_head,
        amount: e.amount,
        source_type: e.source_type ?? "manual",
        source_document_id: e.mapFirstDoc ? firstDocId : null,
        notes: e.notes ?? null,
        receipts_via_banking_channels:
          e.receipts_via_banking_channels ?? null,
        presumptive_activity_type: e.presumptive_activity_type ?? null,
        created_by: owner.id,
        updated_by: owner.id,
      })),
    );
  }
  if (opts.taxPaid?.length) {
    await db.from("tax_tax_paid_entries").insert(
      opts.taxPaid.map((e) => ({
        tax_case_id: taxCase.id,
        tax_paid_type: e.tax_paid_type,
        amount: e.amount,
        source_type: e.source_type ?? "manual",
        created_by: owner.id,
        updated_by: owner.id,
      })),
    );
  }
  if (opts.deductions?.length) {
    await db.from("tax_deduction_entries").insert(
      opts.deductions.map((e) => ({
        tax_case_id: taxCase.id,
        deduction_type: e.deduction_type,
        section_code: e.section_code ?? null,
        amount: e.amount,
        source_type: e.source_type ?? "manual",
        created_by: owner.id,
        updated_by: owner.id,
      })),
    );
  }
  if (opts.capitalGains?.length) {
    await db.from("tax_capital_gain_entries").insert(
      opts.capitalGains.map((e) => ({
        tax_case_id: taxCase.id,
        gain_type: e.gain_type,
        sale_value: e.sale_value ?? 0,
        cost: e.cost ?? 0,
        expenses: e.expenses ?? 0,
        exemption_claimed: e.exemption_claimed ?? 0,
        taxable_gain: e.taxable_gain,
        source_type: e.source_type ?? "manual",
        created_by: owner.id,
        updated_by: owner.id,
      })),
    );
  }

  if (opts.broughtForwardLosses?.length) {
    await db.from("tax_brought_forward_loss_entries").insert(
      opts.broughtForwardLosses.map((e) => ({
        tax_case_id: taxCase.id,
        originating_assessment_year: e.originating_assessment_year,
        loss_type: e.loss_type,
        amount: e.amount,
        filing_eligibility: e.filing_eligibility,
        loss_provenance: e.loss_provenance,
        elected_set_off_target: e.elected_set_off_target ?? null,
        source_type: e.source_type ?? "manual",
        source_document_id: e.mapFirstDoc ? firstDocId : null,
        proof_case_document_id: e.mapProofDoc ? firstDocId : null,
        created_by: owner.id,
        updated_by: owner.id,
      })),
    );
  }

  if (opts.businessBooks?.length) {
    await db.from("tax_business_books_entries").insert(
      opts.businessBooks.map((e) => ({
        tax_case_id: taxCase.id,
        revenue: e.revenue,
        expenses: e.expenses,
        is_profession: e.is_profession ?? false,
        adjustments: Array.isArray(e.adjustments) ? e.adjustments : [e.adjustments],
        activity_classification: e.activity_classification,
        declared_turnover: e.declared_turnover ?? null,
        source_type: e.source_type ?? "manual",
        created_by: owner.id,
        updated_by: owner.id,
      })),
    );
  }

  // A finalized case is always bound to a computation snapshot — the guarded
  // finalize RPC requires it, and the chk_tax_cases_finalized_snapshot coherence
  // constraint (K.2.8.8B) enforces it at the DB. Seed a matching snapshot from
  // the just-inserted ledger data, then lock the case bound to it.
  if (opts.finalized) {
    const snapshotId = await seedMatchingSnapshot(taxCase.id);
    await db
      .from("tax_cases")
      .update({
        finalized_at: new Date().toISOString(),
        finalized_by: owner.id,
        finalized_snapshot_id: snapshotId,
      })
      .eq("id", taxCase.id);
  }

  return {
    runId,
    clientId: client.id,
    caseId: kase.id,
    taxCaseId: taxCase.id,
    clientName,
    docByName,
  };
}

async function adminId(db: SupabaseClient): Promise<string> {
  const { data } = await db.from("users").select("id").eq("role", "admin").eq("is_active", true).limit(1).maybeSingle();
  if (!data) throw new Error("no admin user (run test:e2e:bootstrap)");
  return data.id;
}

/** Insert a single income row; returns its id (used to add/remove unsupported entries). */
export async function addIncomeRow(taxCaseId: string, income_head: string, amount: number): Promise<string> {
  const db = serviceClient();
  const owner = await adminId(db);
  const { data, error } = await db
    .from("tax_income_entries")
    .insert({ tax_case_id: taxCaseId, income_head, amount, source_type: "manual", created_by: owner, updated_by: owner })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addIncomeRow failed: ${error?.message}`);
  return data.id;
}

/** Soft-remove a ledger row (sets deleted_at). */
export async function softRemoveLedger(table: string, id: string): Promise<void> {
  const db = serviceClient();
  await db.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
}

export interface SeededValidationCase {
  taxCaseId: string;
  caseId: string;
  houseIncomeId: string; // unsupported entry — remove it to test auto-resolve
  form16DocId: string;
}

/**
 * Seed a rich case exercising every K.2.6 rule: Form16/AIS salary mismatch,
 * Form16/26AS salary-TDS mismatch, a deduction, a supported capital gain, a
 * capital-gain arithmetic mismatch, an unsupported income entry, an exact
 * duplicate pair, mixed document statuses, and linked/unlinked source refs.
 */
export async function seedValidationCase(): Promise<SeededValidationCase> {
  const db = serviceClient();
  const owner = await adminId(db);
  const base = await seedTaxCase({ itrTypeSelected: "ITR-1" });
  const taxCaseId = base.taxCaseId;
  const form16DocId = base.docByName["Form 16 (per employer)"];
  const aisDocId = base.docByName["AIS"];

  // Mixed document statuses: Form 16 requested (not received), AIS rejected.
  if (form16DocId) await db.from("case_documents").update({ status: "requested" }).eq("id", form16DocId);
  if (aisDocId) await db.from("case_documents").update({ status: "rejected" }).eq("id", aisDocId);

  const mk = (extra: Record<string, unknown>) => ({ tax_case_id: taxCaseId, created_by: owner, updated_by: owner, ...extra });

  const { data: incRows } = await db
    .from("tax_income_entries")
    .insert([
      mk({ income_head: "salary", amount: 800000, source_type: "Form16", source_document_id: form16DocId ?? null }), // linked to a requested doc
      mk({ income_head: "salary", amount: 750000, source_type: "AIS" }), // unlinked non-manual + mismatch vs Form16
      mk({ income_head: "other_sources", amount: 5000, source_type: "manual" }), // duplicate pair
      mk({ income_head: "other_sources", amount: 5000, source_type: "manual" }),
      mk({ income_head: "house_property", amount: 120000, source_type: "manual" }), // unsupported
    ])
    .select("id, income_head");
  const houseIncomeId = ((incRows ?? []).find((r) => r.income_head === "house_property")?.id ?? "") as string;

  await db.from("tax_tax_paid_entries").insert([
    mk({ tax_paid_type: "salary_tds", amount: 60000, source_type: "Form16" }),
    mk({ tax_paid_type: "salary_tds", amount: 55000, source_type: "26AS" }), // mismatch vs Form16
  ]);
  await db.from("tax_deduction_entries").insert([mk({ deduction_type: "80C", amount: 150000, source_type: "manual" })]);
  await db.from("tax_capital_gain_entries").insert([
    mk({ gain_type: "stcg_111a", sale_value: 100000, cost: 60000, expenses: 0, exemption_claimed: 0, taxable_gain: 40000, source_type: "broker_report" }), // correct
    mk({ gain_type: "ltcg_112a", sale_value: 300000, cost: 100000, expenses: 0, exemption_claimed: 0, taxable_gain: 150000, source_type: "broker_report" }), // arithmetic mismatch (expected 200000)
  ]);

  return { taxCaseId, caseId: base.caseId, houseIncomeId, form16DocId: form16DocId ?? "" };
}

/** Read validation findings for a tax case (for lifecycle / payload assertions). */
export async function readFindings(
  taxCaseId: string,
): Promise<
  {
    code: string;
    finding_key: string | null;
    severity: string;
    status: string;
    details: unknown;
    resolution_note: string | null;
  }[]
> {
  const db = serviceClient();
  const { data } = await db
    .from("tax_validation_findings")
    .select("code, finding_key, severity, status, details, message, title, resolution_note")
    .eq("tax_case_id", taxCaseId)
    .order("created_at");
  return (data ?? []) as never;
}

/** Read raw snapshot rows for a tax case (for payload-safety assertions). */
export async function readSnapshots(
  taxCaseId: string,
): Promise<{ id: string; input_snapshot: unknown; output_snapshot: unknown }[]> {
  const db = serviceClient();
  const { data } = await db
    .from("tax_computation_snapshots")
    .select("id, input_snapshot, output_snapshot")
    .eq("tax_case_id", taxCaseId)
    .order("created_at", { ascending: false });
  return (data ?? []) as { id: string; input_snapshot: unknown; output_snapshot: unknown }[];
}

/**
 * K3-33 — read-only verification helper (service role) for the persisted
 * `tax_evidence_manifests` table introduced by `K3-32B`. Used only to confirm
 * persistence/immutability/hash-identity from the OUTSIDE after the real UI
 * has already driven manifest creation — never a shortcut into the product
 * path itself (no test creates a manifest by inserting here).
 */
export async function readEvidenceManifests(
  taxCaseId: string,
): Promise<{ id: string; computation_snapshot_id: string; selected_regime: string; manifest_content_hash: string; event_id: string | null }[]> {
  const db = serviceClient();
  const { data } = await db
    .from("tax_evidence_manifests")
    .select("id, computation_snapshot_id, selected_regime, manifest_content_hash, event_id")
    .eq("tax_case_id", taxCaseId)
    .order("created_at", { ascending: false });
  return (data ?? []) as {
    id: string;
    computation_snapshot_id: string;
    selected_regime: string;
    manifest_content_hash: string;
    event_id: string | null;
  }[];
}

/**
 * K3-33 — read-only verification helper (service role) for the persisted
 * `tax_draft_outputs` table introduced by `K3-32B`. Same discipline as
 * `readEvidenceManifests`: verification only, never a write shortcut.
 */
export async function readDraftOutputs(
  taxCaseId: string,
): Promise<{ id: string; source_manifest_id: string; package_content_hash: string; status: string }[]> {
  const db = serviceClient();
  const { data } = await db
    .from("tax_draft_outputs")
    .select("id, source_manifest_id, package_content_hash, status")
    .eq("tax_case_id", taxCaseId)
    .order("created_at", { ascending: false });
  return (data ?? []) as { id: string; source_manifest_id: string; package_content_hash: string; status: string }[];
}

// ---------------------------------------------------------------------------
// K.2.7 — client review fixtures (snapshots, findings, audit reads)
// ---------------------------------------------------------------------------

const cv = (value: number, formula = "") => ({ value, formula, sources: [], notes: [] });

export interface SeedSnapshotOptions {
  complete?: boolean;
  createdAt?: string; // ISO — controls newest-first ordering deterministically
  salary?: number;
  selectedItr?: string;
  recommendedItr?: string;
  recommendedRegime?: "old" | "new";
}

/**
 * Seed ONE immutable computation snapshot directly, mirroring the shape the
 * K.2.5 action persists (input_snapshot.summary + input_snapshot.complete +
 * output_snapshot.computation.{...}). Static, portable, PAN/Aadhaar-free.
 * Returns the snapshot id. Pass distinct `createdAt` values to force ordering.
 */
export async function seedSnapshot(taxCaseId: string, opts: SeedSnapshotOptions = {}): Promise<string> {
  const db = serviceClient();
  const owner = await adminId(db);
  const salary = opts.salary ?? 800000;
  const complete = opts.complete ?? true;
  const selectedItr = opts.selectedItr ?? "ITR-1";
  const recommendedItr = opts.recommendedItr ?? "ITR-1";
  const regime = opts.recommendedRegime ?? "new";

  const summary = {
    salary,
    interest: 12000,
    dividendOther: 5000,
    exempt: 0,
    deductions: 150000,
    stcg111a: 40000,
    ltcg112a: 0,
    totalTaxPaid: 60000,
  };
  const computation = {
    grossTotalIncome: cv(salary + 57000),
    ordinaryIncome: cv(salary + 17000),
    totalIncome: cv(salary - 93000),
    specialRateCapitalGains: cv(40000),
    deductionsAllowed: cv(150000),
    oldRegimeTax: cv(55000),
    newRegimeTax: cv(48000),
    recommendedRegime: regime,
    specialRateTax: cv(6000),
    rebate: cv(0),
    cess: cv(1920),
    grossTaxLiability: cv(49920),
    taxPaid: cv(60000),
    refundOrPayable: cv(-10080),
    // TAX-SAFE-01A: app.tax_case_surcharge_risk_blocked reads BOTH regimes'
    // totalIncome and takes the conservative higher — this fixture does not
    // model diverging old/new regime figures, so both mirror the single
    // `totalIncome` above (identical net effect to the pre-TAX-SAFE-01A
    // single-figure check for every consumer of this fixture).
    oldRegime: { totalIncome: cv(salary - 93000) },
    newRegime: { totalIncome: cv(salary - 93000) },
    // K4-11: the engine's own surcharge verdict, which every enforcement layer
    // now reads instead of re-deriving the window. DERIVED from this fixture's
    // own total income rather than hard-coded, so a seeded case behaves like a
    // real one: nil at or below ₹50,00,000, computed up to ₹2,00,00,000, and
    // NOT computed above that. `undefined` (a pre-K4-11 snapshot) would fail
    // closed and block every high-income seeded case, which would make the
    // narrowing untestable end to end.
    //
    // AUDIT-05-F6: the ceiling is now READ FROM THE ENGINE
    // (`SURCHARGE.supportedTotalIncomeCeiling`) instead of restating
    // `2_00_00_000` here. This fixture is still a mock and is NOT a production
    // authority — but a restated literal would silently disagree with the
    // engine the moment the window moved, which is precisely the drift class
    // D44/D127 exist to prevent. It is a THRESHOLD comparison, not a
    // reimplementation of the band table: what makes surcharge *arithmetic*
    // testable is `seedEngineSnapshot` below, which runs the real engine.
    surchargeTreatmentSupported: salary - 93000 <= SURCHARGE.supportedTotalIncomeCeiling,
  };

  // K3-32B: `evidence-manifest.ts` / `draft-output.ts` read the STORED
  // snapshot's `comparison` (never live-recomputed, unlike the Computation
  // page) and feed it into `describeCaseTraceability`, whose figure
  // projectors dereference `comparison.oldRegime.*` / `.newRegime.*` /
  // `.recommendedRegime` / `.difference` directly — a `{}` stub (this
  // fixture's shape before K3-32B) crashes that path. Every other reader
  // (Client Review's tax-breakdown table, the live Computation page) reads
  // only the top-level `computation` object above, never this one, so
  // populating it here is purely additive.
  const regimeComparisonFor = (regime: "old" | "new") => ({
    regime,
    standardDeduction: cv(50000),
    chapterVIADeductions: cv(0),
    deductionsAllowed: cv(150000),
    normalTaxableIncome: cv(salary - 93000),
    specialRateCapitalGains: cv(40000),
    totalIncome: cv(salary - 93000),
    slabTax: cv(regime === "old" ? 49000 : 42000),
    specialRateTax: cv(6000),
    rebate: cv(0),
    surcharge: cv(0),
    cess: cv(regime === "old" ? 2200 : 1920),
    grossTaxLiability: cv(regime === "old" ? 55000 : 48000),
    taxPaid: cv(60000),
    refundOrPayable: cv(regime === "old" ? -5000 : -10080),
    notes: [] as string[],
  });
  const comparison = {
    oldRegime: regimeComparisonFor("old"),
    newRegime: regimeComparisonFor("new"),
    recommendedRegime: regime,
    difference: cv(7000),
    notes: [] as string[],
  };

  const insert: Record<string, unknown> = {
    tax_case_id: taxCaseId,
    rules_version: RULES_VERSION,
    input_snapshot: {
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      selectedItrType: selectedItr,
      recommendedItrType: recommendedItr,
      complete,
      summary,
      mappedEntryCount: 5,
      unsupportedEntryCount: complete ? 0 : 1,
    },
    output_snapshot: { computation, comparison, recommendation: { recommendedItrType: recommendedItr } },
    is_final: false,
    created_by: owner,
  };
  if (opts.createdAt) insert.created_at = opts.createdAt;

  const { data, error } = await db.from("tax_computation_snapshots").insert(insert).select("id").single();
  if (error || !data) throw new Error(`seedSnapshot failed: ${error?.message}`);
  return data.id;
}

/**
 * `AUDIT-05-F5` — seed a snapshot whose `output_snapshot` is REAL ENGINE OUTPUT
 * for the case's own live ledger rows, not a static mock.
 *
 * Why this exists alongside `seedSnapshot`. That fixture writes hand-chosen
 * figures — `surcharge: cv(0)` for every case, and a `surchargeTreatmentSupported`
 * derived from a threshold comparison. It is fine for the many specs that only
 * need *a* complete snapshot, and deliberately left alone (a great deal depends
 * on its exact zeros). But it means a surcharge test built on it proves only
 * that the BOOLEAN is consumed: a regression returning ₹0 surcharge throughout
 * the 10% band while still reporting `supported: true` would keep every such
 * test green. `AUDIT-05` recorded that as a real coverage gap.
 *
 * This seeder closes it by doing exactly what `createComputationSnapshotAction`
 * does — `buildEngineInput` over the live rows, then `computeTax` /
 * `compareRegimes` / `recommendItrForm` — so the stored surcharge, marginal
 * relief, cess and liability are the engine's own arithmetic. A regression in
 * `computeSurcharge` changes what this fixture writes, and the assertions built
 * on it fail.
 *
 * Deliberately NOT a replacement for the server action: this is still a
 * service-role insert, so it bypasses the eligibility gate and the pack binding
 * the action enforces. It reproduces the action's OUTPUT, not its authorization.
 */
export async function seedEngineSnapshot(
  taxCaseId: string,
  opts: { createdAt?: string } = {},
): Promise<{ snapshotId: string; computation: ReturnType<typeof computeTax> }> {
  const db = serviceClient();
  const owner = await adminId(db);

  const { data: tc } = await db
    .from("tax_cases")
    .select("assessment_year, financial_year, itr_type_selected, itr_type_recommended, finalized_at, residential_status, clients(date_of_birth)")
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!tc) throw new Error(`seedEngineSnapshot: tax case ${taxCaseId} not found`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tc as any;

  const live = (table: string, cols: string) =>
    db.from(table).select(cols).eq("tax_case_id", taxCaseId).is("deleted_at", null).order("created_at");
  // The SAME column lists `getTaxCaseEligibility` reads — the adapter is the
  // single authority for `complete`, so feeding it a narrower row shape here
  // would make this fixture's completeness verdict differ from production's.
  const [income, taxPaid, deductions, capitalGains, houseProperty, businessBooks, broughtForwardLosses] = await Promise.all([
    live("tax_income_entries", TAX_INCOME_ENGINE_ROW_PROJECTION),
    live("tax_tax_paid_entries", "id, tax_paid_type, amount, source_type, source_document_id"),
    live("tax_deduction_entries", "id, deduction_type, section_code, amount, source_type, source_document_id, proof_case_document_id, insured_party_senior"),
    live("tax_capital_gain_entries", "id, gain_type, sale_value, cost, expenses, exemption_claimed, taxable_gain, transfer_date, acquisition_date, stamp_duty_value, asset_kind, acquisition_mode, cost_of_improvement, house_sale_declarations, source_type, source_document_id"),
    live("tax_house_property_entries", "id, usage, annual_rent_received, municipal_taxes_paid, home_loan_interest, source_type, source_document_id, proof_case_document_id"),
    live("tax_business_books_entries", "id, revenue, expenses, is_profession, adjustments, activity_classification, declared_turnover, source_type, source_document_id, proof_case_document_id"),
    live("tax_brought_forward_loss_entries", "id, originating_assessment_year, loss_type, amount, filing_eligibility, loss_provenance, prior_tax_case_id, elected_set_off_target, source_type, source_document_id, proof_case_document_id"),
  ]);

  const rows = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    income: (income.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    taxPaid: (taxPaid.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deductions: (deductions.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    capitalGains: (capitalGains.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    housePropertyEntries: (houseProperty.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    businessBooksEntries: (businessBooks.data ?? []) as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    broughtForwardLosses: (broughtForwardLosses.data ?? []) as any[],
  } as LedgerRows;

  const meta: CaseMeta = {
    assessmentYear: t.assessment_year,
    financialYear: t.financial_year,
    selectedItrType: t.itr_type_selected,
    finalized: !!t.finalized_at,
    dateOfBirth: t.clients?.date_of_birth ?? null,
    residentialStatus: t.residential_status ?? null,
  };

  const adapter = buildEngineInput(rows, meta);
  if (!adapter.complete) {
    throw new Error(
      `seedEngineSnapshot: adapter reports the case INCOMPLETE (${adapter.unsupportedEntryCount} unsupported entries). ` +
        "Seed only ledger rows the adapter maps — an incomplete snapshot cannot reach approval or finalization.",
    );
  }
  const computation = computeTax(adapter.input);
  const comparison = compareRegimes(adapter.input);
  const recommendation = recommendItrForm(adapter.input);
  const storedEngineInput = buildStoredComputationReplayInput(adapter.input);

  const insert: Record<string, unknown> = {
    tax_case_id: taxCaseId,
    // Read from the engine, never restated (AUDIT-05-F6's "derive, don't repeat"
    // applied to the version string as well as the ceiling).
    rules_version: RULES_VERSION,
    input_snapshot: {
      assessmentYear: meta.assessmentYear,
      financialYear: meta.financialYear,
      selectedItrType: adapter.input.selectedItrType ?? null,
      recommendedItrType: recommendation.recommendedItrType,
      complete: adapter.complete,
      // The eligibility gate is enforced by the server action, not here; this
      // records what the action would have recorded for an eligible case rather
      // than claiming an evaluation this fixture did not perform.
      eligibility: { eligible: true, version: "e2e-fixture", blockerCodes: [] as string[] },
      warningCodes: [...new Set(adapter.warnings.map((w) => w.code))],
      excludedLedgerIds: adapter.excludedLedgerIds,
      mappedEntryCount: adapter.mappedEntryCount,
      unsupportedEntryCount: adapter.unsupportedEntryCount,
      summary: adapter.summary,
      sourceTrace: adapter.sourceTrace,
      engineInputReplay: COMPUTATION_REPLAY_CONTRACT,
      engineInput: {
        ...storedEngineInput,
        presumptiveActivityEligibility:
          adapter.presumptiveActivityEligibility,
      },
    },
    output_snapshot: { computation, comparison, recommendation },
    is_final: false,
    created_by: owner,
  };
  if (opts.createdAt) insert.created_at = opts.createdAt;

  const { data, error } = await db.from("tax_computation_snapshots").insert(insert).select("id").single();
  if (error || !data) throw new Error(`seedEngineSnapshot failed: ${error?.message}`);
  return { snapshotId: data.id as string, computation };
}

/** Insert one open validation finding directly (for the error-blocks-approval path). */
export async function seedOpenFinding(
  taxCaseId: string,
  opts: { severity?: string; code?: string; findingKey?: string; title?: string } = {},
): Promise<string> {
  const db = serviceClient();
  const { data, error } = await db
    .from("tax_validation_findings")
    .insert({
      tax_case_id: taxCaseId,
      code: opts.code ?? "coverage.unsupported_entry",
      finding_key: opts.findingKey ?? `e2e-${nextRunId()}`,
      area: "ledger",
      severity: opts.severity ?? "error",
      title: opts.title ?? "Unsupported ledger entry",
      message: "Seeded finding for K.2.7 approval-gating tests.",
      status: "open",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedOpenFinding failed: ${error?.message}`);
  return data.id;
}

/** Flip a finding to resolved (simulates resolving it in Validation). */
export async function resolveFindingDirect(findingId: string): Promise<void> {
  const db = serviceClient();
  const owner = await adminId(db);
  await db
    .from("tax_validation_findings")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: owner, resolution_note: "E2E resolved." })
    .eq("id", findingId);
}

/** Count audit_logs rows for a tax case + action (audit history is append-only). */
export async function countAudit(caseId: string, action: string): Promise<number> {
  const db = serviceClient();
  const { count } = await db
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("case_id", caseId)
    .eq("action", action);
  return count ?? 0;
}

/**
 * Force the authoritative client_review_status (and optionally bind a snapshot)
 * directly, for cross-page consistency tests. Deliberately leaves the legacy
 * client_approval_status untouched (default 'not_sent'), so a dashboard/list/
 * detail that reflects the new status proves it reads client_review_status.
 */
export async function setReviewStatus(
  taxCaseId: string,
  status: string,
  snapshotId?: string,
): Promise<void> {
  const db = serviceClient();
  const patch: Record<string, unknown> = { client_review_status: status };
  if (snapshotId !== undefined) patch.client_review_snapshot_id = snapshotId;
  const { error } = await db.from("tax_cases").update(patch).eq("id", taxCaseId);
  if (error) throw new Error(`setReviewStatus failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// K.2.8 — filing readiness / finalization fixtures
// ---------------------------------------------------------------------------

/**
 * Create a complete computation snapshot whose stored engineInput EXACTLY
 * mirrors what the K.2.5 adapter produces from the case's current live ledger
 * rows — so the K.2.8 "snapshot matches live data" freshness check passes.
 * Delegates to the production-shaped engine snapshot seeder so every supported
 * ledger, the DOB/residency-derived taxpayer profile, and all three engine
 * outputs share one authority. Returns the snapshot id. Pass an older
 * `createdAt` to make a later snapshot the latest.
 */
export async function seedMatchingSnapshot(
  taxCaseId: string,
  opts: { createdAt?: string } = {},
): Promise<string> {
  const { snapshotId } = await seedEngineSnapshot(taxCaseId, opts);
  return snapshotId;
}

/** Record a current client approval bound to a specific snapshot. */
export async function approveReview(taxCaseId: string, snapshotId: string, at?: string): Promise<void> {
  const db = serviceClient();
  const owner = await adminId(db);
  const { error } = await db
    .from("tax_cases")
    .update({
      client_review_status: "approved",
      client_review_snapshot_id: snapshotId,
      client_approved_at: at ?? new Date().toISOString(),
      client_approval_captured_by: owner,
      client_approval_method: "whatsapp",
      client_approval_reference: "E2E confirmed by WhatsApp.",
    })
    .eq("id", taxCaseId);
  if (error) throw new Error(`approveReview failed: ${error.message}`);
}

/** Set the validation-run marker (defaults to now → current). */
export async function setValidationRun(taxCaseId: string, at?: string): Promise<void> {
  const db = serviceClient();
  const owner = await adminId(db);
  await db
    .from("tax_cases")
    .update({ validation_last_run_at: at ?? new Date().toISOString(), validation_last_run_by: owner, validation_rules_version: RULES_VERSION })
    .eq("id", taxCaseId);
}

/** Set required checklist documents to a status ("satisfied" verifies all;
 *  "missing" requests all; "rejected" rejects one and verifies the rest). */
export async function setRequiredDocs(caseId: string, mode: "satisfied" | "missing" | "rejected"): Promise<void> {
  const db = serviceClient();
  const { data: docs } = await db
    .from("case_documents")
    .select("id")
    .eq("case_id", caseId)
    .eq("is_required", true)
    .is("deleted_at", null)
    .order("created_at");
  const ids = (docs ?? []).map((d) => d.id);
  if (ids.length === 0) return;
  if (mode === "satisfied") {
    await db.from("case_documents").update({ status: "verified" }).in("id", ids);
  } else if (mode === "missing") {
    await db.from("case_documents").update({ status: "requested" }).in("id", ids);
  } else {
    await db.from("case_documents").update({ status: "verified" }).in("id", ids);
    await db.from("case_documents").update({ status: "rejected" }).eq("id", ids[0]!);
  }
}

export interface SeedReadinessOptions {
  /** Pass null to seed a case with NO selected ITR (itr.selected blocker). */
  itrSelected?: string | null;
  itrRecommended?: string;
  income?: SeedIncome[];
  taxPaid?: SeedTaxPaid[];
  deductions?: SeedDeduction[];
  withSnapshot?: boolean;
  approve?: boolean;
  reviewStatus?: string;
  validationRun?: boolean;
  validationStale?: boolean;
  openError?: boolean;
  docs?: "satisfied" | "missing" | "rejected";
}

const ELIGIBLE_INCOME: SeedIncome[] = [
  { income_head: "salary", amount: 800000, source_type: "Form16" },
  { income_head: "fd_interest", amount: 12000, source_type: "manual" },
];

/**
 * Compose a readiness scenario. Defaults to a fully eligible case (matching
 * snapshot, current approval, validation run, satisfied docs). Override opts to
 * craft each blocked scenario. Returns ids + the latest snapshot id.
 */
export async function seedReadinessCase(opts: SeedReadinessOptions = {}): Promise<SeededCase & { snapshotId: string | null }> {
  const db = serviceClient();
  const itrSelected = opts.itrSelected === null ? undefined : (opts.itrSelected ?? "ITR-1");
  const base = await seedTaxCase({
    itrTypeSelected: itrSelected,
    income: opts.income ?? ELIGIBLE_INCOME,
    taxPaid: opts.taxPaid ?? [{ tax_paid_type: "salary_tds", amount: 60000, source_type: "Form16" }],
    deductions: opts.deductions ?? [{ deduction_type: "80C", amount: 150000, source_type: "manual" }],
  });

  await db.from("tax_cases").update({ itr_type_recommended: opts.itrRecommended ?? "ITR-1" }).eq("id", base.taxCaseId);

  await setRequiredDocs(base.caseId, opts.docs ?? "satisfied");

  let snapshotId: string | null = null;
  if (opts.withSnapshot ?? true) snapshotId = await seedMatchingSnapshot(base.taxCaseId);

  if (opts.approve && snapshotId) await approveReview(base.taxCaseId, snapshotId);
  else if (opts.reviewStatus) await setReviewStatus(base.taxCaseId, opts.reviewStatus, snapshotId ?? undefined);

  if (opts.openError) await seedOpenFinding(base.taxCaseId, { severity: "error" });
  if (opts.validationStale) await setValidationRun(base.taxCaseId, new Date(Date.now() - 3_600_000).toISOString());
  else if (opts.validationRun) await setValidationRun(base.taxCaseId);

  return { ...base, snapshotId };
}

/**
 * Directly set finalized_at (test setup only) — used to prove SERVER-SIDE
 * mutation guards: a mutation page is loaded while the case is editable, then
 * this locks it, and the already-enabled control's action must still be
 * rejected by the server.
 */
export async function forceFinalize(taxCaseId: string, snapshotId?: string): Promise<void> {
  const db = serviceClient();
  const owner = await adminId(db);
  // Bind to a snapshot (create one if the caller did not pass one) so the
  // chk_tax_cases_finalized_snapshot coherence constraint (K.2.8.8B) is satisfied.
  const boundSnapshot = snapshotId ?? (await seedMatchingSnapshot(taxCaseId));
  const { error } = await db
    .from("tax_cases")
    .update({
      finalized_at: new Date().toISOString(),
      finalized_by: owner,
      finalized_snapshot_id: boundSnapshot,
      finalization_note: "E2E forced finalize for guard test.",
    })
    .eq("id", taxCaseId);
  if (error) throw new Error(`forceFinalize failed: ${error.message}`);
}

/** Read persisted readiness items for a tax case. */
export async function readReadinessItems(
  taxCaseId: string,
): Promise<{ code: string; status: string; is_blocking: boolean; category: string | null }[]> {
  const db = serviceClient();
  const { data } = await db
    .from("tax_readiness_items")
    .select("code, status, is_blocking, category")
    .eq("tax_case_id", taxCaseId)
    .order("code");
  return (data ?? []) as never;
}

/** Read the finalization/reopen columns for a tax case. */
export async function readFinalizationState(taxCaseId: string): Promise<Record<string, unknown> | null> {
  const db = serviceClient();
  const { data } = await db
    .from("tax_cases")
    .select(
      "finalized_at, finalized_by, finalized_snapshot_id, finalization_note, filing_status, " +
        "reopened_at, reopened_by, client_review_status, client_review_snapshot_id, client_approved_at",
    )
    .eq("id", taxCaseId)
    .maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// K.2.8.9B — qualified-reviewer sign-off fixtures
// ---------------------------------------------------------------------------

/** Return the id of the first active user of a given role. */
export async function getUserIdByRole(role: "admin" | "staff"): Promise<string> {
  const db = serviceClient();
  const { data } = await db
    .from("users")
    .select("id")
    .eq("role", role)
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error(`getUserIdByRole: no active ${role} user (run test:e2e:bootstrap).`);
  return data.id;
}

/**
 * Upsert an ACTIVE reviewer credential for a user (service role). Idempotent —
 * re-activates and updates the qualification/reference if a row already exists.
 * Returns the credential id.
 */
export async function seedReviewerCredential(
  userId: string,
  opts: { qualification?: string; reference?: string | null } = {},
): Promise<string> {
  const db = serviceClient();
  const admin = await adminId(db);
  const patch = {
    user_id: userId,
    qualification: opts.qualification ?? "chartered_accountant",
    credential_reference: opts.reference ?? "E2E-REF",
    status: "active" as const,
    activated_at: new Date().toISOString(),
    created_by: admin,
    updated_by: admin,
  };
  const { data, error } = await db
    .from("tax_reviewer_credentials")
    .upsert(patch, { onConflict: "user_id" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedReviewerCredential failed: ${error?.message}`);
  return data.id;
}

/** Remove any reviewer credential for a user (test isolation). */
export async function clearReviewerCredential(userId: string): Promise<void> {
  const db = serviceClient();
  await db.from("tax_reviewer_credentials").delete().eq("user_id", userId);
}

/** Set the case preparer (assigned_staff_id) so self-review can be exercised. */
export async function setCasePreparer(taxCaseId: string, staffId: string): Promise<void> {
  const db = serviceClient();
  const { error } = await db.from("tax_cases").update({ assigned_staff_id: staffId }).eq("id", taxCaseId);
  if (error) throw new Error(`setCasePreparer failed: ${error.message}`);
}

/** Read the manual-review overlay columns + latest review for assertions. */
export async function readManualReviewState(taxCaseId: string): Promise<Record<string, unknown> | null> {
  const db = serviceClient();
  const { data } = await db
    .from("tax_cases")
    .select("manual_review_status, manual_review_reviewer_id, reviewer_id, manual_review_decided_at")
    .eq("id", taxCaseId)
    .maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}

/** Read the append-only sign-off history rows for a tax case. */
export async function readCaseReviews(
  taxCaseId: string,
): Promise<{ decision: string; reason: string | null; reviewer_qualification_snapshot: string }[]> {
  const db = serviceClient();
  const { data } = await db
    .from("tax_case_reviews")
    .select("decision, reason, reviewer_qualification_snapshot, created_at")
    .eq("tax_case_id", taxCaseId)
    .order("created_at", { ascending: false });
  return (data ?? []) as never;
}

/** Read the persisted review columns for a tax case (state assertions). */
export async function readReviewState(taxCaseId: string): Promise<Record<string, unknown> | null> {
  const db = serviceClient();
  const { data } = await db
    .from("tax_cases")
    .select(
      "client_review_status, client_review_snapshot_id, client_review_sent_at, client_approved_at, " +
        "client_approval_method, client_approval_reference, client_changes_summary",
    )
    .eq("id", taxCaseId)
    .maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}
