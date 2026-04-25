import type { ReactElement } from "react";

type Props = {
  active: "settings" | "files" | "process";
  settingsSummary: string;
  fileCount: number;
  isRunning: boolean;
};

export function WorkflowNav({
  active,
  settingsSummary,
  fileCount,
  isRunning,
}: Props): ReactElement {
  return (
    <nav className="workflow-nav" aria-label="Workflow">
      <a className={`workflow-nav__item${active === "settings" ? " is-active" : ""}`} href="#settings">
        <span className="workflow-nav__label">Settings</span>
        <span className="workflow-nav__meta">{settingsSummary}</span>
      </a>
      <a className={`workflow-nav__item${active === "files" ? " is-active" : ""}`} href="#files">
        <span className="workflow-nav__label">Files</span>
        <span className="workflow-nav__meta">
          {fileCount ? `${fileCount} ready` : "No raw files"}
        </span>
      </a>
      <a className={`workflow-nav__item${active === "process" ? " is-active" : ""}`} href="#process">
        <span className="workflow-nav__label">Process</span>
        <span className="workflow-nav__meta">{isRunning ? "Running" : "Ready"}</span>
      </a>
    </nav>
  );
}
