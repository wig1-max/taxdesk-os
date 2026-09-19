import { expect, type Page } from "@playwright/test";

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@e2e.test";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-password";
// Defaults match the staff user created by scripts/e2e-bootstrap.mjs
// (bootstrapE2EStaff), so the staff-role test always runs (no env-gated skip).
export const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL ?? "staff@e2e.test";
export const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? "e2e-staff-password";

/** Unique per-run suffix so re-runs don't collide on names/phones. */
export const RUN = Date.now().toString().slice(-6);

/** Synthetic PAN — valid format, obviously fake. Never use real PANs. */
export const FAKE_PAN = "ZZTES1234Z";

/**
 * Wait until React has actually HYDRATED an element — not merely until the page
 * loaded (`K3-ENV-3`).
 *
 * React attaches `__reactFiber$…` keys to the DOM nodes it owns, so their
 * presence is a precise "this node's handlers are live" signal. Weaker markers
 * were measured and rejected: both `load` and `next-route-announcer` fire while
 * a form control still has no React props attached. Typing into a CONTROLLED
 * input before that point sets the DOM only — React state stays empty and the
 * next re-render silently discards the value. This reads a React internal
 * deliberately: it is the only accurate signal available, it is confined to test
 * infrastructure, and it fails loudly on timeout if the internal ever changes.
 */
export async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
    },
    selector,
    { timeout: 15_000 },
  );
}

/**
 * Pick a client in the New Case searchable combobox (`K3-ENV-4`).
 *
 * The picker used to be a `<select>` holding the first 500 clients by name, so
 * tests could enumerate `<option>` text. It is now a server-backed combobox:
 * type a fragment, then commit a listed option. This also removes the failure
 * the old helper produced once the table outgrew that window
 * ("No option containing … in Client *").
 *
 * The input is controlled, so the same hydration gate applies as anywhere else.
 * The commit is verified, so a click that never registered fails here rather
 * than surfacing later as a confusing "client required" error.
 */
export async function selectClient(page: Page, part: string) {
  await waitForHydration(page, '[role="combobox"]');
  const input = page.getByRole("combobox", { name: "Client *" });
  await expect(async () => {
    await input.fill(part);
    const option = page.getByRole("option", { name: new RegExp(escapeRegExp(part)) }).first();
    await expect(option).toBeVisible({ timeout: 2_000 });
    await option.click();
    await expect(input).toHaveValue(new RegExp(escapeRegExp(part)), { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function login(page: Page, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function createClient(
  page: Page,
  opts: { name: string; phone: string; pan?: string }
) {
  await page.goto("/clients/new");
  await page.getByLabel("Full name *").fill(opts.name);
  await page.getByLabel("Mobile number *").fill(opts.phone);
  if (opts.pan) {
    await page.getByLabel(/PAN \(optional/).fill(opts.pan);
  }
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}/);
  return page.url().split("/clients/")[1]!;
}

/** Tax Desk (normal-workflow) service labels shown in the default New Case dropdown. */
const NORMAL_SERVICE_LABELS = new Set(["ITR Filing", "GST Registration/Filing"]);

export async function createCase(
  page: Page,
  opts: {
    clientLabelPart: string;
    service: "ITR Filing" | "GST Registration/Filing" | "IEPF Claim Recovery";
    fill?: (p: Page) => Promise<void>;
  }
) {
  // Deferred services (e.g. IEPF) are hidden from normal New Case (K.1);
  // reach them via the admin includeDeferred path instead of re-exposing them.
  const url = NORMAL_SERVICE_LABELS.has(opts.service)
    ? "/cases/new"
    : "/cases/new?includeDeferred=1";
  await page.goto(url);
  await selectClient(page, opts.clientLabelPart);
  await page.getByLabel("Service *").selectOption({ label: opts.service });
  if (opts.fill) await opts.fill(page);
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}/);
  return page.url().split("/cases/")[1]!;
}

/**
 * Best-effort pre-compilation of an App-Router route under `next dev`, so the
 * route's on-demand compile happens here — in an UNTIMED phase — rather than
 * inside a spec's first navigation. A cold first-hit compile of a heavy Tax
 * Desk route can exceed the 15s `expect` timeout, which surfaced intermittently
 * as the "link did navigate but the destination was still compiling" flake
 * class (documented in `auth.setup.ts`; it cascaded dozens of failures at
 * K4-02). Warming eliminates that whole class.
 *
 * Best-effort by design: a warm navigation must never fail the calling phase,
 * so a timeout/redirect/404 is swallowed — a redirect or 404 still compiles the
 * route module, which is all warming needs. The generous 60s per-hop budget is
 * retained from the blanket warmer it replaces; do not lower it.
 *
 * OPS-11 (per-spec warming, conducted by ZCode): each spec warms only the
 * route(s) it actually visits, so a shard — which Playwright partitions by FILE
 * — compiles only its own routes instead of all ~18. That is the move that
 * shrinks the per-shard ~1,900 MB "warming floor". Call this from a spec's
 * `beforeAll`. Tax Desk sub-routes are warmed via `warmTaxDeskRoutes` in
 * `./warm`, which uses the shared warm-case id seeded by `auth.setup.ts`.
 */
export async function warmRoute(
  page: Page,
  url: string,
  { timeout = 60_000 }: { timeout?: number } = {},
): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "load", timeout });
  } catch {
    // Warming is best-effort — a slow/redirecting hop still triggers compile.
  }
}

/**
 * Warm several routes in order. See {@link warmRoute}. Use for a spec that
 * visits multiple distinct routes where each could be a cold first hit.
 */
export async function warmRoutes(page: Page, urls: string[]): Promise<void> {
  for (const url of urls) {
    await warmRoute(page, url);
  }
}

/** 1x1 valid PNG bytes for upload tests. */
export const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** Executable header masquerading as .pdf — must be rejected by sniffing. */
export const FAKE_EXE = Buffer.from("4d5a90000300000004000000ffff0000", "hex");
