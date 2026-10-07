import { expect, test } from "@playwright/test";

import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  assertNoExternalRequests,
  gotoApp,
  installDeterministicRuntime,
  processFiles,
  setInputFile,
  trackExternalRequests,
  waitForServiceWorkerControl,
} from "./helpers";
import { startInterruptibleOrigin } from "./interruptibleOrigin";

/**
 * Persona 9 — Service worker update tester.
 *
 * The app's SW precaches the shell (skipWaiting + clients.claim) so it works
 * offline. The update flow must keep the page usable, never destroy in-memory
 * work, prune stale caches, and keep serving offline after an update. Runs on
 * chromium, firefox and webkit-durable (whose default context here is
 * Playwright's ephemeral WebKit context, where the worker installs).
 */
test.describe.configure({ mode: "serial" });

let requestTracker: ReturnType<typeof trackExternalRequests>;
let pageErrors: string[];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  requestTracker = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);
});

test.afterEach(() => {
  expect(pageErrors, "no uncaught errors").toEqual([]);
});

test("registers, controls the page, and is scoped to the app root", async ({ page }) => {
  await waitForServiceWorkerControl(page);
  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  expect(scope.endsWith("/")).toBe(true);
  expect(new URL(scope).origin).toBe(new URL(page.url()).origin);
  assertNoExternalRequests(requestTracker);
});

test("the shell is precached and stale caches are pruned to the current version", async ({
  page,
}) => {
  await waitForServiceWorkerControl(page);
  const cacheState = await page.evaluate(async () => {
    const keys = await caches.keys();
    const shellKeys = keys.filter((key) => key.startsWith("chronicle-local-shell"));
    const current = shellKeys[0];
    const cache = current ? await caches.open(current) : null;
    const requests = cache ? await cache.keys() : [];
    const scope = (await navigator.serviceWorker.getRegistration())?.scope ?? "";
    return { shellKeys, entryCount: requests.length, scope };
  });
  // Exactly one shell cache version is live (older versions were pruned on activate).
  expect(cacheState.shellKeys).toHaveLength(1);
  // Named after the worker's scope, so co-origin apps never share a cache.
  expect(cacheState.shellKeys[0]).toMatch(/^chronicle-local-shell-v3(-[0-9a-f]+|-dev)?@https?:\/\/.+\/$/);
  expect(cacheState.shellKeys[0]?.endsWith(`@${cacheState.scope}`)).toBe(true);
  expect(cacheState.entryCount).toBeGreaterThan(0);
  assertNoExternalRequests(requestTracker);
});

test("an SW update does not reload the page or destroy in-memory results", async ({ page }) => {
  await waitForServiceWorkerControl(page);
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  await expect(page.getByTestId("result-panel")).toBeVisible();

  // Force the SW to re-check for an update while a run is on screen.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });

  // No silent reload happened: the in-memory result is still right there.
  await page.waitForTimeout(300);
  await expect(page.getByTestId("result-panel")).toBeVisible();
  await expect(page.getByTestId("result-panel")).toContainText("1 file processed");
  assertNoExternalRequests(requestTracker);
});

test("no update banner appears on a clean first load (no spurious prompt)", async ({ page }) => {
  await waitForServiceWorkerControl(page);
  // The banner must only appear when a NEW worker installs over an existing
  // controller — never on the first install. This guards the first-install
  // false-positive (an update prompt the user could never satisfy).
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
  // Re-checking the SW (same build → no newer version) must not conjure a banner.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await page.waitForTimeout(300);
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
  assertNoExternalRequests(requestTracker);
});

test("after an update, the app still cold-starts offline from the precache", async ({
  context,
  baseURL,
  browserName,
}) => {
  // The app runs through a relay the test can switch off, so going offline is
  // a network error on every engine (see interruptibleOrigin.ts for why
  // context.setOffline alone cannot be used on WebKit).
  const origin = await startInterruptibleOrigin(baseURL ?? "http://127.0.0.1:4173");
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    const tracker = trackExternalRequests(page);
    await installDeterministicRuntime(page);
    await page.goto(origin.url);
    await expect(
      page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
    ).toBeVisible();
    await waitForServiceWorkerControl(page);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    await waitForServiceWorkerControl(page);

    // Pull the network and reload — the shell must come from cache. Offline
    // cold-start can be slow under parallel load, so allow generous headroom.
    origin.goOffline();
    // The relay really is down: a request that bypasses the worker fails.
    await expect(fetch(origin.url)).rejects.toThrow();
    // Where the engine's offline emulation reaches the worker, use it as well,
    // so navigator.onLine reads false as it would for a real user.
    if (browserName !== "webkit") await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/your data never leaves your device/i)).toBeVisible();
    // The settings UI is interactive from the precache (no network).
    await expect(page.getByTestId("settings-search-input")).toBeVisible();
    assertNoExternalRequests(tracker);
  } finally {
    await context.setOffline(false);
    await origin.close();
  }
  assertNoExternalRequests(requestTracker);
});
