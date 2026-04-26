import { useRef, useState, type ReactElement } from "react";

import type { RawFileInspection } from "@/lib/fileInspection";

type Props = {
  uploadedFiles: File[];
  inspections: RawFileInspection[];
  isInspecting: boolean;
  onFilesChange: (files: File[]) => void;
  onClear: () => void;
  isRunning: boolean;
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
  onFilesChange,
  onClear,
  isRunning,
}: Props): ReactElement {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFilesPicked = (files: FileList | File[] | null) => {
    onFilesChange(files ? Array.from(files) : []);
  };

  return (
    <section id="files" className="workflow-section" aria-labelledby="files-title">
      <div className="workflow-section__header">
        <div>
          <h2 id="files-title" className="workflow-section__title">Files</h2>
          <p className="workflow-section__intro">
            Add raw Chronicle CSV files and review basic file readiness before processing.
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
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFilesPicked(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          data-testid="raw-file-input"
          className="visually-hidden-file-input"
          type="file"
          accept=".csv,text/csv"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            handleFilesPicked(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        <div>
          <strong>{uploadedFiles.length ? `${uploadedFiles.length} raw file${uploadedFiles.length === 1 ? "" : "s"} ready` : "Drop raw Chronicle CSV files here"}</strong>
          <span>{isInspecting ? "Inspecting selected files..." : "CSV files are processed locally in the browser."}</span>
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
        <div className="raw-file-list" aria-live="polite">
          {uploadedFiles.map((file) => {
            const inspection = inspections.find((entry) => entry.fileName === file.name);
            const warnings = inspection?.warnings ?? [];
            return (
              <article
                className={`raw-file-row${warnings.length ? " has-warning" : ""}`}
                key={`${file.name}-${file.size}-${file.lastModified}`}
              >
                <div className="raw-file-row__main">
                  <strong>{file.name}</strong>
                  <span className="text-faint u-meta-xs">
                    {formatBytes(file.size)}
                    {inspection ? ` · ${inspection.rowCount.toLocaleString()} rows · ${inspection.columns.length} columns` : ""}
                  </span>
                </div>
                <div className="raw-file-row__meta">
                  <span className={`status-pill${warnings.length ? " is-warning" : " is-success"}`}>
                    {inspection ? (warnings.length ? "Warning: Review" : "Success: Ready") : "Status: Inspecting"}
                  </span>
                  {inspection?.timezones.length ? (
                    <span className="text-faint u-meta-xs">
                      {inspection.timezones.length === 1
                        ? inspection.timezones[0]
                        : `${inspection.timezones.length} timezones`}
                    </span>
                  ) : null}
                </div>
                {warnings.length ? (
                  <p className="raw-file-row__warning">{warnings.join(" ")}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-state">No raw files selected yet.</p>
      )}
    </section>
  );
}
