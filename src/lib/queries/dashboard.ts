import { isNormalService } from "@/lib/services/catalog";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Dashboard attention queues. All queries run with the SESSION
 * client — RLS applies. Each returns a small row set for its card.
 */

export interface QueueCase {
  id: string;
  display_code: string | null;
  title: string | null;
  status: string;
  next_action: string | null;
  next_action_due: string | null;
  client_name: string;
  extra?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toQueueCase(row: any, extra?: string): QueueCase {
  return {
    id: row.id,
    display_code: row.display_code,
    title: row.title,
    status: row.status,
    next_action: row.next_action,
    next_action_due: row.next_action_due,
    client_name: row.clients?.full_name ?? "—",
    extra,
  };
}

const CASE_COLS =
  "id, display_code, title, status, next_action, next_action_due, clients:client_id(full_name)";

export async function getDashboardData() {
  const supabase = await createServerClient();
  const t = today();

  // Default dashboard focuses on normal Tax Desk services. We scope the
  // rendered generic queues to these service ids (so the row limit applies
  // to normal cases, not post-filtered). Deferred-service cases stay
  // reachable via the Cases Service filter and direct URL. Fallback: if no
  // normal services resolve, scope to all (never filter to empty).
  const { data: svcRows } = await supabase.from("services").select("id, code");
  const normalIds = (svcRows ?? []).filter((s) => isNormalService(s.code)).map((s) => s.id);
  const scopeIds = normalIds.length > 0 ? normalIds : (svcRows ?? []).map((s) => s.id);

  const [
    pendingDocs,
    filesNeedingReview,
    approvalsPending,
    followupsDue,
    overdue,
    dispatchPending,
    objections,
    balancesDue,
    aadhaarPurge,
    custody,
    recent,
  ] = await Promise.all([
    // 1. Cases with required checklist items still pending/requested
    supabase
      .from("case_documents")
      .select(`id, name, status, cases!inner(${CASE_COLS.replaceAll("clients:client_id", "clients:client_id")})`)
      .in("status", ["pending", "requested"])
      .eq("is_required", true)
      .is("cases.completed_at", null)
      .is("cases.deleted_at", null)
      .in("cases.service_id", scopeIds)
      .limit(200),
    // 2. Uploaded files awaiting staff review
    supabase
      .from("uploaded_files")
      .select(`id, original_filename, created_at, cases!inner(${CASE_COLS})`)
      .eq("review_status", "uploaded")
      .is("deleted_at", null)
      .in("cases.service_id", scopeIds)
      .order("created_at", { ascending: true })
      .limit(25),
    // 3. Client approvals pending (ITR)
    supabase
      .from("cases")
      .select(CASE_COLS)
      .eq("status", "client_approval_pending")
      .is("deleted_at", null)
      .in("service_id", scopeIds)
      .limit(25),
    // 4. Follow-ups due today or earlier
    supabase
      .from("followups")
      .select(`id, due_date, note, cases!inner(${CASE_COLS})`)
      .eq("status", "open")
      .lte("due_date", t)
      .is("deleted_at", null)
      .in("cases.service_id", scopeIds)
      .order("due_date")
      .limit(25),
    // 5. Overdue next actions
    supabase
      .from("cases")
      .select(CASE_COLS)
      .lt("next_action_due", t)
      .is("completed_at", null)
      .is("deleted_at", null)
      .in("service_id", scopeIds)
      .order("next_action_due")
      .limit(25),
    // 6. IEPF dispatch pending
    supabase
      .from("cases")
      .select(CASE_COLS)
      .eq("status", "dispatch_pending")
      .is("deleted_at", null)
      .limit(25),
    // 7. IEPF objections
    supabase
      .from("cases")
      .select(CASE_COLS)
      .in("status", ["objection_received", "objection_reply_pending"])
      .is("deleted_at", null)
      .limit(25),
    // 8. Balance fees pending
    supabase
      .from("fee_balances")
      .select("fee_id, case_id, balance_fee_due, status")
      .gt("balance_fee_due", 0)
      .in("status", ["agreed", "partially_paid"])
      .limit(50),
    // 9. Aadhaar-sensitive files awaiting early purge (case completed)
    supabase
      .from("uploaded_files")
      .select(`id, original_filename, cases!inner(${CASE_COLS})`)
      .eq("contains_aadhaar", true)
      .is("purged_at", null)
      .is("deleted_at", null)
      .not("cases.completed_at", "is", null)
      .limit(25),
    // 10. Physical originals needing action
    supabase
      .from("physical_documents")
      .select(`id, name, custody_status, return_required, cases!inner(${CASE_COLS})`)
      .in("custody_status", ["expected", "in_custody"])
      .is("deleted_at", null)
      .in("cases.service_id", scopeIds)
      .limit(50),
    // 11. Recently updated cases
    supabase
      .from("cases")
      .select(CASE_COLS + ", updated_at")
      .is("deleted_at", null)
      .in("service_id", scopeIds)
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);

  // Distinct cases for pending docs, with counts.
  const pendingByCase = new Map<string, { row: QueueCase; count: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const cd of (pendingDocs.data ?? []) as any[]) {
    const kase = cd.cases;
    const existing = pendingByCase.get(kase.id);
    if (existing) existing.count += 1;
    else pendingByCase.set(kase.id, { row: toQueueCase(kase), count: 1 });
  }

  // Balance fees: fetch case info for the hit list.
  const balanceCaseIds = [...new Set((balancesDue.data ?? []).map((b) => b.case_id))].slice(0, 25);
  let balanceCases: QueueCase[] = [];
  if (balanceCaseIds.length > 0) {
    const supabase2 = await createServerClient();
    const { data } = await supabase2
      .from("cases")
      .select(CASE_COLS)
      .in("id", balanceCaseIds)
      .is("deleted_at", null)
      .in("service_id", scopeIds);
    const dueByCase = new Map<string, number>();
    for (const b of balancesDue.data ?? []) {
      dueByCase.set(b.case_id, (dueByCase.get(b.case_id) ?? 0) + Number(b.balance_fee_due));
    }
    balanceCases = (data ?? []).map((c) =>
      toQueueCase(c, `₹${(dueByCase.get(c.id) ?? 0).toLocaleString("en-IN")} due`)
    );
  }

  return {
    pendingDocs: [...pendingByCase.values()].map(({ row, count }) => ({
      ...row,
      extra: `${count} document${count > 1 ? "s" : ""} pending`,
    })),
    filesNeedingReview: ((filesNeedingReview.data ?? []) as unknown as Array<{ id: string; original_filename: string; cases: unknown }>).map((f) =>
      toQueueCase(f.cases, f.original_filename)
    ),
    approvalsPending: (approvalsPending.data ?? []).map((c) => toQueueCase(c)),
    followupsDue: ((followupsDue.data ?? []) as unknown as Array<{ due_date: string; note: string; cases: unknown }>).map((f) =>
      toQueueCase(f.cases, `${f.due_date}: ${f.note}`)
    ),
    overdue: (overdue.data ?? []).map((c) => toQueueCase(c)),
    dispatchPending: (dispatchPending.data ?? []).map((c) => toQueueCase(c)),
    objections: (objections.data ?? []).map((c) => toQueueCase(c)),
    balancesDue: balanceCases,
    aadhaarPurge: ((aadhaarPurge.data ?? []) as unknown as Array<{ id: string; original_filename: string; cases: unknown }>).map((f) =>
      toQueueCase(f.cases, f.original_filename)
    ),
    custody: ((custody.data ?? []) as unknown as Array<{ name: string; custody_status: string; return_required: boolean; cases: unknown }>).map((p) =>
      toQueueCase(p.cases, `${p.name} (${p.custody_status.replaceAll("_", " ")}${p.return_required ? ", return required" : ""})`)
    ),
    recent: (recent.data ?? []).map((c) => toQueueCase(c)),
  };
}
