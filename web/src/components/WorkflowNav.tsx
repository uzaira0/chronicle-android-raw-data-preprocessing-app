import type { KeyboardEvent, ReactElement } from "react";

export type WorkflowTab = "guide" | "settings" | "files" | "process" | "view" | "graph";

type Props = {
  active: WorkflowTab;
  onSelect: (tab: WorkflowTab) => void;
};

export function WorkflowNav({ active, onSelect }: Props): ReactElement {
  const tabs: WorkflowTab[] = ["guide", "settings", "files", "process", "view", "graph"];
  const labels: Record<WorkflowTab, string> = {
    guide: "Guide",
    settings: "Settings",
    files: "Files",
    process: "Process",
    view: "View",
    graph: "Graph",
  };
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
      {tabs.map((tab) => (
        <button
          key={tab}
          id={`${tab}-tab`}
          type="button"
          role="tab"
          aria-selected={active === tab}
          aria-controls={`${tab}-panel`}
          className={`workflow-nav__item${active === tab ? " is-active" : ""}`}
          onClick={() => onSelect(tab)}
          onKeyDown={(event) => onKeyDown(tab, event)}
        >
          <span className="workflow-nav__label">{labels[tab]}</span>
        </button>
      ))}
    </nav>
  );
}
