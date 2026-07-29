import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/workers/**/*.ts"],
  project: ["src/**/*.{ts,tsx}"],
  // @lhci/cli: binary-only (scripts/check-lighthouse.sh runs node_modules/.bin/lhci)
  // vite-node: binary-only, and invoked as an argument of run-clean-env.mjs so
  //   knip cannot see it in package.json scripts
  ignoreDependencies: ["@lhci/cli", "vite-node"],
  ignoreBinaries: ["wasm-pack"],
  // Generated contract surface and test-support fixtures export a declared API
  // that generators/tests consume selectively; unused-export findings there are
  // by design, not dead code.
  ignore: ["src/lib/generatedContract.ts", "src/lib/types.ts", "src/testSupport/**"],
};

export default config;
