/**
 * Per-engine peak WASM memory for one large raw file, measured against the
 * production build in a real browser.
 *
 * Mechanics, stated exactly, because "peak memory in a browser" means different
 * things per engine:
 *
 *  - `wasmMemoryBytes` is `ProcessedFileResult.workerWasmMemoryBytes`, which the
 *    processing worker records from `rustWasmMemoryBytes()` the moment the file
 *    finishes. It is `WebAssembly.Memory.buffer.byteLength`. WASM linear memory
 *    never shrinks, so this IS the high-water mark of the run, and it is exactly
 *    as accurate on WebKit and Firefox as on Chromium. It is read back out of
 *    the app's own IndexedDB last-run record, so this harness measures the
 *    shipped path rather than a private instrumentation build.
 *  - `jsHeapBytes` comes from `performance.memory.usedJSHeapSize`. Chromium
 *    only, main thread only, and it says nothing about the worker's WASM heap.
 *    It is recorded when present and reported as null everywhere else — Firefox
 *    and WebKit expose no comparable API to page script at all.
 *  - There is deliberately no process-RSS number here. Playwright's browsers run
 *    multi-process and the pipeline's memory lives in a worker process whose PID
 *    this harness has no reliable, cross-engine way to attribute.
 *
 * No threshold is enforced. This records evidence.
 *
 * Usage (production build must already be served):
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:4287 \
 *     node scripts/measure_browser_peak_memory.mjs <fixture.csv> [engines]
 */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { chromium, firefox, webkit } from "@playwright/test";

const LAUNCHERS = { chromium, firefox, webkit };
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4287";
const PROFILE_ROOT = path.resolve(process.cwd(), ".tmp/memory-profiles");
/** How long one engine may take on one file before the run is recorded as unfinished. */
const RUN_TIMEOUT_MS = Number(process.env.MEASURE_RUN_TIMEOUT_MS ?? 15 * 60_000);

/**
 * Every engine runs against an on-disk profile. WebKit refuses OPFS outright in
 * an ephemeral automation context, so an ephemeral run would measure a
 * different (persistence-free) code path on that engine only.
 *
 * @param {"chromium" | "firefox" | "webkit"} engineName
 * @param {string} fixturePath
 * @param {number} fixtureBytes
 */
async function measure(engineName, fixturePath, fixtureBytes) {
  const launcher = LAUNCHERS[engineName];
  if (!launcher) throw new Error(`unknown engine: ${engineName}`);
  await mkdir(PROFILE_ROOT, { recursive: true });
  const profile = await mkdtemp(path.join(PROFILE_ROOT, `${engineName}-`));
  const context = await launcher.launchPersistentContext(profile, {});
  /** @type {string[]} */
  const consoleErrors = [];
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    // Reach the origin without booting the app, then clear it, so the run below
    // is a cold first execution rather than a resume from a previous profile.
    await page.goto(`${BASE_URL}/robots.txt`);
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory().catch(() => null);
      if (root) {
        /** @type {string[]} */
        const names = [];
        const iterable = /** @type {{ keys(): AsyncIterableIterator<string> }} */ (
          /** @type {unknown} */ (root)
        );
        for await (const key of iterable.keys()) names.push(key);
        for (const key of names) {
          await root.removeEntry(key, { recursive: true }).catch(() => {});
        }
      }
      for (const name of ["chronicle-last-run", "chronicle-projects"]) {
        await new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = resolve;
          request.onerror = resolve;
          request.onblocked = resolve;
        });
      }
    });

    await page.goto(BASE_URL);
    await page
      .getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })
      .waitFor();

    await page.getByTestId("raw-file-input").setInputFiles(fixturePath);
    await page.getByRole("tab", { name: /Process/i }).click();
    const started = Date.now();
    await page.getByTestId("process-files-button").click();
    // Race the success surface against the app's own failure surfaces. A bare
    // waitFor would report "timeout" for an engine that actually refused the
    // file and said why (measured: Firefox 148 sat idle at 0.8% CPU for the
    // whole wait on a 115 MB fixture), and a recorded limit is only useful with
    // the engine's reason attached.
    const outcome = await Promise.race([
      page
        .getByTestId("result-panel")
        .first()
        .waitFor({ timeout: RUN_TIMEOUT_MS })
        .then(() => "complete"),
      page
        .locator(".error-text")
        .first()
        .waitFor({ timeout: RUN_TIMEOUT_MS })
        .then(() => "app-error"),
      page
        .getByTestId("workspace-unavailable")
        .first()
        .waitFor({ timeout: RUN_TIMEOUT_MS })
        .then(() => "storage-refused"),
    ]).catch(() => "no-outcome");
    if (outcome !== "complete") {
      const reasonLocator =
        outcome === "storage-refused"
          ? page.getByTestId("workspace-unavailable")
          : page.locator(".error-text");
      const reason =
        (await reasonLocator
          .first()
          .textContent()
          .catch(() => null)) ??
        `the run produced no result panel within ${Math.round(RUN_TIMEOUT_MS / 1000)}s and raised no visible error`;
      return {
        engine: engineName,
        userAgent: await page.evaluate(() => navigator.userAgent),
        fixtureBytes,
        elapsedMs: Date.now() - started,
        outcome,
        reason: reason.trim().slice(0, 400),
        wasmMemoryBytes: null,
        rowsIn: null,
        rowsOut: null,
        jsHeapBytes: null,
        hardwareConcurrency: await page.evaluate(
          () => navigator.hardwareConcurrency ?? null,
        ),
        consoleErrors: consoleErrors.slice(0, 5),
      };
    }
    await page
      .getByTestId("result-file-table")
      .first()
      .waitFor({ timeout: 60_000 });
    const elapsedMs = Date.now() - started;

    const measurement = await page.evaluate(async () => {
      /** @type {any} */
      const record = await new Promise((resolve, reject) => {
        const open = indexedDB.open("chronicle-last-run", 1);
        open.onerror = () => reject(new Error("cannot open chronicle-last-run"));
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("lastRun", "readonly")
            .objectStore("lastRun")
            .get("last");
          request.onsuccess = () => {
            db.close();
            resolve(request.result ?? null);
          };
          request.onerror = () => {
            db.close();
            reject(new Error("cannot read the last-run record"));
          };
        };
      });
      const result = record?.results?.[0];
      // `performance.memory` is a non-standard Chromium extension; it is absent
      // on Firefox and WebKit, which is itself part of the recorded evidence.
      const memory = /** @type {{ usedJSHeapSize?: number } | undefined} */ (
        /** @type {any} */ (performance).memory
      );
      return {
        wasmMemoryBytes: result?.workerWasmMemoryBytes ?? null,
        rowsIn: result?.originalRowCount ?? null,
        rowsOut: result?.processedRowCount ?? null,
        jsHeapBytes: typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      };
    });

    return {
      engine: engineName,
      userAgent: await page.evaluate(() => navigator.userAgent),
      fixtureBytes,
      elapsedMs,
      outcome: "complete",
      reason: null,
      ...measurement,
      consoleErrors: consoleErrors.slice(0, 5),
    };
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}

