import { readFile } from "node:fs/promises";

import { expect, test, type Download, type Page } from "@playwright/test";
import Papa from "papaparse";

import type { BrowserProcessingRuntime } from "../src/lib/types";
import {
  WORKFLOW_CLOSURE_MAGIC_TEXT,
  type RuntimeClosureManifest,
} from "../src/lib/workflowClosureProtocol";
import { cacheStorageRetainsWrites } from "./durabilityContext";
import { FIXED_DATETIME } from "./fixtures";

export type ExternalRequestTracker = {
  externalRequests: string[];
};

const testHooksByBaseUrl = new Map<string, Promise<boolean>>();

/**
 * Whether the served build honours `window.__CHRONICLE_TEST_RUNTIME__`. Only a
 * test build does (`npm run build:test`, which marks index.html); the deployed
 * bundle compiles the hook out, and the canary runs the @smoke tests against
 * that deployed site, as does `make check` against its deploy build.
 */
export function buildHonoursTestRuntime(page: Page): Promise<boolean> {
  const baseUrl = String(test.info().project.use.baseURL ?? "");
  let known = testHooksByBaseUrl.get(baseUrl);
  if (!known) {
    known = page.request
      .get("./")
      .then(async (response) => (await response.text()).includes('name="chronicle-test-hooks"'));
    testHooksByBaseUrl.set(baseUrl, known);
  }
  return known;
}

export async function installDeterministicRuntime(
  page: Page,
  runtime: BrowserProcessingRuntime = {
    datetimeOfPreprocessing: FIXED_DATETIME,
    // The app runs only the sequential engine (Salsa switched off 2026-09-29),
    // so e2e drives what a researcher runs. A test about Salsa asks for it.
    incrementalEngine: false,
    provenanceEvidence: true,
  },
): Promise<void> {
  if (await buildHonoursTestRuntime(page)) {
    await page.addInitScript((value) => {
      window.__CHRONICLE_TEST_RUNTIME__ = value;
    }, runtime);
    return;
  }
  // A deployed build ignores the injected runtime. It always runs the
  // sequential engine and stamps the real clock (see
  // expectDatetimeOfPreprocessing); provenance evidence is the one runtime
  // field a researcher sets, through the Performance card toggle it persists.
  await page.addInitScript((provenanceEvidence) => {
    try {
      localStorage.setItem("chronicle-web.provenanceEvidence", String(provenanceEvidence));
    } catch {
      // A storage-denied context keeps the card's default, as a user's would.
    }
  }, runtime.provenanceEvidence === true);
}

/** The one output column a run fills from its own clock. */
export const RUN_STAMP_COLUMN = "datetime_of_preprocessing";
const DEPLOYED_RUN_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/;

/**
 * Two runs' CSV exports carry the same data. In a test build both stamps are
 * the pinned FIXED_DATETIME, so the text must match byte for byte. A deployed
 * build stamps each Process click with its own clock: there every other cell
 * must match exactly and each run must carry a well-formed stamp of its own.
 */
export async function expectSameRunOutput(
  page: Page,
  actual: string,
  expected: string,
): Promise<void> {
  if (await buildHonoursTestRuntime(page)) {
    expect(actual).toBe(expected);
    return;
  }
  const withoutStamp = (csv: string): Array<Record<string, string>> =>
    parseCsv(csv).map((row) => {
      expect(row[RUN_STAMP_COLUMN] ?? "").toMatch(DEPLOYED_RUN_STAMP);
      const rest = { ...row };
      delete rest[RUN_STAMP_COLUMN];
      return rest;
    });
  expect(csvHeaders(actual)).toEqual(csvHeaders(expected));
  expect(withoutStamp(actual)).toEqual(withoutStamp(expected));
}

/**
 * A test build stamps the pinned FIXED_DATETIME. A deployed build stamps the
 * Process click's own UTC clock, so it must fall inside the test's run window.
 */
export async function expectDatetimeOfPreprocessing(
  page: Page,
  value: string | undefined,
  runStartedAtMs: number,
): Promise<void> {
  if (await buildHonoursTestRuntime(page)) {
    expect(value).toBe(FIXED_DATETIME);
    return;
  }
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/.exec(value ?? "");
  expect(match, `datetime_of_preprocessing ${value}`).not.toBeNull();
  const stampedMs = Date.parse(`${match![1]}T${match![2]}Z`);
  // The stamp has whole-second precision, so allow the second it truncated.
  expect(stampedMs).toBeGreaterThanOrEqual(Math.floor(runStartedAtMs / 1000) * 1000);
  expect(stampedMs).toBeLessThanOrEqual(Date.now());
}

export function trackExternalRequests(page: Page): ExternalRequestTracker {
  const tracker: ExternalRequestTracker = { externalRequests: [] };
  let applicationOrigin: string | undefined;
  page.on("request", (request) => {
    const url = request.url();
    if (!/^https?:/i.test(url)) {
      return;
    }
    const parsed = new URL(url);
    if (
      applicationOrigin === undefined &&
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame()
    ) {
      applicationOrigin = parsed.origin;
      return;
    }
    if (parsed.origin !== applicationOrigin) {
      tracker.externalRequests.push(url);
    }
  });
  return tracker;
}

