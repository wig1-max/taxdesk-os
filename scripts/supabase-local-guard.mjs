// @ts-check
/**
 * K3-31 (decision D34) — pre-flight guard for local Supabase database
 * mutation commands (`db push` / `db pull` / `db reset` / `migration up`).
 *
 * `K3-30` accidentally ran `supabase db push` (no `--local`) while this repo
 * had a stale `supabase link` state, which sent two additive migrations to a
 * live remote project (`taxdesk-os-prod`) instead of local Docker (decision
 * D34, the k3-tax-intelligence-program design notes). The Supabase CLI's
 * "remote" target is whatever project is linked in
 * `supabase/.temp/project-ref` — NOT the same thing as "local Docker" — and
 * nothing about the CLI's own output warns you before the fact.
 *
 * This guard aborts BEFORE any local database mutation command runs if a
 * project is linked. It does not provide a remote-command escape hatch — a
 * genuinely intended remote action stays a manual, explicitly-authorized step
 * outside any npm script.
 *
 * Run standalone:  node scripts/supabase-local-guard.mjs
 * Exit 0 = safe to proceed (no project linked).
 * Exit 1 = a project is linked; run `npx supabase unlink` first (after
 *          confirming that is genuinely intended) or perform the remote
 *          action manually with explicit review — never via this guard.
 *
 * Use via the sanctioned npm scripts (`npm run db:push:local`, `db:reset:local`,
 * `db:migration:up:local`) rather than invoking `supabase db push` etc. directly.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Every filename inside `supabase/.temp/` that records a link to a remote
 * project. **More than one, because the CLI changed where it writes it.**
 *
 * `K4-15` hit this live: `npx supabase link` failed part-way through (a CLI
 * schema bug parsing the platform's own `inserted_at` timestamp), but it had
 * ALREADY written `linked-project.json` containing the PRODUCTION ref — while
 * writing no `project-ref` at all. This guard watched only `project-ref`, so it
 * reported "safe to run local database commands" with `taxdesk-os-prod` sitting
 * linked on disk. That is precisely the `D34` precondition the guard exists to
 * refuse, reached through a file it could not see.
 *
 * `npx supabase unlink` did not help either: it looks for the LEGACY
 * `project-ref`, raises `LegacyProjectNotLinkedError`, and leaves
 * `linked-project.json` in place — so the CLI can enter a linked state it
 * cannot itself exit. Removing `supabase/.temp/` is the reliable clean-up.
 *
 * ADD TO THIS LIST, NEVER NARROW IT. A marker this array does not name is a
 * marker the guard cannot see, and the failure is silent and points at
 * production.
 */
export const LINK_MARKER_FILES = Object.freeze(["project-ref", "linked-project.json"]);

/**
 * Pure decision, exported for unit testing without touching the real
 * filesystem. Takes the link markers actually found under `supabase/.temp/`
 * as `{ name, contents }` entries; ANY of them means linked.
 *
 * A present-but-empty marker still refuses (fail closed) — an
 * unreadable/half-written link state is not evidence of "unlinked", and
 * `K4-15` proved that is not hypothetical: the half-written state it found
 * WAS production.
 */
export function assessSupabaseLinkGuard(markers) {
  const found = (markers ?? []).filter((m) => m && typeof m.name === "string");
  if (found.length === 0) {
    return {
      ok: true,
      message:
        `No linked Supabase project (none of ${LINK_MARKER_FILES.join(", ")} present ` +
        "under supabase/.temp/) — safe to run local database commands.",
    };
  }
  const described = found
    .map((m) => {
      const raw = (m.contents ?? "").trim();
      // `linked-project.json` carries the ref inside JSON; `project-ref` is the
      // bare string. Report whichever we can actually read, never a guess.
      let ref = raw;
      if (m.name.endsWith(".json")) {
        try {
          ref = JSON.parse(raw)?.ref ?? raw;
        } catch {
          ref = raw;
        }
      }
      return `${m.name} = "${ref || "<unreadable>"}"`;
    })
    .join("; ");
  return {
    ok: false,
    message:
      `A Supabase project is LINKED (${described}). ` +
      "Refusing to run a local database mutation command: the Supabase CLI's " +
      "default target is the LINKED project, not local Docker, and running " +
      "`db push`/`db pull`/`db reset`/`migration up` without `--local` here " +
      "would target that project instead (decision D34 — the K3-30 incident). " +
      "Remove `supabase/.temp/` if you are certain no remote action is " +
      "intended — note `npx supabase unlink` may refuse with " +
      "`LegacyProjectNotLinkedError` while leaving `linked-project.json` in " +
      "place — or perform the remote action manually with explicit review; " +
      "this guard offers no remote-command path.",
  };
}

function main() {
  const tempDir = join(process.cwd(), "supabase", ".temp");
  const markers = [];
  for (const name of LINK_MARKER_FILES) {
    const path = join(tempDir, name);
    if (!existsSync(path)) continue;
    let contents = null;
    try {
      contents = readFileSync(path, "utf8");
    } catch {
      // Unreadable is still PRESENT, and present means linked. Falling through
      // with `null` refuses rather than treating an I/O error as "unlinked".
    }
    markers.push({ name, contents });
  }
  const result = assessSupabaseLinkGuard(markers);
  if (result.ok) {
    console.log(`[supabase-local-guard] ${result.message}`);
    process.exit(0);
  } else {
    console.error(`[supabase-local-guard] REFUSED: ${result.message}`);
    process.exit(1);
  }
}

// Only run as a CLI entry point — importable for tests without side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
