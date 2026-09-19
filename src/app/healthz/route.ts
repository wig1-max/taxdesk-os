import { NextResponse } from "next/server";

/**
 * Liveness probe for the host (Render health check). Intentionally does
 * NOT touch the database or auth — it only proves the Node process is up
 * and serving. Public (see middleware PUBLIC_PREFIXES).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ ok: true, service: "taxdesk-os" }, { status: 200 });
}
