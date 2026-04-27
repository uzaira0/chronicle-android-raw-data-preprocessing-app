import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";

import { chromium } from "@playwright/test";

function parseArgs(argv) {
  const args = {
    raw: [],
    filter: null,
    keepAwake: null,
    codebook: null,
    mode: "app_usage",
    timezone: "America/Chicago",
    timezoneHandling: "selected-filter",
    outputJson: false,
    datetime: "2026-04-24 00:32:53",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--raw" && next) {
      args.raw.push(next);
      index += 1;
    } else if (token === "--filter" && next) {
      args.filter = next;
      index += 1;
    } else if (token === "--keep-awake" && next) {
      args.keepAwake = next;
      index += 1;
    } else if (token === "--codebook" && next) {
      args.codebook = next;
      index += 1;
    } else if (token === "--mode" && next) {
      args.mode = next;
      index += 1;
    } else if (token === "--timezone" && next) {
      args.timezone = next;
      index += 1;
    } else if (token === "--timezone-handling" && next) {
      args.timezoneHandling = next;
      index += 1;
    } else if (token === "--datetime" && next) {
      args.datetime = next;
      index += 1;
    } else if (token === "--output-json") {
      args.outputJson = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${token ?? ""}`);
    }
  }

  if (args.raw.length === 0) {
    throw new Error("At least one --raw <path> argument is required.");
  }

  return args;
}

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for preview server at ${url}`);
}

function spawnPreview() {
  return spawn(
    process.execPath,
    ["scripts/run-clean-env.mjs", "vite", "preview", "--host", "127.0.0.1", "--port", "4173"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );
}

function countCsvRows(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  return Math.max(0, lines.length - 1);
}

async function readDownload(download) {
  const path = await download.path();
  if (!path) {
    throw new Error("Playwright did not provide a download path");
  }
  return readFile(path, "utf-8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const preview = spawnPreview();
  try {
    await waitForServer("http://127.0.0.1:4173/");

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage();
      const externalRequests = [];
      page.on("request", (request) => {
        const url = request.url();
        if (!/^https?:/i.test(url)) {
          return;
        }
        const parsed = new URL(url);
        if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
          externalRequests.push(url);
        }
      });

      await page.addInitScript((value) => {
        window.__CHRONICLE_TEST_RUNTIME__ = value;
      }, { datetimeOfPreprocessing: args.datetime });
      await page.goto("http://127.0.0.1:4173/");
      await page.waitForLoadState("networkidle");
      await page.waitForFunction(async () => {
        if (!("serviceWorker" in navigator)) {
          return false;
        }
        await navigator.serviceWorker.ready;
        return navigator.serviceWorker.controller !== null;
      });
      const heapBeforeBytes = await page.evaluate(() =>
        "memory" in performance &&
        typeof performance.memory?.usedJSHeapSize === "number"
          ? performance.memory.usedJSHeapSize
          : null,
      );

      const rawFiles = await Promise.all(
        args.raw.map(async (filePath) => ({
          name: filePath.split("/").pop() ?? "raw.csv",
          mimeType: "text/csv",
          buffer: await readFile(filePath),
        })),
      );
      await page.getByTestId("raw-file-input").setInputFiles(rawFiles);
      await page.getByTestId("usage-mode-select").selectOption(args.mode);
      await page.getByTestId("selected-timezone-input").fill(args.timezone);
      await page.getByTestId("timezone-handling-select").selectOption(args.timezoneHandling);

      if (args.filter) {
        await page.getByTestId("toggle-useFilterFile").check();
        await page.getByTestId("filter-file-input").setInputFiles(args.filter);
      }
      if (args.keepAwake) {
        await page.getByTestId("toggle-useAppsForcingScreenOpenFile").check();
        await page.getByTestId("apps-forcing-screen-open-file-input").setInputFiles(args.keepAwake);
      }
      if (args.codebook) {
        await page.getByTestId("toggle-useAppCodebook").check();
        await page.getByTestId("app-codebook-file-input").setInputFiles(args.codebook);
      }

      const started = performance.now();
      await page.getByTestId("process-files-button").click();
      await page.getByTestId("result-card").first().waitFor({ state: "visible" });
      const elapsedMs = performance.now() - started;
      const heapAfterBytes = await page.evaluate(() =>
        "memory" in performance &&
        typeof performance.memory?.usedJSHeapSize === "number"
          ? performance.memory.usedJSHeapSize
          : null,
      );

      const appDownloadPromise = page.waitForEvent("download");
      await page.getByTestId("download-app-csv").first().click();
      const appCsv = await readDownload(await appDownloadPromise);

      const screenButtons = page.getByTestId("download-screen-csv");
      const screenCount = await screenButtons.count();
      const screenRowCounts = [];
      if (screenCount > 0) {
        const screenDownloadPromise = page.waitForEvent("download");
        await screenButtons.first().click();
        const screenCsv = await readDownload(await screenDownloadPromise);
        screenRowCounts.push(countCsvRows(screenCsv));
      }

      const result = {
        elapsedMs,
        fileCount: args.raw.length,
        appRowCount: countCsvRows(appCsv),
        screenRowCounts,
        externalRequests,
        heapBeforeBytes,
        heapAfterBytes,
        serviceWorkerControlled: await page.evaluate(() => navigator.serviceWorker.controller !== null),
      };

      if (!args.outputJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        process.stdout.write(JSON.stringify(result));
      }
    } finally {
      await browser.close();
    }
  } finally {
    preview.kill("SIGTERM");
  }
}

await main();
