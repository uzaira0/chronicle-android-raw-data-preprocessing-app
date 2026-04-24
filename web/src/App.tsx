import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  BOOLEAN_OPTION_CONTROLS,
  DEFAULT_BROWSER_OPTIONS,
  INTERACTION_TYPES_TO_REMOVE_OPTIONS,
  OTHER_INTERACTION_TYPE_OPTIONS,
  SAME_APP_INTERACTION_TYPE_OPTIONS,
  TIMEZONE_HANDLING_OPTIONS,
  USAGE_SESSION_MODE_OPTIONS,
} from "@/lib/browserPipeline";
import {
  discoverTimezones,
  getMatcherVersion,
  processRawCsv,
  processRawCsvIsolated,
} from "@/lib/chronicleMatcher";
import { sampleRawCsv } from "@/lib/sampleRawCsv";
import type {
  BrowserProcessingOptions,
  BrowserSupportFile,
  BrowserSupportFiles,
  ProcessedFileResult,
} from "@/lib/types";

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseThresholds(value: string): number[] {
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part) && part > 0);
}

async function readSupportFile(file: File | null): Promise<BrowserSupportFile | null> {
  if (!file) {
    return null;
  }
  return {
    name: file.name,
    bytes: await file.arrayBuffer(),
  };
}

