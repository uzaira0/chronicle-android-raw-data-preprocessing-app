import type { Page } from "@playwright/test";

import { expect, test } from "./durabilityContext";
import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  downloadClosure,
  gotoApp,
  inspectClosure,
  installDeterministicRuntime,
  processFiles,
  setInputFile,
} from "./helpers";

/**
 * OPFS fault injection against a real workspace, on every engine that can hold
 * one. `opfsArtifactStore.test.ts` injects the same faults into an in-memory
 * mock; these tests damage the bytes an actual browser wrote, so each engine's
 * filesystem semantics are part of the evidence instead of an assumption.
 *
 * The contract under damage: the workspace either recovers from its alternating
 * root slot, or it refuses and says so. It never hands back an artifact closure
 * it could not verify, and it never half-writes over damage.
 *
 * The alternating-slot test below runs the pipeline TWICE in one page on
 * purpose. That is the only cross-engine coverage of a second Salsa database
 * inside one WASM instance, which `--merge-similar-functions` silently broke on
 * WebKit (see rust/chronicle_preprocessing_runtime_wasm/Cargo.toml). Do not
 * "simplify" it into a single run.
 */

const WORKSPACES_DIRECTORY = "chronicle-workflow-workspaces-v1";
const STORE_DIRECTORY = "chronicle-workflow-runtime-v1";
const UNRECOVERABLE = /no valid artifact closure can be recovered/;

type StoreEntry = { path: string[]; size: number };

/** Every file the workspace store wrote for this origin, workspace-relative. */
async function listStoreFiles(page: Page): Promise<StoreEntry[]> {
  return page.evaluate(async (workspacesDirectory) => {
    const root = await navigator.storage.getDirectory();
    const found: Array<{ path: string[]; size: number }> = [];
    const walk = async (
      directory: FileSystemDirectoryHandle,
      path: string[],
    ): Promise<void> => {
      const iterable = directory as unknown as {
        entries(): AsyncIterableIterator<
          [string, FileSystemFileHandle | FileSystemDirectoryHandle]
        >;
      };
      for await (const [name, handle] of iterable.entries()) {
        if (handle.kind === "directory") {
          await walk(handle, [...path, name]);
        } else {
          const file = await handle.getFile();
          found.push({ path: [...path, name], size: file.size });
        }
      }
    };
    await walk(await root.getDirectoryHandle(workspacesDirectory), []);
    return found;
  }, WORKSPACES_DIRECTORY);
}

/** Overwrite one byte of a store file, keeping its size: silent bit rot. */
async function flipByte(page: Page, target: string[]): Promise<void> {
  await page.evaluate(
    async ({ workspacesDirectory, path }) => {
      let directory = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(workspacesDirectory);
      for (const segment of path.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(segment);
      }
      const name = path[path.length - 1] as string;
      const handle = await directory.getFileHandle(name);
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if (bytes.length === 0) {
        throw new Error(`cannot corrupt an empty file: ${name}`);
      }
      const index = Math.floor(bytes.length / 2);
      bytes[index] = (bytes[index] ?? 0) ^ 0xff;
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    },
    { workspacesDirectory: WORKSPACES_DIRECTORY, path: target },
  );
}

/** Delete a store file outright: an evicted or lost object. */
async function deleteFile(page: Page, target: string[]): Promise<void> {
  await page.evaluate(
    async ({ workspacesDirectory, path }) => {
      let directory = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(workspacesDirectory);
      for (const segment of path.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(segment);
      }
      await directory.removeEntry(path[path.length - 1] as string);
    },
    { workspacesDirectory: WORKSPACES_DIRECTORY, path: target },
  );
}

/** The root slot carrying the highest generation: the one recovery prefers. */
async function newestRootSlot(page: Page): Promise<string[]> {
  const slots = await page.evaluate(
    async ({ workspacesDirectory, storeDirectory }) => {
      const root = await navigator.storage.getDirectory();
      const workspaces = await root.getDirectoryHandle(workspacesDirectory);
      const out: Array<{ path: string[]; generation: number }> = [];
      const iterable = workspaces as unknown as {
        entries(): AsyncIterableIterator<
          [string, FileSystemFileHandle | FileSystemDirectoryHandle]
        >;
      };
      for await (const [workspaceName, workspaceHandle] of iterable.entries()) {
        if (workspaceHandle.kind !== "directory") continue;
        const roots = await workspaceHandle
          .getDirectoryHandle(storeDirectory)
          .then((handle) => handle.getDirectoryHandle("roots"))
          .catch(() => null);
        if (!roots) continue;
        for (const slotName of ["root-a.json", "root-b.json"]) {
          try {
            const handle = await roots.getFileHandle(slotName);
            const parsed = JSON.parse(
              await (await handle.getFile()).text(),
            ) as { generation: number };
            out.push({
              path: [workspaceName, storeDirectory, "roots", slotName],
              generation: parsed.generation,
            });
          } catch {
            // A missing or unparseable slot is simply not a candidate.
          }
        }
      }
      return out;
    },
    {
      workspacesDirectory: WORKSPACES_DIRECTORY,
      storeDirectory: STORE_DIRECTORY,
    },
  );
  slots.sort((left, right) => right.generation - left.generation);
  const newest = slots[0];
  if (!newest) throw new Error("no parseable workspace root slot was found");
  return newest.path;
}

