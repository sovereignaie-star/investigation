import { defineConfig } from "vitest/config";

// P0-010 (ADR-13): one root Vitest run for the whole workspace.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/sandbox/**"],
    environment: "node",
  },
});
