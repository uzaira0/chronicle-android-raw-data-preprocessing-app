import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ReactElement } from "react";

import { SettingsField } from "@/components/SettingsField";
import { Tooltip } from "@/components/Tooltip";
import { DEFAULT_BROWSER_OPTIONS, USAGE_SESSION_MODE_OPTIONS } from "@/lib/browserPipeline";
import { TOOLTIPS } from "@/lib/tooltipText";
import { isOptionDefault } from "@/lib/optionDefaults";
import type { BrowserProcessingOptions } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  uploadedFiles: File[];
  onFilesChange: (files: File[]) => void;
  onProcess: () => void;
  isRunning: boolean;
};

export function RunBar({
  options,
  setOptions,
  uploadedFiles,
  onFilesChange,
  onProcess,
  isRunning,
}: Props): ReactElement {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFilesPicked = (files: FileList | File[] | null) => {
    if (!files) {
      onFilesChange([]);
      return;
    }
    const next = Array.from(files);
    onFilesChange(next);
  };

  const studyNameModified = !isOptionDefault("studyName", options.studyName);
  const usageModeModified = !isOptionDefault("usageSessionMode", options.usageSessionMode);

  return (
    <div className="run-bar">
      <div
        className={`run-bar__drop${dragging ? " is-dragging" : ""}`}
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
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          data-testid="raw-file-input"
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={(event) => handleFilesPicked(event.target.files)}
        />
        <span className="run-bar__drop-title">
          {uploadedFiles.length
            ? `${uploadedFiles.length} file${uploadedFiles.length === 1 ? "" : "s"} ready`
            : "Drop Chronicle CSV files here"}
        </span>
        <span className="run-bar__drop-meta">
          {uploadedFiles.length
            ? uploadedFiles
                .slice(0, 3)
                .map((file) => file.name)
                .join(", ") +
              (uploadedFiles.length > 3 ? `, +${uploadedFiles.length - 3} more` : "")
            : "or click to choose · processed in your browser"}
        </span>
      </div>

      <div className="run-bar__controls">
        <SettingsField
          label="Study name"
          tooltip={TOOLTIPS.studyName}
          modified={studyNameModified}
          onReset={() =>
            setOptions((current) => ({ ...current, studyName: DEFAULT_BROWSER_OPTIONS.studyName }))
          }
        >
          <input
            data-testid="study-name-input"
            className="input"
            placeholder="optional"
            value={options.studyName}
            onChange={(event) =>
              setOptions((current) => ({ ...current, studyName: event.target.value }))
            }
          />
        </SettingsField>
        <SettingsField
          label="Output mode"
          tooltip={TOOLTIPS.usageSessionMode}
          modified={usageModeModified}
          onReset={() =>
            setOptions((current) => ({
              ...current,
              usageSessionMode: DEFAULT_BROWSER_OPTIONS.usageSessionMode,
            }))
          }
        >
          <select
            data-testid="usage-mode-select"
            className="select"
            value={options.usageSessionMode}
            onChange={(event) =>
              setOptions((current) => ({
                ...current,
                usageSessionMode: event.target.value as BrowserProcessingOptions["usageSessionMode"],
              }))
            }
          >
            {USAGE_SESSION_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>

        <div className="run-bar__actions">
          <div className="u-inline-cluster">
            <button
              type="button"
              className="btn btn--primary btn--lg"
              data-testid="process-files-button"
              onClick={onProcess}
              disabled={isRunning}
            >
              {isRunning ? "Processing…" : "Process files"}
            </button>
            <Tooltip content={TOOLTIPS.runMode} label="Help: Process files" />
          </div>
        </div>
      </div>
    </div>
  );
}
