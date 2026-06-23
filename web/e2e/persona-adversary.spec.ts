import { expect, test } from "@playwright/test";

import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  assertNoExternalRequests,
  gotoApp,
  installDeterministicRuntime,
  setInputFile,
  trackExternalRequests,
} from "./helpers";

/**
 * Persona 3 — Adversary.
 *
 * NOTE ON SCOPE: this app is a *local-only, no-backend* PWA. The whole pipeline
 * runs in-browser via WASM and the privacy contract is "your data never leaves
 * your device" — there is no API to send garbage to, no auth to bypass, no
 * cross-tenant resource to reach. So the API half of this persona (and the
 * entire backend-resilience persona) does not apply; instead we (a) stress the
 * UI like a hostile user and (b) keep a standing guard that proves no mutating
 * or cross-origin network surface exists for an attacker to target.
 */
test.describe.configure({ mode: "serial" });

let requestTracker: ReturnType<typeof trackExternalRequests>;
let pageErrors: string[];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("response", (response) => {
    if (Math.floor(response.status() / 100) === 5) {
      pageErrors.push(`5xx ${response.status()} ${response.url()}`);
    }
  });
  requestTracker = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);
  assertNoExternalRequests(requestTracker);
});

test.afterEach(() => {
  expect(pageErrors, "no uncaught errors or 5xx responses").toEqual([]);
});

test("the app exposes no mutating or cross-origin network surface", async ({ page }) => {
  // Record every request made during a full process run.
  const requests: { url: string; method: string }[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));

  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.getByTestId("result-panel").first()).toBeVisible({ timeout: 15_000 });

  const origin = new URL(page.url()).origin;
  const offending = requests.filter(
    (request) => request.method !== "GET" || !request.url.startsWith(origin),
  );
  // Every request is a same-origin GET for a static asset. No POST/PUT/DELETE,
  // nothing cross-origin — there is simply no backend to attack.
  expect(offending).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

test("rapid-firing the workflow tabs 24 times does not break the app", async ({ page }) => {
  const tabs = ["Files", "Process", "View", "Settings"] as const;
  for (let i = 0; i < 24; i += 1) {
    const name = tabs[i % tabs.length]!;
    await page.getByRole("tab", { name: new RegExp(`^${name}$`, "i") }).click();
  }
  // Still alive and interactive.
  await expect(page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })).toBeVisible();
  await page.getByRole("tab", { name: /Settings/i }).click();
  await expect(page.getByTestId("settings-search-input")).toBeVisible();
  assertNoExternalRequests(requestTracker);
});

test("double-submitting the process form does not create duplicate results", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  const button = page.getByTestId("process-files-button");
  // Two fast clicks; the button disables on the first, so the second is a no-op.
  await button.click();
  await button.click({ force: true }).catch(() => {});
  await expect(page.getByTestId("result-panel").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("result-panel")).toHaveCount(1);
  await expect(page.getByTestId("result-row")).toHaveCount(1);
  assertNoExternalRequests(requestTracker);
});

test("pathologically long input strings do not overflow or crash the page", async ({ page }) => {
  const huge = "A".repeat(20000);
  await page.getByTestId("study-name-input").fill(huge);
  await page.getByTestId("selected-timezone-input").fill(huge);
  await expect(page.getByTestId("study-name-input")).toHaveValue(huge);

  // No horizontal page scrollbar leaked from the giant values.
  const overflow = await page.evaluate(() => ({
    docWidth: document.documentElement.scrollWidth,
    viewWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.docWidth).toBeLessThanOrEqual(overflow.viewWidth + 1);
  assertNoExternalRequests(requestTracker);
});

test("a tiny hostile viewport keeps the workflow usable with no JS errors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  for (const name of ["Settings", "Files", "Process", "View"]) {
    await page.getByRole("tab", { name: new RegExp(`^${name}$`, "i") }).click();
    const overflow = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      viewWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.docWidth).toBeLessThanOrEqual(overflow.viewWidth + 1);
  }
  assertNoExternalRequests(requestTracker);
});

test("unsupported binary content in the raw input is rejected, not crashed on", async ({ page }) => {
  // A PNG-ish blob dropped where a CSV belongs.
  const bogus = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 255]);
  await setInputFile(page, "raw-file-input", "evil.png", bogus, "image/png");
  await page.getByRole("tab", { name: /Files/i }).click();
  const filesPanel = page.getByRole("tabpanel", { name: /Files/i });
  await expect(filesPanel.getByText(/Warning: Review/i)).toBeVisible();
  assertNoExternalRequests(requestTracker);
});
