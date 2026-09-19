// @ts-check
/**
 * MAINT-02 (`AUDIT-02-F4`) — dependency-advisory checker.
 *
 * `npm audit` is inoperable on this host: the registry's bulk advisory
 * endpoint (`/-/npm/v1/security/advisories/bulk`) returns gzip-compressed
 * data npm does not decode. This was established as neither a sandbox
 * artifact nor a repo misconfiguration (the audit-02-2026-07-26 design notes
 * §3.1.4) — it reproduces under PowerShell and bash, with and without the
 * tool sandbox, with no proxy/`.npmrc` configured. `npm outdated` (ordinary
 * packument endpoints) works fine, isolating the failure to that one
 * endpoint.
 *
 * This script reads `package-lock.json` directly and batches every resolved
 * package/version through OSV's `querybatch` API
 * (https://osv.dev/docs/#tag/api/operation/OSVQueryAPI_QueryAffectedBatch),
 * which is a different, working endpoint. It does not depend on `npm audit`
 * at all.
 *
 * Prod vs dev is split the way this repo already reasons about it (see
 * the project status notes's "Immediate risks"): a lock entry's own `dev` flag.
 *
 * Policy (decision D76, `MAINT-02`, 2026-07-26): a PRODUCTION-dependency
 * advisory fails the build UNLESS its advisory id is in
 * `KNOWN_UNFIXABLE_ADVISORIES` below, with a recorded reason. Without an
 * allowlist, an unfixable advisory makes this gate permanently red and
 * trains people to ignore it — but every allowlist entry must name why it is
 * believed unfixable today and must be revisited whenever the pinning
 * dependency (`next`) is upgraded. A DEV-only advisory is always reported,
 * never fails the build.
 *
 * Run standalone: node scripts/check-advisories.mjs
 * Exit 0 = no un-allowlisted production advisory. Exit 1 = at least one, or
 * the OSV API could not be reached at all (a check that could not run is not
 * the same as a clean result — it must not be reported as passing).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OSV_QUERYBATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL_PREFIX = "https://api.osv.dev/v1/vulns/";
const BATCH_SIZE = 100;

/**
 * Advisories on a package this repo does not control directly (a transitive
 * dependency bundled and pinned by `next` itself) that are currently
 * unfixable without a `next` major version bump. Recorded here, not silently
 * ignored, so the allowlist itself is auditable — see `AUDIT-01-F1`/`MAINT-01`
 * and `AUDIT-02-F3` for the history of this specific pair of packages.
 * Revisit on every `next` major upgrade: an entry that stops applying should
 * be deleted, not left stale.
 */
export const KNOWN_UNFIXABLE_ADVISORIES = {
  "GHSA-6g55-p6wh-862q": "postcss, bundled+pinned by next@15.5.21 (node_modules/next/node_modules/postcss@8.4.31); unfixable without a next major (AUDIT-01-F1/AUDIT-02-F3).",
  "GHSA-qx2v-qp2m-jg93": "postcss, bundled+pinned by next@15.5.21 (node_modules/next/node_modules/postcss@8.4.31); unfixable without a next major (AUDIT-01-F1/AUDIT-02-F3).",
  "GHSA-r28c-9q8g-f849": "postcss, bundled+pinned by next@15.5.21 (node_modules/next/node_modules/postcss@8.4.31); unfixable without a next major. This repo's OWN direct postcss devDependency carries the same advisory id but was fixed by MAINT-02 (npm update postcss, 8.5.16 -> 8.5.23) — this allowlist entry covers only the next-bundled copy, which the OSV result set still returns under the same id (AUDIT-01-F1/AUDIT-02-F3).",
  "GHSA-f88m-g3jw-g9cj": "sharp, bundled+pinned by next@15.5.21 (prod); unfixable without a next major (AUDIT-01-F1/AUDIT-02-F3).",
  "GHSA-fxqj-rqcc-2cmp": "postcss, bundled+pinned by next@15.5.21 (node_modules/next/node_modules/postcss@8.4.31); unfixable without a next major (AUDIT-06-F1, owner-decided at MAINT-07). Fourth entry for the same package/version/pinning as the three above, and reasoned on evidence rather than by analogy: OSV records this id fixed in postcss 8.5.23, and this repo's OWN postcss is ALREADY 8.5.23 and unaffected — the only affected copy is the one next declares as an EXACT pin (\"postcss\": \"8.4.31\", no caret), so overriding it would push next off the version it tested against. Reachability was checked, not assumed: postcss runs here only at build time over this repo's own Tailwind CSS via postcss.config.mjs, and the flaw needs attacker-authored CSS processed without a `from` option, which no path here supplies. Compare nanoid GHSA-2v37-7h3g-55p8, which was NOT allowlisted at MAINT-07 because it was genuinely fixable — see the overrides block in package.json. That contrast is what keeps this list meaning \"unfixable\".",
};

/** Package-name extraction: the path segment after the LAST "node_modules/". Handles scoped packages (`@scope/name`) and nested (dedup-broken) installs like "node_modules/next/node_modules/postcss". */
export function packageNameFromLockKey(key) {
  const match = key.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/);
  return match ? match[1] : null;
}

