import { defineConfig } from "vitest/config";

// Backend tests only — the Convex functions run against convex-test's
// in-memory backend, which wants the edge runtime rather than jsdom.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
