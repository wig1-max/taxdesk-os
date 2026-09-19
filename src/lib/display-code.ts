import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Human-readable display codes, generated server-side.
 *
 * Race handling (MVP-grade, 2–5 users): read current max, +1; the
 * UNIQUE constraint is the arbiter. Callers retry the whole insert
 * up to 3 times on unique-violation (23505). Good enough for a
 * small office; a DB sequence can replace this later without
 * changing formats.
 */

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

export function nextNumericSuffix(codes: Array<string | null | undefined>, prefix: string): number {
  const max = codes.reduce((currentMax, code) => {
    if (!code?.startsWith(prefix)) return currentMax;
    const tail = code.slice(prefix.length);
    if (!/^\d+$/.test(tail)) return currentMax;
    return Math.max(currentMax, parseInt(tail, 10));
  }, 0);
  return max + 1;
}

async function nextNumber(table: "clients" | "cases", prefix: string): Promise<number> {
  const admin = createAdminClient();
  // Ordering matters once matching rows exceed the 1000-row limit: an
  // unordered `.limit(1000)` lets Postgres return an ARBITRARY subset of
  // matches, which can silently omit the true highest-numbered code and
  // make nextNumericSuffix() compute an already-used "next" value — every
  // insert then collides on the UNIQUE constraint, exhausting all 3 retries
  // ("Could not allocate a client code"). Descending order guarantees the
  // highest-numbered codes are always among the returned 1000, regardless
  // of how large the table grows.
  const { data, error } = await admin
    .from(table)
    .select("display_code")
    .like("display_code", `${prefix}%`)
    .order("display_code", { ascending: false })
    .limit(1000);
  if (error) {
    // Log loudly instead of silently pretending the table is empty
    // (that masked a permission-denied here for days). Falling
    // through is still safe: a colliding code is rejected by the
    // UNIQUE constraint and callers retry / show a clean error.
    console.error(`[display-code] max lookup failed for ${table}:`, error.message);
  }
  return nextNumericSuffix(
    (data ?? []).map((row) => row.display_code as string | null),
    prefix
  );
}

/** TDX-C-0001 */
export async function nextClientCode(): Promise<string> {
  const prefix = "TDX-C-";
  return prefix + pad4(await nextNumber("clients", prefix));
}

/**
 * ITR:     TDX-ITR-2627-0001  (2627 from AY "2026-27")
 * IEPF:    TDX-IEPF-0001
 * generic: TDX-GST-0001 etc.
 */
export async function nextCaseCode(serviceCode: string, ay?: string): Promise<string> {
  const svc = serviceCode.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  let prefix = `TDX-${svc}-`;
  if (serviceCode === "itr" && ay) {
    const compact = ay.replace(/[^0-9]/g, "").slice(2); // "2026-27" -> "2627"
    if (compact.length === 4) prefix = `TDX-ITR-${compact}-`;
  }
  return prefix + pad4(await nextNumber("cases", prefix));
}

export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}
