import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages}/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.output/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "artifacts/coverage",
    },
  },
});
