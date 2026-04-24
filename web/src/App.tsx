import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { getMatcherVersion, processRawCsv } from "@/lib/chronicleMatcher";
import { sampleRawCsv } from "@/lib/sampleRawCsv";
import type { BrowserProcessingOptions, ProcessedFileResult } from "@/lib/types";

const DEFAULT_OPTIONS: BrowserProcessingOptions = {
  allowStopEventReuse: false,
  useActivityStoppedAsFallback: true,
  applyThresholdToFallback: true,
  longDurationThresholdHours: 12,
  correctDuplicateEventTimestamps: true,
  selectedTimezone: "",
  timezoneHandling: "primary-filter",
};

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [matcherVersion, setMatcherVersion] = useState<string>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [results, setResults] = useState<ProcessedFileResult[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [options, setOptions] = useState<BrowserProcessingOptions>(DEFAULT_OPTIONS);

  const summary = useMemo(() => {
    const sessions = results.reduce((total, result) => total + result.sessionCount, 0);
    return {
      files: results.length,
      sessions,
    };
  }, [results]);

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

  const runSample = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const result = await processRawCsv("Sample Chronicle Raw.csv", sampleRawCsv, options);
      setResults([result]);
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
      const nextResults: ProcessedFileResult[] = [];
      for (const file of uploadedFiles) {
        const text = await file.text();
        nextResults.push(await processRawCsv(file.name, text, options));
      }
      setResults(nextResults);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsRunning(false);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUploadedFiles(Array.from(event.target.files ?? []));
    setResults([]);
    setError(null);
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Chronicle Local-First Web Port</p>
        <h1>Raw Chronicle CSV in. Local preprocessing out.</h1>
        <p className="lede">
          This browser build now accepts actual Chronicle raw data CSV files, preprocesses them
          locally in a worker, runs the real Rust app-usage matcher in WASM, and generates
          downloadable preprocessed CSV output without uploading your files anywhere.
        </p>
        <div className="badge-row">
          <span>Local processing only</span>
          <span>No file uploads</span>
          <span>{isOffline ? "Offline now" : "Online-capable"}</span>
          <span>Matcher v{matcherVersion}</span>
        </div>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Load Raw Files</h2>
          <p>
            Use Chronicle raw CSV files with the standard columns such as
            <code> event_timestamp</code>, <code>interaction_type</code>, and
            <code> app_package_name</code>.
          </p>
          <label className="upload">
            <span>Select one or more raw Chronicle CSV files</span>
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={onFileChange}
            />
          </label>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => {
                void processUploadedFiles();
              }}
              disabled={isRunning}
            >
              {isRunning ? "Processing..." : "Process uploaded CSV files"}
            </button>
            <button
              className="secondary"
              onClick={() => {
                void runSample();
              }}
              disabled={isRunning}
            >
              Run bundled sample raw CSV
            </button>
          </div>
          <p className="small-note">
            Selected files: {uploadedFiles.length ? uploadedFiles.map((file) => file.name).join(", ") : "none"}
          </p>
        </article>

        <article className="panel">
          <h2>Processing Settings</h2>
          <div className="settings-grid">
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
                <option value="primary-filter">Filter to primary timezone per file</option>
                <option value="selected-filter">Filter to selected timezone</option>
                <option value="selected-convert">Convert all rows to selected timezone</option>
              </select>
            </label>
            <label>
              <span>Selected timezone</span>
              <input
                value={options.selectedTimezone ?? ""}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, selectedTimezone: event.target.value }))
                }
                placeholder="America/Chicago"
              />
            </label>
            <label>
              <span>Long duration threshold (hours)</span>
              <input
                type="number"
                min="1"
                max="48"
                value={options.longDurationThresholdHours}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    longDurationThresholdHours: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={options.correctDuplicateEventTimestamps}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    correctDuplicateEventTimestamps: event.target.checked,
                  }))
                }
              />
              <span>Correct duplicate event timestamps</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={options.allowStopEventReuse}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    allowStopEventReuse: event.target.checked,
                  }))
                }
              />
              <span>Allow stop-event reuse</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={options.useActivityStoppedAsFallback}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    useActivityStoppedAsFallback: event.target.checked,
                  }))
                }
              />
              <span>Use Activity Stopped fallback</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={options.applyThresholdToFallback}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    applyThresholdToFallback: event.target.checked,
                  }))
                }
              />
              <span>Apply threshold to fallback</span>
            </label>
          </div>
        </article>

        <article className="panel">
          <h2>Run Summary</h2>
          <dl className="key-values">
            <div>
              <dt>Processed files</dt>
              <dd>{summary.files}</dd>
            </div>
            <div>
              <dt>Derived sessions</dt>
              <dd>{summary.sessions}</dd>
            </div>
          </dl>
          <p className="small-note">
            This web port currently runs the app-usage preprocessing path on raw Chronicle CSVs.
          </p>
          {error ? <p className="error-text">{error}</p> : null}
        </article>
      </section>

      <section className="results-grid">
        {results.map((result) => (
          <article
            key={result.outputFileName}
            className="panel"
          >
            <div className="result-header">
              <div>
                <p className="eyebrow">Output</p>
                <h2>{result.outputFileName}</h2>
              </div>
              <button
                className="primary"
                onClick={() => downloadTextFile(result.outputFileName, result.csv)}
              >
                Download CSV
              </button>
            </div>
            <dl className="key-values">
              <div>
                <dt>Input rows</dt>
                <dd>{result.originalRowCount}</dd>
              </div>
              <div>
                <dt>Post-clean rows</dt>
                <dd>{result.processedRowCount}</dd>
              </div>
              <div>
                <dt>Sessions</dt>
                <dd>{result.sessionCount}</dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>{result.timezone}</dd>
              </div>
            </dl>
            <pre className="code-block">{result.csv.slice(0, 8000)}</pre>
          </article>
        ))}
      </section>
    </main>
  );
}
