import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  loadProjectForApplication,
  ProjectsCard,
} from "@/components/ProjectsCard";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  applyProjectAtomically,
  type ProjectApplicationActivity,
} from "@/lib/projectApplication";
import type { ProjectRecord, ProjectSummary } from "@/lib/projectsStore";
import { SETTINGS_SCHEMA_VERSION } from "@/lib/settingsPersistence";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const summary: ProjectSummary = {
  id: "project-1",
  name: "Project One",
  createdAt: "2026-08-12T00:00:00Z",
  updatedAt: "2026-08-12T00:00:00Z",
  includesFiles: true,
  rawFileNames: ["raw.csv"],
};

const record: ProjectRecord = {
  ...summary,
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  options: DEFAULT_BROWSER_OPTIONS,
  rawFiles: [],
  supportFiles: {},
};

describe("ProjectsCard busy application boundary", () => {
  it("renders project application controls disabled while browser work is active", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectsCard, {
        options: DEFAULT_BROWSER_OPTIONS,
        uploadedFiles: [],
        supportFiles: {},
        onApplyProject: vi.fn(),
        onStatus: vi.fn(),
        disabled: true,
      }),
    );
    // Projects load asynchronously from IndexedDB, so the empty initial list
    // cannot render a Load button during SSR. The section still exposes the
    // same busy state that disables every subsequently rendered Load button.
    expect(html).toContain('aria-disabled="true"');
  });

  it("rejects a deferred idle load if processing begins before the record resolves", async () => {
    const loaded = deferred<ProjectRecord | null>();
    const status = vi.fn();
    const mutation = vi.fn();
    const activity: ProjectApplicationActivity = {
      processing: false,
      retrying: false,
      comparing: false,
    };
    const operation = loadProjectForApplication(
      summary,
      () => applyProjectAtomically(activity, mutation),
      status,
      () => loaded.promise,
    );

    activity.processing = true;
    loaded.resolve(record);
    await operation;

    expect(mutation).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(
      expect.stringContaining("Project application is unavailable"),
      true,
    );
    expect(status).not.toHaveBeenCalledWith(
      expect.stringContaining("Loaded project:"),
    );
  });
});
