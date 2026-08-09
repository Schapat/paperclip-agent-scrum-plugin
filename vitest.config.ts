import { readFileSync } from "node:fs";

import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "markdown-as-text",
      enforce: "pre",
      load(id) {
        if (!id.endsWith(".md")) return null;
        return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
      },
    },
  ],
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
