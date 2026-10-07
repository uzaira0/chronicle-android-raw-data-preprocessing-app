import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { packedJsonAssetsPlugin } from "./scripts/packed_json_assets.mjs";

// The dependency-evidence refresh points campaigns at its isolated bootstrap
// WASM package. The GLUE MODULE must come from that same package, not the
// committed one: the campaign harness already loads the .wasm bytes from this
// directory, and glue and bytes are only guaranteed import-compatible when
// they come from the same wasm-pack run (the coverage-instrumented nightly
// bootstrap build emits an externref init import the committed glue lacks).
// vite.config.ts carries the same alias, but a standalone vitest.config.ts
// replaces the Vite config entirely, so it must be declared here too.
const dependencyCampaignPackage =
  process.env.CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR;

export default defineConfig({
  plugins: [packedJsonAssetsPlugin(resolve(__dirname))],
  resolve: {
    alias: [
      ...(dependencyCampaignPackage
        ? [
            {
              find: "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js",
              replacement: resolve(
                dependencyCampaignPackage,
                "chronicle_preprocessing_runtime_wasm.js",
              ),
            },
          ]
        : []),
      { find: "@", replacement: resolve(__dirname, "./src") },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    // Reports whether the machine-local private literature corpus is present,
    // i.e. whether the tests gated on it ran or were skipped.
    globalSetup: ["src/testSupport/privateCorpusGlobalSetup.ts"],
    // Stated explicitly rather than inherited. These are vitest 4's defaults, so
    // pinning them changes no current result — the point is that a version bump
    // cannot move them silently, and that a stuck test fails by name instead of
    // blocking forever. They bound a single test/hook only; nothing here bounds
    // total run time, which is why scripts/check-web-critical-coverage.sh also
    // carries a wall-clock backstop.
    testTimeout: 5_000,
    hookTimeout: 10_000,
    teardownTimeout: 10_000,
    // Surface slow tests instead of letting them accumulate invisibly. The four
    // campaign files excluded from test:unit/test:coverage in package.json are the
    // ones this would otherwise flag on every run.
    slowTestThreshold: 1_000,
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
