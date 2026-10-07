import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceBackupControls } from "@/components/WorkspaceBackupControls";
import type { ProcessedFileResult } from "@/lib/types";

function result(
  inputFileName: string,
  persistedGeneration: number | undefined,
): ProcessedFileResult {
  return {
    inputFileName,
    rustRuntimeReceipt: {
      workspaceId: `sha256:${"1".repeat(64)}`,
      workspaceRootDigest: `sha256:${"2".repeat(64)}`,
      ...(persistedGeneration === undefined ? {} : { persistedGeneration }),
    },
  } as unknown as ProcessedFileResult;
}

describe("WorkspaceBackupControls", () => {
  it("offers export only for a run whose workspace was saved", () => {
    const html = renderToStaticMarkup(
      <WorkspaceBackupControls
        results={[result("Saved.csv", 3), result("Ephemeral.csv", undefined)]}
      />,
    );
    expect(html).toContain("Export Saved.csv");
    // An ephemeral run has no committed closure to read back.
    expect(html).not.toContain("Export Ephemeral.csv");
  });

  it("keeps import enabled while durable storage is available", () => {
    const html = renderToStaticMarkup(
      <WorkspaceBackupControls results={[]} durableStorageAvailable />,
    );
    expect(html).toMatch(/data-testid="import-workspace-closure"(?![^>]*disabled)/);
    expect(html).not.toContain('data-testid="workspace-backup-unavailable"');
  });

  it("disables import and says why when durable storage is unavailable", () => {
    const html = renderToStaticMarkup(
      <WorkspaceBackupControls
        results={[]}
        durableStorageAvailable={false}
      />,
    );
    expect(html).toMatch(/data-testid="import-workspace-closure"[^>]*disabled/);
    expect(html).toContain('data-testid="workspace-backup-unavailable"');
    expect(html).toContain("Importing a backup needs durable local storage");
  });
});
