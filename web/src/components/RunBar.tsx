import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ReactElement } from "react";

import { SettingsField } from "@/components/SettingsField";
import { ToggleField } from "@/components/ToggleField";
import { Tooltip } from "@/components/Tooltip";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
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
            : "or choose files · processed in your browser"}
        </span>
        <button
          type="button"
          className="btn btn--secondary run-bar__choose"
          onClick={() => inputRef.current?.click()}
          disabled={isRunning}
        >
          Choose files
        </button>
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
        <SettingsField label="Output mode">
          <ToggleField
            label="App usage"
            checked={options.processAppUsage}
            onChange={(value) => setOptions((current) => ({ ...current, processAppUsage: value }))}
            testId="toggle-processAppUsage"
            tooltip={TOOLTIPS.processAppUsage}
            modified={!isOptionDefault("processAppUsage", options.processAppUsage)}
            onReset={() => setOptions((current) => ({ ...current, processAppUsage: DEFAULT_BROWSER_OPTIONS.processAppUsage }))}
          />
          <ToggleField
            label="Screen usage"
            checked={options.processScreenUsage}
            onChange={(value) => setOptions((current) => ({ ...current, processScreenUsage: value }))}
            testId="toggle-processScreenUsage"
            tooltip={TOOLTIPS.processScreenUsage}
            modified={!isOptionDefault("processScreenUsage", options.processScreenUsage)}
            onReset={() => setOptions((current) => ({ ...current, processScreenUsage: DEFAULT_BROWSER_OPTIONS.processScreenUsage }))}
          />
          <ToggleField
            label="Plots"
            checked={options.enablePlotting}
            onChange={(value) => setOptions((current) => ({ ...current, enablePlotting: value }))}
            testId="toggle-enablePlotting"
            tooltip={TOOLTIPS.enablePlotting}
            modified={!isOptionDefault("enablePlotting", options.enablePlotting)}
            onReset={() => setOptions((current) => ({ ...current, enablePlotting: DEFAULT_BROWSER_OPTIONS.enablePlotting }))}
          />
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
