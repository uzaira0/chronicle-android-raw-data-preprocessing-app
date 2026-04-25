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
  const bytes = await readFile(path);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = unzipStoredEntries(bytes);
    const firstCsv = Array.from(entries.entries()).find(([name]) =>
      name.toLowerCase().endsWith(".csv"),
    );
    if (!firstCsv) {
      throw new Error("Downloaded ZIP did not contain a CSV");
    }
    return firstCsv[1];
  }
  return bytes.toString("utf-8");
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function unzipStoredEntries(bytes: Uint8Array): Map<string, string> {
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;

  while (offset + 30 <= bytes.byteLength && readUint32(bytes, offset) === 0x04034b50) {
    const compressionMethod = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const nameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const fileName = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    if (compressionMethod !== 0) {
      throw new Error(`Unsupported ZIP compression method ${compressionMethod}`);
    }
    entries.set(fileName, decoder.decode(bytes.slice(dataStart, dataEnd)));
    offset = dataEnd;
  }

  return entries;
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
