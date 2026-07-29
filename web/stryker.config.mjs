// @ts-check
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  mutate: [
    "src/lib/validation.ts",
    "src/lib/fileInspection.ts",
    "src/lib/settingsPersistence.ts",
  ],
  vitest: {
    configFile: "vitest.config.ts",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  timeoutMS: 30_000,
  disableTypeChecks: true,
  coverageAnalysis: "perTest",
};

export default config;
