import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig uses jsx:"preserve" for Next — tell the test bundler to
  // transform JSX itself (needed by the react-pdf render smoke test).
  // Cast: option shapes differ across vitest 2 (esbuild) / 4 (oxc);
  // each version picks up its own key and ignores the other.
  ...({
    esbuild: { jsx: "automatic" },
    oxc: { jsx: { runtime: "automatic" } },
  } as Record<string, unknown>),
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      // "server-only" throws outside RSC — stub it for unit tests.
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
