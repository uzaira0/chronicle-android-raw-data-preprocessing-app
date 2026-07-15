import { useMemo, useState } from "react";
import type { ReactElement } from "react";

import { createZipBlob } from "@/lib/zip";
import type { OutputKind } from "@/lib/generatedContract";
import type {
  BrowserProcessingOptions,
  ProcessedFileResult,
  ProcessedOutputFileResult,
  TimezoneAction,
} from "@/lib/types";
import { PREPROCESSOR_VERSION } from "@/lib/browserPipeline";
import { buildProcessingReport, readReportEnvironment } from "@/lib/processingReport";
import { downloadBlob } from "@/lib/download";
import { safeUuid } from "@/lib/uuid";
import type { FileProgress } from "@/components/ProgressList";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";

/** Timeline-viewer exports ride on the "plot" kind but are HTML, not images. */
const TIMELINE_VIEWER_SUFFIX = "Timeline Viewer.html";
const isTimelineViewer = (output: ProcessedOutputFileResult): boolean =>
  output.outputFileName.endsWith(TIMELINE_VIEWER_SUFFIX);

type Props = {
  results: ProcessedFileResult[];
  error: string | null;
  options: BrowserProcessingOptions;
  expectedFileCount: number;
  progressRows: FileProgress[];
  displayMasker: DemoDisplayMasker;
  /** True when the current settings differ from the ones that produced these
   * results — surfaces an "out of date, re-run" banner. */
  stale?: boolean;
  /** Delete the results (and the persisted last-run cache backing them). */
  onDelete?: () => void;
};

type BatchOutput = {
  inputFileName: string;
  output: ProcessedOutputFileResult;
};

const TIMEZONE_ACTION_LABEL: Record<TimezoneAction, string> = {
  none: "No action",
  filtered_to_selected: "Filtered to selected",
  converted_to_selected: "Converted to selected",
  filtered_to_primary: "Filtered to primary",
  converted_to_primary: "Converted to primary",
};

function collectOutputs(results: ProcessedFileResult[], kind?: OutputKind): BatchOutput[] {
  return results.flatMap((result) =>
    result.outputs
      .filter((output) => !kind || output.kind === kind)
      .map((output) => ({ inputFileName: result.inputFileName, output })),
  );
}

function zipName(kind: "all" | OutputKind): string {
  const suffix =
    kind === "all" ? "all-outputs"
    : kind === "app" ? "app-usage-outputs"
    : kind === "screen" ? "screen-usage-outputs"
    : kind === "aggregate" ? "aggregate-summaries"
    : kind === "parquet" ? "parquet-files"
    : kind === "spss" ? "spss-files"
    : "plots";
  return `chronicle-${suffix}.zip`;
}

function buildPerFileWarnings(
  result: ProcessedFileResult,
  options: BrowserProcessingOptions,
  displayMasker: DemoDisplayMasker,
): string[] {
  const warnings: string[] = [];
  // A restored-from-cache result intentionally has no artifacts; the counts are
  // still meaningful, so skip the output-presence/empty-file checks for it.
  if (!result.restoredWithoutArtifacts && !result.outputs.length) {
    warnings.push("No downloadable outputs.");
  }
  if (result.originalRowCount === 0) {
    warnings.push("Zero input rows after parsing.");
  }
  if (result.processedRowCount === 0) {
    warnings.push("Zero rows after timezone/filter/session processing.");
  }
  if (options.processAppUsage && result.appRowCount === 0) {
    warnings.push("Zero app usage rows.");
  }
  if (options.processScreenUsage && result.screenRowCount === 0) {
    warnings.push("Zero screen usage rows.");
  }
  (result.configNotices ?? []).forEach((notice) => {
    warnings.push(notice);
  });
  if (result.restoredWithoutArtifacts) {
    return warnings;
  }
  result.outputs.forEach((output) => {
    // Plots are PNG charts (no rows); aggregate files can be legitimately empty
    // (e.g. a co-usage edge list with no overlaps); a Parquet twin mirrors its
    // CSV (whose zero-row case is already flagged). Only flag zero rows for the
    // primary app/screen CSV outputs.
    if (
      output.rowCount === 0 &&
      output.kind !== "plot" &&
      output.kind !== "aggregate" &&
      output.kind !== "parquet" &&
      output.kind !== "spss"
    ) {
      warnings.push(`${displayMasker.fileName(output.outputFileName)} contains zero data rows.`);
    }
    if (output.blob.size === 0) {
      warnings.push(`${displayMasker.fileName(output.outputFileName)} is an empty file.`);
    }
  });
  return warnings;
}

