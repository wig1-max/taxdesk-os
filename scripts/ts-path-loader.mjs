/**
 * ESM resolve hook so a Node process can import the TY pack (and
 * `taxPackComputation`) under `--experimental-strip-types`.
 *
 * The pack graph uses extensionless relative specifiers and the `@/*`
 * path alias from tsconfig. Node's type-stripper does not rewrite
 * either. This hook is the loader, not a third regex on the pack
 * source: `AUDIT-13-F1` is closed by calling `taxPackComputation()`,
 * and this file is what makes that call possible from a `.mjs` check.
 */
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

function asFileUrl(absPath) {
  return pathToFileURL(absPath).href;
}

function withTsIfPresent(absPath) {
  if (existsSync(absPath)) return absPath;
  if (!extname(absPath) && existsSync(`${absPath}.ts`)) return `${absPath}.ts`;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("node:") || specifier.startsWith("data:")) {
    return nextResolve(specifier, context);
  }

  let candidate = null;
  if (specifier.startsWith("@/")) {
    candidate = withTsIfPresent(join(SRC, specifier.slice(2)));
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL &&
    context.parentURL.startsWith("file:")
  ) {
    candidate = withTsIfPresent(join(dirname(fileURLToPath(context.parentURL)), specifier));
  }

  if (candidate) {
    return { shortCircuit: true, url: asFileUrl(candidate) };
  }
  return nextResolve(specifier, context);
}
