import { defineConfig, devices } from "@playwright/test";

import type { DurabilityFixtures } from "./e2e/durabilityContext";

delete process.env.FORCE_COLOR;

const allBrowserProjects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  {
    name: "webkit",
    use: { ...devices["Desktop Safari"] },
    // Playwright's WebKit contexts are ephemeral (private-mode semantics) and
    // WebKit denies OPFS there ("UnknownError: The operation failed for an
    // unknown transient reason") on the main thread AND in a dedicated worker.
    // That is exactly the environment the fail-closed durable-workspace gate
    // exists for, so this project runs ONLY the tests written for a
    // storage-denied engine. It cannot run anything that processes a file,
    // because the gate correctly refuses to process without durable storage —
    // that refusal is the product behaviour, not a harness limitation.
    grep: /@no-storage/,
  },
  {
    // The same WebKit build DOES grant OPFS against an on-disk profile, so this
    // is WebKit's real coverage: everything except the storage-denied tests
    // above, through a persistent context (see e2e/durabilityContext.ts).
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

// There is no separate "smoke projects" list: Playwright ANDs a CLI --grep with
// each project's own grep/grepInvert, so `npm run test:e2e:smoke` already
// narrows every project below to its @smoke subset. A second list would be a
// duplicate scope definition that silently widens webkit-durable.

export default defineConfig<DurabilityFixtures>({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "sh -c 'npm run build && npm run preview'",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        cwd: ".",
      },
  projects: allBrowserProjects,
});
