// K.2.8.8B — Catalog-level authorization-boundary assertions (LOCAL-ONLY).
//
// Verifies the *effective* privilege matrix and RPC security properties
// directly from the Postgres catalog (not migration intent), via
// `docker exec … psql`. Complements the live hostile-postgrest test.
//
// Run: node tests/db/boundary-catalog.mjs  (npm run test:db)
// NOTE (AUDIT-01): this suite is NOT wired into any CI workflow, `test:security`,
// or the standard session gate — see AUDIT-01-F3 in
// the k3-tax-intelligence-program design notes.
// Exit code is non-zero if any invariant fails.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_taxdesk-os";

function q(sql) {
  const out = execFileSync(
    "docker",
    ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql],
    { encoding: "utf8" },
  );
  return out.trim();
}

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? " — " + detail : ""}`);
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}
const priv = (role, obj, p) => q(`select has_table_privilege('${role}','${obj}','${p}')`) === "t";
const colPriv = (role, obj, col, p) => q(`select has_column_privilege('${role}','${obj}','${col}','${p}')`) === "t";

console.log("Catalog checks via", CONTAINER, "\n");

// Protected tables: authenticated has NO table INSERT/UPDATE.
for (const t of ["tax_cases"]) {
  check(`${t}: authenticated UPDATE revoked`, !priv("authenticated", `public.${t}`, "UPDATE"));
}
check("tax_cases: authenticated INSERT revoked (table-wide)", !priv("authenticated", "public.tax_cases", "INSERT"));
check("cases: authenticated UPDATE revoked (table-wide)", !priv("authenticated", "public.cases", "UPDATE"));
check("tax_validation_findings: INSERT revoked", !priv("authenticated", "public.tax_validation_findings", "INSERT"));
check("tax_validation_findings: UPDATE revoked", !priv("authenticated", "public.tax_validation_findings", "UPDATE"));
check("tax_readiness_items: INSERT revoked", !priv("authenticated", "public.tax_readiness_items", "INSERT"));
check("tax_readiness_items: UPDATE revoked", !priv("authenticated", "public.tax_readiness_items", "UPDATE"));
check("tax_computation_snapshots: INSERT revoked", !priv("authenticated", "public.tax_computation_snapshots", "INSERT"));
check("case_status_history: INSERT revoked", !priv("authenticated", "public.case_status_history", "INSERT"));
check("tax_cases: TRUNCATE revoked (latent over-grant)", !priv("authenticated", "public.tax_cases", "TRUNCATE"));

// Protected columns not updatable; ordinary columns retained.
check("tax_cases.finalized_at UPDATE denied", !colPriv("authenticated", "public.tax_cases", "finalized_at", "UPDATE"));
check("tax_cases.client_review_status UPDATE denied", !colPriv("authenticated", "public.tax_cases", "client_review_status", "UPDATE"));
check("cases.status UPDATE denied", !colPriv("authenticated", "public.cases", "status", "UPDATE"));
check("cases.title UPDATE retained (ordinary)", colPriv("authenticated", "public.cases", "title", "UPDATE"));
check("tax_cases.itr_type_selected INSERT retained (creation)", colPriv("authenticated", "public.tax_cases", "itr_type_selected", "INSERT"));

// Ledger ordinary edits retained (finalized-lock is a trigger, not a revoke).
check("tax_income_entries INSERT retained", priv("authenticated", "public.tax_income_entries", "INSERT"));
check("tax_income_entries UPDATE retained", priv("authenticated", "public.tax_income_entries", "UPDATE"));

// anon has nothing.
check("anon has no SELECT on tax_cases", !priv("anon", "public.tax_cases", "SELECT"));

// RPCs: SECURITY DEFINER, owner app_writer, search_path='', authenticated-only.
// AUDIT-01-F2/F3: derived from pg_proc itself (was a hand-maintained list of
// 9, narrower even than deployment-parity-check.mjs's pre-fix 15 of 20) so a
// future guarded RPC can't fall outside this catalog check either.
const RPCS = q(
  "select p.proname from pg_proc p " +
    "join pg_roles r on r.oid=p.proowner " +
    "join pg_namespace n on n.oid=p.pronamespace " +
    "where n.nspname='public' and p.prosecdef and r.rolname='app_writer' " +
    "order by p.proname",
)
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
check("at least one SECURITY DEFINER app_writer-owned RPC found in public", RPCS.length > 0, `found ${RPCS.length}`);
for (const fn of RPCS) {
  const row = q(
    `select p.prosecdef||'|'||r.rolname||'|'||coalesce(array_to_string(p.proconfig,','),'') ` +
    `from pg_proc p join pg_roles r on r.oid=p.proowner ` +
    `join pg_namespace n on n.oid=p.pronamespace ` +
    `where n.nspname='public' and p.proname='${fn}'`,
  );
  const [secdef, owner, cfg] = row.split("|");
  const searchPathPinned = (cfg ?? "").split(",").includes('search_path=""');
  check(`${fn}: SECURITY DEFINER + owner app_writer + search_path pinned exactly to ""`,
    (secdef === "t" || secdef === "true") && owner === "app_writer" && searchPathPinned, row);
}
check("finalize_tax_case executable by authenticated",
  q("select has_function_privilege('authenticated','public.finalize_tax_case(uuid,uuid,text,boolean,uuid)','EXECUTE')") === "t");
check("finalize_tax_case NOT executable by anon",
  q("select has_function_privilege('anon','public.finalize_tax_case(uuid,uuid,text,boolean,uuid)','EXECUTE')") === "f");

// app_writer: least privilege — no login, and no CREATE on schema public.
check("app_writer cannot log in", q("select rolcanlogin from pg_roles where rolname='app_writer'") === "f");
check("app_writer has no BYPASSRLS-less login / is BYPASSRLS nologin",
  q("select rolbypassrls||'|'||rolcanlogin from pg_roles where rolname='app_writer'") === "true|false");
check("app_writer has no CREATE on public", q("select has_schema_privilege('app_writer','public','CREATE')") === "f");

// Coherence constraint present (Migration B).
check("chk_tax_cases_finalized_snapshot constraint exists",
  q("select count(*) from pg_constraint where conname='chk_tax_cases_finalized_snapshot'") === "1");

// Idempotency: GLOBAL unique event_id (Migration A) — binds one event to one row.
check("uq_audit_logs_event_id index exists",
  q("select count(*) from pg_indexes where indexname='uq_audit_logs_event_id'") === "1");
check("audit_logs.event_id is globally unique (not per-action)",
  q("select indexdef from pg_indexes where indexname='uq_audit_logs_event_id'").includes("(event_id)"));

// current_user_id() is SECURITY DEFINER and never takes a caller-supplied actor.
check("app.current_user_id() is SECURITY DEFINER (reads auth.uid())",
  q("select prosecdef from pg_proc where proname='current_user_id' and pronamespace='app'::regnamespace") === "t");
check("app.current_user_id() body is exactly `select auth.uid()`",
  q("select btrim(prosrc) from pg_proc where proname='current_user_id' and pronamespace='app'::regnamespace") === "select auth.uid()");
check("app.current_user_id() pins search_path (definer hardening)",
  q("select coalesce(array_to_string(proconfig,','),'') from pg_proc where proname='current_user_id' and pronamespace='app'::regnamespace").includes("search_path="));

// Serialization + idempotency helpers exist with the expected security modes.
check("app.parent_tax_case_finalized is SECURITY DEFINER (FOR SHARE lock helper)",
  q("select prosecdef from pg_proc where proname='parent_tax_case_finalized' and pronamespace='app'::regnamespace") === "t");
check("app.parent_tax_case_finalized takes a FOR SHARE row lock",
  q("select prosrc from pg_proc where proname='parent_tax_case_finalized' and pronamespace='app'::regnamespace").toLowerCase().includes("for share"));
check("app.event_already_applied exists (idempotency binding)",
  q("select count(*) from pg_proc where proname='event_already_applied' and pronamespace='app'::regnamespace") === "1");

// TAX-SAFE-03: the four guarded reliance boundaries are protected beneath
// their RPC bodies by two transition triggers sharing one fail-closed helper.
check("presumptive activity snapshot helper exists and is SECURITY DEFINER",
  q("select prosecdef from pg_proc where proname='tax_case_presumptive_activity_snapshot_blocked' and pronamespace='app'::regnamespace") === "t");
check("tax_cases activity backstop trigger is enabled",
  q("select tgenabled from pg_trigger where tgname='trg_tax_case_presumptive_activity_snapshot' and not tgisinternal") === "O");
check("evidence-manifest activity backstop trigger is enabled",
  q("select tgenabled from pg_trigger where tgname='trg_manifest_presumptive_activity_snapshot' and not tgisinternal") === "O");
check("activity backstop helper is executable by app_writer but not anon",
  q("select has_function_privilege('app_writer','app.tax_case_presumptive_activity_snapshot_blocked(uuid,uuid)','EXECUTE')||'|'||has_function_privilege('anon','app.tax_case_presumptive_activity_snapshot_blocked(uuid,uuid)','EXECUTE')") === "true|false");
check("activity backstop helper is denied to authenticated callers",
  q("select has_function_privilege('authenticated','app.tax_case_presumptive_activity_snapshot_blocked(uuid,uuid)','EXECUTE')") === "f");

// K4-12: the three checks above name INDIVIDUAL helpers, so a newly added
// `app.*` SECURITY DEFINER helper was covered by nothing — `K4-12` added one
// (`tax_case_rebate_relief_blocked`) and `test:db` stayed at 54, passing by
// omission rather than by inspection. These two are DYNAMIC: they enumerate the
// schema, so every future helper is guarded the day it lands, and the second
// asserts the set is non-empty so an enumeration that silently matched nothing
// cannot read as a pass (the AUDIT-05-F3 shape — a guard whose subject can
// vanish is not a guard).
const definerHelpersMissingSearchPath = q(
  "select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p " +
  "where p.pronamespace='app'::regnamespace and p.prosecdef " +
  "and coalesce(array_to_string(p.proconfig,','),'') <> 'search_path=\"\"'",
);
check(
  `every app.* SECURITY DEFINER helper pins search_path to "" (found unpinned: ${definerHelpersMissingSearchPath || "none"})`,
  definerHelpersMissingSearchPath === "",
);
check("…and that enumeration actually matched some helpers (guards the guard)",
  Number(q("select count(*) from pg_proc where pronamespace='app'::regnamespace and prosecdef")) >= 10);

// No guarded RPC signature accepts a caller-supplied actor/user id parameter.
// Word-boundary regex (Postgres `\y`), not a bare `ilike '%_by%'` substring —
// the old pattern's `_` LIKE-wildcard also matched "..._bytes...", which the
// widened RPC list (see above) now actually reaches (ingest_client_upload).
// One verified, narrowly-named exception: upsert_reviewer_credential's
// p_user_id is the TARGET credential's subject, not the caller — the actor
// is still v_actor := app.current_user_id() inside the function body (read
// directly from the migration to confirm, not assumed).
const rpcNameList = RPCS.filter((fn) => fn !== "upsert_reviewer_credential").map((fn) => `'${fn}'`).join(",");
check("no RPC parameter is an actor/user id (actor derived from JWT only)",
  q("select count(*) from pg_proc p where p.pronamespace='public'::regnamespace " +
    `and p.proname in (${rpcNameList}) ` +
    "and (pg_get_function_arguments(p.oid) ~* '\\yactor\\y' or pg_get_function_arguments(p.oid) ~* '_by\\y' " +
    "or pg_get_function_arguments(p.oid) ~* '\\yuser_id\\y')") === "0");

// AUDIT-08-F1 (decision D242) — TRUNCATE must be held by NO client role, on
// EVERY object in `public`, forever.
//
// `20260712140000_authz_boundary_enforcement.sql` §1e revoked it with `ON ALL
// TABLES IN SCHEMA`, which is a point-in-time sweep: it binds the tables that
// existed at that instant and nothing created afterwards. Supabase's default
// ACL then re-granted it on every new table, and by `AUDIT-08` ten objects
// held it again — all of them created after the sweep, none before.
//
// This assertion is CATALOG-DERIVED and unbounded, deliberately: it names no
// table, so a ledger added next session is covered with no edit here. It is
// the standing control the sweep could not be. TRUNCATE bypasses RLS and does
// not fire the row-level `enforce_ledger_finalized_lock` trigger, so the
// privilege contradicts two controls this repository relies on — even though
// PostgREST exposes no route to reach it.
const truncateOverGrants = q(
  "select coalesce(string_agg(grantee || ':' || table_name, ', ' order by grantee, table_name), '') " +
    "from information_schema.role_table_grants " +
    "where table_schema = 'public' and privilege_type = 'TRUNCATE' " +
    "and grantee in ('authenticated','anon')",
);
check(
  `no public object grants TRUNCATE to authenticated/anon (found: ${truncateOverGrants || "none"})`,
  truncateOverGrants === "",
);
// Guards the guard: if the enumeration above ever stops matching rows for a
// structural reason (a renamed view, a changed catalog), it would report
// "none" and pass vacuously forever. Prove it can still see grants at all.
check(
  "…and that grant enumeration still sees the schema (guards the guard)",
  Number(
    q(
      "select count(*) from information_schema.role_table_grants " +
        "where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT'",
    ),
  ) >= 10,
);

