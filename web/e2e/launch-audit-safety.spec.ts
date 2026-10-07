/**
 * Launch-audit fixes that only a real browser can show: deletion that
 * actually removes participant data from origin-private storage, confirmed
 * destructive actions with working modal focus, truthful write outcomes,
 * the raw-file size bound, accessible toasts and popovers, the View tab's
 * timeline-off explanation, and the footer notices.
 */
import type { Page } from "@playwright/test";

import { expect, test } from "./durabilityContext";
import { APP_ONLY_RAW_CSV } from "./fixtures";
import { gotoApp, installDeterministicRuntime, processFiles, setInputFile } from "./helpers";

import {
  LAST_RUN_DB_NAME,
  LAST_RUN_DB_VERSION,
  LAST_RUN_RECORD_ID,
  LAST_RUN_STORE_NAME,
} from "../src/lib/lastRunStore";

const MARKER = "PMARKER777";
const MARKER_RAW_CSV = APP_ONLY_RAW_CSV.replaceAll("P01", MARKER);

/** OPFS files whose bytes contain the participant marker (the probe2 scan). */
async function opfsFilesContainingMarker(page: Page): Promise<string[]> {
  return page.evaluate(async (marker) => {
    const needle = new TextEncoder().encode(marker);
    const contains = (bytes: Uint8Array): boolean => {
      outer: for (let index = 0; index + needle.length <= bytes.length; index += 1) {
        for (let offset = 0; offset < needle.length; offset += 1) {
          if (bytes[index + offset] !== needle[offset]) continue outer;
        }
        return true;
      }
      return false;
    };
    const hits: string[] = [];
    const walk = async (directory: FileSystemDirectoryHandle, path: string): Promise<void> => {
      for await (const handle of (
        directory as FileSystemDirectoryHandle & {
          values(): AsyncIterable<FileSystemHandle>;
        }
      ).values()) {
        if (handle.kind === "directory") {
          await walk(handle as FileSystemDirectoryHandle, `${path}/${handle.name}`);
          continue;
        }
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          if (contains(new Uint8Array(await file.arrayBuffer()))) hits.push(`${path}/${handle.name}`);
        } catch {
          // A spill file held open by a live worker cannot be read here; it
          // is truncated to zero once its request finishes.
        }
      }
    };
    await walk(await navigator.storage.getDirectory(), "");
    return hits;
  }, MARKER);
}

/** The persisted last-run record, read on a connection that is closed again. */
async function readLastRun(page: Page): Promise<unknown> {
  return page.evaluate(
    ({ databaseName, databaseVersion, recordId, storeName }) =>
      new Promise((resolve) => {
        const open = indexedDB.open(databaseName, databaseVersion);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(storeName)) {
            open.result.createObjectStore(storeName, { keyPath: "id" });
          }
        };
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction(storeName, "readonly").objectStore(storeName).get(recordId);
          get.onsuccess = () => {
            db.close();
            resolve(get.result ?? null);
          };
          get.onerror = () => {
            db.close();
            resolve(null);
          };
        };
      }),
    {
      databaseName: LAST_RUN_DB_NAME,
      databaseVersion: LAST_RUN_DB_VERSION,
      recordId: LAST_RUN_RECORD_ID,
      storeName: LAST_RUN_STORE_NAME,
    },
  );
}

async function processMarkerFile(page: Page): Promise<void> {
  await setInputFile(page, "raw-file-input", "Marker.csv", MARKER_RAW_CSV, "text/csv");
  await processFiles(page);
  await expect.poll(async () => (await opfsFilesContainingMarker(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => readLastRun(page), { timeout: 30_000 }).not.toBeNull();
}

test.beforeEach(async ({ page }) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
});

test("@audit @opfs Delete results asks first, then removes the participant's data from OPFS and IndexedDB", async ({
  page,
}) => {
  await processMarkerFile(page);

  const deleteButton = page.getByTestId("delete-results");
  await deleteButton.click();
  const dialog = page.getByTestId("delete-results-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "alertdialog");
  // Focus moves into the dialog, on the safe action, and Tab stays inside.
  const cancel = page.getByTestId("delete-results-dialog-cancel");
  const confirm = page.getByTestId("delete-results-dialog-confirm");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirm).toBeFocused();
  // Escape cancels, deletes nothing, and returns focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(deleteButton).toBeFocused();
  expect((await opfsFilesContainingMarker(page)).length).toBeGreaterThan(0);

  await deleteButton.click();
  await confirm.click();
  await expect(page.getByRole("status").filter({ hasText: "Deleted the processed results and their saved copy in this browser." })).toBeVisible();
  await expect.poll(() => opfsFilesContainingMarker(page), { timeout: 30_000 }).toEqual([]);
  expect(await readLastRun(page)).toBeNull();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })).toBeVisible();
  await expect(page.getByTestId("result-panel")).toBeHidden();
  expect(await opfsFilesContainingMarker(page)).toEqual([]);
});

