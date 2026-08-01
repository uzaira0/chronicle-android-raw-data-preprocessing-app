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

// WebKit surfaces this as a pageerror when observed layout work spills past one
// frame; it is benign notification overflow, not an application fault.
const BENIGN_PAGE_ERRORS = [
  "ResizeObserver loop completed with undelivered notifications.",
];

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    const text = String(error);
    if (!BENIGN_PAGE_ERRORS.some((benign) => text.includes(benign))) {
      errors.push(text);
    }
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  requestTracker = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);
  assertNoExternalRequests(requestTracker);
});

test("@smoke @opfs screen-gated credit emits the side-by-side Credited App Usage CSV", async ({
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

  // Steps is the default scale: the full fine-grained DAG, every real
  // transformation as its own node (units are only the engine's caching
  // boundary — an arbitrary grouping).
  await expect(page.getByTestId("graph-scale-steps")).toHaveAttribute("aria-pressed", "true");
  await expect(nodes.filter({ hasText: "CSV parse" })).toHaveCount(1);
  expect(await nodes.count()).toBeGreaterThanOrEqual(20);

  // The Units toggle regroups the same DAG at execution-unit scale.
  await page.getByTestId("graph-scale-units").click();
  await expect(page.getByTestId("graph-scale-units")).toHaveAttribute("aria-pressed", "true");

  // Steps the current settings turn off (filtering + the Analyze tier under
  // shipped defaults) are HIDDEN — the default view is the pipeline that
  // actually runs, not the full declared DAG.
  await expect(nodes.filter({ hasText: "Usage-episode reconstruction" })).toHaveCount(1);
  await expect(nodes.filter({ hasText: "Compliance scoring" })).toHaveCount(0);

  // The toolbar toggle reveals the off steps (rendered dashed).
  await page.getByTestId("graph-show-off-toggle").click();
  expect(await nodes.count()).toBeGreaterThanOrEqual(10);
  await expect(nodes.filter({ hasText: "Compliance scoring" })).toHaveCount(1);

  // Clicking a step lights up its downstream cone and explains it in a sentence.
  await nodes.filter({ hasText: "Event dedup & ordering" }).click();
  await expect(page.getByTestId("graph-sentence")).toContainText("re-runs");

  // A second click on a step DOWNSTREAM of the first is described as a chain,
  // not as two siblings with shared ancestry.
  await nodes.filter({ hasText: "App policy" }).click();
  await expect(page.getByTestId("graph-sentence")).toContainText("one chain");

  // Vertical is the default: chained steps stack top-to-bottom.
  await expect(page.getByTestId("graph-direction-tb")).toHaveAttribute("aria-pressed", "true");
  const parseNode = page.locator(".react-flow__node", { hasText: "Event parsing" });
  const timezoneNode = page.locator(".react-flow__node", { hasText: "Timezone normalization" });
  await expect(async () => {
    const parseBox = (await parseNode.boundingBox())!;
    const timezoneBox = (await timezoneNode.boundingBox())!;
    expect(parseBox.y).toBeLessThan(timezoneBox.y);
  }).toPass();

  // The toggle re-lays the same graph horizontally: pressed state flips and
  // the chain now runs left-to-right.
  await page.getByTestId("graph-direction-lr").click();
  await expect(page.getByTestId("graph-direction-lr")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("graph-direction-tb")).toHaveAttribute("aria-pressed", "false");
  await expect(async () => {
    const parseBox = (await parseNode.boundingBox())!;
    const timezoneBox = (await timezoneNode.boundingBox())!;
    expect(parseBox.x).toBeLessThan(timezoneBox.x);
  }).toPass();
  // Edges carry arrowhead markers (explicit markers, not bare lines). A
  // straight edge's path has a zero-thickness bounding box, which Playwright
  // reports as "hidden" — assert attachment, not visibility.
  await expect(page.locator(".react-flow__edge path[marker-end]").first()).toBeAttached();

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});
