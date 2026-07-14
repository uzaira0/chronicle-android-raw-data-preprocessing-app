import { expect, test, type Page } from "@playwright/test";

import { APP_AND_SCREEN_RAW_CSV } from "./fixtures";
import {
  assertNoExternalRequests,
  downloadZipEntries,
  expandSectionCard,
  gotoApp,
  installDeterministicRuntime,
  processFiles,
  setInputFile,
  trackExternalRequests,
} from "./helpers";

let requestTracker: ReturnType<typeof trackExternalRequests>;

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

test.beforeEach(async ({ page }) => {
  requestTracker = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);
  assertNoExternalRequests(requestTracker);
});

test("@smoke screen-gated credit emits the side-by-side Credited App Usage CSV", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");

  await expandSectionCard(page, "study-analysis");
  await page.getByTestId("toggle-enableScreenGatedCrediting").check();

  await processFiles(page);
  const zipEntries = await downloadZipEntries(page, "download-all-zip");
  const names = Array.from(zipEntries.keys());
  // Side-by-side: the credited CSV appears AND the headline output is still there.
  expect(names.some((name) => name.includes("Credited App Usage"))).toBe(true);
  expect(names.some((name) => name.endsWith("Automatically Preprocessed.csv"))).toBe(true);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

test("@smoke Graph tab renders the pipeline and answers a click in plain English", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await page.getByRole("tab", { name: /Graph/i }).click();
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  // Interaction hint is visible before any selection.
  await expect(page.getByTestId("graph-sentence")).toContainText("Click a step");

  const nodes = page.locator(".graph-node");
  expect(await nodes.count()).toBeGreaterThanOrEqual(10);
  await expect(nodes.filter({ hasText: "Usage-episode reconstruction" })).toHaveCount(1);
  await expect(nodes.filter({ hasText: "Compliance scoring" })).toHaveCount(1);

  // Clicking a step lights up its downstream cone and explains it in a sentence.
  await nodes.filter({ hasText: "Event dedup & ordering" }).click();
  await expect(page.getByTestId("graph-sentence")).toContainText("re-runs");

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});
