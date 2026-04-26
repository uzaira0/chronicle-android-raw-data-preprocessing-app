import type { KeyboardEvent, ReactElement } from "react";

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
  const tabs: WorkflowTab[] = ["settings", "files", "process"];
  const selectAndFocus = (tab: WorkflowTab) => {
    onSelect(tab);
    requestAnimationFrame(() => document.getElementById(`${tab}-tab`)?.focus());
  };
  const onKeyDown = (tab: WorkflowTab, event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabs.indexOf(tab);
    let next = tab;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = tabs[(currentIndex + 1) % tabs.length]!;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = tabs[(currentIndex + tabs.length - 1) % tabs.length]!;
    } else if (event.key === "Home") {
      next = tabs[0]!;
    } else if (event.key === "End") {
      next = tabs[tabs.length - 1]!;
    } else {
      return;
    }
    event.preventDefault();
    selectAndFocus(next);
  };

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
        onKeyDown={(event) => onKeyDown("settings", event)}
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
        onKeyDown={(event) => onKeyDown("files", event)}
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
        onKeyDown={(event) => onKeyDown("process", event)}
      >
        <span className="workflow-nav__label">Process</span>
        <span className="workflow-nav__meta">{isRunning ? "Running" : "Ready"}</span>
      </button>
    </nav>
  );
}
