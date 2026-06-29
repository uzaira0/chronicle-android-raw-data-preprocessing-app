import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ProgressStepKind } from "@/lib/types";


export type FileProgress = {
  fileName: string;
  status: "pending" | "running" | "complete" | "error" | "cancelled";
  stepKind?: ProgressStepKind;
  percent?: number;
  error?: string;
};

const STEP_LABELS: Record<ProgressStepKind, string> = {
  parse: "Parsing CSV",
  timezone: "Handling timezones",
  filter: "Filtering apps",
  screen: "Deriving screen usage",
  matcher: "Matching app sessions",
  codebook: "Loading codebook",
  enrich: "Enriching rows",
  output: "Building output",
};

type Props = {
  rows: FileProgress[];
  overallPercent: number;
  fileName?: (fileName: string) => string;
  /** When provided, error rows expose a Retry button that reprocesses that file. */
  onRetry?: (fileName: string) => void;
  /** Name of a file currently being retried (its Retry button is disabled). */
  retryingFile?: string | null;
};

export function ProgressList({
  rows,
  overallPercent,
  fileName,
  onRetry,
  retryingFile,
}: Props): ReactElement | null {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const clampedPercent = Math.max(0, Math.min(1, overallPercent));
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});

  const totalFiles = rows.length;
  const completedFiles = rows.filter(
    (row) => row.status === "complete" || row.status === "error" || row.status === "cancelled",
  ).length;
  const processing = totalFiles > 0 && completedFiles < totalFiles && rows.some((row) => row.status === "running");

  // A self-contained ticking clock so the overall row can show a rough
  // "~Ns left" without the parent threading timing state down. Starts on the
  // first running row, resets once the batch finishes.
  const startRef = useRef<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    fillRef.current?.style.setProperty("--fill", `${clampedPercent * 100}%`);
  }, [clampedPercent]);

  useEffect(() => {
    if (processing && startRef.current === null) {
      startRef.current = performance.now();
      setNow(performance.now());
    }
    if (!processing && completedFiles >= totalFiles) {
      startRef.current = null;
    }
  }, [processing, completedFiles, totalFiles]);

  useEffect(() => {
    if (!processing) return;
    const id = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(id);
  }, [processing]);

  if (!rows.length) return null;

  let etaLabel = "";
  if (processing && startRef.current !== null && now > 0 && clampedPercent > 0.02) {
    const elapsed = now - startRef.current;
    const remaining = Math.max(0, elapsed / clampedPercent - elapsed);
    etaLabel = `~${Math.ceil(remaining / 1000)}s left`;
  }

  return (
    <div className="progress-panel" role="status" aria-live="polite">
      <div className="progress-panel__overall">
        <div className="progress-panel__overall-label">
          <span>
            Processing {completedFiles}/{totalFiles}
          </span>
          <span className="text-muted">
            {etaLabel ? <span className="progress-panel__eta">{etaLabel}</span> : null}
            {Math.round(clampedPercent * 100)}%
          </span>
        </div>
        <div className="progress-bar">
          <div ref={fillRef} className="progress-bar__fill" />
        </div>
      </div>
      <div className="progress-list">
        {rows.map((row, index) => {
          const isError = row.status === "error";
          const errorExpanded = isError && expandedErrors[row.fileName];
          return (
            <div
              key={row.fileName}
              className={
                "progress-row" +
                (row.status === "complete" ? " is-complete" : "") +
                (isError ? " is-error" : "") +
                (row.status === "cancelled" ? " is-cancelled" : "")
              }
            >
              <div className="progress-row__main">
                <span className="progress-row__name">
                  {row.status === "running" ? (
                    <span className="progress-row__ord" aria-hidden="true">
                      {index + 1}/{totalFiles}
                    </span>
                  ) : null}
                  {fileName ? fileName(row.fileName) : row.fileName}
                </span>
                <span className="progress-row__step">
                  {isError ? (
                    <button
                      type="button"
                      className="progress-row__error-toggle"
                      aria-expanded={Boolean(errorExpanded)}
                      onClick={() =>
                        setExpandedErrors((current) => ({
                          ...current,
                          [row.fileName]: !current[row.fileName],
                        }))
                      }
                    >
                      {errorExpanded ? "▾ " : "▸ "}
                      {truncate(row.error ?? "Failed")}
                    </button>
                  ) : row.status === "cancelled" ? (
                    "Cancelled"
                  ) : row.status === "complete" ? (
                    "Done"
                  ) : row.stepKind ? (
                    STEP_LABELS[row.stepKind]
                  ) : (
                    "Queued"
                  )}
                </span>
                <span className="progress-row__status">
                  {row.status === "running" && row.percent !== undefined
                    ? `${Math.round(row.percent * 100)}%`
                    : row.status === "complete"
                      ? "✓"
                      : isError
                        ? "✗"
                        : row.status === "cancelled"
                          ? "⊘"
                          : "—"}
                </span>
                {isError && onRetry ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs progress-row__retry"
                    data-testid="retry-file-button"
                    onClick={() => onRetry(row.fileName)}
                    disabled={Boolean(retryingFile)}
                  >
                    {retryingFile === row.fileName ? "Retrying…" : "Retry"}
                  </button>
                ) : null}
              </div>
              {errorExpanded ? (
                <pre className="progress-row__detail" data-testid="error-detail">
                  {row.error ?? "Failed"}
                </pre>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
