import { expect, test } from "./durabilityContext";
import { APP_ONLY_RAW_CSV } from "./fixtures";
import { gotoApp, installDeterministicRuntime, setInputFile } from "./helpers";

/**
 * The fail-closed durable-workspace gate, per engine.
 *
 * The app refuses to process at all unless it can write, read back and verify a
 * file in origin-private storage — from the main thread AND from the Rust worker
 * that performs every real workspace write. The two halves are denied by
 * different mechanisms, because they run in different global scopes:
 *
 *  - where the capability is genuinely missing (Playwright's ephemeral WebKit,
 *    which is Safari private-browsing behaviour), BOTH scopes are denied at
 *    once: the banner appears and processing is refused with no partial run;
 *  - where it is present, the banner NEVER appears and processing works;
 *  - the main-thread half is denied one capability at a time with
 *    `page.addInitScript`, which reaches documents and frames ONLY;
 *  - the worker half is denied by rewriting the worker's own module source in
 *    flight (the "only the worker is denied durable storage" test below), the
 *    only way to reach a `DedicatedWorkerGlobalScope` — `addInitScript` never
 *    runs there. That test leaves the main thread healthy, so the worker arm is
 *    the only thing that can produce the refusal it asserts.
 *
 * Every test tagged @no-storage carries the ONLY tag the ephemeral `webkit`
 * project runs. Nothing else can run there: the gate correctly refuses to
 * process a file without durable storage, so a WebKit test that processes
 * anything belongs in `webkit-durable`. The worker-only denial test is
 * deliberately NOT tagged @no-storage: it requires a HEALTHY main thread, which
 * the ephemeral WebKit context cannot provide, so it runs on chromium, firefox
 * and webkit-durable.
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

test("@smoke @no-storage the durable-workspace banner matches what this engine can actually do", async ({
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
 *
 * These denials are installed with `page.addInitScript`, which runs in every
 * document and frame and NOWHERE else. It does NOT reach the Rust worker: a
 * `DedicatedWorkerGlobalScope` gets no init scripts from Playwright, so the
 * worker below keeps a fully working `navigator.storage`. Each case therefore
 * proves the MAIN-THREAD arm of the gate — `probeDurableWorkspaceCapability`
 * in App.tsx short-circuits on an unavailable main thread, so the worker arm
 * never decides these assertions. The worker arm is proved separately by
 * the "only the worker is denied durable storage" test, which rewrites the
 * worker's module source instead.
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

/**
 * A string that can only have come from the worker's own global scope.
 *
 * It is injected into the worker module source and nowhere else, so seeing it in
 * the banner is proof that `probeWorkerWorkspaceCapability()` — not
 * `probeOpfsCapability()` on the main thread — produced the refusal. The reason
 * reaches the banner through `capabilityErrorText`, which returns
 * `error.message` verbatim.
 */
const WORKER_DENIAL_MARKER =
  "denied inside the Chronicle worker by the durability gate test";

/**
 * Prepended to the worker's module source. Module imports are hoisted above it,
 * but `openOpfsRoot()` reads `navigator.storage.getDirectory` at call time — long
 * after this runs — so shadowing the instance property is enough. This is the
 * same shape as the main-thread `DENIALS[0]`, applied in the scope
 * `addInitScript` cannot reach.
 */
const WORKER_STORAGE_DENIAL = `
Object.defineProperty(navigator.storage, "getDirectory", {
  configurable: true,
  value: () =>
    Promise.reject(
      new DOMException(${JSON.stringify(WORKER_DENIAL_MARKER)}, "SecurityError"),
    ),
});
`;

/**
 * The worker half of the gate, with the main thread deliberately left HEALTHY.
 *
 * This is the arm the `addInitScript` denials above cannot reach and cannot
 * decide: App.tsx's `probeDurableWorkspaceCapability` returns the main-thread
 * result the moment it is `unavailable`, so as long as the main thread is denied
 * the worker's answer is discarded. Deleting the worker probe from that function
 * makes this test — and only this test — go red.
 *
 * Not tagged @no-storage: it needs an engine that DOES grant origin-private
 * storage on the main thread, which the ephemeral `webkit` project is not.
 */
test("processing fails closed when only the worker is denied durable storage", async ({
  page,
}) => {
  // The service worker in public/sw.js is cache-first for every same-origin
  // subresource and precaches the worker chunk from sw-precache-extra.json. Once
  // it controls the page the worker module is served from the Cache API and
  // makes no network request at all, so there is nothing for `page.route` to
  // rewrite — measured: the interception fired on some runs and not others,
  // purely on whether the worker was constructed before the service worker
  // claimed the client. The offline cache is irrelevant to the durability gate,
  // so this test keeps it out of the way and the worker module always comes off
  // the network. `register()` rejects rather than being removed, because
  // main.tsx guards on `"serviceWorker" in navigator` and already catches a
  // failed registration.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: () =>
          Promise.reject(new Error("service worker disabled by the durability test")),
        addEventListener: () => {},
        controller: null,
        ready: new Promise(() => {}),
      },
    });
  });

  let patchedWorkerScripts = 0;
  // Playwright's `addInitScript` reaches documents and frames only — a dedicated
  // worker never receives it. Rewriting the module the worker is constructed
  // from is the interception point that does reach it.
  await page.route("**/chronicle-worker*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const headers = { ...response.headers() };
    // The body grows; a stale Content-Length truncates the module.
    delete headers["content-length"];
    patchedWorkerScripts += 1;
    await route.fulfill({
      status: response.status(),
      headers,
      body: `${WORKER_STORAGE_DENIAL}${source}`,
    });
  });

  await installDeterministicRuntime(page);
  await gotoApp(page);

  // If nothing was rewritten, the worker ran unpatched and any pass below would
  // be vacuous. Fail loudly rather than assert against an unmodified worker.
  expect(
    patchedWorkerScripts,
    "the worker module request was never intercepted, so the worker was not denied",
  ).toBeGreaterThan(0);
  // The main thread must be genuinely healthy, or this proves nothing about the
  // worker: an unavailable main thread short-circuits the gate before the
  // worker's result is even consulted.
  expect(
    await opfsAvailable(page),
    "the main thread must keep working origin-private storage for this test to isolate the worker arm",
  ).toBe(true);

  const banner = page.getByTestId(BANNER);
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("Durable local processing is unavailable");
  // The reason names the worker's failure, not a main-thread one.
  await expect(banner).toContainText(WORKER_DENIAL_MARKER);

  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(page.getByTestId("process-files-button")).toBeDisabled();
  // No half-run: nothing was produced and nothing claims success.
  await expect(page.getByTestId("result-panel")).toHaveCount(0);
});
