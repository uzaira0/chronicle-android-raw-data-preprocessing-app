import { expect, test } from "./durabilityContext";
import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  assertNoExternalRequests,
  downloadClosure,
  gotoApp,
  inspectClosure,
  installDeterministicRuntime,
  processFiles,
  setInputFile,
  trackExternalRequests,
} from "./helpers";

test("@smoke @opfs verified workspace closure survives reload, imports into a fresh origin, rejects corruption, and resumes its root chain", async ({
  page,
  freshOriginPage,
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

  // A fresh origin store (a second context where the engine isolates one, an
  // explicit origin wipe on WebKit, which does not). Import must derive its
  // destination from the signed closure identity, reject tampering, then let
  // the same raw input continue from the imported root.
  {
    const restoredPage = await freshOriginPage();
    const restoredRequests = trackExternalRequests(restoredPage);
    await installDeterministicRuntime(restoredPage);
    await gotoApp(restoredPage);
    await restoredPage.getByRole("tab", { name: /Process/i }).click();
    await restoredPage.getByTestId("import-workspace-file").setInputFiles({
      name: "Raw P01.chronicle-workspace",
      mimeType: "application/vnd.chronicle.workflow-workspace",
      buffer: Buffer.from(reloadedArchive),
    });
    // Importing this closure means rewriting every object of a ~4.5 MB
    // content-addressed archive through OPFS, in a fresh context whose worker
    // is still fetching and compiling the runtime WASM. Measured on Firefox
    // 148 that takes 2.5-16 s depending on machine load, so the 5 s default
    // expect timeout decided this assertion by luck, not by behaviour.
    await expect(restoredPage.getByTestId("workspace-backup-status")).toContainText(
      "Verified workspace restored at generation 1",
      { timeout: 60_000 },
    );

    const corrupt = Uint8Array.from(reloadedArchive);
    corrupt[corrupt.byteLength - 1] = (corrupt[corrupt.byteLength - 1] ?? 0) ^ 0xff;
    await restoredPage.getByTestId("import-workspace-file").setInputFiles({
      name: "corrupt.chronicle-workspace",
      mimeType: "application/vnd.chronicle.workflow-workspace",
      buffer: Buffer.from(corrupt),
    });
    await expect(restoredPage.getByTestId("workspace-backup-status")).toContainText(
      "digest mismatch",
      { timeout: 60_000 },
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
  }
});
