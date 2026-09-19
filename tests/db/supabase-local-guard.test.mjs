// K3-31 (decision D34) — focused test for the Supabase local-mutation guard.
// Pure logic — no filesystem, no DB, no network. Run: node tests/db/supabase-local-guard.test.mjs
//
// K4-15 widened this: the guard used to watch only `supabase/.temp/project-ref`,
// and a part-way `supabase link` wrote ONLY `linked-project.json` — containing
// the PRODUCTION ref — so the guard reported "safe" with production linked.
// Every marker in `LINK_MARKER_FILES` is now exercised alone, because a marker
// that is only tested alongside another is a marker whose blindness hides.
import { assessSupabaseLinkGuard, LINK_MARKER_FILES } from "../../scripts/supabase-local-guard.mjs";

let pass = 0;
const failures = [];
function check(name, ok) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}`);
  }
}

console.log("Supabase local-mutation guard checks\n");

{
  const result = assessSupabaseLinkGuard([]);
  check("no link marker present -> ok", result.ok === true);
  check("ok message mentions safe to run", /safe to run/i.test(result.message));
  check(
    "ok message names every marker it checked",
    LINK_MARKER_FILES.every((f) => result.message.includes(f)),
  );
}

{
  const result = assessSupabaseLinkGuard([{ name: "project-ref", contents: "your-project-ref\n" }]);
  check("legacy project-ref alone -> refused", result.ok === false);
  check("refusal message names the linked ref", result.message.includes("your-project-ref"));
  check("refusal message cites decision D34", result.message.includes("D34"));
  check("refusal points at removing supabase/.temp", result.message.includes("supabase/.temp"));
}

{
  // K4-15, the live case: `supabase link` failed part-way, wrote ONLY
  // linked-project.json, and the old guard reported "safe" with PRODUCTION
  // linked. This is the assertion that would have caught it.
  const result = assessSupabaseLinkGuard([
    { name: "linked-project.json", contents: '{"ref":"your-project-ref","name":"taxdesk-os-prod"}' },
  ]);
  check("linked-project.json ALONE -> refused (K4-15)", result.ok === false);
  check(
    "ref is extracted from the JSON, not printed raw",
    result.message.includes('linked-project.json = "your-project-ref"'),
  );
}

{
  const result = assessSupabaseLinkGuard([
    { name: "project-ref", contents: "abc" },
    { name: "linked-project.json", contents: '{"ref":"abc"}' },
  ]);
  check(
    "both markers -> refused, both named",
    result.ok === false && LINK_MARKER_FILES.every((f) => result.message.includes(f)),
  );
}

{
  // A present-but-unreadable/empty marker must still refuse — fail closed
  // rather than treating an unreadable link state as "unlinked". K4-15 proved
  // this is not hypothetical: the half-written state it found WAS production.
  check(
    "empty project-ref contents still refused",
    assessSupabaseLinkGuard([{ name: "project-ref", contents: "" }]).ok === false,
  );
  check(
    "null contents (unreadable file) still refused",
    assessSupabaseLinkGuard([{ name: "project-ref", contents: null }]).ok === false,
  );
  check(
    "malformed JSON in linked-project.json still refused",
    assessSupabaseLinkGuard([{ name: "linked-project.json", contents: "{not json" }]).ok === false,
  );
}

{
  const result = assessSupabaseLinkGuard([{ name: "project-ref", contents: "   whitespace-only-ref   " }]);
  check("whitespace is trimmed in the reported ref", result.message.includes("whitespace-only-ref"));
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("FAILURES:", failures);
  process.exit(1);
}
process.exit(0);
