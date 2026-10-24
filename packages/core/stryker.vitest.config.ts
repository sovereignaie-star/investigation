import { defineConfig } from "vitest/config";

/**
 * P6-005: core-only Vitest config for the Stryker mutation run. The mutation score
 * of the core is measured against the core's own test suite (unit scope) — other
 * packages' tests are not counted, which keeps the score honest and the run fast.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
