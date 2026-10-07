export type ProjectApplicationActivity = {
  processing: boolean;
  retrying: boolean;
  comparing: boolean;
};

export class ProjectApplicationBusyError extends Error {
  readonly code = "project_application_busy";

  constructor() {
    super(
      "Project application is unavailable while processing, retry, or comparison work is active.",
    );
    this.name = "ProjectApplicationBusyError";
  }
}

/**
 * Guard the entire synchronous project-state commit. The activity snapshot is
 * read only when the IndexedDB load has resolved, so a load started while idle
 * cannot partially overwrite a run that began while the record was loading.
 */
export function applyProjectAtomically(
  activity: ProjectApplicationActivity,
  commit: () => void,
): void {
  if (activity.processing || activity.retrying || activity.comparing) {
    throw new ProjectApplicationBusyError();
  }
  commit();
}
