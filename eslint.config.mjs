// P0-022 — static code quality (ROADMAP 6.1, NFR-16, ADR-22). Fast, non type-aware rules; typecheck runs separately.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "attached_assets/**",
      "docs/**",
      "tools/**",
      "**/generated/**",
      "**/.cache/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser, ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      complexity: ["error", 15],
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.tsx", "**/*.jsx"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Legacy debt, tracked: these files are replaced by core/detect (P1-004..P1-006) and P2 adapters.
    // Remove each entry when its replacement lands; do not add new files here.
    files: [
      "apps/web/src/utils/identifierList.ts",
      "apps/web/src/utils/resultFetcher.ts",
      "apps/web/src/utils/smartInvestigator.ts",
      "lib/api-client-react/src/custom-fetch.ts",
    ],
    rules: { "no-useless-escape": "off", "no-control-regex": "off", complexity: "off" },
  },
  {
    // Vendored shadcn/ui primitives in the preview sandbox (not product code).
    files: ["apps/sandbox/src/components/ui/**", "apps/sandbox/src/hooks/**"],
    rules: { complexity: "off", "@typescript-eslint/no-unused-vars": "off" },
  },
  {
    // CLI tools and tests print by design.
    files: ["scripts/**", "**/*.test.*", "**/vite.config.*", "**/build.mjs"],
    rules: { "no-console": "off" },
  },
);
