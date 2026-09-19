import "server-only";

import type { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Centralized server-side finalization guard for Tax Desk mutations (K.2.8).
 *
 * A finalized tax case (finalized_at not null) is READ-ONLY: no ledger edits,
 * no new snapshots, no validation/review mutations. The lock is enforced on the
 * SERVER, never merely by a disabled button. `finalized_at` is the
 * authoritative lock (we do not overload case_status).
 *
 * CONSOLIDATED BY AUDIT-01-F5 (decision D67): this used to be the single
 * authority in name only — only `tax-ledger.ts` called `assertTaxCaseMutable`,
 * while the other seven Tax Desk action modules each re-derived the same
 * "finalized_at not null => blocked" check inline, with their own message
 * strings. Every PROACTIVE pre-check (the guard clause a module runs BEFORE
 * calling its RPC) now routes through one of the two functions below — never
 * a ninth inline copy. Each module keeps its own user-facing message via the
 * `message` parameter; the underlying rule never varies.
 *
 * Deliberately NOT touched: the REACTIVE `if (/finalized/i.test(error.message))`
 * branches several action modules run AFTER an RPC call fails. Those translate
 * the guarded RPC's own independent database-side rejection into a friendly
 * message — a different, correct pattern (defense-in-depth against a race
 * this file's proactive check cannot close) — not a second copy of this rule.
 *
 * RELOCATED BY AUDIT-01-F6 (decision D67): this module imports `server-only`
 * and a Supabase client type, so it was never actually domain logic — its
 * whole job is guarding server actions against a Supabase client. It used to
 * live under `src/lib/tax-desk/*`, the one violation of that tree's "pure
 * TypeScript, no React/Next/Supabase/route imports" invariant
 * (`PROJECT_CONSTITUTION.md` §2 rule 6). It now lives in
 * `src/lib/tax-desk-server/*`, a deliberately separate, deliberately-impure
 * tree — `tax-desk`/`tax-engine`/`tax-pack`/`tax-lab` are machine-checked
 * pure with NO exception (`src/lib/tax-lab/__tests__/boundary.test.ts`).
 *
 * Scope: this only locks operations that belong to the Tax Desk preparation
 * workflow (rows keyed by tax_case_id). Generic parent-`cases` actions
 * (case_documents / uploaded_files / fees / messages) are intentionally NOT
 * frozen here — a parent case may carry non-ITR work, so a tax-case lock cannot
 * be safely inferred for them. See docs/phase-K2.8-*.md.
 */

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

export type MutableResult = { ok: true; caseId: string } | { ok: false; error: string };
export type MutableCheck = { ok: true } | { ok: false; error: string };

const FINALIZED_MSG = "This tax case is finalized and read-only. Reopen it before making changes.";

/**
 * Pure check for a caller that already has `finalized_at` loaded (several
 * action modules fetch it as part of a wider read for the same request, and
 * a second DB round trip would be pure waste). This is the actual rule every
 * other function on this page defers to — `assertTaxCaseMutable` below is a
 * thin DB-querying wrapper around it, not a second implementation.
 */
export function checkCaseNotFinalized(
  isFinalized: boolean,
  message: string = FINALIZED_MSG,
): MutableCheck {
  if (isFinalized) return { ok: false, error: message };
  return { ok: true };
}

/**
 * DB-querying variant for a caller that does NOT already have `finalized_at`
 * loaded. `message` lets each surface keep its own user-facing text ("Client
 * review actions are read-only.", "Findings are read-only.", etc.) — only the
 * "not found" message is fixed, since every call site already treats a
 * missing case identically.
 */
export async function assertTaxCaseMutable(
  supabase: SupabaseClient,
  taxCaseId: string,
  message: string = FINALIZED_MSG,
): Promise<MutableResult> {
  const { data } = await supabase
    .from("tax_cases")
    .select("id, case_id, finalized_at")
    .eq("id", taxCaseId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Tax case not found." };
  const check = checkCaseNotFinalized(!!data.finalized_at, message);
  if (!check.ok) return check;
  return { ok: true, caseId: data.case_id };
}