test("@audit @opfs Delete all local data in the footer lists what it removes and wipes every store", async ({
  page,
}) => {
  await processMarkerFile(page);
  await page.getByRole("tab", { name: /Settings/i }).click();
  await page.getByLabel("Preset name").fill("Keep nothing");
  await page.getByTestId("save-preset-button").click();
  await expect(page.getByRole("status").filter({ hasText: "Preset saved: Keep nothing" })).toBeVisible();

  const footer = page.getByTestId("footer-notices");
  await footer.getByTestId("delete-all-local-data").click();
  const dialog = page.getByTestId("delete-all-local-data-dialog");
  await expect(dialog.getByTestId("local-data-inventory")).toContainText(
    "every processed result and its saved history",
  );
  await expect(dialog.getByTestId("local-data-inventory")).toContainText("every saved project");
  await dialog.getByTestId("delete-all-local-data-dialog-confirm").click();

  await expect(page.getByRole("status").filter({ hasText: "Deleted all of this app’s data stored in this browser." })).toBeVisible({ timeout: 30_000 });
  expect(await opfsFilesContainingMarker(page)).toEqual([]);
  expect(await readLastRun(page)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("chronicle.processingPresets.v1"))).toBeNull();
});

test("@audit Clear files and Delete project run only after confirmation", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Files/i }).click();
  const queue = page.getByText("Raw P01.csv").first();
  await expect(queue).toBeVisible();

  await page.getByRole("button", { name: "Clear files" }).click();
  await page.getByTestId("clear-files-dialog-cancel").click();
  await expect(page.getByTestId("clear-files-dialog")).toBeHidden();
  await expect(queue).toBeVisible();
  await page.getByRole("button", { name: "Clear files" }).click();
  await page.getByTestId("clear-files-dialog-confirm").click();
  await expect(page.getByText("Raw P01.csv")).toHaveCount(0);

  await page.getByRole("tab", { name: /Settings/i }).click();
  await page.getByLabel("Project name").fill("Wave 2");
  await page.getByTestId("save-project-button").click();
  const projects = page.getByTestId("project-list");
  await expect(projects).toContainText("Wave 2");
  await projects.getByRole("button", { name: "Delete project Wave 2" }).click();
  await expect(page.getByTestId("delete-project-dialog")).toContainText("Delete project “Wave 2”?");
  await page.getByTestId("delete-project-dialog-cancel").click();
  await expect(projects).toContainText("Wave 2");
  await projects.getByRole("button", { name: "Delete project Wave 2" }).click();
  await page.getByTestId("delete-project-dialog-confirm").click();
  await expect(page.getByTestId("project-list")).toHaveCount(0);
});

