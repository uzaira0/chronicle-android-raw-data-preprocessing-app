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
    const registration = await navigator.serviceWorker.ready;
    if (
      navigator.serviceWorker.controller === null ||
      registration.active?.state !== "activated" ||
      registration.installing ||
      registration.waiting
    ) {
      return false;
    }
    const requiredUrls = [
      new URL("./", location.href).href,
      new URL("./index.html", location.href).href,
      ...Array.from(
        document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
          'script[src],link[rel="stylesheet"][href]',
        ),
        (element) =>
          new URL(
            element instanceof HTMLScriptElement ? element.src : element.href,
            location.href,
          ).href,
      ),
    ];
    for (const url of requiredUrls) {
      const response = await caches.match(url, { ignoreVary: true });
      if (!response?.ok || (await response.clone().arrayBuffer()).byteLength === 0) {
        return false;
      }
    }
    return true;
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

/**
 * Select multiple raw files in a single picker action. The app's file handler
 * REPLACES the queue with each picker change (it does not append), so several
 * files must be chosen in one `setInputFiles` call — looping `setInputFile`
 * would leave only the last file.
 */
export async function setRawFiles(
  page: Page,
  files: Array<{ name: string; content: string }>,
): Promise<void> {
  await page.getByTestId("raw-file-input").setInputFiles(
    files.map((file) => ({
      name: file.name,
      mimeType: "text/csv",
      buffer: Buffer.from(file.content, "utf-8"),
    })),
  );
}

export async function processFiles(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.getByTestId("result-panel").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("result-file-table").first()).toBeVisible({ timeout: 15_000 });
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

export async function downloadZipEntries(
  page: Page,
  testId: string,
  index = 0,
): Promise<Map<string, string>> {
  const locator = page.getByTestId(testId).nth(index);
  const downloadPromise = page.waitForEvent("download");
  await locator.click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) {
    throw new Error("Playwright did not provide a download path");
  }
  const bytes = await readFile(path);
  return unzipStoredEntries(bytes);
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
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
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

const CLOSURE_MAGIC = Buffer.from("CHRONICLE-CLOSURE-V1\n", "utf-8");

export type ClosureManifest = {
  protocolVersion: "chronicle-runtime-closure/v1";
  workspaceId: string;
  workspaceRootDigest: string;
  previousWorkspaceRootDigest: string | null;
  objects: Array<{ digest: string; size: number; offset: number }>;
};

/** Click the workspace export button and return the downloaded archive bytes. */
export async function downloadClosure(page: Page): Promise<Uint8Array> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-workspace-closure").first().click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Playwright did not provide the workspace backup path");
  return new Uint8Array(await readFile(path));
}

/** Parse a portable closure archive: its manifest plus its declared root object. */
export function inspectClosure(bytes: Uint8Array): {
  manifest: ClosureManifest;
  root: { workspaceId: string; previousWorkspaceRootDigest: string | null };
} {
  expect(Buffer.from(bytes.subarray(0, CLOSURE_MAGIC.byteLength))).toEqual(CLOSURE_MAGIC);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const manifestSize = view.getUint32(CLOSURE_MAGIC.byteLength, true);
  const manifestStart = CLOSURE_MAGIC.byteLength + 4;
  const payloadStart = manifestStart + manifestSize;
  const manifest = JSON.parse(
    new TextDecoder().decode(bytes.subarray(manifestStart, payloadStart)),
  ) as ClosureManifest;
  const rootEntry = manifest.objects.find(
    ({ digest }) => digest === manifest.workspaceRootDigest,
  );
  if (!rootEntry) throw new Error("portable closure omitted its declared root object");
  const root = JSON.parse(
    new TextDecoder().decode(
      bytes.subarray(
        payloadStart + rootEntry.offset,
        payloadStart + rootEntry.offset + rootEntry.size,
      ),
    ),
  ) as { workspaceId: string; previousWorkspaceRootDigest: string | null };
  return { manifest, root };
}
