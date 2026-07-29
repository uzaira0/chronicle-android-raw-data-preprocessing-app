import { expect, test, type Page } from "@playwright/test";

import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  gotoApp,
  installDeterministicRuntime,
  processFiles,
  setInputFile,
} from "./helpers";

/**
 * Persona 7 — Storage-pressure tester.
 *
 * A researcher with a nearly-full disk. The app warns at >80% of quota, offers
 * a one-click "clear cached run", and must never silently lose data or wedge.
 *
 * We simulate the *environment* (a near-full disk) by overriding the browser's
 * own `navigator.storage.estimate()` — this is the storage condition itself,
 * not app state. App data is only ever read for verification.
 */
test.describe.configure({ mode: "serial" });

async function simulateQuota(page: Page, usage: number, quota: number): Promise<void> {
  await page.addInitScript(
    ({ usage, quota }) => {
      const nav = navigator as unknown as { storage?: { estimate?: () => Promise<unknown> } };
      const estimate = () => Promise.resolve({ usage, quota });
      if (nav.storage) {
        nav.storage.estimate = estimate;
      } else {
        Object.defineProperty(nav, "storage", { configurable: true, value: { estimate } });
      }
    },
    { usage, quota },
  );
}

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
          try {
            const tx = open.result.transaction("lastRun", "readonly");
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

test("warns with a concrete recovery action above 80% of quota", async ({ page }) => {
  await installDeterministicRuntime(page);
  await simulateQuota(page, 9_000_000_000, 10_000_000_000); // 90%
  await gotoApp(page);

  const banner = page.getByTestId("storage-pressure");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/90% full/);
  await expect(banner).toContainText(/GB/);
  await expect(page.getByTestId("storage-pressure-clear")).toBeVisible();

  // Dismiss hides it (until the next high reading re-arms it).
  await page.getByTestId("storage-pressure-dismiss").click();
  await expect(banner).toBeHidden();
});

test("stays quiet below the threshold", async ({ page }) => {
  await installDeterministicRuntime(page);
  await simulateQuota(page, 1_000_000_000, 10_000_000_000); // 10%
  await gotoApp(page);
  await expect(page.getByTestId("storage-pressure")).toHaveCount(0);
});

test("the in-banner clear frees the cached run", async ({ page }) => {
  await installDeterministicRuntime(page);
  await simulateQuota(page, 9_500_000_000, 10_000_000_000); // 95%
  await gotoApp(page);

  // Make a cached run exist, then clear it from the banner.
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  await expect(page.getByTestId("storage-pressure")).toBeVisible();

  await page.getByTestId("storage-pressure-clear").click();
  await expect(page.getByText(/Cleared the cached last run/i)).toBeVisible();
  // The cached record is actually gone.
  await expect.poll(async () => await readLastRun(page)).toBeNull();
});

test("eviction of cached data leaves a usable app, not a blank page", async ({ page }) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  await expect.poll(async () => await readLastRun(page)).not.toBeNull();

  // Simulate the browser evicting this origin's IndexedDB under pressure.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const del = indexedDB.deleteDatabase("chronicle-last-run");
        del.onsuccess = () => resolve();
        del.onerror = () => resolve();
        del.onblocked = () => resolve();
      }),
  );

  await page.reload();
  await installDeterministicRuntime(page);
  await gotoApp(page);
  // No restored results (the cache was evicted), but the app is fully usable.
  await expect(page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })).toBeVisible();
  await expect(page.getByTestId("raw-file-input")).toBeAttached();
  await expect(page.getByTestId("result-panel")).toHaveCount(0);
});

test("a full localStorage does not crash a settings write", async ({ page }) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  // Fill localStorage to near its cap under a NON-app key (environment condition).
  await page.evaluate(() => {
    try {
      const blob = "x".repeat(512 * 1024);
      for (let i = 0; i < 12; i += 1) window.localStorage.setItem(`__pad_${i}`, blob);
    } catch {
      /* already full — that's the point */
    }
  });

  // A settings change still works in-memory even if its persistence write fails.
  await page.getByTestId("toggle-processScreenUsage").check();
  await expect(page.getByTestId("toggle-processScreenUsage")).toBeChecked();
  expect(pageErrors).toEqual([]);

  // cleanup
  await page.evaluate(() => {
    for (let i = 0; i < 12; i += 1) window.localStorage.removeItem(`__pad_${i}`);
  });
});

test("requests persistent storage on boot so saved data isn't evicted", async ({ page }) => {
  let persistCalled = false;
  await page.exposeFunction("__recordPersist", () => {
    persistCalled = true;
  });
  await page.addInitScript(() => {
    const nav = navigator as unknown as {
      storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> };
    };
    if (nav.storage) {
      nav.storage.persisted = () => Promise.resolve(false);
      nav.storage.persist = () => {
        (window as unknown as { __recordPersist: () => void }).__recordPersist();
        return Promise.resolve(true);
      };
    }
  });
  await installDeterministicRuntime(page);
  await gotoApp(page);

  // The app asks the browser to keep this origin's storage persistent.
  await expect.poll(() => persistCalled).toBe(true);
});
