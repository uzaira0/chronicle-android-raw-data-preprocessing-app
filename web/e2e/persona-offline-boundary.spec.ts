import { expect, test } from "@playwright/test";

import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  assertNoExternalRequests,
  downloadCsv,
  gotoApp,
  installDeterministicRuntime,
  parseCsv,
  processFiles,
  setInputFile,
  trackExternalRequests,
  waitForServiceWorkerControl,
} from "./helpers";

/**
 * Persona 12 — Offline boundary tester.
 *
 * For a local-only app, offline is the *first-class* state, not a degraded one.
 * There is no server, no connectivity polling, and no online/offline indicator
 * to lie — so the contract is: everything works offline exactly as online, the
 * shell cold-starts offline, and nothing ever reaches across origin.
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

test("a first processing run completes offline after the network drops mid-way", async ({
  page,
  context,
}) => {
  // The matcher worker + WASM are precached by the service worker, so even a
  // cold first run (never processed online) works offline.
  await waitForServiceWorkerControl(page);
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Files/i }).click();
  await expect(page.getByTestId("raw-file-row")).toHaveCount(1);

  await context.setOffline(true);
  await processFiles(page);
  const rows = parseCsv(await downloadCsv(page, "download-app-csv"));
  expect(rows.length).toBeGreaterThan(0);

  await context.setOffline(false);
  assertNoExternalRequests(requestTracker);
});

test("the app cold-starts offline and shows consistent (non-misleading) messaging", async ({
  page,
  context,
}) => {
  await waitForServiceWorkerControl(page);
  const onlineLede = await page.getByText(/your data never leaves your device/i).innerText();

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible({ timeout: 20_000 });
  // The same privacy lede appears offline — the app makes no connectivity claim
  // that could be wrong, because there is nothing online to depend on.
  const offlineLede = await page.getByText(/your data never leaves your device/i).innerText();
  expect(offlineLede).toBe(onlineLede);

  await context.setOffline(false);
  assertNoExternalRequests(requestTracker);
});

test("no request ever crosses origin across a full process + review run", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  // A complete run end-to-end. (Runs online — the offline-processing path is
  // covered/flagged separately above; the privacy guarantee must hold here too.)
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  await page.getByRole("tab", { name: /View/i }).click();
  await expect(page.getByTestId("timeline-view")).toBeVisible();

  const origin = new URL(page.url()).origin;
  const crossOrigin = requests.filter(
    (url) => /^https?:/i.test(url) && !url.startsWith(origin),
  );
  expect(crossOrigin).toEqual([]);
  assertNoExternalRequests(requestTracker);
});
