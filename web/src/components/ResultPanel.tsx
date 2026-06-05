import { useMemo } from "react";
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
import { safeUuid } from "@/lib/uuid";
import { InteractiveTimeline } from "@/components/InteractiveTimeline";
import type { FileProgress } from "@/components/ProgressList";

type Props = {
  results: ProcessedFileResult[];
  error: string | null;
  options: BrowserProcessingOptions;
  expectedFileCount: number;
  progressRows: FileProgress[];
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

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

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
): string[] {
  const warnings: string[] = [];
  if (!result.outputs.length) {
    warnings.push("No downloadable outputs.");
  }
  if (result.originalRowCount === 0) {
    warnings.push("Zero input rows after parsing.");
  }
  if (result.processedRowCount === 0) {
    warnings.push("Zero rows after timezone/filter/session processing.");
  }
  if (options.processAppUsage && result.appRowCount === 0) {
    warnings.push("Zero app-usage rows.");
  }
  if (options.processScreenUsage && result.screenRowCount === 0) {
    warnings.push("Zero screen-usage rows.");
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
      warnings.push(`${output.outputFileName} contains zero data rows.`);
    }
    if (output.blob.size === 0) {
      warnings.push(`${output.outputFileName} is an empty file.`);
    }
  });
  return warnings;
}

function buildBatchWarnings(input: {
  results: ProcessedFileResult[];
  error: string | null;
  expectedFileCount: number;
  progressRows: FileProgress[];
}): string[] {
  const { results, error, expectedFileCount, progressRows } = input;
  const warnings: string[] = [];
  if (error) {
    warnings.push(error);
  }
  const failedRows = progressRows.filter((row) => row.status === "error");
  failedRows.forEach((row) => {
    warnings.push(`${row.fileName} failed: ${row.error ?? "Unknown processing error"}`);
  });
  if (expectedFileCount > 0 && results.length < expectedFileCount) {
    warnings.push(`Only ${results.length}/${expectedFileCount} selected files produced results.`);
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
  const plotOutputs = useMemo(() => collectOutputs(results, "plot"), [results]);
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
    () => buildBatchWarnings({ results, error, expectedFileCount, progressRows }),
    [results, error, expectedFileCount, progressRows],
  );
  const progressByFile = useMemo(() => {
    const map = new Map<string, FileProgress>();
    progressRows.forEach((row) => map.set(row.fileName, row));
    return map;
  }, [progressRows]);

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
        </div>
      </header>
      {error ? <p className="error-text u-mb-3">{error}</p> : null}
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

      <div className="result-summary-grid">
        <Stat label="Original rows" value={summary.originalRows} />
        <Stat label="Processed rows" value={summary.processedRows} />
        {showAppColumns ? <Stat label="App rows" value={summary.appRows} /> : null}
        {showScreenColumns ? <Stat label="Screen rows" value={summary.screenRows} /> : null}
      </div>

      <div className="result-file-cards" data-testid="result-file-table">
        {results.map((result) => {
          const progress = progressByFile.get(result.inputFileName);
          const failed = progress?.status === "error";
          const fileWarnings = buildPerFileWarnings(result, options);
          const tzAction = TIMEZONE_ACTION_LABEL[result.timezoneAction];
          const tzActionDetail =
            result.timezoneAction === "none"
              ? ""
              : `${result.rowsBeforeTimezoneHandling.toLocaleString()} → ${result.rowsAfterTimezoneHandling.toLocaleString()} rows, ${result.rowsRemovedByTimezone.toLocaleString()} removed`;
          const statusLabel = failed ? "Failed" : fileWarnings.length ? "Review" : "Success";
          return (
            <article
              key={result.inputFileName}
              className="result-card"
              data-testid="result-row"
            >
              <header className="result-card__head">
                <span className="result-card__name" title={result.inputFileName}>
                  {result.inputFileName}
                </span>
                <span
                  className={`status-pill ${failed || fileWarnings.length ? "is-warning" : "is-success"}`}
                >
                  {statusLabel}
                  {fileWarnings.length ? ` · ${fileWarnings.length}` : ""}
                </span>
              </header>

              <dl className="result-card__stats">
                <CardStat label="Input" value={result.originalRowCount} />
                <CardStat label="Processed" value={result.processedRowCount} />
                {showAppColumns ? <CardStat label="App" value={result.appRowCount} /> : null}
                {showScreenColumns ? <CardStat label="Screen" value={result.screenRowCount} /> : null}
              </dl>

              <div className="result-card__row">
                <span className="result-card__row-label">Timezone</span>
                <span className="result-card__row-body">
                  <span className="result-card__tz-final">{result.timezone || "—"}</span>
                  {result.availableTimezones.length > 1 ? (
                    <span className="result-card__chips">
                      {result.availableTimezones.map((zone) => (
                        <span className="chip" key={zone}>
                          {zone}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="result-card__notes">
                    {tzAction}
                    {tzActionDetail ? ` · ${tzActionDetail}` : ""}
                    {result.duplicateTimestampsCorrected > 0
                      ? ` · ${result.duplicateTimestampsCorrected.toLocaleString()} duplicate timestamps corrected`
                      : ""}
                    {result.exactDuplicateRowsRemoved > 0
                      ? ` · ${result.exactDuplicateRowsRemoved.toLocaleString()} duplicate rows collapsed`
                      : ""}
                  </span>
                </span>
              </div>

              <div className="result-card__row">
                <span className="result-card__row-label">Outputs</span>
                <span className="result-card__row-body">
                  {result.outputs.length ? (
                    <span className="result-card__chips">
                      {result.outputs.map((output) => (
                        <span
                          className="chip chip--output"
                          key={output.outputFileName}
                          title={output.outputFileName}
                        >
                          {OUTPUT_KIND_LABEL[output.kind] ?? output.kind}
                          {output.kind !== "plot"
                            ? ` · ${output.rowCount.toLocaleString()} rows`
                            : ""}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-faint">No outputs</span>
                  )}
                </span>
              </div>

              {fileWarnings.length ? (
                <ul className="result-card__warnings">
                  {fileWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
      </div>

      {results
        .filter((result) => result.timelineData && result.timelineData.sessions.length > 0)
        .map((result) => (
          <div className="result-timeline" key={`timeline-${result.inputFileName}`}>
            <h3 className="result-timeline__heading">{result.inputFileName}</h3>
            <InteractiveTimeline data={result.timelineData!} />
          </div>
        ))}
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

function CardStat({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="result-card__stat">
      <dt>{label}</dt>
      <dd>{value.toLocaleString()}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="stat-block">
      <div className="stat-block__label">{label}</div>
      <div className="stat-block__value">{value.toLocaleString()}</div>
    </div>
  );
}
