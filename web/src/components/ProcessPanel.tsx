import type { Dispatch, ReactElement, SetStateAction } from "react";

import { ProgressList, type FileProgress } from "@/components/ProgressList";
import { ToggleField } from "@/components/ToggleField";
import { SettingsField } from "@/components/SettingsField";
import { TOOLTIPS } from "@/lib/tooltipText";
import { rangeError } from "@/lib/validation";
import type { BrowserProcessingOptions } from "@/lib/types";
import { effectiveWarnings, type RawFileInspection } from "@/lib/fileInspection";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  uploadedFiles: File[];
  inspections: RawFileInspection[];
  displayMasker: DemoDisplayMasker;
  isRunning: boolean;
  onProcess: () => void;
  onCancel: () => void;
  onRetry?: (fileName: string) => void;
  retryingFile?: string | null;
  progressRows: FileProgress[];
  overallPercent: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

function estimateSeconds(files: File[], parallel: boolean): number {
  const totalMb = files.reduce((sum, file) => sum + file.size / (1024 * 1024), 0);
  const base = Math.max(3, totalMb * 1.5);
  return Math.ceil(parallel ? base / 2 : base);
}

export function ProcessPanel({
  options,
  setOptions,
  uploadedFiles,
  inspections,
  displayMasker,
  isRunning,
  onProcess,
  onCancel,
  onRetry,
  retryingFile,
  progressRows,
  overallPercent,
  expanded,
  onExpandedChange,
}: Props): ReactElement {
  const etaSeconds = estimateSeconds(uploadedFiles, options.parallelProcessing);
  const warningCount = inspections.reduce(
    (sum, inspection) => sum + effectiveWarnings(inspection, options).length,
    0,
  );
  const rowCount = inspections.reduce((sum, inspection) => sum + inspection.rowCount, 0);

  return (
    <section
      id="process"
      className={`workflow-section process-section ${expanded ? "is-expanded" : "is-collapsed"}`}
      aria-labelledby="process-title"
    >
      <div className="workflow-section__header">
        <div>
          <h2 id="process-title" className="workflow-section__title">Process</h2>
          <p className="workflow-section__intro">
            {uploadedFiles.length
              ? `${uploadedFiles.length} files queued · ${rowCount.toLocaleString()} estimated input rows · about ${etaSeconds}s`
              : "Add raw files to populate the processing queue."}
          </p>
        </div>
        <div className="process-section__actions">
          <button
            type="button"
            className="btn btn--ghost"
            aria-expanded={expanded}
            aria-controls="process-details"
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? "Hide processing details" : "Show processing details"}
          </button>
          {isRunning ? (
            <button
              type="button"
              className="btn btn--danger btn--lg"
              data-testid="cancel-process-button"
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--primary btn--lg"
            data-testid="process-files-button"
            onClick={onProcess}
            disabled={isRunning || !!retryingFile || !uploadedFiles.length}
          >
            {isRunning ? "Processing..." : "Process files"}
          </button>
        </div>
      </div>

      <div id="process-details" className="process-section__body" hidden={!expanded}>
        <div className="process-controls">
          <ToggleField
            label="Parallel processing"
            tooltip={TOOLTIPS.parallelProcessing}
            checked={options.parallelProcessing}
            onChange={(value) => setOptions((current) => ({ ...current, parallelProcessing: value }))}
            testId="toggle-parallelProcessing-process"
          />
          <SettingsField
            label="Max parallel workers"
            htmlFor="process-max-workers-input"
            tooltip={TOOLTIPS.parallelMaxWorkers}
            hint="Synced with Settings. 0 lets the app choose a safe limit."
            error={
              options.parallelProcessing
                ? rangeError(options.parallelMaxWorkers ?? 0, 0, 32)
                : undefined
            }
          >
            <input
              id="process-max-workers-input"
              type="number"
              className="input"
              data-testid="parallel-max-workers-process-input"
              min={0}
              max={32}
              value={options.parallelMaxWorkers ?? 0}
              onChange={(event) => {
                const next = Number(event.target.value);
                setOptions((current) => ({
                  ...current,
                  parallelMaxWorkers: next > 0 ? next : undefined,
                }));
              }}
              disabled={!options.parallelProcessing}
            />
          </SettingsField>
        </div>

        {warningCount ? (
          <p className="warning-text">{warningCount} file readiness warning{warningCount === 1 ? "" : "s"} found. You can still process, but review the Files section first.</p>
        ) : null}

        {progressRows.length ? (
          <ProgressList
            rows={progressRows}
            overallPercent={overallPercent}
            fileName={displayMasker.fileName}
            onRetry={onRetry}
            retryingFile={retryingFile}
          />
        ) : uploadedFiles.length ? (
          <div className="process-ready-list" aria-live="polite">
            {uploadedFiles.map((file) => (
              <div className="progress-row" key={`${file.name}-${file.size}-${file.lastModified}`}>
                <div className="progress-row__main">
                  <span className="progress-row__name">{displayMasker.fileName(file.name)}</span>
                  <span className="progress-row__step">Ready</span>
                  <span className="progress-row__status">0%</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">The processing queue is empty.</p>
        )}
      </div>
    </section>
  );
}
