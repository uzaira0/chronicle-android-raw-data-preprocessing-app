import { useEffect, useRef, useState, type ReactElement } from "react";

import {
  buildPresetsExportBlob,
  persistPresets,
  readPersistedPresets,
  readPresetsFile,
  type SettingsPreset,
} from "@/lib/settingsPersistence";
import type { BrowserProcessingOptions } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  onApply: (options: BrowserProcessingOptions) => void;
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

export function PresetManager({ options, onApply, onStatus }: Props): ReactElement {
  const [presets, setPresets] = useState<SettingsPreset[]>(() => readPersistedPresets());
  const [presetName, setPresetName] = useState("");
  const importRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    persistPresets(presets);
  }, [presets]);

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) {
      onStatus("Name the preset before saving.", true);
      return;
    }
    const now = new Date().toISOString();
    setPresets((current) => {
      const existing = current.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        return current.map((preset) =>
          preset.id === existing.id ? { ...preset, updatedAt: now, options } : preset,
        );
      }
      return [
        ...current,
        {
          id: crypto.randomUUID(),
          name,
          createdAt: now,
          updatedAt: now,
          options,
        },
      ];
    });
    setPresetName("");
    onStatus(`Preset saved: ${name}`);
  };

  return (
    <section className="preset-manager" aria-labelledby="settings-title">
      <div className="workflow-section__header">
        <div>
          <h2 id="settings-title" className="workflow-section__title">Settings</h2>
          <p className="workflow-section__intro">
            Save your own option presets, load them later, or export/import a full preset set.
          </p>
        </div>
      </div>
      <div className="preset-manager__save">
        <input
          className="input"
          value={presetName}
          placeholder="Preset name"
          onChange={(event) => setPresetName(event.target.value)}
        />
        <button type="button" className="btn btn--secondary" onClick={savePreset}>
          Save preset
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => downloadBlob("chronicle-presets.json", buildPresetsExportBlob(presets))}
          disabled={!presets.length}
        >
          Export presets
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => importRef.current?.click()}>
          Import presets
        </button>
        <input
          ref={importRef}
          className="visually-hidden-file-input"
          type="file"
          accept="application/json,.json"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.currentTarget.value = "";
            if (!file) return;
            void readPresetsFile(file)
              .then((imported) => {
                setPresets((current) => [...current, ...imported]);
                onStatus(`Imported ${imported.length} preset${imported.length === 1 ? "" : "s"}.`);
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                onStatus(`Could not import presets: ${message}`, true);
              });
          }}
        />
      </div>
      {presets.length ? (
        <div className="preset-list">
          {presets.map((preset) => (
            <article className="preset-row" key={preset.id}>
              <div>
                <strong>{preset.name}</strong>
                <span className="text-faint u-meta-xs">
                  Updated {new Date(preset.updatedAt).toLocaleString()}
                </span>
              </div>
              <div className="button-row">
                <button type="button" className="btn btn--primary" onClick={() => onApply(preset.options)}>
                  Load
                </button>
                <button
                  type="button"
                  className="btn btn--danger-ghost"
                  onClick={() => setPresets((current) => current.filter((entry) => entry.id !== preset.id))}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-state">No saved presets yet.</p>
      )}
    </section>
  );
}
