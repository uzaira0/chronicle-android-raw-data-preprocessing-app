import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/main.tsx", "src/workers/**/*.ts"],
  project: ["src/**/*.{ts,tsx}"],
  ignoreDependencies: ["vite-node"],
};

export default config;
