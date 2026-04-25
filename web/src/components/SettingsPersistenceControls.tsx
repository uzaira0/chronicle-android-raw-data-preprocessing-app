import { useRef, type ReactElement } from "react";

import {
  buildOptionsExportBlob,
  readOptionsFile,
} from "@/lib/settingsPersistence";
import type { BrowserProcessingOptions } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  onImport: (next: BrowserProcessingOptions) => void;
  onStatus: (message: string, isError?: boolean) => void;
};

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SettingsPersistenceControls({
  options,
  onImport,
  onStatus,
}: Props): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="settings-persistence" aria-label="Settings persistence">
      <span className="text-faint u-meta-xs">Settings auto-save in this browser.</span>
      <button
        type="button"
        className="btn btn--ghost"
        data-testid="export-settings-button"
        onClick={() => {
          downloadBlob("chronicle-preprocessor-settings.json", buildOptionsExportBlob(options));
        }}
      >
        Export settings
      </button>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => inputRef.current?.click()}
      >
        Import settings
      </button>
      <input
        ref={inputRef}
        className="visually-hidden-file-input"
        data-testid="import-settings-input"
        type="file"
        accept="application/json,.json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.currentTarget.value = "";
          if (!file) return;
          void readOptionsFile(file)
            .then((next) => {
              onImport(next);
              onStatus("Settings imported.");
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              onStatus(`Could not import settings: ${message}`, true);
            });
        }}
      />
    </div>
  );
}
