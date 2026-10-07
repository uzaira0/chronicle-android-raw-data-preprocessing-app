import { defineConfig, devices } from "@playwright/test";

import type { DurabilityFixtures } from "./e2e/durabilityContext";

delete process.env.FORCE_COLOR;

const allBrowserProjects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  {
    name: "firefox",
    use: { ...devices["Desktop Firefox"] },
    // Each processing smoke test initializes the production WASM runtime.
    // Concurrent Firefox workers contend heavily enough to exceed interaction
    // timeouts on release runners, while the same tests are stable serially.
    workers: 1,
  },
  {
    name: "webkit",
    use: { ...devices["Desktop Safari"] },
    // Playwright's WebKit contexts are ephemeral (private-mode semantics) and
    // WebKit denies OPFS there ("UnknownError: The operation failed for an
    // unknown transient reason") on the main thread AND in a dedicated worker.
    // That is Safari private browsing, so this project runs ONLY the tests
    // written for a storage-denied engine. The gate reads a repeated pre-open
    // UnknownError as "this context cannot persist" and runs in ephemeral
    // mode, so @no-storage tests here can process files (held in the tab).
    grep: /@no-storage/,
  },
  {
    // WebKit builds that expose OPFS can grant it against an on-disk profile,
    // so this project exercises that durable path. The fixture capability-checks
    // the persistent context and skips it on Linux WPE builds that omit OPFS.
    name: "webkit-durable",
    use: { ...devices["Desktop Safari"], durableProfile: true },
    grepInvert: /@no-storage/,
    // One at a time, because Playwright's WebKit keeps origin-private storage
    // OUTSIDE the profile directory: two persistent contexts with different
    // userDataDirs read and write the SAME OPFS (measured — a marker written by
    // profile A was readable from profile B). Concurrent durable tests were
    // therefore wiping each other's workspace mid-run, which surfaced as
    // WebKit's "operation failed for an unknown transient reason". Chromium and
    // Firefox isolate per context and keep the config's normal parallelism.
    workers: 1,
  },
];

const webServerTimeoutMs = Number(
  process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS ?? "600000",
);
if (!Number.isSafeInteger(webServerTimeoutMs) || webServerTimeoutMs < 1) {
  throw new Error("PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS must be a positive integer");
}

// There is no separate "smoke projects" list: Playwright ANDs a CLI --grep with
// each project's own grep/grepInvert, so `npm run test:e2e:smoke` already
// narrows every project below to its @smoke subset. A second list would be a
// duplicate scope definition that silently widens webkit-durable.

// PLAYWRIGHT_BASE_URL serves two purposes: the canary points it at the deployed
// site, and a local run points it at its own preview server on a port other
// than 4173 (a second worktree, an agent's dedicated port). Only the first is a
// deployed site. A loopback host is always a local build.
const baseUrlOverride = process.env.PLAYWRIGHT_BASE_URL || undefined;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const targetsDeployedSite =
  baseUrlOverride !== undefined && !LOOPBACK_HOSTS.has(new URL(baseUrlOverride).hostname);

export default defineConfig<DurabilityFixtures>({
  // Per-test budget. Local full-gate runs drive chromium + firefox in parallel
  // beside external host load, and the multi-round @opfs tests measured
  // 28.9-29.7 s in isolation against Playwright's 30 s default -- runs 5 and 6
  // of the 2026-08-27 endgame each red on "Test timeout of 30000ms exceeded"
  // under load. 120 s only bounds failures; a passing suite is unaffected.
  // The canary (a deployed site) keeps the 30 s default so a broken production
  // deploy is still detected in minutes, not 4x slower. A local server on
  // another port keeps the local budget: the literature specs that import,
  // switch owner and reload many times take 31-49 s on a loopback
  // PLAYWRIGHT_BASE_URL (chromium and firefox, 2026-10-04) and timed out at 30 s.
  timeout: targetsDeployedSite ? 30_000 : 120_000,
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: baseUrlOverride ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: baseUrlOverride
    ? undefined
    : {
        // make check builds dist once and sets PLAYWRIGHT_PREBUILT so this only
        // serves it. That build is the deploy build (no test hooks), the same
        // bundle the canary's smoke run meets on the live site; a build made
        // here is a test build that honours the injected test runtime.
        command: process.env.PLAYWRIGHT_PREBUILT
          ? "npm run preview"
          : "sh -c 'npm run build:test && npm run preview'",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: webServerTimeoutMs,
        cwd: ".",
      },
  projects: allBrowserProjects,
});
