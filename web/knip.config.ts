import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // The Playwright suite is a real consumer: e2e/helpers.ts imports from
  // src/lib, so without e2e in scope those imports read as dead exports.
  // scripts/third_party_notices.mts: the build plugin vite.config.ts loads;
  //   it is the only importer of rollup-plugin-license.
  entry: ["src/workers/**/*.ts", "e2e/**/*.ts", "scripts/third_party_notices.mts"],
  project: ["src/**/*.{ts,tsx}", "e2e/**/*.ts"],
  // @lhci/cli: binary-only (scripts/check-lighthouse.sh runs node_modules/.bin/lhci)
  // vite-node: binary-only, and invoked as an argument of run-clean-env.mjs so
  //   knip cannot see it in package.json scripts
  ignoreDependencies: ["@lhci/cli", "vite-node"],
  // make: package.json scripts shell out to the repository-root Makefile, which
  // is not and cannot be a package dependency.
  // uvx: the generated-model tests run the external, pinned Python tool runner.
  ignoreBinaries: ["wasm-pack", "make", "uvx"],
  // Generated contract surface and test-support fixtures export a declared API
  // that generators/tests consume selectively; unused-export findings there are
  // by design, not dead code.
  ignore: [
    "src/lib/generatedContract.ts",
    "src/lib/generatedRuntimeBoundary.ts",
    "src/lib/types.ts",
    "src/testSupport/**",
  ],
};

export default config;