// AUDIT-08-F5 (K4-15) — the CAUSE behind F1, not just the symptom.
//
// The assertion above catches a table that HAS re-acquired TRUNCATE. This one
// catches the DEFAULT PRIVILEGE that would give it to the next table created,
// which is what `20260810160000` left armed: it swept the existing tables and
// argued that the granting role was platform-owned and untargetable. The
// catalog disagrees — `pg_default_acl` names the grantor as `postgres`, which
// is the role migrations create tables as, so it is both targetable and the
// one that produced the finding. `20260810180000` revokes it.
//
// Scoped to the `postgres` grantor ON PURPOSE. `supabase_admin` holds its own,
// wider default ACL that genuinely is platform-owned; no table in this
// repository is created by that role, so it is out of scope here rather than
// silently included in a check that would then fail for a reason no migration
// in this repository can fix.
// `aclexplode`, NOT a LIKE over `defaclacl::text`. The text form is one packed
// string — `{postgres=arwdDxtm/postgres,anon=xtm/postgres,...}` — so a pattern
// like `%anon=%D%` matches the `D` belonging to a LATER entry
// (`service_role=arwdDxtm`) and reports a clean database as broken. That was
// the first version of this check and it failed on correct state; explode the
// ACL into (grantee, privilege) rows and ask the precise question instead.
const truncateDefaultAcl = q(
  "select coalesce(string_agg(distinct pg_get_userbyid(a.grantee), ', '), '') " +
    "from pg_default_acl d " +
    "join pg_namespace n on n.oid = d.defaclnamespace, " +
    "lateral aclexplode(d.defaclacl) a " +
    "where n.nspname = 'public' and d.defaclobjtype = 'r' " +
    "and pg_get_userbyid(d.defaclrole) = 'postgres' " +
    "and a.privilege_type = 'TRUNCATE' " +
    "and pg_get_userbyid(a.grantee) in ('authenticated','anon')",
);
check(
  `no default privilege grants TRUNCATE to authenticated/anon on new public tables ` +
    `(found: ${truncateDefaultAcl || "none"})`,
  truncateDefaultAcl === "",
);

