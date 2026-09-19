import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  createFeeAction,
  overrideFeeAction,
  recordPaymentAction,
  updateFeeValuesAction,
} from "@/app/actions/fees";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { formatInr } from "@/lib/utils";

export const metadata: Metadata = { title: "Fees" };

export default async function CaseFeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;
  const isAdmin = user.role === "admin";

  const supabase = await createServerClient();
  const [{ data: fees }, { data: balances }, { data: payments }, { data: kase }] =
    await Promise.all([
      supabase.from("fees").select("*").eq("case_id", id).is("deleted_at", null).order("created_at"),
      supabase.from("fee_balances").select("*").eq("case_id", id),
      supabase
        .from("payments")
        .select("*, users:recorded_by(full_name)")
        .eq("case_id", id)
        .order("paid_on", { ascending: false }),
      supabase.from("cases").select("services(code)").eq("id", id).maybeSingle(),
    ]);
  const isIepf = (kase?.services as unknown as { code: string } | null)?.code === "iepf";

  const balanceByFee = new Map((balances ?? []).map((b) => [b.fee_id, b]));

  async function addFee(formData: FormData) {
    "use server";
    const s = (k: string) => String(formData.get(k) ?? "").trim();
    const res = await createFeeAction({
      case_id: id,
      fee_type: s("fee_type"),
      description: s("description") || undefined,
      fixed_amount: s("fixed_amount") ? Number(s("fixed_amount")) : undefined,
      percent: s("percent") ? Number(s("percent")) : undefined,
      estimated_claim_value: s("estimated_claim_value")
        ? Number(s("estimated_claim_value"))
        : undefined,
      upfront_amount: s("upfront_amount") ? Number(s("upfront_amount")) : 0,
    });
    redirect(
      res.ok ? `/cases/${id}/fees` : `/cases/${id}/fees?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  async function updateValues(formData: FormData) {
    "use server";
    const s = (k: string) => String(formData.get(k) ?? "").trim();
    const res = await updateFeeValuesAction(String(formData.get("fee_id")), {
      estimated_claim_value: s("estimated_claim_value")
        ? Number(s("estimated_claim_value"))
        : undefined,
      actual_recovered_value: s("actual_recovered_value")
        ? Number(s("actual_recovered_value"))
        : undefined,
      confidence: (s("confidence") || undefined) as never,
      expected_closure_month: s("expected_closure_month")
        ? `${s("expected_closure_month")}-01`
        : "",
      status: (s("status") || undefined) as never,
    });
    redirect(
      res.ok ? `/cases/${id}/fees` : `/cases/${id}/fees?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  async function override(formData: FormData) {
    "use server";
    const raw = String(formData.get("override_total") ?? "").trim();
    const res = await overrideFeeAction(
      String(formData.get("fee_id")),
      raw === "" ? null : Number(raw),
      String(formData.get("reason") ?? "")
    );
    redirect(
      res.ok ? `/cases/${id}/fees` : `/cases/${id}/fees?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  async function addPayment(formData: FormData) {
    "use server";
    const s = (k: string) => String(formData.get(k) ?? "").trim();
    const res = await recordPaymentAction({
      fee_id: s("fee_id"),
      case_id: id,
      amount: Number(s("amount")),
      direction: s("direction"),
      method: s("method"),
      reference: s("reference") || undefined,
      paid_on: s("paid_on"),
      notes: s("notes") || undefined,
    });
    redirect(
      res.ok ? `/cases/${id}/fees` : `/cases/${id}/fees?error=${encodeURIComponent(res.error ?? "")}`
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}

      {(fees ?? []).map((f) => {
        const bal = balanceByFee.get(f.id);
        return (
          <Card key={f.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">
                {f.description ?? f.fee_type} ({f.fee_type === "fixed" ? "fixed" : `${f.percent}%`})
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={f.status === "paid" ? "success" : "secondary"}>{f.status}</Badge>
                {f.override_total !== null && <Badge variant="warning">overridden</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-4">
                <p>Expected fee: <strong>{f.expected_fee != null ? formatInr(Number(f.expected_fee)) : "—"}</strong></p>
                <p>Final fee: <strong>{f.final_fee != null ? formatInr(Number(f.final_fee)) : "—"}</strong></p>
                <p>Effective total: <strong>{bal ? formatInr(Number(bal.effective_total ?? 0)) : "—"}</strong></p>
                <p>
                  Balance due:{" "}
                  <strong className={Number(bal?.balance_fee_due ?? 0) > 0 ? "text-red-700" : "text-green-700"}>
                    {bal ? formatInr(Number(bal.balance_fee_due)) : "—"}
                  </strong>
                </p>
                <p>Upfront: {formatInr(Number(f.upfront_amount))}</p>
                <p>Received: {bal ? formatInr(Number(bal.payments_received)) : "—"}</p>
                <p>Confidence: {f.confidence}</p>
                <p>Closure: {f.expected_closure_month ?? "—"}</p>
              </div>

              <form action={updateValues} className="flex flex-wrap items-end gap-2 border-t pt-3">
                <input type="hidden" name="fee_id" value={f.id} />
                <label>Est. claim value
                  <input name="estimated_claim_value" type="number" min="0" defaultValue={f.estimated_claim_value ?? ""} className="mt-1 block h-9 w-32 rounded-md border border-input bg-background px-2" />
                </label>
                <label>Actual recovered
                  <input name="actual_recovered_value" type="number" min="0" defaultValue={f.actual_recovered_value ?? ""} className="mt-1 block h-9 w-32 rounded-md border border-input bg-background px-2" />
                </label>
                <label>Confidence
                  <select name="confidence" defaultValue={f.confidence} className="mt-1 block h-9 rounded-md border border-input bg-background px-2">
                    {["low", "medium", "high"].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label>Closure month
                  <input name="expected_closure_month" type="month" defaultValue={f.expected_closure_month?.slice(0, 7) ?? ""} className="mt-1 block h-9 rounded-md border border-input bg-background px-2" />
                </label>
                <label>Status
                  <select name="status" defaultValue={f.status} className="mt-1 block h-9 rounded-md border border-input bg-background px-2">
                    {["draft", "agreed", "partially_paid", "paid", "waived"].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <button className="h-9 rounded-md bg-secondary px-3">Save</button>
              </form>

              {isAdmin && (
                <form action={override} className="flex flex-wrap items-end gap-2 border-t pt-3">
                  <input type="hidden" name="fee_id" value={f.id} />
                  <label>Override total (admin; blank = clear)
                    <input name="override_total" type="number" min="0" defaultValue={f.override_total ?? ""} className="mt-1 block h-9 w-32 rounded-md border border-input bg-background px-2" />
                  </label>
                  <label>Reason (mandatory, audited)
                    <input name="reason" required className="mt-1 block h-9 w-64 rounded-md border border-input bg-background px-2" />
                  </label>
                  <button className="h-9 rounded-md bg-amber-600 px-3 font-medium text-white">Override</button>
                </form>
              )}

              <form action={addPayment} className="flex flex-wrap items-end gap-2 border-t pt-3">
                <input type="hidden" name="fee_id" value={f.id} />
                <label>Amount
                  <input name="amount" type="number" min="1" required className="mt-1 block h-9 w-28 rounded-md border border-input bg-background px-2" />
                </label>
                <label>Direction
                  <select name="direction" className="mt-1 block h-9 rounded-md border border-input bg-background px-2">
                    <option value="received">received</option>
                    <option value="refunded">refunded</option>
                  </select>
                </label>
                <label>Method
                  <select name="method" className="mt-1 block h-9 rounded-md border border-input bg-background px-2">
                    {["upi", "cash", "bank_transfer", "cheque", "other"].map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label>Date
                  <input name="paid_on" type="date" required className="mt-1 block h-9 rounded-md border border-input bg-background px-2" />
                </label>
                <label>Reference
                  <input name="reference" className="mt-1 block h-9 w-32 rounded-md border border-input bg-background px-2" />
                </label>
                <button className="h-9 rounded-md bg-primary px-3 font-medium text-primary-foreground">
                  Record payment
                </button>
              </form>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Add fee</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addFee} className="flex flex-wrap items-end gap-2 text-sm">
            <label>Type
              <select name="fee_type" className="mt-1 block h-9 rounded-md border border-input bg-background px-2">
                <option value="fixed">fixed</option>
                <option value="percent_of_recovery">percent of recovery</option>
              </select>
            </label>
            <label>Description
              <input name="description" className="mt-1 block h-9 w-48 rounded-md border border-input bg-background px-2" />
            </label>
            <label>Fixed amount
              <input name="fixed_amount" type="number" min="0" className="mt-1 block h-9 w-28 rounded-md border border-input bg-background px-2" />
            </label>
            <label>Percent
              <input name="percent" type="number" min="0" max="100" step="0.01" className="mt-1 block h-9 w-20 rounded-md border border-input bg-background px-2" />
            </label>
            <label>Est. claim value
              <input name="estimated_claim_value" type="number" min="0" className="mt-1 block h-9 w-32 rounded-md border border-input bg-background px-2" />
            </label>
            <label>Upfront
              <input name="upfront_amount" type="number" min="0" className="mt-1 block h-9 w-24 rounded-md border border-input bg-background px-2" />
            </label>
            <button className="h-9 rounded-md bg-primary px-3 font-medium text-primary-foreground">Add fee</button>
          </form>
          {isIepf && (
            <p className="mt-2 text-xs text-muted-foreground">
              IEPF cases get a default 15% + ₹5,000-upfront fee automatically at creation.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments ledger (append-only — corrections via reversing entries)</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Date</th><th className="py-1">Amount</th><th className="py-1">Direction</th>
                <th className="py-1">Method</th><th className="py-1">Reference</th><th className="py-1">By</th>
              </tr>
            </thead>
            <tbody>
              {(payments ?? []).map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-1.5">{p.paid_on}</td>
                  <td className="py-1.5">{formatInr(Number(p.amount))}</td>
                  <td className={`py-1.5 ${p.direction === "refunded" ? "text-red-700" : ""}`}>{p.direction}</td>
                  <td className="py-1.5">{p.method}</td>
                  <td className="py-1.5">{p.reference ?? "—"}</td>
                  <td className="py-1.5 text-xs">{(p.users as unknown as { full_name: string } | null)?.full_name ?? "—"}</td>
                </tr>
              ))}
              {(payments ?? []).length === 0 && (
                <tr><td colSpan={6} className="py-3 text-muted-foreground">No payments recorded.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
