import type { BrowserProcessingOptions, ProcessedFileResult } from "@/lib/types";

/**
 * Environment provenance captured at report time (main-thread values). All
 * fields optional so the builder stays pure and testable with fixed inputs.
 */
export type ReportEnvironment = {
  userAgent?: string;
  hardwareConcurrency?: number;
  timeZone?: string;
  language?: string;
};

export type ProcessingReportInput = {
  results: ProcessedFileResult[];
  options: BrowserProcessingOptions;
  preprocessorVersion: string;
  /** ISO timestamp; injected so the report is deterministic in tests. */
  generatedAt: string;
  /** Unique id for this processing run (provenance / audit trail). */
  runId: string;
  environment: ReportEnvironment;
};

/**
 * The run-manifest provenance sidecar (`chronicle-processing-report.json`)
 * bundled into every output ZIP. Records the preprocessor version, the full
 * settings, the runtime environment, and per-file provenance including the
 * SHA-256 of each raw input so a run can be audited and reproduced.
 *
 * Pure: takes every non-deterministic value (timestamp, runId, environment)
 * as input rather than reading globals, so it is unit-testable.
 */
export function buildProcessingReportObject(input: ProcessingReportInput): {
  runId: string;
  generatedAt: string;
  preprocessorVersion: string;
  environment: ReportEnvironment;
  options: BrowserProcessingOptions;
  files: Array<Record<string, unknown>>;
} {
  const { results, options, preprocessorVersion, generatedAt, runId, environment } = input;
  return {
    runId,
    generatedAt,
    preprocessorVersion,
    environment,
    options,
    files: results.map((result) => ({
      inputFileName: result.inputFileName,
      inputSha256: result.inputSha256 ?? null,
      timezone: result.timezone,
      availableTimezones: result.availableTimezones,
      originalRowCount: result.originalRowCount,
      processedRowCount: result.processedRowCount,
      appRowCount: result.appRowCount,
      screenRowCount: result.screenRowCount,
      timezoneAction: result.timezoneAction,
      rowsBeforeTimezoneHandling: result.rowsBeforeTimezoneHandling,
      rowsAfterTimezoneHandling: result.rowsAfterTimezoneHandling,
      rowsRemovedByTimezone: result.rowsRemovedByTimezone,
      duplicateTimestampsCorrected: result.duplicateTimestampsCorrected,
      exactDuplicateRowsRemoved: result.exactDuplicateRowsRemoved,
      outputs: result.outputs.map((output) => ({
        kind: output.kind,
        outputFileName: output.outputFileName,
        rowCount: output.rowCount,
      })),
    })),
  };
}

/** Pretty-printed JSON string of {@link buildProcessingReportObject}. */
export function buildProcessingReport(input: ProcessingReportInput): string {
  return JSON.stringify(buildProcessingReportObject(input), null, 2);
}

/** Read the current browser environment for the report (main thread only). */
export function readReportEnvironment(): ReportEnvironment {
  const nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator;
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return {
    userAgent: nav?.userAgent,
    hardwareConcurrency: nav?.hardwareConcurrency,
    language: nav?.language,
    timeZone,
  };
}
