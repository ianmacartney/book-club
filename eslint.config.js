import convex from "@convex-dev/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  { ignores: ["convex/_generated/**"] },
  // The plugin's flat `recommended` sets the plugin, `files: convex/**/*.ts`,
  // and its baseline rules (require-args-validator, explicit-table-ids,
  // no-filter-in-query, …) but no parser.
  ...convex.configs.recommended,
  {
    files: ["convex/**/*.ts"],
    languageOptions: {
      // Type-aware linting: `explicit-table-ids`, `no-filter-in-query`, and
      // `no-collect-in-query` no-op without a TS program. projectService finds
      // convex/tsconfig.json automatically.
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Not in `recommended` — this is what flags unbounded `.collect()`
      // full-table scans (prefer an indexed `.take()`/`.paginate()`).
      "@convex-dev/no-collect-in-query": "warn",
    },
  },
];
