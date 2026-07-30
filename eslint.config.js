import convex from "@convex-dev/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// The plugin only ships a legacy (eslintrc) `recommended` preset. Pull its rule
// set out so we stay in sync if the plugin adds/retunes rules, then layer on
// `no-collect-in-query` — which is NOT in `recommended` but is exactly what
// catches unbounded `.collect()` full-table scans.
const recommendedRules = convex.configs.recommended.overrides[0].rules;

export default [
  { ignores: ["convex/_generated/**"] },
  {
    files: ["convex/**/*.ts"],
    plugins: { "@convex-dev": convex },
    languageOptions: {
      parser: tsParser,
      // Type-aware linting: `explicit-table-ids`, `no-collect-in-query`, and
      // `no-filter-in-query` no-op without a TS program. projectService finds
      // convex/tsconfig.json automatically.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...recommendedRules,
      "@convex-dev/no-collect-in-query": "warn",
    },
  },
];
