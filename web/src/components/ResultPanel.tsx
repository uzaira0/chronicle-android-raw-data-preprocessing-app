import { useMemo, useState } from "react";
import type { ReactElement } from "react";

import Papa from "papaparse";
import type { ProcessedFileResult } from "@/lib/types";

type Props = {
  results: ProcessedFileResult[];
  error: string | null;
};

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ResultPanel({ results, error }: Props): ReactElement | null {
  const summary = useMemo(() => {
    return results.reduce(
      (totals, result) => ({
        files: totals.files + 1,
        appRows: totals.appRows + result.appRowCount,
        screenRows: totals.screenRows + result.screenRowCount,
      }),
      { files: 0, appRows: 0, screenRows: 0 },
    );
  }, [results]);

  if (error && !results.length) {
    return (
      <div className="result-panel">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!results.length) return null;

  return (
    <section className="result-panel" aria-label="Processing results">
      <header className="result-panel__header">
        <h2 className="result-panel__title">Results</h2>
        <span className="result-panel__summary">
          {summary.files} {summary.files === 1 ? "file" : "files"} · {summary.appRows.toLocaleString()} app rows ·{" "}
          {summary.screenRows.toLocaleString()} screen rows
        </span>
      </header>
      {error ? <p className="error-text u-mb-3">{error}</p> : null}
      <div className="results-grid">
        {results.map((result) => (
          <ResultCard key={result.inputFileName} result={result} />
        ))}
      </div>
    </section>
  );
}

function ResultCard({ result }: { result: ProcessedFileResult }): ReactElement {
  const [previewKind, setPreviewKind] = useState<string | null>(null);

  const previewedOutput = result.outputs.find((output) => output.kind === previewKind) ?? null;
  const previewRows = useMemo(() => {
    if (!previewedOutput) return null;
    const parsed = Papa.parse<string[]>(previewedOutput.csv, {
      header: false,
      skipEmptyLines: true,
      preview: 51,
    });
    return parsed.data ?? [];
  }, [previewedOutput]);

  return (
    <article className="result-card" data-testid="result-card">
      <header className="result-card__header">
        <span className="result-card__name">{result.inputFileName}</span>
        <span className="text-muted u-meta-xs">
          tz: {result.timezone || "—"}
        </span>
      </header>
      <div className="result-card__stats">
        <Stat label="Original rows" value={result.originalRowCount} />
        <Stat label="Processed rows" value={result.processedRowCount} />
        <Stat label="App rows" value={result.appRowCount} />
        <Stat label="Screen rows" value={result.screenRowCount} />
      </div>
      <div className="result-card__actions">
        {result.outputs.map((output) => (
          <button
            key={output.outputFileName}
            type="button"
            className="btn btn--primary"
            data-testid={`download-${output.kind}-csv`}
            onClick={() => downloadTextFile(output.outputFileName, output.csv)}
          >
            Download {output.kind} CSV ({output.rowCount.toLocaleString()} rows)
          </button>
        ))}
        {result.outputs.map((output) => (
          <button
            key={`preview-${output.outputFileName}`}
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              setPreviewKind((current) => (current === output.kind ? null : output.kind))
            }
          >
            {previewKind === output.kind ? "Hide preview" : `Preview first 50 ${output.kind} rows`}
          </button>
        ))}
      </div>
      {previewedOutput && previewRows ? (
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
      ) : null}
    </article>
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
