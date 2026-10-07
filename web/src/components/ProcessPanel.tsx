import type { Dispatch, ReactElement, SetStateAction } from "react";

import { ProgressList, type FileProgress } from "@/components/ProgressList";
import { ToggleField } from "@/components/ToggleField";
import { SettingsField } from "@/components/SettingsField";
import { TOOLTIPS } from "@/lib/tooltipText";
import {
  collectOptionRangeViolations,
  collectRawColumnViolations,
  maskRawColumnViolations,
  optionRangeError,
  rawColumnViolationMessage,
} from "@/lib/validation";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  effectiveWarnings,
  type RawFileInspection,
} from "@/lib/fileInspection";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import { BROWSER_OPTION_TOOLTIPS } from "@/lib/generatedContract";

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  uploadedFiles: File[];
  inspections: RawFileInspection[];
  displayMasker: DemoDisplayMasker;
  isInspecting: boolean;
  inspectionReady: boolean;
  isRunning: boolean;
  /**
   * The durable-workspace probe found this context STRUCTURALLY unable to
   * persist (no OPFS or Web Locks API, private browsing). The run still
   * happens, on the runtime's complete non-persisted branch, so this labels
   * the button rather than disabling it; App.tsx renders the banner that says
   * what ephemeral mode costs and how to restore durable storage.
   */
  ephemeralWorkspace?: boolean;
  /**
   * The probe failed for a reason that may not repeat — an exhausted quota, a
   * worker that restarted, an unexplained rejection. This is NOT degraded to
   * ephemeral: a run that cannot be persisted is lost on reload, so a failure
   * that a retry might clear must refuse instead of silently downgrading.
   */
  durableWorkspaceUnavailable?: boolean;
  onProcess: () => void;
  onCancel: () => void;
  onRetry?: (fileName: string) => void;
  retryingFile?: string | null;
  progressRows: FileProgress[];
  overallPercent: number;
  effectiveProcessingConcurrency?: number | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

function estimateSeconds(files: File[], parallel: boolean): number {
  const totalMb = files.reduce(
    (sum, file) => sum + file.size / (1024 * 1024),
    0,
  );
  const base = Math.max(3, totalMb * 1.5);
  return Math.ceil(parallel ? base / 2 : base);
}

