import type { KeyboardEvent, ReactElement } from "react";
import { requireDefined } from "@/lib/invariant";

const TAB_INDEX_INVARIANT = "the tab list is a fixed non-empty list and every index is taken within its bounds";

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
    // Every arm below either assigns next or returns, so an initializer here
    // would only mask a future arm that forgets to assign.
    let next: WorkflowTab;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = requireDefined(tabs[(currentIndex + 1) % tabs.length], TAB_INDEX_INVARIANT);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = requireDefined(tabs[(currentIndex + tabs.length - 1) % tabs.length], TAB_INDEX_INVARIANT);
    } else if (event.key === "Home") {
      next = requireDefined(tabs[0], TAB_INDEX_INVARIANT);
    } else if (event.key === "End") {
      next = requireDefined(tabs[tabs.length - 1], TAB_INDEX_INVARIANT);
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
