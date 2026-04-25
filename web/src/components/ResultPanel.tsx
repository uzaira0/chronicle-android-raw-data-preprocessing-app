import { useMemo, useState } from "react";
import type { ReactElement } from "react";

import { createZipBlob } from "@/lib/zip";
import type { OutputKind } from "@/lib/generatedContract";
import type { ProcessedFileResult, ProcessedOutputFileResult } from "@/lib/types";

type Props = {
  results: ProcessedFileResult[];
  error: string | null;
};

type BatchOutput = {
  inputFileName: string;
  output: ProcessedOutputFileResult;
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
    kind === "all" ? "all-outputs" : kind === "app" ? "app-usage-outputs" : "screen-usage-outputs";
  return `chronicle-${suffix}.zip`;
}

async function downloadZip(kind: "all" | OutputKind, outputs: BatchOutput[]): Promise<void> {
  const zip = await createZipBlob(
    outputs.map(({ output }) => ({
      fileName: output.outputFileName,
      blob: output.blob,
    })),
  );
  downloadBlob(zipName(kind), zip);
}

export function ResultPanel({ results, error }: Props): ReactElement | null {
  const [previewKind, setPreviewKind] = useState<OutputKind>("app");
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
  const previewedOutput =
    (previewKind === "app" ? appOutputs[0]?.output : screenOutputs[0]?.output) ??
    appOutputs[0]?.output ??
    screenOutputs[0]?.output ??
    null;
  const previewRows = previewedOutput?.previewRows ?? null;

  if (error && !results.length) {
    return (
      <div className="result-panel">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!results.length) return null;

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
              void downloadZip("all", allOutputs);
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
              void downloadZip("app", appOutputs);
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
              void downloadZip("screen", screenOutputs);
            }}
            disabled={!screenOutputs.length}
          >
            Screen ZIP
          </button>
        </div>
      </header>
      {error ? <p className="error-text u-mb-3">{error}</p> : null}

      <div className="result-summary-grid">
        <Stat label="Original rows" value={summary.originalRows} />
        <Stat label="Processed rows" value={summary.processedRows} />
        <Stat label="App rows" value={summary.appRows} />
        <Stat label="Screen rows" value={summary.screenRows} />
      </div>

      <details className="result-details">
        <summary>File counts</summary>
        <div className="result-file-table-wrap">
          <table className="result-file-table">
            <thead>
              <tr>
                <th>Input file</th>
                <th>Timezone</th>
                <th>Original</th>
                <th>Processed</th>
                <th>App</th>
                <th>Screen</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.inputFileName}>
                  <td>{result.inputFileName}</td>
                  <td>{result.timezone || "-"}</td>
                  <td>{result.originalRowCount.toLocaleString()}</td>
                  <td>{result.processedRowCount.toLocaleString()}</td>
                  <td>{result.appRowCount.toLocaleString()}</td>
                  <td>{result.screenRowCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {previewRows ? (
        <div className="result-preview" data-testid="result-card">
          <div className="result-preview__header">
            <h3 className="result-preview__title">Preview</h3>
            <div className="button-row">
              <button
                type="button"
                className={`btn ${previewKind === "app" ? "btn--primary" : "btn--ghost"}`}
                onClick={() => setPreviewKind("app")}
                disabled={!appOutputs.length}
              >
                App
              </button>
              <button
                type="button"
                className={`btn ${previewKind === "screen" ? "btn--primary" : "btn--ghost"}`}
                onClick={() => setPreviewKind("screen")}
                disabled={!screenOutputs.length}
              >
                Screen
              </button>
            </div>
          </div>
          <div className="preview-table-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  {(previewRows[0] ?? []).map((cell, index) => (
                    <th key={index}>{cell}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(1).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
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