// TRIGGER residual from D252 / AUDIT-08-F5 (closed by migration
// `20260813200000`). D252 revoked TRUNCATE from the `postgres` default ACL and
// deliberately left TRIGGER for "its own scoped session"; this is that session.
// TRIGGER lets a grantee attach a trigger to a NEW table, an unnecessary
// client-role capability here. Same aclexplode shape as the TRUNCATE check
// above (D252's lesson: never a LIKE over `defaclacl::text`), same `postgres`
// grantor scope, same `authenticated`/`anon` grantees. `REFERENCES` and
// `MAINTAIN` are intentionally NOT asserted — they are retained deliberately.
const triggerDefaultAcl = q(
  "select coalesce(string_agg(distinct pg_get_userbyid(a.grantee), ', '), '') " +
    "from pg_default_acl d " +
    "join pg_namespace n on n.oid = d.defaclnamespace, " +
    "lateral aclexplode(d.defaclacl) a " +
    "where n.nspname = 'public' and d.defaclobjtype = 'r' " +
    "and pg_get_userbyid(d.defaclrole) = 'postgres' " +
    "and a.privilege_type = 'TRIGGER' " +
    "and pg_get_userbyid(a.grantee) in ('authenticated','anon')",
);
check(
  `no default privilege grants TRIGGER to authenticated/anon on new public tables ` +
    `(found: ${triggerDefaultAcl || "none"})`,
  triggerDefaultAcl === "",
);
// Guards the guard: the `postgres` default ACL for tables must still be
// visible at all. If the row disappeared (or the grantor were renamed) the
// check above would report "none" and pass vacuously forever.
check(
  "…and the postgres default ACL for public tables is still visible (guards the guard)",
  Number(
    q(
      "select count(*) from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace " +
        "where n.nspname = 'public' and d.defaclobjtype = 'r' " +
        "and pg_get_userbyid(d.defaclrole) = 'postgres'",
    ),
  ) === 1,
);

