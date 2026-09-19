// AUDIT-02-F7 — ESLint flat config, replacing the deprecated `next lint`
// wrapper (`npm run lint` is now a plain `eslint .`).
//
// The `@next/codemod next-lint-to-eslint-cli` codemod generated direct
// `eslint-config-next/core-web-vitals` / `.../typescript` imports, which
// assume a NEWER eslint-config-next than this repo pins: 15.5.21 ships those
// as legacy eslintrc-style objects (`core-web-vitals.js`, `typescript.js`),
// not flat-config arrays, so the generated file failed outright with
// ERR_MODULE_NOT_FOUND. This is the documented Next 15 + ESLint 9 bridge
// (`FlatCompat`) instead — the same shape `create-next-app` emits for Next 15.
//
// The rule set is carried over EXACTLY from the retired `.eslintrc.json`:
//   extends: next/core-web-vitals, next/typescript
//   rules:   react/no-danger error, react/no-unescaped-entities off
// No rule was added, removed, or re-severitied by this migration.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // `next lint` implicitly ignored build output; a bare `eslint .` does not.
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      // Agent-tool-managed git worktrees — a full duplicate checkout of this
      // repository. Linting it reported every finding twice (19,777 problems,
      // vs 10 for the real tree) and would fail the gate on a scratch copy.
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "react/no-danger": "error",
      "react/no-unescaped-entities": "off",
    },
  },
];

export default config;
