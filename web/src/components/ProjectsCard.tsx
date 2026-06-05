import { useEffect, useState, type ReactElement } from "react";

import {
  buildProjectRecord,
  deleteProject,
  listProjects,
  loadProject,
  projectByteSize,
  saveProject,
  type ProjectRecord,
  type ProjectSummary,
  type SupportFileSlot,
} from "@/lib/projectsStore";
import type { BrowserProcessingOptions } from "@/lib/types";
import { safeUuid } from "@/lib/uuid";

/** Warn when a bundled save would exceed this (IndexedDB quota / eviction risk). */
const LARGE_SAVE_BYTES = 50 * 1024 * 1024;

type Props = {
  options: BrowserProcessingOptions;
  uploadedFiles: File[];
  supportFiles: Partial<Record<SupportFileSlot, File | null>>;
  onApplyProject: (record: ProjectRecord) => void;
  onStatus: (message: string, isError?: boolean) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectsCard({
  options,
  uploadedFiles,
  supportFiles,
  onApplyProject,
  onStatus,
}: Props): ReactElement {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [includeFiles, setIncludeFiles] = useState(false);

  const refresh = (): void => {
    void listProjects().then(setProjects, (error: unknown) =>
      onStatus(
        `Could not read saved projects: ${error instanceof Error ? error.message : String(error)}`,
        true,
      ),
    );
  };

  useEffect(refresh, []);

  const saveCurrent = (): void => {
    const trimmed = name.trim();
    if (!trimmed) {
      onStatus("Name the project before saving.", true);
      return;
    }
    const bytes = projectByteSize({ rawFiles: uploadedFiles, supportFiles, includeFiles });
    const oversized = bytes > LARGE_SAVE_BYTES;
    const record = buildProjectRecord({
      id: safeUuid(),
      name: trimmed,
      now: new Date().toISOString(),
      options,
      rawFiles: uploadedFiles,
      supportFiles,
      includeFiles,
    });
    void saveProject(record).then(
      () => {
        setName("");
        refresh();
        // Surface the quota warning on the success path: a single-slot status
        // toast shown before the async save resolved would be clobbered by this.
        if (oversized) {
          onStatus(
            `Project saved: ${trimmed} (with ${formatBytes(bytes)} of files) — this exceeds typical browser storage limits and may be evicted; consider saving config only.`,
            true,
          );
        } else {
          onStatus(
            `Project saved: ${trimmed}${includeFiles ? ` (with ${formatBytes(bytes)} of files)` : " (config only)"}`,
          );
        }
      },
      (error: unknown) =>
        onStatus(
          `Could not save project: ${error instanceof Error ? error.message : String(error)}`,
          true,
        ),
    );
  };

  const load = (summary: ProjectSummary): void => {
    void loadProject(summary.id).then(
      (record) => {
        if (!record) {
          onStatus("Project not found.", true);
          return;
        }
        onApplyProject(record);
        onStatus(
          `Loaded project: ${record.name}${record.includesFiles ? " (config + files)" : " (config only)"}`,
        );
      },
      (error: unknown) =>
        onStatus(
          `Could not load project: ${error instanceof Error ? error.message : String(error)}`,
          true,
        ),
    );
  };

  const remove = (summary: ProjectSummary): void => {
    void deleteProject(summary.id).then(
      () => {
        refresh();
        onStatus(`Deleted project: ${summary.name}`);
      },
      (error: unknown) =>
        onStatus(
          `Could not delete project: ${error instanceof Error ? error.message : String(error)}`,
          true,
        ),
    );
  };

  return (
    <section
      className="settings-management"
      aria-labelledby="projects-card-title"
      data-testid="projects-card"
    >
      <header className="workflow-section__header">
        <div>
          <h3 id="projects-card-title" className="workflow-section__subtitle">
            Saved projects
          </h3>
          <p className="workflow-section__intro">
            Save the current settings — optionally with the uploaded files — to this browser, so you
            can close the tab and resume later. Stored locally in IndexedDB; nothing leaves your
            device.
          </p>
        </div>
      </header>

      <div className="settings-management__group">
        <div className="preset-manager__save">
          <input
            className="input"
            value={name}
            placeholder="Project name"
            data-testid="project-name-input"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="save-project-button"
            onClick={saveCurrent}
          >
            Save project
          </button>
        </div>
        <label className="timeline__layer">
          <input
            type="checkbox"
            checked={includeFiles}
            data-testid="project-include-files"
            onChange={(event) => setIncludeFiles(event.target.checked)}
          />{" "}
          Include uploaded files ({uploadedFiles.length})
        </label>

        {projects.length ? (
          <div className="preset-list" data-testid="project-list">
            {projects.map((project) => (
              <article className="preset-row" key={project.id}>
                <div>
                  <strong>{project.name}</strong>
                  <span className="text-faint u-meta-xs">
                    {project.includesFiles
                      ? `${project.rawFileNames.length} file${project.rawFileNames.length === 1 ? "" : "s"}`
                      : "config only"}{" "}
                    · created {new Date(project.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    data-testid={`load-project-${project.id}`}
                    onClick={() => load(project)}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger-ghost"
                    onClick={() => remove(project)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">No saved projects yet.</p>
        )}
      </div>
    </section>
  );
}