// ---------------------------------------------------------------------------
// AUDIT-12-F7 (`K4-PORT-04`) — THE THREE CHECKS ABOVE REASON CAREFULLY ABOUT
// **GRANTOR** SCOPE AND ARE SILENT ON **SCHEMA** SCOPE.
//
// Every one of them says `where n.nspname = 'public'`. Their comments justify
// the `postgres`-vs-`supabase_admin` grantor choice at length and never mention
// the schema, because nobody asked the question — which is `AUDIT-11`'s class
// exactly: a guard checking a PROXY (`public`) for the property in its own
// docstring (a client role must not acquire TRUNCATE on a table this repository
// creates). The proxy held for as long as `public` was the only schema anything
// here created tables in, and nothing said so.
//
// **THE FINDING, REPRODUCED LOCALLY RATHER THAN INHERITED FROM THE PRODUCTION
// SWEEP THAT RAISED IT:** the `storage` schema carries a `postgres`-grantor
// table default ACL granting `anon` AND `authenticated` the FULL set —
// DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES, MAINTAIN. Same
// grantor the migrations here create tables as, so it is targetable and simply
// unexamined.
//
// **IT IS LATENT, AND NO REVOKE MIGRATION IS ADDED — THAT IS DELIBERATE.** All
// ten `storage` tables are owned by `supabase_storage_admin`, so none was created
// under that default ACL, and no migration in this repository creates a `storage`
// table (`000003` only inserts a bucket row). A revoke against a schema this
// repository creates nothing in is a change with no subject: it would alter
// platform-owned configuration to fix an exposure that does not exist, and would
// then have to be maintained forever. **The fix is to make the guard SEE the
// whole class**, so the day a migration does create such a table, a gate fails
// instead of a sweep having to notice a month later (`AUDIT-08-F1`'s lesson).
//
// **`AUDIT-12-F7` IS NARROWER THAN IT STATES, AND PLANTING IS WHAT FOUND THAT.**
// The finding says the `postgres` grantor is "the same grantor the repository's
// migrations already target successfully in `public`, so it is reachable by a
// migration and simply unexamined". The first half is true; the second is not,
// measured on the local catalog rather than argued:
//   - `storage` is owned by `supabase_admin`, and `postgres` holds only `U*`
//     (USAGE WITH GRANT OPTION) on it — `has_schema_privilege('postgres',
//     'storage', 'CREATE')` is FALSE, so `create table storage.…` as `postgres`
//     fails outright with "permission denied for schema storage";
//   - `postgres` is **not a superuser** here (`rolsuper` is false) and is not the
//     schema owner, so it cannot grant itself the missing CREATE either: the
//     attempt returns `WARNING: no privileges were granted for "storage"` and
//     leaves `nspacl` byte-identical.
// So **no `supabase/migrations/*.sql` file can reach this exposure at all.**
//
// **WHICH IS NOT AN ARGUMENT FOR DROPPING THE GUARD, AND THE REASON IS A REAL
// PATH THIS REPOSITORY HAS ALREADY USED.** Assertion A is derived from
// `pg_class.relowner` and does not rest on that permission fact holding. The
// exposure becomes live if a future Supabase release changes `storage`'s
// ownership or grants, or if DDL is applied by a role with more privilege than
// `postgres` — and that last one is not hypothetical: `D282`'s revoke went to
// production through the **Dashboard SQL Editor**, deliberately, to avoid
// dragging in local-only migrations. An operator-applied `create table
// storage.…` would leave no row in the migration ledger and no diff in this
// repository. A gate that reads the catalog is the only thing that would see it.
//
// TWO ASSERTIONS, POINTING AT EACH OTHER ON PURPOSE:
//   A. DERIVED — no client-reachable TRUNCATE/TRIGGER default in any schema
//      `postgres` actually owns a table in. No schema is named, so a migration
//      that starts creating tables somewhere new is covered with no edit here.
//   B. PINNED — the schemas carrying such a default ACL are EXACTLY the reviewed
//      latent set. A new one is a finding; one leaving is also a finding, because
//      an exemption may not outlive its subject (`AUDIT-04-F4`).
// A alone would pass today and stay silent about `storage`. B alone would pass if
// `storage` acquired a table of ours. Together they cannot.
// ---------------------------------------------------------------------------

// The privileges that must never reach a client role by default. TRUNCATE
// bypasses RLS and does not fire the row-level finalization-lock trigger;
// TRIGGER would let a grantee attach a trigger to a new table. REFERENCES and
// MAINTAIN are retained deliberately (`D252`) and are NOT asserted.
const CLIENT_FORBIDDEN_DEFAULTS = "('TRUNCATE','TRIGGER')";

