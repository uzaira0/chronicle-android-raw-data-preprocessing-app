import type { Dispatch, ReactElement, SetStateAction } from "react";

import { ProgressList, type FileProgress } from "@/components/ProgressList";
import { ToggleField } from "@/components/ToggleField";
import { SettingsField } from "@/components/SettingsField";
import { TOOLTIPS } from "@/lib/tooltipText";
import type { BrowserProcessingOptions } from "@/lib/types";
import type { RawFileInspection } from "@/lib/fileInspection";

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  uploadedFiles: File[];
  inspections: RawFileInspection[];
  isRunning: boolean;
  onProcess: () => void;
  progressRows: FileProgress[];
  overallPercent: number;
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
  isRunning,
  onProcess,
  progressRows,
  overallPercent,
}: Props): ReactElement {
  const etaSeconds = estimateSeconds(uploadedFiles, options.parallelProcessing);
  const warningCount = inspections.reduce((sum, inspection) => sum + inspection.warnings.length, 0);
  const rowCount = inspections.reduce((sum, inspection) => sum + inspection.rowCount, 0);

  return (
    <section id="process" className="workflow-section" aria-labelledby="process-title">
      <div className="workflow-section__header">
        <div>
          <h2 id="process-title" className="workflow-section__title">Process</h2>
          <p className="workflow-section__intro">
            {uploadedFiles.length
              ? `${uploadedFiles.length} files queued · ${rowCount.toLocaleString()} estimated input rows · about ${etaSeconds}s`
              : "Add raw files to populate the processing queue."}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--lg"
          data-testid="process-files-button"
          onClick={onProcess}
          disabled={isRunning || !uploadedFiles.length}
        >
          {isRunning ? "Processing..." : "Process files"}
        </button>
      </div>

      <div className="process-controls">
        <ToggleField
          label="Parallel processing"
          tooltip={TOOLTIPS.parallelProcessing}
          checked={options.parallelProcessing}
          onChange={(value) => setOptions((current) => ({ ...current, parallelProcessing: value }))}
          testId="toggle-parallelProcessing-process"
        />
        <SettingsField label="Mode" htmlFor="process-mode-select" tooltip={TOOLTIPS.parallelMaxWorkers}>
          <select
            id="process-mode-select"
            className="select"
            value={options.parallelProcessing ? "parallel" : "sequential"}
            onChange={(event) =>
              setOptions((current) => ({
                ...current,
                parallelProcessing: event.target.value === "parallel",
              }))
            }
          >
            <option value="sequential">Sequential</option>
            <option value="parallel">Parallel</option>
          </select>
        </SettingsField>
      </div>

      {warningCount ? (
        <p className="warning-text">{warningCount} file readiness warning{warningCount === 1 ? "" : "s"} found. You can still process, but review the Files section first.</p>
      ) : null}

      {progressRows.length ? (
        <ProgressList rows={progressRows} overallPercent={overallPercent} />
      ) : uploadedFiles.length ? (
        <div className="process-ready-list" aria-live="polite">
          {uploadedFiles.map((file) => (
            <div className="progress-row" key={`${file.name}-${file.size}-${file.lastModified}`}>
              <span className="progress-row__name">{file.name}</span>
              <span className="progress-row__step">Ready</span>
              <span className="progress-row__status">0%</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">The processing queue is empty.</p>
      )}
    </section>
  );
}
