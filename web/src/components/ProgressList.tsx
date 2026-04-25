import { useEffect, useRef, type ReactElement } from "react";
import type { ProgressStepKind } from "@/lib/types";


export type FileProgress = {
  fileName: string;
  status: "pending" | "running" | "complete" | "error";
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
};

export function ProgressList({ rows, overallPercent }: Props): ReactElement | null {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const clampedPercent = Math.max(0, Math.min(1, overallPercent));

  useEffect(() => {
    fillRef.current?.style.setProperty("--fill", `${clampedPercent * 100}%`);
  }, [clampedPercent]);

  if (!rows.length) return null;
  const totalFiles = rows.length;
  const completedFiles = rows.filter((row) => row.status === "complete" || row.status === "error").length;

  return (
    <div className="progress-panel" role="status" aria-live="polite">
      <div className="progress-panel__overall">
        <div className="progress-panel__overall-label">
          <span>
            Processing {completedFiles}/{totalFiles}
          </span>
          <span className="text-muted">{Math.round(clampedPercent * 100)}%</span>
        </div>
        <div className="progress-bar">
          <div ref={fillRef} className="progress-bar__fill" />
        </div>
      </div>
      <div className="progress-list">
        {rows.map((row) => (
          <div
            key={row.fileName}
            className={`progress-row${row.status === "complete" ? " is-complete" : ""}${row.status === "error" ? " is-error" : ""}`}
          >
            <span className="progress-row__name">{row.fileName}</span>
            <span className="progress-row__step">
              {row.status === "error"
                ? row.error ?? "Failed"
                : row.status === "complete"
                  ? "Done"
                  : row.stepKind
                    ? STEP_LABELS[row.stepKind]
                    : "Queued"}
            </span>
            <span className="progress-row__status">
              {row.status === "running" && row.percent !== undefined
                ? `${Math.round(row.percent * 100)}%`
                : row.status === "complete"
                  ? "✓"
                  : row.status === "error"
                    ? "✗"
                    : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
