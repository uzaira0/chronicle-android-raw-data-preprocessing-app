import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { PREPROCESSOR_VERSION, resolveDefaultSupportFiles } from "@/lib/browserPipeline";
import {
  WorkerPool,
  discoverTimezones,
  processRawCsv,
  processRawCsvBytesViaPool,
  warmMatcher,
} from "@/lib/chronicleMatcher";
import { BUILD_DATE, BUILD_SHA } from "@/lib/buildInfo";
import { ensureNotificationPermission, sendNotification } from "@/lib/notification";
import { clearLastRun, loadLastRun, saveLastRun } from "@/lib/lastRunStore";
import { computeSafeConcurrency, readDeviceMemory } from "@/lib/concurrency";
import { clearCachedRun as clearCachedRunData } from "@/lib/localDataReset";
import {
  estimateStoragePressure,
  formatBytes,
  isStoragePressureHigh,
  requestPersistentStorage,
  type StoragePressure,
} from "@/lib/storagePressure";
import {
  hasPersistedOptions,
  persistOptions,
  readPersistedOptions,
  readSharedConfig,
  sanitizeOptions,
  SHARED_CONFIG_PARAM,
} from "@/lib/settingsPersistence";
import {
  createDemoDisplayMasker,
  persistDemoDisplayEnabled,
  readDemoDisplayEnabled,
} from "@/lib/demoDisplay";
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

import { FilesAndInputsCard } from "@/components/FilesAndInputsCard";
import { StudyInputsCard } from "@/components/StudyInputsCard";
import { AnalyzeSettingsCard } from "@/components/AnalyzeSettingsCard";

// Lazy: React Flow + dagre only load when the Graph tab is opened.
const GraphPanel = lazy(() =>
  import("@/components/GraphPanel/GraphPanel").then((module) => ({
    default: module.GraphPanel,
  })),
);
import { TimezoneCard } from "@/components/TimezoneCard";
import { SessionDetectionCard } from "@/components/SessionDetectionCard";
import { ScreenDetectionCard } from "@/components/ScreenDetectionCard";
import { InteractionSemanticsCard } from "@/components/InteractionSemanticsCard";
import { PerformanceCard } from "@/components/PerformanceCard";
import { ResultPanel } from "@/components/ResultPanel";
import { ViewPanel } from "@/components/ViewPanel";
import type { FileProgress } from "@/components/ProgressList";
import { Toast } from "@/components/Toast";
import { GuidePanel } from "@/components/GuidePanel";
import { WorkflowNav, type WorkflowTab } from "@/components/WorkflowNav";
import { RawFilesCard } from "@/components/RawFilesCard";
import { ProcessPanel } from "@/components/ProcessPanel";
import { SettingsManagementCard } from "@/components/SettingsManagementCard";
import { ProjectsCard } from "@/components/ProjectsCard";
import { SettingsOverviewCard } from "@/components/SettingsOverviewCard";
import { SettingsSearchResults } from "@/components/SettingsSearchResults";
import { ThemeToggle } from "@/components/ThemeToggle";
import { applyUpdate, onUpdateReady } from "@/lib/swUpdate";

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
const WORKFLOW_STORAGE_KEY = "chronicle-web.activeWorkflow";

function isWorkflowTab(value: string | null): value is WorkflowTab {
  return (
    value === "guide" ||
    value === "settings" ||
    value === "files" ||
    value === "process" ||
    value === "view" ||
    value === "graph"
  );
}

