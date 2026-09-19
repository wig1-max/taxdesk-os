"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTaxCaseValidationView } from "@/lib/queries/tax-desk";
import { buildEngineInput } from "@/lib/tax-desk/computation-adapter";
import { runValidation } from "@/lib/tax-desk/validation-runner";
import { bindDefaultTaxPackToCase, taxCaseStatutoryContext } from "@/lib/tax-pack";
import { screenSensitiveText } from "@/lib/validation/tax-case";
import { checkCaseNotFinalized } from "@/lib/tax-desk-server/finalization";

type ActionResult = { ok: boolean; error?: string };
type RefreshResult = ActionResult & {
  counts?: { total: number; error: number; warning: number; info: number; reopened: number; resolved: number };
};

const AUTO_RESOLVE_NOTE = "Auto-resolved: condition no longer detected on refresh.";

/**
 * Recompute deterministic findings and reconcile them into
 * tax_validation_findings (K.2.6). Recomputes server-side from live ledger
 * rows — never trusts browser-supplied finding JSON. Upserts by
 * (tax_case_id, finding_key); reopens resolved findings still detected;
 * auto-resolves open findings no longer detected. Never hard-deletes.
 */
export async function refreshTaxValidationAction(input: unknown): Promise<RefreshResult> {
  const user = await requireUser();
  const parsed = z.object({ taxCaseId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const view = await getTaxCaseValidationView(parsed.data.taxCaseId);
  if (!view) return { ok: false, error: "Tax case not found." };
  const mutable = checkCaseNotFinalized(
    view.finalized,
    "This tax case is finalized. Reopen it before re-running validation.",
  );
  if (!mutable.ok) return { ok: false, error: mutable.error };

  // Versioned tax pack (K3-12) — the validation-run marker records the pack
  // version that governed the run, resolved through the one canonical authority
  // from the case's statutory coordinates. Refused (never guessed) when no
  // single bound pack governs the case; unreachable today because
  // `tax_cases.assessment_year` is DB-constrained to the supported year.
  const packBinding = bindDefaultTaxPackToCase(
    taxCaseStatutoryContext(view.assessmentYear, view.law),
  );
  if (packBinding.outcome !== "bound") {
    return { ok: false, error: `No versioned tax pack governs this case: ${packBinding.reason}` };
  }
  const rulesVersion = packBinding.versions.validationRulesVersion;

  const adapter = buildEngineInput(view.rows, {
    assessmentYear: view.assessmentYear,
    financialYear: view.financialYear,
    selectedItrType: view.selectedItrType,
    finalized: false,
    dateOfBirth: view.dateOfBirth,
    residentialStatus: view.residentialStatus,
  });
  const result = runValidation({
    context: {
      assessmentYear: view.assessmentYear,
      financialYear: view.financialYear,
      selectedItrType: view.selectedItrType,
      finalized: false,
    },
    ledgers: view.rows,
    adapter,
    documents: view.documents,
    validFileIds: view.validFileIds,
  });

  const supabase = await createServerClient();
  // Findings + the validation-run marker are engine-derived and written
  // server-only: authenticated INSERT/UPDATE on tax_validation_findings and
  // UPDATE on tax_cases are revoked (K.2.8.8B). Everything below is recomputed
  // from live ledger data, never a client payload, so direct PostgREST cannot
  // forge findings or a fake freshness timestamp.
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Existing system findings (before this run) for reopen/resolve accounting.
  const { data: existing } = await supabase
    .from("tax_validation_findings")
    .select("finding_key, status")
    .eq("tax_case_id", view.taxCaseId)
    .not("finding_key", "is", null);
  const existingStatus = new Map((existing ?? []).map((e) => [e.finding_key as string, e.status as string]));

  const currentKeys = new Set(result.findings.map((f) => f.findingKey));
  const reopened = result.findings.filter((f) => {
    const s = existingStatus.get(f.findingKey);
    return s === "resolved" || s === "dismissed";
  }).length;

  // Upsert current findings (open; reopen clears prior resolution).
  if (result.findings.length > 0) {
    const rows = result.findings.map((f) => ({
      tax_case_id: view.taxCaseId,
      finding_key: f.findingKey,
      code: f.ruleCode,
      area: f.category,
      severity: f.severity,
      title: f.title,
      message: f.message,
      details: f.details,
      source_value: f.sourceValue ?? null,
      entered_value: f.enteredValue ?? null,
      difference: f.difference ?? null,
      suggested_action: f.suggestedAction ?? null,
      status: "open",
      last_seen_at: nowIso,
      resolved_at: null,
      resolved_by: null,
      resolution_note: null,
    }));
    const { error } = await admin
      .from("tax_validation_findings")
      .upsert(rows, { onConflict: "tax_case_id,finding_key" });
    if (error) return { ok: false, error: "Could not save findings." };
  }

  // Auto-resolve open system findings no longer detected.
  const staleKeys = [...existingStatus.entries()]
    .filter(([k, s]) => s === "open" && !currentKeys.has(k))
    .map(([k]) => k);
  let resolved = 0;
  if (staleKeys.length > 0) {
    const { error, count } = await admin
      .from("tax_validation_findings")
      .update(
        { status: "resolved", resolved_at: nowIso, resolved_by: user.id, resolution_note: AUTO_RESOLVE_NOTE },
        { count: "exact" },
      )
      .eq("tax_case_id", view.taxCaseId)
      .in("finding_key", staleKeys);
    if (!error) resolved = count ?? staleKeys.length;
  }

  const counts = {
    total: result.counts.total,
    error: result.counts.error,
    warning: result.counts.warning,
    info: result.counts.info,
    reopened,
    resolved,
  };

  // Record a reliable "latest validation run" marker on the tax case so the
  // K.2.8 readiness freshness check does not depend on reading audit_logs.
  const { error: runMarkerError } = await admin
    .from("tax_cases")
    .update({
      validation_last_run_at: nowIso,
      validation_last_run_by: user.id,
      validation_rules_version: rulesVersion,
    })
    .eq("id", view.taxCaseId);
  // Phase 3 makes this case-level marker authoritative for validation-run
  // state. Never report a successful refresh if it could not be persisted:
  // doing so would recreate the zero-finding contradiction this marker fixes.
  if (runMarkerError) return { ok: false, error: "Could not record the validation run." };

  await audit({
    actor: user,
    action: "tax_validation.refreshed",
    entityType: "tax_cases",
    entityId: view.taxCaseId,
    caseId: view.caseId,
    after: { tax_case_id: view.taxCaseId, rules_version: rulesVersion, ...counts },
  });

  revalidatePath(`/tax-desk/cases/${view.taxCaseId}/validation`);
  return { ok: true, counts };
}

const noteSchema = z
  .string()
  .trim()
  .min(3, "A resolution note of at least 3 characters is required.")
  .max(500, "Resolution note is too long (max 500 characters).");

async function loadFindingCase(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  findingId: string,
): Promise<{ taxCaseId: string; caseId: string; ruleCode: string; finalized: boolean } | null> {
  const { data } = await supabase
    .from("tax_validation_findings")
    .select("id, code, tax_case_id, tax_cases:tax_case_id(case_id, finalized_at)")
    .eq("id", findingId)
    .maybeSingle();
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tc = (data as any).tax_cases;
  return {
    taxCaseId: (data as { tax_case_id: string }).tax_case_id,
    caseId: tc?.case_id ?? null,
    ruleCode: (data as { code: string }).code,
    finalized: !!tc?.finalized_at,
  };
}

/** Manually resolve a finding with a required, screened note. */
export async function resolveTaxValidationFindingAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = z.object({ findingId: z.string().uuid(), note: noteSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const sensitive = screenSensitiveText(parsed.data.note);
  if (sensitive) return { ok: false, error: sensitive };

  const supabase = await createServerClient();
  const finding = await loadFindingCase(supabase, parsed.data.findingId);
  if (!finding) return { ok: false, error: "Finding not found." };
  const mutable = checkCaseNotFinalized(finding.finalized, "This tax case is finalized. Findings are read-only.");
  if (!mutable.ok) return { ok: false, error: mutable.error };

  // Screened note is written through the guarded RPC (validates role + parent
  // not finalized, then updates the finding + writes audit atomically). Direct
  // authenticated writes to tax_validation_findings are revoked (K.2.8.8B).
  const { error } = await supabase.rpc("resolve_tax_finding", {
    p_finding_id: parsed.data.findingId,
    p_note: parsed.data.note,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    if (/finalized/i.test(error.message ?? "")) {
      return { ok: false, error: "This tax case is finalized. Findings are read-only." };
    }
    return { ok: false, error: "Could not resolve finding." };
  }

  revalidatePath(`/tax-desk/cases/${finding.taxCaseId}/validation`);
  return { ok: true };
}

/** Reopen a resolved finding (clears resolution metadata). */
export async function reopenTaxValidationFindingAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = z.object({ findingId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const supabase = await createServerClient();
  const finding = await loadFindingCase(supabase, parsed.data.findingId);
  if (!finding) return { ok: false, error: "Finding not found." };
  const mutable = checkCaseNotFinalized(finding.finalized, "This tax case is finalized. Findings are read-only.");
  if (!mutable.ok) return { ok: false, error: mutable.error };

  const { error } = await supabase.rpc("reopen_tax_finding", {
    p_finding_id: parsed.data.findingId,
    p_event_id: crypto.randomUUID(),
  });
  if (error) {
    if (/finalized/i.test(error.message ?? "")) {
      return { ok: false, error: "This tax case is finalized. Findings are read-only." };
    }
    return { ok: false, error: "Could not reopen finding." };
  }

  revalidatePath(`/tax-desk/cases/${finding.taxCaseId}/validation`);
  return { ok: true };
}
