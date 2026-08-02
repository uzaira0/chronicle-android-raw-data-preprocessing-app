import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      // Opt-in (vitest run --coverage / bun run test:coverage). Scoped to the
      // pipeline/library logic that the unit suite owns — UI components are
      // covered by the Playwright personas, not line coverage here.
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/**/*.test.ts",
        "src/wasm/**",
        // Browser-SESSION glue with no algorithm: each file below only wires
        // browser APIs (service worker, document theme, Notification,
        // indexedDB/caches wipe + location.reload, anchor-click download,
        // component tooltip copy) and is exercised by the Playwright personas.
        // Excluding a file here requires that justification — never exclude
        // pipeline/report/store logic.
        "src/lib/swUpdate.ts",
        "src/lib/theme.ts",
        "src/lib/notification.ts",
        "src/lib/localDataReset.ts",
        "src/lib/download.ts",
        "src/lib/tooltipText.ts",
      ],
      reporter: ["text", "text-summary", "lcov"],
      // Hard floor: 99% of every included line/statement/function must be
      // unit-covered (branches ratcheted separately — v8 counts each unhit
      // ternary/`??` arm). Coverage-irrelevant code is either excluded above
      // (whole browser-glue files, with justification) or marked with an
      // inline `/* v8 ignore */` naming the reason (DOM/canvas-only blocks).
      // Never meet this floor by widening those escapes for testable logic.
      thresholds: {
        lines: 99,
        statements: 99,
        functions: 99,
        // Branches ratcheted to 95 (measured 95.27% on 2026-08-01). v8 counts each unhit
        // ternary/`??`/optional-chain arm separately, so 99 is unrealistic here;
        // the residual uncovered arms are documented-unreachable defensive/DOM
        // guards. Keep this a hair under the measured value to bite regressions
        // without flaking.
        branches: 95,
      },
    },
  },
});
