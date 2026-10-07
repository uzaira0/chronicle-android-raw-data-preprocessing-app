import { useRef, useState, type ReactElement } from "react";

import {
  effectiveWarnings,
  type RawFileInspection,
} from "@/lib/fileInspection";
import type { BrowserProcessingOptions } from "@/lib/types";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";

type Props = {
  uploadedFiles: File[];
  inspections: RawFileInspection[];
  isInspecting: boolean;
  options: BrowserProcessingOptions;
  displayMasker: DemoDisplayMasker;
  onFilesChange: (files: File[]) => void;
  /** Pure permutation of the current selection; must not discard run state. */
  onFilesReorder: (files: File[]) => void;
  onClear: () => void;
  isRunning: boolean;
  literatureComponentActive?: boolean;
  componentTableFormat?: "arrow-ipc-file";
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function RawFilesCard({
  uploadedFiles,
  inspections,
  isInspecting,
  options,
  displayMasker,
  onFilesChange,
  onFilesReorder,
  onClear,
  isRunning,
  literatureComponentActive = false,
  componentTableFormat,
}: Props): ReactElement {
  const typedTable = componentTableFormat === "arrow-ipc-file";
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFilesPicked = (files: FileList | File[] | null) => {
    if (isRunning) return;
    onFilesChange(files ? Array.from(files) : []);
  };

  const removeFile = (index: number) => {
    onFilesChange(uploadedFiles.filter((_, position) => position !== index));
  };

  const moveFile = (from: number, to: number) => {
    if (to < 0 || to >= uploadedFiles.length) return;
    const next = uploadedFiles.slice();
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    onFilesReorder(next);
  };

  return (
    <section
      id="files"
      className="workflow-section"
      aria-labelledby="files-title"
    >
      <div className="workflow-section__header">
        <div>
          <h2 id="files-title" className="workflow-section__title">
            Files
          </h2>
          <p className="workflow-section__intro">
            {typedTable ? "Add an explicitly typed Arrow analysis table. The selected component validates its schema when run."
              : literatureComponentActive ? "Add one source-specific CSV matching the selected component's required fields. The component validates its input when run; ordinary Chronicle event columns are not required."
                : "Add raw Chronicle CSV files and review file readiness before processing."}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onClear}
          disabled={!uploadedFiles.length || isRunning}
        >
          Clear files
        </button>
      </div>

      <div
        className={`raw-drop${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (isRunning) return;
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (isRunning) return;
          handleFilesPicked(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          data-testid="raw-file-input"
          className="visually-hidden-file-input"
          type="file"
          accept={typedTable ? ".arrow,application/vnd.apache.arrow.file" : ".csv,text/csv"}
          multiple
          tabIndex={-1}
          aria-hidden="true"
          disabled={isRunning}
          onChange={(event) => {
            handleFilesPicked(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        <div>
          <strong>
            {uploadedFiles.length
              ? `${uploadedFiles.length} raw file${uploadedFiles.length === 1 ? "" : "s"} ready`
              : typedTable ? "Drop an Arrow analysis table here" : literatureComponentActive ? "Drop the component source CSV here" : "Drop raw Chronicle CSV files here"}
          </strong>
          <span>
            {isInspecting
              ? "Inspecting selected files..."
              : `${typedTable ? "Arrow tables" : "CSV files"} are processed locally in the browser.`}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => inputRef.current?.click()}
          disabled={isRunning}
        >
          Choose files
        </button>
      </div>

      {uploadedFiles.length ? (
        <div className="raw-file-table-wrap">
          <table className="raw-file-table" aria-live="polite">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Size</th>
                <th scope="col">Rows</th>
                <th scope="col">Columns</th>
                <th scope="col">Timezones</th>
                <th scope="col">Duplicate timestamps</th>
                <th scope="col">Status</th>
                {/* Name the column via aria-label, not a visually-hidden child:
                    a position:absolute sr-only span escapes the table's
                    overflow-x wrapper and pushes documentElement.scrollWidth
                    past the viewport at 200% zoom (horizontal-scroll regression). */}
                <th
                  scope="col"
                  className="raw-file-table__actions-head"
                  aria-label="Actions"
                />
              </tr>
            </thead>
            <tbody>
              {uploadedFiles.map((file, index) => {
                const inspection = inspections.find(
                  (entry) => entry.fileName === file.name,
                );
                const displayFile = displayMasker.fileName(file.name);
                const warnings = inspection
                  ? effectiveWarnings(inspection, options)
                  : [];
                // A missing required column is not a cosmetic warning: the
                // kernel resolves columns by name and silently substitutes an
                // empty string, so the file would process to blank fields and
                // still report success. It gets its own error state, and the
                // Process button refuses the run.
                const missingRequiredColumns =
                  !!inspection && !inspection.hasRequiredColumns;
                const componentValidationPending =
                  missingRequiredColumns && literatureComponentActive;
                const status = inspection
                  ? missingRequiredColumns
                    ? componentValidationPending
                      ? { label: "Component validates at run", className: "is-warning" }
                      : { label: "Error: Missing columns", className: "is-error" }
                    : warnings.length
                      ? { label: "Warning: Review", className: "is-warning" }
                      : { label: "Success: Ready", className: "is-success" }
                  : typedTable ? { label: "Component validates at run", className: "is-warning" }
                    : { label: "Status: Inspecting", className: "" };
                const dupCount = inspection?.duplicateTimestampCount ?? 0;
                const dupCorrected =
                  options.correctDuplicateEventTimestamps && dupCount > 0;
                return (
                  <tr
                    className={`raw-file-row${
                      missingRequiredColumns && !componentValidationPending
                        ? " has-error"
                        : warnings.length
                          ? " has-warning"
                          : ""
                    }`}
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    data-testid="raw-file-row"
                  >
                    <td>
                      <strong>{displayFile}</strong>
                      {warnings.length ? (
                        <p
                          className={
                            missingRequiredColumns && !componentValidationPending
                              ? "raw-file-row__error"
                              : "raw-file-row__warning"
                          }
                          role={
                            missingRequiredColumns && !componentValidationPending
                              ? "alert"
                              : undefined
                          }
                          data-testid={
                            missingRequiredColumns && !componentValidationPending
                              ? "raw-file-row-error"
                              : undefined
                          }
                        >
                          {missingRequiredColumns && !componentValidationPending
                            ? `Cannot process this file. ${warnings.join(" ")}`
                            : componentValidationPending
                              ? "This source-shaped file is validated by the selected literature component when run."
                              : warnings.join(" ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-faint u-meta-xs">
                      {formatBytes(file.size)}
                    </td>
                    <td className="text-faint u-meta-xs">
                      {inspection ? inspection.rowCount.toLocaleString() : "—"}
                    </td>
                    <td className="text-faint u-meta-xs">
                      {inspection ? inspection.columns.length : "—"}
                    </td>
                    <td className="text-faint u-meta-xs">
                      {inspection?.timezones.length ? (
                        <ul className="raw-file-row__timezones">
                          {inspection.timezones.map((zone) => (
                            <li key={zone}>{displayMasker.timezone(zone)}</li>
                          ))}
                        </ul>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-faint u-meta-xs">
                      {dupCount === 0
                        ? "0"
                        : dupCorrected
                          ? `${dupCount.toLocaleString()} (will be corrected)`
                          : `${dupCount.toLocaleString()} (not corrected)`}
                    </td>
                    <td>
                      <span className={`status-pill ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="raw-file-row__actions">
                      <div className="raw-file-row__actions-group">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Move ${displayFile} up`}
                          data-testid="move-file-up"
                          onClick={() => moveFile(index, index - 1)}
                          disabled={isRunning || index === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Move ${displayFile} down`}
                          data-testid="move-file-down"
                          onClick={() => moveFile(index, index + 1)}
                          disabled={
                            isRunning || index === uploadedFiles.length - 1
                          }
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn--danger"
                          aria-label={`Remove ${displayFile}`}
                          data-testid="remove-file"
                          onClick={() => removeFile(index)}
                          disabled={isRunning}
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">No raw files selected yet.</p>
      )}
    </section>
  );
}