// A. Every schema `postgres` OWNS A TABLE IN must be clean. Derived from
// `pg_class.relowner`, never from a list — the whole point of `AUDIT-08-F1` is
// that a point-in-time enumeration is not a standing control.
const ownedSchemaOverGrants = q(
  "select coalesce(string_agg(distinct n.nspname || ':' || pg_get_userbyid(a.grantee) || ':' || " +
    "a.privilege_type, ', '), '') " +
    "from pg_default_acl d " +
    "join pg_namespace n on n.oid = d.defaclnamespace, " +
    "lateral aclexplode(d.defaclacl) a " +
    "where d.defaclobjtype = 'r' " +
    "and pg_get_userbyid(d.defaclrole) = 'postgres' " +
    `and a.privilege_type in ${CLIENT_FORBIDDEN_DEFAULTS} ` +
    "and pg_get_userbyid(a.grantee) in ('authenticated','anon') " +
    "and exists (select 1 from pg_class c where c.relnamespace = n.oid " +
    "and c.relkind in ('r','p') and pg_get_userbyid(c.relowner) = 'postgres')",
);
check(
  `no postgres default privilege grants TRUNCATE/TRIGGER to a client role in ANY schema this ` +
    `repository owns tables in (found: ${ownedSchemaOverGrants || "none"})`,
  ownedSchemaOverGrants === "",
);

// B. The reviewed latent set, pinned exactly. `storage` is here because the
// platform put it there and nothing of ours lives in it; if that stops being
// true, A fires. If the platform adds another such schema, this fires.
const LATENT_DEFAULT_ACL_SCHEMAS = "storage";
const latentDefaultAclSchemas = q(
  "select coalesce(string_agg(distinct n.nspname, ', ' order by n.nspname), '') " +
    "from pg_default_acl d " +
    "join pg_namespace n on n.oid = d.defaclnamespace, " +
    "lateral aclexplode(d.defaclacl) a " +
    "where d.defaclobjtype = 'r' " +
    "and pg_get_userbyid(d.defaclrole) = 'postgres' " +
    `and a.privilege_type in ${CLIENT_FORBIDDEN_DEFAULTS} ` +
    "and pg_get_userbyid(a.grantee) in ('authenticated','anon')",
);
check(
  `the postgres-grantor TRUNCATE/TRIGGER default ACL exists in EXACTLY the reviewed latent ` +
    `schema set (expected "${LATENT_DEFAULT_ACL_SCHEMAS}", found "${latentDefaultAclSchemas}")`,
  latentDefaultAclSchemas === LATENT_DEFAULT_ACL_SCHEMAS,
);

// Guards the guard: the WIDENED scan must see more than the one schema the old
// checks looked at. If it saw only `public` — a fumbled join, a renamed
// catalog — assertion A would pass for the same reason the narrow checks did,
// and the finding would be re-closed without being covered.
check(
  "…and the widened scan really does reach beyond `public` (guards the guard)",
  Number(
    q(
      "select count(distinct n.nspname) from pg_default_acl d " +
        "join pg_namespace n on n.oid = d.defaclnamespace " +
        "where d.defaclobjtype = 'r' and pg_get_userbyid(d.defaclrole) = 'postgres'",
    ),
  ) >= 2,
);

