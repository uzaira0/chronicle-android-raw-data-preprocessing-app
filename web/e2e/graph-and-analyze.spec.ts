import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./durabilityContext";
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

async function firstInteractableGraphNode(
  page: Page,
  category: string,
): Promise<Locator> {
  const nodes = page.locator(`.graph-node[data-node-category="${category}"]`);
  const index = await nodes.evaluateAll((elements) => {
    const canvas = document.querySelector<HTMLElement>("[data-testid=graph-canvas]");
    if (!canvas) return -1;
    const canvasRect = canvas.getBoundingClientRect();
    return elements.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (
        x < canvasRect.left ||
        x > canvasRect.right ||
        y < canvasRect.top ||
        y > canvasRect.bottom ||
        x < 0 ||
        x > window.innerWidth ||
        y < 0 ||
        y > window.innerHeight
      ) {
        return false;
      }
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === element || element.contains(hit));
    });
  });
  expect(index, `expected an interactable ${category} graph node`).toBeGreaterThanOrEqual(0);
  return nodes.nth(index);
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

test("@smoke Pipeline Explorer separates workflow, impact, lineage, execution, and audit evidence", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await page.getByRole("tab", { name: /Graph/i }).click();
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  await expect(page.getByTestId("graph-sentence")).toContainText("Select an item");

  const nodes = page.locator(".graph-node");
  await expect(page.getByTestId("graph-mode-overview")).toHaveAttribute("aria-pressed", "true");
  await expect(nodes.first()).toBeVisible();
  expect(await nodes.count()).toBeGreaterThan(0);
  await expect(page.locator('.graph-node[data-node-category="phase"]'))
    .toHaveCount(await nodes.count());
  await nodes.first().click();
  await expect(page.getByTestId("graph-sentence")).not.toContainText("Select an item");

  // Decisions keeps physical cache readers separate from semantic and artifact impact.
  await page.getByTestId("graph-mode-decisions").click();
  await expect(page.locator('.graph-node[data-node-category="decision"]').first()).toBeVisible();
  await expect(page.locator('.graph-node[data-node-category="execution"]').first()).toBeVisible();
  await expect(page.locator('.graph-node[data-node-category="operation"]').first()).toBeVisible();
  await expect(page.locator('.graph-node[data-node-category="artifact"]').first()).toBeVisible();
  await (await firstInteractableGraphNode(page, "decision")).click();
  await expect(page.getByTestId("graph-impact-details")).toContainText("Direct physical readers");
  await expect(page.getByTestId("graph-impact-details")).toContainText("Operations that may change");
  await expect(page.getByTestId("graph-impact-details")).toContainText("Artifacts that may change");
  await expect(nodes.locator(".graph-node__availability").first()).toBeVisible();

  // Lineage does not mislabel every terminal artifact as a user deliverable.
  await page.getByTestId("graph-mode-lineage").click();
  await expect(page.locator('.graph-node[data-node-category="source"]').first()).toBeVisible();
  await expect(page.locator('.graph-node[data-node-category="artifact"]').first()).toBeVisible();
  await expect(page.getByTestId("graph-deliverables")).toContainText("Not observed");

  // Before a run, execution evidence says exactly what has not been observed.
  await page.getByTestId("graph-mode-execution").click();
  await expect(page.getByTestId("graph-node-metrics").first()).toContainText("timing unavailable");

  // Audit can find and focus registry operations, and detailed phases collapse dynamically.
  await page.getByTestId("graph-mode-audit").click();
  const firstAuditLabel = await nodes.locator(".graph-node__label").first().innerText();
  await page.getByTestId("graph-audit-search").fill(firstAuditLabel);
  await expect(page.getByTestId("graph-audit-results").getByRole("button").first()).toBeVisible();
  await page.getByTestId("graph-audit-results").getByRole("button").first().click();
  await expect(page.getByTestId("graph-sentence")).toContainText(firstAuditLabel);
  await page.getByTestId("graph-collapse-all-phases").click();
  await expect(page.getByTestId("graph-collapse-all-phases")).toHaveText("Expand all");
  await expect(page.locator('.graph-node[data-node-category="phase"]').first()).toBeVisible();

  // Orientation changes the same declared graph; neither mode invents bridge edges.
  await expect(page.getByTestId("graph-direction-tb")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("graph-direction-lr").click();
  await expect(page.getByTestId("graph-direction-lr")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("graph-direction-tb")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".react-flow__edge path[marker-end]").first()).toBeAttached();

  // A real run contributes observed timings and the exact emitted deliverable list.
  await page.getByRole("tab", { name: /^Files$/i }).click();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await processFiles(page);
  await page.getByRole("tab", { name: /Graph/i }).click();
  await page.getByTestId("graph-mode-execution").click();
  await expect(page.getByTestId("graph-node-metrics").filter({ hasText: "ms" }).first())
    .toBeVisible();
  await expect(page.getByTestId("graph-deliverables")).not.toContainText("Not observed");
  await expect(page.getByTestId("graph-deliverables").getByRole("listitem").first())
    .toBeVisible();

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});
