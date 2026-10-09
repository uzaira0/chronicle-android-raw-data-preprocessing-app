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
  type SetStateAction,
} from "react";
import {
  PREPROCESSOR_VERSION,
  resolveDefaultSupportFiles,
} from "@/lib/processingUiContract";
import {
  WorkerPool,
  comparisonSupportCacheKey,
  discoverTimezonesBytes,
  executeLiteratureComponentBytes,
  deletePersistedWorkspaces,
  garbageCollectWorkspaceAfterResults,
  getWorkflowExplorerView,
  processPersistedOrRawChangedReview,
  processPersistedOrRawChangedReviewViaPool,
  processRawCsvBytes,
  processRawCsvChangedReviewBytesViaPool,
  processRawCsvReviewBytes,
  processRawCsvBytesViaPool,
  probeWorkerWorkspaceCapability,
  onWorkerBackgroundFailure,
  warmRuntime,
} from "@/lib/rustWorkerClient";
import { BUILD_DATE, BUILD_SHA } from "@/lib/buildInfo";
import { processingErrorText, recordError, setSensitiveNames } from "@/lib/diagnostics";
import {
  benchmarkPayloadBudgetOverride,
  testRuntimeOverride,
} from "@/lib/testHooks";
import { BROWSER_OPTION_TOOLTIPS } from "@/lib/generatedContract";
import {
  collectOptionRangeViolations,
  collectRawColumnViolations,
  maskRawColumnViolations,
  rawColumnViolationMessage,
  SUPPORT_FILE_ACCEPT,
} from "@/lib/validation";
import { restoreStoredSupportFile } from "@/components/supportFilePick";
import {
  ensureNotificationPermission,
  sendNotification,
} from "@/lib/notification";
import {
  clearLastRun,
  clearLastComponentManifest,
  detectLegacyLastRunState,
  loadLastRunOutcome,
  loadLastComponentManifest,
  saveLastRun,
  saveLastComponentManifest,
  type LegacyLastRunState,
} from "@/lib/lastRunStore";
import {
  computeAdaptiveLaneTarget,
  computeSafeConcurrency,
  computeSafeComparisonPoolSize,
  MIN_PAYLOAD_BUDGET_BYTES,
  payloadBudgetBytesForWorkers,
  readDeviceMemory,
} from "@/lib/concurrency";
import {
  clearCachedRun as clearCachedRunData,
  consumeLocalDataDeletedMark,
  markLocalDataDeleted,
  removePayloadSpillFiles,
  resetLocalData,
} from "@/lib/localDataReset";
import { createProcessingRunLifecycle } from "@/lib/processingRunLifecycle";
import {
  detectLegacyOpfsState,
  ephemeralWorkspaceNotice,
  probeOpfsCapability,
  resultsLackPersistedOutputs,
  transientWorkspaceRefusalNotice,
  workspaceDegradesToEphemeral,
  workspaceRefusesRun,
  type LegacyOpfsState,
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
  loadMethodReceiptValidation,
  mergeStoredSettingsChange,
  methodReceiptInputUses,
  persistOptions,
  readPersistedMethodProfileReceipts,
  readPersistedOptions,
  readSharedConfig,
  SETTINGS_STORAGE_KEY,
  storedReceiptsChanged,
  storedSettingsReceipts,
  sanitizeOptions,
  SHARED_CONFIG_PARAM,
  textHoldsMethodReceipt,
} from "@/lib/settingsPersistence";
import {
  createDemoDisplayMasker,
  persistDemoDisplayEnabled,
  readDemoDisplayEnabled,
} from "@/lib/demoDisplay";
import {
  createRawFileInspectionBatch,
  releaseRawFileInspectionBatch,
  assertUniqueRawFileNames,
  commitRawFileSelectionAtomically,
  splitMixedStudyFiles,
  fragmentedParticipantTokensByInputDigest,
  inspectRawFiles,
  type ParticipantPartitionTransport,
  type RawFileInspection,
  type RawFileInspectionBatch,
} from "@/lib/fileInspection";
import {
  requiresLiveScientificPreflight,
  usesInputCapabilityEvidence,
} from "@/lib/inputCapabilityEvidence";
import type { RegisteredLiteratureComponentExecution } from "@/lib/literatureInputAdapters";
import type { LiteratureComponentRuntimeExecution } from "@/lib/rustPipelineRuntime";
import { relabelDuplicateContentResult } from "@/lib/duplicateContentResult";
import { applyProgressEvent } from "@/lib/progressReducer";
import { rawInspectionSelectionIsReady } from "@/lib/rawInspectionReadiness";
import { scientificPreflightReceiptFromError } from "@/lib/scientificPreflightTransport";
import {
  resolveRetryExecutionBinding,
  type ResultExecutionBinding,
} from "@/lib/retryExecutionBinding";
import {
  comparisonFailure,
  PartialComparisonFailureError,
  type ComparisonFailure,
} from "@/lib/comparisonFailures";
import { storedFileToFile, type ProjectRecord } from "@/lib/projectsStore";
import { applyProjectAtomically } from "@/lib/projectApplication";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFile,
  BrowserSupportFiles,
  MethodProfileReceipts,
  ProcessedFileResult,
  ProgressEvent,
  ProgressStepKind,
} from "@/lib/types";
import { workflowExplorerSupportRoles } from "@/lib/workflowExplorerSupport";

import { FilesAndInputsCard } from "@/components/FilesAndInputsCard";
import { StudyInputsCard } from "@/components/StudyInputsCard";
import { AnalyzeSettingsCard } from "@/components/AnalyzeSettingsCard";
import { CleaningSettingsCard } from "@/components/CleaningSettingsCard";

// Lazy: React Flow + dagre only load when the Graph tab is opened.
const GraphPanel = lazy(() =>
  import("@/components/GraphPanel/GraphPanel").then((module) => ({
    default: module.GraphPanel,
  })),
);

// Lazy: these panels pull in the Rust runtime bridge, the plot generators and
// the packed method-profile registries (about 10 MB of JSON once decoded).
// None of it is needed to paint the first screen, so it loads after it.
const ResultPanel = lazy(() =>
  import("@/components/ResultPanel").then((module) => ({ default: module.ResultPanel })),
);
const LiteratureComponentResultPanel = lazy(() =>
  import("@/components/LiteratureComponentResultPanel").then((module) => ({
    default: module.LiteratureComponentResultPanel,
  })),
);
const ViewPanel = lazy(() =>
  import("@/components/ViewPanel").then((module) => ({ default: module.ViewPanel })),
);
// The two method cards hand receipts back to App, so they render only once
// receipt validation is loaded: every receipt App then holds can be validated
// and its input uses resolved synchronously.
const ResearchMethodProfileCard = lazy(() =>
  Promise.all([
    import("@/components/ResearchMethodProfileCard"),
    loadMethodReceiptValidation(),
  ]).then(([module]) => ({ default: module.ResearchMethodProfileCard })),
);
const SleepDiaryReplicationCard = lazy(() =>
  Promise.all([
    import("@/components/SleepDiaryReplicationCard"),
    loadMethodReceiptValidation(),
  ]).then(([module]) => ({ default: module.SleepDiaryReplicationCard })),
);

/** Stands in for a lazily loaded settings card while its code loads. */
function SettingsCardLoading({
  anchor,
  title,
}: {
  anchor: "research-method-profile" | "sleep-diary-replication";
  title: string;
}): ReactElement {
  return (
    <section className={`settings-management settings-card-loading settings-card-loading--${anchor}`} data-settings-anchor={anchor} aria-busy="true">
      <header className="workflow-section__header">
        <div>
          <h3 className="workflow-section__subtitle">{title}</h3>
          <p className="workflow-section__intro" role="status">Loading…</p>
        </div>
      </header>
    </section>
  );
}

const COMPARISON_WORKER_LIMIT = 8;
import { TimezoneCard } from "@/components/TimezoneCard";
import { SessionDetectionCard } from "@/components/SessionDetectionCard";
import { ScreenDetectionCard } from "@/components/ScreenDetectionCard";
import { InteractionSemanticsCard } from "@/components/InteractionSemanticsCard";
import { PerformanceCard } from "@/components/PerformanceCard";
import { WorkspaceBackupControls } from "@/components/WorkspaceBackupControls";
import type { FileProgress } from "@/components/ProgressList";
import { Toast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LocalDataInventory } from "@/components/LocalDataInventory";
import { FooterNotices } from "@/components/FooterNotices";
import { DiagnosticReportControl } from "@/components/DiagnosticReportControl";
import {
  admitRawFilesBySize,
  assertRawFileWithinLimit,
} from "@/lib/inputLimits";
import { GuidePanel } from "@/components/GuidePanel";
import { WorkflowNav, type WorkflowTab } from "@/components/WorkflowNav";
import { RawFilesCard } from "@/components/RawFilesCard";
import { ProcessPanel } from "@/components/ProcessPanel";
import { SettingsManagementCard } from "@/components/SettingsManagementCard";
import { ProjectsCard } from "@/components/ProjectsCard";
import { SettingsOverviewCard } from "@/components/SettingsOverviewCard";
import { SettingsSearchResults } from "@/components/SettingsSearchResults";
import { ThemeToggle } from "@/components/ThemeToggle";
import { requireDefined } from "@/lib/invariant";
import { clearSwCachesAndReload } from "@/lib/swCache";
import { applyUpdate, onUpdateReady } from "@/lib/swUpdate";

async function readSupportFile(file: File): Promise<BrowserSupportFile> {
  return {
    name: file.name,
    bytes: await file.arrayBuffer(),
  };
}

/**
 * `persistRustWorkspace` is the durability decision, not a constant. When the
 * verified OPFS round-trip probe fails the run still happens, on the runtime's
 * complete non-persisted branch (see `ephemeralWorkspaceNotice`); an injected
 * test runtime keeps owning the flag outright.
 */
type RuntimeToggles = {
  incrementalEngine: boolean;
  provenanceEvidence: boolean;
};

function getInjectedRuntime(
  persistRustWorkspace: boolean,
  toggles: RuntimeToggles,
): BrowserProcessingRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  const injected = testRuntimeOverride();
  if (!injected) {
    return {
      executionAuthority: "rust",
      persistRustWorkspace,
      ...toggles,
    };
  }
  // Whether the browser can persist is a fact about the browser, not a test
  // knob. A test runtime that pins `persistRustWorkspace` still wins outright;
  // one that only fixes the timestamp must not force a persisted run in a
  // context that has no usable origin-private storage.
  return injected.persistRustWorkspace === undefined && !persistRustWorkspace
    ? { ...injected, persistRustWorkspace: false }
    : injected;
}

/** Benchmarks pin the old fixed 512 MiB budget to compare against it. */
function workerPayloadBudgetBytes(simultaneousWorkers: number): number {
  if (benchmarkPayloadBudgetOverride() === MIN_PAYLOAD_BUDGET_BYTES) {
    return MIN_PAYLOAD_BUDGET_BYTES;
  }
  return payloadBudgetBytesForWorkers(readDeviceMemory(), simultaneousWorkers);
}

/**
 * The durable-workspace gate. Both contexts must hold: this thread reads the
 * OPFS the UI shows, and the Rust worker performs every actual workspace write.
 * A browser can grant one and deny the other (Safari private browsing denies
 * both; a sandboxed or partitioned worker can deny only its own), so either
 * failure closes the gate and the first concrete reason is what the user sees.
 */