const [fixtureArgument, engineArgument] = process.argv.slice(2);
if (!fixtureArgument) {
  process.stderr.write(
    "usage: measure_browser_peak_memory.mjs <fixture.csv> [chromium,firefox,webkit]\n",
  );
  process.exit(2);
}
const fixturePath = path.resolve(fixtureArgument);
// One read, and the size is taken from the bytes actually read. Calling stat()
// for the size and then readFile() separately is a check-then-use pair: the
// fixture can change between the two, so the reported fixtureBytes need not
// describe the bytes the measurement ran on. It also still fails before a
// browser launches when the fixture is missing or unreadable.
const fixtureBytes = (await readFile(fixturePath, { encoding: null, flag: "r" }))
  .byteLength;

const engines = /** @type {Array<"chromium" | "firefox" | "webkit">} */ (
  (engineArgument ?? "chromium,firefox,webkit").split(",")
);
/** @type {Array<Record<string, unknown>>} */
const measurements = [];
for (const engineName of engines) {
  try {
    measurements.push(await measure(engineName, fixturePath, fixtureBytes));
  } catch (error) {
    measurements.push({ engine: engineName, fixtureBytes, error: String(error) });
  }
}
process.stdout.write(
  `${JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      fixture: path.basename(fixturePath),
      fixtureBytes,
      mechanics: {
        wasmMemoryBytes:
          "ProcessedFileResult.workerWasmMemoryBytes, recorded by the processing worker from rustWasmMemoryBytes() (WebAssembly.Memory.buffer.byteLength) when the file finished, then read back from the app's chronicle-last-run IndexedDB record. WASM linear memory never shrinks, so this is the run's high-water mark, and it is equally exact on all three engines.",
        jsHeapBytes:
          "performance.memory.usedJSHeapSize. Chromium-only, main thread only, says nothing about the worker's WASM heap. null on Firefox and WebKit, which expose no equivalent to page script.",
        processRss:
          "Not recorded. Playwright's browsers are multi-process and the pipeline runs in a worker process this harness cannot attribute across engines.",
        profile:
          "Every engine runs against an on-disk profile via launchPersistentContext; WebKit refuses OPFS in an ephemeral automation context and would otherwise measure a persistence-free path.",
        thresholds: "None. This file records evidence and enforces nothing.",
      },
      measurements,
    },
    null,
    2,
  )}\n`,
);