function buildBatchWarnings(input: {
  results: ProcessedFileResult[];
  error: string | null;
  displayMasker: DemoDisplayMasker;
  expectedFileCount: number;
  progressRows: FileProgress[];
}): string[] {
  const { results, error, displayMasker, expectedFileCount, progressRows } = input;
  const warnings: string[] = [];
  if (error) {
    warnings.push(error);
  }
  const failedRows = progressRows.filter((row) => row.status === "error");
  failedRows.forEach((row) => {
    warnings.push(
      `${displayMasker.fileName(row.fileName)} failed: ${row.error ?? "Unknown processing error"}`,
    );
  });
  // Files the user deliberately cancelled aren't a shortfall — exclude them from
  // the "only N/M produced results" check so a cancel doesn't read as a failure.
  const cancelledCount = progressRows.filter((row) => row.status === "cancelled").length;
  const expectedProduced = expectedFileCount - cancelledCount;
  if (expectedProduced > 0 && results.length < expectedProduced) {
    warnings.push(`Only ${results.length}/${expectedProduced} selected files produced results.`);
  }
  return warnings;
}

async function downloadZip(
  kind: "all" | OutputKind,
  outputs: BatchOutput[],
  reportText: string,
): Promise<void> {
  const zip = await createZipBlob([
    ...outputs.map(({ output }) => ({
      fileName: output.outputFileName,
      blob: output.blob,
    })),
    {
      fileName: "chronicle-processing-report.json",
      blob: new Blob([reportText], { type: "application/json" }),
    },
  ]);
  downloadBlob(zipName(kind), zip);
}