async function probeDurableWorkspaceCapability(): Promise<OpfsCapability> {
  const [mainThread, worker] = await Promise.all([
    probeOpfsCapability(),
    probeWorkerWorkspaceCapability(),
  ]);
  if (mainThread.status === "unavailable") return mainThread;
  return worker;
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
/** A background failure shown beside the storage-pressure banner. */
type BackgroundNotice = {
  key: "reclaim" | "spill-sweep" | "last-run";
  title: string;
  detail: string;
  /** Offer the existing "Clear cached run" confirmation. */
  offerClearCachedRun?: boolean;
};

const WORKFLOW_STORAGE_KEY = "chronicle-web.activeWorkflow";
const PROVENANCE_EVIDENCE_STORAGE_KEY = "chronicle-web.provenanceEvidence";

function readProvenanceEvidenceEnabled(): boolean {
  try {
    return localStorage.getItem(PROVENANCE_EVIDENCE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

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
  const [activeLiteratureComponent, setActiveLiteratureComponent] =
    useState<RegisteredLiteratureComponentExecution | null>(null);
  const [literatureComponentResult, setLiteratureComponentResult] =
    useState<LiteratureComponentRuntimeExecution | null>(null);
  const componentRestoreSuperseded = useRef(false);
  const [literatureComponentError, setLiteratureComponentError] =
    useState<string | null>(null);
  const [isLiteratureComponentRunning, setIsLiteratureComponentRunning] =
    useState(false);
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
  const rawInspectionBatchRef = useRef<RawFileInspectionBatch | null>(null);
  const fragmentedTokensByDigestRef = useRef(new Map<string, string[]>());
  const rawInspectionGenerationRef = useRef(0);
  const [isInspectingFiles, setIsInspectingFiles] = useState(false);
  const [rawInspectionReady, setRawInspectionReady] = useState(false);
  const comparisonOperationCountRef = useRef(0);
  const [isComparing, setIsComparing] = useState(false);
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
  const [inputCapabilityEvidenceFile, setInputCapabilityEvidenceFile] =
    useState<File | null>(null);
  const [analysisFeatureMatrixFile, setAnalysisFeatureMatrixFile] =
    useState<File | null>(null);
  const [callSmsEligibilityFile, setCallSmsEligibilityFile] =
    useState<File | null>(null);
  const [phoneStudyPsCommunicationFile, setPhoneStudyPsCommunicationFile] =
    useState<File | null>(null);
  const [phoneStudyEsFile, setPhoneStudyEsFile] = useState<File | null>(null);
  const [anchorEventsFile, setAnchorEventsFile] = useState<File | null>(null);
  const [discoveredTimezones, setDiscoveredTimezones] = useState<string[]>([]);
  // When options are seeded from a shared link we skip the very first persist so
  // that merely *opening* someone's link does not silently overwrite the
  // recipient's own saved settings. They take over only once the recipient
  // actually edits a setting (any later change persists normally). Set
  // synchronously during init because the persist effect runs before the
  // URL-strip effect below.
  const skipNextPersist = useRef(false);
  // Whether saved settings existed BEFORE this session wrote anything. Captured
  // in a lazy initializer (first render, before any effect) because the persist
  // effect below writes the storage key on mount — a mount-effect
  // hasPersistedOptions() check would see this session's own write and announce
  // "Last used settings restored." on every pristine first visit.
  const [hadPersistedOptionsAtBoot] = useState(() => hasPersistedOptions());
  const [activeMethodProfileReceipts, setActiveMethodProfileReceipts] =
    useState<MethodProfileReceipts>(() =>
      typeof window !== "undefined" && !readSharedConfig(window.location.search)
        ? readPersistedMethodProfileReceipts()
        : {},
    );
  const [options, setOptionsState] = useState<BrowserProcessingOptions>(() => {
    const shared =
      typeof window === "undefined"
        ? null
        : readSharedConfig(window.location.search);
    if (shared) skipNextPersist.current = true;
    return shared ?? readPersistedOptions();
  });
  const setOptions = useCallback((next: SetStateAction<BrowserProcessingOptions>): void => {
    setActiveMethodProfileReceipts((current) => ({ ...current, android: undefined }));
    setOptionsState(next);
  }, []);
  const [progressByFile, setProgressByFile] = useState<
    Record<string, FileProgress>
  >({});
  const [progressOrder, setProgressOrder] = useState<string[]>([]);
  const [toast, setToast] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  // Stable identity so the toast's dismiss timer is not restarted by every
  // unrelated App render (it was an inline arrow, and a success toast stayed
  // up for as long as anything else on the page kept re-rendering).
  const dismissToast = useCallback(() => setToast(null), []);
  const settingsPersistFailedRef = useRef(false);
  // The destructive action awaiting confirmation, if any. Each one is
  // irreversible, so none runs until the confirmation dialog is accepted.
  const [pendingConfirmation, setPendingConfirmation] = useState<
    | "delete-results"
    | "clear-files"
    | "clear-cached-run"
    | "delete-all-local-data"
    | null
  >(null);
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
  const [provenanceEvidence, setProvenanceEvidenceState] = useState(
    readProvenanceEvidenceEnabled,
  );
  const setProvenanceEvidence = useCallback((next: boolean) => {
    setProvenanceEvidenceState(next);
    try {
      localStorage.setItem(PROVENANCE_EVIDENCE_STORAGE_KEY, String(next));
    } catch {
      // A context without storage still honors the toggle for this session.
    }
  }, []);
  // Runs read the toggles' live state, not storage, so a context whose
  // storage throws still runs what the card shows.
  // The Salsa incremental engine is switched off in the app: every run uses
  // the sequential scheduler. Only an injected test runtime can still ask for
  // it.
  const runtimeTogglesRef = useRef<RuntimeToggles>({
    incrementalEngine: false,
    provenanceEvidence,
  });
  runtimeTogglesRef.current = { incrementalEngine: false, provenanceEvidence };
  const [processExpanded, setProcessExpanded] = useState(true);
  const [hideDemoMetadata, setHideDemoMetadata] = useState(() =>
    readDemoDisplayEnabled(),
  );
  const [storagePressure, setStoragePressure] =
    useState<StoragePressure | null>(null);
  const [workspaceCapability, setWorkspaceCapability] =
    useState<OpfsCapability | null>(null);
  // The same decision as `workspaceCapability`, readable synchronously by the
  // runtime factory: a run resolves its persistence flag while the probe's
  // state update may still be queued.
  // Mirrors workspaceCapability.status for the runtime-injection call sites,
  // which read it synchronously inside callbacks created before the probe
  // resolves — state alone would be a stale closure there.
  const durableWorkspaceRef = useRef(true);
  /**
   * The boot probe, so a pre-run consumer can wait for the real answer instead
   * of reading the optimistic `true` this ref initializes to. Without it the
   * first interaction in an OPFS-denied browser resolved a runtime from a ref
   * that had not been written yet, which failed or persisted nondeterministically
   * depending on whether the probe happened to have settled.
   */
  const bootWorkspaceProbeRef = useRef<Promise<OpfsCapability> | null>(null);
  const applyWorkspaceCapability = useCallback((capability: OpfsCapability) => {
    // Only a structurally unsupported context runs without persistence. An
    // indeterminate failure (quota, a worker that restarted, an unexplained
    // rejection) keeps the durable flag set: the run is refused below rather
    // than silently downgraded, because an unpersisted batch is lost on reload.
    durableWorkspaceRef.current = !workspaceDegradesToEphemeral(capability);
    setWorkspaceCapability(capability);
    return capability;
  }, []);
  /** Wait for the boot probe before reading `durableWorkspaceRef` off a path
   * that is not itself a run (it never re-probes; a run does). */
  const ensureDurableWorkspaceKnown = useCallback(async (): Promise<boolean> => {
    const pending = bootWorkspaceProbeRef.current;
    // Both probes turn every failure into an "unavailable" status, so this
    // only waits for the boot probe to settle; its result is already applied.
    if (pending) await pending.catch(() => {});
    return durableWorkspaceRef.current;
  }, []);
  /** A run re-probes: storage can be lost between boot and the button. */
  const reprobeWorkspaceCapability = useCallback(
    async (): Promise<OpfsCapability> =>
      applyWorkspaceCapability(await probeDurableWorkspaceCapability()),
    [applyWorkspaceCapability],
  );
  const [legacyOpfsState, setLegacyOpfsState] =
    useState<LegacyOpfsState | null>(null);
  const [legacyLastRunState, setLegacyLastRunState] =
    useState<LegacyLastRunState | null>(null);
  const [workflowExplorerView, setWorkflowExplorerView] = useState<
    ProcessedFileResult["workflowExplorerView"] | null
  >(null);
  const [storagePressureDismissed, setStoragePressureDismissed] =
    useState(false);
  // Failures of work nobody is waiting on (reclaiming old outputs, sweeping
  // dead workers' spill files, reopening the saved run). Each is shown beside
  // the storage-pressure banner until dismissed, and recorded for the
  // diagnostic report; one notice per kind, the latest wins.
  const [backgroundNotices, setBackgroundNotices] = useState<BackgroundNotice[]>([]);
  const reportBackgroundFailure = useCallback(
    (notice: BackgroundNotice, error: unknown) => {
      console.error(notice.title, error);
      recordError("background", error, notice.title);
      setBackgroundNotices((current) => [
        ...current.filter(({ key }) => key !== notice.key),
        notice,
      ]);
    },
    [],
  );
  const dismissBackgroundNotice = useCallback((key: BackgroundNotice["key"]) => {
    setBackgroundNotices((current) => current.filter((notice) => notice.key !== key));
  }, []);
  useEffect(
    () =>
      onWorkerBackgroundFailure(({ message }) => {
        reportBackgroundFailure(
          {
            key: "spill-sweep",
            title: "Temporary processing files could not be cleaned up.",
            detail: `Files a closed processing worker left in this browser's storage are still there (${message}). They are retried after the next file, and “Delete all local data” in the footer removes them.`,
          },
          new Error(message),
        );
      }),
    [reportBackgroundFailure],
  );
  const [retryingFile, setRetryingFile] = useState<string | null>(null);
  const [effectiveProcessingConcurrency, setEffectiveProcessingConcurrency] =
    useState<number | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const baseTitleRef = useRef<string | null>(null);
  // Snapshot of the options that produced `results`, so the Result panel can warn
  // when the live settings have since drifted (out-of-date outputs).
  const [resultsOptions, setResultsOptions] =
    useState<BrowserProcessingOptions | null>(null);
  const [resultsExecutionBinding, setResultsExecutionBinding] =
    useState<ResultExecutionBinding | null>(null);
  // The support Files that produced `results`; null (a restored run, whose
  // files are unknown) compares as none, so supplying any support file marks
  // it stale. Replacing one makes the results stale just like a settings edit.
  const [resultsSupportFiles, setResultsSupportFiles] = useState<
    (File | null)[] | null
  >(null);
  const startTimeRef = useRef<number>(0);
  // A run can be cancelled mid-flight: the flag stops the runner from claiming the
  // next file, and the pool ref lets us terminate in-flight workers immediately.
  const cancelRequestedRef = useRef(false);
  const processingRunLifecycleRef = useRef(createProcessingRunLifecycle());
  const poolRef = useRef<WorkerPool | null>(null);
  const warmProcessingPoolRef = useRef<{
    size: number;
    pool: WorkerPool;
    payloadBudgetBytes: number;
  } | null>(null);
  const garbageCollectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingGarbageCollectionRef = useRef(new Set<string>());
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

  const supportFileSlots = [
    filterFile,
    appsForcingScreenOpenFile,
    backgroundAppsFile,
    appCodebookFile,
    studyDatesFile,
    deviceSharingFile,
    surveyAttributionFile,
    enrolledDevicesFile,
    inputCapabilityEvidenceFile,
  ];
  const resultsStale =
    results.length > 0 &&
    resultsOptions !== null &&
    (JSON.stringify(options) !== JSON.stringify(resultsOptions) ||
      supportFileSlots.some(
        (file, index) => file !== (resultsSupportFiles?.[index] ?? null),
      ));

  // The diagnostic report must never name a participant's file. Every file
  // name this tab has seen (picked, refused, open, or named by a restored run)
  // is redacted from anything recorded for the rest of the session, so a name
  // that reaches an error after its file was closed is still covered.
  const seenFileNamesRef = useRef(new Set<string>());
  const noteFileNames = useCallback((names: Iterable<string>): void => {
    const seen = seenFileNamesRef.current;
    const before = seen.size;
    for (const name of names) if (name.trim()) seen.add(name);
    if (seen.size !== before) setSensitiveNames([...seen]);
  }, []);
  const openFileNames = [
    ...uploadedFiles,
    ...supportFileSlots,
    analysisFeatureMatrixFile,
    callSmsEligibilityFile,
    phoneStudyPsCommunicationFile,
    phoneStudyEsFile,
    anchorEventsFile,
  ]
    .flatMap((file) => (file ? [file.name] : []))
    .join("\n");
  useEffect(() => {
    if (openFileNames) noteFileNames(openFileNames.split("\n"));
  }, [noteFileNames, openFileNames]);
  // Every error the app shows the user is also kept for the diagnostic report.
  useEffect(() => {
    if (error) recordError("shown", error, "error banner");
  }, [error]);
  useEffect(() => {
    if (toast?.isError) recordError("shown", toast.message, "notice");
  }, [toast]);

  const disposeComparisonPool = useCallback((): void => {
    comparisonPoolRef.current?.pool.terminate();
    comparisonPoolRef.current = null;
    comparisonWarmupRef.current = null;
  }, []);

  const disposeProcessingPool = useCallback((): void => {
    warmProcessingPoolRef.current?.pool.terminate();
    warmProcessingPoolRef.current = null;
  }, []);

  // The active file and the background files both queue on this pool, so a
  // lone-worker budget never runs beside the shared worker. Fresh comparison
  // pools do run beside it and keep the 512 MiB floor.
  const getWarmProcessingPool = useCallback((): WorkerPool | null => {
    const current = warmProcessingPoolRef.current?.pool;
    return !processingRef.current &&
      getInjectedRuntime(
        durableWorkspaceRef.current,
        runtimeTogglesRef.current,
      )?.incrementalEngine === true &&
      current?.usable
      ? current
      : null;
  }, []);

  const scheduleGarbageCollection = useCallback(
    (workspaceIds: string[]): void => {
      for (const workspaceId of workspaceIds) {
        pendingGarbageCollectionRef.current.add(workspaceId);
      }
      if (garbageCollectionTimerRef.current !== null) {
        clearTimeout(garbageCollectionTimerRef.current);
      }
      if (pendingGarbageCollectionRef.current.size === 0) return;
      const start = () => {
        garbageCollectionTimerRef.current = setTimeout(() => {
          garbageCollectionTimerRef.current = null;
          if (processingRef.current || comparisonOperationCountRef.current > 0) {
            start();
            return;
          }
          const pending = [...pendingGarbageCollectionRef.current];
          pendingGarbageCollectionRef.current.clear();
          // Each worker operation takes the workspace lock. A new run can
          // never race this scan, even if it starts just as the timer fires.
          void (async () => {
            for (const workspaceId of pending) {
              try {
                await garbageCollectWorkspaceAfterResults(workspaceId);
              } catch (error) {
                // The objects stay on disk; the next run's reclaim retries.
                reportBackgroundFailure(
                  {
                    key: "reclaim",
                    title: "Space from earlier runs could not be reclaimed.",
                    detail: `Outputs this page no longer shows are still stored in this browser (${error instanceof Error ? error.message : String(error)}). The next run retries, and “Delete all local data” in the footer removes them.`,
                  },
                  error,
                );
              }
            }
          })();
        }, 4000);
      };
      start();
    },
    [reportBackgroundFailure],
  );

  const participantPartitionFor = useCallback(
    (
      inputDigest: string | undefined,
      processingOptions: BrowserProcessingOptions,
    ): ParticipantPartitionTransport | undefined => {
      if (!requiresLiveScientificPreflight(processingOptions)) return undefined;
      const batch = rawInspectionBatchRef.current;
      if (!inputDigest || !batch) return undefined;
      const fragmentedParticipantTokens =
        fragmentedTokensByDigestRef.current.get(inputDigest);
      return fragmentedParticipantTokens?.length
        ? {
            participantPartitionBatchId: batch.participantPartitionBatchId,
            fragmentedParticipantTokens,
          }
        : undefined;
    },
    [],
  );

  const hasCurrentRawInspection = useCallback((): boolean => {
    const batch = rawInspectionBatchRef.current;
    return (
      rawInspectionReady &&
      rawInspectionSelectionIsReady(
        uploadedFiles,
        fileInspections,
        batch?.participantPartitionBatchId,
        (file) => verifiedInputDigestByFileRef.current.get(file),
      )
    );
  }, [fileInspections, rawInspectionReady, uploadedFiles]);

  const getComparisonPool = useCallback((size: number): WorkerPool | null => {
    if (size <= 0) {
      comparisonPoolRef.current?.pool.terminate();
      comparisonPoolRef.current = null;
      return null;
    }
    const current = comparisonPoolRef.current;
    if (current?.size === size && current.pool.usable) return current.pool;
    current?.pool.terminate();
    const pool = new WorkerPool(size);
    comparisonPoolRef.current = { size, pool };
    return pool;
  }, []);

  useEffect(() => disposeComparisonPool, [disposeComparisonPool]);
  useEffect(() => {
    processingRunLifecycleRef.current.mount();
    return () => {
      processingRunLifecycleRef.current.unmount();
      cancelRequestedRef.current = true;
      poolRef.current?.terminate();
      disposeProcessingPool();
    };
  }, [disposeProcessingPool]);
  useEffect(() => () => {
    if (garbageCollectionTimerRef.current !== null) {
      clearTimeout(garbageCollectionTimerRef.current);
    }
  }, []);

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
    const outcome = persistOptions(options, activeMethodProfileReceipts);
    // Say so once when settings stop being saved (and once more if they
    // start being saved again), not on every edit while storage stays full.
    if (!outcome.ok && !settingsPersistFailedRef.current) {
      settingsPersistFailedRef.current = true;
      setToast({
        message: `Your settings could not be saved in this browser (${outcome.reason}). They apply until you reload; use Export config to keep them.`,
        isError: true,
      });
    } else if (outcome.ok && settingsPersistFailedRef.current) {
      settingsPersistFailedRef.current = false;
      setToast({ message: "Settings are being saved in this browser again.", isError: false });
    }
  }, [activeMethodProfileReceipts, options]);

  // Another tab of this app saved its settings. Take over exactly what that
  // write changed and keep this tab's other options, so this tab's next save
  // (which writes all of them) carries the other tab's change instead of
  // silently reverting it. An unchanged result keeps the same object, so no
  // render, no save, and no echo back to the other tab.
  //
  // The options and the receipts of one write are applied together: a receipt
  // binds option values, and applying the options alone would let this tab's
  // own save write them back without the other tab's receipt, erasing it. A
  // write that holds a receipt waits for receipt validation to load, so writes
  // are applied one after another in the order they arrived.
  useEffect(() => {
    let applied: Promise<void> = Promise.resolve();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SETTINGS_STORAGE_KEY) return;
      const { oldValue, newValue } = event;
      const apply = () => {
        setOptionsState(
          (local) => mergeStoredSettingsChange(local, oldValue, newValue) ?? local,
        );
        // From the write itself: storage may hold this tab's own later save.
        if (newValue !== null && storedReceiptsChanged(oldValue, newValue)) {
          setActiveMethodProfileReceipts(storedSettingsReceipts(newValue));
        }
      };
      applied = applied
        .then(() => (textHoldsMethodReceipt(newValue) ? loadMethodReceiptValidation() : undefined))
        .then(apply)
        .catch((error: unknown) => {
          // This tab keeps its own settings, and the next write still applies.
          recordError("background", error, "another tab's settings could not be applied");
        });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    persistDemoDisplayEnabled(hideDemoMetadata);
  }, [hideDemoMetadata]);

  useEffect(() => {
    void refreshStoragePressure();
  }, [refreshStoragePressure]);

  // Ask once for persistent storage so projects + the cached run aren't evicted
  // under disk pressure (best-effort; ignored where unsupported/denied).
  //
  // The durability gate must NOT be sequenced behind that request. Firefox 148
  // never settles navigator.storage.persist() without a user gesture — it waits
  // on a permission prompt that headless and un-gestured sessions never answer —
  // so chaining the probe to it left the durable-workspace probe permanently
  // pending and the fail-closed banner unreachable on Firefox. Nothing reads
  // `evictionProtected`, so there is no reason to wait for the answer.
  useEffect(() => {
    void requestPersistentStorage();
    const bootProbe = probeDurableWorkspaceCapability();
    bootWorkspaceProbeRef.current = bootProbe;
    void bootProbe.then(applyWorkspaceCapability);
    void detectLegacyOpfsState()
      .then(setLegacyOpfsState)
      .catch(() => setLegacyOpfsState(null));
    void detectLegacyLastRunState().then(setLegacyLastRunState);
  }, [applyWorkspaceCapability]);

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
    if (hadPersistedOptionsAtBoot) {
      setToast({ message: "Last used settings restored.", isError: false });
    }
    // hadPersistedOptionsAtBoot is set once at first render and never changes.
  }, [hadPersistedOptionsAtBoot]);

  useEffect(() => {
    if (consumeLocalDataDeletedMark()) {
      setToast({
        message: "Deleted all of this app’s data stored in this browser.",
        isError: false,
      });
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (readSharedConfig(window.location.search)) return;
    let cancelled = false;
    const inspectionGenerationAtBoot = rawInspectionGenerationRef.current;
    void loadLastComponentManifest().then(async (manifestJson) => {
      if (!manifestJson || cancelled || componentRestoreSuperseded.current) return;
      const { reopenLiteratureComponentResult } = await import("@/lib/rustPipelineRuntime");
      const restored = await reopenLiteratureComponentResult(manifestJson);
      if (!cancelled && !componentRestoreSuperseded.current) setLiteratureComponentResult(restored);
    }).catch((error: unknown) => {
      if (!cancelled && !componentRestoreSuperseded.current) setLiteratureComponentError(`Saved component could not be reopened: ${error instanceof Error ? error.message : String(error)}`);
    });
    const savedRunNotKept = (
      reason: string,
      error: unknown,
      where: "archived" | "kept",
    ): void => {
      reportBackgroundFailure(
        {
          key: "last-run",
          title: "Your last saved run could not be reopened.",
          // An archived record sits in a slot no version of the app opens; a
          // kept one is still where the app looks, so a later load can retry.
          detail: where === "archived"
            ? `This version cannot read it (${reason}), so it was set aside in this browser instead of being deleted. Clear it to free the space.`
            : `It was left where it was instead of being deleted (${reason}). Reload to try again, or clear it to free the space.`,
          offerClearCachedRun: true,
        },
        error,
      );
    };
    void loadLastRunOutcome()
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.status === "archived" || outcome.status === "kept") {
          savedRunNotKept(outcome.reason, new Error(`saved run ${outcome.status}: ${outcome.reason}`), outcome.status);
          return;
        }
        const record = outcome.status === "restored" ? outcome.record : undefined;
        // A file picked (or a run started) while the record loaded owns the
        // results area now; the saved run must not overwrite it.
        if (
          !record ||
          rawInspectionGenerationRef.current !== inspectionGenerationAtBoot ||
          processingRef.current
        )
          return;
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
        // A cancelled or partly failed batch restores as what it was. Older
        // records (schema v1) carry no attempted count; they fall back to the
        // result count, which reads as complete exactly as before.
        const attempted = record.attemptedFileCount ?? record.results.length;
        const missing = Math.max(0, attempted - record.results.length);
        const unfinished = record.unfinishedFileNames ?? [];
        noteFileNames([...unfinished, ...record.results.map((result) => result.inputFileName)]);
        const unfinishedNote =
          unfinished.length > 0
            ? ` Missing: ${unfinished.slice(0, 3).join(", ")}${unfinished.length > 3 ? ` and ${unfinished.length - 3} more` : ""}.`
            : "";
        // Belt for records written before ephemeral runs were refused a save:
        // every output is a dead in-tab blob reference, so the restored run is
        // complete-looking and entirely undownloadable. Say so instead of
        // reporting a clean restore.
        const withoutPersistedOutputs = resultsLackPersistedOutputs(
          record.results,
        );
        setToast(
          withoutPersistedOutputs
            ? {
                message: `Last processed results restored (${record.results.length} ${record.results.length === 1 ? "file" : "files"}), but their outputs were NOT persisted and cannot be downloaded — that run was held in the tab it was produced in. Re-add the files and process again.`,
                isError: true,
              }
            : missing > 0
              ? {
                  message: `Last processed results restored — INCOMPLETE: ${record.results.length} of ${attempted} files produced results.${unfinishedNote} Re-add the files and process again to finish the batch.`,
                  isError: true,
                }
              : {
                  message: `Last processed results restored (${record.results.length} ${record.results.length === 1 ? "file" : "files"}).`,
                  isError: false,
                },
        );
      })
      .catch((error: unknown) => {
        // The record loaded but could not be shown. Nothing of it stays on
        // screen (so it cannot wedge rendering), and the saved copy is kept:
        // the notice offers the explicit "Clear cached run".
        if (cancelled) return;
        setResults([]);
        setResultsOptions(null);
        setProgressOrder([]);
        setProgressByFile({});
        savedRunNotKept(
          `its results could not be shown: ${error instanceof Error ? error.message : String(error)}`,
          error,
          "kept",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [reportBackgroundFailure]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(WORKFLOW_STORAGE_KEY, activeWorkflow);
    } catch {
      // Storage can be unavailable (private mode/full); tab state stays in memory.
    }
  }, [activeWorkflow]);

  const workflowSupportRoles = useMemo(
    () =>
      workflowExplorerSupportRoles(options, {
        filterFile: Boolean(filterFile),
        appsForcingScreenOpenFile: Boolean(appsForcingScreenOpenFile),
        backgroundAppsFile: Boolean(backgroundAppsFile),
        appCodebookFile: Boolean(appCodebookFile),
        studyDatesFile: Boolean(studyDatesFile),
        deviceSharingFile: Boolean(deviceSharingFile),
        surveyAttributionFile: Boolean(surveyAttributionFile),
        enrolledDevicesFile: Boolean(enrolledDevicesFile),
        inputCapabilityEvidenceFile: Boolean(inputCapabilityEvidenceFile),
        analysisFeatureMatrixFile: Boolean(analysisFeatureMatrixFile),
        callSmsEligibilityFile: Boolean(callSmsEligibilityFile),
        phoneStudyPsCommunicationFile: Boolean(phoneStudyPsCommunicationFile),
        phoneStudyEsFile: Boolean(phoneStudyEsFile),
        anchorEventsFile: Boolean(anchorEventsFile),
      }),
    [
      options,
      filterFile,
      appsForcingScreenOpenFile,
      backgroundAppsFile,
      appCodebookFile,
      studyDatesFile,
      deviceSharingFile,
      surveyAttributionFile,
      enrolledDevicesFile,
      inputCapabilityEvidenceFile,
      analysisFeatureMatrixFile,
      callSmsEligibilityFile,
      phoneStudyPsCommunicationFile,
      phoneStudyEsFile,
      anchorEventsFile,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    void getWorkflowExplorerView(options, workflowSupportRoles)
      .then((view) => {
        if (!cancelled) setWorkflowExplorerView(view);
      })
      .catch((viewError: unknown) => {
        if (cancelled) return;
        setError(
          viewError instanceof Error
            ? `Workflow Explorer unavailable: ${viewError.message}`
            : "Workflow Explorer unavailable.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [options, workflowSupportRoles]);

  // Reordering the queue is a permutation of the same selection, not a new
  // selection: it must not clear the results, drop the inspections, or delete
  // the persisted last run. Inspections are matched to files by name, so the
  // display order can change without re-inspecting anything.
  const onFilesReorder = (files: File[]) => {
    if (
      processingRef.current ||
      retryingFileRef.current ||
      comparisonOperationCountRef.current > 0
    )
      return;
    const isPermutation =
      files.length === uploadedFiles.length &&
      uploadedFiles.every((file) => files.includes(file));
    if (!isPermutation) {
      onFilesChange(files);
      return;
    }
    setUploadedFiles(files);
  };

  // An error toast stays until dismissed, so a refusal raised beside another
  // error (a project restore that also skipped support files) is appended
  // instead of replacing it.
  const reportRawFileRefusals = (refusals: string[]): void => {
    const message = refusals.join(" ");
    setToast((current) =>
      current?.isError && !current.message.includes(message)
        ? { message: `${current.message} ${message}`, isError: true }
        : { message, isError: true },
    );
  };

  const studySplitGenerationRef = useRef(0);
  // Picked and restored files first go through the study split; the latest
  // selection wins if an earlier split resolves after it.
  const onFilesPicked = (
    pickedFiles: File[],
    input: { restoringProject?: boolean } = {},
  ) => {
    if (
      processingRef.current ||
      retryingFileRef.current ||
      comparisonOperationCountRef.current > 0
    )
      return;
    // Refuse oversized files before the study split reads them whole. A pick
    // whose every file is refused changes nothing; a project restore has
    // already applied the project's settings, so it still replaces the queue
    // (possibly with nothing) rather than keep the previous files under them.
    noteFileNames(pickedFiles.map((file) => file.name));
    const { accepted: files, refusals } = admitRawFilesBySize(pickedFiles);
    if (refusals.length) {
      reportRawFileRefusals(refusals);
      if (!files.length && !input.restoringProject) return;
    }
    const generation = ++studySplitGenerationRef.current;
    if (activeLiteratureComponent !== null) {
      onFilesChange(files);
      return;
    }
    disposeProcessingPool();
    // The previous selection must not be processable while the split runs,
    // including when its inspection finishes during the split.
    rawInspectionGenerationRef.current += 1;
    setRawInspectionReady(false);
    setIsInspectingFiles(files.length > 0);
    void splitMixedStudyFiles(files, new Set(uploadedFiles)).then((split) => {
      if (generation === studySplitGenerationRef.current) onFilesChange(split);
    });
  };

  const onFilesChange = (
    selectedFiles: File[],
    input: { clearCachedRun?: boolean } = {},
  ) => {
    if (
      processingRef.current ||
      retryingFileRef.current ||
      comparisonOperationCountRef.current > 0
    )
      return;
    // Files can reach here without the picker (component inputs, reorder
    // fallback); same bound.
    noteFileNames(selectedFiles.map((file) => file.name));
    const { accepted: files, refusals } = admitRawFilesBySize(selectedFiles);
    if (refusals.length) reportRawFileRefusals(refusals);
    try {
      commitRawFileSelectionAtomically(files, () => {
    const inspectionGeneration = ++rawInspectionGenerationRef.current;
    disposeComparisonPool();
    disposeProcessingPool();
    const previousInspectionBatch = rawInspectionBatchRef.current;
    rawInspectionBatchRef.current = null;
    fragmentedTokensByDigestRef.current = new Map();
    setRawInspectionReady(false);
    if (previousInspectionBatch) {
      void releaseRawFileInspectionBatch(previousInspectionBatch);
    }
    const { clearCachedRun = true } = input;
    setUploadedFiles(files);
    setFileInspections([]);
    setResults([]);
    setResultsOptions(null);
    setResultsSupportFiles(null);
    setResultsExecutionBinding(null);
    componentRestoreSuperseded.current = true;
    setLiteratureComponentResult(null);
    setLiteratureComponentError(null);
    setError(null);
    setProcessExpanded(true);
    if (clearCachedRun) {
      // Clearing the cached run frees storage; re-check pressure so a stale
      // high-usage banner doesn't linger (consistent with the post-run refresh).
      void clearLastRun()
        .catch((clearError: unknown) => {
          setToast({
            message: `The previous run's saved copy could not be removed (${
              clearError instanceof Error ? clearError.message : String(clearError)
            }) and may reopen after a reload.`,
            isError: true,
          });
        })
        .finally(() => void refreshStoragePressure());
    }
    if (!files.length) {
      setIsInspectingFiles(false);
      return;
    }
    if (activeLiteratureComponent?.tableFormat === "arrow-ipc-file") {
      setIsInspectingFiles(false);
      return;
    }
    setIsInspectingFiles(true);
    void createRawFileInspectionBatch()
      .then(async (batch) => {
        if (rawInspectionGenerationRef.current !== inspectionGeneration) {
          await releaseRawFileInspectionBatch(batch);
          return null;
        }
        rawInspectionBatchRef.current = batch;
        try {
          const inspections = await inspectRawFiles(files, batch);
          if (
            rawInspectionGenerationRef.current !== inspectionGeneration ||
            rawInspectionBatchRef.current !== batch
          ) {
            await releaseRawFileInspectionBatch(batch);
            return null;
          }
          fragmentedTokensByDigestRef.current =
            fragmentedParticipantTokensByInputDigest(
              inspections,
              batch.participantPartitionBatchId,
            );
          return inspections;
        } catch (error) {
          if (rawInspectionBatchRef.current === batch) {
            rawInspectionBatchRef.current = null;
          }
          await releaseRawFileInspectionBatch(batch);
          throw error;
        }
      })
      .then((inspections) => {
        if (
          !inspections ||
          rawInspectionGenerationRef.current !== inspectionGeneration
        )
          return;
        inspections.forEach((inspection, index) => {
          const file = files[index];
          const digest = inspection.inputSha256;
          if (file && digest !== undefined && /^[0-9a-f]{64}$/.test(digest)) {
            verifiedInputDigestByFileRef.current.set(file, digest);
          }
        });
        setFileInspections(inspections);
        setRawInspectionReady(true);
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
        if (rawInspectionGenerationRef.current !== inspectionGeneration) return;
        setRawInspectionReady(false);
        setToast({
          message:
            inspectionError instanceof Error
              ? inspectionError.message
              : "Could not inspect selected files.",
          isError: true,
        });
      })
      .finally(() => {
        if (rawInspectionGenerationRef.current === inspectionGeneration) {
          setIsInspectingFiles(false);
        }
      });
      });
    } catch (selectionError) {
      const message =
        selectionError instanceof Error
          ? selectionError.message
          : "Selected raw files are not uniquely identifiable.";
      setError(message);
      setToast({ message, isError: true });
      setActiveWorkflow("files");
    }
  };

  useEffect(
    () => () => {
      rawInspectionGenerationRef.current += 1;
      const batch = rawInspectionBatchRef.current;
      rawInspectionBatchRef.current = null;
      fragmentedTokensByDigestRef.current = new Map();
      if (batch) void releaseRawFileInspectionBatch(batch);
    },
    [],
  );

  const applyProject = (record: ProjectRecord): void => {
    const restoredRawFiles = record.includesFiles
      ? record.rawFiles.map(storedFileToFile)
      : [];
    assertUniqueRawFileNames(restoredRawFiles);
    applyProjectAtomically(
      {
        processing: processingRef.current,
        retrying: retryingFileRef.current !== null,
        comparing: comparisonOperationCountRef.current > 0,
      },
      () => {
        // Sanitize the stored options (merges over defaults + validates restored
        // values, e.g. drops non-canonical interaction-remap targets) so a project
        // saved against an older schema or hand-edited record still loads safely.
        setOptions(sanitizeOptions(record.options));
        setActiveMethodProfileReceipts((current) => ({
          ...current,
          android: record.methodProfileReceipt ?? undefined,
        }));
        // A project restore replaces the FULL file state so it can't be left
        // inconsistent with the restored option flags (e.g. useFilterFile=true but a
        // stale/other filter still loaded). `supportFiles` is empty for a config-only
        // project, so every slot clears; bundled projects rehydrate their blobs.
        const support = record.supportFiles;
        // G4: a project saved before the picker refused `.xls` can carry one.
        // Dropping it straight into state bypasses pick-time validation, so the
        // slot restores green and the batch dies at run time. Validate with the
        // same rule the picker uses, drop what the runtime cannot read, and say
        // which file and why.
        const rejectedSupportFiles: string[] = [];
        const restoredSupportFile = (
          stored: Parameters<typeof storedFileToFile>[0] | undefined,
          accept: string,
        ): File | null =>
          restoreStoredSupportFile(stored, accept, storedFileToFile, (message) =>
            rejectedSupportFiles.push(message),
          );
        setFilterFile(
          restoredSupportFile(support.filterFile, SUPPORT_FILE_ACCEPT),
        );
        setAppsForcingScreenOpenFile(
          restoredSupportFile(support.appsForcingScreenOpenFile, SUPPORT_FILE_ACCEPT),
        );
        setBackgroundAppsFile(
          restoredSupportFile(support.backgroundAppsFile, SUPPORT_FILE_ACCEPT),
        );
        setAppCodebookFile(
          restoredSupportFile(support.appCodebookFile, SUPPORT_FILE_ACCEPT),
        );
        setStudyDatesFile(
          restoredSupportFile(support.studyDatesFile, SUPPORT_FILE_ACCEPT),
        );
        setDeviceSharingFile(
          restoredSupportFile(support.deviceSharingFile, SUPPORT_FILE_ACCEPT),
        );
        setSurveyAttributionFile(
          restoredSupportFile(support.surveyAttributionFile, SUPPORT_FILE_ACCEPT),
        );
        setEnrolledDevicesFile(
          restoredSupportFile(support.enrolledDevicesFile, SUPPORT_FILE_ACCEPT),
        );
        setInputCapabilityEvidenceFile(
          restoredSupportFile(support.inputCapabilityEvidenceFile, ".csv"),
        );
        setAnalysisFeatureMatrixFile(
          restoredSupportFile(support.analysisFeatureMatrixFile, SUPPORT_FILE_ACCEPT),
        );
        setCallSmsEligibilityFile(
          restoredSupportFile(support.callSmsEligibilityFile, SUPPORT_FILE_ACCEPT),
        );
        setPhoneStudyPsCommunicationFile(
          restoredSupportFile(
            support.phoneStudyPsCommunicationFile,
            ".csv",
          ),
        );
        setPhoneStudyEsFile(
          restoredSupportFile(support.phoneStudyEsFile, ".csv"),
        );
        setAnchorEventsFile(
          restoredSupportFile(support.anchorEventsFile, ".csv"),
        );
        if (rejectedSupportFiles.length) {
          setToast({
            message: `Project loaded, but ${rejectedSupportFiles.length} support ${rejectedSupportFiles.length === 1 ? "file was" : "files were"} not restored — ${rejectedSupportFiles.join("; ")}`,
            isError: true,
          });
        }
        // Reuse the upload path so restored files are inspected like fresh uploads;
        // a config-only project clears the raw files to a clean slate.
        onFilesPicked(restoredRawFiles, { restoringProject: true });
      },
    );
  };

  const buildSupportFilesForOptions = async (
    forOptions: BrowserProcessingOptions,
    methodSettingIds =
      activeMethodProfileReceipts.android &&
      JSON.stringify(options) === JSON.stringify(forOptions)
        ? activeMethodProfileReceipts.android.settingIds
        : [],
    requiredComponentSupportRoles: readonly string[] = [],
  ): Promise<BrowserSupportFiles> => {
    const receiptUses = methodReceiptInputUses(methodSettingIds);
    return ({
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
    ...((forOptions.enableStudyWindowFilter || forOptions.enableDayCoverage ||
      requiredComponentSupportRoles.includes("study_dates_file")) &&
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
    ...((usesInputCapabilityEvidence(forOptions)
      || receiptUses.inputCapabilityEvidence) && inputCapabilityEvidenceFile
      ? {
          inputCapabilityEvidenceFile: await readSupportFile(
            inputCapabilityEvidenceFile,
          ),
        }
      : {}),
    ...(receiptUses.analysisFeatureMatrix
      && analysisFeatureMatrixFile
      ? {
          analysisFeatureMatrixFile: await readSupportFile(
            analysisFeatureMatrixFile,
          ),
        }
      : {}),
    ...(receiptUses.callSmsEligibility
      && callSmsEligibilityFile
      ? {
          callSmsEligibilityFile: await readSupportFile(
            callSmsEligibilityFile,
          ),
        }
      : {}),
    ...(receiptUses.phoneStudyPsCommunication
      && phoneStudyPsCommunicationFile
      ? {
          phoneStudyPsCommunicationFile: await readSupportFile(
            phoneStudyPsCommunicationFile,
          ),
        }
      : {}),
    ...(receiptUses.phoneStudyEs
      && phoneStudyEsFile
      ? { phoneStudyEsFile: await readSupportFile(phoneStudyEsFile) }
      : {}),
    ...(receiptUses.anchorEvents
      && anchorEventsFile
      ? { anchorEventsFile: await readSupportFile(anchorEventsFile) }
      : {}),
    });
  };

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
    // Timezone discovery is not a run and does not re-probe, but it must not
    // read the optimistic initial value of `durableWorkspaceRef` before the
    // boot probe has answered — that made the first interaction in an
    // OPFS-denied browser nondeterministic.
    const durable = await ensureDurableWorkspaceKnown();
    for (const file of files) {
      const timezones = await discoverTimezonesBytes(
        await file.arrayBuffer(),
        getInjectedRuntime(durable, runtimeTogglesRef.current),
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
      const inspectionGeneration = rawInspectionGenerationRef.current;
      comparisonOperationCountRef.current += 1;
      setIsComparing(true);
      try {
        const file = uploadedFiles.find(
          (candidate) => candidate.name === fileName,
        );
        if (!file) {
          throw new Error(
            "The raw file for this run is no longer loaded. Re-add it in the Files tab to compare.",
          );
        }
        if (
          requiresLiveScientificPreflight(reviewOptions) &&
          !hasCurrentRawInspection()
        ) {
          throw new Error(
            "Scientific processing requires a complete current raw-file inspection; re-select and re-inspect the files.",
          );
        }
        // A comparison is a run: re-probe before resolving a runtime, exactly
        // as the Process button and Retry do. Reading `durableWorkspaceRef`
        // straight was both stale (storage can be lost mid-session) and racy
        // (the boot probe may not have settled on the first interaction).
        const comparisonCapability = await reprobeWorkspaceCapability();
        if (workspaceRefusesRun(comparisonCapability)) {
          throw new Error(
            `Durable local workspace unavailable. ${transientWorkspaceRefusalNotice(
              comparisonCapability.status === "unavailable"
                ? comparisonCapability.reason
                : "",
            )}`,
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
        const participantPartition = participantPartitionFor(
          verifiedInputSha256,
          reviewOptions,
        );
        const inspectionBatch = rawInspectionBatchRef.current ?? undefined;
        if (participantPartition && !inspectionBatch) {
          throw new Error(
            "Participant partition metadata expired; re-select and re-inspect the raw files.",
          );
        }
        if (verifiedInputSha256) {
          const supportCacheKey =
            await comparisonSupportCacheKey(resolvedSupportFiles);
          const warmPool = getWarmProcessingPool();
          const result = await (warmPool
            ? processPersistedOrRawChangedReviewViaPool(
                warmPool,
                file.name,
                file.size,
                () => file.arrayBuffer(),
                reviewOptions,
                resolvedSupportFiles,
                getInjectedRuntime(
                  durableWorkspaceRef.current,
                  runtimeTogglesRef.current,
                ),
                verifiedInputSha256,
                supportCacheKey,
                participantPartition,
                inspectionBatch,
              )
            : processPersistedOrRawChangedReview(
                file.name,
                file.size,
                () => file.arrayBuffer(),
                reviewOptions,
                resolvedSupportFiles,
                getInjectedRuntime(
                  durableWorkspaceRef.current,
                  runtimeTogglesRef.current,
                ),
                verifiedInputSha256,
                supportCacheKey,
                participantPartition,
                inspectionBatch,
              ));
          if (rawInspectionGenerationRef.current !== inspectionGeneration) {
            throw new Error("Raw-file selection changed during comparison.");
          }
          return result;
        }
        const result = await processRawCsvReviewBytes(
          file.name,
          await file.arrayBuffer(),
          reviewOptions,
          resolvedSupportFiles,
          getInjectedRuntime(
            durableWorkspaceRef.current,
            runtimeTogglesRef.current,
          ),
          verifiedInputSha256,
          participantPartition,
          inspectionBatch,
        );
        if (rawInspectionGenerationRef.current !== inspectionGeneration) {
          throw new Error("Raw-file selection changed during comparison.");
        }
        return result;
      } finally {
        comparisonOperationCountRef.current -= 1;
        if (comparisonOperationCountRef.current === 0) setIsComparing(false);
      }
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
      inputCapabilityEvidenceFile,
      analysisFeatureMatrixFile,
      callSmsEligibilityFile,
      phoneStudyPsCommunicationFile,
      phoneStudyEsFile,
      anchorEventsFile,
      participantPartitionFor,
      hasCurrentRawInspection,
      getWarmProcessingPool,
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
          inputCapabilityEvidenceFile,
          analysisFeatureMatrixFile,
          callSmsEligibilityFile,
          phoneStudyPsCommunicationFile,
          phoneStudyEsFile,
          anchorEventsFile,
        }).map(exactFileIdentity),
        options: requestedOptions,
      });
      if (comparisonWarmupRef.current?.key === key) {
        return comparisonWarmupRef.current.promise;
      }
      const inspectionGeneration = rawInspectionGenerationRef.current;
      comparisonOperationCountRef.current += 1;
      setIsComparing(true);
      const uniqueResultDigests = new Set(
        results
          .map((result) => result.inputSha256)
          .filter((digest): digest is string => !!digest),
      ).size;
      const backgroundWorkerCount = computeSafeComparisonPoolSize({
        uniqueFileCount: Math.max(0, uniqueResultDigests - 1),
        hardCap: COMPARISON_WORKER_LIMIT - 1,
        deviceMemory: readDeviceMemory(),
      });
      if (!getWarmProcessingPool()) getComparisonPool(backgroundWorkerCount);
      const supportInputs = supportFileInputList<File | null>({
        filterFile,
        appsForcingScreenOpenFile,
        backgroundAppsFile,
        appCodebookFile,
        studyDatesFile,
        deviceSharingFile,
        surveyAttributionFile,
        enrolledDevicesFile,
        inputCapabilityEvidenceFile,
        analysisFeatureMatrixFile,
        callSmsEligibilityFile,
        phoneStudyPsCommunicationFile,
        phoneStudyEsFile,
        anchorEventsFile,
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
        .then(({ options, supportFiles }) => {
          if (
            rawInspectionGenerationRef.current !== inspectionGeneration ||
            !uploadedFiles.includes(file)
          ) {
            throw new Error(
              "Raw-file selection changed during comparison setup.",
            );
          }
          return executeComparisonReview(fileName, options, supportFiles);
        })
        .catch((error) => {
          if (comparisonWarmupRef.current?.promise === promise) {
            comparisonWarmupRef.current = null;
          }
          throw error;
        })
        .finally(() => {
          comparisonOperationCountRef.current -= 1;
          if (comparisonOperationCountRef.current === 0) setIsComparing(false);
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
      getWarmProcessingPool,
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
      inputCapabilityEvidenceFile,
      analysisFeatureMatrixFile,
      callSmsEligibilityFile,
      phoneStudyPsCommunicationFile,
      phoneStudyEsFile,
      anchorEventsFile,
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
      const inspectionGeneration = rawInspectionGenerationRef.current;
      comparisonOperationCountRef.current += 1;
      setIsComparing(true);
      try {
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
        // Arm B dispatches a real kernel run, so it gets the same bounds gate
        // the Process button and the pre-dispatch check have. The drawer's Run
        // button already refuses, but a share link, a preset, or a restored
        // project can carry an out-of-range value into these overrides without
        // the button ever being the path in — and `sanitizeOptions` rounds, it
        // does not bound, so 0 or 500 would reach the kernel verbatim.
        const armBViolations = collectOptionRangeViolations(requestedArmB);
        if (armBViolations.length) {
          throw new Error(
            `Cannot run the comparison: ${armBViolations
              .map(
                (violation) =>
                  `${BROWSER_OPTION_TOOLTIPS[violation.key].title} (${violation.message.toLowerCase()})`,
              )
              .join("; ")}.`,
          );
        }
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
          inputCapabilityEvidenceFile,
          analysisFeatureMatrixFile,
          callSmsEligibilityFile,
          phoneStudyPsCommunicationFile,
          phoneStudyEsFile,
          anchorEventsFile,
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
        const failures: ComparisonFailure[] = [];
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
        const backgroundWorkerCount = computeSafeComparisonPoolSize({
          uniqueFileCount: schedule.length,
          hardCap: COMPARISON_WORKER_LIMIT - 1,
          deviceMemory: readDeviceMemory(),
        });
        const pool = getWarmProcessingPool() ?? getComparisonPool(backgroundWorkerCount);
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
              const participantPartition = participantPartitionFor(
                verifiedInputSha256,
                armBOptions,
              );
              const inspectionBatch =
                rawInspectionBatchRef.current ?? undefined;
              const result = verifiedInputSha256
                ? await processPersistedOrRawChangedReviewViaPool(
                    requireDefined(
                      pool,
                      "a background comparison runner starts only when the comparison pool has workers",
                    ),
                    item.file.name,
                    item.file.size,
                    () => item.file.arrayBuffer(),
                    armBOptions,
                    changedSupportFiles,
                    getInjectedRuntime(
                      durableWorkspaceRef.current,
                      runtimeTogglesRef.current,
                    ),
                    verifiedInputSha256,
                    changedSupportCacheKey,
                    participantPartition,
                    inspectionBatch,
                  )
                : await processRawCsvChangedReviewBytesViaPool(
                    requireDefined(
                      pool,
                      "a background comparison runner starts only when the comparison pool has workers",
                    ),
                    item.file.name,
                    await item.file.arrayBuffer(),
                    armBOptions,
                    changedSupportFiles,
                    getInjectedRuntime(
                      durableWorkspaceRef.current,
                      runtimeTogglesRef.current,
                    ),
                    verifiedInputSha256,
                    participantPartition,
                    inspectionBatch,
                  );
              recordGroup(group, result);
            } catch (error) {
              failures.push(
                comparisonFailure(
                  group.members.map(({ file }) => file.name),
                  error,
                ),
              );
            }
          }
        };
        const activeTask = (async (): Promise<void> => {
          try {
            const result = await prepareComparison(
              priorityFileName,
              armBOptions,
            );
            recordGroup(activeGroup, result);
          } catch (error) {
            failures.push(
              comparisonFailure(
                activeGroup.members.map(({ file }) => file.name),
                error,
              ),
            );
          }
        })();
        await Promise.all([
          activeTask,
          ...Array.from({ length: backgroundWorkerCount }, () => runner()),
        ]);
        const successful = completed.filter(
          (result): result is ProcessedFileResult => !!result,
        );
        if (failures.length) {
          const firstFailureNames =
            failures[0]?.fileNames.map((name) => demoDisplay.fileName(name)) ??
            [];
          setToast({
            message: `Compared ${successful.length}/${files.length} files. ${firstFailureNames.join(", ")}: ${demoDisplay.text(
              failures[0]?.message ?? "Comparison failed.",
              failures[0]?.fileNames,
            )}`,
            isError: true,
          });
        }
        if (failures.length) {
          // Keep every per-digest decision, including the all-refused case.
          // The aggregate exposes the first typed receipt for legacy callers
          // while ViewPanel renders the complete exact failure vector.
          throw new PartialComparisonFailureError(failures, successful);
        }
        if (!successful.length) throw new Error("No files could be compared.");
        if (rawInspectionGenerationRef.current !== inspectionGeneration) {
          throw new Error("Raw-file selection changed during comparison.");
        }
        return successful;
      } finally {
        comparisonOperationCountRef.current -= 1;
        if (comparisonOperationCountRef.current === 0) setIsComparing(false);
      }
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
      inputCapabilityEvidenceFile,
      analysisFeatureMatrixFile,
      callSmsEligibilityFile,
      phoneStudyPsCommunicationFile,
      phoneStudyEsFile,
      anchorEventsFile,
      executeComparisonReview,
      getComparisonPool,
      getWarmProcessingPool,
      prepareComparison,
      participantPartitionFor,
      demoDisplay,
    ],
  );

  const discoverAvailableTimezones = async () => {
    if (!uploadedFiles.length) {
      setError("Choose one or more raw Chronicle CSV files first.");
      return;
    }
    setError(null);
    const discovered = new Set<string>();
    const durable = await ensureDurableWorkspaceKnown();
    for (const file of uploadedFiles) {
      const timezones = await discoverTimezonesBytes(
        await file.arrayBuffer(),
        getInjectedRuntime(durable, runtimeTogglesRef.current),
      );
      timezones.forEach((timezone) => discovered.add(timezone));
    }
    const next = Array.from(discovered).sort((left, right) =>
      left.localeCompare(right),
    );
    setDiscoveredTimezones(next);
    if (next.length === 1) {
      // Read the zone at commit time: one chosen while discovery ran wins.
      setOptions((current) =>
        current.selectedTimezone
          ? current
          : { ...current, selectedTimezone: next[0] },
      );
    }
  };

  const runLiteratureComponent = async (
    registration: RegisteredLiteratureComponentExecution,
  ): Promise<void> => {
    if (
      processingRef.current ||
      retryingFileRef.current ||
      comparisonOperationCountRef.current > 0
    )
      return;
    componentRestoreSuperseded.current = true;
    setActiveLiteratureComponent(registration);
    const sourceFile = uploadedFiles.length === 1 ? uploadedFiles[0] : undefined;
    if (sourceFile === undefined) {
      const message =
        `Choose exactly one ${registration.tableFormat === "arrow-ipc-file" ? "typed Arrow analysis table" : "source activity CSV"} for this literature component.`;
      setLiteratureComponentError(message);
      setToast({ message, isError: true });
      setActiveWorkflow("files");
      return;
    }
    processingRef.current = true;
    setIsLiteratureComponentRunning(true);
    setLiteratureComponentResult(null);
    setLiteratureComponentError(null);
    setToast(null);
    try {
      const capability = await reprobeWorkspaceCapability();
      if (workspaceRefusesRun(capability)) {
        throw new Error(
          `Durable local workspace unavailable. ${transientWorkspaceRefusalNotice(
            capability.status === "unavailable" ? capability.reason : "",
          )}`,
        );
      }
      const result = await executeLiteratureComponentBytes(
        registration,
        sourceFile.name,
        await sourceFile.arrayBuffer(),
        await buildSupportFilesForOptions(options, registration.methodSettingIds, registration.requiredSupportRoles),
        durableWorkspaceRef.current,
        verifiedInputDigestByFileRef.current.get(sourceFile),
      );
      setLiteratureComponentResult(result);
      if (result.persistedWorkspace) {
        try { await saveLastComponentManifest(result.manifestJson); }
        catch (error) { throw new Error(`Component executed and artifacts remain saved, but its reopen pointer could not be saved: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
      }
      setActiveWorkflow("process");
      setToast({
        message: `Executed ${registration.componentId}; the parent paper profile remains blocked.`,
        isError: false,
      });
    } catch (componentError) {
      const message =
        componentError instanceof Error
          ? componentError.message
          : String(componentError);
      setLiteratureComponentError(message);
      setActiveWorkflow("process");
      setToast({ message, isError: true });
    } finally {
      processingRef.current = false;
      setIsLiteratureComponentRunning(false);
    }
  };

  const selectLiteratureComponent = useCallback(
    (registration: RegisteredLiteratureComponentExecution | null): void => {
      setActiveLiteratureComponent(registration);
      setLiteratureComponentError(null);
    },
    [],
  );

  const handleProgressEvent = useCallback((event: ProgressEvent) => {
    setProgressByFile((current) => applyProgressEvent(current, event));
  }, []);

  const processUploadedFiles = async () => {
    // Synchronous re-entrancy guard: a single-file retry in flight, or a run
    // already underway (double-click / synthetic event before the disabled
    // attribute re-renders), must not start another run over the shared state.
    if (
      processingRef.current ||
      retryingFileRef.current ||
      comparisonOperationCountRef.current > 0
    )
      return;
    const runToken = processingRunLifecycleRef.current.token();
    if (!uploadedFiles.length) {
      setError("Choose one or more Chronicle raw CSV files first.");
      setActiveWorkflow("files");
      return;
    }
    // The Process button is already disabled on these, but a share link, an
    // imported preset, or a restored save can carry an out-of-range value into
    // state without the button ever being the path in. Refuse here too: the
    // kernel has no floor for most of these, so the run would otherwise
    // succeed with a scientifically wrong setting.
    const rangeViolations = collectOptionRangeViolations(options);
    if (rangeViolations.length) {
      setError(
        `Cannot process: ${rangeViolations
          .map(
            (violation) =>
              `${BROWSER_OPTION_TOOLTIPS[violation.key].title} (${violation.message.toLowerCase()})`,
          )
          .join("; ")}.`,
      );
      setActiveWorkflow("settings");
      return;
    }
    // Rust's inspection already decided this file is missing a column its row
    // reader resolves by name; the reader substitutes an empty string rather
    // than failing, so the run would complete and report success over blank
    // packages, labels, interaction types, or timestamps. The Process button
    // refuses this too, but a keyboard shortcut, a restored selection, or a
    // synthetic event must not be a path around it.
    const rawColumnViolations = collectRawColumnViolations(fileInspections);
    if (rawColumnViolations.length) {
      // Masked like the Process-panel block: a blocking message must not be the
      // one place a real filename leaks in demo mode.
      setError(
        rawColumnViolationMessage(
          maskRawColumnViolations(rawColumnViolations, demoDisplay.fileName),
        ),
      );
      setActiveWorkflow("files");
      return;
    }
    processingRef.current = true;
    let runOptions: BrowserProcessingOptions;
    try {
      runOptions = await resolveRunOptions(options, uploadedFiles);
      if (runOptions !== options) setOptions(runOptions);
      if (
        requiresLiveScientificPreflight(runOptions) &&
        !hasCurrentRawInspection()
      ) {
        throw new Error(
          "Scientific processing requires a complete current raw-file inspection; re-select and re-inspect the files.",
        );
      }
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
    // A structurally unsupported context degrades the run to the runtime's
    // non-persisted branch; the banner above the workflow states what that
    // costs. Anything else — an exhausted quota, a worker that restarted, an
    // unexplained rejection — may well succeed on the next attempt, so the run
    // is refused with retry guidance rather than downgraded into a batch that
    // vanishes on reload.
    const capability = await reprobeWorkspaceCapability();
    if (workspaceRefusesRun(capability)) {
      setError(
        `Durable local workspace unavailable. ${transientWorkspaceRefusalNotice(
          capability.status === "unavailable" ? capability.reason : "",
        )}`,
      );
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
    let runHadFailure = false;
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
      const payloadBudgetBytes = workerPayloadBudgetBytes(laneCap);
      // Resolve bundled-default support files once on the main thread so
      // every worker uses identical bytes (no per-worker fetches), and so
      // the user's uploads win over defaults.
      const supportFiles = await resolveDefaultSupportFiles(
        runOptions,
        userSupportFiles,
      );
      if (!processingRunLifecycleRef.current.isCurrent(runToken)) return;
      const injectedRuntime = getInjectedRuntime(
        durableWorkspaceRef.current,
        runtimeTogglesRef.current,
      );
      const warmPool = warmProcessingPoolRef.current;
      const canReuseWarmPool =
        injectedRuntime?.incrementalEngine === true &&
        warmPool?.size === laneCap &&
        warmPool.payloadBudgetBytes === payloadBudgetBytes &&
        warmPool.pool.usable;
      // One batch gets one preprocessing timestamp. This removes filename- and
      // worker-scheduling-dependent output differences and makes exact-content
      // reuse correct and reproducible.
      const methodProfileReceipts = [
        ...(activeMethodProfileReceipts.android && JSON.stringify(options) === JSON.stringify(runOptions)
          ? [activeMethodProfileReceipts.android]
          : []),
        ...(activeMethodProfileReceipts.sleepDiary ? [activeMethodProfileReceipts.sleepDiary] : []),
      ];
      // Every Process click gets its own clock.
      const runDatetimeOfPreprocessing =
        injectedRuntime?.datetimeOfPreprocessing ??
        `${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`;
      const runRuntime: BrowserProcessingRuntime = {
        ...injectedRuntime,
        ...(methodProfileReceipts.length
          ? { methodProfileReceipts }
          : {}),
        datetimeOfPreprocessing: runDatetimeOfPreprocessing,
      };
      // A failed/refused batch still owns an exact scientific binding. Retry
      // must reproduce this attempt rather than resolving whatever live
      // settings/default supports happen to exist after the failure.
      // `resultsOptions` moves with `results` below: the previous results stay
      // downloadable during the run and must keep describing their own run.
      setResultsExecutionBinding({
        options: runOptions,
        supportFiles,
        runtime: runRuntime,
      });
      const completedByInputDigest = new Map<
        string,
        Promise<ProcessedFileResult>
      >();
      const inspectionBatch = rawInspectionBatchRef.current;
      if (
        requiresLiveScientificPreflight(runOptions) &&
        fragmentedTokensByDigestRef.current.size > 0 &&
        !inspectionBatch
      ) {
        throw new Error(
          "Participant partition metadata expired; re-select and re-inspect the raw files.",
        );
      }
      // The incremental engine's Salsa memo belongs to its worker. Keep the
      // bounded pool for this exact file selection across Process and review.
      if (
        warmPool &&
        !canReuseWarmPool
      ) {
        disposeProcessingPool();
      }
      const runPool =
        runRuntime.incrementalEngine === true
          ? (warmProcessingPoolRef.current?.pool ??
            new WorkerPool(laneCap, {
              onFault: disposeProcessingPool,
              payloadBudgetBytes,
            }))
          : new WorkerPool(laneCap, { payloadBudgetBytes });
      if (runRuntime.incrementalEngine === true) {
        runPool.setRetainedMemoryBudget(readDeviceMemory());
      }
      setEffectiveProcessingConcurrency(Math.min(concurrency, runPool.size));
      if (runRuntime.incrementalEngine === true) {
        if (!processingRunLifecycleRef.current.retain(runToken, runPool, () => {
          warmProcessingPoolRef.current = {
            size: laneCap,
            pool: runPool,
            payloadBudgetBytes,
          };
        })) return;
      }
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
                  assertRawFileWithinLimit(file);
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
                    participantPartitionFor(verifiedInputSha256, runOptions),
                    inspectionBatch ?? undefined,
                  );
                })();
                completedByInputDigest.set(verifiedInputSha256, computation);
              } else {
                assertRawFileWithinLimit(file);
                const bytes = await file.arrayBuffer();
                computation = processRawCsvBytesViaPool(
                  runPool,
                  file.name,
                  bytes,
                  runOptions,
                  supportFiles,
                  runRuntime,
                  handleProgressEvent,
                  undefined,
                  undefined,
                  undefined,
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
            runHadFailure = true;
            const message = processingErrorText(fileError);
            failures.push(message);
            handleProgressEvent({
              type: "file-complete",
              fileName: file.name,
              error: message,
              scientificPreflightRefusal:
                scientificPreflightReceiptFromError(fileError),
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
      let laneTarget = Math.min(concurrency, runPool.size);
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
        if (
          !observedWasmBytes ||
          observedWasmBytes <= maxObservedWorkerWasmBytes
        )
          return;
        maxObservedWorkerWasmBytes = observedWasmBytes;
        const next = computeAdaptiveLaneTarget({
          laneCap: Math.min(laneCap, runPool.size),
          observedWorkerHighWaterBytes: maxObservedWorkerWasmBytes,
          deviceMemory: readDeviceMemory(),
          fallbackLanes: laneTarget,
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
      setResultsOptions(runOptions);
      setResultsSupportFiles(supportFileSlots);
      setResults(successful);
      const committedWorkspaceIds = successful.flatMap((result) => {
        const receipt = result.rustRuntimeReceipt;
        return receipt?.persistedGeneration === undefined
          ? []
          : [receipt.workspaceId];
      });
      scheduleGarbageCollection(
        [...new Set(committedWorkspaceIds)],
      );

      // If the processing pool could not be kept, pre-warm a bounded review
      // pool for multi-file comparisons. Sequential reviews have no Salsa
      // state to warm.
      const warmRuntime = getInjectedRuntime(
        durableWorkspaceRef.current,
        runtimeTogglesRef.current,
      );
      if (
        successful.length > 1 &&
        !cancelRequestedRef.current &&
        warmRuntime?.incrementalEngine === true &&
        warmProcessingPoolRef.current === null
      ) {
        const uniqueDigests = new Map<
          string,
          { file: File; sizeBytes: number }
        >();
        for (const file of uploadedFiles) {
          const digest = verifiedInputDigestByFileRef.current.get(file);
          if (digest && !uniqueDigests.has(digest)) {
            uniqueDigests.set(digest, { file, sizeBytes: file.size });
          }
        }
        if (uniqueDigests.size > 0) {
          const poolSize = computeSafeComparisonPoolSize({
            uniqueFileCount: uniqueDigests.size,
            hardCap: COMPARISON_WORKER_LIMIT - 1,
            deviceMemory: readDeviceMemory(),
          });
          void (async () => {
            try {
              const warmPool = getComparisonPool(poolSize);
              if (!warmPool) return;
              const capacityPerWorker = Math.ceil(
                uniqueDigests.size / poolSize,
              );
              await warmPool.setComparisonCacheCapacity(capacityPerWorker);
              const warmSupportCacheKey =
                await comparisonSupportCacheKey(supportFiles);
              const entries = Array.from(uniqueDigests.entries());
              await Promise.all(
                entries.map(([digest, { file, sizeBytes }]) =>
                  processPersistedOrRawChangedReviewViaPool(
                    warmPool,
                    file.name,
                    sizeBytes,
                    () => file.arrayBuffer(),
                    runOptions,
                    supportFiles,
                    warmRuntime,
                    digest,
                    warmSupportCacheKey,
                    participantPartitionFor(digest, runOptions),
                    inspectionBatch ?? undefined,
                    // A failed pre-warm only loses the head start: the run
                    // itself computes this file and reports any real failure.
                  ).catch(() => {}),
                ),
              );
            } catch {
              // Pre-warm is best-effort; never surface to the user.
            }
          })();
        }
      }

      const nextTimezones = Array.from(
        new Set(successful.flatMap((result) => result.availableTimezones)),
      ).sort((left, right) => left.localeCompare(right));
      // Don't overwrite discovered timezones with an empty set when a run produced
      // no results (fully cancelled / all failed) — that would blank the timezone
      // picker the user populated via file inspection or a prior run.
      if (successful.length) {
        setDiscoveredTimezones(nextTimezones);
      }
      // An ephemeral run has no persisted outputs: its blobs die with the tab,
      // so a stored record would restore as a complete-looking run whose every
      // download is dead. Keep the previous durable record instead of writing a
      // hollow one over it.
      // The completion toast below is set unconditionally a few lines later, so
      // a toast raised HERE would be overwritten within the same tick and the
      // user would never see it (measured in the ephemeral e2e run). Carry the
      // warning into that toast instead.
      let ephemeralResultsUnsaved = false;
      // The completion toast reports the outcome of this write, so it is
      // awaited: a run whose record was not stored must not read as saved.
      let lastRunWriteFailure: string | null = null;
      if (successful.length && !durableWorkspaceRef.current) {
        ephemeralResultsUnsaved = true;
      } else if (successful.length) {
        lastRunWriteFailure = await saveLastRun({
          options: runOptions,
          results: successful,
          discoveredTimezones: nextTimezones,
          // Record what the batch set out to do. A cancelled or partly failed
          // run must not restore as a clean one: after a reload the raw files
          // are gone, so the in-session shortfall check has nothing to compare
          // against and every restored row would read as complete.
          attemptedFileCount: uploadedFiles.length,
          unfinishedFileNames: uploadedFiles
            .map((file) => file.name)
            .filter(
              (name) =>
                !successful.some((result) => result.inputFileName === name),
            ),
        })
          .then(
            () => null,
            // saveLastRun already self-clears a failed (e.g. quota) write; the
            // toast below says the run will not reopen after a reload, and the
            // pressure refresh shows the user what to free.
            (saveError: unknown) =>
              `the results were not saved for reload (${
                saveError instanceof Error ? saveError.message : String(saveError)
              }). Download them before closing or reloading.`,
          )
          .finally(() => {
            void refreshStoragePressure();
          });
      } else {
        lastRunWriteFailure = await clearLastRun().then(
          () => null,
          (clearError: unknown) =>
            `the previous run's saved copy could not be removed (${
            clearError instanceof Error ? clearError.message : String(clearError)
          }) and may reopen after a reload.`,
        );
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
      const ephemeralNote = ephemeralResultsUnsaved
        ? " — results are ready in this tab but were not saved for reload: durable local storage is unavailable. Download them before closing or reloading."
        : lastRunWriteFailure
          ? ` — ${lastRunWriteFailure}`
          : "";
      setToast({
        message: `${message}${ephemeralNote}`,
        isError:
          (failures.length > 0 && !cancelled) ||
          ephemeralResultsUnsaved ||
          lastRunWriteFailure !== null,
      });

      if (!cancelled && typeof document !== "undefined" && document.hidden) {
        sendNotification(
          failures.length
            ? "Chronicle: some files failed"
            : "Chronicle: processing complete",
          `${message}${ephemeralNote}`,
        );
      }
    } catch (runError) {
      runHadFailure = true;
      keepDetailsOpen = true;
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
      // A failed or cancelled run cannot donate its engine state to the next
      // request. terminate() is idempotent if cancellation already stopped it.
      if (cancelRequestedRef.current || runHadFailure || (pool && !pool.usable)) {
        disposeProcessingPool();
      }
      if (pool && pool !== warmProcessingPoolRef.current?.pool) pool.terminate();
      // The shared inspection batch is selection-scoped, not run-scoped. Keep
      // it for an exact fresh preflight on Retry/comparison; selection change
      // and unmount own disposal and secret zeroization.
      processingRef.current = false;
      setIsRunning(false);
      setProcessExpanded(keepDetailsOpen);
    }
  };

  const cancelProcessing = useCallback(() => {
    cancelRequestedRef.current = true;
    // Terminate in-flight workers immediately; the runner loop won't claim more.
    poolRef.current?.terminate();
    disposeProcessingPool();
  }, [disposeProcessingPool]);

  /**
   * Reprocess a single file in place — used by the Retry control on a failed
   * row. Runs on the main thread (one file), then splices the fresh result back
   * into `results` in the original run order and refreshes the cached run.
   */
  const retryFile = useCallback(
    async (fileName: string) => {
      if (
        processingRef.current ||
        retryingFileRef.current ||
        comparisonOperationCountRef.current > 0
      )
        return;
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
        // H2: probe first, bind second. The fallback binding below reads
        // `durableWorkspaceRef` to pick the runtime's persistence mode, so
        // probing afterwards would commit the retry to the durable branch on a
        // stale ref after storage was lost mid-batch.
        const retryCapability = await reprobeWorkspaceCapability();
        if (workspaceRefusesRun(retryCapability)) {
          throw new Error(
            `Durable local workspace unavailable. ${transientWorkspaceRefusalNotice(
              retryCapability.status === "unavailable"
                ? retryCapability.reason
                : "",
            )}`,
          );
        }
        const retryBinding = await resolveRetryExecutionBinding(
          results.length,
          resultsOptions,
          resultsExecutionBinding,
          async () => {
            const currentRetryOptions = await resolveRunOptions(options, [file]);
            const currentUserSupportFiles = await buildSupportFilesForOptions(
              currentRetryOptions,
            );
            const injectedRuntime = getInjectedRuntime(
              durableWorkspaceRef.current,
              runtimeTogglesRef.current,
            );
            const currentRetryBinding: ResultExecutionBinding = {
              options: currentRetryOptions,
              supportFiles: await resolveDefaultSupportFiles(
                currentRetryOptions,
                currentUserSupportFiles,
              ),
              runtime: {
                ...injectedRuntime,
                datetimeOfPreprocessing:
                  injectedRuntime?.datetimeOfPreprocessing ??
                  `${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`,
              },
            };
            return currentRetryBinding;
          },
        );
        if (
          requiresLiveScientificPreflight(retryBinding.options) &&
          !hasCurrentRawInspection()
        ) {
          throw new Error(
            "Scientific processing requires a complete current raw-file inspection; re-select and re-inspect the files.",
          );
        }
        assertRawFileWithinLimit(file);
        const bytes = await file.arrayBuffer();
        comparisonWarmupRef.current = null;
        const result = await processRawCsvBytes(
          file.name,
          bytes,
          retryBinding.options,
          retryBinding.supportFiles,
          retryBinding.runtime,
          handleProgressEvent,
          verifiedInputDigestByFileRef.current.get(file),
          participantPartitionFor(
            verifiedInputDigestByFileRef.current.get(file),
            retryBinding.options,
          ),
          rawInspectionBatchRef.current ?? undefined,
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
        setResultsOptions(retryBinding.options);
        setResultsExecutionBinding(retryBinding);
        const nextTimezones = Array.from(
          new Set(merged.flatMap((entry) => entry.availableTimezones)),
        ).sort((left, right) => left.localeCompare(right));
        setDiscoveredTimezones(nextTimezones);
        // Same reason as the batch save: never persist a record whose outputs
        // only exist in this tab. The pressure refresh used to ride on this
        // call's `.finally`, so guarding the save alone would have skipped it
        // entirely on an ephemeral retry — it is invoked unconditionally
        // below. It only reads `navigator.storage.estimate()`
        // (`estimateStoragePressure`), so it writes nothing and is safe in
        // either mode.
        const retryPersisted = durableWorkspaceRef.current;
        // Awaited so the toast reports whether the record was stored.
        const retrySaveFailure = retryPersisted
          ? await saveLastRun({
              options: retryBinding.options,
              results: merged,
              discoveredTimezones: nextTimezones,
              // Same shortfall record as the batch save: a retry that fixes one
              // of several failed files must not restore as a complete batch.
              attemptedFileCount: progressOrder.length,
              unfinishedFileNames: progressOrder.filter(
                (name) => !merged.some((entry) => entry.inputFileName === name),
              ),
            }).then(
              () => null,
              (saveError: unknown) =>
                saveError instanceof Error ? saveError.message : String(saveError),
            )
          : null;
        void refreshStoragePressure();
        // And say the same thing the batch says: an unsaved result is ready
        // in this tab, and the user has to download it before reloading.
        setToast({
          message: !retryPersisted
            ? `Reprocessed ${demoDisplay.fileName(fileName)} — results are ready in this tab but were not saved for reload: durable local storage is unavailable. Download them before closing or reloading.`
            : retrySaveFailure !== null
              ? `Reprocessed ${demoDisplay.fileName(fileName)} — the results were not saved for reload (${retrySaveFailure}). Download them before closing or reloading.`
              : `Reprocessed ${demoDisplay.fileName(fileName)}.`,
          isError: !retryPersisted || retrySaveFailure !== null,
        });
      } catch (retryError) {
        const message = processingErrorText(retryError);
        handleProgressEvent({
          type: "file-complete",
          fileName,
          error: message,
          scientificPreflightRefusal:
            scientificPreflightReceiptFromError(retryError),
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
      resultsOptions,
      resultsExecutionBinding,
      progressOrder,
      handleProgressEvent,
      refreshStoragePressure,
      demoDisplay,
      participantPartitionFor,
      hasCurrentRawInspection,
    ],
  );

  const progressRows = progressOrder.map(
    (name) =>
      progressByFile[name] ?? { fileName: name, status: "pending" as const },
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

  // A reload or tab close mid-run (batch, retry or comparison) discards the
  // work, so the browser asks first.
  const workInFlight = isRunning || !!retryingFile || isComparing;
  useEffect(() => {
    if (!workInFlight) return;
    const confirmLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", confirmLeave);
    return () => window.removeEventListener("beforeunload", confirmLeave);
  }, [workInFlight]);

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
  /**
   * Delete the displayed run everywhere it is stored: the OPFS workspace
   * history of every result (root slots and every content-addressed object,
   * which include the participant-level tables) and the IndexedDB record that
   * restores the run on the next visit. Success is reported only after every
   * delete has completed.
   */
  const deleteResults = async (): Promise<void> => {
    const workspaceIds = [
      ...new Set(
        results.flatMap((result) => {
          const receipt = result.rustRuntimeReceipt;
          return receipt?.persistedGeneration === undefined
            ? []
            : [receipt.workspaceId];
        }),
      ),
    ];
    // A pending reclaim of a workspace about to be deleted would recreate
    // its (empty) directory; drop it.
    for (const workspaceId of workspaceIds) {
      pendingGarbageCollectionRef.current.delete(workspaceId);
    }
    setResults([]);
    setResultsOptions(null);
    setResultsSupportFiles(null);
    setResultsExecutionBinding(null);
    setProgressOrder([]);
    setProgressByFile({});
    // The processing and comparison pools keep decoded results in worker
    // memory and may leave payloads in their OPFS spill files; end them, then
    // remove the spill files they released.
    disposeProcessingPool();
    disposeComparisonPool();
    const [workspaces, lastRun, spill] = await Promise.allSettled([
      deletePersistedWorkspaces(workspaceIds),
      clearLastRun(),
      removePayloadSpillFiles().then((failure) => {
        if (failure !== null) throw new Error(failure);
      }),
    ]);
    void refreshStoragePressure();
    const failures = [workspaces, lastRun, spill].flatMap((outcome) =>
      outcome.status === "rejected"
        ? [
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason),
          ]
        : [],
    );
    setToast(
      failures.length
        ? {
            message:
              `The results were removed from this page, but deleting their saved copy in this browser failed (${failures.join("; ")}). ` +
              "The data is still stored here. Try again with “Delete all local data” in the page footer, or clear this site's data in your browser settings.",
            isError: true,
          }
        : {
            message:
              "Deleted the processed results and their saved copy in this browser.",
            isError: false,
          },
    );
  };

  const clearFiles = (): void => {
    studySplitGenerationRef.current += 1;
    onFilesChange([]);
    setProgressOrder([]);
    setProgressByFile({});
  };

  const clearCachedRun = async (): Promise<void> => {
    try {
      await clearCachedRunData();
      setToast({ message: "Cleared the cached last run.", isError: false });
      dismissBackgroundNotice("last-run");
    } catch (clearError) {
      setToast({
        message: `Could not clear the cached last run: ${
          clearError instanceof Error ? clearError.message : String(clearError)
        }`,
        isError: true,
      });
    } finally {
      void refreshStoragePressure();
    }
  };

  /**
   * The footer's "Delete all local data": wipe everything this app stored in
   * the browser, then reload into a clean app that confirms it. A step that
   * failed is reported instead, and the page is not reloaded, so the message
   * stays readable.
   */
  const deleteAllLocalData = async (): Promise<void> => {
    const failures = await resetLocalData();
    if (failures.length) {
      setToast({
        message:
          `Some of this app’s data could not be deleted: ${failures.join("; ")}. ` +
          "Close other tabs of this app and try again, or clear this site's data in your browser settings.",
        isError: true,
      });
      return;
    }
    markLocalDataDeleted();
    window.location.reload();
  };

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
              {workspaceDegradesToEphemeral(workspaceCapability) ? (
                <>
                  <strong>
                    Running without durable local storage (ephemeral mode).
                  </strong>{" "}
                  {ephemeralWorkspaceNotice(workspaceCapability.reason)}
                </>
              ) : (
                <>
                  <strong>Durable local processing is unavailable.</strong>{" "}
                  {transientWorkspaceRefusalNotice(workspaceCapability.reason)}
                </>
              )}
            </span>
          </div>
        ) : null}

        {legacyOpfsState?.detected ? (
          <div
            className="storage-pressure"
            role="status"
            data-testid="legacy-workspace-detected"
          >
            <span className="storage-pressure__text">
              <strong>Data from an older workflow version was found.</strong>{" "}
              This version did not open, migrate, or delete it because the new
              workflow uses different cache identities. Use the older app
              version to export that workspace, or clear this site&apos;s data
              when you no longer need it.
            </span>
          </div>
        ) : null}

        {legacyLastRunState?.detected ? (
          <div
            className="storage-pressure"
            role="status"
            data-testid="legacy-last-run-detected"
          >
            <span className="storage-pressure__text">
              <strong>A cached run from an older workflow was found.</strong>{" "}
              This version did not open, migrate, or delete it. Reopen the older
              app version if you need that summary, or use your browser&apos;s
              site-data controls when you are ready to remove it.
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
                onClick={() => setPendingConfirmation("clear-cached-run")}
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

        {backgroundNotices.map((notice) => (
          <div
            key={notice.key}
            className="storage-pressure"
            role="alert"
            data-testid="background-notice"
            data-notice-key={notice.key}
          >
            <span className="storage-pressure__text">
              <strong>{notice.title}</strong> {notice.detail}
            </span>
            <span className="storage-pressure__actions">
              {notice.offerClearCachedRun ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  data-testid="background-notice-clear-cached-run"
                  onClick={() => setPendingConfirmation("clear-cached-run")}
                >
                  Clear cached run
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--ghost"
                data-testid="background-notice-dismiss"
                onClick={() => dismissBackgroundNotice(notice.key)}
              >
                Dismiss
              </button>
            </span>
          </div>
        ))}

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
                methodProfileReceipt={activeMethodProfileReceipts.android ?? null}
                onMethodProfileReceiptChange={(receipt) => setActiveMethodProfileReceipts((current) => ({
                  ...current,
                  android: receipt ?? undefined,
                }))}
                hideDemoMetadata={hideDemoMetadata}
                onHideDemoMetadataChange={setHideDemoMetadata}
                onStatus={(message, isError = false) =>
                  setToast({ message, isError })
                }
              />
              <Suspense fallback={<SettingsCardLoading anchor="research-method-profile" title="Research method profile" />}>
                <ResearchMethodProfileCard
                  options={options}
                  setOptions={setOptions}
                  onCompiled={(receipt) => {
                    setActiveMethodProfileReceipts((current) => ({
                      ...current,
                      android: receipt ?? undefined,
                    }));
                  }}
                  onRunComponent={(registration) => {
                    void runLiteratureComponent(registration);
                  }}
                  onComponentSelected={selectLiteratureComponent}
                  componentRunning={isLiteratureComponentRunning}
                  onStatus={(message, isError = false) =>
                    setToast({ message, isError })
                  }
                />
              </Suspense>
              <Suspense fallback={<SettingsCardLoading anchor="sleep-diary-replication" title="Sleep diary replication" />}>
                <SleepDiaryReplicationCard
                  methodProfileReceipt={activeMethodProfileReceipts.sleepDiary ?? null}
                  onBound={(receipt) => setActiveMethodProfileReceipts((current) => ({
                    ...current,
                    sleepDiary: receipt ?? undefined,
                  }))}
                  onStatus={(message, isError = false) =>
                    setToast({ message, isError })
                  }
                />
              </Suspense>
              <ProjectsCard
                options={options}
                methodProfileReceipt={activeMethodProfileReceipts.android ?? null}
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
                  inputCapabilityEvidenceFile,
                  analysisFeatureMatrixFile,
                  callSmsEligibilityFile,
                  phoneStudyPsCommunicationFile,
                  phoneStudyEsFile,
                  anchorEventsFile,
                }}
                onApplyProject={applyProject}
                disabled={isRunning || !!retryingFile || isComparing}
                onStatus={(message, isError = false) =>
                  setToast({ message, isError })
                }
              />
              <SettingsOverviewCard options={options} setOptions={setOptions} />
              <div className="settings-stack">
                {shows("support files keep awake prevent screen sleep codebook") ||
                shows("timezone conversion selected primary") ||
                shows(
                  "session detection duration thresholds comparator disposition micro use classification okoshi reconstruction schoedel duplicate fallback stop",
                ) ||
                shows(
                  "screen detection construction session parry toth zhu capability autolock keyguard manual",
                ) ||
                shows("interaction semantics stop usage remap") ||
                shows("performance parallel workers") ? (
                  <h3 className="workflow-section__subtitle">Preprocessing</h3>
                ) : null}
                {shows(
                  "support files keep awake prevent screen sleep codebook",
                ) ? (
                  <FilesAndInputsCard
                    options={options}
                    setOptions={setOptions}
                    displayMasker={demoDisplay}
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
                  "session detection duration thresholds comparator disposition micro use classification okoshi reconstruction schoedel duplicate fallback stop",
                ) ? (
                  <SessionDetectionCard
                    options={options}
                    setOptions={setOptions}
                  />
                ) : null}
                {shows(
                  "screen detection construction session parry toth zhu capability autolock keyguard manual",
                ) ? (
                  <ScreenDetectionCard
                    options={options}
                    setOptions={setOptions}
                  />
                ) : null}
                {shows("interaction semantics stop usage remap") ? (
                  <InteractionSemanticsCard
                    options={options}
                    setOptions={setOptions}
                  />
                ) : null}
                {shows("performance parallel workers") ? (
                  <PerformanceCard
                    options={options}
                    setOptions={setOptions}
                    provenanceEvidence={provenanceEvidence}
                    onProvenanceEvidenceChange={setProvenanceEvidence}
                  />
                ) : null}
                {shows(
                  "filter minimum zero duration out of order interval quality maximum duration screen session maximum screen gated credit study window interaction removal cleaning",
                ) ? (
                  <>
                    <h3 className="workflow-section__subtitle">Optional cleaning</h3>
                    <CleaningSettingsCard
                      options={options}
                      setOptions={setOptions}
                      settingsTab={{
                        filterFile,
                        setFilterFile,
                        studyDatesLoaded: Boolean(studyDatesFile),
                        displayMasker: demoDisplay,
                      }}
                    />
                  </>
                ) : null}
                {shows(
                  "study inputs dates device sharing survey enrolled devices input capability evidence sidecar phonestudy communication es questionnaire upload analyze",
                ) ||
                shows("study analysis notification polled emulation attribution compliance coverage analyze") ? (
                  <h3 className="workflow-section__subtitle">Study analysis (optional)</h3>
                ) : null}
                {shows(
                  "study inputs dates device sharing survey enrolled devices input capability evidence sidecar phonestudy communication es questionnaire upload analyze",
                ) ? (
                  <StudyInputsCard
                    options={options}
                    methodProfileSettingIds={
                      activeLiteratureComponent?.methodSettingIds ??
                      activeMethodProfileReceipts.android?.settingIds
                    }
                    displayMasker={demoDisplay}
                    studyDatesFile={studyDatesFile}
                    setStudyDatesFile={setStudyDatesFile}
                    deviceSharingFile={deviceSharingFile}
                    setDeviceSharingFile={setDeviceSharingFile}
                    surveyAttributionFile={surveyAttributionFile}
                    setSurveyAttributionFile={setSurveyAttributionFile}
                    enrolledDevicesFile={enrolledDevicesFile}
                    setEnrolledDevicesFile={setEnrolledDevicesFile}
                    inputCapabilityEvidenceFile={inputCapabilityEvidenceFile}
                    setInputCapabilityEvidenceFile={
                      setInputCapabilityEvidenceFile
                    }
                    analysisFeatureMatrixFile={analysisFeatureMatrixFile}
                    setAnalysisFeatureMatrixFile={setAnalysisFeatureMatrixFile}
                    callSmsEligibilityFile={callSmsEligibilityFile}
                    setCallSmsEligibilityFile={setCallSmsEligibilityFile}
                    phoneStudyPsCommunicationFile={phoneStudyPsCommunicationFile}
                    setPhoneStudyPsCommunicationFile={
                      setPhoneStudyPsCommunicationFile
                    }
                    phoneStudyEsFile={phoneStudyEsFile}
                    setPhoneStudyEsFile={setPhoneStudyEsFile}
                    anchorEventsFile={anchorEventsFile}
                    setAnchorEventsFile={setAnchorEventsFile}
                  />
                ) : null}
                {shows(
                  "study analysis notification polled emulation attribution compliance coverage analyze",
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
              onFilesChange={onFilesPicked}
              onFilesReorder={onFilesReorder}
              onClear={() => setPendingConfirmation("clear-files")}
              isRunning={
                isRunning ||
                isLiteratureComponentRunning ||
                !!retryingFile ||
                isComparing
              }
              literatureComponentActive={Boolean(activeLiteratureComponent)}
              componentTableFormat={activeLiteratureComponent?.tableFormat}
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
              inspectionReady={
                !requiresLiveScientificPreflight(options) ||
                hasCurrentRawInspection()
              }
              isRunning={isRunning}
              ephemeralWorkspace={workspaceDegradesToEphemeral(
                workspaceCapability,
              )}
              durableWorkspaceUnavailable={workspaceRefusesRun(
                workspaceCapability,
              )}
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

            <WorkspaceBackupControls results={results} componentResult={literatureComponentResult} durableStorageAvailable={workspaceCapability?.status !== "unavailable"} onImportStarted={() => { componentRestoreSuperseded.current = true; }} onComponentRestored={async (result) => {
              setLiteratureComponentResult(result);
              setLiteratureComponentError(null);
              await saveLastComponentManifest(result.manifestJson);
            }} />
            <div aria-live="polite">
              <Suspense fallback={null}>
                <ResultPanel
                  results={results}
                  error={error}
                  displayMasker={demoDisplay}
                  // The panel describes a finished run: its column visibility and its
                  // per-file warnings must come from the options that produced the
                  // results, never from live settings the user has since edited.
                  options={resultsOptions ?? options}
                  expectedFileCount={uploadedFiles.length}
                  progressRows={progressRows}
                  stale={resultsStale}
                  onDelete={() => setPendingConfirmation("delete-results")}
                  deleteDisabled={workInFlight || isLiteratureComponentRunning}
                />
                <LiteratureComponentResultPanel
                  result={literatureComponentResult}
                  error={literatureComponentError}
                  onDelete={() => {
                    componentRestoreSuperseded.current = true;
                    setLiteratureComponentResult(null);
                    setLiteratureComponentError(null);
                    void clearLastComponentManifest().catch((error: unknown) => setLiteratureComponentError(`Could not clear saved component pointer: ${String(error)}`));
                    setToast({
                      message: "Deleted the literature component result from this view.",
                      isError: false,
                    });
                  }}
                  onError={(message) => setToast({ message, isError: true })}
                />
              </Suspense>
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
                  workflowExplorerView={workflowExplorerView ?? null}
                  supportRoles={workflowSupportRoles}
                  displayMasker={demoDisplay}
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
            <Suspense fallback={<p className="empty-state" role="status">Loading the review…</p>}>
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
                onOpenTimelineSetting={() => {
                  navigateToSetting('[data-settings-anchor="overview"]');
                  // After navigateToSetting's frame has shown the Settings tab.
                  requestAnimationFrame(() => {
                    document
                      .querySelector<HTMLInputElement>(
                        '[data-testid="toggle-enableInteractiveTimeline"]',
                      )
                      ?.focus({ preventScroll: true });
                  });
                }}
              />
            </Suspense>
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
                  setError(
                    "Could not clear the cache. Try a hard reload (Ctrl+Shift+R / Cmd+Shift+R).",
                  );
                });
              }}
              title="Clear service worker caches and reload"
            >
              Trouble loading?
            </button>
            <span aria-hidden="true">·</span>
            <DiagnosticReportControl className="app-footer__cache-reset" />
          </div>
          <FooterNotices
            buildSha={BUILD_SHA}
            baseUrl={import.meta.env.BASE_URL}
            deleteDisabled={workInFlight || isLiteratureComponentRunning}
            onDeleteAllLocalData={() =>
              setPendingConfirmation("delete-all-local-data")
            }
          />
        </footer>
        {toast ? (
          <Toast
            message={toast.message}
            isError={toast.isError}
            onDismiss={dismissToast}
          />
        ) : null}
        {pendingConfirmation === "delete-results" ? (
          <ConfirmDialog
            title="Delete these results?"
            confirmLabel="Delete results"
            testId="delete-results-dialog"
            onCancel={() => setPendingConfirmation(null)}
            onConfirm={() => {
              setPendingConfirmation(null);
              void deleteResults();
            }}
          >
            <p>
              This removes the {results.length} processed result
              {results.length === 1 ? "" : "s"} from this page and deletes{" "}
              {results.length === 1 ? "its" : "their"} saved copy in this browser: the stored output tables, their history, and the cached run that
              reopens them after a reload. Files you already downloaded and the raw files on
              your computer are not affected. This cannot be undone.
            </p>
          </ConfirmDialog>
        ) : null}
        {pendingConfirmation === "clear-files" ? (
          <ConfirmDialog
            title="Clear the selected files?"
            confirmLabel="Clear files"
            testId="clear-files-dialog"
            onCancel={() => setPendingConfirmation(null)}
            onConfirm={() => {
              setPendingConfirmation(null);
              clearFiles();
            }}
          >
            <p>
              This removes the {uploadedFiles.length} selected file
              {uploadedFiles.length === 1 ? "" : "s"} from the queue, clears the results on this
              page, and deletes the cached run that would reopen them after a reload. The files
              on your computer are not affected.
            </p>
          </ConfirmDialog>
        ) : null}
        {pendingConfirmation === "clear-cached-run" ? (
          <ConfirmDialog
            title="Clear the cached last run?"
            confirmLabel="Clear cached run"
            testId="clear-cached-run-dialog"
            onCancel={() => setPendingConfirmation(null)}
            onConfirm={() => {
              setPendingConfirmation(null);
              void clearCachedRun();
            }}
          >
            <p>
              This deletes the saved record that reopens your last run after a reload. Results
              shown on this page stay until you leave it; download anything you need first.
              Saved projects, settings, and presets are kept.
            </p>
          </ConfirmDialog>
        ) : null}
        {pendingConfirmation === "delete-all-local-data" ? (
          <ConfirmDialog
            title="Delete all of this app’s data in this browser?"
            confirmLabel="Delete all local data"
            testId="delete-all-local-data-dialog"
            onCancel={() => setPendingConfirmation(null)}
            onConfirm={() => {
              setPendingConfirmation(null);
              void deleteAllLocalData();
            }}
          >
            <LocalDataInventory />
          </ConfirmDialog>
        ) : null}
      </main>
    </>
  );
}