// ---------------------------------------------------------------------------
// AUDIT-12-F8 (`K4-PORT-04`) — `tax_case_review_history` HAS NO ROW FILTER, AND
// THAT IS THE DESIGN. CONFIRMED AGAINST INTENT AND PINNED SO IT IS NOT
// RE-RAISED.
//
// The finding: this definer-rights view projects every review of every case to
// any `authenticated` role with no `where` clause, while its sibling
// `qualified_reviewers` at least narrows. Filed as an OBSERVATION to confirm
// rather than as a defect, which was the right call — "probably correct" is not
// verification. It is confirmed correct, on four independent readings:
//
//   1. **THE VIEW EXISTS IN ORDER TO BE STAFF-READABLE.** Migration
//      `20260714120000` §7 and its §2 comment say so: `tax_case_reviews` carries
//      an ADMIN-ONLY select policy to protect the credential-reference snapshot,
//      and "staff read the reference-free tax_case_review_history view". The
//      security boundary is the COLUMN LIST, not a row filter — and the omitted
//      column is asserted below, which is the assertion that would actually
//      matter if someone widened the projection.
//   2. **CROSS-CASE VISIBILITY IS THE ESTABLISHED MODEL, not a leak this view
//      opens.** `tax_cases`' own select policy is bare `app.is_staff_or_admin()`
//      with no per-case predicate, so any staff member can already read every
//      case. A row filter here would restrict the review history MORE than the
//      cases it describes, which would be an inconsistency rather than a fix.
//   3. **THE APPLICATION SCOPES IT, and the view was never the scoping
//      mechanism.** Its sole consumer (`src/lib/queries/tax-reviewer.ts`) reads
//      it with `.eq("tax_case_id", taxCaseId)`.
//   4. **THE COMPARISON IN THE FINDING IS A CATEGORY ERROR.**
//      `qualified_reviewers`' `where u.is_active and u.deleted_at is null` is a
//      DIRECTORY-FRESHNESS filter — do not offer a deactivated user as an
//      assignable reviewer — not row security. Reading it as the security
//      control the other view lacks is what made the two look inconsistent.
//
// **WHERE THIS CONFIRMATION IS RECORDED, AND WHY NOT WHERE THE BRIEF ASKED.**
// The session brief asked for it "in the migration's own comment". That was not
// done, deliberately: `supabase_migrations.schema_migrations` stores the PARSED
// STATEMENTS of every applied migration (46 for `20260714120000`), so editing an
// applied migration file is a drift hazard, and this repository escalates drift
// rather than risking it (`D34`, the project status notes). It is recorded HERE — as an
// executable assertion, which is stronger than a comment because it FAILS if a
// later session narrows the view — and in the deploy record that filed the
// finding.
//
// **DO NOT "FIX" THIS INTO A FILTERED VIEW.** Narrowing it would change what
// staff can see, which is a product decision and not a security cleanup.
// ---------------------------------------------------------------------------
const reviewHistoryColumns = q(
  "select coalesce(string_agg(column_name, ',' order by column_name), '') " +
    "from information_schema.columns " +
    "where table_schema = 'public' and table_name = 'tax_case_review_history'",
);
check(
  "tax_case_review_history: the view exists and was found (guards the guard)",
  reviewHistoryColumns !== "",
  reviewHistoryColumns,
);
// THE ACTUAL SECURITY BOUNDARY. The base table's admin-only RLS protects the
// credential reference; this view is what staff read instead, so it must never
// project that column.
check(
  "tax_case_review_history: OMITS the credential-reference snapshot (the boundary)",
  !reviewHistoryColumns.includes("reviewer_credential_reference_snapshot"),
  reviewHistoryColumns,
);
// The base table stays admin-only, which is what makes the view's existence
// necessary rather than redundant.
check(
  "tax_case_reviews: base-table SELECT is admin-only",
  q(
    "select coalesce(string_agg(pg_get_expr(p.polqual, p.polrelid), '|'), '') " +
      "from pg_policy p join pg_class c on c.oid = p.polrelid " +
      "where c.relname = 'tax_case_reviews' and p.polcmd = 'r'",
  ) === "app.is_admin()",
);
// UNFILTERED, ASSERTED AS INTENDED RATHER THAN AS AN OVERSIGHT. If a later
// session adds a row filter, this fails and sends them to read the four reasons
// above before changing what staff can see.
check(
  "tax_case_review_history: still has NO row filter — intended, see AUDIT-12-F8 above",
  !/\swhere\s/i.test(q("select pg_get_viewdef('public.tax_case_review_history'::regclass, true)")),
);
// …and the cross-case model this rests on. If `tax_cases` ever gains a per-case
// predicate, reason 2 above stops holding and this view must be revisited.
check(
  "tax_cases: SELECT is still staff-wide with no per-case predicate (reason 2 above)",
  q(
    "select coalesce(string_agg(pg_get_expr(p.polqual, p.polrelid), '|'), '') " +
      "from pg_policy p join pg_class c on c.oid = p.polrelid " +
      "where c.relname = 'tax_cases' and p.polcmd = 'r'",
  ) === "app.is_staff_or_admin()",
);
// anon reaches neither, which no reading of F8 puts in doubt but which nothing
// in this suite asserted either.
for (const view of ["tax_case_review_history", "qualified_reviewers"]) {
  check(`${view}: anon has NO select`, !priv("anon", `public.${view}`, "SELECT"));
  check(`${view}: authenticated HAS select`, priv("authenticated", `public.${view}`, "SELECT"));
}

