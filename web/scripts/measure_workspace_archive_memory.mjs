/**
 * Peak-memory measurement for verified workspace archive export and import.
 *
 * Debt item 7 of docs/semantic-federation/final-review-matrix.md is a memory
 * obligation, so it needs a memory instrument rather than a timing one. This
 * harness drives the real production build in Chromium exactly the way a user
 * does — process a raw file, click "Export ...", then feed the downloaded
 * archive back through the import picker in a second, fresh browser context —
 * and samples two things during each phase:
 *
 *  1. `performance.memory.usedJSHeapSize` in the PAGE. This is the main
 *     thread's V8 isolate: it sees the archive copies that the UI itself makes
 *     (`new Uint8Array(await file.arrayBuffer())` on import, the Comlink-
 *     transferred buffer plus `new Blob([archive.buffer])` on export).
 *
 *  2. Resident set size of the Chromium RENDERER processes. The archive is
 *     actually built and consumed inside the Rust runtime worker, whose V8
 *     isolate does NOT expose `performance.memory` (verified: `worker.evaluate`
 *     returns undefined for it). A dedicated worker shares its page's renderer
 *     process, so renderer RSS is the only process metric that can see worker
 *     allocations, blob backing stores, and transferred ArrayBuffers at once.
 *     Renderer PIDs come from CDP `SystemInfo.getProcessInfo`.
 *
 * Mechanics that make the numbers trustworthy:
 *  - `--enable-precise-memory-info` disables Chromium's 5 MiB heap bucketing.
 *  - `--js-flags=--expose-gc` lets the harness force a collection immediately
 *    before each phase baseline, so the reported delta is allocation caused by
 *    the phase rather than garbage left over from processing.
 *  - Every reported figure is a peak (max over samples), not a final reading;
 *    a final reading is always post-release and would hide the obligation.
 *  - The export context is closed before the import phase so exactly one
 *    renderer is active while import is measured.
 *  - The harness FAILS when a probe is unavailable instead of reporting nulls
 *    that read as "no growth".
 *
 * Usage (from web/, after `npm run build:app`):
 *   node scripts/measure_workspace_archive_memory.mjs --raw <raw.csv> \
 *     [--port 4291] [--label before] [--out report.json]
 */

