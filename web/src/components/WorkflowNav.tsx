import type { ReactElement } from "react";

export type WorkflowTab = "settings" | "files" | "process";

type Props = {
  active: WorkflowTab;
  settingsSummary: string;
  fileCount: number;
  isRunning: boolean;
  onSelect: (tab: WorkflowTab) => void;
};

export function WorkflowNav({
  active,
  settingsSummary,
  fileCount,
  isRunning,
  onSelect,
}: Props): ReactElement {
  return (
    <nav className="workflow-nav" aria-label="Workflow" role="tablist">
      <button
        id="settings-tab"
        type="button"
        role="tab"
        aria-selected={active === "settings"}
        aria-controls="settings-panel"
        className={`workflow-nav__item${active === "settings" ? " is-active" : ""}`}
        onClick={() => onSelect("settings")}
      >
        <span className="workflow-nav__label">Settings</span>
        <span className="workflow-nav__meta">{settingsSummary}</span>
      </button>
      <button
        id="files-tab"
        type="button"
        role="tab"
        aria-selected={active === "files"}
        aria-controls="files-panel"
        className={`workflow-nav__item${active === "files" ? " is-active" : ""}`}
        onClick={() => onSelect("files")}
      >
        <span className="workflow-nav__label">Files</span>
        <span className="workflow-nav__meta">
          {fileCount ? `${fileCount} ready` : "No raw files"}
        </span>
      </button>
      <button
        id="process-tab"
        type="button"
        role="tab"
        aria-selected={active === "process"}
        aria-controls="process-panel"
        className={`workflow-nav__item${active === "process" ? " is-active" : ""}`}
        onClick={() => onSelect("process")}
      >
        <span className="workflow-nav__label">Process</span>
        <span className="workflow-nav__meta">{isRunning ? "Running" : "Ready"}</span>
      </button>
    </nav>
  );
}
