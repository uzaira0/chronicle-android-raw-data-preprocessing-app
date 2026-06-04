import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  buildProcessingReport,
  buildProcessingReportObject,
  type ProcessingReportInput,
} from "@/lib/processingReport";
import type { ProcessedFileResult } from "@/lib/types";

function makeResult(overrides: Partial<ProcessedFileResult> = {}): ProcessedFileResult {
  return {
    inputFileName: "Raw P001.csv",
    outputs: [
      {
        kind: "app",
        outputFileName: "Raw P001 App Usage.csv",
        blob: new Blob(["x"]),
        rowCount: 12,
        previewRows: [],
      },
    ],
    originalRowCount: 100,
    processedRowCount: 90,
    availableTimezones: ["America/Chicago"],
    timezone: "America/Chicago",
    appRowCount: 12,
    screenRowCount: 0,
    timezoneAction: "none",
    rowsBeforeTimezoneHandling: 100,
    rowsAfterTimezoneHandling: 100,
    rowsRemovedByTimezone: 0,
    duplicateTimestampsCorrected: 0,
    exactDuplicateRowsRemoved: 0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ProcessingReportInput> = {}): ProcessingReportInput {
  return {
    results: [makeResult({ inputSha256: "abc123" })],
    options: DEFAULT_BROWSER_OPTIONS,
    preprocessorVersion: "9.9.9",
    generatedAt: "2026-04-24T00:32:53.000Z",
    runId: "run-fixed-id",
    environment: { userAgent: "test-agent", hardwareConcurrency: 8, timeZone: "UTC", language: "en" },
    ...overrides,
  };
}

describe("buildProcessingReportObject", () => {
  it("records run-level provenance (runId, version, timestamp, environment)", () => {
    const report = buildProcessingReportObject(makeInput());
    expect(report.runId).toBe("run-fixed-id");
    expect(report.preprocessorVersion).toBe("9.9.9");
    expect(report.generatedAt).toBe("2026-04-24T00:32:53.000Z");
    expect(report.environment).toEqual({
      userAgent: "test-agent",
      hardwareConcurrency: 8,
      timeZone: "UTC",
      language: "en",
    });
  });

  it("includes the per-file input SHA-256 when present", () => {
    const report = buildProcessingReportObject(makeInput());
    expect(report.files).toHaveLength(1);
    expect(report.files[0]?.inputSha256).toBe("abc123");
    expect(report.files[0]?.inputFileName).toBe("Raw P001.csv");
  });

  it("emits null for a missing hash rather than dropping the field", () => {
    const report = buildProcessingReportObject(
      makeInput({ results: [makeResult({ inputSha256: undefined })] }),
    );
    expect(report.files[0]).toHaveProperty("inputSha256", null);
  });

  it("maps each output's kind/name/rowCount", () => {
    const report = buildProcessingReportObject(makeInput());
    expect(report.files[0]?.outputs).toEqual([
      { kind: "app", outputFileName: "Raw P001 App Usage.csv", rowCount: 12 },
    ]);
  });

  it("is deterministic given fixed inputs (no Date.now/random/global reads)", () => {
    const a = buildProcessingReport(makeInput());
    const b = buildProcessingReport(makeInput());
    expect(a).toBe(b);
    expect(JSON.parse(a)).toMatchObject({ runId: "run-fixed-id", preprocessorVersion: "9.9.9" });
  });
});
