import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. BYPASSES RLS.
 *
 * Rules:
 * - `import "server-only"` makes any client-side import a build error.
 * - Use ONLY where RLS cannot apply by design:
 *   - the public /upload/[token] flow (token validated first)
 *   - issuing signed URLs for private storage objects
 *   - the audit log writer
 * - Every use must validate its own inputs (Zod) and write an audit entry
 *   where the action is sensitive.
 * - Never pass this client's results to the browser without masking.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
