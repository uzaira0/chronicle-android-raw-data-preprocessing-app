import { supportFileInputList } from "@/lib/comparisonSupportKey";
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
import {
  PREPROCESSOR_VERSION,
  resolveDefaultSupportFiles,
} from "@/lib/processingUiContract";
import {
  WorkerPool,
  comparisonSupportCacheKey,
  discoverTimezonesBytes,
  getPlanStageView,
  processPersistedOrRawChangedReview,
  processPersistedOrRawChangedReviewViaPool,
  processRawCsvBytes,
  processRawCsvChangedReviewBytesViaPool,
  processRawCsvReviewBytes,
  processRawCsvBytesViaPool,
  warmRuntime,
} from "@/lib/rustWorkerClient";
import { BUILD_DATE, BUILD_SHA } from "@/lib/buildInfo";
import {
  ensureNotificationPermission,
  sendNotification,
} from "@/lib/notification";
import { clearLastRun, loadLastRun, saveLastRun } from "@/lib/lastRunStore";
import {
  computeAdaptiveLaneTarget,
  computeSafeConcurrency,
  readDeviceMemory,
} from "@/lib/concurrency";
import { clearCachedRun as clearCachedRunData } from "@/lib/localDataReset";
import {
  probeOpfsCapability,
  type OpfsCapability,
} from "@/lib/opfsArtifactStore";
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
import { relabelDuplicateContentResult } from "@/lib/rustPipelineAuthority";
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

const COMPARISON_WORKER_LIMIT = 8;
import { TimezoneCard } from "@/components/TimezoneCard";
import { SessionDetectionCard } from "@/components/SessionDetectionCard";
import { ScreenDetectionCard } from "@/components/ScreenDetectionCard";
import { InteractionSemanticsCard } from "@/components/InteractionSemanticsCard";
import { PerformanceCard } from "@/components/PerformanceCard";
import { ResultPanel } from "@/components/ResultPanel";
import { WorkspaceBackupControls } from "@/components/WorkspaceBackupControls";
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
import { clearSwCachesAndReload } from "@/lib/swCache";
import { applyUpdate, onUpdateReady } from "@/lib/swUpdate";

async function readSupportFile(file: File): Promise<BrowserSupportFile> {
  return {
    name: file.name,
    bytes: await file.arrayBuffer(),
  };
}

function getInjectedRuntime(): BrowserProcessingRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.__CHRONICLE_TEST_RUNTIME__ ?? {
      executionAuthority: "rust",
      persistRustWorkspace: true,
    }
  );
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
  const currentContribution =
    STEP_WEIGHTS[current.stepKind] * (current.percent ?? 0);
  return completedBefore + currentContribution;
}

