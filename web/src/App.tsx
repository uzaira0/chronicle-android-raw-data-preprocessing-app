import { useEffect, useState, type ChangeEvent } from "react";
import { getMatcherVersion, runMatcher } from "@/lib/chronicleMatcher";
import { sampleInput } from "@/lib/sampleInput";
import type { MatcherInput, MatcherOutput } from "@/lib/types";

function formatArray(values: number[]): string {
  return values.length ? values.join(", ") : "none";
}

async function loadJsonFile(file: File): Promise<MatcherInput> {
  const text = await file.text();
  return JSON.parse(text) as MatcherInput;
}

export default function App() {
  const [matcherVersion, setMatcherVersion] = useState<string>("loading");
  const [input, setInput] = useState<MatcherInput>(sampleInput);
  const [result, setResult] = useState<MatcherOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);

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

  const onRunSample = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const nextResult = await runMatcher(input);
      setResult(nextResult);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsRunning(false);
    }
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const parsed = await loadJsonFile(file);
      setInput(parsed);
      setResult(null);
      setError(null);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Chronicle Local-First Prototype</p>
        <h1>Files stay on this device.</h1>
        <p className="lede">
          This browser build is the first real WASM boundary for Chronicle preprocessing. It runs the
          Rust app-usage matcher in a worker, keeps processing local, and is structured to become an
          offline installable PWA.
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
          <h2>Run The Real Rust Matcher</h2>
          <p>
            Load a local JSON file matching the worker schema, or use the bundled sample event stream.
          </p>
          <label className="upload">
            <span>Load local matcher input JSON</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={onFileChange}
            />
          </label>
          <button
            className="primary"
            onClick={() => {
              void onRunSample();
            }}
            disabled={isRunning}
          >
            {isRunning ? "Running matcher..." : "Run matcher locally"}
          </button>
        </article>

        <article className="panel">
          <h2>Current Input</h2>
          <dl className="key-values">
            <div>
              <dt>Rows</dt>
              <dd>{input.appCodes.length}</dd>
            </div>
            <div>
              <dt>Allow stop reuse</dt>
              <dd>{String(input.options.allowStopEventReuse)}</dd>
            </div>
            <div>
              <dt>Fallback enabled</dt>
              <dd>{String(input.options.useActivityStoppedAsFallback)}</dd>
            </div>
            <div>
              <dt>Threshold hours</dt>
              <dd>{input.options.longDurationThresholdNs / 3_600_000_000_000}</dd>
            </div>
          </dl>
          <pre className="code-block">{JSON.stringify(input, null, 2)}</pre>
        </article>

        <article className="panel">
          <h2>Matcher Output</h2>
          {result ? (
            <>
              <dl className="key-values">
                <div>
                  <dt>Start rows</dt>
                  <dd>{formatArray(result.startIndices)}</dd>
                </div>
                <div>
                  <dt>Stopped starts</dt>
                  <dd>{formatArray(result.stopStartIndices)}</dd>
                </div>
                <div>
                  <dt>Stop events</dt>
                  <dd>{formatArray(result.stopEventIndices)}</dd>
                </div>
                <div>
                  <dt>Missing ends</dt>
                  <dd>{formatArray(result.missingIndices)}</dd>
                </div>
              </dl>
              <pre className="code-block">{JSON.stringify(result, null, 2)}</pre>
            </>
          ) : (
            <p className="empty-state">Run the matcher to see real output from the browser WASM path.</p>
          )}
          {error ? <p className="error-text">{error}</p> : null}
        </article>
      </section>
    </main>
  );
}
