import { defineConfig } from "vitest/config";

// Convex functions run in an in-memory backend; mobile utility tests are pure
// TypeScript and can share its edge runtime without native Expo dependencies.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "mobile/src/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
