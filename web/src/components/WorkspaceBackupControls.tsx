import { useRef, useState, type ReactElement } from "react";

import {
  exportVerifiedWorkspaceClosure,
  importVerifiedWorkspaceClosure,
} from "@/lib/rustWorkerClient";
import { downloadBlob } from "@/lib/download";
import { failureText } from "@/lib/diagnostics";
import type { ProcessedFileResult } from "@/lib/types";
import type { LiteratureComponentRuntimeExecution } from "@/lib/rustPipelineRuntime";

type Props = {
  results: ProcessedFileResult[];
  componentResult?: LiteratureComponentRuntimeExecution | null;
  onImportStarted?: () => void;
  onComponentRestored?: (result: LiteratureComponentRuntimeExecution) => Promise<void>;
  /**
   * False once the capability probe has found no usable origin-private storage
   * (Safari private browsing, an exhausted quota). Import writes a workspace
   * into that storage, so it is disabled rather than left to fail after the
   * user picks a file. Export only reads an already-saved workspace and is
   * offered per saved result instead.
   */
  durableStorageAvailable?: boolean;
};

function backupName(inputFileName: string): string {
  return `${inputFileName.replace(/\.csv$/i, "")}.chronicle-workspace`;
}

export function WorkspaceBackupControls({ results, componentResult, onImportStarted, onComponentRestored, durableStorageAvailable = true }: Props): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Only a run whose workspace was committed to storage can be exported; an
  // ephemeral run's receipt has no persisted generation and no closure to read.
  const receipts: Array<{ inputFileName: string; receipt: { workspaceId: string; workspaceRootDigest: string } }> = results.flatMap((result) =>
    result.rustRuntimeReceipt?.persistedGeneration !== undefined
      ? [{ inputFileName: result.inputFileName, receipt: result.rustRuntimeReceipt }]
      : [],
  );
  if (componentResult?.artifacts.every((artifact) => artifact.persistedArtifact)) {
    receipts.push({ inputFileName: componentResult.manifest.inputFileName, receipt: componentResult.manifest });
  }

  const exportWorkspace = async (
    inputFileName: string,
    workspaceId: string,
    workspaceRootDigest: string,
  ): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      // The worker hands back the archive Blob itself (already typed
      // application/vnd.chronicle.workspace). Re-wrapping it would copy the
      // whole closure into this thread for no benefit.
      downloadBlob(
        backupName(inputFileName),
        await exportVerifiedWorkspaceClosure(workspaceId, workspaceRootDigest),
      );
      setMessage(`Backup saved for ${inputFileName}.`);
    } catch (error) {
      setMessage(failureText(error, "This backup could not be saved.").message);
    } finally {
      setBusy(false);
    }
  };

  const importWorkspace = async (file: File): Promise<void> => {
    onImportStarted?.();
    setBusy(true);
    setMessage(null);
    try {
      // The picked File is already a lazily-read handle onto the user's disk;
      // it is passed straight through so the archive is never read whole.
      const restored = await importVerifiedWorkspaceClosure(file);
      if (onComponentRestored) {
        const { reopenImportedLiteratureComponent } = await import("@/lib/rustPipelineRuntime");
        const component = await reopenImportedLiteratureComponent(restored.workspaceId, restored.slot.workspaceRootDigest);
        if (component) {
          await onComponentRestored(component);
          setMessage("Backup loaded. Both result tables are ready without processing again.");
          return;
        }
      }
      setMessage(
        "Backup loaded. Add its raw file again to keep working on this run.",
      );
    } catch (error) {
      setMessage(failureText(error, "This backup could not be loaded.").message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <section className="result-panel" aria-label="Run backups">
      <header className="result-panel__header">
        <div>
          <h2 className="result-panel__title">Run backups</h2>
          <span className="result-panel__summary">
            Save a run and all its results to one file, or load a saved run back in.
          </span>
        </div>
        <div className="result-panel__actions">
          {receipts.map(({ inputFileName, receipt }) => (
            <button
              key={`${inputFileName}:${receipt.workspaceRootDigest}`}
              type="button"
              className="btn btn--secondary"
              data-testid="export-workspace-closure"
              disabled={busy}
              onClick={() => {
                void exportWorkspace(inputFileName, receipt.workspaceId, receipt.workspaceRootDigest);
              }}
            >
              Back up {inputFileName}
            </button>
          ))}
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="import-workspace-closure"
            disabled={busy || !durableStorageAvailable}
            onClick={() => inputRef.current?.click()}
          >
            Load a backup
          </button>
          <input
            ref={inputRef}
            hidden
            type="file"
            accept=".chronicle-workspace,application/vnd.chronicle.workspace"
            data-testid="import-workspace-file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void importWorkspace(file);
            }}
          />
        </div>
      </header>
      {durableStorageAvailable ? null : (
        <p className="warning-text" data-testid="workspace-backup-unavailable">
          Loading a backup needs storage space in this browser, which it is not
          giving right now (for example, in a private window).
        </p>
      )}
      {message ? (
        <p role="status" className="result-restored-note" data-testid="workspace-backup-status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
