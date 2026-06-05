import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { PREPROCESSOR_VERSION, resolveDefaultSupportFiles } from "@/lib/browserPipeline";
import {
  WorkerPool,
  discoverTimezones,
  processRawCsv,
  processRawCsvBytesViaPool,
} from "@/lib/chronicleMatcher";
import { sampleRawCsv, SAMPLE_FILE_NAME } from "@/lib/sampleRawCsv";
import { BUILD_DATE, BUILD_SHA } from "@/lib/buildInfo";
import { ensureNotificationPermission, sendNotification } from "@/lib/notification";
import { clearLastRun, loadLastRun, saveLastRun } from "@/lib/lastRunStore";
import {
  hasPersistedOptions,
  persistOptions,
  readPersistedOptions,
  readSharedConfig,
  sanitizeOptions,
  SHARED_CONFIG_PARAM,
} from "@/lib/settingsPersistence";
import { inspectRawFiles, type RawFileInspection } from "@/lib/fileInspection";
import { applyProgressEvent } from "@/lib/progressReducer";
import { storedFileToFile, type ProjectRecord } from "@/lib/projectsStore";
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
import { TimelineViewPanel } from "@/components/TimelineViewPanel";
import type { FileProgress } from "@/components/ProgressList";
import { Toast } from "@/components/Toast";
import { WorkflowNav, type WorkflowTab } from "@/components/WorkflowNav";
import { RawFilesCard } from "@/components/RawFilesCard";
import { ProcessPanel } from "@/components/ProcessPanel";
import { SettingsManagementCard } from "@/components/SettingsManagementCard";
import { ProjectsCard } from "@/components/ProjectsCard";
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
  const [appsForcingScreenOpenFile, setAppsForcingScreenOpenFile] = useState<File | null>(null);
  const [backgroundAppsFile, setBackgroundAppsFile] = useState<File | null>(null);
  const [appCodebookFile, setAppCodebookFile] = useState<File | null>(null);
  const [discoveredTimezones, setDiscoveredTimezones] = useState<string[]>([]);
  // When options are seeded from a shared link we skip the very first persist so
  // that merely *opening* someone's link does not silently overwrite the
  // recipient's own saved settings. They take over only once the recipient
  // actually edits a setting (any later change persists normally). Set
  // synchronously during init because the persist effect runs before the
  // URL-strip effect below.
  const skipNextPersist = useRef(false);
  const [options, setOptions] = useState<BrowserProcessingOptions>(() => {
    const shared = typeof window === "undefined" ? null : readSharedConfig(window.location.search);
    if (shared) skipNextPersist.current = true;
    return shared ?? readPersistedOptions();
  });
  const [progressByFile, setProgressByFile] = useState<Record<string, FileProgress>>({});
  const [progressOrder, setProgressOrder] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowTab>("settings");
  const [processExpanded, setProcessExpanded] = useState(true);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    persistOptions(options);
  }, [options]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has(SHARED_CONFIG_PARAM)) {
      // Settings already initialized from the shared link; announce it and
      // strip the param so a reload/bookmark doesn't keep re-applying it.
      setToast({
        message: "Settings loaded from shared link. Your saved settings are kept until you change one.",
        isError: false,
      });
      params.delete(SHARED_CONFIG_PARAM);
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (query ? `?${query}` : "") + window.location.hash,
      );
      return;
    }
    if (hasPersistedOptions()) {
      setToast({ message: "Last used settings restored.", isError: false });
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (readSharedConfig(window.location.search)) return;
    let cancelled = false;
    void loadLastRun()
      .then((record) => {
        if (cancelled || !record) return;
        const restoredOptions = sanitizeOptions(record.options);
        setOptions(restoredOptions);
        setResults(record.results);
        const timezones = record.discoveredTimezones.length
          ? record.discoveredTimezones
          : Array.from(new Set(record.results.flatMap((result) => result.availableTimezones))).sort(
              (left, right) => left.localeCompare(right),
            );
        setDiscoveredTimezones(timezones);
        const completed = Object.fromEntries(
          record.results.map((result) => [
            result.inputFileName,
            {
              fileName: result.inputFileName,
              status: "complete" as const,
              stepKind: "output" as const,
              percent: 1,
            },
          ]),
        );
        setProgressOrder(record.results.map((result) => result.inputFileName));
        setProgressByFile(completed);
        setActiveWorkflow("process");
        setProcessExpanded(false);
        setToast({
          message: `Last processed results restored (${record.results.length} ${record.results.length === 1 ? "file" : "files"}).`,
          isError: false,
        });
      })
      .catch(() => {
        // IndexedDB can be unavailable or evicted; processing still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onFilesChange = (files: File[], input: { clearCachedRun?: boolean } = {}) => {
    const { clearCachedRun = true } = input;
    setUploadedFiles(files);
    setFileInspections([]);
    setResults([]);
    setError(null);
    setProcessExpanded(true);
    if (clearCachedRun) void clearLastRun().catch(() => {});
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

  const applyProject = (record: ProjectRecord): void => {
    // Sanitize the stored options (merges over defaults + validates restored
    // values, e.g. drops non-canonical interaction-remap targets) so a project
    // saved against an older schema or hand-edited record still loads safely.
    setOptions(sanitizeOptions(record.options));
    // A project restore replaces the FULL file state so it can't be left
    // inconsistent with the restored option flags (e.g. useFilterFile=true but a
    // stale/other filter still loaded). `supportFiles` is empty for a config-only
    // project, so every slot clears; bundled projects rehydrate their blobs.
    const support = record.supportFiles;
    setFilterFile(support.filterFile ? storedFileToFile(support.filterFile) : null);
    setAppsForcingScreenOpenFile(
      support.appsForcingScreenOpenFile ? storedFileToFile(support.appsForcingScreenOpenFile) : null,
    );
    setBackgroundAppsFile(support.backgroundAppsFile ? storedFileToFile(support.backgroundAppsFile) : null);
    setAppCodebookFile(support.appCodebookFile ? storedFileToFile(support.appCodebookFile) : null);
    // Reuse the upload path so restored files are inspected like fresh uploads;
    // a config-only project clears the raw files to a clean slate.
    onFilesChange(record.includesFiles ? record.rawFiles.map(storedFileToFile) : []);
  };

  const buildSupportFiles = async (): Promise<BrowserSupportFiles> => ({
    ...(options.useFilterFile && filterFile
      ? { filterFile: await readSupportFile(filterFile) }
      : {}),
    ...(options.useAppsForcingScreenOpenFile && appsForcingScreenOpenFile
      ? { appsForcingScreenOpenFile: await readSupportFile(appsForcingScreenOpenFile) }
      : {}),
    ...(options.useBackgroundAppsFile && backgroundAppsFile
      ? { backgroundAppsFile: await readSupportFile(backgroundAppsFile) }
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
    const sampleFile = new File([sampleRawCsv], SAMPLE_FILE_NAME, { type: "text/csv" });
    await clearLastRun().catch(() => {});
    onFilesChange([sampleFile], { clearCachedRun: false });
    setActiveWorkflow("process");
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
      void saveLastRun({
        options,
        results: [result],
        discoveredTimezones: result.availableTimezones,
      }).catch(() => {});
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsRunning(false);
      setProcessExpanded(false);
    }
  };

  const handleProgressEvent = useCallback((event: ProgressEvent) => {
    setProgressByFile((current) => applyProgressEvent(current, event));
  }, []);

  const processUploadedFiles = async () => {
    if (!uploadedFiles.length) {
      setError("Choose one or more Chronicle raw CSV files first.");
      setActiveWorkflow("files");
      return;
    }
    setActiveWorkflow("process");
    setProcessExpanded(true);
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
      const nextTimezones = Array.from(
        new Set(successful.flatMap((result) => result.availableTimezones)),
      ).sort((left, right) => left.localeCompare(right));
      setDiscoveredTimezones(nextTimezones);
      if (successful.length) {
        void saveLastRun({
          options,
          results: successful,
          discoveredTimezones: nextTimezones,
        }).catch(() => {});
      } else {
        void clearLastRun().catch(() => {});
      }

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
      setProcessExpanded(false);
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
  const normalizedSettingsQuery = settingsQuery.trim().toLowerCase();
  const shows = (text: string) =>
    !normalizedSettingsQuery || text.toLowerCase().includes(normalizedSettingsQuery);
  const navigateFromSettingsSearch = (href: string) => {
    if (href === "#files") {
      setActiveWorkflow("files");
    } else if (href === "#process") {
      setActiveWorkflow("process");
    } else {
      setActiveWorkflow("settings");
    }
  };

  return (
    <>
      <a className="skip-link" href="#workflow-panels">Skip to workflow tabs</a>
      <main className={`app-shell ${activeWorkflow === "view" ? "app-shell--wide" : ""}`}>
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

        <WorkflowNav active={activeWorkflow} onSelect={setActiveWorkflow} />

        <div id="workflow-panels" className="workflow-panels" tabIndex={-1}>
          <div
            id="settings-panel"
            role="tabpanel"
            aria-labelledby="settings-tab"
            hidden={activeWorkflow !== "settings"}
          >
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
              <SettingsSearchResults query={settingsQuery} onNavigate={navigateFromSettingsSearch} />
              <SettingsManagementCard
                options={options}
                setOptions={setOptions}
                onStatus={(message, isError = false) => setToast({ message, isError })}
              />
              <ProjectsCard
                options={options}
                uploadedFiles={uploadedFiles}
                supportFiles={{
                  filterFile,
                  appsForcingScreenOpenFile,
                  backgroundAppsFile,
                  appCodebookFile,
                }}
                onApplyProject={applyProject}
                onStatus={(message, isError = false) => setToast({ message, isError })}
              />
              <SettingsOverviewCard options={options} setOptions={setOptions} />
              <div className="settings-stack">
                {shows("support files filter keep awake prevent screen sleep codebook") ? (
                  <FilesAndInputsCard
                    options={options}
                    setOptions={setOptions}
                    filterFile={filterFile}
                    setFilterFile={setFilterFile}
                    appsForcingScreenOpenFile={appsForcingScreenOpenFile}
                    setAppsForcingScreenOpenFile={setAppsForcingScreenOpenFile}
                    backgroundAppsFile={backgroundAppsFile}
                    setBackgroundAppsFile={setBackgroundAppsFile}
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
          </div>

          <div
            id="files-panel"
            role="tabpanel"
            aria-labelledby="files-tab"
            hidden={activeWorkflow !== "files"}
          >
            <RawFilesCard
              uploadedFiles={uploadedFiles}
              inspections={fileInspections}
              isInspecting={isInspectingFiles}
              options={options}
              onFilesChange={onFilesChange}
              onClear={() => {
                onFilesChange([]);
                setProgressOrder([]);
                setProgressByFile({});
              }}
              isRunning={isRunning}
            />
          </div>

          <div
            id="process-panel"
            role="tabpanel"
            aria-labelledby="process-tab"
            hidden={activeWorkflow !== "process"}
          >
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
              expanded={processExpanded}
              onExpandedChange={setProcessExpanded}
            />

            <div aria-live="polite">
              <ResultPanel
                results={results}
                error={error}
                options={options}
                expectedFileCount={uploadedFiles.length}
                progressRows={progressRows}
              />
            </div>
          </div>

          <div
            id="view-panel"
            role="tabpanel"
            aria-labelledby="view-tab"
            hidden={activeWorkflow !== "view"}
          >
            <TimelineViewPanel results={results} />
          </div>
        </div>

        <footer className="app-footer" data-testid="app-footer">
          <div className="app-footer__about" aria-label="App info">
            <span>Version {PREPROCESSOR_VERSION}+{BUILD_SHA}</span>
            <span aria-hidden="true">·</span>
            <span>Build {BUILD_DATE || BUILD_SHA}</span>
            <span aria-hidden="true">·</span>
            <span>Bundled codebook available</span>
            <span aria-hidden="true">·</span>
            <span>Runs entirely in your browser</span>
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
    </>
  );
}
