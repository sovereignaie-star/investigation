// P0-022 — static code quality (ROADMAP 6.1, NFR-16, ADR-22). Fast, non type-aware rules; typecheck runs separately.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
// P3-017: the zero-inline-text rule — no Arabic/English UI text embedded in
// JSX; every string comes from @ir/i18n (t()).
import noInlineUiText from "./scripts/eslint-rules/no-inline-ui-text.mjs";

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
    // P3-017: zero inline UI text — Arabic or English words embedded directly
    // in JSX (text nodes, children literals, text-carrying attributes) are
    // banned; use t() from @ir/i18n. Tests assert rendered strings and are
    // excluded; generated and vendored code too.
    files: ["apps/web/src/**/*.tsx", "packages/ui/src/**/*.tsx"],
    ignores: ["**/*.test.tsx", "**/*.test.ts"],
    plugins: { "ir-i18n": { rules: { "no-inline-ui-text": noInlineUiText } } },
    rules: { "ir-i18n/no-inline-ui-text": "error" },
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
    // P1-019: the pure core never reads wall-clock time or ambient randomness; inject Clock/Random instead (5.2, D1, D11).
    files: ["packages/core/src/**/*.ts", "packages/schema/src/**/*.ts", "packages/ledger/src/**/*.ts", "packages/store/src/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/core/src/clock.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: "Use an injected Clock (P1-019)." },
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Use an injected Clock (P1-019)." },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: "Use an injected Random (P1-019).",
        },
      ],
    },
  },
  {
    // CLI tools and tests print by design.
    files: ["scripts/**", "packages/*/scripts/**", "**/*.test.*", "**/vite.config.*", "**/build.mjs"],
    rules: { "no-console": "off" },
  },
);
