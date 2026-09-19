#!/usr/bin/env node
/**
 * check-control-bytes — refuse a stray control byte in tracked text.
 *
 * WHY THIS EXISTS (AUDIT-12-F4). This class has bitten twice in three sessions
 * and BOTH times was caught by luck rather than by a control:
 *
 *   · `K4-19` wrote a guard whose regex was `/\x08s\.\s?\d+/` — a Bash heredoc
 *     had turned the intended `\b` into a literal 0x08 BACKSPACE byte. The
 *     regex therefore matched NOTHING, and its test was GREEN WHILE ASSERTING
 *     NOTHING. It surfaced only because that session planted a violation
 *     against its own new guard.
 *   · `MAINT-03` hit the same class with two NUL bytes.
 *
 * Neither is visible in review: `git diff --numstat` reports `-  -` for a file
 * containing NUL and says NOTHING AT ALL about 0x08. A reviewer reading the
 * diff sees `\b`-shaped intent and cannot see the byte.
 *
 * WHAT IT CHECKS: no byte below 0x20 other than TAB/LF/CR, and no 0x7f, in any
 * scanned file. That is the whole property — it is deliberately narrow.
 *
 * WHAT IT DOES **NOT** CHECK, stated so the next reader does not over-trust it:
 *   · It cannot tell a DELIBERATE control byte from an accidental one. Any deliberate
 *     one must be listed in ALLOWED below with its reason, so adding a new one is a deliberate edit rather than a
 *     silent pass.
 *   · It says NOTHING about whether a regex is correct — only that it contains
 *     no byte the author could not see. A perfectly-typed regex that checks the
 *     wrong property is `AUDIT-11`'s question (`D304`), not this one.
 *   · `docs/evidence/statutory-sources/extracts/**` is EXCLUDED: those are
 *     verbatim `pdftotext` output, hash-pinned in the manifest (`D302`/`D308`),
 *     and legitimately carry 0x0c form feeds as page breaks. Editing them to
 *     satisfy a lint would break the evidence base — the bytes there are the
 *     evidence.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "tests", "e2e", "scripts", "supabase", ".github"];
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "test-results", "playwright-report", "coverage", ".sources",
]);
const BINARY = /\.(png|jpe?g|gif|ico|webp|pdf|woff2?|ttf|eot|zip|gz|mp4|mov|bin)$/i;

/** Byte values a text file may legitimately contain. */
const OK = new Set([0x09, 0x0a, 0x0d]);

/**
 * Deliberate, reviewed exceptions — path -> reason. An entry here is a claim
 * that a human looked at the byte and meant it. Keep this list tiny.
 */
const ALLOWED = new Map();

const files = [];
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full);
    else if (!BINARY.test(name)) files.push(full);
  }
}
for (const d of SCAN_DIRS) walk(join(ROOT, d));

const findings = [];
let scanned = 0;

for (const file of files) {
  let buf;
  try { buf = readFileSync(file); } catch { continue; }
  scanned++;
  const rel = relative(ROOT, file).split(sep).join("/");
  let line = 1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0a) { line++; continue; }
    if ((b >= 0x20 && b !== 0x7f) || OK.has(b)) continue;
    if (ALLOWED.has(rel)) continue;
    findings.push({
      rel,
      line,
      byte: "0x" + b.toString(16).padStart(2, "0"),
      near: JSON.stringify(buf.subarray(Math.max(0, i - 24), i + 24).toString("latin1")),
    });
  }
}

console.log(
  `[control-bytes] scanned ${scanned} tracked text file(s) under ${SCAN_DIRS.join(", ")}; ` +
    `${ALLOWED.size} reviewed exception(s).`,
);

/** The exemption list may not outlive its subjects (the AUDIT-04-F4 shape). */
const stale = [...ALLOWED.keys()].filter(
  (p) => !files.some((f) => relative(ROOT, f).split(sep).join("/") === p),
);
if (stale.length > 0) {
  console.error(
    `[control-bytes] FAIL — ${stale.length} reviewed exception(s) name a file that no longer ` +
      `exists; delete the entry rather than leaving a permanent hole:\n  ${stale.join("\n  ")}`,
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`[control-bytes] FAIL — ${findings.length} stray control byte(s):`);
  for (const f of findings) console.error(`  ${f.rel}:${f.line}  ${f.byte}  near ${f.near}`);
  console.error(
    "\nA control byte is invisible in review and can silently kill a regex " +
      "(K4-19's 0x08) or a whole file's diff (MAINT-03's NUL). If it is " +
      "deliberate, write it as an escape (\\u0004) or add a reasoned entry to " +
      "ALLOWED in this script.",
  );
  process.exit(1);
}

console.log("[control-bytes] PASS — no stray control byte outside TAB/LF/CR.");
