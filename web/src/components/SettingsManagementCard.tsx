import { useEffect, useRef, useState, type ReactElement } from "react";

import { ResetDefaultsButton } from "@/components/ResetDefaultsButton";
import {
  buildOptionsExportBlob,
  buildPresetsExportBlob,
  persistPresets,
  readOptionsFile,
  readPersistedPresets,
  readPresetsFile,
  type SettingsPreset,
} from "@/lib/settingsPersistence";
import type { BrowserProcessingOptions } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  setOptions: (next: BrowserProcessingOptions) => void;
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

export function SettingsManagementCard({
  options,
  setOptions,
  onStatus,
}: Props): ReactElement {
  const [presets, setPresets] = useState<SettingsPreset[]>(() => readPersistedPresets());
  const [presetName, setPresetName] = useState("");
  const importSettingsRef = useRef<HTMLInputElement | null>(null);
  const importPresetsRef = useRef<HTMLInputElement | null>(null);

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
      const existing = current.find(
        (preset) => preset.name.toLowerCase() === name.toLowerCase(),
      );
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
    <section
      className="settings-management"
      aria-labelledby="settings-management-title"
      data-testid="settings-management"
    >
      <header className="workflow-section__header">
        <div>
          <h3 id="settings-management-title" className="workflow-section__subtitle">
            Settings management
          </h3>
          <p className="workflow-section__intro">
            <strong>Current settings</strong> is the single configuration the next run will use —
            it auto-saves in this browser and there is only one. The{" "}
            <strong>preset library</strong> is a list of named copies you save off and load back
            later when you want to switch between configurations.
          </p>
        </div>
      </header>

      <div className="settings-management__group" aria-labelledby="current-settings-title">
        <h4 id="current-settings-title" className="settings-management__group-title">
          Current settings
        </h4>
        <p className="text-faint u-meta-xs">
          The single active configuration. Auto-saved in this browser. Export saves these exact
          values to a JSON file; import replaces them.
        </p>
        <div className="button-row">
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="export-settings-button"
            onClick={() => {
              downloadBlob(
                "chronicle-preprocessor-settings.json",
                buildOptionsExportBlob(options),
              );
            }}
          >
            Export settings
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => importSettingsRef.current?.click()}
          >
            Import settings
          </button>
          <ResetDefaultsButton options={options} onReset={setOptions} />
          <input
            ref={importSettingsRef}
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
                  setOptions(next);
                  onStatus("Settings imported.");
                })
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : String(error);
                  onStatus(`Could not import settings: ${message}`, true);
                });
            }}
          />
        </div>
      </div>

      <div className="settings-management__group" aria-labelledby="preset-library-title">
        <h4 id="preset-library-title" className="settings-management__group-title">
          Preset library
        </h4>
        <p className="text-faint u-meta-xs">
          A collection of named configurations you keep around. Save snapshots of the current
          settings under any name, then load them later to swap configurations. Export/import here
          moves the entire library — not the active settings above.
        </p>
        <div className="preset-manager__save">
          <input
            className="input"
            value={presetName}
            placeholder="Preset name"
            data-testid="preset-name-input"
            onChange={(event) => setPresetName(event.target.value)}
          />
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="save-preset-button"
            onClick={savePreset}
          >
            Save preset
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              downloadBlob("chronicle-presets.json", buildPresetsExportBlob(presets))
            }
            disabled={!presets.length}
          >
            Export preset library
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => importPresetsRef.current?.click()}
          >
            Import preset library
          </button>
          <input
            ref={importPresetsRef}
            className="visually-hidden-file-input"
            data-testid="import-presets-input"
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
                  setPresets((current) => {
                    const byName = new Map(
                      current.map((preset) => [preset.name.toLowerCase(), preset] as const),
                    );
                    let replaced = 0;
                    for (const preset of imported) {
                      const key = preset.name.toLowerCase();
                      if (byName.has(key)) replaced += 1;
                      byName.set(key, preset);
                    }
                    const merged = Array.from(byName.values());
                    const added = imported.length - replaced;
                    onStatus(
                      `Imported ${imported.length} preset${imported.length === 1 ? "" : "s"}: ` +
                        `${added} new, ${replaced} replaced.`,
                    );
                    return merged;
                  });
                })
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : String(error);
                  onStatus(`Could not import presets: ${message}`, true);
                });
            }}
          />
        </div>
        {presets.length ? (
          <div className="preset-list" data-testid="preset-list">
            {presets.map((preset) => (
              <article className="preset-row" key={preset.id}>
                <div>
                  <strong>{preset.name}</strong>
                  <span className="text-faint u-meta-xs">
                    Updated {new Date(preset.updatedAt).toLocaleString()}
                  </span>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                      setOptions(preset.options);
                      onStatus(`Loaded preset: ${preset.name}`);
                    }}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger-ghost"
                    onClick={() =>
                      setPresets((current) =>
                        current.filter((entry) => entry.id !== preset.id),
                      )
                    }
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
      </div>
    </section>
  );
}