function ToggleGroup(props: {
  title: string;
  options: Array<{ label: string; value: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { title, options, selected, onChange } = props;
  return (
    <fieldset className="checklist">
      <legend>{title}</legend>
      {options.map((option) => (
        <label key={option.value} className="check-item">
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            onChange={(event) => {
              if (event.target.checked) {
                onChange([...selected, option.value]);
              } else {
                onChange(selected.filter((value) => value !== option.value));
              }
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export default function App() {
  const [matcherVersion, setMatcherVersion] = useState<string>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [results, setResults] = useState<ProcessedFileResult[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [filterFile, setFilterFile] = useState<File | null>(null);
  const [keepAwakeFile, setKeepAwakeFile] = useState<File | null>(null);
  const [appCodebookFile, setAppCodebookFile] = useState<File | null>(null);
  const [discoveredTimezones, setDiscoveredTimezones] = useState<string[]>([]);
  const [thresholdInputs, setThresholdInputs] = useState({
    longUsageDurationThresholds: DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds.join(", "),
    longDataTimeGapThresholds: DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds.join(", "),
  });
  const [options, setOptions] = useState<BrowserProcessingOptions>(DEFAULT_BROWSER_OPTIONS);

  const summary = useMemo(() => {
    return results.reduce(
      (totals, result) => ({
        files: totals.files + 1,
        appRows: totals.appRows + result.appRowCount,
        screenRows: totals.screenRows + result.screenRowCount,
      }),
      { files: 0, appRows: 0, screenRows: 0 },
    );
  }, [results]);

  const knownTimezones = useMemo(() => {
    const systemTimezones =
      typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return Array.from(new Set([...systemTimezones, ...discoveredTimezones])).sort((left, right) =>
      left.localeCompare(right),
    );
  }, [discoveredTimezones]);

  useEffect(() => {
    void getMatcherVersion()
      .then(setMatcherVersion)
      .catch((loadError: unknown) => {
        setMatcherVersion("unavailable");
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUploadedFiles(Array.from(event.target.files ?? []));
    setResults([]);
    setError(null);
  };

  const onThresholdChange = (
    key: "longUsageDurationThresholds" | "longDataTimeGapThresholds",
    value: string,
  ) => {
    setThresholdInputs((current) => ({ ...current, [key]: value }));
    const parsed = parseThresholds(value);
    setOptions((current) => ({
      ...current,
      [key]: parsed.length ? parsed : DEFAULT_BROWSER_OPTIONS[key],
    }));
  };

  const buildSupportFiles = async (): Promise<BrowserSupportFiles> => ({
    filterFile: options.useFilterFile ? await readSupportFile(filterFile) : null,
    keepAwakeAppsFile: options.useKeepAwakeAppsFile ? await readSupportFile(keepAwakeFile) : null,
    appCodebookFile: options.useAppCodebook ? await readSupportFile(appCodebookFile) : null,
  });

  const discoverAvailableTimezones = async () => {
    if (!uploadedFiles.length) {
      setError("Choose one or more raw Chronicle CSV files first.");
      return;
    }
    setError(null);
    const discovered = new Set<string>();
    for (const file of uploadedFiles) {
      const text = await file.text();
      const timezones = await discoverTimezones(text);
      timezones.forEach((timezone) => discovered.add(timezone));
    }
    const next = Array.from(discovered).sort((left, right) => left.localeCompare(right));
    setDiscoveredTimezones(next);
    if (!options.selectedTimezone && next.length) {
      setOptions((current) => ({ ...current, selectedTimezone: next[0] }));
    }
  };

  const runSample = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const result = await processRawCsv("Sample Chronicle Raw.csv", sampleRawCsv, options);
      setResults([result]);
      setDiscoveredTimezones(result.availableTimezones);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsRunning(false);
    }
  };

  const processUploadedFiles = async () => {
    if (!uploadedFiles.length) {
      setError("Choose one or more Chronicle raw CSV files first.");
      return;
    }
    setIsRunning(true);
    setError(null);
    try {
      const supportFiles = await buildSupportFiles();
      const nextResults: ProcessedFileResult[] = new Array(uploadedFiles.length);
      const concurrency =
        options.parallelProcessing
          ? Math.max(
              1,
              Math.min(
                uploadedFiles.length,
                options.parallelMaxWorkers && options.parallelMaxWorkers > 0
                  ? options.parallelMaxWorkers
                  : Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)),
              ),
            )
          : 1;
      let cursor = 0;
      const runner = async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= uploadedFiles.length) {
            return;
          }
          const file = uploadedFiles[index]!;
          const text = await file.text();
          nextResults[index] =
            concurrency > 1
              ? await processRawCsvIsolated(file.name, text, options, supportFiles)
              : await processRawCsv(file.name, text, options, supportFiles);
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => runner()));
      setResults(nextResults);
      setDiscoveredTimezones(
        Array.from(
          new Set(nextResults.flatMap((result) => result.availableTimezones)),
        ).sort((left, right) => left.localeCompare(right)),
      );
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Chronicle Local-First Web Port</p>
        <h1>Desktop preprocessing options, local browser execution.</h1>
        <p className="lede">
          This build is being pushed toward desktop parity: raw Chronicle CSV goes in, processing
          happens locally in a worker with Rust/WASM matching, and the generated outputs stay on
          this device.
        </p>
        <div className="badge-row">
          <span>Files stay on this device</span>
          <span>No file uploads</span>
          <span>{isOffline ? "Offline now" : "Online-capable"}</span>
          <span>Matcher v{matcherVersion}</span>
        </div>
      </section>

      <section className="panel-grid wide-grid">
        <article className="panel">
          <h2>Load Inputs</h2>
          <label className="upload">
            <span>Select one or more raw Chronicle CSV files</span>
            <input type="file" accept=".csv,text/csv" multiple onChange={onFileChange} />
          </label>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => {
                void processUploadedFiles();
              }}
              disabled={isRunning}
            >
              {isRunning ? "Processing..." : "Process selected files"}
            </button>
            <button
              className="secondary"
              onClick={() => {
                void runSample();
              }}
              disabled={isRunning}
            >
              Run bundled sample
            </button>
            <button
              className="secondary"
              onClick={() => {
                void discoverAvailableTimezones();
              }}
              disabled={isRunning || uploadedFiles.length === 0}
            >
              Find timezones in selected files
            </button>
          </div>
          <p className="small-note">
            Selected raw files:{" "}
            {uploadedFiles.length ? uploadedFiles.map((file) => file.name).join(", ") : "none"}
          </p>

          <div className="support-files">
            <label>
              <span>Optional filter file (`.csv`, `.xlsx`, `.xls`)</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event) => setFilterFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              <span>Optional keep-awake apps file (`.csv`, `.xlsx`, `.xls`)</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event) => setKeepAwakeFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              <span>Optional app codebook file (`.csv`, `.xlsx`, `.xls`)</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event) => setAppCodebookFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </article>

        <article className="panel">
          <h2>Core Options</h2>
          <div className="settings-grid">
            <label>
              <span>Study name</span>
              <input
                value={options.studyName}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, studyName: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Usage output mode</span>
              <select
                value={options.usageSessionMode}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    usageSessionMode: event.target.value as BrowserProcessingOptions["usageSessionMode"],
                  }))
                }
              >
                {USAGE_SESSION_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Timezone handling</span>
              <select
                value={options.timezoneHandling}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    timezoneHandling: event.target.value as BrowserProcessingOptions["timezoneHandling"],
                  }))
                }
              >
                {TIMEZONE_HANDLING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Selected timezone</span>
              <input
                list="known-timezones"
                value={options.selectedTimezone ?? ""}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, selectedTimezone: event.target.value }))
                }
                placeholder="America/Chicago"
              />
              <datalist id="known-timezones">
                {knownTimezones.map((timezone) => (
                  <option key={timezone} value={timezone} />
                ))}
              </datalist>
            </label>
            <label>
              <span>Max session duration threshold (hours)</span>
              <input
                type="number"
                min="1"
                max="48"
                step="0.5"
                value={options.longDurationThresholdHours}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    longDurationThresholdHours: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              <span>Custom app engagement duration (seconds)</span>
              <input
                type="number"
                min="1"
                max="3600"
                value={options.customAppEngagementDuration}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    customAppEngagementDuration: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              <span>Long usage thresholds (hours)</span>
              <input
                value={thresholdInputs.longUsageDurationThresholds}
                onChange={(event) =>
                  onThresholdChange("longUsageDurationThresholds", event.target.value)
                }
              />
            </label>
            <label>
              <span>Long data-gap thresholds (hours)</span>
              <input
                value={thresholdInputs.longDataTimeGapThresholds}
                onChange={(event) =>
                  onThresholdChange("longDataTimeGapThresholds", event.target.value)
                }
              />
            </label>
            <label>
              <span>Minimum usage duration (currently compatibility-only)</span>
              <input
                type="number"
                min="0"
                max="3600"
                value={options.minimumUsageDuration}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    minimumUsageDuration: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              <span>Screen auto-lock timeout (seconds)</span>
              <input
                type="number"
                min="1"
                max="3600"
                value={options.screenUsageAutoLockTimeoutSeconds}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    screenUsageAutoLockTimeoutSeconds: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              <span>Screen auto-lock tolerance (seconds)</span>
              <input
                type="number"
                min="0"
                max="600"
                value={options.screenUsageAutoLockToleranceSeconds}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    screenUsageAutoLockToleranceSeconds: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              <span>Manual-lock max tail gap (seconds)</span>
              <input
                type="number"
                min="0"
                max="600"
                value={options.screenUsageManualLockMaxTailGapSeconds}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    screenUsageManualLockMaxTailGapSeconds: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              <span>Keyguard-near-stop window (seconds)</span>
              <input
                type="number"
                min="0"
                max="60"
                value={options.screenUsageKeyguardNearStopSeconds}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    screenUsageKeyguardNearStopSeconds: Number(event.target.value),
                  }))
                }
              />
            </label>
          </div>
        </article>

        <article className="panel">
          <h2>Toggles</h2>
          <div className="toggle-stack">
            {BOOLEAN_OPTION_CONTROLS.map(({ key, label }) => (
              <label className="toggle" key={key}>
                <input
                  type="checkbox"
                  checked={Boolean(options[key as keyof BrowserProcessingOptions])}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
            <label>
              <span>Max parallel workers</span>
              <input
                type="number"
                min="0"
                max="32"
                value={options.parallelMaxWorkers ?? 0}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    parallelMaxWorkers: Number(event.target.value) > 0 ? Number(event.target.value) : null,
                  }))
                }
              />
            </label>
          </div>
        </article>

        <article className="panel span-two">
          <h2>Interaction Semantics</h2>
          <div className="triple-grid">
            <ToggleGroup
              title="Same-app interaction types to stop usage at"
              options={SAME_APP_INTERACTION_TYPE_OPTIONS}
              selected={options.sameAppInteractionTypesToStopUsageAt}
              onChange={(next) =>
                setOptions((current) => ({
                  ...current,
                  sameAppInteractionTypesToStopUsageAt: next,
                }))
              }
            />
            <ToggleGroup
              title="Other interaction types to stop usage at"
              options={OTHER_INTERACTION_TYPE_OPTIONS}
              selected={options.otherInteractionTypesToStopUsageAt}
              onChange={(next) =>
                setOptions((current) => ({
                  ...current,
                  otherInteractionTypesToStopUsageAt: next,
                }))
              }
            />
            <ToggleGroup
              title="Interaction types to remove from final output"
              options={INTERACTION_TYPES_TO_REMOVE_OPTIONS.map((value) => ({ label: value, value }))}
              selected={options.interactionTypesToRemove}
              onChange={(next) =>
                setOptions((current) => ({
                  ...current,
                  interactionTypesToRemove: next,
                }))
              }
            />
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="result-header">
          <div>
            <h2>Results</h2>
            <p className="small-note">
              Files: {summary.files} | App rows: {summary.appRows} | Screen rows: {summary.screenRows}
            </p>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </div>

        {results.length === 0 ? (
          <p className="empty-state">
            No processed files yet. Load Chronicle raw CSV files, set options, and run the local
            preprocessing pass.
          </p>
        ) : (
          <div className="results-grid">
            {results.map((result) => (
              <article key={result.inputFileName} className="result-card">
                <div className="key-values">
                  <div>
                    <dt>Input</dt>
                    <dd>{result.inputFileName}</dd>
                  </div>
                  <div>
                    <dt>Timezone</dt>
                    <dd>{result.timezone}</dd>
                  </div>
                  <div>
                    <dt>Original Rows</dt>
                    <dd>{result.originalRowCount}</dd>
                  </div>
                  <div>
                    <dt>Processed Rows</dt>
                    <dd>{result.processedRowCount}</dd>
                  </div>
                </div>
                <div className="button-row">
                  {result.outputs.map((output) => (
                    <button
                      key={output.outputFileName}
                      className="primary"
                      onClick={() => downloadTextFile(output.outputFileName, output.csv)}
                    >
                      Download {output.kind} CSV ({output.rowCount} rows)
                    </button>
                  ))}
                </div>
                <pre className="code-block">
                  {result.outputs[0]?.csv.slice(0, 4000) ?? ""}
                </pre>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