// ---------------------------------------------------------------------------
// K4-19 — the declared-special-situation vocabulary exists in TWO places and
// was pinned by NOTHING.
//
// `SPECIAL_SITUATIONS` in `src/lib/tax-desk/eligibility.ts` is the application
// vocabulary; `chk_tax_cases_declared_situations` on `public.tax_cases` is the
// database one. Before this check they could drift in either direction, and
// both directions are real failures rather than fail-safe:
//   * a TS-only member is offered to a preparer and then REJECTED by the
//     insert, so a situation they declared is silently not recorded;
//   * a SQL-only member is a value the database accepts that no code can
//     produce, read or explain.
// This is the same class the project status notes records as accepted for the
// `adjustments` constraint ("a THIRD vocabulary pinned by no test"). It is
// closed HERE rather than in general, because `K4-19` adds a member to exactly
// this vocabulary and an unpinned addition can half-land.
//
// BOTH SIDES ARE DERIVED — the TS list is parsed out of the module that owns it
// and the SQL list out of the live catalog. Neither is retyped here, because a
// retyped list would be a third vocabulary and would defeat the purpose.
{
  const constraintDef = q(
    "select pg_get_constraintdef(oid) from pg_constraint " +
      "where conname = 'chk_tax_cases_declared_situations' " +
      "and conrelid = 'public.tax_cases'::regclass",
  );
  const sqlMembers = [...constraintDef.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();

  const eligibilitySrc = readFileSync(
    new URL("../../src/lib/tax-desk/eligibility.ts", import.meta.url),
    "utf8",
  );
  const arrayBody = /export const SPECIAL_SITUATIONS = \[([\s\S]*?)\n\] as const;/.exec(
    eligibilitySrc,
  );
  const tsMembers = arrayBody
    ? [...arrayBody[1].matchAll(/\{\s*code:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]).sort()
    : [];

  // Guards the guard, in BOTH directions. Either parse returning nothing would
  // make the set comparisons below pass vacuously and forever — the exact
  // "green for the wrong reason" shape `AUDIT-11` catalogued.
  check(
    `declared-situation vocabulary: the CHECK constraint was found and parsed (${sqlMembers.length} members)`,
    sqlMembers.length > 0,
    `pg_get_constraintdef returned ${JSON.stringify(constraintDef.slice(0, 120))}`,
  );
  check(
    `declared-situation vocabulary: SPECIAL_SITUATIONS was found and parsed (${tsMembers.length} members)`,
    tsMembers.length > 0,
    arrayBody ? "array matched but no code: entries parsed" : "SPECIAL_SITUATIONS array did not match",
  );

  const onlyInTs = tsMembers.filter((m) => !sqlMembers.includes(m));
  const onlyInSql = sqlMembers.filter((m) => !tsMembers.includes(m));
  check(
    "declared-situation vocabulary: every SPECIAL_SITUATIONS code is accepted by the CHECK constraint",
    onlyInTs.length === 0,
    `TypeScript-only (offered to a preparer, then rejected on insert): ${onlyInTs.join(", ")}`,
  );
  check(
    "declared-situation vocabulary: the CHECK constraint accepts no code the application cannot produce",
    onlyInSql.length === 0,
    `SQL-only (accepted by the database, unknown to every code path): ${onlyInSql.join(", ")}`,
  );
  check(
    "declared-situation vocabulary: K4-19's salary_arrears_section_89 is present on BOTH sides",
    tsMembers.includes("salary_arrears_section_89") && sqlMembers.includes("salary_arrears_section_89"),
    `ts=${tsMembers.includes("salary_arrears_section_89")} sql=${sqlMembers.includes("salary_arrears_section_89")}`,
  );
}

// ---------------------------------------------------------------------------
// K4-PORT-05 / D316 — the statutory-world vocabulary exists in TWO places
// and must be pinned both ways (the K4-19 SPECIAL_SITUATIONS shape).
//
// TAX_LAWS / PERIOD_KINDS in identity.ts are the application vocabulary;
// chk_tax_cases_law / chk_tax_cases_period_kind / chk_tax_cases_assessment_year
// are the database ones. A TS-only member is offered at create and then
// rejected on insert; a SQL-only member is a value the database accepts that
// no resolver can name. The pairing CHECK is the same mapping as
// periodKindForLaw. The period CHECK is pinned to BOTH packs' period
// constants — today both are '2026-27', and a new period on one side only
// is a failure, never a silently unresolvable row.
//
// BOTH SIDES ARE DERIVED. An empty parse cannot pass (AUDIT-11).
// ---------------------------------------------------------------------------
{
  const parseCheckMembers = (conname) => {
    const def = q(
      "select pg_get_constraintdef(oid) from pg_constraint " +
        `where conname = '${conname}' and conrelid = 'public.tax_cases'::regclass`,
    );
    return { def, members: [...def.matchAll(/'([A-Za-z0-9_-]+)'/g)].map((m) => m[1]).sort() };
  };

  const lawSql = parseCheckMembers("chk_tax_cases_law");
  const kindSql = parseCheckMembers("chk_tax_cases_period_kind");
  const periodSql = parseCheckMembers("chk_tax_cases_assessment_year");
  const pairingDef = q(
    "select pg_get_constraintdef(oid) from pg_constraint " +
      "where conname = 'chk_tax_cases_law_period_kind' and conrelid = 'public.tax_cases'::regclass",
  );
  const prefixDef = q(
    "select pg_get_constraintdef(oid) from pg_constraint " +
      "where conname = 'chk_tax_cases_tax_pack_key_prefix' and conrelid = 'public.tax_cases'::regclass",
  );

  const identitySrc = readFileSync(new URL("../../src/lib/tax-pack/identity.ts", import.meta.url), "utf8");
  const casePackSrc = readFileSync(new URL("../../src/lib/tax-pack/case-pack.ts", import.meta.url), "utf8");
  const rulesSrc = readFileSync(
    new URL("../../src/lib/tax-engine/ay-2026-27/rules.ts", import.meta.url),
    "utf8",
  );
  const tyCoordsSrc = readFileSync(
    new URL("../../src/lib/tax-pack/packs/ty-2026-27-coordinates.ts", import.meta.url),
    "utf8",
  );

  const tsLaws = [.../export const TAX_LAWS[^=]*= \[([\s\S]*?)\] as const;/.exec(identitySrc)?.[1].matchAll(/"([A-Z0-9_]+)"/g) ?? []].map((m) => m[1]).sort();
  const tsKinds = [.../export const PERIOD_KINDS[^=]*= \[([\s\S]*?)\] as const;/.exec(identitySrc)?.[1].matchAll(/"([a-z0-9_]+)"/g) ?? []].map((m) => m[1]).sort();
  const ayPeriod = /export const ASSESSMENT_YEAR = "([^"]+)"/.exec(rulesSrc)?.[1];
  const tyPeriod = /export const TY_2026_27_PERIOD = "([^"]+)"/.exec(tyCoordsSrc)?.[1];
  const ayVersion = /export const RULES_VERSION = "([^"]+)"/.exec(rulesSrc)?.[1];
  const tsPeriods = [...new Set([ayPeriod, tyPeriod].filter(Boolean))].sort();

  check(
    `statutory-world law: the CHECK constraint was found and parsed (${lawSql.members.length} members)`,
    lawSql.members.length > 0,
    `pg_get_constraintdef returned ${JSON.stringify(lawSql.def.slice(0, 120))}`,
  );
  check(
    `statutory-world law: TAX_LAWS was found and parsed (${tsLaws.length} members)`,
    tsLaws.length > 0,
    "TAX_LAWS array did not match",
  );
  check(
    "statutory-world law: every TAX_LAWS member is accepted by the CHECK constraint",
    tsLaws.every((m) => lawSql.members.includes(m)),
    `TypeScript-only: ${tsLaws.filter((m) => !lawSql.members.includes(m)).join(", ")}`,
  );
  check(
    "statutory-world law: the CHECK constraint accepts no law the application cannot produce",
    lawSql.members.every((m) => tsLaws.includes(m)),
    `SQL-only: ${lawSql.members.filter((m) => !tsLaws.includes(m)).join(", ")}`,
  );

  check(
    `statutory-world period_kind: the CHECK constraint was found and parsed (${kindSql.members.length} members)`,
    kindSql.members.length > 0,
    `pg_get_constraintdef returned ${JSON.stringify(kindSql.def.slice(0, 120))}`,
  );
  check(
    `statutory-world period_kind: PERIOD_KINDS was found and parsed (${tsKinds.length} members)`,
    tsKinds.length > 0,
    "PERIOD_KINDS array did not match",
  );
  check(
    "statutory-world period_kind: every PERIOD_KINDS member is accepted by the CHECK constraint",
    tsKinds.every((m) => kindSql.members.includes(m)),
    `TypeScript-only: ${tsKinds.filter((m) => !kindSql.members.includes(m)).join(", ")}`,
  );
  check(
    "statutory-world period_kind: the CHECK constraint accepts no kind the application cannot produce",
    kindSql.members.every((m) => tsKinds.includes(m)),
    `SQL-only: ${kindSql.members.filter((m) => !tsKinds.includes(m)).join(", ")}`,
  );

  check(
    "statutory-world pairing: chk_tax_cases_law_period_kind exists",
    pairingDef.length > 0,
    "constraint missing",
  );
  const tyKind = /law === "ITA_2025" \? "([a-z_]+)"/.exec(casePackSrc)?.[1];
  const fallbackKind = /law === "ITA_2025" \? "[a-z_]+" : "([a-z_]+)"/.exec(casePackSrc)?.[1];
  const sqlPairs = [
    ...pairingDef.matchAll(/law = '([^']+)'::text\) AND \(period_kind = '([^']+)'::text/gi),
  ].map((m) => [m[1], m[2]]);
  const tsPairs = [
    ["ITA_1961", fallbackKind],
    ["ITA_2025", tyKind],
  ];
  check(
    "statutory-world pairing: periodKindForLaw was parsed (guards the guard)",
    Boolean(tyKind) && Boolean(fallbackKind),
    "periodKindForLaw ternary did not match",
  );
  check(
    `statutory-world pairing: the CHECK conjuncts were parsed (${sqlPairs.length} pairs)`,
    sqlPairs.length > 0,
    pairingDef.slice(0, 160),
  );
  const pairKey = (p) => `${p[0]}:${p[1]}`;
  const onlyTs = tsPairs.filter((p) => !sqlPairs.some((s) => pairKey(s) === pairKey(p)));
  const onlySql = sqlPairs.filter((p) => !tsPairs.some((t) => pairKey(t) === pairKey(p)));
  check(
    "statutory-world pairing: every periodKindForLaw pair is a CHECK conjunct",
    onlyTs.length === 0,
    `TypeScript-only pairs: ${onlyTs.map(pairKey).join(", ")}`,
  );
  check(
    "statutory-world pairing: every CHECK conjunct is a periodKindForLaw pair",
    onlySql.length === 0,
    `SQL-only pairs: ${onlySql.map(pairKey).join(", ")}`,
  );

  check(
    `statutory-world period: the CHECK constraint was found and parsed (${periodSql.members.length} members)`,
    periodSql.members.length > 0,
    `pg_get_constraintdef returned ${JSON.stringify(periodSql.def.slice(0, 120))}`,
  );
  check(
    "statutory-world period: both packs' period constants were found",
    Boolean(ayPeriod) && Boolean(tyPeriod),
    `ay=${ayPeriod} ty=${tyPeriod}`,
  );
  check(
    "statutory-world period: every pack period is accepted by the CHECK constraint",
    tsPeriods.every((m) => periodSql.members.includes(m)),
    `pack-only: ${tsPeriods.filter((m) => !periodSql.members.includes(m)).join(", ")}`,
  );
  check(
    "statutory-world period: the CHECK constraint accepts no period neither pack registers",
    periodSql.members.every((m) => tsPeriods.includes(m)),
    `SQL-only: ${periodSql.members.filter((m) => !tsPeriods.includes(m)).join(", ")}`,
  );

  check(
    "statutory-world pack-key: prefix CHECK exists and names the coordinate columns",
    /tax_pack_key/.test(prefixDef) && /law/.test(prefixDef) && /period_kind/.test(prefixDef) && /assessment_year/.test(prefixDef),
    prefixDef.slice(0, 160),
  );

  const defaultKey = q(
    "select column_default from information_schema.columns " +
      "where table_schema='public' and table_name='tax_cases' and column_name='tax_pack_key'",
  );
  const expectedDefault = `IN:ITA_1961:assessment_year:${ayPeriod}:${ayVersion}`;
  check(
    "statutory-world pack-key: column default is the current AY pack key",
    Boolean(ayPeriod) && Boolean(ayVersion) && defaultKey.includes(expectedDefault),
    `default=${defaultKey} expected to contain ${expectedDefault}`,
  );

  for (const col of ["law", "period_kind", "tax_pack_key"]) {
    check(
      `statutory-world ${col}: authenticated INSERT retained (creation)`,
      colPriv("authenticated", "public.tax_cases", col, "INSERT"),
    );
    check(
      `statutory-world ${col}: authenticated UPDATE denied`,
      !colPriv("authenticated", "public.tax_cases", col, "UPDATE"),
    );
  }

  const guardSrc = q("select pg_get_functiondef(oid) from pg_proc where proname='guard_tax_cases_protected_columns'");
  check(
    "statutory-world coordinates are in the protected-column trigger",
    /new\.law/.test(guardSrc) && /new\.period_kind/.test(guardSrc) && /new\.tax_pack_key/.test(guardSrc),
    "guard function missing one of law / period_kind / tax_pack_key",
  );
}

console.log(`\n==== ${pass} passed, ${failures.length} failed ====`);
if (failures.length) {
  console.log("FAILURES:\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("ALL CATALOG INVARIANTS HOLD.");