function estimatedFilePercent(current: FileProgress): number {
  if (current.status === "complete") return 1;
  if (current.status === "error") return 1;
  if (current.status === "cancelled") return 1;
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
  const [studyDatesFile, setStudyDatesFile] = useState<File | null>(null);
  const [deviceSharingFile, setDeviceSharingFile] = useState<File | null>(null);
  const [surveyAttributionFile, setSurveyAttributionFile] = useState<File | null>(null);
  const [enrolledDevicesFile, setEnrolledDevicesFile] = useState<File | null>(null);
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
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowTab>(() => {
    if (typeof window === "undefined") return "settings";
    const stored = localStorage.getItem(WORKFLOW_STORAGE_KEY);
    return isWorkflowTab(stored) ? stored : "settings";
  });
  const [processExpanded, setProcessExpanded] = useState(true);
  const [hideDemoMetadata, setHideDemoMetadata] = useState(() => readDemoDisplayEnabled());
  const [storagePressure, setStoragePressure] = useState<StoragePressure | null>(null);
  const [storagePressureDismissed, setStoragePressureDismissed] = useState(false);
  const [retryingFile, setRetryingFile] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const baseTitleRef = useRef<string | null>(null);
  // Snapshot of the options that produced `results`, so the Result panel can warn
  // when the live settings have since drifted (out-of-date outputs).
  const [resultsOptions, setResultsOptions] = useState<BrowserProcessingOptions | null>(null);
  const startTimeRef = useRef<number>(0);
  // A run can be cancelled mid-flight: the flag stops the runner from claiming the
  // next file, and the pool ref lets us terminate in-flight workers immediately.
  const cancelRequestedRef = useRef(false);
  const poolRef = useRef<WorkerPool | null>(null);
  // Synchronous re-entrancy locks (set before any await) so a double-click or
  // synthetic event can't start two runs / a run-during-retry before the React
  // state-driven `disabled` attributes re-render.
  const processingRef = useRef(false);
  const retryingFileRef = useRef<string | null>(null);
  // Holds the pending "flash the jumped-to setting" timer so a rapid second jump
  // to the same card cancels the first timer instead of cutting its flash short.
  const flashTimerRef = useRef<number | null>(null);
  // Memoized so the masker's internal label maps persist across renders (stable
  // File 01/Participant 01 numbering) and its identity stays stable for memoized
  // children — a fresh instance each render would reset numbering and churn props.
  const demoDisplay = useMemo(() => createDemoDisplayMasker(hideDemoMetadata), [hideDemoMetadata]);

  const resultsStale =
    results.length > 0 &&
    resultsOptions !== null &&
    JSON.stringify(options) !== JSON.stringify(resultsOptions);

  // Sample storage usage on boot and whenever asked (after a run / a clear), so
  // the banner can warn before a write fails. A fresh high reading re-arms the
  // banner even if the user dismissed an earlier one.
  const refreshStoragePressure = useCallback(async (): Promise<void> => {
    const pressure = await estimateStoragePressure();
    setStoragePressure(pressure);
    if (isStoragePressureHigh(pressure)) setStoragePressureDismissed(false);
  }, []);

  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    persistOptions(options);
  }, [options]);

  useEffect(() => {
    persistDemoDisplayEnabled(hideDemoMetadata);
  }, [hideDemoMetadata]);

  useEffect(() => {
    void refreshStoragePressure();
  }, [refreshStoragePressure]);

  // Ask once for persistent storage so projects + the cached run aren't evicted
  // under disk pressure (best-effort; ignored where unsupported/denied).
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // Warm the matcher worker on boot: faster first run, and a still-live worker
  // if the network drops before the user processes.
  useEffect(() => {
    void warmMatcher();
  }, []);

  // Surface a "new version available" banner when the service worker updates.
  useEffect(() => onUpdateReady(() => setUpdateReady(true)), []);

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
        // Provenance only — the restored run's options are kept so the stale
        // banner can compare, but the user's CURRENT settings stay in charge.
        // (This used to setOptions(restoredOptions), silently flipping the
        // user's toggles back to whatever the last run used on every boot —
        // e.g. re-enabling features they had just turned off.)
        setResultsOptions(sanitizeOptions(record.options));
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
        setProcessExpanded(false);
        setToast({
          message: `Last processed results restored (${record.results.length} ${record.results.length === 1 ? "file" : "files"}).`,
          isError: false,
        });
      })
      .catch(() => {
        // IndexedDB can be unavailable or evicted, or a record could fail to
        // rehydrate; processing still works. Self-heal so a bad record can't
        // wedge every future boot.
        void clearLastRun().catch(() => {});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(WORKFLOW_STORAGE_KEY, activeWorkflow);
  }, [activeWorkflow]);

  const onFilesChange = (files: File[], input: { clearCachedRun?: boolean } = {}) => {
    const { clearCachedRun = true } = input;
    setUploadedFiles(files);
    setFileInspections([]);
    setResults([]);
    setResultsOptions(null);
    setError(null);
    setProcessExpanded(true);
    if (clearCachedRun) {
      // Clearing the cached run frees storage; re-check pressure so a stale
      // high-usage banner doesn't linger (consistent with the post-run refresh).
      void clearLastRun()
        .catch(() => {})
        .finally(() => void refreshStoragePressure());
    }
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
    setStudyDatesFile(support.studyDatesFile ? storedFileToFile(support.studyDatesFile) : null);
    setDeviceSharingFile(
      support.deviceSharingFile ? storedFileToFile(support.deviceSharingFile) : null,
    );
    setSurveyAttributionFile(
      support.surveyAttributionFile ? storedFileToFile(support.surveyAttributionFile) : null,
    );
    setEnrolledDevicesFile(
      support.enrolledDevicesFile ? storedFileToFile(support.enrolledDevicesFile) : null,
    );
    // Reuse the upload path so restored files are inspected like fresh uploads;
    // a config-only project clears the raw files to a clean slate.
    onFilesChange(record.includesFiles ? record.rawFiles.map(storedFileToFile) : []);
  };

  const buildSupportFilesForOptions = async (
    forOptions: BrowserProcessingOptions,
  ): Promise<BrowserSupportFiles> => ({
    ...(forOptions.useFilterFile && filterFile
      ? { filterFile: await readSupportFile(filterFile) }
      : {}),
    ...(forOptions.useAppsForcingScreenOpenFile && appsForcingScreenOpenFile
      ? { appsForcingScreenOpenFile: await readSupportFile(appsForcingScreenOpenFile) }
      : {}),
    ...(forOptions.useBackgroundAppsFile && backgroundAppsFile
      ? { backgroundAppsFile: await readSupportFile(backgroundAppsFile) }
      : {}),
    ...(forOptions.useAppCodebook && appCodebookFile
      ? { appCodebookFile: await readSupportFile(appCodebookFile) }
      : {}),
    // Study Inputs: sent along whenever any enabled analyze step consumes them.
    ...((forOptions.enableStudyWindowFilter || forOptions.enableDayCoverage) && studyDatesFile
      ? { studyDatesFile: await readSupportFile(studyDatesFile) }
      : {}),
    ...((forOptions.enablePersonAttribution || forOptions.enableComplianceScoring) &&
    deviceSharingFile
      ? { deviceSharingFile: await readSupportFile(deviceSharingFile) }
      : {}),
    ...(forOptions.enablePersonAttribution && surveyAttributionFile
      ? { surveyAttributionFile: await readSupportFile(surveyAttributionFile) }
      : {}),
    ...(forOptions.enableComplianceScoring && enrolledDevicesFile
      ? { enrolledDevicesFile: await readSupportFile(enrolledDevicesFile) }
      : {}),
  });

  const buildSupportFiles = (): Promise<BrowserSupportFiles> =>
    buildSupportFilesForOptions(options);

  /**
   * Re-process a single already-uploaded file under a different config (the
   * View tab's "Arm B"), reusing the same support-file resolution as a normal
   * run. Returns the fresh result (with its own reviewSummary + timeline); the
   * caller diffs it against the current run. Throws if the file is no longer
   * loaded so the View tab can prompt the user to re-add it.
   */
  const runComparison = useCallback(
    async (
      fileName: string,
      overrides: Partial<BrowserProcessingOptions>,
    ): Promise<ProcessedFileResult> => {
      const file = uploadedFiles.find((candidate) => candidate.name === fileName);
      if (!file) {
        throw new Error(
          "The raw file for this run is no longer loaded. Re-add it in the Files tab to compare.",
        );
      }
      const armBOptions = sanitizeOptions({ ...options, ...overrides });
      const userSupportFiles = await buildSupportFilesForOptions(armBOptions);
      const supportFiles = await resolveDefaultSupportFiles(armBOptions, userSupportFiles);
      const text = await file.text();
      return processRawCsv(file.name, text, armBOptions, supportFiles, getInjectedRuntime());
    },
    // filterFile et al. are read inside buildSupportFilesForOptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      uploadedFiles,
      options,
      filterFile,
      appsForcingScreenOpenFile,
      backgroundAppsFile,
      appCodebookFile,
      studyDatesFile,
      deviceSharingFile,
      surveyAttributionFile,
      enrolledDevicesFile,
    ],
  );

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

  const handleProgressEvent = useCallback((event: ProgressEvent) => {
    setProgressByFile((current) => applyProgressEvent(current, event));
  }, []);

  const processUploadedFiles = async () => {
    // Synchronous re-entrancy guard: a single-file retry in flight, or a run
    // already underway (double-click / synthetic event before the disabled
    // attribute re-renders), must not start another run over the shared state.
    if (processingRef.current || retryingFileRef.current) return;
    if (!uploadedFiles.length) {
      setError("Choose one or more Chronicle raw CSV files first.");
      setActiveWorkflow("files");
      return;
    }
    processingRef.current = true;
    setActiveWorkflow("process");
    setProcessExpanded(true);
    setIsRunning(true);
    setError(null);
    cancelRequestedRef.current = false;
    startTimeRef.current = performance.now();

    const order = uploadedFiles.map((file) => file.name);
    setProgressOrder(order);
    setProgressByFile(
      Object.fromEntries(order.map((name) => [name, { fileName: name, status: "pending" }])),
    );
    setToast(null);

    void ensureNotificationPermission();

    let pool: WorkerPool | null = null;
    // Keep the processing details open after a run ONLY when something failed, so
    // the per-file Retry control stays visible (a clean run collapses to declutter).
    let keepDetailsOpen = false;
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
            deviceMemory: readDeviceMemory(),
          })
        : 1;
      // Resolve bundled-default support files once on the main thread so
      // every worker uses identical bytes (no per-worker fetches), and so
      // the user's uploads win over defaults.
      const supportFiles = await resolveDefaultSupportFiles(options, userSupportFiles);
      pool = concurrency > 1 ? new WorkerPool(concurrency) : null;
      poolRef.current = pool;
      let cursor = 0;
      const failures: string[] = [];
      const runner = async () => {
        for (;;) {
          if (cancelRequestedRef.current) return;
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
            // If the user cancelled while this file was mid-flight, discard its
            // result instead of committing it — keeps the sequential path (which
            // can't terminate an in-flight worker) consistent with the pool path.
            if (cancelRequestedRef.current) return;
            nextResults[index] = result;
            handleProgressEvent({ type: "file-complete", fileName: file.name, result });
          } catch (fileError) {
            // A terminate() during cancel rejects the in-flight file; don't count
            // that as a real failure — the finally block marks it cancelled.
            if (cancelRequestedRef.current) return;
            const message = fileError instanceof Error ? fileError.message : String(fileError);
            failures.push(message);
            handleProgressEvent({ type: "file-complete", fileName: file.name, error: message });
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => runner()));

      const successful = nextResults.filter(Boolean);
      keepDetailsOpen = failures.length > 0;
      setResults(successful);
      if (successful.length) {
        setResultsOptions(options);
      }
      const nextTimezones = Array.from(
        new Set(successful.flatMap((result) => result.availableTimezones)),
      ).sort((left, right) => left.localeCompare(right));
      // Don't overwrite discovered timezones with an empty set when a run produced
      // no results (fully cancelled / all failed) — that would blank the timezone
      // picker the user populated via file inspection or a prior run.
      if (successful.length) {
        setDiscoveredTimezones(nextTimezones);
        void saveLastRun({
          options,
          results: successful,
          discoveredTimezones: nextTimezones,
        })
          .catch(() => {
            // saveLastRun already self-clears a failed (e.g. quota) write; surface
            // the pressure so the user can free space.
          })
          .finally(() => {
            void refreshStoragePressure();
          });
      } else {
        void clearLastRun().catch(() => {});
        void refreshStoragePressure();
      }

      // Surface a top-level error banner only when every file failed — lets a
      // single malformed file fail loudly while a partially-successful batch
      // shows per-row errors inside ProgressList without dominating the UI.
      if (failures.length && successful.length === 0) {
        setError(failures[0] ?? "Processing failed.");
      }

      const cancelled = cancelRequestedRef.current;
      const elapsedMs = performance.now() - startTimeRef.current;
      const summary = cancelled
        ? `Cancelled. Processed ${successful.length}/${uploadedFiles.length} files`
        : `Processed ${successful.length}/${uploadedFiles.length} files in ${Math.round(elapsedMs / 1000)}s`;
      const message =
        !cancelled && failures.length ? `${summary} (${failures.length} failed)` : summary;
      setToast({ message, isError: failures.length > 0 && !cancelled });

      if (!cancelled && typeof document !== "undefined" && document.hidden) {
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
      poolRef.current = null;
      if (cancelRequestedRef.current) {
        // Any file not finished when the user cancelled is shown as cancelled,
        // not failed, so a deliberate stop doesn't read as an error.
        setProgressByFile((current) => {
          const next = { ...current };
          for (const name of order) {
            const row = next[name];
            if (row && row.status !== "complete" && row.status !== "error") {
              next[name] = { ...row, status: "cancelled" };
            }
          }
          return next;
        });
      }
      // On cancel, cancelProcessing already terminated the pool — avoid a second
      // terminate() on the same instance.
      if (!cancelRequestedRef.current) pool?.terminate();
      processingRef.current = false;
      setIsRunning(false);
      setProcessExpanded(keepDetailsOpen);
    }
  };

  const cancelProcessing = useCallback(() => {
    cancelRequestedRef.current = true;
    // Terminate in-flight workers immediately; the runner loop won't claim more.
    poolRef.current?.terminate();
  }, []);

  /**
   * Reprocess a single file in place — used by the Retry control on a failed
   * row. Runs on the main thread (one file), then splices the fresh result back
   * into `results` in the original run order and refreshes the cached run.
   */
  const retryFile = useCallback(
    async (fileName: string) => {
      if (processingRef.current || retryingFileRef.current) return;
      const file = uploadedFiles.find((candidate) => candidate.name === fileName);
      if (!file) {
        setToast({
          message: "That file is no longer loaded. Re-add it in the Files tab to retry.",
          isError: true,
        });
        return;
      }
      retryingFileRef.current = fileName;
      setRetryingFile(fileName);
      // Reset the row directly rather than via a file-start event: this file is
      // currently "error", and applyProgressEvent intentionally refuses to revert
      // a terminal status (it guards a Comlink dual-port race). A direct set is
      // the correct restart; subsequent step events are non-terminal and flow
      // through normally.
      setProgressByFile((current) => ({
        ...current,
        [fileName]: { fileName, status: "running", stepKind: "parse", percent: 0 },
      }));
      try {
        const userSupportFiles = await buildSupportFiles();
        const supportFiles = await resolveDefaultSupportFiles(options, userSupportFiles);
        const text = await file.text();
        const result = await processRawCsv(
          file.name,
          text,
          options,
          supportFiles,
          getInjectedRuntime(),
          handleProgressEvent,
        );
        handleProgressEvent({ type: "file-complete", fileName, result });
        const merged = (() => {
          const byName = new Map(results.map((entry) => [entry.inputFileName, entry]));
          byName.set(fileName, result);
          // Preserve the original queue order so the table doesn't reshuffle.
          return progressOrder
            .map((name) => byName.get(name))
            .filter((entry): entry is ProcessedFileResult => Boolean(entry));
        })();
        setResults(merged);
        setResultsOptions(options);
        const nextTimezones = Array.from(
          new Set(merged.flatMap((entry) => entry.availableTimezones)),
        ).sort((left, right) => left.localeCompare(right));
        setDiscoveredTimezones(nextTimezones);
        void saveLastRun({ options, results: merged, discoveredTimezones: nextTimezones })
          .catch(() => {})
          .finally(() => void refreshStoragePressure());
        setToast({ message: `Reprocessed ${demoDisplay.fileName(fileName)}.`, isError: false });
      } catch (retryError) {
        const message = retryError instanceof Error ? retryError.message : String(retryError);
        handleProgressEvent({ type: "file-complete", fileName, error: message });
        setToast({ message, isError: true });
      } finally {
        retryingFileRef.current = null;
        setRetryingFile(null);
      }
    },
    // support-file refs are read inside buildSupportFiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isRunning,
      retryingFile,
      uploadedFiles,
      options,
      results,
      progressOrder,
      handleProgressEvent,
      refreshStoragePressure,
      demoDisplay,
    ],
  );

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

  // Reflect run progress in the browser tab title so it's visible while the tab
  // is in the background, and restore the original title when the run ends.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (baseTitleRef.current === null) baseTitleRef.current = document.title;
    const base = baseTitleRef.current || "Chronicle Android Raw Data Preprocessor";
    document.title = isRunning
      ? `(${Math.round(overallPercent * 100)}%) Processing… · ${base}`
      : base;
  }, [isRunning, overallPercent]);

  // Restore the original title only on unmount (a dedicated empty-dep effect, so
  // the restore doesn't run between every progress tick of the effect above).
  useEffect(() => {
    return () => {
      if (baseTitleRef.current !== null) document.title = baseTitleRef.current;
    };
  }, []);
  const normalizedSettingsQuery = settingsQuery.trim().toLowerCase();
  const shows = (text: string) =>
    !normalizedSettingsQuery || text.toLowerCase().includes(normalizedSettingsQuery);
  const navigateToSetting = useCallback((selector: string) => {
    setActiveWorkflow("settings");
    // Clear the live filter so the target card isn't filtered out of the page,
    // then scroll to it on the next frame (once the panel is shown) and flash it.
    setSettingsQuery("");
    requestAnimationFrame(() => {
      const target = document.querySelector(selector);
      if (!(target instanceof HTMLElement)) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.remove("settings-flash");
      // Force reflow so re-adding the class restarts the flash animation.
      void target.offsetWidth;
      target.classList.add("settings-flash");
      // Cancel a still-pending removal so a rapid second jump to the same card
      // doesn't get its flash cut short by the first jump's timer.
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        target.classList.remove("settings-flash");
        flashTimerRef.current = null;
      }, 1600);
    });
  }, []);

  return (
    <>
      <a className="skip-link" href="#workflow-panels">Skip to workflow tabs</a>
      <main className={`app-shell ${activeWorkflow === "view" ? "app-shell--wide" : ""}`}>
        <header className="hero">
          <div className="hero__copy">
            <h1>Chronicle Android Raw Data Preprocessor</h1>
            <p className="lede">
              Drop one or more raw Chronicle CSVs to generate the preprocessed app usage and
              screen usage outputs. This app runs entirely in your browser. Your data never
              leaves your device.
            </p>
          </div>
          <ThemeToggle />
        </header>

        {updateReady ? (
          <div className="update-banner" role="status" data-testid="update-banner">
            <span className="update-banner__text">
              A new version of the app is available.
            </span>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="update-reload"
              onClick={applyUpdate}
            >
              Reload
            </button>
          </div>
        ) : null}

        {storagePressure && isStoragePressureHigh(storagePressure) && !storagePressureDismissed ? (
          <div className="storage-pressure" role="status" data-testid="storage-pressure">
            <span className="storage-pressure__text">
              <strong>
                Browser storage is {Math.round(storagePressure.ratio * 100)}% full
              </strong>{" "}
              ({formatBytes(storagePressure.usage)} of {formatBytes(storagePressure.quota)}).
              Export a backup of anything you need, then clear the cached last run to free space —
              otherwise saving a large run may fail.
            </span>
            <span className="storage-pressure__actions">
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="storage-pressure-clear"
                onClick={() => {
                  void clearCachedRunData()
                    .then(() => {
                      setToast({ message: "Cleared the cached last run.", isError: false });
                    })
                    .finally(() => {
                      void refreshStoragePressure();
                    });
                }}
              >
                Clear cached run
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                data-testid="storage-pressure-dismiss"
                onClick={() => setStoragePressureDismissed(true)}
              >
                Dismiss
              </button>
            </span>
          </div>
        ) : null}

        <WorkflowNav active={activeWorkflow} onSelect={setActiveWorkflow} />

        <div id="workflow-panels" className="workflow-panels" tabIndex={-1}>
          <div
            id="settings-panel"
            role="tabpanel"
            aria-labelledby="settings-tab"
            hidden={activeWorkflow !== "settings"}
          >
            <section id="settings" className="workflow-section" aria-labelledby="settings-title">
              <div className="settings-command workflow-section__header">
                <div>
                  <h2 id="settings-title" className="workflow-section__title">Settings</h2>
                  <p className="workflow-section__intro">
                    Search every option, then save custom presets once the settings are right.
                  </p>
                </div>
                <div className="settings-search settings-search--command">
                  <label className="settings-search__eyebrow" htmlFor="settings-search-input">
                    Full Settings Search
                  </label>
                  <input
                    id="settings-search-input"
                    className="input settings-search__input"
                    placeholder="Search timezone, codebook, parallel, screen, session..."
                    value={settingsQuery}
                    data-testid="settings-search-input"
                    onChange={(event) => setSettingsQuery(event.target.value)}
                  />
                  <SettingsSearchResults query={settingsQuery} onNavigate={navigateToSetting} />
                </div>
              </div>
              <SettingsManagementCard
                options={options}
                setOptions={setOptions}
                hideDemoMetadata={hideDemoMetadata}
                onHideDemoMetadataChange={setHideDemoMetadata}
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
                  studyDatesFile,
                  deviceSharingFile,
                  surveyAttributionFile,
                  enrolledDevicesFile,
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
                {shows(
                  "study inputs dates device sharing survey enrolled devices upload analyze",
                ) ? (
                  <StudyInputsCard
                    options={options}
                    studyDatesFile={studyDatesFile}
                    setStudyDatesFile={setStudyDatesFile}
                    deviceSharingFile={deviceSharingFile}
                    setDeviceSharingFile={setDeviceSharingFile}
                    surveyAttributionFile={surveyAttributionFile}
                    setSurveyAttributionFile={setSurveyAttributionFile}
                    enrolledDevicesFile={enrolledDevicesFile}
                    setEnrolledDevicesFile={setEnrolledDevicesFile}
                  />
                ) : null}
                {shows(
                  "study analysis screen gated credit window attribution compliance coverage analyze",
                ) ? (
                  <AnalyzeSettingsCard
                    options={options}
                    setOptions={setOptions}
                    studyDatesLoaded={Boolean(studyDatesFile)}
                    deviceSharingLoaded={Boolean(deviceSharingFile)}
                  />
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
              displayMasker={demoDisplay}
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
              displayMasker={demoDisplay}
              onProcess={() => {
                void processUploadedFiles();
              }}
              onCancel={cancelProcessing}
              onRetry={(fileName) => {
                void retryFile(fileName);
              }}
              retryingFile={retryingFile}
              progressRows={progressRows}
              overallPercent={overallPercent}
              expanded={processExpanded}
              onExpandedChange={setProcessExpanded}
            />

            <div aria-live="polite">
              <ResultPanel
                results={results}
                error={error}
                displayMasker={demoDisplay}
                options={options}
                expectedFileCount={uploadedFiles.length}
                progressRows={progressRows}
                stale={resultsStale}
                onDelete={() => {
                  setResults([]);
                  setResultsOptions(null);
                  setProgressOrder([]);
                  setProgressByFile({});
                  void clearLastRun()
                    .then(() => refreshStoragePressure())
                    .catch(() => {});
                  setToast({ message: "Deleted the processed results.", isError: false });
                }}
              />
            </div>
          </div>

          <div
            id="guide-panel"
            role="tabpanel"
            aria-labelledby="guide-tab"
            hidden={activeWorkflow !== "guide"}
          >
            {activeWorkflow === "guide" ? <GuidePanel onNavigate={setActiveWorkflow} /> : null}
          </div>

          <div
            id="graph-panel"
            role="tabpanel"
            aria-labelledby="graph-tab"
            hidden={activeWorkflow !== "graph"}
          >
            {activeWorkflow === "graph" ? (
              <Suspense fallback={<p className="empty-state">Loading the pipeline graph…</p>}>
                <GraphPanel results={results} displayMasker={demoDisplay} options={options} />
              </Suspense>
            ) : null}
          </div>

          <div
            id="view-panel"
            role="tabpanel"
            aria-labelledby="view-tab"
            hidden={activeWorkflow !== "view"}
          >
            <ViewPanel
              results={results}
              options={options}
              uploadedFileNames={uploadedFiles.map((file) => file.name)}
              onRunComparison={runComparison}
              displayMasker={demoDisplay}
              includeFilteredAppUsageInPlots={options.includeFilteredAppUsageInPlots}
            />
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