export function ProcessPanel({
  options,
  setOptions,
  uploadedFiles,
  inspections,
  displayMasker,
  isInspecting,
  inspectionReady,
  isRunning,
  ephemeralWorkspace = false,
  durableWorkspaceUnavailable = false,
  onProcess,
  onCancel,
  onRetry,
  retryingFile,
  progressRows,
  overallPercent,
  effectiveProcessingConcurrency,
  expanded,
  onExpandedChange,
}: Props): ReactElement {
  const settingsRangeViolations = collectOptionRangeViolations(options);
  // Rust reported these files as missing a column the row reader resolves by
  // name. It substitutes an empty string instead of failing, so the run would
  // finish "successfully" over blank packages/labels/timestamps.
  // Demo mode masks filenames everywhere else they are shown; a blocking
  // message must not be the one place a real filename leaks.
  const rawColumnViolations = maskRawColumnViolations(
    collectRawColumnViolations(inspections),
    displayMasker.fileName,
  );
  const etaSeconds = estimateSeconds(uploadedFiles, options.parallelProcessing);
  const warningCount = inspections.reduce(
    (sum, inspection) => sum + effectiveWarnings(inspection, options).length,
    0,
  );
  const rowCount = inspections.reduce(
    (sum, inspection) => sum + inspection.rowCount,
    0,
  );

  return (
    <section
      id="process"
      className={`workflow-section process-section ${expanded ? "is-expanded" : "is-collapsed"}`}
      aria-labelledby="process-title"
      data-effective-processing-concurrency={
        effectiveProcessingConcurrency ?? undefined
      }
    >
      <div className="workflow-section__header">
        <div>
          <h2 id="process-title" className="workflow-section__title">
            Process
          </h2>
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
            disabled={
              isRunning ||
              isInspecting ||
              !!retryingFile ||
              !uploadedFiles.length ||
              !inspectionReady ||
              durableWorkspaceUnavailable ||
              rawColumnViolations.length > 0 ||
              settingsRangeViolations.length > 0
            }
          >
            {isRunning
              ? "Processing..."
              : isInspecting
                ? "Inspecting files..."
                : !inspectionReady && uploadedFiles.length
                  ? "Re-inspect files to continue"
                  : durableWorkspaceUnavailable
                    ? "Durable storage unavailable"
                    : rawColumnViolations.length > 0
                      ? "Fix raw files missing required columns"
                      : settingsRangeViolations.length > 0
                        ? "Fix out-of-range settings"
                        : ephemeralWorkspace
                          ? "Process files (ephemeral)"
                          : "Process files"}
          </button>
          {durableWorkspaceUnavailable ? (
            <p
              className="error-text"
              role="alert"
              data-testid="durable-workspace-block"
            >
              Cannot process: durable local storage is unavailable and the
              reason may be temporary, so the run is refused rather than
              silently held in this tab. Free up disk space, close other tabs of
              this app, then reload and try again.
            </p>
          ) : null}
          {ephemeralWorkspace ? (
            <p
              className="warning-text"
              role="status"
              data-testid="ephemeral-workspace-note"
            >
              Durable local storage is unavailable, so this run is held in this
              tab only. Download the outputs before closing or reloading.
            </p>
          ) : null}
          {rawColumnViolations.length > 0 ? (
            <p
              className="error-text"
              role="alert"
              data-testid="raw-columns-block"
            >
              {rawColumnViolationMessage(rawColumnViolations)}
            </p>
          ) : null}
          {settingsRangeViolations.length > 0 ? (
            // An out-of-range value is not a display nicety: it reaches the
            // kernel verbatim and produces a wrong result that still reports
            // success. Name every offending setting rather than only disabling.
            <p
              className="error-text"
              role="alert"
              data-testid="settings-range-block"
            >
              {`Cannot process: ${settingsRangeViolations
                .map(
                  (violation) =>
                    `${BROWSER_OPTION_TOOLTIPS[violation.key].title} (${violation.message.toLowerCase()})`,
                )
                .join("; ")}.`}
            </p>
          ) : null}
        </div>
      </div>

      <div
        id="process-details"
        className="process-section__body"
        hidden={!expanded}
      >
        <div className="process-sections" data-testid="process-sections">
          <div className="process-sections__item">
            <strong>Preprocess</strong>
            <span>
              Parse, timezone normalization, dedup &amp; ordering, session
              reconstruction
              {options.processScreenUsage ? ", screen usage derivation" : ""}.
            </span>
          </div>
          <div className="process-sections__item">
            <strong>Clean</strong>
            <span>
              {[
                options.useFilterFile ? "app filter list" : null,
                options.minimumUsageDuration ? "minimum-duration floor" : null,
                "long-session flags",
                options.enableScreenGatedCrediting
                  ? "screen-gated usage credit (side-by-side)"
                  : null,
              ]
                .filter(Boolean)
                .join(", ")}
              .
            </span>
          </div>
          <div className="process-sections__item">
            <strong>Analyze</strong>
            <span>
              {(() => {
                const active = [
                  options.enableStudyWindowFilter
                    ? "study-window filter"
                    : null,
                  options.enablePersonAttribution ? "person attribution" : null,
                  options.enableComplianceScoring ? "compliance scoring" : null,
                  options.enableDayCoverage ? "day coverage report" : null,
                ].filter(Boolean);
                return active.length
                  ? `${active.join(", ")}.`
                  : "Off. Turn on study analysis steps in Settings → Study analysis.";
              })()}
            </span>
          </div>
        </div>
        <div className="process-controls">
          <ToggleField
            label="Parallel processing"
            tooltip={TOOLTIPS.parallelProcessing}
            checked={options.parallelProcessing}
            onChange={(value) =>
              setOptions((current) => ({
                ...current,
                parallelProcessing: value,
              }))
            }
            testId="toggle-parallelProcessing-process"
          />
          <SettingsField
            label="Max parallel workers"
            htmlFor="process-max-workers-input"
            tooltip={TOOLTIPS.parallelMaxWorkers}
            hint="Synced with Settings. 0 lets the app choose a safe limit."
            error={
              options.parallelProcessing
                ? optionRangeError("parallelMaxWorkers", options.parallelMaxWorkers ?? 0)
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
          {effectiveProcessingConcurrency ? (
            <p
              className="text-muted"
              data-testid="effective-processing-concurrency"
              aria-live="polite"
            >
              Last run used {effectiveProcessingConcurrency} processing worker
              {effectiveProcessingConcurrency === 1 ? "" : "s"}.
            </p>
          ) : null}
        </div>

        {warningCount ? (
          <p className="warning-text">
            {warningCount} file readiness warning{warningCount === 1 ? "" : "s"}{" "}
            found. You can still process, but review the Files section first.
          </p>
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
              <div
                className="progress-row"
                key={`${file.name}-${file.size}-${file.lastModified}`}
              >
                <div className="progress-row__main">
                  <span className="progress-row__name">
                    {displayMasker.fileName(file.name)}
                  </span>
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