/** Every real, installed (name, version, dev) triple from a parsed package-lock.json (lockfileVersion 3 `packages` map). Skips the root entry and any `link` (workspace symlink) entries, which have no real version of their own. */
export function extractLockEntries(lockJson) {
  const entries = [];
  for (const [key, pkg] of Object.entries(lockJson.packages ?? {})) {
    if (key === "" || pkg.link || !pkg.version) continue;
    const name = packageNameFromLockKey(key);
    if (!name) continue;
    entries.push({ name, version: pkg.version, dev: Boolean(pkg.dev) });
  }
  return entries;
}

function chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
    return chunks;
}

/** Query OSV's querybatch endpoint for every entry, returning entries paired with their (possibly empty) vuln id list. Throws on any network/HTTP failure — a check that could not run must not be reported as clean. */
async function queryOsvBatch(entries) {
  const results = [];
  for (const batch of chunk(entries, BATCH_SIZE)) {
    const res = await fetch(OSV_QUERYBATCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        queries: batch.map((entry) => ({
          package: { name: entry.name, ecosystem: "npm" },
          version: entry.version,
        })),
      }),
    });
    if (!res.ok) {
      throw new Error(`OSV querybatch returned HTTP ${res.status}: ${await res.text()}`);
    }
    const body = await res.json();
    const batchResults = body.results ?? [];
    if (batchResults.length !== batch.length) {
      throw new Error(`OSV querybatch returned ${batchResults.length} results for ${batch.length} queries`);
    }
    batch.forEach((entry, i) => {
      const vulnIds = (batchResults[i].vulns ?? []).map((v) => v.id);
      if (vulnIds.length > 0) results.push({ ...entry, vulnIds });
    });
  }
  return results;
}

/** Fetch full detail (summary + GitHub-reviewed severity) for each distinct advisory id so the report is human-readable. Throws on failure, same rationale as queryOsvBatch. */
async function fetchVulnDetails(vulnIds) {
  const details = new Map();
  await Promise.all(
    [...new Set(vulnIds)].map(async (id) => {
      const res = await fetch(`${OSV_VULN_URL_PREFIX}${id}`);
      if (!res.ok) throw new Error(`OSV vuln lookup for ${id} returned HTTP ${res.status}`);
      const body = await res.json();
      details.set(id, {
        summary: body.summary ?? "(no summary)",
        severity: body.database_specific?.severity ?? "UNKNOWN",
      });
    }),
  );
  return details;
}

function formatFinding(entry, vulnId, detail) {
  return `${entry.dev ? "[dev] " : "[prod]"} ${entry.name}@${entry.version} — ${vulnId} (${detail.severity}): ${detail.summary}`;
}

async function main() {
  const lockJson = JSON.parse(readFileSync(join(process.cwd(), "package-lock.json"), "utf8"));
  const entries = extractLockEntries(lockJson);
  console.log(`[check-advisories] Querying OSV for ${entries.length} resolved package(s)...`);

  let flagged;
  try {
    flagged = await queryOsvBatch(entries);
  } catch (err) {
    console.error(`[check-advisories] REFUSED: could not complete the OSV sweep — ${err.message}`);
    console.error("[check-advisories] A check that could not run is not a clean result. Failing.");
    process.exit(1);
    return;
  }

  if (flagged.length === 0) {
    console.log("[check-advisories] PASS — zero advisories against any resolved package.");
    return;
  }

  const allVulnIds = flagged.flatMap((f) => f.vulnIds);
  let details;
  try {
    details = await fetchVulnDetails(allVulnIds);
  } catch (err) {
    console.error(`[check-advisories] REFUSED: could not fetch advisory detail — ${err.message}`);
    process.exit(1);
    return;
  }

  const prodFailures = [];
  const allowlisted = [];
  const devReported = [];

  for (const entry of flagged) {
    for (const vulnId of entry.vulnIds) {
      const detail = details.get(vulnId);
      const line = formatFinding(entry, vulnId, detail);
      if (entry.dev) {
        devReported.push(line);
      } else if (Object.hasOwn(KNOWN_UNFIXABLE_ADVISORIES, vulnId)) {
        allowlisted.push(`${line}\n         allowlisted (D76): ${KNOWN_UNFIXABLE_ADVISORIES[vulnId]}`);
      } else {
        prodFailures.push(line);
      }
    }
  }

  if (devReported.length > 0) {
    console.log(`\n[check-advisories] Dev-only advisories (reported, not failing — ${devReported.length}):`);
    for (const line of devReported) console.log(`  ${line}`);
  }
  if (allowlisted.length > 0) {
    console.log(`\n[check-advisories] Production advisories allowlisted (D76, not failing — ${allowlisted.length}):`);
    for (const line of allowlisted) console.log(`  ${line}`);
  }
  if (prodFailures.length > 0) {
    console.log(`\n[check-advisories] FAIL — un-allowlisted production advisories (${prodFailures.length}):`);
    for (const line of prodFailures) console.log(`  ${line}`);
    console.log("\n[check-advisories] Fix the dependency, or add a recorded, reasoned entry to KNOWN_UNFIXABLE_ADVISORIES.");
    process.exit(1);
    return;
  }

  console.log("\n[check-advisories] PASS — no un-allowlisted production advisory.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
