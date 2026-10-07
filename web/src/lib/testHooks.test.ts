import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { build, type Rollup } from "vite";
import { describe, expect, it, vi } from "vitest";

import {
  TEST_HOOKS_ENABLED,
  benchmarkPayloadBudgetOverride,
  testRuntimeOverride,
} from "@/lib/testHooks";

const WEB_ROOT = resolve(__dirname, "../..");
const HOOK_GLOBALS = [
  "__CHRONICLE_TEST_RUNTIME__",
  "__CHRONICLE_BENCHMARK_PAYLOAD_BUDGET_BYTES__",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "wasm" ? [] : sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** Minified production build of testHooks.ts with the define a real build gets. */
async function buildHooksModule(testHooks: boolean): Promise<string> {
  const output = (await build({
    configFile: false,
    logLevel: "silent",
    root: WEB_ROOT,
    resolve: { alias: [{ find: "@", replacement: resolve(WEB_ROOT, "src") }] },
    define: { __CHRONICLE_TEST_HOOKS__: JSON.stringify(testHooks) },
    build: {
      write: false,
      minify: true,
      lib: { entry: resolve(WEB_ROOT, "src/lib/testHooks.ts"), formats: ["es"], fileName: "hooks" },
    },
  })) as Rollup.RollupOutput[];
  return output
    .flatMap((bundle) => bundle.output)
    .map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
    .join("\n");
}

describe("test hooks", () => {
  it("are read only by src/lib/testHooks.ts (and declared only in test-runtime.d.ts)", () => {
    const readers = sourceFiles(resolve(WEB_ROOT, "src"))
      .filter((path) => HOOK_GLOBALS.some((name) => readFileSync(path, "utf8").includes(name)))
      .map((path) => relative(WEB_ROOT, path))
      .sort();
    expect(readers).toEqual(["src/lib/testHooks.ts", "src/test-runtime.d.ts"]);
  });

  it("are off when the build did not define them, and then ignore the page globals", () => {
    vi.stubGlobal("window", {
      __CHRONICLE_TEST_RUNTIME__: { datetimeOfPreprocessing: "2000-01-01 00:00:00" },
      __CHRONICLE_BENCHMARK_PAYLOAD_BUDGET_BYTES__: 1,
    });
    try {
      expect(TEST_HOOKS_ENABLED).toBe(false);
      expect(testRuntimeOverride()).toBeUndefined();
      expect(benchmarkPayloadBudgetOverride()).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hand the page globals through in a test build", async () => {
    const runtime = { datetimeOfPreprocessing: "2000-01-01 00:00:00" };
    vi.stubGlobal("__CHRONICLE_TEST_HOOKS__", true);
    vi.stubGlobal("window", {
      __CHRONICLE_TEST_RUNTIME__: runtime,
      __CHRONICLE_BENCHMARK_PAYLOAD_BUDGET_BYTES__: 512,
    });
    vi.resetModules();
    try {
      const hooks = await import("@/lib/testHooks");
      expect(hooks.TEST_HOOKS_ENABLED).toBe(true);
      expect(hooks.testRuntimeOverride()).toBe(runtime);
      expect(hooks.benchmarkPayloadBudgetOverride()).toBe(512);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("are compiled out of a deploy build and kept in a test build", async () => {
    const deploy = await buildHooksModule(false);
    const testBuild = await buildHooksModule(true);
    for (const name of HOOK_GLOBALS) {
      expect(deploy).not.toContain(name);
      expect(testBuild).toContain(name);
    }
  }, 60_000);

  it("are defined from CHRONICLE_E2E_TEST_HOOKS by vite.config.ts", () => {
    const config = readFileSync(resolve(WEB_ROOT, "vite.config.ts"), "utf8");
    expect(config).toContain('process.env.CHRONICLE_E2E_TEST_HOOKS === "1"');
    expect(config).toContain("__CHRONICLE_TEST_HOOKS__: JSON.stringify(TEST_HOOKS)");
    const scripts = (JSON.parse(readFileSync(resolve(WEB_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }).scripts;
    // The deploy workflow runs build:app; it must never set the flag.
    expect(`${scripts["build:app"]} ${scripts["build:vite"]}`).not.toContain("CHRONICLE_E2E_TEST_HOOKS");
    expect(scripts["build:test"]).toContain("CHRONICLE_E2E_TEST_HOOKS=1");
  });
});
