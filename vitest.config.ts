import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live next to the code they cover, under src/core/**/__tests__.
    include: ["src/**/*.test.ts", "tests/**/*.spec.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      exclude: ["**/__tests__/**", "**/__integration__/**", "**/index.ts"],
    },
  },
});
