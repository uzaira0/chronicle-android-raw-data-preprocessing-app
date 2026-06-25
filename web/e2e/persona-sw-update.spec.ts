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

/**
 * Persona 9 — Service worker update tester.
 *
 * The app's SW precaches the shell (skipWaiting + clients.claim) so it works
 * offline. The update flow must keep the page usable, never destroy in-memory
 * work, prune stale caches, and keep serving offline after an update. (Only the
 * chromium project is configured; iOS/webkit SW quirks are a known coverage gap
 * reported separately.)
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
    return { shellKeys, entryCount: requests.length };
  });
  // Exactly one shell cache version is live (older versions were pruned on activate).
  expect(cacheState.shellKeys).toHaveLength(1);
  expect(cacheState.shellKeys[0]).toBe("chronicle-local-shell-v3");
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
  page,
  context,
}) => {
  await waitForServiceWorkerControl(page);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });

  // Pull the network and reload — the shell must come from cache. Offline
  // cold-start can be slow under parallel load, so allow generous headroom.
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/your data never leaves your device/i)).toBeVisible();
  // The settings UI is interactive from the precache (no network).
  await expect(page.getByTestId("settings-search-input")).toBeVisible();

  await context.setOffline(false);
  assertNoExternalRequests(requestTracker);
});