export function ResultPanel({
  results,
  error,
  options,
  expectedFileCount,
  progressRows,
  displayMasker,
  stale = false,
  onDelete,
}: Props): ReactElement | null {
  const summary = useMemo(() => {
    return results.reduce(
      (totals, result) => ({
        files: totals.files + 1,
        originalRows: totals.originalRows + result.originalRowCount,
        processedRows: totals.processedRows + result.processedRowCount,
        appRows: totals.appRows + result.appRowCount,
        screenRows: totals.screenRows + result.screenRowCount,
      }),
      { files: 0, originalRows: 0, processedRows: 0, appRows: 0, screenRows: 0 },
    );
  }, [results]);

  const allOutputs = useMemo(() => collectOutputs(results), [results]);
  const appOutputs = useMemo(() => collectOutputs(results, "app"), [results]);
  const screenOutputs = useMemo(() => collectOutputs(results, "screen"), [results]);
  // The timeline viewer is emitted as a "plot" output but is a standalone HTML
  // file — split it out so it gets its own download and isn't bundled into the
  // image "Plots ZIP".
  const plotOutputs = useMemo(
    () => collectOutputs(results, "plot").filter((entry) => !isTimelineViewer(entry.output)),
    [results],
  );
  const timelineOutputs = useMemo(
    () => collectOutputs(results, "plot").filter((entry) => isTimelineViewer(entry.output)),
    [results],
  );
  const aggregateOutputs = useMemo(() => collectOutputs(results, "aggregate"), [results]);
  const parquetOutputs = useMemo(() => collectOutputs(results, "parquet"), [results]);
  const spssOutputs = useMemo(() => collectOutputs(results, "spss"), [results]);
  // Provenance identifies the run that produced `results`, so it must stay stable
  // when the user edits options after a run — otherwise two downloads of the same
  // run carry different runId/generatedAt. Key it on `results` only.
  const provenance = useMemo(
    () => ({ runId: safeUuid(), generatedAt: new Date().toISOString() }),
    [results],
  );
  const reportText = useMemo(
    () =>
      buildProcessingReport({
        results,
        options,
        preprocessorVersion: PREPROCESSOR_VERSION,
        generatedAt: provenance.generatedAt,
        runId: provenance.runId,
        environment: readReportEnvironment(),
      }),
    [results, options, provenance],
  );
  const batchWarnings = useMemo(
    () => buildBatchWarnings({ results, error, expectedFileCount, progressRows, displayMasker }),
    [results, error, expectedFileCount, progressRows, displayMasker],
  );
  const progressByFile = useMemo(() => {
    const map = new Map<string, FileProgress>();
    progressRows.forEach((row) => map.set(row.fileName, row));
    return map;
  }, [progressRows]);
  const [detailsOpen, setDetailsOpen] = useState(true);

  if (error && !results.length) {
    return (
      <div className="result-panel">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!results.length) return null;

  const showAppColumns = options.processAppUsage;
  const showScreenColumns = options.processScreenUsage;
  const restoredLightweight = results.some((result) => result.restoredWithoutArtifacts);

  return (
    <section className="result-panel" aria-label="Processing results" data-testid="result-panel">
      <header className="result-panel__header">
        <div>
          <h2 className="result-panel__title">Results</h2>
          <span className="result-panel__summary">
            {summary.files} {summary.files === 1 ? "file" : "files"} processed ·{" "}
            {allOutputs.length} output {allOutputs.length === 1 ? "file" : "files"}
          </span>
        </div>
        <div className="result-panel__actions">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="download-all-zip"
            onClick={() => {
              void downloadZip("all", allOutputs, reportText);
            }}
            disabled={!allOutputs.length}
          >
            Download all ZIP
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="download-app-csv"
            onClick={() => {
              void downloadZip("app", appOutputs, reportText);
            }}
            disabled={!appOutputs.length}
          >
            App ZIP
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="download-screen-csv"
            onClick={() => {
              void downloadZip("screen", screenOutputs, reportText);
            }}
            disabled={!screenOutputs.length}
          >
            Screen ZIP
          </button>
          {plotOutputs.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="download-plots-zip"
              onClick={() => {
                void downloadZip("plot", plotOutputs, reportText);
              }}
            >
              Plots ZIP ({plotOutputs.length})
            </button>
          )}
          {timelineOutputs.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="download-timeline-viewer"
              onClick={() => {
                timelineOutputs.forEach(({ output }) =>
                  downloadBlob(output.outputFileName, output.blob),
                );
              }}
            >
              Timeline viewer ({timelineOutputs.length})
            </button>
          )}
          {aggregateOutputs.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="download-aggregates-zip"
              onClick={() => {
                void downloadZip("aggregate", aggregateOutputs, reportText);
              }}
            >
              Aggregates ZIP ({aggregateOutputs.length})
            </button>
          )}
          {parquetOutputs.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="download-parquet-zip"
              onClick={() => {
                void downloadZip("parquet", parquetOutputs, reportText);
              }}
            >
              Parquet ZIP ({parquetOutputs.length})
            </button>
          )}
          {spssOutputs.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="download-spss-zip"
              onClick={() => {
                void downloadZip("spss", spssOutputs, reportText);
              }}
            >
              SPSS ZIP ({spssOutputs.length})
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(reportText);
            }}
          >
            Copy report
          </button>
          {onDelete ? (
            <button
              type="button"
              className="btn btn--ghost"
              data-testid="delete-results"
              title="Remove these results and the saved copy that would restore them on the next visit."
              onClick={onDelete}
            >
              Delete results
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p className="error-text u-mb-3">{error}</p> : null}
      {stale ? (
        <p className="result-stale-note" data-testid="results-stale-note" role="status">
          Settings have changed since these results were generated. Re-process the files to
          bring the outputs in line with your current settings.
        </p>
      ) : null}
      {restoredLightweight ? (
        <p className="result-restored-note" data-testid="restored-lightweight-note" role="status">
          Restored a summary of your last run. Downloads and the interactive timeline aren’t kept
          across a refresh to save memory — re-process the files to regenerate them.
        </p>
      ) : null}
      {batchWarnings.length ? (
        <div className="result-warnings" role="alert">
          <strong>{batchWarnings.length} warning{batchWarnings.length === 1 ? "" : "s"}</strong>
          <ul>
            {batchWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        className="result-collapse"
        data-testid="results-collapse-toggle"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        {detailsOpen ? "▾ Hide results details" : "▸ Show results details"}
      </button>

      {detailsOpen ? (
        <>
          <div className="result-summary-grid">
            <Stat label="Original rows" value={summary.originalRows} />
            <Stat label="Processed rows" value={summary.processedRows} />
            {showAppColumns ? <Stat label="App rows" value={summary.appRows} /> : null}
            {showScreenColumns ? <Stat label="Screen rows" value={summary.screenRows} /> : null}
          </div>

          <div className="result-table-wrap">
            <table className="result-table" data-testid="result-file-table">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Status</th>
                  <th scope="col">Input</th>
                  <th scope="col">Processed</th>
                  {showAppColumns ? <th scope="col">App</th> : null}
                  {showScreenColumns ? <th scope="col">Screen</th> : null}
                  <th scope="col">Timezone</th>
                  <th scope="col">Outputs</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => {
                  const progress = progressByFile.get(result.inputFileName);
                  const failed = progress?.status === "error";
                  const fileWarnings = buildPerFileWarnings(result, options, displayMasker);
                  const statusLabel = failed
                    ? "Failed"
                    : fileWarnings.length
                      ? "Review"
                      : "Success";
                  const tzTitle = buildTimezoneTitle(result, displayMasker);
                  const maskedFileName = displayMasker.fileName(result.inputFileName);
                  const outputCounts = summarizeOutputs(result.outputs);
                  return (
                    <tr key={result.inputFileName} data-testid="result-row">
                      <td className="result-table__file" title={maskedFileName}>
                        {maskedFileName}
                      </td>
                      <td>
                        <span
                          className={`status-pill ${failed || fileWarnings.length ? "is-warning" : "is-success"}`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="result-table__num">
                        {result.originalRowCount.toLocaleString()}
                      </td>
                      <td className="result-table__num">
                        {result.processedRowCount.toLocaleString()}
                      </td>
                      {showAppColumns ? (
                        <td className="result-table__num">
                          {result.appRowCount.toLocaleString()}
                        </td>
                      ) : null}
                      {showScreenColumns ? (
                        <td className="result-table__num">
                          {result.screenRowCount.toLocaleString()}
                        </td>
                      ) : null}
                      <td className="result-table__tz" title={tzTitle}>
                        {result.timezone ? displayMasker.timezone(result.timezone) : "—"}
                      </td>
                      <td className="result-table__outputs">
                        {outputCounts.length ? (
                          <span className="result-table__chips">
                            {outputCounts.map((entry) => (
                              <span className="chip chip--output" key={entry.label}>
                                {entry.label}
                                {entry.count > 1 ? ` ×${entry.count}` : ""}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-faint">No outputs</span>
                        )}
                        {!result.restoredWithoutArtifacts && result.outputs.length ? (
                          <ul className="result-table__downloads" aria-label="Download individual outputs">
                            {result.outputs.map((output) => (
                              <li key={output.outputFileName}>
                                <button
                                  type="button"
                                  className="result-download-link"
                                  data-testid="download-single-output"
                                  title={`Download ${displayMasker.fileName(output.outputFileName)}`}
                                  onClick={() => downloadBlob(output.outputFileName, output.blob)}
                                >
                                  ⬇ {outputLabel(output)}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {fileWarnings.length ? (
                          <ul className="result-table__warnings" aria-label="Warnings">
                            {fileWarnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

const OUTPUT_KIND_LABEL: Record<string, string> = {
  app: "App CSV",
  screen: "Screen CSV",
  plot: "Plot",
  aggregate: "Aggregate CSV",
  parquet: "Parquet",
  spss: "SPSS .sav",
};

/** Human label for one output, distinguishing the HTML timeline viewer from plots. */
function outputLabel(output: ProcessedOutputFileResult): string {
  if (isTimelineViewer(output)) return "Timeline HTML";
  return OUTPUT_KIND_LABEL[output.kind] ?? output.kind;
}

/** Collapse a file's outputs into distinct labels with counts, preserving order. */
function summarizeOutputs(
  outputs: ProcessedOutputFileResult[],
): { label: string; count: number }[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const output of outputs) {
    const label = outputLabel(output);
    if (!counts.has(label)) order.push(label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return order.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

/** Tooltip text for the timezone cell: action taken plus any cleanup counts. */
function buildTimezoneTitle(
  result: ProcessedFileResult,
  displayMasker: DemoDisplayMasker,
): string {
  const parts: string[] = [TIMEZONE_ACTION_LABEL[result.timezoneAction]];
  if (result.timezoneAction !== "none") {
    parts.push(
      `${result.rowsBeforeTimezoneHandling.toLocaleString()} → ${result.rowsAfterTimezoneHandling.toLocaleString()} rows, ${result.rowsRemovedByTimezone.toLocaleString()} removed`,
    );
  }
  if (result.availableTimezones.length > 1) {
    parts.push(`timezones seen: ${result.availableTimezones.map(displayMasker.timezone).join(", ")}`);
  }
  if (result.duplicateTimestampsCorrected > 0) {
    parts.push(`${result.duplicateTimestampsCorrected.toLocaleString()} duplicate timestamps corrected`);
  }
  if (result.exactDuplicateRowsRemoved > 0) {
    parts.push(`${result.exactDuplicateRowsRemoved.toLocaleString()} duplicate rows collapsed`);
  }
  return parts.join(" · ");
}

function Stat({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="stat-block">
      <div className="stat-block__label">{label}</div>
      <div className="stat-block__value">{value.toLocaleString()}</div>
    </div>
  );
}
