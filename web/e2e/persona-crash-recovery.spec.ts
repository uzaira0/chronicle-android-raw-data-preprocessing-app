import type { Page } from "@playwright/test";

import { expect, test } from "./durabilityContext";
import { APP_ONLY_RAW_CSV, MALFORMED_RAW_CSV } from "./fixtures";
import {
  downloadZipEntries,
  expandSectionCard,
  gotoApp,
  installDeterministicRuntime,
  processFiles,
  setInputFile,
  setRawFiles,
} from "./helpers";

/**
 * Persona 6 — Crash-recovery auditor.
 *
 * A browser that dies at the worst moment: tab killed after a run, a corrupt or
 * oversized cached run on the next boot, a failed run that must not leave a
 * stale record. The contract: either work survives atomically, or it leaves no
 * trace that wedges the next boot. (This is the exact failure the colleague hit
 * — a heavy cached run that the next boot could not reopen.)
 */
test.describe.configure({ mode: "serial" });

/** Read the persisted last-run record straight from IndexedDB (verification only). */
async function readLastRun(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("chronicle-last-run", 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("lastRun")) {
            open.result.createObjectStore("lastRun", { keyPath: "id" });
          }
        };
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          try {
            const tx = db.transaction("lastRun", "readonly");
            const get = tx.objectStore("lastRun").get("last");
            get.onsuccess = () => resolve(get.result ?? null);
            get.onerror = () => resolve(null);
          } catch {
            resolve(null);
          }
        };
      }),
  );
}

/** Seed a record that passes load validation but is structurally broken to render. */
async function seedCorruptLastRun(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open("chronicle-last-run", 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("lastRun")) {
            open.result.createObjectStore("lastRun", { keyPath: "id" });
          }
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("lastRun", "readwrite");
          tx.objectStore("lastRun").put({
            id: "last",
            schemaVersion: 1,
            savedAt: "2026-01-01T00:00:00.000Z",
            options: {},
            // Passes the `results.length` check, but the entries are missing the
            // numeric fields the result table renders → forces a render throw,
            // i.e. exactly the "corrupt/oversized cached run" the boundary exists for.
            results: [{ inputFileName: "Corrupt.csv", restoredWithoutArtifacts: true }],
            discoveredTimezones: ["America/Chicago"],
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        };
        open.onerror = () => resolve();
      }),
  );
}

async function pollUntil(fn: () => Promise<boolean>, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

test("@durability a corrupt cached run never permanently wedges the boot; recovery is reachable", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await installDeterministicRuntime(page);
  await gotoApp(page); // clean boot establishes the origin + DB
  await seedCorruptLastRun(page);

  await page.reload();

  const heading = page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" });
  const bootError = page.getByTestId("boot-error");

  // Whatever path the app takes, it must NOT be a permanent blank page.
  await pollUntil(async () =>
    (await heading.isVisible().catch(() => false)) || (await bootError.isVisible().catch(() => false)),
  );

  if (await bootError.isVisible().catch(() => false)) {
    // Lifeboat path: the user recovers without DevTools.
    await expect(page.getByTestId("boot-error-reset")).toBeVisible();
    await page.getByTestId("boot-error-reset").click();
    await expect(heading).toBeVisible({ timeout: 15_000 });
  } else {
    // Self-heal path: it booted normally instead of crashing.
    await expect(heading).toBeVisible();
  }

  // Either way the poison record is gone and a further reload is clean.
  await page.reload();
  await expect(heading).toBeVisible({ timeout: 15_000 });
  await expect(bootError).toBeHidden();
  expect(await readLastRun(page)).toBeNull();
});

test("@durability work survives a tab kill as a restorable summary", async ({ context }) => {
  // Two tabs in ONE browser context share this origin's IndexedDB (separate
  // Playwright contexts are storage-isolated, like separate profiles). The
  // browser process survives; one tab dies and the user reopens it.
  const tab1 = await context.newPage();
  await installDeterministicRuntime(tab1);
  await gotoApp(tab1);
  await setInputFile(tab1, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(tab1);
  // Wait for the run to be persisted before the "kill".
  const saved = await pollUntil(async () => (await readLastRun(tab1)) !== null);
  expect(saved).toBe(true);

  // Hard kill the tab (no graceful unload).
  await tab1.close({ runBeforeUnload: false });

  // Reopen a fresh tab in the same context — the cached summary restores.
  const tab2 = await context.newPage();
  await installDeterministicRuntime(tab2);
  await gotoApp(tab2);
  await expect(tab2.getByTestId("result-panel")).toBeVisible({ timeout: 15_000 });
  await expect(tab2.getByTestId("result-panel")).toContainText("1 file processed");
  await expect(tab2.getByTestId("restored-lightweight-note")).toBeVisible();
  // Plot blobs and timeline geometry are still dropped from the cached record,
  // but `toLightweightResults` keeps the OPFS-backed outputs and the root-pinned
  // rebuild requests, so the download must stay available AND actually deliver
  // the outputs again from the verified workspace without re-processing. (This
  // assertion previously demanded a DISABLED button, which had been wrong since
  // OPFS-backed outputs began surviving the record — nothing caught it because
  // the persona suites are not part of the @smoke gate.)
  await expect(tab2.getByTestId("download-all-zip")).toBeEnabled();
  const restoredEntries = await downloadZipEntries(tab2, "download-all-zip");
  expect(
    Array.from(restoredEntries.keys()).some((name) => name.toLowerCase().endsWith(".csv")),
    "the crash-restored workspace still yields its CSV outputs",
  ).toBe(true);
  await tab2.close();
});

test("@durability cancelling a run stops it cleanly and leaves no half-finished state (#11)", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await installDeterministicRuntime(page);
  await gotoApp(page);

  // Process sequentially so the batch spans a window wide enough to cancel
  // mid-run (this is also the exact path a prior bug mishandled — a sequential
  // cancel must not commit the in-flight file as a success).
  await expandSectionCard(page, "performance");
  await page.getByTestId("toggle-parallelProcessing").uncheck();

  // 20 files in one pick so they queue together; sequential processing makes the
  // mid-run window wide enough to cancel deterministically.
  await setRawFiles(
    page,
    Array.from({ length: 20 }, (_, i) => ({ name: `Raw P${i}.csv`, content: APP_ONLY_RAW_CSV })),
  );

  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  // Cancel the instant the control is available.
  await page.getByTestId("cancel-process-button").click();

  // The run ends: the Process button is usable again (not wedged "running").
  await expect(page.getByTestId("process-files-button")).toBeEnabled({ timeout: 15_000 });
  // The cancel path reports honestly: a "Cancelled. Processed N/20" toast (the
  // word "Cancelled" only appears when the run was actually interrupted), and at
  // least one file was left explicitly cancelled rather than silently dropped or
  // falsely marked complete.
  await expect(page.getByText(/Cancelled\. Processed \d+\/20 files/)).toBeVisible();
  await expect(page.locator(".progress-row.is-cancelled")).not.toHaveCount(0);
  expect(errors, "cancel path raised no uncaught error").toEqual([]);
});

test("@durability a fully failed run leaves no stale cached record", async ({ page }) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);

  // First, a good run so there IS a record to potentially leave behind.
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  expect(await pollUntil(async () => (await readLastRun(page)) !== null)).toBe(true);

  // Now a run where every file fails to parse.
  await setInputFile(page, "raw-file-input", "Raw Broken.csv", MALFORMED_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.locator(".error-text")).toBeVisible({ timeout: 15_000 });

  // The previous record must be cleared, not left stale next to a failed run.
  expect(await pollUntil(async () => (await readLastRun(page)) === null)).toBe(true);
});
