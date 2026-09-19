import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * K3-21 — the laboratory's BOUNDARY, asserted rather than asserted-in-prose.
 *
 * Two claims are repeated in `CONTRIBUTING.md`, the k3-synthetic-case-laboratory design notes
 * and the session log:
 *
 *   1. **Nothing in production imports `tax-lab`.** The laboratory is a
 *      test/design instrument holding synthetic fixtures; if a route, component
 *      or query ever imported it, synthetic case data would be one import away
 *      from a real screen.
 *   2. **`tax-lab` is pure** — no React, Next.js, Supabase, env/config or route
 *      imports, the same boundary `tax-engine` / `tax-desk` / `tax-pack` obey.
 *
 * Both were true when written and true now — but held only by author discipline,
 * which is precisely the class of guarantee this session exists to make
 * structural. These tests read the source tree, so the claims cannot rot
 * silently.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SRC = join(REPO_ROOT, "src");

function sourceFilesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // directory absent — nothing to check
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFilesUnder(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Import specifiers in a file: `from "..."`, `import("...")`, `require("...")`. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    // Bare side-effect import with no `from` clause (e.g. a module-level
    // `import` of a bare string specifier) — exactly the form the relocated
    // finalization.ts used (AUDIT-01-F6) that the other three patterns above
    // missed. Written without a literal quoted example in this comment
    // deliberately — this file is itself scanned by the tests below, and an
    // example string here would false-positive against itself.
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) specs.push(match[1]!);
  }
  return specs;
}

function rel(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join("/");
}

describe("nothing in production imports the laboratory", () => {
  it("no file under src/app or src/components references tax-lab", () => {
    const offenders: string[] = [];
    for (const dir of [join(SRC, "app"), join(SRC, "components")]) {
      for (const file of sourceFilesUnder(dir)) {
        const specs = importSpecifiers(readFileSync(file, "utf8"));
        if (specs.some((s) => s.includes("tax-lab"))) offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no file under src/lib outside tax-lab itself references tax-lab", () => {
    // Queries, server actions and pure domain modules must not reach into the
    // laboratory either — synthetic fixtures have no business in a read model.
    const labDir = join(SRC, "lib", "tax-lab");
    const offenders: string[] = [];
    for (const file of sourceFilesUnder(join(SRC, "lib"))) {
      if (file.startsWith(labDir)) continue;
      const specs = importSpecifiers(readFileSync(file, "utf8"));
      if (specs.some((s) => s.includes("tax-lab"))) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it("actually scans a non-trivial number of production files", () => {
    // Guards the guard: a broken path would make the checks above vacuously
    // pass over an empty file list.
    const count =
      sourceFilesUnder(join(SRC, "app")).length +
      sourceFilesUnder(join(SRC, "components")).length;
    expect(count).toBeGreaterThan(50);
  });
});

const FORBIDDEN = [
  "react",
  "react-dom",
  "next",
  "next/",
  "@supabase/",
  "server-only",
];

function purityOffenders(dir: string): string[] {
  const offenders: string[] = [];
  for (const file of sourceFilesUnder(dir)) {
    for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
      const forbidden =
        FORBIDDEN.some((f) => spec === f || spec.startsWith(f)) ||
        spec.includes("@/app/") ||
        spec.includes("@/components/") ||
        spec.includes("@/lib/supabase");
      if (forbidden) offenders.push(`${rel(file)} → ${spec}`);
    }
  }
  return offenders;
}

describe("the laboratory is pure", () => {
  it("imports no React, Next.js, Supabase or route module", () => {
    const labFiles = sourceFilesUnder(join(SRC, "lib", "tax-lab"));
    expect(labFiles.length).toBeGreaterThan(5);
    expect(purityOffenders(join(SRC, "lib", "tax-lab"))).toEqual([]);
  });
});

describe("tax-desk / tax-engine / tax-pack are pure (AUDIT-01-F6, decision D67)", () => {
  // PROJECT_CONSTITUTION.md §2 rule 6 / CONTRIBUTING.md claim ALL FOUR trees are
  // pure TypeScript with no React/Next/Supabase/route imports. Only
  // `tax-lab` had a machine-enforced check (above); `finalization.ts` drifted
  // into `tax-desk` undetected until AUDIT-01 found it and it was relocated
  // to `src/lib/tax-desk-server/*` (deliberately NOT covered by this check —
  // its whole job is being the server-side exception). These three trees now
  // get the same check with NO exception list, so a repeat drift fails loud.
  it.each(["tax-desk", "tax-engine", "tax-pack"])("src/lib/%s imports no React, Next.js, Supabase or route module", (treeName) => {
    const dir = join(SRC, "lib", treeName);
    const files = sourceFilesUnder(dir);
    expect(files.length).toBeGreaterThan(5);
    expect(purityOffenders(dir)).toEqual([]);
  });
});
