import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { PREPROCESSOR_VERSION, resolveDefaultSupportFiles } from "@/lib/browserPipeline";
import {
  WorkerPool,
  discoverTimezones,
  processRawCsv,
  processRawCsvBytesViaPool,
} from "@/lib/chronicleMatcher";
import { sampleRawCsv, SAMPLE_FILE_NAME } from "@/lib/sampleRawCsv";
import { ensureNotificationPermission, sendNotification } from "@/lib/notification";
import { hasPersistedOptions, persistOptions, readPersistedOptions } from "@/lib/settingsPersistence";
import { inspectRawFiles, type RawFileInspection } from "@/lib/fileInspection";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFile,
  BrowserSupportFiles,
  ProcessedFileResult,
  ProgressEvent,
  ProgressStepKind,
} from "@/lib/types";

import { DemoSampleCard } from "@/components/DemoSampleCard";
import { FilesAndInputsCard } from "@/components/FilesAndInputsCard";
import { TimezoneCard } from "@/components/TimezoneCard";
import { SessionDetectionCard } from "@/components/SessionDetectionCard";
import { ScreenDetectionCard } from "@/components/ScreenDetectionCard";
import { InteractionSemanticsCard } from "@/components/InteractionSemanticsCard";
import { PerformanceCard } from "@/components/PerformanceCard";
import { ResultPanel } from "@/components/ResultPanel";
import { ResetDefaultsButton } from "@/components/ResetDefaultsButton";
import type { FileProgress } from "@/components/ProgressList";
import { Toast } from "@/components/Toast";
import { SettingsPersistenceControls } from "@/components/SettingsPersistenceControls";
import { WorkflowNav } from "@/components/WorkflowNav";
import { RawFilesCard } from "@/components/RawFilesCard";
import { ProcessPanel } from "@/components/ProcessPanel";
import { PresetManager } from "@/components/PresetManager";
import { SettingsOverviewCard } from "@/components/SettingsOverviewCard";
import { SettingsSearchResults } from "@/components/SettingsSearchResults";

async function readSupportFile(file: File): Promise<BrowserSupportFile> {
  return {
    name: file.name,
    bytes: await file.arrayBuffer(),
  };
}

function getInjectedRuntime(): BrowserProcessingRuntime | undefined {
  return typeof window !== "undefined" ? window.__CHRONICLE_TEST_RUNTIME__ : undefined;
}

const STEP_WEIGHTS: Record<ProgressStepKind, number> = {
  parse: 0.05,
  timezone: 0.05,
  filter: 0.05,
  screen: 0.1,
  matcher: 0.5,
  codebook: 0.05,
  enrich: 0.1,
  output: 0.1,
};

const STEP_ORDER: ProgressStepKind[] = [
  "parse",
  "timezone",
  "filter",
  "screen",
  "matcher",
  "codebook",
  "enrich",
  "output",
];

/**
 * Compute a memory-safe parallel worker count.
 *
 * Each in-flight worker holds, at peak, roughly a 5–10× expansion of its
 * file's input bytes (parsed `CanonicalRow[]`, intermediate matcher buffers,
 * codebook-enriched rows, and a Blob being assembled). Hardcoding 8 workers
 * regardless of input size is what crashes the tab on a 540 MB batch — the
 * sum of in-flight expansions exceeds Chrome's renderer ceiling.
 *
 * Strategy:
 *   - If the user pinned `parallelMaxWorkers`, respect it.
 *   - Otherwise budget ~600 MB for in-flight worker state and divide by an
 *     8× amplification of the average file size.
 *   - Clamp to [1, hardwareConcurrency/2] and never exceed file count.
 */
const PEAK_AMPLIFICATION = 8;
const IN_FLIGHT_BUDGET_BYTES = 600 * 1024 * 1024;

function computeSafeConcurrency(input: {
  fileCount: number;
  totalInputBytes: number;
  userCap: number | undefined;
  hardwareConcurrency: number | undefined;
}): number {
  const { fileCount, totalInputBytes, userCap, hardwareConcurrency } = input;
  if (fileCount <= 1) return 1;
  if (userCap && userCap > 0) {
    return Math.max(1, Math.min(fileCount, Math.floor(userCap)));
  }
  const cores = Math.max(1, Math.floor((hardwareConcurrency ?? 2) / 2));
  const avgBytes = totalInputBytes > 0 ? totalInputBytes / fileCount : 1024;
  const memoryCap = Math.max(
    1,
    Math.floor(IN_FLIGHT_BUDGET_BYTES / Math.max(1, avgBytes * PEAK_AMPLIFICATION)),
  );
  return Math.max(1, Math.min(fileCount, cores, memoryCap));
}

