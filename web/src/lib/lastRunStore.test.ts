import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { clearLastRun, loadLastRun, saveLastRun } from "@/lib/lastRunStore";
import type { ProcessedFileResult } from "@/lib/types";

function result(): ProcessedFileResult {
  return {
    inputFileName: "Raw P01.csv",
    outputs: [
      {
        kind: "app",
        outputFileName: "Raw P01 App Usage.csv",
        blob: new Blob(["a,b\n1,2\n"], { type: "text/csv" }),
        rowCount: 1,
        previewRows: [["a", "b"], ["1", "2"]],
      },
    ],
    originalRowCount: 2,
    processedRowCount: 1,
    availableTimezones: ["America/Chicago"],
    timezone: "America/Chicago",
    appRowCount: 1,
    screenRowCount: 0,
    timezoneAction: "none",
    rowsBeforeTimezoneHandling: 2,
    rowsAfterTimezoneHandling: 2,
    rowsRemovedByTimezone: 0,
    duplicateTimestampsCorrected: 0,
    exactDuplicateRowsRemoved: 0,
    inputSha256: "abc123",
  };
}

beforeEach(async () => {
  await clearLastRun();
});

describe("lastRunStore", () => {
  it("round-trips processed results with output blobs", async () => {
    await saveLastRun({
      options: { ...DEFAULT_BROWSER_OPTIONS, studyName: "Study A" },
      results: [result()],
      discoveredTimezones: ["America/Chicago"],
      savedAt: "2026-06-05T00:00:00Z",
    });

    const loaded = await loadLastRun();
    expect(loaded?.options.studyName).toBe("Study A");
    expect(loaded?.results[0]?.inputFileName).toBe("Raw P01.csv");
    expect(await loaded!.results[0]!.outputs[0]!.blob.text()).toBe("a,b\n1,2\n");
    expect(loaded?.discoveredTimezones).toEqual(["America/Chicago"]);
  });

  it("clears the cached run", async () => {
    await saveLastRun({
      options: DEFAULT_BROWSER_OPTIONS,
      results: [result()],
      discoveredTimezones: [],
    });
    await clearLastRun();
    expect(await loadLastRun()).toBeUndefined();
  });
});
