import { expect, test } from "./durabilityContext";
import { APP_ONLY_RAW_CSV } from "./fixtures";
import { gotoApp, installDeterministicRuntime, setInputFile } from "./helpers";

/**
 * The fail-closed durable-workspace gate, per engine.
 *
 * The app refuses to process at all unless it can write, read back and verify a
 * file in origin-private storage — from the main thread AND from the Rust worker
 * that performs every real workspace write. This suite proves both halves of the
 * contract on every engine in the matrix:
 *
 *  - where the capability is genuinely missing (Playwright's ephemeral WebKit,
 *    which is Safari private-browsing behaviour), the banner appears and
 *    processing is refused with no partial run;
 *  - where it is present, the banner NEVER appears and processing works;
 *  - the refusal is reproducible on every engine by denying each capability the
 *    store depends on, one at a time.
 *
 * Every test here carries @no-storage, which is the ONLY tag the ephemeral
 * `webkit` project runs. Nothing else can run there: the gate correctly refuses
 * to process a file without durable storage, so a WebKit test that processes
 * anything belongs in `webkit-durable`. These tests still run on chromium and
 * firefox too, where they assert the opposite half of the contract.
 */

const BANNER = "workspace-unavailable";

/** Is origin-private storage actually usable in this project's context? */
async function opfsAvailable(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("chronicle-e2e-availability", {
        create: true,
      });
      const handle = await directory.getFileHandle("probe.bin", { create: true });
      const writable = await handle.createWritable();
      await writable.write(new Uint8Array([1]));
      await writable.close();
      return (await (await handle.getFile()).arrayBuffer()).byteLength === 1;
    } catch {
      return false;
    }
  });
}

test("@no-storage the durable-workspace banner matches what this engine can actually do", async ({
  page,
}) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
  const available = await opfsAvailable(page);
  const banner = page.getByTestId(BANNER);

  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();

  if (available) {
    // A passing engine must never show the refusal. The queued file rules out
    // the unrelated "nothing to process" reason for a disabled button, and the
    // wait covers the boot probe's main-thread + worker round-trip.
    await expect(page.getByTestId("process-files-button")).toBeEnabled({
      timeout: 20_000,
    });
    await expect(banner).toBeHidden();
    return;
  }

  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("Durable local processing is unavailable");
  // The message names a cause instead of failing silently.
  await expect(banner).toContainText(/Origin-private file storage|Web Locks API/);
  // And the control state agrees with the message: processing is genuinely
  // unavailable, not merely described as unavailable.
  await expect(page.getByTestId("process-files-button")).toBeDisabled();
  await expect(page.getByTestId("result-panel")).toHaveCount(0);
});

/**
 * Deny one capability at a time in a context that otherwise has all of them, so
 * every engine — not only the one that happens to lack OPFS — proves the gate.
 * Each denial is installed before any application code runs and applies to the
 * worker as well, because the worker calls the same `navigator` API.
 */
const DENIALS = [
  {
    name: "origin-private storage cannot be opened",
    expected: /could not be opened/,
    install: () => {
      Object.defineProperty(navigator.storage, "getDirectory", {
        configurable: true,
        value: () =>
          Promise.reject(new DOMException("denied by test", "SecurityError")),
      });
    },
  },
  {
    name: "origin-private storage is open but not writable",
    expected: /not writable/,
    install: () => {
      const storage = navigator.storage as unknown as {
        getDirectory: () => Promise<FileSystemDirectoryHandle>;
      };
      const original = storage.getDirectory.bind(navigator.storage);
      Object.defineProperty(navigator.storage, "getDirectory", {
        configurable: true,
        value: async () => {
          const root = await original();
          return new Proxy(root, {
            get(target, property, receiver) {
              if (property === "getDirectoryHandle") {
                return async (name: string, options?: FileSystemGetDirectoryOptions) => {
                  const directory = await target.getDirectoryHandle(name, options);
                  return new Proxy(directory, {
                    get(inner, innerProperty, innerReceiver) {
                      if (innerProperty === "getFileHandle") {
                        return () =>
                          Promise.reject(
                            new DOMException("denied by test", "QuotaExceededError"),
                          );
                      }
                      const value: unknown = Reflect.get(inner, innerProperty, innerReceiver);
                      return typeof value === "function"
                        ? (value as (...args: unknown[]) => unknown).bind(inner)
                        : value;
                    },
                  });
                };
              }
              const value: unknown = Reflect.get(target, property, receiver);
              return typeof value === "function"
                ? (value as (...args: unknown[]) => unknown).bind(target)
                : value;
            },
          });
        },
      });
    },
  },
  {
    name: "the Web Locks API is missing",
    expected: /Web Locks API/,
    install: () => {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: undefined,
      });
    },
  },
] as const;

for (const denial of DENIALS) {
  test(`@no-storage processing fails closed when ${denial.name}`, async ({ page }) => {
    await installDeterministicRuntime(page);
    await gotoApp(page);
    // Measure the engine's real capability FIRST, before the denial exists.
    // Where a context already has no origin-private storage (Playwright's
    // ephemeral WebKit), the test above is the real evidence and a synthetic
    // denial could only assert a reason the engine has already overruled.
    test.skip(
      !(await opfsAvailable(page)),
      "this context has no origin-private storage to deny",
    );

    await page.addInitScript(denial.install);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
    ).toBeVisible();

    const banner = page.getByTestId(BANNER);
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText(denial.expected);

    await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
    await page.getByRole("tab", { name: /Process/i }).click();
    await expect(page.getByTestId("process-files-button")).toBeDisabled();
    // No half-run: nothing was produced and nothing claims success.
    await expect(page.getByTestId("result-panel")).toHaveCount(0);
  });
}