test("@audit Reset all takes focus, keeps Tab inside the dialog and returns focus", async ({ page }) => {
  await page.getByTestId("toggle-processScreenUsage").click();
  const trigger = page.getByRole("button", { name: /Reset all to defaults/i });
  await trigger.click();
  const dialog = page.getByTestId("reset-defaults-dialog");
  await expect(page.getByTestId("reset-defaults-dialog-cancel")).toBeFocused();
  for (let press = 0; press < 3; press += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("@audit importing JSON that is not a config export changes nothing and the error stays up", async ({
  page,
}) => {
  await page.getByLabel("Preset name").fill("Locked TECH");
  await page.getByTestId("save-preset-button").click();
  await expect(page.getByTestId("preset-list")).toContainText("Locked TECH");

  for (const body of ["{}", "[]"]) {
    await page.getByTestId("import-config-input").setInputFiles({
      name: "not-a-config.json",
      mimeType: "application/json",
      buffer: Buffer.from(body),
    });
    const alert = page.getByRole("alert").filter({ hasText: "This file is not a Chronicle config export" });
    await expect(alert).toBeVisible();
    await expect(page.getByTestId("preset-list")).toContainText("Locked TECH");
    await alert.getByRole("button", { name: "Dismiss" }).click();
    await expect(alert).toBeHidden();
  }

  // Error toasts no longer vanish after 5 s.
  await page.getByTestId("import-config-input").setInputFiles({
    name: "x.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  const alert = page.getByRole("alert").filter({ hasText: "Nothing was changed." });
  await expect(alert).toBeVisible();
  await page.waitForTimeout(6_500);
  await expect(alert).toBeVisible();
});

test("@audit a preset that cannot be stored is reported as not saved", async ({ page }) => {
  // Fill localStorage to the byte, halving the block on every refusal, so
  // even a small preset write is refused.
  await page.evaluate(() => {
    let size = 1024 * 1024;
    let index = 0;
    while (size >= 1) {
      try {
        localStorage.setItem(`__fill_${index}`, "x".repeat(size));
        index += 1;
      } catch {
        size = Math.floor(size / 2);
      }
    }
  });
  await page.getByLabel("Preset name").fill("Overflow");
  await page.getByTestId("save-preset-button").click();
  await expect(page.getByRole("alert").filter({ hasText: "Preset “Overflow” could not be saved in this browser" })).toBeVisible();
  await expect(page.getByText("Preset saved: Overflow")).toHaveCount(0);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("__fill_")) localStorage.removeItem(key);
    }
  });
});

test("@audit raw files above the size bound are refused before they are read", async ({ page }) => {
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="raw-file-input"]');
    if (!input) throw new Error("raw file input missing");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["participant_id\nP1\n"], "small.csv", { type: "text/csv" }));
    transfer.items.add(new File([new ArrayBuffer(180_000_001)], "huge.csv", { type: "text/csv" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "huge.csv is 180 MB, larger than the 180 MB this browser app can process" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Files/i }).click();
  await expect(page.getByText("small.csv").first()).toBeVisible();
  await expect(page.getByText("huge.csv", { exact: true })).toHaveCount(0);
});

test("@audit a help popover stays open while the pointer moves onto it and closes on Escape", async ({
  page,
}) => {
  const trigger = page.locator(".tooltip-trigger").first();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.hover();
  const popover = page.getByRole("tooltip");
  await expect(popover).toBeVisible();
  const box = await popover.boundingBox();
  if (!box) throw new Error("popover has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.waitForTimeout(500);
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
});

test("@audit @opfs the View tab says the timeline was off and links to the setting; day rows work by keyboard", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  await page.getByRole("tab", { name: /View/i }).click();
  const notice = page.getByTestId("timeline-off-notice");
  await expect(notice).toContainText("The interactive timeline was off when these results were processed");
  await expect(page.getByText("No app usage timeline for this participant.")).toHaveCount(0);

  const day = page.getByTestId("review-day-table").getByRole("button").first();
  await day.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("review-day-detail")).toBeVisible();
  await expect(day).toHaveAttribute("aria-pressed", "true");

  await notice.getByTestId("open-timeline-setting").click();
  await expect(page.getByRole("tab", { name: /Settings/i })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("toggle-enableInteractiveTimeline")).toBeFocused();
});

test("@audit the footer carries the privacy, terms, license and non-affiliation notices", async ({ page }) => {
  const footer = page.getByTestId("footer-notices");
  await expect(footer.getByTestId("privacy-notice")).toContainText("nothing you load or produce is uploaded");
  await expect(footer.getByTestId("privacy-notice")).toContainText("GitHub, Inc. receives each visitor’s IP address");
  await expect(footer.getByTestId("terms-notice")).toContainText("For research use only");
  await expect(footer.getByTestId("affiliation-notice")).toHaveText("Not affiliated with, or endorsed by, Methodic or Chronicle.");
  await expect(footer.getByRole("link", { name: "License (GPL-3.0)" })).toHaveAttribute(
    "href",
    /\/blob\/main\/LICENSE$/,
  );
  await expect(footer.getByRole("link", { name: "Source code" })).toHaveAttribute(
    "href",
    "https://github.com/uzaira0/chronicle-android-raw-data-preprocessing-app",
  );
  await expect(footer.getByRole("link", { name: "Third-party notices" })).toHaveAttribute(
    "href",
    /THIRD-PARTY-NOTICES\.txt$/,
  );
});
