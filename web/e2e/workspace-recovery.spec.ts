import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  assertNoExternalRequests,
  gotoApp,
  installDeterministicRuntime,
  processFiles,
  setInputFile,
  trackExternalRequests,
} from "./helpers";

const MAGIC = Buffer.from("CHRONICLE-CLOSURE-V1\n", "utf-8");

type ClosureManifest = {
  protocolVersion: "chronicle-runtime-closure/v1";
  workspaceId: string;
  workspaceRootDigest: string;
  previousWorkspaceRootDigest: string | null;
  objects: Array<{ digest: string; size: number; offset: number }>;
};

async function downloadClosure(page: Page): Promise<Uint8Array> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-workspace-closure").first().click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Playwright did not provide the workspace backup path");
  return new Uint8Array(await readFile(path));
}

function inspectClosure(bytes: Uint8Array): {
  manifest: ClosureManifest;
  root: { workspaceId: string; previousWorkspaceRootDigest: string | null };
} {
  expect(Buffer.from(bytes.subarray(0, MAGIC.byteLength))).toEqual(MAGIC);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const manifestSize = view.getUint32(MAGIC.byteLength, true);
  const manifestStart = MAGIC.byteLength + 4;
  const payloadStart = manifestStart + manifestSize;
  const manifest = JSON.parse(
    new TextDecoder().decode(bytes.subarray(manifestStart, payloadStart)),
  ) as ClosureManifest;
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

test("@smoke verified workspace closure survives reload, imports into a fresh origin, rejects corruption, and resumes its root chain", async ({
  page,
  browser,
}) => {
  const requests = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);
  await setInputFile(
    page,
    "raw-file-input",
    "Raw P01.csv",
    APP_ONLY_RAW_CSV,
    "text/csv",
  );
  await processFiles(page);

  const firstArchive = await downloadClosure(page);
  const first = inspectClosure(firstArchive);
  expect(first.manifest.protocolVersion).toBe("chronicle-runtime-closure/v1");
  expect(first.manifest.workspaceId).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(first.root.workspaceId).toBe(first.manifest.workspaceId);
  expect(first.root.previousWorkspaceRootDigest).toBeNull();

  // The lightweight IndexedDB receipt and authoritative OPFS closure survive
  // a real page reload; exporting again verifies the complete closure rather
  // than trusting cached UI metadata.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(page.getByTestId("export-workspace-closure")).toBeVisible({
    timeout: 10_000,
  });
  const reloadedArchive = await downloadClosure(page);
  expect(inspectClosure(reloadedArchive).manifest.workspaceRootDigest).toBe(
    first.manifest.workspaceRootDigest,
  );
  assertNoExternalRequests(requests);

  // A second browser context is a fresh origin store. Import must derive its
  // destination from the signed closure identity, reject tampering, then let
  // the same raw input continue from the imported root.
  const restoredContext = await browser.newContext();
  try {
    const restoredPage = await restoredContext.newPage();
    const restoredRequests = trackExternalRequests(restoredPage);
    await installDeterministicRuntime(restoredPage);
    await gotoApp(restoredPage);
    await restoredPage.getByRole("tab", { name: /Process/i }).click();
    await restoredPage.getByTestId("import-workspace-file").setInputFiles({
      name: "Raw P01.chronicle-workspace",
      mimeType: "application/vnd.chronicle.workspace",
      buffer: Buffer.from(reloadedArchive),
    });
    await expect(restoredPage.getByTestId("workspace-backup-status")).toContainText(
      "Verified workspace restored at generation 1",
    );

    const corrupt = Uint8Array.from(reloadedArchive);
    corrupt[corrupt.byteLength - 1] ^= 0xff;
    await restoredPage.getByTestId("import-workspace-file").setInputFiles({
      name: "corrupt.chronicle-workspace",
      mimeType: "application/vnd.chronicle.workspace",
      buffer: Buffer.from(corrupt),
    });
    await expect(restoredPage.getByTestId("workspace-backup-status")).toContainText(
      "digest mismatch",
    );

    await setInputFile(
      restoredPage,
      "raw-file-input",
      "Raw P01.csv",
      APP_ONLY_RAW_CSV,
      "text/csv",
    );
    await processFiles(restoredPage);
    const resumed = inspectClosure(await downloadClosure(restoredPage));
    expect(resumed.manifest.workspaceId).toBe(first.manifest.workspaceId);
    expect(resumed.root.previousWorkspaceRootDigest).toBe(
      first.manifest.workspaceRootDigest,
    );
    expect(resumed.manifest.workspaceRootDigest).not.toBe(
      first.manifest.workspaceRootDigest,
    );
    assertNoExternalRequests(restoredRequests);
  } finally {
    await restoredContext.close();
  }
});
