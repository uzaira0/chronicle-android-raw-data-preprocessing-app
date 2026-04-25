import { readFile } from "node:fs/promises";

import { expect, type Download, type Page } from "@playwright/test";
import Papa from "papaparse";

import type { BrowserProcessingRuntime } from "../src/lib/types";
import { FIXED_DATETIME } from "./fixtures";

export type ExternalRequestTracker = {
  externalRequests: string[];
};

export async function installDeterministicRuntime(
  page: Page,
  runtime: BrowserProcessingRuntime = { datetimeOfPreprocessing: FIXED_DATETIME },
): Promise<void> {
  await page.addInitScript((value) => {
    window.__CHRONICLE_TEST_RUNTIME__ = value;
  }, runtime);
}

export function trackExternalRequests(page: Page): ExternalRequestTracker {
  const tracker: ExternalRequestTracker = { externalRequests: [] };
  page.on("request", (request) => {
    const url = request.url();
    if (!/^https?:/i.test(url)) {
      return;
    }
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      tracker.externalRequests.push(url);
    }
  });
  return tracker;
}

export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
}

export function assertNoExternalRequests(tracker: ExternalRequestTracker): void {
  expect(tracker.externalRequests).toEqual([]);
}

export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) {
      return false;
    }
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
}

export async function setInputFile(
  page: Page,
  testId: string,
  name: string,
  content: string | Uint8Array,
  mimeType: string,
): Promise<void> {
  const buffer =
    typeof content === "string" ? Buffer.from(content, "utf-8") : Buffer.from(content);
  await page.getByTestId(testId).setInputFiles({
    name,
    mimeType,
    buffer,
  });
}

export async function processFiles(page: Page): Promise<void> {
  await page.getByTestId("process-files-button").click();
  await expect(page.getByTestId("result-card").first()).toBeVisible();
}

/**
 * Expand a collapsible section card by its id attribute so that controls
 * inside (e.g. Performance, Interaction semantics) become actionable.
 * No-op when the card is already expanded.
 */
export async function expandSectionCard(page: Page, id: string): Promise<void> {
  const card = page.locator(`[data-section-id="${id}"]`);
  await card.waitFor({ state: "attached" });
  const header = card.locator(".section-card__header");
  const expanded = await header.getAttribute("aria-expanded");
  if (expanded === "false") {
    await header.click();
  }
}

export async function downloadCsv(page: Page, testId: string, index = 0): Promise<string> {
  const locator = page.getByTestId(testId).nth(index);
  const downloadPromise = page.waitForEvent("download");
  await locator.click();
  const download = await downloadPromise;
  return readDownload(download);
}

async function readDownload(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) {
    throw new Error("Playwright did not provide a download path");
  }
  return await readFile(path, "utf-8");
}

export function parseCsv(csvText: string): Array<Record<string, string>> {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "Failed to parse CSV");
  }
  return parsed.data;
}

export function csvHeaders(csvText: string): string[] {
  return csvText.split("\n", 1)[0]?.split(",") ?? [];
}
