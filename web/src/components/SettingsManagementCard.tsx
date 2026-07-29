import { useEffect, useRef, useState, type ReactElement } from "react";
import { ToggleField } from "@/components/ToggleField";

import { ResetDefaultsButton } from "@/components/ResetDefaultsButton";
import {
  buildConfigExportBlob,
  buildShareableConfigUrl,
  persistPresets,
  readConfigFile,
  readPersistedPresets,
  type SettingsPreset,
} from "@/lib/settingsPersistence";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { BROWSER_OPTION_TOOLTIPS } from "@/lib/generatedContract";
import { downloadBlob } from "@/lib/download";
import type { BrowserProcessingOptions } from "@/lib/types";
import { safeUuid } from "@/lib/uuid";

const OPTION_TOOLTIPS = BROWSER_OPTION_TOOLTIPS as Record<string, { title?: string } | undefined>;

function optionLabel(key: string): string {
  return (
    OPTION_TOOLTIPS[key]?.title ??
    key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase()).trim()
  );
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    const a = (left ?? []) as unknown[];
    const b = (right ?? []) as unknown[];
    return a.length === b.length && a.every((entry, index) => entry === b[index]);
  }
  return left === right;
}

function formatPresetValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? `[${value.join(", ")}]` : "(none)";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === undefined || value === null || value === "") return "(default)";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "(invalid)";
}

type PresetDiffEntry = { key: string; label: string; from: string; to: string };

function diffPresetOptions(
  current: BrowserProcessingOptions,
  next: BrowserProcessingOptions,
): PresetDiffEntry[] {
  const keys = Object.keys(DEFAULT_BROWSER_OPTIONS) as Array<keyof BrowserProcessingOptions>;
  return keys
    .filter((key) => !valuesEqual(current[key], next[key]))
    .map((key) => ({
      key: String(key),
      label: optionLabel(String(key)),
      from: formatPresetValue(current[key]),
      to: formatPresetValue(next[key]),
    }));
}

type Props = {
  options: BrowserProcessingOptions;
  setOptions: (next: BrowserProcessingOptions) => void;
  hideDemoMetadata: boolean;
  onHideDemoMetadataChange: (next: boolean) => void;
  onStatus: (message: string, isError?: boolean) => void;
};

