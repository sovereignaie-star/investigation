import { defineConfig } from "vitest/config";

/**
 * Core packages in the sense of ROADMAP 8.5 (G-13): line coverage >= 85% from phase 1.
 * `engine` and `egress` join this list when their packages exist (P2-001, P2-003).
 */
const CORE = ["packages/core/src", "packages/ledger/src"];

// P0-010 (ADR-13): one root Vitest run for the whole workspace.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/sandbox/**"],
    environment: "node",
    coverage: {
      // P1-027: `pnpm run test:coverage` measures and enforces the core ceiling; nothing is uploaded (ADR-23)
      provider: "v8",
      include: CORE.map((d) => `${d}/**/*.ts`),
      // tests, and generated data (the identifier catalog is generated from YAML) are not code under test
      exclude: ["**/*.test.ts", "packages/core/src/identifiers/catalog.ts"],
      reporter: ["text", "text-summary", "json-summary"],
      // G-13 stays measurable when a test fails; the failure still fails the run
      reportOnFailure: true,
      reportsDirectory: "coverage",
      thresholds: Object.fromEntries(CORE.map((d) => [`${d}/**/*.ts`, { lines: 85 }])),
    },
  },
});
