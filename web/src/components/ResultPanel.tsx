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
    : "plots";
  return `chronicle-${suffix}.zip`;
}

function buildProcessingReport(
  results: ProcessedFileResult[],
  options: BrowserProcessingOptions,
): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      preprocessorVersion: PREPROCESSOR_VERSION,
      options,
      files: results.map((result) => ({
        inputFileName: result.inputFileName,
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
        outputs: result.outputs.map((output) => ({
          kind: output.kind,
          outputFileName: output.outputFileName,
          rowCount: output.rowCount,
        })),
      })),
    },
    null,
    2,
  );
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
    if (output.rowCount === 0) {
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
  const reportText = useMemo(() => buildProcessingReport(results, options), [results, options]);
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

      <div className="result-file-table-wrap">
        <table className="result-file-table" data-testid="result-file-table">
          <thead>
            <tr>
              <th scope="col">Input file</th>
              <th scope="col">Status</th>
              <th scope="col">Input rows</th>
              <th scope="col">Processed rows</th>
              {showAppColumns ? <th scope="col">App rows</th> : null}
              {showScreenColumns ? <th scope="col">Screen rows</th> : null}
              <th scope="col">Input timezones</th>
              <th scope="col">Timezone action</th>
              <th scope="col">Final timezone</th>
              <th scope="col">Duplicate timestamps corrected</th>
              <th scope="col">Warnings</th>
              <th scope="col">Outputs</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => {
              const progress = progressByFile.get(result.inputFileName);
              const failed = progress?.status === "error";
              const fileWarnings = buildPerFileWarnings(result, options);
              const tzAction = TIMEZONE_ACTION_LABEL[result.timezoneAction];
              const tzActionDetail =
                result.timezoneAction === "none"
                  ? ""
                  : ` (${result.rowsBeforeTimezoneHandling.toLocaleString()} → ${result.rowsAfterTimezoneHandling.toLocaleString()}, removed ${result.rowsRemovedByTimezone.toLocaleString()})`;
              return (
                <tr key={result.inputFileName} data-testid="result-row">
                  <td>{result.inputFileName}</td>
                  <td>
                    <span
                      className={`status-pill ${failed ? "is-warning" : fileWarnings.length ? "is-warning" : "is-success"}`}
                    >
                      {failed ? "Failed" : fileWarnings.length ? "Review" : "Success"}
                    </span>
                  </td>
                  <td>{result.originalRowCount.toLocaleString()}</td>
                  <td>{result.processedRowCount.toLocaleString()}</td>
                  {showAppColumns ? <td>{result.appRowCount.toLocaleString()}</td> : null}
                  {showScreenColumns ? <td>{result.screenRowCount.toLocaleString()}</td> : null}
                  <td>
                    {result.availableTimezones.length ? (
                      <ul className="result-file-table__timezones">
                        {result.availableTimezones.map((zone) => (
                          <li key={zone}>{zone}</li>
                        ))}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {tzAction}
                    {tzActionDetail ? (
                      <span className="text-faint u-meta-xs">{tzActionDetail}</span>
                    ) : null}
                  </td>
                  <td>{result.timezone || "—"}</td>
                  <td>{result.duplicateTimestampsCorrected.toLocaleString()}</td>
                  <td>
                    {fileWarnings.length ? (
                      <ul className="result-file-table__warnings">
                        {fileWarnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {result.outputs.length ? (
                      <ul className="result-file-table__outputs">
                        {result.outputs.map((output) => (
                          <li key={output.outputFileName}>
                            <code>{output.outputFileName}</code>
                            <span className="text-faint u-meta-xs">
                              {" "}
                              · {output.rowCount.toLocaleString()} rows
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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
