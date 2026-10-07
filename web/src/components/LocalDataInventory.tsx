import type { ReactElement } from "react";

/**
 * What `resetLocalData` (lib/localDataReset.ts) deletes, in plain words. Shown
 * in every confirmation that runs it, so the list and the code stay one
 * statement: change both together.
 */
export function LocalDataInventory(): ReactElement {
  return (
    <>
      <p>This permanently deletes, from this browser only:</p>
      <ul data-testid="local-data-inventory">
        <li>every processed result and its saved history (participant-level tables)</li>
        <li>the cached last run that reopens results after a reload</li>
        <li>every saved project, including any raw files bundled into a project</li>
        <li>your saved settings and every settings preset</li>
        <li>the log of recent errors kept for the diagnostic report</li>
        <li>any cached run or workspace left by an earlier version of this app</li>
        <li>the app’s offline copy; it downloads again on the next visit</li>
      </ul>
      <p>
        Raw CSV files on your computer, files you downloaded, and exported config or workspace
        backups are not affected. This cannot be undone.
      </p>
    </>
  );
}