function estimatedFilePercent(current: FileProgress): number {
  if (current.status === "complete") return 1;
  if (current.status === "error") return 1;
  if (current.status === "pending" || !current.stepKind) return 0;
  const stepIndex = STEP_ORDER.indexOf(current.stepKind);
  if (stepIndex < 0) return 0;
  const completedBefore = STEP_ORDER.slice(0, stepIndex).reduce(
    (acc, kind) => acc + STEP_WEIGHTS[kind],
    0,
  );
  const currentContribution = STEP_WEIGHTS[current.stepKind] * (current.percent ?? 0);
  return completedBefore + currentContribution;
}

export default function App(): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<ProcessedFileResult[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [fileInspections, setFileInspections] = useState<RawFileInspection[]>([]);
  const [isInspectingFiles, setIsInspectingFiles] = useState(false);
  const [filterFile, setFilterFile] = useState<File | null>(null);
  const [keepAwakeFile, setKeepAwakeFile] = useState<File | null>(null);
  const [appCodebookFile, setAppCodebookFile] = useState<File | null>(null);
  const [discoveredTimezones, setDiscoveredTimezones] = useState<string[]>([]);
  const [options, setOptions] = useState<BrowserProcessingOptions>(() => readPersistedOptions());
  const [progressByFile, setProgressByFile] = useState<Record<string, FileProgress>>({});
  const [progressOrder, setProgressOrder] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const [settingsQuery, setSettingsQuery] = useState("");
  const startTimeRef = useRef<number>(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    persistOptions(options);
  }, [options]);

  useEffect(() => {
    if (hasPersistedOptions()) {
      setToast({ message: "Last used settings restored.", isError: false });
    }
  }, []);

  const onFilesChange = (files: File[]) => {
    setUploadedFiles(files);
    setFileInspections([]);
    setResults([]);
    setError(null);
    if (!files.length) {
      setIsInspectingFiles(false);
      return;
    }
    setIsInspectingFiles(true);
    void inspectRawFiles(files)
      .then((inspections) => {
        setFileInspections(inspections);
        const timezones = Array.from(
          new Set(inspections.flatMap((inspection) => inspection.timezones)),
        ).sort((left, right) => left.localeCompare(right));
        setDiscoveredTimezones(timezones);
      })
      .catch((inspectionError: unknown) => {
        setToast({
          message:
            inspectionError instanceof Error
              ? inspectionError.message
              : "Could not inspect selected files.",
          isError: true,
        });
      })
      .finally(() => setIsInspectingFiles(false));
  };

  const buildSupportFiles = async (): Promise<BrowserSupportFiles> => ({
    ...(options.useFilterFile && filterFile
      ? { filterFile: await readSupportFile(filterFile) }
      : {}),
    ...(options.useKeepAwakeAppsFile && keepAwakeFile
      ? { keepAwakeAppsFile: await readSupportFile(keepAwakeFile) }
      : {}),
    ...(options.useAppCodebook && appCodebookFile
      ? { appCodebookFile: await readSupportFile(appCodebookFile) }
      : {}),
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
      const timezones = await discoverTimezones(text, getInjectedRuntime());
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
      const result = await processRawCsv(
        SAMPLE_FILE_NAME,
        sampleRawCsv,
        options,
        undefined,
        getInjectedRuntime(),
      );
      setResults([result]);
      setDiscoveredTimezones(result.availableTimezones);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (!isRunning && results.length) {
      resultsRef.current?.focus();
    }
  }, [isRunning, results.length]);

  const updateFileProgress = useCallback(
    (fileName: string, patch: Partial<FileProgress>) => {
      setProgressByFile((current) => ({
        ...current,
        [fileName]: {
          ...(current[fileName] ?? { fileName, status: "pending" }),
          ...patch,
        },
      }));
    },
    [],
  );

  const handleProgressEvent = useCallback(
    (event: ProgressEvent) => {
      if (event.type === "file-start") {
        updateFileProgress(event.fileName, { status: "running", stepKind: "parse", percent: 0 });
      } else if (event.type === "step") {
        updateFileProgress(event.fileName, {
          status: "running",
          stepKind: event.stepKind,
          percent: event.percent,
        });
      } else if (event.type === "file-complete") {
        updateFileProgress(event.fileName, {
          status: event.error ? "error" : "complete",
          percent: 1,
          error: event.error,
        });
      }
    },
    [updateFileProgress],
  );

  const processUploadedFiles = async () => {
    if (!uploadedFiles.length) {
      setError("Choose one or more Chronicle raw CSV files first.");
      return;
    }
    setIsRunning(true);
    setError(null);
    startTimeRef.current = performance.now();

    const order = uploadedFiles.map((file) => file.name);
    setProgressOrder(order);
    setProgressByFile(
      Object.fromEntries(order.map((name) => [name, { fileName: name, status: "pending" }])),
    );
    setToast(null);

    void ensureNotificationPermission();

    let pool: WorkerPool | null = null;
    try {
      const userSupportFiles = await buildSupportFiles();
      const nextResults: ProcessedFileResult[] = new Array(uploadedFiles.length);
      const totalInputBytes = uploadedFiles.reduce((sum, file) => sum + file.size, 0);
      const concurrency = options.parallelProcessing
        ? computeSafeConcurrency({
            fileCount: uploadedFiles.length,
            totalInputBytes,
            userCap: options.parallelMaxWorkers,
            hardwareConcurrency: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined,
          })
        : 1;
      // Resolve bundled-default support files once on the main thread so
      // every worker uses identical bytes (no per-worker fetches), and so
      // the user's uploads win over defaults.
      const supportFiles = await resolveDefaultSupportFiles(options, userSupportFiles);
      pool = concurrency > 1 ? new WorkerPool(concurrency) : null;
      let cursor = 0;
      const failures: string[] = [];
      const runner = async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= uploadedFiles.length) return;
          const file = uploadedFiles[index]!;
          handleProgressEvent({ type: "file-start", fileName: file.name });
          try {
            let result: ProcessedFileResult;
            if (pool) {
              // Zero-copy: transfer ArrayBuffer ownership to the worker so
              // the main thread releases the file content immediately.
              const bytes = await file.arrayBuffer();
              result = await processRawCsvBytesViaPool(
                pool,
                file.name,
                bytes,
                options,
                supportFiles,
                getInjectedRuntime(),
                handleProgressEvent,
              );
            } else {
              const text = await file.text();
              result = await processRawCsv(
                file.name,
                text,
                options,
                supportFiles,
                getInjectedRuntime(),
                handleProgressEvent,
              );
            }
            nextResults[index] = result;
            handleProgressEvent({ type: "file-complete", fileName: file.name, result });
          } catch (fileError) {
            const message = fileError instanceof Error ? fileError.message : String(fileError);
            failures.push(message);
            handleProgressEvent({ type: "file-complete", fileName: file.name, error: message });
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => runner()));

      const successful = nextResults.filter(Boolean);
      setResults(successful);
      setDiscoveredTimezones(
        Array.from(
          new Set(successful.flatMap((result) => result.availableTimezones)),
        ).sort((left, right) => left.localeCompare(right)),
      );

      // Surface a top-level error banner only when every file failed — lets a
      // single malformed file fail loudly while a partially-successful batch
      // shows per-row errors inside ProgressList without dominating the UI.
      if (failures.length && successful.length === 0) {
        setError(failures[0] ?? "Processing failed.");
      }

      const elapsedMs = performance.now() - startTimeRef.current;
      const summary = `Processed ${successful.length}/${uploadedFiles.length} files in ${Math.round(elapsedMs / 1000)}s`;
      const message = failures.length
        ? `${summary} (${failures.length} failed)`
        : summary;
      setToast({ message, isError: failures.length > 0 });

      if (typeof document !== "undefined" && document.hidden) {
        sendNotification(
          failures.length ? "Chronicle: some files failed" : "Chronicle: processing complete",
          message,
        );
      }
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      setToast({ message, isError: true });
    } finally {
      pool?.terminate();
      setIsRunning(false);
    }
  };

  const progressRows = progressOrder.map(
    (name) => progressByFile[name] ?? { fileName: name, status: "pending" },
  );
  const overallPercent =
    progressOrder.length === 0
      ? 0
      : progressOrder.reduce(
          (total, name) =>
            total +
            estimatedFilePercent(progressByFile[name] ?? { fileName: name, status: "pending" }),
          0,
        ) / progressOrder.length;
  const activeWorkflow = isRunning || results.length ? "process" : uploadedFiles.length ? "files" : "settings";
  const settingsSummary =
    options.usageSessionMode === "app_usage"
      ? "App output"
      : options.usageSessionMode === "screen_usage"
        ? "Screen output"
        : "Both outputs";
  const normalizedSettingsQuery = settingsQuery.trim().toLowerCase();
  const shows = (text: string) =>
    !normalizedSettingsQuery || text.toLowerCase().includes(normalizedSettingsQuery);

  return (
    <main className="app-shell">
      <header className="hero hero--with-demo">
        <div className="hero__copy">
          <h1>Chronicle Android Raw Data Preprocessor</h1>
          <p className="lede">
            Drop one or more raw Chronicle CSVs to generate the preprocessed app-usage and
            screen-usage outputs. This app runs entirely in your browser — your data never
            leaves your device.
          </p>
        </div>
        <DemoSampleCard
          isRunning={isRunning}
          onRun={() => {
            void runSample();
          }}
        />
      </header>

      <WorkflowNav
        active={activeWorkflow}
        settingsSummary={settingsSummary}
        fileCount={uploadedFiles.length}
        isRunning={isRunning}
      />

      <section id="settings" className="workflow-section" aria-labelledby="settings-title">
        <div className="settings-command">
          <div>
            <h2 id="settings-title" className="workflow-section__title">Settings</h2>
            <p className="workflow-section__intro">
              Search every option, then save custom presets once the settings are right.
            </p>
          </div>
          <label className="settings-search settings-search--command">
            <span className="settings-search__eyebrow">Full Settings Search</span>
            <input
              className="input settings-search__input"
              placeholder="Search timezone, codebook, parallel, screen, session..."
              value={settingsQuery}
              data-testid="settings-search-input"
              onChange={(event) => setSettingsQuery(event.target.value)}
            />
          </label>
        </div>
        <SettingsSearchResults query={settingsQuery} />
        <PresetManager
          options={options}
          onApply={setOptions}
          onStatus={(message, isError = false) => setToast({ message, isError })}
        />
        <SettingsOverviewCard options={options} setOptions={setOptions} />
        <div className="settings-stack">
          {shows("support files filter keep awake codebook") ? (
            <FilesAndInputsCard
              options={options}
              setOptions={setOptions}
              filterFile={filterFile}
              setFilterFile={setFilterFile}
              keepAwakeFile={keepAwakeFile}
              setKeepAwakeFile={setKeepAwakeFile}
              appCodebookFile={appCodebookFile}
              setAppCodebookFile={setAppCodebookFile}
            />
          ) : null}
          {shows("timezone conversion selected primary") ? (
            <TimezoneCard
              options={options}
              setOptions={setOptions}
              discoveredTimezones={discoveredTimezones}
              hasFiles={uploadedFiles.length > 0}
              isRunning={isRunning}
              onDiscover={() => {
                void discoverAvailableTimezones();
              }}
            />
          ) : null}
          {shows("session detection duration thresholds duplicate fallback stop") ? (
            <SessionDetectionCard options={options} setOptions={setOptions} />
          ) : null}
          {shows("screen detection autolock keyguard manual") ? (
            <ScreenDetectionCard options={options} setOptions={setOptions} />
          ) : null}
          {shows("interaction semantics remove stop usage") ? (
            <InteractionSemanticsCard options={options} setOptions={setOptions} />
          ) : null}
          {shows("performance parallel workers") ? (
            <PerformanceCard options={options} setOptions={setOptions} />
          ) : null}
        </div>
      </section>

      <RawFilesCard
        uploadedFiles={uploadedFiles}
        inspections={fileInspections}
        isInspecting={isInspectingFiles}
        onFilesChange={onFilesChange}
        onClear={() => {
          onFilesChange([]);
          setProgressOrder([]);
          setProgressByFile({});
        }}
        isRunning={isRunning}
      />

      <ProcessPanel
        options={options}
        setOptions={setOptions}
        uploadedFiles={uploadedFiles}
        inspections={fileInspections}
        isRunning={isRunning}
        onProcess={() => {
          void processUploadedFiles();
        }}
        progressRows={progressRows}
        overallPercent={overallPercent}
      />

      <div ref={resultsRef} tabIndex={-1} aria-live="polite">
        <ResultPanel
          results={results}
          error={error}
          options={options}
          expectedFileCount={uploadedFiles.length}
          progressRows={progressRows}
        />
      </div>

      <footer className="app-footer">
        <div className="footer-actions">
          <ResetDefaultsButton options={options} onReset={setOptions} />
          <SettingsPersistenceControls
            options={options}
            onImport={setOptions}
            onStatus={(message, isError = false) => setToast({ message, isError })}
          />
          <details className="app-info">
            <summary>App info</summary>
            <span>Version {PREPROCESSOR_VERSION}</span>
            <span>Build 2026-04-25</span>
            <span>Bundled codebook available</span>
          </details>
        </div>
      </footer>
      {toast ? (
        <Toast
          message={toast.message}
          isError={toast.isError}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </main>
  );
}