export function SettingsManagementCard({
  options,
  setOptions,
  hideDemoMetadata,
  onHideDemoMetadataChange,
  onStatus,
}: Props): ReactElement {
  const [presets, setPresets] = useState<SettingsPreset[]>(() => readPersistedPresets());
  const [presetName, setPresetName] = useState("");
  const importConfigRef = useRef<HTMLInputElement | null>(null);
  // Pre-reset snapshot so the user can undo a "Reset all to defaults".
  const [undoSnapshot, setUndoSnapshot] = useState<BrowserProcessingOptions | null>(null);
  // Name awaiting an overwrite confirmation (a preset with that name exists).
  const [pendingOverwriteName, setPendingOverwriteName] = useState<string | null>(null);
  // Preset whose changes are being previewed before applying.
  const [pendingLoad, setPendingLoad] = useState<SettingsPreset | null>(null);

  useEffect(() => {
    persistPresets(presets);
  }, [presets]);

  const performSave = (name: string) => {
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
        { id: safeUuid(), name, createdAt: now, updatedAt: now, options },
      ];
    });
    setPresetName("");
    setPendingOverwriteName(null);
    onStatus(`Preset saved: ${name}`);
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) {
      onStatus("Name the preset before saving.", true);
      return;
    }
    // Close any open load-diff so the two confirmations can't be live at once
    // (and an Apply can't act on a now-stale snapshot).
    setPendingLoad(null);
    const existing = presets.find(
      (preset) => preset.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      // Don't silently clobber a same-named preset; ask first.
      setPendingOverwriteName(name);
      return;
    }
    performSave(name);
  };

  const handleReset = (next: BrowserProcessingOptions) => {
    setUndoSnapshot(options);
    setOptions(next);
    onStatus("All settings reset to defaults.");
  };

  const pendingLoadDiff = pendingLoad ? diffPresetOptions(options, pendingLoad.options) : [];

  // Move focus into the load-diff dialog when it opens (WAI-ARIA: a dialog must
  // take focus) so keyboard/screen-reader users land on its controls.
  const pendingLoadCancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (pendingLoad) pendingLoadCancelRef.current?.focus();
  }, [pendingLoad]);

  return (
    <section
      className="settings-management"
      aria-labelledby="settings-management-title"
      data-testid="settings-management"
      data-settings-anchor="management"
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
        <ToggleField
          label="Demo mode: hide file/participant/date labels"
          checked={hideDemoMetadata}
          onChange={onHideDemoMetadataChange}
          tooltip={
            {
              body: "Turn on for public screens and demos: file names, participant ids, and dates are replaced with pseudonyms.",
            }
          }
          testId="toggle-demo-display-mode"
        />
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
          <ResetDefaultsButton options={options} onReset={handleReset} />
          {undoSnapshot ? (
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="undo-reset-button"
              onClick={() => {
                const snapshot = undoSnapshot;
                setUndoSnapshot(null);
                setOptions(snapshot);
                onStatus("Reset undone — previous settings restored.");
              }}
            >
              Undo reset
            </button>
          ) : null}
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
        {pendingOverwriteName ? (
          <div className="inline-confirm" role="alert" data-testid="preset-overwrite-confirm">
            <span>
              A preset named “{pendingOverwriteName}” already exists. Overwrite it with the
              current settings?
            </span>
            <div className="button-row">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setPendingOverwriteName(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                data-testid="preset-overwrite-confirm-button"
                onClick={() => performSave(pendingOverwriteName)}
              >
                Overwrite
              </button>
            </div>
          </div>
        ) : null}
        {pendingLoad ? (
          <div className="preset-diff" role="dialog" aria-label="Preset changes" data-testid="preset-diff">
            <div className="preset-diff__head">
              <strong>Load “{pendingLoad.name}”</strong>
              <span className="text-faint u-meta-xs">
                {pendingLoadDiff.length
                  ? `${pendingLoadDiff.length} setting${pendingLoadDiff.length === 1 ? "" : "s"} will change`
                  : "No differences from your current settings"}
              </span>
            </div>
            {pendingLoadDiff.length ? (
              <ul className="preset-diff__list">
                {pendingLoadDiff.map((entry) => (
                  <li key={entry.key}>
                    <span className="preset-diff__label">{entry.label}</span>
                    <span className="preset-diff__change">
                      <span className="preset-diff__from">{entry.from}</span>
                      <span aria-hidden="true"> → </span>
                      <span className="preset-diff__to">{entry.to}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="button-row">
              <button
                ref={pendingLoadCancelRef}
                type="button"
                className="btn btn--ghost"
                onClick={() => setPendingLoad(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="preset-apply-button"
                disabled={!pendingLoadDiff.length}
                onClick={() => {
                  setOptions(pendingLoad.options);
                  onStatus(`Loaded preset: ${pendingLoad.name}`);
                  setPendingLoad(null);
                }}
              >
                Apply changes
              </button>
            </div>
          </div>
        ) : null}
        {presets.length ? (
          <div className="preset-list" data-testid="preset-list">
            {presets.map((preset) => (
              <article className="preset-row" key={preset.id}>
                <div>
                  <strong>{preset.name}</strong>
                  <span className="text-faint u-meta-xs">
                    Created {new Date(preset.createdAt).toLocaleDateString()} · Updated{" "}
                    {new Date(preset.updatedAt).toLocaleString()}
                  </span>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    data-testid="preset-load-button"
                    onClick={() => {
                      setPendingOverwriteName(null);
                      setPendingLoad(preset);
                    }}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger-ghost"
                    onClick={() => {
                      // If this preset's load-diff is open, close it so Apply can't
                      // act on a now-deleted preset.
                      if (pendingLoad?.id === preset.id) setPendingLoad(null);
                      setPresets((current) =>
                        current.filter((entry) => entry.id !== preset.id),
                      );
                    }}
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
