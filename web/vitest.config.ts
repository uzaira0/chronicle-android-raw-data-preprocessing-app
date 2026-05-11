import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  benchmark: {
    include: ["src/**/*.bench.ts"],
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**", "src/**/*.bench.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/plotGenerator.ts"],
      thresholds: {
        lines: 75,
        functions: 80,
        branches: 60,
        statements: 75,
      },
    },
  },
});