/** The largest content object: certainly inside the closure an export verifies. */
function largestContentObject(files: readonly StoreEntry[]): StoreEntry {
  const objects = files.filter((file) => file.path.includes("objects"));
  const victim = objects.reduce<StoreEntry | undefined>(
    (largest, file) => (!largest || file.size > largest.size ? file : largest),
    undefined,
  );
  if (!victim) throw new Error("the run persisted no content-addressed objects");
  return victim;
}

async function run(page: Page): Promise<void> {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
}

/** Click export and report what the UI said, plus whether anything downloaded. */
async function attemptExport(
  page: Page,
): Promise<{ status: string; downloads: string[] }> {
  const downloads: string[] = [];
  const record = (download: { suggestedFilename(): string }): void => {
    downloads.push(download.suggestedFilename());
  };
  page.on("download", record);
  try {
    await page.getByTestId("export-workspace-closure").first().click();
    const status = page.getByTestId("workspace-backup-status");
    await expect(status).toBeVisible({ timeout: 60_000 });
    return { status: (await status.textContent()) ?? "", downloads };
  } finally {
    page.off("download", record);
  }
}

test("@durability @opfs three runs in one page all succeed on every engine", async ({
  page,
}) => {
  // Regression test with a named cause. `wasm-opt --merge-similar-functions`
  // corrupted Salsa 0.28's jar identity, so the SECOND salsa::Storage built in
  // one WASM instance registered an incomplete jar map. On WebKit 26.4 that
  // aborted every run after the first with "Unreachable code should not be
  // executed (evaluating 't.execute_workspace')"; the panic behind it was
  // "ingredient `salsa::input::JarImpl<...UsageSupportInput>` was not
  // registered". Chromium and Firefox never reached that path. Three runs, not
  // two, because runs 2 and 3 exercised the failure identically.
  await installDeterministicRuntime(page);
  await gotoApp(page);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await run(page);
    await expect(
      page.getByTestId("result-file-table").first(),
      `run ${attempt} produced a result table`,
    ).toBeVisible();
  }
  const closure = inspectClosure(await downloadClosure(page));
  expect(closure.manifest.workspaceId).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test("@durability @opfs a bit-rotted content object is refused, never exported as a verified closure", async ({
  page,
}) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
  await run(page);

  await flipByte(page, largestContentObject(await listStoreFiles(page)).path);

  const { status, downloads } = await attemptExport(page);
  // Either recovery rejects the only slot whose retained set is damaged, or
  // the export's own per-object digest check catches it. Both are refusals.
  expect(status).toMatch(/no valid artifact closure can be recovered|corrupt OPFS object/);
  expect(downloads, "no archive is handed out for an unverifiable workspace").toEqual([]);
});

test("@durability @opfs a missing referenced object is refused, never exported as a partial closure", async ({
  page,
}) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
  await run(page);

  await deleteFile(page, largestContentObject(await listStoreFiles(page)).path);

  const { status, downloads } = await attemptExport(page);
  expect(status).not.toContain("exported");
  expect(status.length, "a refusal must say something").toBeGreaterThan(0);
  expect(downloads, "no archive is handed out for an incomplete workspace").toEqual([]);
});

test("@durability @opfs a destroyed newest root slot recovers from the alternating slot", async ({
  page,
}) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
  // Two commits, so both alternating slots hold an independently valid root.
  await run(page);
  const first = inspectClosure(await downloadClosure(page));
  await run(page);
  const second = inspectClosure(await downloadClosure(page));
  expect(second.manifest.workspaceId).toBe(first.manifest.workspaceId);
  expect(second.manifest.workspaceRootDigest).not.toBe(
    first.manifest.workspaceRootDigest,
  );

  await flipByte(page, await newestRootSlot(page));

  // The app must still boot, and the workspace must still export — from the
  // slot the damaged one superseded. This is the whole point of two slots.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(page.getByTestId("export-workspace-closure").first()).toBeVisible({
    timeout: 30_000,
  });
  const recovered = inspectClosure(await downloadClosure(page));
  expect(recovered.manifest.workspaceId).toBe(first.manifest.workspaceId);
  expect(recovered.manifest.workspaceRootDigest).toBe(
    first.manifest.workspaceRootDigest,
  );
});

test("@durability @opfs a workspace whose objects are damaged refuses to be written over by an import", async ({
  page,
}) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
  await run(page);

  // A verified backup taken while the workspace was still intact.
  const archive = await downloadClosure(page);
  const backup = inspectClosure(archive);

  await flipByte(page, largestContentObject(await listStoreFiles(page)).path);
  expect((await attemptExport(page)).downloads).toEqual([]);

  // Importing that backup does NOT repair the damage in place: the store
  // refuses to advance a root it cannot first recover, so the damaged origin
  // stays untouched rather than being half-rewritten. Recorded, not asserted
  // as desirable — the working remedy is importing into a fresh origin, which
  // workspace-recovery.spec.ts covers.
  await page.getByTestId("import-workspace-file").setInputFiles({
    name: "Raw P01.chronicle-workspace",
    mimeType: "application/vnd.chronicle.workflow-workspace",
    buffer: Buffer.from(archive),
  });
  await expect(page.getByTestId("workspace-backup-status")).toContainText(
    UNRECOVERABLE,
    { timeout: 60_000 },
  );

  // And the damaged store still refuses to export, so nothing silently
  // "recovered" behind that refusal.
  const after = await attemptExport(page);
  expect(after.downloads).toEqual([]);
  expect(backup.manifest.workspaceId).toMatch(/^sha256:[0-9a-f]{64}$/);
});
