import { useRef, useState, type ReactElement } from "react";

import {
  exportVerifiedWorkspaceClosure,
  importVerifiedWorkspaceClosure,
} from "@/lib/rustWorkerClient";
import { downloadBlob } from "@/lib/download";
import type { ProcessedFileResult } from "@/lib/types";

type Props = {
  results: ProcessedFileResult[];
};

function backupName(inputFileName: string): string {
  return `${inputFileName.replace(/\.csv$/i, "")}.chronicle-workspace`;
}

export function WorkspaceBackupControls({ results }: Props): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const receipts = results.flatMap((result) =>
    result.rustRuntimeReceipt
      ? [{ inputFileName: result.inputFileName, receipt: result.rustRuntimeReceipt }]
      : [],
  );

  const exportWorkspace = async (
    inputFileName: string,
    workspaceId: string,
  ): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      // The worker hands back the archive Blob itself (already typed
      // application/vnd.chronicle.workspace). Re-wrapping it would copy the
      // whole closure into this thread for no benefit.
      downloadBlob(
        backupName(inputFileName),
        await exportVerifiedWorkspaceClosure(workspaceId),
      );
      setMessage(`Verified workspace backup exported for ${inputFileName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const importWorkspace = async (file: File): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      // The picked File is already a lazily-read handle onto the user's disk;
      // it is passed straight through so the archive is never read whole.
      const restored = await importVerifiedWorkspaceClosure(file);
      setMessage(
        `Verified workspace restored at generation ${restored.slot.generation}. Re-add its raw file to resume processing from this root.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <section className="result-panel" aria-label="Verified workspace backups">
      <header className="result-panel__header">
        <div>
          <h2 className="result-panel__title">Verified workspace backups</h2>
          <span className="result-panel__summary">
            Export or restore the complete content-addressed Rust artifact closure.
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
                void exportWorkspace(inputFileName, receipt.workspaceId);
              }}
            >
              Export {inputFileName}
            </button>
          ))}
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="import-workspace-closure"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Import backup
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
      {message ? (
        <p role="status" className="result-restored-note" data-testid="workspace-backup-status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
