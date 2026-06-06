import { useEffect, useRef, useState, type ReactElement } from "react";

import { ResetDefaultsButton } from "@/components/ResetDefaultsButton";
import {
  buildConfigExportBlob,
  buildShareableConfigUrl,
  persistPresets,
  readConfigFile,
  readPersistedPresets,
  type SettingsPreset,
} from "@/lib/settingsPersistence";
import type { BrowserProcessingOptions } from "@/lib/types";
import { safeUuid } from "@/lib/uuid";

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
  const importConfigRef = useRef<HTMLInputElement | null>(null);

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
          id: safeUuid(),
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
            One config file holds everything: the active settings the next run will use, plus your
            saved presets. Export downloads the whole config; import replaces it. Active settings
            and presets both save automatically in this browser, so import and export are only for moving between
            machines or sharing.
          </p>
        </div>
      </header>

      <div className="settings-management__group" aria-labelledby="config-io-title">
        <h4 id="config-io-title" className="settings-management__group-title">
          Config (active settings + presets)
        </h4>
        <p className="text-faint u-meta-xs">
          Export writes one JSON file containing the active settings and every saved preset.
          Import replaces both. Reset defaults only touches the active settings, not the preset
          library.
        </p>
        <div className="button-row">
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="export-config-button"
            onClick={() => {
              downloadBlob(
                "chronicle-config.json",
                buildConfigExportBlob(options, presets),
              );
            }}
          >
            Export config ({presets.length} preset{presets.length === 1 ? "" : "s"})
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="import-config-button"
            onClick={() => importConfigRef.current?.click()}
          >
            Import config (replaces both)
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="share-config-button"
            onClick={() => {
              const url = buildShareableConfigUrl(options, window.location.href);
              const clipboard = navigator.clipboard;
              if (!clipboard) {
                onStatus(`Copy not available. Share link: ${url}`, true);
                return;
              }
              void clipboard.writeText(url).then(
                () => onStatus("Shareable settings link copied to clipboard."),
                () => onStatus(`Could not copy. Share link: ${url}`, true),
              );
            }}
          >
            Copy share link
          </button>
          <ResetDefaultsButton options={options} onReset={setOptions} />
          <input
            ref={importConfigRef}
            className="visually-hidden-file-input"
            data-testid="import-config-input"
            type="file"
            accept="application/json,.json"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.currentTarget.value = "";
              if (!file) return;
              void readConfigFile(file)
                .then((next) => {
                  setOptions(next.options);
                  setPresets(next.presets);
                  onStatus(
                    `Config imported: active settings replaced, ${next.presets.length} preset` +
                      `${next.presets.length === 1 ? "" : "s"} loaded.`,
                  );
                })
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : String(error);
                  onStatus(`Could not import config: ${message}`, true);
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
          Snapshots of named configurations you keep locally for quick switching. Save preset
          captures the current active settings under a name. Load applies one back. Presets
          travel inside the config file above. There is no separate file for them.
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