import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("@playwright/test").Browser} Browser */
/** @typedef {import("@playwright/test").CDPSession} CDPSession */
/** @typedef {{ pageHeap: number; rendererRss: number }} Reading */

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ raw: string | null; port: number; label: string; out: string | null; archive: string | null; sampleMs: number }} */
  const args = {
    raw: null,
    port: 4291,
    label: "current",
    out: null,
    archive: null,
    sampleMs: 40,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--raw" && next) {
      args.raw = next;
      index += 1;
    } else if (token === "--port" && next) {
      args.port = Number(next);
      index += 1;
    } else if (token === "--label" && next) {
      args.label = next;
      index += 1;
    } else if (token === "--out" && next) {
      args.out = next;
      index += 1;
    } else if (token === "--archive" && next) {
      args.archive = next;
      index += 1;
    } else if (token === "--sample-ms" && next) {
      args.sampleMs = Number(next);
      index += 1;
    } else {
      throw new Error(`unknown or incomplete argument: ${token ?? ""}`);
    }
  }
  const raw = args.raw;
  if (!raw) throw new Error("--raw <path> is required");
  if (!Number.isSafeInteger(args.port) || args.port <= 0) {
    throw new Error("--port must be a positive integer");
  }
  if (!Number.isSafeInteger(args.sampleMs) || args.sampleMs <= 0) {
    throw new Error("--sample-ms must be a positive integer");
  }
  // A realistic import reads a file the user picked from disk, and Playwright
  // refuses in-memory buffers over 50 MiB anyway, so the exported archive is
  // always staged as a real file next to the raw fixture.
  return { ...args, raw, archive: args.archive ?? `${raw}.chronicle-workspace` };
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 */
async function waitForServer(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* preview server is not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for preview server at ${url}`);
}

/** @param {number} port */
function spawnPreview(port) {
  return spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
  );
}

const HEAP_PROBE = () => {
  const memory = /** @type {{ usedJSHeapSize?: number } | undefined} */ (
    /** @type {{ memory?: unknown }} */ (performance).memory
  );
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
};

const FORCE_GC = () => {
  const collect = /** @type {{ gc?: () => void }} */ (globalThis).gc;
  if (typeof collect === "function") {
    collect();
    return true;
  }
  return false;
};

/**
 * Resident set size, in bytes, of the given PIDs. `ps` reports KiB on both
 * macOS and Linux. Processes that exited between the CDP query and the sample
 * simply drop out of the output and contribute nothing.
 *
 * @param {number[]} pids
 */
async function residentSetBytes(pids) {
  if (pids.length === 0) return 0;
  const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", pids.join(",")]);
  return stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((total, kib) => total + kib * 1024, 0);
}

/** @param {CDPSession} browserSession */
async function rendererPids(browserSession) {
  const info = /** @type {{ processInfo: Array<{ type: string; id: number }> }} */ (
    await browserSession.send("SystemInfo.getProcessInfo")
  );
  return info.processInfo
    .filter((entry) => entry.type === "renderer")
    .map((entry) => entry.id);
}

/**
 * Samples one page's main-thread heap and the renderer processes' RSS while a
 * phase runs, and keeps the maximum of each.
 */
class PhaseSampler {
  /**
   * @param {Page} page
   * @param {CDPSession} browserSession
   * @param {number} intervalMs
   */
  constructor(page, browserSession, intervalMs) {
    this.page = page;
    this.browserSession = browserSession;
    this.intervalMs = intervalMs;
    this.running = false;
    /** @type {Promise<void> | null} */
    this.loop = null;
    /** @type {number[]} */
    this.pids = [];
    /** @type {Reading} */
    this.peak = { pageHeap: 0, rendererRss: 0 };
    this.samples = 0;
  }

  /** @returns {Promise<Reading>} */
  async sample() {
    const pageHeap = await this.page.evaluate(HEAP_PROBE);
    if (pageHeap === null) {
      throw new Error(
        "performance.memory is unavailable in the page; rerun Chromium with --enable-precise-memory-info",
      );
    }
    return { pageHeap, rendererRss: await residentSetBytes(this.pids) };
  }

  /** Force a collection everywhere, refresh the PID list, take the pre-phase reading. */
  async baseline() {
    if (!(await this.page.evaluate(FORCE_GC))) {
      throw new Error(
        "globalThis.gc is unavailable; rerun Chromium with --js-flags=--expose-gc",
      );
    }
    for (const worker of this.page.workers()) {
      // Workers share the renderer process and therefore the --js-flags, but a
      // worker that retires mid-call is not a measurement failure.
      await worker.evaluate(FORCE_GC).catch(() => true);
    }
    this.pids = await rendererPids(this.browserSession);
    if (this.pids.length === 0) {
      throw new Error("CDP SystemInfo.getProcessInfo reported no renderer process");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    return this.sample();
  }

  start() {
    this.running = true;
    this.peak = { pageHeap: 0, rendererRss: 0 };
    this.samples = 0;
    this.loop = (async () => {
      while (this.running) {
        try {
          const reading = await this.sample();
          this.samples += 1;
          this.peak = {
            pageHeap: Math.max(this.peak.pageHeap, reading.pageHeap),
            rendererRss: Math.max(this.peak.rendererRss, reading.rendererRss),
          };
        } catch {
          // Navigation/teardown races end the phase; the caller's stop() wins.
        }
        await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
      }
    })();
  }

  async stop() {
    this.running = false;
    if (this.loop) await this.loop;
    this.loop = null;
    return this.peak;
  }
}

/**
 * @param {PhaseSampler} sampler
 * @param {() => Promise<void>} phase
 */
async function measurePhase(sampler, phase) {
  const before = await sampler.baseline();
  sampler.start();
  const started = performance.now();
  /** @type {unknown} */
  let phaseError = null;
  try {
    await phase();
  } catch (error) {
    phaseError = error;
  }
  const elapsedMs = performance.now() - started;
  const peak = await sampler.stop();
  if (phaseError) throw phaseError;
  return {
    elapsedMs,
    samples: sampler.samples,
    baselineBytes: before,
    peakBytes: peak,
    peakDeltaBytes: {
      pageHeap: Math.max(0, peak.pageHeap - before.pageHeap),
      rendererRss: Math.max(0, peak.rendererRss - before.rendererRss),
    },
  };
}

/**
 * @param {Page} page
 * @param {string} baseUrl
 */
async function openApp(page, baseUrl) {
  await page.addInitScript(
    (value) => {
      window.__CHRONICLE_TEST_RUNTIME__ = value;
    },
    { datetimeOfPreprocessing: "2026-04-24 00:32:53" },
  );
  await page.goto(baseUrl);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawBuffer = await readFile(args.raw);
  const baseUrl = `http://127.0.0.1:${args.port}/`;
  const preview = spawnPreview(args.port);
  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch({
      headless: true,
      args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
    });
    try {
      const browserSession = await browser.newBrowserCDPSession();
      const context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage();
      await openApp(page, baseUrl);

      await page.getByTestId("raw-file-input").setInputFiles({
        name: args.raw.split("/").pop() ?? "raw.csv",
        mimeType: "text/csv",
        buffer: rawBuffer,
      });
      await page.locator("#process-tab").click();
      await page.getByTestId("process-files-button").click();
      await page
        .getByTestId("export-workspace-closure")
        .first()
        .waitFor({ state: "visible", timeout: 900_000 });

      const exportSampler = new PhaseSampler(page, browserSession, args.sampleMs);
      const exportPhase = await measurePhase(exportSampler, async () => {
        const downloadPromise = page.waitForEvent("download", { timeout: 900_000 });
        await page.getByTestId("export-workspace-closure").first().click();
        const download = await downloadPromise;
        await download.saveAs(args.archive);
        await page
          .getByTestId("workspace-backup-status")
          .waitFor({ state: "visible", timeout: 60_000 });
      });
      const archiveBytes = (await stat(args.archive)).size;

      // Close the export context so exactly one renderer is alive while the
      // import phase is sampled; a second idle renderer would add its RSS to
      // every sample and blur the delta.
      await context.close();

      // A fresh context is a fresh origin store, so import does real work
      // instead of short-circuiting on an identical local root.
      const restored = await browser.newContext({ acceptDownloads: true });
      let importPhase;
      try {
        const restoredPage = await restored.newPage();
        await openApp(restoredPage, baseUrl);
        await restoredPage.locator("#process-tab").click();
        await restoredPage
          .getByTestId("import-workspace-file")
          .waitFor({ state: "attached" });
        const importSampler = new PhaseSampler(
          restoredPage,
          browserSession,
          args.sampleMs,
        );
        importPhase = await measurePhase(importSampler, async () => {
          await restoredPage
            .getByTestId("import-workspace-file")
            .setInputFiles(args.archive);
          const status = restoredPage.getByTestId("workspace-backup-status");
          await status.waitFor({ state: "visible", timeout: 900_000 });
          const text = await status.textContent();
          if (!text?.includes("Verified workspace restored")) {
            throw new Error(`import did not succeed: ${text ?? "(no status)"}`);
          }
        });
      } finally {
        await restored.close();
      }

      const report = {
        label: args.label,
        rawFile: args.raw,
        rawBytes: rawBuffer.byteLength,
        archiveFile: args.archive,
        archiveBytes,
        sampleIntervalMs: args.sampleMs,
        export: exportPhase,
        import: importPhase,
      };
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (args.out) {
        await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
      }
    } finally {
      await browser.close();
    }
  } finally {
    preview.kill("SIGTERM");
  }
}

await main();
