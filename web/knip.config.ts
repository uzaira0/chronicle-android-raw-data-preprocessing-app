import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/workers/**/*.ts"],
  project: ["src/**/*.{ts,tsx}"],
  // papaparse and read-excel-file: used via dynamic imports, knip can't trace them
  // @types/papaparse: companion types for the above
  // fast-check: used only in *.property.test.ts files, outside knip's project scope
  ignoreDependencies: ["papaparse", "@types/papaparse", "read-excel-file", "fast-check"],
  ignoreBinaries: ["wasm-pack"],
};

export default config;