export async function gotoApp(page: Page): Promise<void> {
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await expectLazySettingsCardsLoaded(page);
}

/**
 * The research-method-profile and sleep-diary cards load after first paint.
 * Until they do, App renders a "Loading…" placeholder that carries the same
 * `data-settings-anchor` as the card, so a negative assertion such as
 * `expect(card).not.toContainText("Task occurrences")` passes against the
 * placeholder without ever seeing the restored card. Wait until each anchor
 * exists and is no longer the busy placeholder (an absent anchor fails the
 * wait rather than passing it).
 */
async function expectLazySettingsCardsLoaded(page: Page): Promise<void> {
  for (const anchor of ["research-method-profile", "sleep-diary-replication"]) {
    await expect(page.locator(`[data-settings-anchor="${anchor}"]`)).not.toHaveAttribute("aria-busy", "true");
  }
}

/** Reload and wait for the lazily loaded settings cards, as gotoApp does. */
export async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await expectLazySettingsCardsLoaded(page);
}

export function assertNoExternalRequests(tracker: ExternalRequestTracker): void {
  expect(tracker.externalRequests).toEqual([]);
}

/**
 * Switch the colour theme and wait for the swap to actually finish.
 *
 * Several components animate `background`/`border-color` over 140–200 ms, so a
 * colour measurement (axe contrast, a screenshot) taken right after the click
 * reads a half-faded blend that no user ever sees — e.g. #787d8b on #8e9198.
 * Wait on the real running animations rather than a fixed sleep, skipping
 * infinite ones (the Graph node pulse never "finishes") and capping the wait so
 * a stuck animation can never hang a test.
 */
export async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.getByTestId(`theme-${theme}`).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(async () => {
    const settling = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().iterations !== Infinity,
      )
      .map((animation) => animation.finished.catch(() => undefined));
    await Promise.race([
      Promise.all(settling),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
  });
}

export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  // Scoped to WebKit: a Chromium or Firefox context whose Cache Storage drops
  // writes is a real failure and must stay red, not skip.
  // Only reach test.skip when actually skipping: the unit suite drives this
  // helper with a stub page outside Playwright's runner, where it throws.
  if (
    page.context().browser()?.browserType().name() === "webkit" &&
    !(await cacheStorageRetainsWrites(page))
  ) test.skip(
    true,
    "Playwright's persistent WebKit context drops every Cache Storage write " +
      "(cache.put resolves, cache.match returns undefined, cache.keys() is empty), " +
      "so public/sw.js fails its verified precache and never controls the page; " +
      "the same sw.js installs and claims the page in ephemeral WebKit",
  );
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
    // A controlled shell alone cannot certify a first offline processing run:
    // the normal build's supplementary list also owns worker, WASM and packs.
    let extra: unknown;
    try {
      const response = await fetch(new URL("./sw-precache-extra.json", location.href), { cache: "no-store" });
      if (!response.ok) return false;
      extra = await response.json();
    } catch {
      return false;
    }
    if (!Array.isArray(extra) || extra.length === 0 ||
        extra.some((path) => typeof path !== "string" || path.length === 0)) {
      return false;
    }
    const extraUrls = extra.map((path: string) => new URL(path, location.href));
    if (extraUrls.some((url) => url.origin !== location.origin)) return false;
    const requiredUrls = [
      new URL("./", location.href).href,
      new URL("./index.html", location.href).href,
      ...extraUrls.map((url) => url.href),
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

// One shared stall guard for "the result panel appeared after processing".
// Used by processFiles and by the specs that inline the same wait, so the
// tolerance for a loaded host is raised in exactly one place.
export const RESULT_PANEL_TIMEOUT_MS = 60_000;

export async function processFiles(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  // Per-step stall guard, deliberately below the config-level test budget so a
  // slow processing round fails HERE, naming the locator, instead of dying as a
  // bare per-test timeout. Historical note (2026-08-27 endgame, runs 5-6): the
  // two 3-round @opfs firefox tests red on "Test timeout of 30000ms exceeded"
  // -- the per-TEST budget, not this expect, was the binding ceiling; raising
  // this timeout alone measurably fixed nothing, which is why the budget now
  // lives in playwright.config.ts.
  await expect(page.getByTestId("result-panel").first()).toBeVisible({
    timeout: RESULT_PANEL_TIMEOUT_MS,
  });
  await expect(page.getByTestId("result-file-table").first()).toBeVisible({
    timeout: RESULT_PANEL_TIMEOUT_MS,
  });
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

const CLOSURE_MAGIC = Buffer.from(WORKFLOW_CLOSURE_MAGIC_TEXT, "utf-8");

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
  manifest: RuntimeClosureManifest;
  root: { workspaceId: string; previousWorkspaceRootDigest: string | null };
} {
  expect(Buffer.from(bytes.subarray(0, CLOSURE_MAGIC.byteLength))).toEqual(CLOSURE_MAGIC);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const manifestSize = view.getUint32(CLOSURE_MAGIC.byteLength, true);
  const manifestStart = CLOSURE_MAGIC.byteLength + 4;
  const payloadStart = manifestStart + manifestSize;
  const manifest = JSON.parse(
    new TextDecoder().decode(bytes.subarray(manifestStart, payloadStart)),
  ) as RuntimeClosureManifest;
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