export default function App(): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<ProcessedFileResult[]>([]);
  // File objects are immutable. A digest is eligible for content reuse only
  // when inspection or a successful run hashed this exact object; matching a
  // replacement file by name, size, or timestamp is never sufficient.
  const verifiedInputDigestByFileRef = useRef(new WeakMap<File, string>());
  // Arm-B warmups must also be tied to the exact immutable File objects. Two
  // support files may have the same name and size while carrying different
  // study rules, so metadata alone is not a safe cache key.
  const comparisonFileIdentityByRef = useRef(new WeakMap<File, number>());
  const nextComparisonFileIdentityRef = useRef(1);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [fileInspections, setFileInspections] = useState<RawFileInspection[]>(
    [],
  );
  const [isInspectingFiles, setIsInspectingFiles] = useState(false);
  const [filterFile, setFilterFile] = useState<File | null>(null);
  const [appsForcingScreenOpenFile, setAppsForcingScreenOpenFile] =
    useState<File | null>(null);
  const [backgroundAppsFile, setBackgroundAppsFile] = useState<File | null>(
    null,
  );
  const [appCodebookFile, setAppCodebookFile] = useState<File | null>(null);
  const [studyDatesFile, setStudyDatesFile] = useState<File | null>(null);
  const [deviceSharingFile, setDeviceSharingFile] = useState<File | null>(null);
  const [surveyAttributionFile, setSurveyAttributionFile] =
    useState<File | null>(null);
  const [enrolledDevicesFile, setEnrolledDevicesFile] = useState<File | null>(
    null,
  );
  const [discoveredTimezones, setDiscoveredTimezones] = useState<string[]>([]);
  // When options are seeded from a shared link we skip the very first persist so
  // that merely *opening* someone's link does not silently overwrite the
  // recipient's own saved settings. They take over only once the recipient
  // actually edits a setting (any later change persists normally). Set
  // synchronously during init because the persist effect runs before the
  // URL-strip effect below.
  const skipNextPersist = useRef(false);
  const [options, setOptions] = useState<BrowserProcessingOptions>(() => {
    const shared =
      typeof window === "undefined"
        ? null
        : readSharedConfig(window.location.search);
    if (shared) skipNextPersist.current = true;
    return shared ?? readPersistedOptions();
  });
  const [progressByFile, setProgressByFile] = useState<
    Record<string, FileProgress>
  >({});
  const [progressOrder, setProgressOrder] = useState<string[]>([]);
  const [toast, setToast] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowTab>(() => {
    if (typeof window === "undefined") return "settings";
    try {
      const stored = localStorage.getItem(WORKFLOW_STORAGE_KEY);
      return isWorkflowTab(stored) ? stored : "settings";
    } catch {
      return "settings";
    }
  });
  const [processExpanded, setProcessExpanded] = useState(true);
  const [hideDemoMetadata, setHideDemoMetadata] = useState(() =>
    readDemoDisplayEnabled(),
  );
  const [storagePressure, setStoragePressure] =
    useState<StoragePressure | null>(null);
  const [workspaceCapability, setWorkspaceCapability] =
    useState<OpfsCapability | null>(null);
  const [planStageView, setPlanStageView] = useState<
    ProcessedFileResult["rustStageView"] | null
  >(null);
  const [storagePressureDismissed, setStoragePressureDismissed] =
    useState(false);
  const [retryingFile, setRetryingFile] = useState<string | null>(null);
  const [effectiveProcessingConcurrency, setEffectiveProcessingConcurrency] =
    useState<number | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const baseTitleRef = useRef<string | null>(null);
  // Snapshot of the options that produced `results`, so the Result panel can warn
  // when the live settings have since drifted (out-of-date outputs).
  const [resultsOptions, setResultsOptions] =
    useState<BrowserProcessingOptions | null>(null);
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
  const comparisonWarmupRef = useRef<{
    key: string;
    setup: Promise<{
      options: BrowserProcessingOptions;
      supportFiles: BrowserSupportFiles;
      supportCacheKey: string;
    }>;
    supportInputs: Array<File | null>;
    promise: Promise<ProcessedFileResult>;
  } | null>(null);
  const comparisonPoolRef = useRef<{
    size: number;
    pool: WorkerPool;
  } | null>(null);
  const comparisonPoolIdleTimerRef = useRef<number | null>(null);
  // Holds the pending "flash the jumped-to setting" timer so a rapid second jump
  // to the same card cancels the first timer instead of cutting its flash short.
  const flashTimerRef = useRef<number | null>(null);
  // Memoized so the masker's internal label maps persist across renders (stable
  // File 01/Participant 01 numbering) and its identity stays stable for memoized
  // children — a fresh instance each render would reset numbering and churn props.
  const demoDisplay = useMemo(
    () => createDemoDisplayMasker(hideDemoMetadata),
    [hideDemoMetadata],
  );
  const uploadedFileNames = useMemo(
    () => uploadedFiles.map((file) => file.name),
    [uploadedFiles],
  );

  const resultsStale =
    results.length > 0 &&
    resultsOptions !== null &&
    JSON.stringify(options) !== JSON.stringify(resultsOptions);

  const disposeComparisonPool = useCallback((): void => {
    if (comparisonPoolIdleTimerRef.current !== null) {
      window.clearTimeout(comparisonPoolIdleTimerRef.current);
      comparisonPoolIdleTimerRef.current = null;
    }
    comparisonPoolRef.current?.pool.terminate();
    comparisonPoolRef.current = null;
    comparisonWarmupRef.current = null;
  }, []);

  const getComparisonPool = useCallback((size: number): WorkerPool | null => {
    if (comparisonPoolIdleTimerRef.current !== null) {
      window.clearTimeout(comparisonPoolIdleTimerRef.current);
      comparisonPoolIdleTimerRef.current = null;
    }
    if (size <= 0) {
      comparisonPoolRef.current?.pool.terminate();
      comparisonPoolRef.current = null;
      return null;
    }
    const current = comparisonPoolRef.current;
    if (current?.size === size) return current.pool;
    current?.pool.terminate();
    const pool = new WorkerPool(size);
    comparisonPoolRef.current = { size, pool };
    return pool;
  }, []);

  const releaseComparisonPoolWhenIdle = useCallback((): void => {
    if (comparisonPoolIdleTimerRef.current !== null) {
      window.clearTimeout(comparisonPoolIdleTimerRef.current);
    }
    comparisonPoolIdleTimerRef.current = window.setTimeout(
      disposeComparisonPool,
      120_000,
    );
  }, [disposeComparisonPool]);

  useEffect(() => disposeComparisonPool, [disposeComparisonPool]);

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
    void requestPersistentStorage().finally(() => {
      void probeOpfsCapability().then(setWorkspaceCapability);
    });
  }, []);

  // Warm the matcher worker on boot: faster first run, and a still-live worker
  // if the network drops before the user processes.
  useEffect(() => {
    void warmRuntime();
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
        message:
          "Settings loaded from shared link. Your saved settings are kept until you change one.",
        isError: false,
      });
      params.delete(SHARED_CONFIG_PARAM);
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname +
          (query ? `?${query}` : "") +
          window.location.hash,
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
          : Array.from(
              new Set(
                record.results.flatMap((result) => result.availableTimezones),
              ),
            ).sort((left, right) => left.localeCompare(right));
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
    try {
      localStorage.setItem(WORKFLOW_STORAGE_KEY, activeWorkflow);
    } catch {
      // Storage can be unavailable (private mode/full); tab state stays in memory.
    }
  }, [activeWorkflow]);

  useEffect(() => {
    let cancelled = false;
    void getPlanStageView(options)
      .then((view) => {
        if (!cancelled) setPlanStageView(view);
      })
      .catch((viewError: unknown) => {
        if (cancelled) return;
        setError(
          viewError instanceof Error
            ? `Rust plan view unavailable: ${viewError.message}`
            : "Rust plan view unavailable.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [options]);

  const onFilesChange = (
    files: File[],
    input: { clearCachedRun?: boolean } = {},
  ) => {
    disposeComparisonPool();
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
        inspections.forEach((inspection, index) => {
          const file = files[index];
          if (file && /^[0-9a-f]{64}$/.test(inspection.inputSha256 ?? "")) {
            verifiedInputDigestByFileRef.current.set(
              file,
              inspection.inputSha256!,
            );
          }
        });
        setFileInspections(inspections);
        const timezones = Array.from(
          new Set(inspections.flatMap((inspection) => inspection.timezones)),
        ).sort((left, right) => left.localeCompare(right));
        setDiscoveredTimezones(timezones);
        setOptions((current) =>
          current.timezoneHandling.startsWith("selected-") &&
          !current.selectedTimezone?.trim() &&
          timezones.length === 1
            ? { ...current, selectedTimezone: timezones[0] }
            : current,
        );
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
    setFilterFile(
      support.filterFile ? storedFileToFile(support.filterFile) : null,
    );
    setAppsForcingScreenOpenFile(
      support.appsForcingScreenOpenFile
        ? storedFileToFile(support.appsForcingScreenOpenFile)
        : null,
    );
    setBackgroundAppsFile(
      support.backgroundAppsFile
        ? storedFileToFile(support.backgroundAppsFile)
        : null,
    );
    setAppCodebookFile(
      support.appCodebookFile
        ? storedFileToFile(support.appCodebookFile)
        : null,
    );
    setStudyDatesFile(
      support.studyDatesFile ? storedFileToFile(support.studyDatesFile) : null,
    );
    setDeviceSharingFile(
      support.deviceSharingFile
        ? storedFileToFile(support.deviceSharingFile)
        : null,
    );
    setSurveyAttributionFile(
      support.surveyAttributionFile
        ? storedFileToFile(support.surveyAttributionFile)
        : null,
    );
    setEnrolledDevicesFile(
      support.enrolledDevicesFile
        ? storedFileToFile(support.enrolledDevicesFile)
        : null,
    );
    // Reuse the upload path so restored files are inspected like fresh uploads;
    // a config-only project clears the raw files to a clean slate.
    onFilesChange(
      record.includesFiles ? record.rawFiles.map(storedFileToFile) : [],
    );
  };

  const buildSupportFilesForOptions = async (
    forOptions: BrowserProcessingOptions,
  ): Promise<BrowserSupportFiles> => ({
    ...(forOptions.useFilterFile && filterFile
      ? { filterFile: await readSupportFile(filterFile) }
      : {}),
    ...(forOptions.useAppsForcingScreenOpenFile && appsForcingScreenOpenFile
      ? {
          appsForcingScreenOpenFile: await readSupportFile(
            appsForcingScreenOpenFile,
          ),
        }
      : {}),
    ...(forOptions.useBackgroundAppsFile && backgroundAppsFile
      ? { backgroundAppsFile: await readSupportFile(backgroundAppsFile) }
      : {}),
    ...(forOptions.useAppCodebook && appCodebookFile
      ? { appCodebookFile: await readSupportFile(appCodebookFile) }
      : {}),
    // Study Inputs: sent along whenever any enabled analyze step consumes them.
    ...((forOptions.enableStudyWindowFilter || forOptions.enableDayCoverage) &&
    studyDatesFile
      ? { studyDatesFile: await readSupportFile(studyDatesFile) }
      : {}),
    ...((forOptions.enablePersonAttribution ||
      forOptions.enableComplianceScoring) &&
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
   * Resolve the only input-dependent processing default through the Rust
   * worker. File inspection improves the interaction, but execution never
   * trusts that asynchronous UI helper to have completed or to be semantic
   * authority. A selected-timezone policy therefore either receives an
   * explicit timezone or the sole discovered IANA value. Multiple candidates
   * are a real binding hole: the UI must not infer which research protocol the
   * user intended. An input with no discoverable timezone also fails closed.
   */
  const resolveRunOptions = async (
    requested: BrowserProcessingOptions,
    files: File[],
  ): Promise<BrowserProcessingOptions> => {
    const selectedTimezone = requested.selectedTimezone?.trim();
    if (
      !requested.timezoneHandling.startsWith("selected-") ||
      selectedTimezone
    ) {
      return selectedTimezone === requested.selectedTimezone
        ? requested
        : { ...requested, selectedTimezone };
    }

    const discovered = new Set<string>();
    for (const file of files) {
      const timezones = await discoverTimezonesBytes(
        await file.arrayBuffer(),
        getInjectedRuntime(),
      );
      timezones.forEach((timezone) => {
        const normalized = timezone.trim();
        if (normalized) discovered.add(normalized);
      });
    }
    const ordered = Array.from(discovered).sort((left, right) =>
      left.localeCompare(right),
    );
    if (ordered.length === 0) {
      throw new Error(
        "The selected timezone policy requires a timezone, but Rust could not discover one in the selected raw files. Choose a timezone in Settings or use a primary-timezone policy.",
      );
    }
    setDiscoveredTimezones(ordered);
    if (ordered.length > 1) {
      throw new Error(
        `The selected timezone policy found multiple candidates (${ordered.join(", ")}). Choose one explicitly in Settings; Chronicle will not infer which research protocol you intended, or use a primary-timezone policy.`,
      );
    }
    return { ...requested, selectedTimezone: ordered[0] };
  };

  const executeComparisonReview = useCallback(
    async (
      fileName: string,
      reviewOptions: BrowserProcessingOptions,
      supportFiles?: BrowserSupportFiles,
    ): Promise<ProcessedFileResult> => {
      const file = uploadedFiles.find(
        (candidate) => candidate.name === fileName,
      );
      if (!file) {
        throw new Error(
          "The raw file for this run is no longer loaded. Re-add it in the Files tab to compare.",
        );
      }
      const resolvedSupportFiles =
        supportFiles ??
        (await resolveDefaultSupportFiles(
          reviewOptions,
          await buildSupportFilesForOptions(reviewOptions),
        ));
      const verifiedInputSha256 =
        verifiedInputDigestByFileRef.current.get(file);
      if (verifiedInputSha256) {
        const supportCacheKey = await comparisonSupportCacheKey(
          resolvedSupportFiles,
        );
        return processPersistedOrRawChangedReview(
          file.name,
          file.size,
          () => file.arrayBuffer(),
          reviewOptions,
          resolvedSupportFiles,
          getInjectedRuntime(),
          verifiedInputSha256,
          supportCacheKey,
        );
      }
      return processRawCsvReviewBytes(
        file.name,
        await file.arrayBuffer(),
        reviewOptions,
        resolvedSupportFiles,
        getInjectedRuntime(),
        verifiedInputSha256,
      );
    },
    [
      uploadedFiles,
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

  /** Warm the selected file while the researcher edits Arm B. Only that file
   * uses the shared worker; distinct remaining files use the bounded pool when
   * Run is pressed. */
  const prepareComparison = useCallback(
    (
      fileName: string,
      overrides: Partial<BrowserProcessingOptions> = {},
    ): Promise<ProcessedFileResult> => {
      const baselineOptions = resultsOptions ?? options;
      const requestedOptions = sanitizeOptions({
        ...baselineOptions,
        ...overrides,
      });
      const file = uploadedFiles.find(
        (candidate) => candidate.name === fileName,
      );
      if (!file) {
        return Promise.reject(
          new Error(
            "The raw file for this run is no longer loaded. Re-add it in the Files tab to compare.",
          ),
        );
      }
      const exactFileIdentity = (candidate: File | null): number => {
        if (!candidate) return 0;
        const known = comparisonFileIdentityByRef.current.get(candidate);
        if (known !== undefined) return known;
        const next = nextComparisonFileIdentityRef.current;
        nextComparisonFileIdentityRef.current += 1;
        comparisonFileIdentityByRef.current.set(candidate, next);
        return next;
      };
      const baselineResult = results.find(
        (result) => result.inputFileName === fileName,
      );
      const key = JSON.stringify({
        file: exactFileIdentity(file),
        workspaceRoot:
          baselineResult?.rustRuntimeReceipt?.workspaceRootDigest ?? null,
        supports: supportFileInputList<File | null>({
          filterFile,
          appsForcingScreenOpenFile,
          backgroundAppsFile,
          appCodebookFile,
          studyDatesFile,
          deviceSharingFile,
          surveyAttributionFile,
          enrolledDevicesFile,
        }).map(exactFileIdentity),
        options: requestedOptions,
      });
      if (comparisonWarmupRef.current?.key === key) {
        return comparisonWarmupRef.current.promise;
      }
      const backgroundWorkerCount = Math.min(
        COMPARISON_WORKER_LIMIT - 1,
        Math.max(
          0,
          new Set(
            results
              .map((result) => result.inputSha256)
              .filter((digest): digest is string => !!digest),
          ).size - 1,
        ),
      );
      // Constructing the background pool starts WASM initialization while the
      // drawer is open. Do not execute Arm A on every worker: configuration is
      // part of the cache key, so that speculative work cannot warm changed B.
      getComparisonPool(backgroundWorkerCount);
      const supportInputs = supportFileInputList<File | null>({
        filterFile,
        appsForcingScreenOpenFile,
        backgroundAppsFile,
        appCodebookFile,
        studyDatesFile,
        deviceSharingFile,
        surveyAttributionFile,
        enrolledDevicesFile,
      });
      const setup = (async () => {
        const resolvedOptions = await resolveRunOptions(requestedOptions, [
          file,
        ]);
        const changedUploads =
          await buildSupportFilesForOptions(resolvedOptions);
        const supportFiles = await resolveDefaultSupportFiles(
          resolvedOptions,
          changedUploads,
        );
        return {
          options: resolvedOptions,
          supportFiles,
          supportCacheKey: await comparisonSupportCacheKey(supportFiles),
        };
      })();
      const promise = setup
        .then(({ options, supportFiles }) =>
          executeComparisonReview(fileName, options, supportFiles),
        )
        .catch((error) => {
        if (comparisonWarmupRef.current?.promise === promise) {
          comparisonWarmupRef.current = null;
        }
        throw error;
      });
      comparisonWarmupRef.current = {
        key,
        setup,
        supportInputs,
        promise,
      };
      return promise;
    },
    [
      executeComparisonReview,
      getComparisonPool,
      options,
      resultsOptions,
      results,
      uploadedFiles,
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

  /** Re-run every loaded review file under Arm B. The selected file uses the
   * worker warmed while the drawer was open, so its chart can update first;
   * seven pool workers process the remaining files concurrently. */
  const runComparison = useCallback(
    async (
      priorityFileName: string,
      overrides: Partial<BrowserProcessingOptions>,
      onResults?: (results: ProcessedFileResult[]) => void,
    ): Promise<ProcessedFileResult[]> => {
      const reviewableNames = new Set(
        results
          .filter(
            (result) =>
              !!result.reviewSummary ||
              result.rustRuntimeReceipt?.persistedGeneration !== undefined,
          )
          .map((result) => result.inputFileName),
      );
      const files = uploadedFiles.filter((file) =>
        reviewableNames.has(file.name),
      );
      if (!files.some((file) => file.name === priorityFileName)) {
        throw new Error(
          "The raw file for this run is no longer loaded. Re-add it in the Files tab to compare.",
        );
      }

      // Arm A is the configuration that actually produced `results`, not the
      // possibly edited live Settings state.
      const baselineOptions = resultsOptions ?? options;
      const requestedArmB = sanitizeOptions({
        ...baselineOptions,
        ...overrides,
      });
      const armBOptions = await resolveRunOptions(requestedArmB, files);
      const currentSupportInputs = supportFileInputList<File | null>({
        filterFile,
        appsForcingScreenOpenFile,
        backgroundAppsFile,
        appCodebookFile,
        studyDatesFile,
        deviceSharingFile,
        surveyAttributionFile,
        enrolledDevicesFile,
      });
      const warmup = comparisonWarmupRef.current;
      const warmSetup =
        warmup &&
        warmup.supportInputs.length === currentSupportInputs.length &&
        warmup.supportInputs.every(
          (input, index) => input === currentSupportInputs[index],
        )
          ? await warmup.setup
          : null;
      const canReuseWarmSetup =
        warmSetup !== null &&
        JSON.stringify(warmSetup.options) === JSON.stringify(armBOptions);
      const changedSupportFiles = canReuseWarmSetup
        ? warmSetup.supportFiles
        : await resolveDefaultSupportFiles(
            armBOptions,
            await buildSupportFilesForOptions(armBOptions),
          );
      const changedSupportCacheKey = canReuseWarmSetup
        ? warmSetup.supportCacheKey
        : await comparisonSupportCacheKey(changedSupportFiles);
      const inputDigestByName = new Map(
        results.map((result) => [result.inputFileName, result.inputSha256]),
      );

      type ComparisonGroup = {
        digest: string;
        members: Array<{ file: File; index: number }>;
      };
      const groupByDigest = new Map<string, ComparisonGroup>();
      files.forEach((file, index) => {
        const digest = inputDigestByName.get(file.name);
        if (!digest) {
          throw new Error(
            `completed result is missing its raw input digest: ${file.name}`,
          );
        }
        const group = groupByDigest.get(digest) ?? { digest, members: [] };
        group.members.push({ file, index });
        groupByDigest.set(digest, group);
      });
      const activeGroup = Array.from(groupByDigest.values()).find((group) =>
        group.members.some(({ file }) => file.name === priorityFileName),
      );
      if (!activeGroup) {
        throw new Error("selected comparison file has no input digest group");
      }
      const schedule = Array.from(groupByDigest.values())
        .filter((group) => group !== activeGroup)
        .sort((left, right) => {
          const leftMember = left.members[0];
          const rightMember = right.members[0];
          if (leftMember === undefined || rightMember === undefined) return 0;
          return (
            rightMember.file.size - leftMember.file.size ||
            leftMember.index - rightMember.index
          );
        });
      const completed: Array<ProcessedFileResult | undefined> = Array.from(
        { length: files.length },
        () => undefined,
      );
      const failures: string[] = [];
      const recordGroup = (
        group: ComparisonGroup,
        result: ProcessedFileResult,
      ): void => {
        const labeledResults = group.members.map(({ file, index }) => {
          const labeled =
            result.inputFileName === file.name
              ? result
              : relabelDuplicateContentResult(result, file.name);
          completed[index] = labeled;
          return labeled;
        });
        onResults?.(labeledResults);
      };
      const backgroundWorkerCount = Math.min(
        COMPARISON_WORKER_LIMIT - 1,
        schedule.length,
      );
      const pool = getComparisonPool(backgroundWorkerCount);
      let cursor = 0;
      const runner = async (): Promise<void> => {
        for (;;) {
          const group = schedule[cursor];
          cursor += 1;
          if (!group) return;
          const item = group.members[0];
          if (item === undefined) continue;
          try {
            const verifiedInputSha256 =
              verifiedInputDigestByFileRef.current.get(item.file) ===
              group.digest
                ? group.digest
                : undefined;
            const result = verifiedInputSha256
              ? await processPersistedOrRawChangedReviewViaPool(
                  pool!,
                  item.file.name,
                  item.file.size,
                  () => item.file.arrayBuffer(),
                  armBOptions,
                  changedSupportFiles,
                  getInjectedRuntime(),
                  verifiedInputSha256,
                  changedSupportCacheKey,
                )
              : await processRawCsvChangedReviewBytesViaPool(
                  pool!,
                  item.file.name,
                  await item.file.arrayBuffer(),
                armBOptions,
                  changedSupportFiles,
                  getInjectedRuntime(),
                  verifiedInputSha256,
                );
            recordGroup(group, result);
          } catch (error) {
            failures.push(
              `${item.file.name}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      };
      const activeTask = (async (): Promise<void> => {
        try {
          const result = await prepareComparison(priorityFileName, armBOptions);
          recordGroup(activeGroup, result);
        } catch (error) {
          failures.push(
            `${priorityFileName}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
      try {
        await Promise.all([
          activeTask,
          ...Array.from({ length: backgroundWorkerCount }, () => runner()),
        ]);
      } finally {
        releaseComparisonPoolWhenIdle();
      }
      const successful = completed.filter(
        (result): result is ProcessedFileResult => !!result,
      );
      if (failures.length) {
        setToast({
          message: `Compared ${successful.length}/${files.length} files. ${failures[0]}`,
          isError: true,
        });
      }
      if (!successful.length) {
        throw new Error(failures[0] ?? "No files could be compared.");
      }
      return successful;
    },
    [
      uploadedFiles,
      results,
      resultsOptions,
      options,
      filterFile,
      appsForcingScreenOpenFile,
      backgroundAppsFile,
      appCodebookFile,
      studyDatesFile,
      deviceSharingFile,
      surveyAttributionFile,
      enrolledDevicesFile,
      executeComparisonReview,
      getComparisonPool,
      prepareComparison,
      releaseComparisonPoolWhenIdle,
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
      const timezones = await discoverTimezonesBytes(
        await file.arrayBuffer(),
        getInjectedRuntime(),
      );
      timezones.forEach((timezone) => discovered.add(timezone));
    }
    const next = Array.from(discovered).sort((left, right) =>
      left.localeCompare(right),
    );
    setDiscoveredTimezones(next);
    if (!options.selectedTimezone && next.length === 1) {
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
    let runOptions: BrowserProcessingOptions;
    try {
      runOptions = await resolveRunOptions(options, uploadedFiles);
      if (runOptions !== options) setOptions(runOptions);
    } catch (resolutionError) {
      const message =
        resolutionError instanceof Error
          ? resolutionError.message
          : String(resolutionError);
      setError(message);
      setToast({ message, isError: true });
      setActiveWorkflow("process");
      processingRef.current = false;
      return;
    }
    const capability = await probeOpfsCapability();
    setWorkspaceCapability(capability);
    if (capability.status === "unavailable") {
      setError(`Durable local workspace unavailable. ${capability.reason}`);
      setActiveWorkflow("process");
      processingRef.current = false;
      return;
    }
    setActiveWorkflow("process");
    setProcessExpanded(true);
    setIsRunning(true);
    setError(null);
    cancelRequestedRef.current = false;
    startTimeRef.current = performance.now();

    const order = uploadedFiles.map((file) => file.name);
    setProgressOrder(order);
    setProgressByFile(
      Object.fromEntries(
        order.map((name) => [name, { fileName: name, status: "pending" }]),
      ),
    );
    setToast(null);

    void ensureNotificationPermission();

    let pool: WorkerPool | null = null;
    // Keep the processing details open after a run ONLY when something failed, so
    // the per-file Retry control stays visible (a clean run collapses to declutter).
    let keepDetailsOpen = false;
    try {
      const userSupportFiles = await buildSupportFilesForOptions(runOptions);
      const nextResults: Array<ProcessedFileResult | undefined> = Array.from(
        { length: uploadedFiles.length },
        () => undefined,
      );
      // Selection already hashed every inspected file. Size the expensive WASM
      // pool for distinct content, not filenames: 100 renamed copies need one
      // computation and therefore one worker, while unverified files remain
      // conservatively distinct.
      const uniqueVerifiedFiles = new Map<string, File>();
      const unverifiedFiles: File[] = [];
      for (const file of uploadedFiles) {
        const digest = verifiedInputDigestByFileRef.current.get(file);
        if (digest) uniqueVerifiedFiles.set(digest, file);
        else unverifiedFiles.push(file);
      }
      const computationalFiles = [
        ...uniqueVerifiedFiles.values(),
        ...unverifiedFiles,
      ];
      const totalInputBytes = computationalFiles.reduce(
        (sum, file) => sum + file.size,
        0,
      );
      const concurrency = runOptions.parallelProcessing
        ? computeSafeConcurrency({
            fileCount: computationalFiles.length,
            totalInputBytes,
            fileSizes: computationalFiles.map((file) => file.size),
            userCap: runOptions.parallelMaxWorkers,
            hardwareConcurrency:
              typeof navigator !== "undefined"
                ? navigator.hardwareConcurrency
                : undefined,
            deviceMemory: readDeviceMemory(),
          })
        : 1;
      // Hard lane ceiling for the measured (adaptive) admission path: cores/2
      // and the user's cap still bind, but the static memory guess does not —
      // workers report their real WASM high-water after each file and
      // computeAdaptiveLaneTarget grows concurrency only as far as those
      // measurements fit the device budget.
      const laneCap = runOptions.parallelProcessing
        ? Math.max(
            1,
            Math.min(
              computationalFiles.length,
              Math.max(
                1,
                Math.floor(
                  (typeof navigator !== "undefined"
                    ? (navigator.hardwareConcurrency ?? 2)
                    : 2) / 2,
                ),
              ),
              runOptions.parallelMaxWorkers && runOptions.parallelMaxWorkers > 0
                ? Math.floor(runOptions.parallelMaxWorkers)
                : Number.POSITIVE_INFINITY,
            ),
          )
        : 1;
      setEffectiveProcessingConcurrency(concurrency);
      // Resolve bundled-default support files once on the main thread so
      // every worker uses identical bytes (no per-worker fetches), and so
      // the user's uploads win over defaults.
      const supportFiles = await resolveDefaultSupportFiles(
        runOptions,
        userSupportFiles,
      );
      const injectedRuntime = getInjectedRuntime();
      // One batch gets one preprocessing timestamp. This removes filename- and
      // worker-scheduling-dependent output differences and makes exact-content
      // reuse correct and reproducible.
      const runRuntime: BrowserProcessingRuntime = {
        ...injectedRuntime,
        datetimeOfPreprocessing:
          injectedRuntime?.datetimeOfPreprocessing ??
          `${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`,
      };
      const completedByInputDigest = new Map<
        string,
        Promise<ProcessedFileResult>
      >();
      // Reuse each batch worker: WASM memory stays at the largest file's high-
      // water mark, while replacing a worker after every file would repeatedly
      // fetch, instantiate, and warm the same Rust module. Terminating this
      // batch-owned pool below still returns all worker memory after the run.
      const runPool = new WorkerPool(laneCap);
      pool = runPool;
      poolRef.current = pool;
      // Longest-processing-time first keeps one large export from becoming a
      // serial tail after every small file has completed. Results still occupy
      // their original indexes, so display/download order remains unchanged.
      const schedule = uploadedFiles
        .map((file, index) => ({ index, size: file.size }))
        .sort(
          (left, right) => right.size - left.size || left.index - right.index,
        )
        .map(({ index }) => index);
      let cursor = 0;
      const failures: string[] = [];
      const runner = async (laneRetired: () => boolean) => {
        for (;;) {
          if (cancelRequestedRef.current || laneRetired()) return;
          const index = schedule[cursor];
          cursor += 1;
          if (index === undefined) return;
          const file = uploadedFiles[index];
          if (file === undefined) continue;
          handleProgressEvent({ type: "file-start", fileName: file.name });
          try {
            const verifiedInputSha256 =
              verifiedInputDigestByFileRef.current.get(file);
            let computation = verifiedInputSha256
              ? completedByInputDigest.get(verifiedInputSha256)
              : undefined;
            if (!computation) {
              if (verifiedInputSha256) {
                // Publish the promise before the asynchronous file read. With
                // several runners, inserting it after `arrayBuffer()` lets each
                // runner miss the map and start the same digest independently.
                computation = (async () => {
                  // Transfer ownership rather than decoding with File.text(),
                  // which would create a second UTF-16-sized main-thread copy.
                  const bytes = await file.arrayBuffer();
                  return processRawCsvBytesViaPool(
                    runPool,
                    file.name,
                    bytes,
                    runOptions,
                    supportFiles,
                    runRuntime,
                    handleProgressEvent,
                    verifiedInputSha256,
                  );
                })();
                completedByInputDigest.set(verifiedInputSha256, computation);
              } else {
                const bytes = await file.arrayBuffer();
                computation = processRawCsvBytesViaPool(
                  runPool,
                  file.name,
                  bytes,
                  runOptions,
                  supportFiles,
                  runRuntime,
                  handleProgressEvent,
                );
              }
            }
            const computed = await computation;
            const result =
              computed.inputFileName === file.name
                ? computed
                : relabelDuplicateContentResult(computed, file.name);
            // If the user cancelled while this file was mid-flight, discard its
            // result instead of committing it — keeps the sequential path (which
            // can't terminate an in-flight worker) consistent with the pool path.
            if (cancelRequestedRef.current) return;
            if (!result.inputSha256) {
              throw new Error(
                "Rust result is missing its verified input digest",
              );
            }
            nextResults[index] = result;
            verifiedInputDigestByFileRef.current.set(file, result.inputSha256);
            adaptLaneTarget(computed.workerWasmMemoryBytes);
            handleProgressEvent({
              type: "file-complete",
              fileName: file.name,
              result,
            });
          } catch (fileError) {
            // A terminate() during cancel rejects the in-flight file; don't count
            // that as a real failure — the finally block marks it cancelled.
            if (cancelRequestedRef.current) return;
            const message =
              fileError instanceof Error
                ? fileError.message
                : String(fileError);
            failures.push(message);
            handleProgressEvent({
              type: "file-complete",
              fileName: file.name,
              error: message,
            });
          }
        }
      };
      // Adaptive admission: lanes start at the static governor's answer (the
      // safe pre-measurement floor) and grow toward laneCap as completed files
      // report real worker WASM high-water marks. A shrinking target retires
      // surplus lanes at their next loop head — an in-flight file is never
      // interrupted, and lane 1 can never retire, so the batch always drains.
      let maxObservedWorkerWasmBytes = 0;
      let laneTarget = concurrency;
      let activeLanes = 0;
      const lanePromises: Promise<void>[] = [];
      // A lane retires by observing there are more active lanes than the
      // target allows; the retirement itself gives the surplus slot back, so
      // exactly the excess retires (JS is single-threaded — no double count).
      const laneRetired = () => {
        if (activeLanes <= laneTarget) return false;
        activeLanes -= 1;
        return true;
      };
      const spawnLanesToTarget = () => {
        while (
          activeLanes < laneTarget &&
          cursor < schedule.length &&
          !cancelRequestedRef.current
        ) {
          activeLanes += 1;
          lanePromises.push(runner(laneRetired));
        }
      };
      const adaptLaneTarget = (observedWasmBytes: number | undefined) => {
        if (!runOptions.parallelProcessing) return;
        if (!observedWasmBytes || observedWasmBytes <= maxObservedWorkerWasmBytes)
          return;
        maxObservedWorkerWasmBytes = observedWasmBytes;
        const next = computeAdaptiveLaneTarget({
          laneCap,
          observedWorkerHighWaterBytes: maxObservedWorkerWasmBytes,
          deviceMemory: readDeviceMemory(),
          fallbackLanes: concurrency,
        });
        if (next === laneTarget) return;
        laneTarget = next;
        setEffectiveProcessingConcurrency(next);
        spawnLanesToTarget();
      };
      spawnLanesToTarget();
      while (lanePromises.length) {
        await Promise.all(lanePromises.splice(0));
      }

      const successful = nextResults.filter(Boolean) as ProcessedFileResult[];
      keepDetailsOpen = failures.length > 0;
      setResults(successful);
      if (successful.length) {
        setResultsOptions(runOptions);
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
          options: runOptions,
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
        !cancelled && failures.length
          ? `${summary} (${failures.length} failed)`
          : summary;
      setToast({ message, isError: failures.length > 0 && !cancelled });

      if (!cancelled && typeof document !== "undefined" && document.hidden) {
        sendNotification(
          failures.length
            ? "Chronicle: some files failed"
            : "Chronicle: processing complete",
          message,
        );
      }
    } catch (runError) {
      const message =
        runError instanceof Error ? runError.message : String(runError);
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
      const file = uploadedFiles.find(
        (candidate) => candidate.name === fileName,
      );
      if (!file) {
        setToast({
          message:
            "That file is no longer loaded. Re-add it in the Files tab to retry.",
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
        [fileName]: {
          fileName,
          status: "running",
          stepKind: "parse",
          percent: 0,
        },
      }));
      try {
        const capability = await probeOpfsCapability();
        setWorkspaceCapability(capability);
        if (capability.status === "unavailable") {
          throw new Error(
            `Durable local workspace unavailable. ${capability.reason}`,
          );
        }
        const userSupportFiles = await buildSupportFiles();
        const supportFiles = await resolveDefaultSupportFiles(
          options,
          userSupportFiles,
        );
        const bytes = await file.arrayBuffer();
        comparisonWarmupRef.current = null;
        const result = await processRawCsvBytes(
          file.name,
          bytes,
          options,
          supportFiles,
          getInjectedRuntime(),
          handleProgressEvent,
        );
        if (!result.inputSha256) {
          throw new Error("Rust result is missing its verified input digest");
        }
        verifiedInputDigestByFileRef.current.set(file, result.inputSha256);
        handleProgressEvent({ type: "file-complete", fileName, result });
        const merged = (() => {
          const byName = new Map(
            results.map((entry) => [entry.inputFileName, entry]),
          );
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
        void saveLastRun({
          options,
          results: merged,
          discoveredTimezones: nextTimezones,
        })
          .catch(() => {})
          .finally(() => void refreshStoragePressure());
        setToast({
          message: `Reprocessed ${demoDisplay.fileName(fileName)}.`,
          isError: false,
        });
      } catch (retryError) {
        const message =
          retryError instanceof Error ? retryError.message : String(retryError);
        handleProgressEvent({
          type: "file-complete",
          fileName,
          error: message,
        });
        setToast({ message, isError: true });
      } finally {
        retryingFileRef.current = null;
        setRetryingFile(null);
      }
    },
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
    (name) => progressByFile[name] ?? { fileName: name, status: "pending" as const },
  );
  const overallPercent =
    progressOrder.length === 0
      ? 0
      : progressOrder.reduce(
          (total, name) =>
            total +
            estimatedFilePercent(
              progressByFile[name] ?? { fileName: name, status: "pending" },
            ),
          0,
        ) / progressOrder.length;

  // Reflect run progress in the browser tab title so it's visible while the tab
  // is in the background, and restore the original title when the run ends.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (baseTitleRef.current === null) baseTitleRef.current = document.title;
    const base =
      baseTitleRef.current || "Chronicle Android Raw Data Preprocessor";
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
    !normalizedSettingsQuery ||
    text.toLowerCase().includes(normalizedSettingsQuery);
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
      if (flashTimerRef.current !== null)
        window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        target.classList.remove("settings-flash");
        flashTimerRef.current = null;
      }, 1600);
    });
  }, []);

  return (
    <>
      <a className="skip-link" href="#workflow-panels">
        Skip to workflow tabs
      </a>
      <main
        className={`app-shell ${activeWorkflow === "view" ? "app-shell--wide" : ""}`}
      >
        <header className="hero">
          <div className="hero__copy">
            <h1>Chronicle Android Raw Data Preprocessor</h1>
            <p className="lede">
              Drop one or more raw Chronicle CSVs to generate the preprocessed
              app usage and screen usage outputs. This app runs entirely in your
              browser. Your data never leaves your device.
            </p>
          </div>
          <ThemeToggle />
        </header>

        {updateReady ? (
          <div
            className="update-banner"
            role="status"
            data-testid="update-banner"
          >
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

        {workspaceCapability?.status === "unavailable" ? (
          <div
            className="storage-pressure"
            role="alert"
            data-testid="workspace-unavailable"
          >
            <span className="storage-pressure__text">
              <strong>Durable local processing is unavailable.</strong>{" "}
              {workspaceCapability.reason} Processing is disabled because this
              app will not silently run without a recoverable, verified
              workspace.
            </span>
          </div>
        ) : null}

        {storagePressure &&
        isStoragePressureHigh(storagePressure) &&
        !storagePressureDismissed ? (
          <div
            className="storage-pressure"
            role="status"
            data-testid="storage-pressure"
          >
            <span className="storage-pressure__text">
              <strong>
                Browser storage is {Math.round(storagePressure.ratio * 100)}%
                full
              </strong>{" "}
              ({formatBytes(storagePressure.usage)} of{" "}
              {formatBytes(storagePressure.quota)}). Export a backup of anything
              you need, then clear the cached last run to free space — otherwise
              saving a large run may fail.
            </span>
            <span className="storage-pressure__actions">
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="storage-pressure-clear"
                onClick={() => {
                  void clearCachedRunData()
                    .then(() => {
                      setToast({
                        message: "Cleared the cached last run.",
                        isError: false,
                      });
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
            <section
              id="settings"
              className="workflow-section"
              aria-labelledby="settings-title"
            >
              <div className="settings-command workflow-section__header">
                <div>
                  <h2 id="settings-title" className="workflow-section__title">
                    Settings
                  </h2>
                  <p className="workflow-section__intro">
                    Search every option, then save custom presets once the
                    settings are right.
                  </p>
                </div>
                <div className="settings-search settings-search--command">
                  <label
                    className="settings-search__eyebrow"
                    htmlFor="settings-search-input"
                  >
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
                  <SettingsSearchResults
                    query={settingsQuery}
                    onNavigate={navigateToSetting}
                  />
                </div>
              </div>
              <SettingsManagementCard
                options={options}
                setOptions={setOptions}
                hideDemoMetadata={hideDemoMetadata}
                onHideDemoMetadataChange={setHideDemoMetadata}
                onStatus={(message, isError = false) =>
                  setToast({ message, isError })
                }
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
                onStatus={(message, isError = false) =>
                  setToast({ message, isError })
                }
              />
              <SettingsOverviewCard options={options} setOptions={setOptions} />
              <div className="settings-stack">
                {shows(
                  "support files filter keep awake prevent screen sleep codebook",
                ) ? (
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
                {shows(
                  "session detection duration thresholds duplicate fallback stop",
                ) ? (
                  <SessionDetectionCard
                    options={options}
                    setOptions={setOptions}
                  />
                ) : null}
                {shows("screen detection autolock keyguard manual") ? (
                  <ScreenDetectionCard
                    options={options}
                    setOptions={setOptions}
                  />
                ) : null}
                {shows("interaction semantics remove stop usage") ? (
                  <InteractionSemanticsCard
                    options={options}
                    setOptions={setOptions}
                  />
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
              isInspecting={isInspectingFiles}
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
              effectiveProcessingConcurrency={effectiveProcessingConcurrency}
              expanded={processExpanded}
              onExpandedChange={setProcessExpanded}
            />

            <WorkspaceBackupControls results={results} />
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
                  setToast({
                    message: "Deleted the processed results.",
                    isError: false,
                  });
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
            {activeWorkflow === "guide" ? (
              <GuidePanel onNavigate={setActiveWorkflow} />
            ) : null}
          </div>

          <div
            id="graph-panel"
            role="tabpanel"
            aria-labelledby="graph-tab"
            hidden={activeWorkflow !== "graph"}
          >
            {activeWorkflow === "graph" ? (
              <Suspense
                fallback={
                  <p className="empty-state">Loading the pipeline graph…</p>
                }
              >
                <GraphPanel
                  results={results}
                  planStageView={planStageView}
                  displayMasker={demoDisplay}
                  options={options}
                />
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
              options={resultsOptions ?? options}
              uploadedFileNames={uploadedFileNames}
              onPrepareComparison={prepareComparison}
              onRunComparison={runComparison}
              displayMasker={demoDisplay}
              includeFilteredAppUsageInPlots={
                options.includeFilteredAppUsageInPlots
              }
            />
          </div>
        </div>

        <footer className="app-footer" data-testid="app-footer">
          <div className="app-footer__about" aria-label="App info">
            <span>
              Version {PREPROCESSOR_VERSION}+{BUILD_SHA}
            </span>
            <span aria-hidden="true">·</span>
            <span>Build {BUILD_DATE || BUILD_SHA}</span>
            <span aria-hidden="true">·</span>
            <span>Bundled codebook available</span>
            <span aria-hidden="true">·</span>
            <span>Runs entirely in your browser</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className="app-footer__cache-reset"
              onClick={() => {
                void clearSwCachesAndReload().catch(() => {
                  setError("Could not clear the cache. Try a hard reload (Ctrl+Shift+R / Cmd+Shift+R).");
                });
              }}
              title="Clear service worker caches and reload"
            >
              Trouble loading?
            </button>
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
