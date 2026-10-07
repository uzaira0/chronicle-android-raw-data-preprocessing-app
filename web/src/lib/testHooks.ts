import type { BrowserProcessingRuntime } from "@/lib/types";

/**
 * Page-script overrides that only a test build honours.
 *
 * `window.__CHRONICLE_TEST_RUNTIME__` replaces the whole processing runtime
 * (timestamp, engine, persistence) and `__CHRONICLE_BENCHMARK_PAYLOAD_BUDGET_BYTES__`
 * pins the worker payload budget. A deployed bundle must not obey either: any
 * same-origin script could otherwise rewrite how every run is executed.
 *
 * `__CHRONICLE_TEST_HOOKS__` is a Vite `define` (vite.config.ts), `true` only
 * when the build ran with `CHRONICLE_E2E_TEST_HOOKS=1` (`npm run build:test`,
 * which the Playwright web server uses). Every other build, including
 * `npm run build:app` in the deploy workflow, defines it `false`, and the
 * minifier then drops both reads together with the global names. This module
 * is the only place that reads them (`testHooks.test.ts` enforces that).
 */
export const TEST_HOOKS_ENABLED: boolean =
  typeof __CHRONICLE_TEST_HOOKS__ !== "undefined" && __CHRONICLE_TEST_HOOKS__;

/** The runtime a test page installed, in a test build only. */
export function testRuntimeOverride(): BrowserProcessingRuntime | undefined {
  if (!TEST_HOOKS_ENABLED || typeof window === "undefined") return undefined;
  return window.__CHRONICLE_TEST_RUNTIME__;
}

/** The payload budget a benchmark pinned, in a test build only. */
export function benchmarkPayloadBudgetOverride(): number | undefined {
  if (!TEST_HOOKS_ENABLED || typeof window === "undefined") return undefined;
  return window.__CHRONICLE_BENCHMARK_PAYLOAD_BUDGET_BYTES__;
}
