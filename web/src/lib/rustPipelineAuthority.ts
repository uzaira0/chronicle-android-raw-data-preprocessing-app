import {
  buildAppTimelineViews,
  buildScreenTimelineViews,
  generateAllHeatmaps,
  generateAllHeatmapSvgs,
  generateAllPlots,
  generateAllPlotSvgs,
  generateAllScreenPlots,
  generateAllScreenPlotSvgs,
} from "@/lib/plotGenerator";
import { buildTimelineViewerHtml } from "@/lib/timelineViewer";
import {
  executeRustRuntime,
  queryPersistedRustReview,
  queryRustReview,
  readPersistedRustArtifact,
  type RustReviewExecution,
  type RustRuntimeExecution,
} from "@/lib/rustPipelineRuntime";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
  ProcessedFileResult,
  ProcessedOutputFileResult,
  PersistedPlotRequest,
  PersistedTimelineRequest,
  ProgressEvent,
  ProgressStepKind,
  ReviewSummary,
  RustStageView,
  TimelineViewData,
} from "@/lib/types";
import type { RustExecutionLedger } from "@/lib/rustExecutionRecords";

const CSV_MIME = "text/csv;charset=utf-8";
const PARQUET_MIME = "application/vnd.apache.parquet";
const SAV_MIME = "application/x-spss-sav";
const ARROW_MIME = "application/vnd.apache.arrow.file";
const VISUALIZATION_DATA_PROTOCOL = "chronicle-visualization-data/v2";
const VISUALIZATION_DATA_COLUMNS = [
  "participantId",
  "date",
  "startTimestampNs",
  "stopTimestampNs",
  "eventTimestampNs",
  "interactionType",
  "broadAppCategory",
  "appPackageName",
  "applicationLabel",
  "username",
  "screenUsageEndReason",
] as const;

type SerializedVisualizationRow = [
  participantId: string,
  date: string,
  startTimestampNs: string | null,
  stopTimestampNs: string | null,
  eventTimestampNs: string,
  interactionType: string,
  broadAppCategory: string | null,
  appPackageName: string,
  applicationLabel: string,
  username: string,
  screenUsageEndReason: string | null,
];

type VisualizationData = {
  protocolVersion: typeof VISUALIZATION_DATA_PROTOCOL;
  columns: typeof VISUALIZATION_DATA_COLUMNS;
  appRows: SerializedVisualizationRow[];
  screenRows: SerializedVisualizationRow[];
  eventTimestampsByParticipant: Record<string, string[]>;
};

type VisualizationRow = {
  participant_id: string;
  date: string;
  start_timestamp_ns: bigint | null;
  stop_timestamp_ns: bigint | null;
  event_timestamp_ns: bigint;
  interaction_type: string;
  broad_app_category: string | null;
  app_package_name: string;
  application_label: string;
  username: string;
  screen_usage_end_reason: string | null;
};

type RenderedViewOptions = Pick<
  BrowserProcessingOptions,
  | "processAppUsage"
  | "processScreenUsage"
  | "enablePlotting"
  | "includeFilteredAppUsageInPlots"
  | "enableActivityHeatmap"
  | "exportPlotsAsSvg"
  | "enableInteractiveTimeline"
>;

function deriveOutputFileName(inputFileName: string, suffix: string): string {
  return inputFileName.replace(/\.csv$/i, "") + suffix;
}

/**
 * Reuse a durable result for another immutable File with the same verified
 * content digest. File names are display/download labels; Rust computation,
 * the workspace root, and every persisted artifact remain byte-identical.
 */
export function relabelDuplicateContentResult(
  source: ProcessedFileResult,
  inputFileName: string,
): ProcessedFileResult {
  const sourceStem = source.inputFileName.replace(/\.csv$/i, "");
  const targetStem = inputFileName.replace(/\.csv$/i, "");
  const outputs = source.outputs.map((output) => {
    if (!output.outputFileName.startsWith(sourceStem)) {
      throw new Error(
        `Rust output name is not derived from its input label: ${output.outputFileName}`,
      );
    }
    return {
      ...output,
      outputFileName:
        targetStem + output.outputFileName.slice(sourceStem.length),
    };
  });
  return {
    ...source,
    inputFileName,
    outputs,
    ...(source.persistedPlotRequest
      ? {
          persistedPlotRequest: {
            ...source.persistedPlotRequest,
            inputFileName,
          },
        }
      : {}),
    ...(source.persistedTimelineRequest
      ? {
          persistedTimelineRequest: {
            ...source.persistedTimelineRequest,
            inputFileName,
          },
        }
      : {}),
  };
}

function requiredArtifact(
  execution: RustRuntimeExecution,
  kind: string,
): Uint8Array {
  const bytes = execution.artifacts.get(kind);
  if (!bytes)
    throw new Error(`Rust runtime omitted required artifact: ${kind}`);
  return bytes;
}

function artifactBlobPart(bytes: Uint8Array): BlobPart {
  // wasm-bindgen returns an owned Uint8Array backed by ArrayBuffer. Passing
  // that view directly lets Blob perform its required immutable snapshot;
  // Uint8Array.from(bytes) made an additional full-size JavaScript copy first.
  return bytes as Uint8Array<ArrayBuffer>;
}

function outputPayload(
  execution: RustRuntimeExecution,
  artifactKind: string,
  mediaType: string,
): Pick<ProcessedOutputFileResult, "blob" | "persistedArtifact"> {
  const metadata = execution.manifest.artifacts.find(
    (artifact) => artifact.kind === artifactKind,
  );
  if (!metadata) {
    throw new Error(`Rust runtime omitted required artifact: ${artifactKind}`);
  }
  if (execution.persistedWorkspace) {
    return {
      blob: null,
      persistedArtifact: {
        workspaceId: execution.workspaceId,
        workspaceRootDigest: execution.manifest.workspaceRootDigest,
        kind: artifactKind,
        mediaType,
        size: metadata.size,
      },
    };
  }
  const bytes = requiredArtifact(execution, artifactKind);
  return {
    blob: new Blob([artifactBlobPart(bytes)], {
      type: mediaType,
    }),
  };
}

function parseJsonArtifact<T>(
  execution: RustRuntimeExecution,
  kind: string,
): T {
  return JSON.parse(
    new TextDecoder().decode(requiredArtifact(execution, kind)),
  ) as T;
}

function addCsvOutput(
  outputs: ProcessedOutputFileResult[],
  execution: RustRuntimeExecution,
  kind: ProcessedOutputFileResult["kind"],
  artifactKind: string,
  inputFileName: string,
  suffix: string,
  rowCount?: number,
): void {
  const metadata = execution.manifest.artifacts.find(
    (artifact) => artifact.kind === artifactKind,
  );
  const exactRowCount = rowCount ?? metadata?.rowCount;
  if (exactRowCount === undefined || !metadata) {
    throw new Error(
      `Rust runtime omitted CSV display metadata: ${artifactKind}`,
    );
  }
  outputs.push({
    kind,
    outputFileName: deriveOutputFileName(inputFileName, suffix),
    ...outputPayload(execution, artifactKind, CSV_MIME),
    rowCount: exactRowCount,
    previewRows: metadata.previewRows ?? [],
  });
}

function addBinaryOutput(
  outputs: ProcessedOutputFileResult[],
  execution: RustRuntimeExecution,
  kind: "parquet" | "spss" | "lineage",
  artifactKind: string,
  inputFileName: string,
  suffix: string,
  mediaType: string,
  rowCount: number,
): void {
  outputs.push({
    kind,
    outputFileName: deriveOutputFileName(inputFileName, suffix),
    ...outputPayload(execution, artifactKind, mediaType),
    rowCount,
    previewRows: [],
  });
}

function addEvidenceOutput(
  outputs: ProcessedOutputFileResult[],
  execution: RustRuntimeExecution,
  artifactKind: string,
  inputFileName: string,
  suffix: string,
  mediaType: string,
): void {
  outputs.push({
    kind: "lineage",
    outputFileName: deriveOutputFileName(inputFileName, suffix),
    ...outputPayload(execution, artifactKind, mediaType),
    rowCount: 0,
    previewRows: [],
  });
}

function hydrateVisualizationRow(
  row: SerializedVisualizationRow,
): VisualizationRow {
  return {
    participant_id: row[0],
    date: row[1],
    start_timestamp_ns: row[2] === null ? null : BigInt(row[2]),
    stop_timestamp_ns: row[3] === null ? null : BigInt(row[3]),
    event_timestamp_ns: BigInt(row[4]),
    interaction_type: row[5],
    broad_app_category: row[6],
    app_package_name: row[7],
    application_label: row[8],
    username: row[9],
    screen_usage_end_reason: row[10],
  };
}

function decodeVisualizationData(bytes: Uint8Array): VisualizationData {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error("Rust visualization data is invalid JSON", {
      cause: error,
    });
  }
  const candidate = value as Partial<VisualizationData>;
  if (
    !value ||
    typeof value !== "object" ||
    candidate.protocolVersion !== VISUALIZATION_DATA_PROTOCOL ||
    JSON.stringify(candidate.columns) !==
      JSON.stringify(VISUALIZATION_DATA_COLUMNS) ||
    !Array.isArray(candidate.appRows) ||
    !Array.isArray(candidate.screenRows) ||
    !candidate.eventTimestampsByParticipant ||
    typeof candidate.eventTimestampsByParticipant !== "object"
  ) {
    throw new Error("Rust visualization data does not match the v2 row schema");
  }
  return candidate as VisualizationData;
}

async function addRenderedViews(
  outputs: ProcessedOutputFileResult[],
  inputFileName: string,
  options: RenderedViewOptions,
  timezone: string,
  preprocessorVersion: string,
  visualization: VisualizationData,
  renderStaticPlots = true,
  renderTimelineOutput = true,
): Promise<TimelineViewData | undefined> {
  const appRows = visualization.appRows.map(hydrateVisualizationRow);
  const screenRows = visualization.screenRows.map(hydrateVisualizationRow);
  const eventTimestamps = new Map(
    Object.entries(visualization.eventTimestampsByParticipant).map(
      ([participantId, values]) => [
        participantId,
        values.map((value) => BigInt(value)),
      ],
    ),
  );
  const appPlotRows = appRows as Parameters<typeof buildAppTimelineViews>[0];
  const screenPlotRows = screenRows as Parameters<
    typeof buildScreenTimelineViews
  >[0];
  const pushPlots = (
    blobs: Map<string, Blob>,
    suffix: (participantId: string) => string,
  ): void => {
    for (const [participantId, blob] of blobs) {
      outputs.push({
        kind: "plot",
        outputFileName: deriveOutputFileName(
          inputFileName,
          suffix(participantId),
        ),
        blob,
        rowCount: 0,
        previewRows: [],
      });
    }
  };
  if (renderStaticPlots && options.enablePlotting && options.processAppUsage) {
    pushPlots(
      await generateAllPlots(
        appPlotRows,
        timezone,
        options,
        preprocessorVersion,
        eventTimestamps,
      ),
      (participantId) => ` ${participantId} App Usage Plot.png`,
    );
    if (options.exportPlotsAsSvg) {
      pushPlots(
        await generateAllPlotSvgs(
          appPlotRows,
          timezone,
          options,
          preprocessorVersion,
          eventTimestamps,
        ),
        (participantId) => ` ${participantId} App Usage Plot.svg`,
      );
    }
    if (options.enableActivityHeatmap) {
      pushPlots(
        await generateAllHeatmaps(
          appPlotRows,
          timezone,
          options,
          preprocessorVersion,
        ),
        (participantId) => ` ${participantId} App Usage Heatmap.png`,
      );
      if (options.exportPlotsAsSvg) {
        pushPlots(
          await generateAllHeatmapSvgs(
            appPlotRows,
            timezone,
            options,
            preprocessorVersion,
          ),
          (participantId) => ` ${participantId} App Usage Heatmap.svg`,
        );
      }
    }
  }
  if (
    renderStaticPlots &&
    options.enablePlotting &&
    options.processScreenUsage
  ) {
    pushPlots(
      await generateAllScreenPlots(
        screenPlotRows,
        timezone,
        preprocessorVersion,
        eventTimestamps,
      ),
      (participantId) => ` ${participantId} Screen Usage Plot.png`,
    );
    if (options.exportPlotsAsSvg) {
      pushPlots(
        await generateAllScreenPlotSvgs(
          screenPlotRows,
          timezone,
          preprocessorVersion,
          eventTimestamps,
        ),
        (participantId) => ` ${participantId} Screen Usage Plot.svg`,
      );
    }
  }
  // Plot generation needs the hydrated rows only while this function runs.
  // Keeping every per-session view in the React result when the interactive
  // timeline is disabled retained several GiB across a 100-file batch even
  // though the UI could not display that timeline. Let those temporary rows be
  // collected after the plot blobs have been produced.
  if (!options.enableInteractiveTimeline) return undefined;

  const appFilteredExcluded = options.processAppUsage
    ? buildAppTimelineViews(
        appPlotRows,
        timezone,
        options,
        preprocessorVersion,
        eventTimestamps,
        false,
      )
    : [];
  const appFilteredIncluded = options.processAppUsage
    ? buildAppTimelineViews(
        appPlotRows,
        timezone,
        options,
        preprocessorVersion,
        eventTimestamps,
        true,
      )
    : [];
  const app = options.includeFilteredAppUsageInPlots
    ? appFilteredIncluded
    : appFilteredExcluded;
  const screen = options.processScreenUsage
    ? buildScreenTimelineViews(
        screenPlotRows,
        timezone,
        preprocessorVersion,
        eventTimestamps,
      )
    : [];

  if (renderTimelineOutput) {
    outputs.push({
      kind: "plot",
      outputFileName: deriveOutputFileName(
        inputFileName,
        " Timeline Viewer.html",
      ),
      blob: new Blob(
        [
          buildTimelineViewerHtml({
            fileName: inputFileName,
            timezone,
            app,
            screen,
          }),
        ],
        { type: "text/html;charset=utf-8" },
      ),
      rowCount: 0,
      previewRows: [],
    });
  }
  return {
    timezone,
    includeFilteredAppUsageInPlots: options.includeFilteredAppUsageInPlots,
    appFilteredIncluded,
    appFilteredExcluded,
    app,
    screen,
  };
}

async function readPersistedVisualization(
  request: Pick<
    PersistedTimelineRequest,
    "workspaceId" | "workspaceRootDigest"
  >,
): Promise<VisualizationData> {
  return decodeVisualizationData(
    await readPersistedRustArtifact(
      request.workspaceId,
      "visualization-data-json",
      request.workspaceRootDigest,
    ),
  );
}

/**
 * Render browser-owned static plots only when the user requests them. The
 * source read is pinned to the exact workspace root that produced the result,
 * so a newer run in the same workspace cannot silently change the plots.
 */
export async function materializePersistedPlots(
  request: PersistedPlotRequest,
): Promise<ProcessedOutputFileResult[]> {
  const visualization = await readPersistedVisualization(request);
  const outputs: ProcessedOutputFileResult[] = [];
  await addRenderedViews(
    outputs,
    request.inputFileName,
    { ...request.options, enableInteractiveTimeline: false },
    request.timezone,
    request.preprocessorVersion,
    visualization,
    true,
  );
  return outputs.filter(
    (output) =>
      output.kind === "plot" &&
      !output.outputFileName.endsWith(" Timeline Viewer.html"),
  );
}

/** Build only the selected file's timeline scene from its verified OPFS root. */
export async function materializePersistedTimeline(
  request: PersistedTimelineRequest,
): Promise<TimelineViewData> {
  const outputs: ProcessedOutputFileResult[] = [];
  const timeline = await addRenderedViews(
    outputs,
    request.inputFileName,
    {
      ...request.options,
      enablePlotting: false,
      enableActivityHeatmap: false,
      exportPlotsAsSvg: false,
    },
    request.timezone,
    request.preprocessorVersion,
    await readPersistedVisualization(request),
    false,
    false,
  );
  if (!timeline) {
    throw new Error("Persisted timeline request did not enable the timeline");
  }
  return timeline;
}

/** Rebuild the standalone timeline HTML only when the user downloads it. */
export async function materializePersistedTimelineOutput(
  request: PersistedTimelineRequest,
): Promise<ProcessedOutputFileResult> {
  const outputs: ProcessedOutputFileResult[] = [];
  await addRenderedViews(
    outputs,
    request.inputFileName,
    {
      ...request.options,
      enablePlotting: false,
      enableActivityHeatmap: false,
      exportPlotsAsSvg: false,
    },
    request.timezone,
    request.preprocessorVersion,
    await readPersistedVisualization(request),
    false,
    true,
  );
  const output = outputs.find((candidate) =>
    candidate.outputFileName.endsWith(" Timeline Viewer.html"),
  );
  if (!output) throw new Error("Persisted timeline viewer was not generated");
  return output;
}

export async function processRawCsvWithRustAuthority(
  inputFileName: string,
  csvBytes: Uint8Array,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  onProgress?: (event: ProgressEvent) => void,
  verifiedInputSha256?: string,
): Promise<ProcessedFileResult> {
  const emit = (stepKind: ProgressStepKind, percent: number) => {
    onProgress?.({
      type: "step",
      fileName: inputFileName,
      stepKind,
      percent,
    });
  };
  emit("parse", 0);
  const execution = await executeRustRuntime(
    csvBytes,
    inputFileName,
    options,
    supportFiles,
    { ...runtime, persistRustWorkspace: runtime.persistRustWorkspace ?? true },
    verifiedInputSha256,
  );
  const { manifest } = execution;
  const outputs: ProcessedOutputFileResult[] = [];
  if (options.processAppUsage) {
    addCsvOutput(
      outputs,
      execution,
      "app",
      "app-csv",
      inputFileName,
      " Automatically Preprocessed.csv",
      manifest.counts.app,
    );
  }
  if (options.processScreenUsage) {
    addCsvOutput(
      outputs,
      execution,
      "screen",
      "screen-csv",
      inputFileName,
      " Screen Usage Automatically Preprocessed.csv",
      manifest.counts.screen,
    );
  }
  if (options.enableParquetExport) {
    if (options.processAppUsage) {
      addBinaryOutput(
        outputs,
        execution,
        "parquet",
        "app-parquet",
        inputFileName,
        " Automatically Preprocessed.parquet",
        PARQUET_MIME,
        manifest.counts.app,
      );
    }
    if (options.processScreenUsage) {
      addBinaryOutput(
        outputs,
        execution,
        "parquet",
        "screen-parquet",
        inputFileName,
        " Screen Usage Automatically Preprocessed.parquet",
        PARQUET_MIME,
        manifest.counts.screen,
      );
    }
  }
  if (options.enableSpssExport) {
    if (options.processAppUsage) {
      addBinaryOutput(
        outputs,
        execution,
        "spss",
        "app-spss",
        inputFileName,
        " Automatically Preprocessed.sav",
        SAV_MIME,
        manifest.counts.app,
      );
    }
    if (options.processScreenUsage) {
      addBinaryOutput(
        outputs,
        execution,
        "spss",
        "screen-spss",
        inputFileName,
        " Screen Usage Automatically Preprocessed.sav",
        SAV_MIME,
        manifest.counts.screen,
      );
    }
  }
  if (options.enableScreenGatedCrediting) {
    addCsvOutput(
      outputs,
      execution,
      "app",
      "credited-app-csv",
      inputFileName,
      " Credited App Usage.csv",
    );
  }
  if (options.enableComplianceScoring) {
    addCsvOutput(
      outputs,
      execution,
      "aggregate",
      "compliance-csv",
      inputFileName,
      " Compliance Report.csv",
    );
  }
  if (options.enableDayCoverage) {
    addCsvOutput(
      outputs,
      execution,
      "aggregate",
      "day-coverage-csv",
      inputFileName,
      " Day Coverage.csv",
    );
  }
  if (options.enableAggregates) {
    for (const [artifactKind, suffix] of [
      ["aggregate-daily-summary-csv", " Daily Summary.csv"],
      ["aggregate-weekly-summary-csv", " Weekly Summary.csv"],
      ["aggregate-top-apps-csv", " Top Apps.csv"],
      ...(options.useAppCodebook
        ? [["aggregate-category-time-budget-csv", " Category Time Budget.csv"]]
        : []),
      ...(options.modelConcurrentUsage || options.useBackgroundAppsFile
        ? [["aggregate-app-co-usage-csv", " App Co-Usage.csv"]]
        : []),
    ] as const) {
      const metadata = manifest.artifacts.find(
        (artifact) => artifact.kind === artifactKind,
      );
      addCsvOutput(
        outputs,
        execution,
        "aggregate",
        artifactKind,
        inputFileName,
        suffix,
        metadata?.rowCount,
      );
    }
  }
  const lineageMetadata = manifest.artifacts.find(
    (artifact) => artifact.kind === "row-lineage-arrow",
  );
  addBinaryOutput(
    outputs,
    execution,
    "lineage",
    "row-lineage-arrow",
    inputFileName,
    " Row Lineage.arrow",
    ARROW_MIME,
    lineageMetadata?.rowCount ?? 0,
  );
  const sourceCoordinateMetadata = manifest.artifacts.find(
    (artifact) => artifact.kind === "source-coordinate-index-arrow",
  );
  addBinaryOutput(
    outputs,
    execution,
    "lineage",
    "source-coordinate-index-arrow",
    inputFileName,
    " Source Coordinate Index.arrow",
    ARROW_MIME,
    sourceCoordinateMetadata?.rowCount ?? 0,
  );
  const cellCorrespondenceMetadata = manifest.artifacts.find(
    (artifact) => artifact.kind === "result-cell-correspondence-arrow",
  );
  addBinaryOutput(
    outputs,
    execution,
    "lineage",
    "result-cell-correspondence-arrow",
    inputFileName,
    " Result Cell Correspondence.arrow",
    ARROW_MIME,
    cellCorrespondenceMetadata?.rowCount ?? 0,
  );
  for (const [kind, suffix, mediaType] of [
    ["evidence-journal", " Evidence Journal.cbor", "application/cbor"],
    ["artifact-closure-json", " Artifact Closure.json", "application/json"],
    [
      "dependency-certificate-json",
      " Dependency Certificate.json",
      "application/json",
    ],
    [
      "correspondence-index-json",
      " Correspondence Index.json",
      "application/json",
    ],
    ["execution-ledger-json", " Execution Ledger.json", "application/json"],
    ["stage-view-json", " Stage View.json", "application/json"],
    [
      "semantic-index-source-json",
      " Semantic Index Source.json",
      "application/json",
    ],
  ] as const) {
    addEvidenceOutput(
      outputs,
      execution,
      kind,
      inputFileName,
      suffix,
      mediaType,
    );
  }
  outputs.push({
    kind: "lineage",
    outputFileName: deriveOutputFileName(
      inputFileName,
      " Runtime Manifest.json",
    ),
    blob: new Blob([execution.manifestJson], { type: "application/json" }),
    rowCount: 0,
    previewRows: [],
  });
  const renderStaticPlotsNow =
    options.enablePlotting && !execution.persistedWorkspace;
  const renderBrowserViewsNow =
    !execution.persistedWorkspace &&
    (options.enablePlotting || options.enableInteractiveTimeline);
  const timelineView = renderBrowserViewsNow
    ? await addRenderedViews(
        outputs,
        inputFileName,
        options,
        manifest.processingSummary.timezone,
        manifest.preprocessorVersion,
        decodeVisualizationData(
          requiredArtifact(execution, "visualization-data-json"),
        ),
        renderStaticPlotsNow,
      )
    : undefined;
  const persistedPlotRequest: PersistedPlotRequest | undefined =
    execution.persistedWorkspace && options.enablePlotting
      ? {
          workspaceId: execution.workspaceId,
          workspaceRootDigest: manifest.workspaceRootDigest,
          inputFileName,
          timezone: manifest.processingSummary.timezone,
          preprocessorVersion: manifest.preprocessorVersion,
          options: {
            processAppUsage: options.processAppUsage,
            processScreenUsage: options.processScreenUsage,
            enablePlotting: options.enablePlotting,
            includeFilteredAppUsageInPlots:
              options.includeFilteredAppUsageInPlots,
            enableActivityHeatmap: options.enableActivityHeatmap,
            exportPlotsAsSvg: options.exportPlotsAsSvg,
          },
        }
      : undefined;
  const persistedTimelineRequest: PersistedTimelineRequest | undefined =
    execution.persistedWorkspace && options.enableInteractiveTimeline
      ? {
          workspaceId: execution.workspaceId,
          workspaceRootDigest: manifest.workspaceRootDigest,
          inputFileName,
          timezone: manifest.processingSummary.timezone,
          preprocessorVersion: manifest.preprocessorVersion,
          options: {
            processAppUsage: options.processAppUsage,
            processScreenUsage: options.processScreenUsage,
            includeFilteredAppUsageInPlots:
              options.includeFilteredAppUsageInPlots,
            enableInteractiveTimeline: options.enableInteractiveTimeline,
          },
        }
      : undefined;
  // Durable runs keep the complete review JSON in verified OPFS. The View tab
  // loads only the selected file and pins that read to this exact root. An
  // ephemeral run still needs the bytes embedded because it has no durable
  // source to read later.
  const reviewSummary = execution.persistedWorkspace
    ? undefined
    : parseJsonArtifact<ReviewSummary>(execution, "review-summary-json");
  const executionLedger = parseJsonArtifact<RustExecutionLedger>(
    execution,
    "execution-ledger-json",
  );
  const rustStageView = parseJsonArtifact<RustStageView>(
    execution,
    "stage-view-json",
  );
  return {
    inputFileName,
    inputSha256: manifest.input.digest.replace(/^sha256:/, ""),
    outputs,
    originalRowCount: manifest.counts.original,
    processedRowCount: manifest.counts.processed,
    availableTimezones: manifest.processingSummary.availableTimezones,
    timezone: manifest.processingSummary.timezone,
    appRowCount: manifest.counts.app,
    screenRowCount: manifest.counts.screen,
    timezoneAction: manifest.processingSummary.timezoneAction,
    rowsBeforeTimezoneHandling:
      manifest.processingSummary.rowsBeforeTimezoneHandling,
    rowsAfterTimezoneHandling:
      manifest.processingSummary.rowsAfterTimezoneHandling,
    rowsRemovedByTimezone: manifest.processingSummary.rowsRemovedByTimezone,
    duplicateTimestampsCorrected:
      manifest.processingSummary.duplicateTimestampsCorrected,
    exactDuplicateRowsRemoved:
      manifest.processingSummary.exactDuplicateRowsRemoved,
    timelineView,
    persistedPlotRequest,
    persistedTimelineRequest,
    reviewSummary,
    executionLedger,
    rustStageView,
    rustRuntimeReceipt: {
      protocolVersion: "chronicle-preprocessing-runtime/v1",
      workspaceId: execution.workspaceId,
      workspaceRootDigest: manifest.workspaceRootDigest,
      previousWorkspaceRootDigest: manifest.previousWorkspaceRootDigest,
      implementationDigest: manifest.implementationDigest,
      buildEnvironmentDigest: manifest.buildEnvironmentDigest,
      planDigest: manifest.planDigest,
      profileDigest: manifest.profileDigest,
      profileLockDigest: manifest.profileLockDigest,
      productContractDigest: manifest.productContractDigest,
      journalDigest: manifest.journalDigest,
      openObligationCount: manifest.openObligations.length,
      ...(execution.persistedWorkspace
        ? { persistedGeneration: execution.persistedWorkspace.generation }
        : {}),
    },
  };
}

/**
 * Run the same authoritative Rust graph as a full preprocessing run, but ask
 * it to materialize only the compact review metrics needed by View-tab A/B.
 */
export async function processRawCsvReviewWithRustAuthority(
  inputFileName: string,
  csvBytes: Uint8Array,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  verifiedInputSha256?: string,
  verifiedSupportCacheKey?: string,
  knownReviewSummaryDigests?: string[],
): Promise<ProcessedFileResult> {
  const execution: RustReviewExecution = await queryRustReview(
    csvBytes,
    inputFileName,
    options,
    supportFiles,
    { ...runtime, persistRustWorkspace: runtime.persistRustWorkspace ?? true },
    verifiedInputSha256,
    verifiedSupportCacheKey,
    knownReviewSummaryDigests,
  );
  return reviewExecutionResult(inputFileName, execution);
}

/** Try the verified OPFS bases without reading or transferring the raw file. */
export async function processPersistedReviewWithRustAuthority(
  inputFileName: string,
  inputSizeBytes: number,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  verifiedInputSha256: string,
  verifiedSupportCacheKey?: string,
  knownReviewSummaryDigests?: string[],
): Promise<ProcessedFileResult | null> {
  const execution = await queryPersistedRustReview(
    inputSizeBytes,
    inputFileName,
    options,
    supportFiles,
    runtime,
    verifiedInputSha256,
    verifiedSupportCacheKey,
    knownReviewSummaryDigests,
  );
  return execution ? reviewExecutionResult(inputFileName, execution) : null;
}

function reviewExecutionResult(
  inputFileName: string,
  execution: RustReviewExecution,
): ProcessedFileResult {
  return {
    inputFileName,
    inputSha256: execution.inputDigest.replace(/^sha256:/, ""),
    outputs: [],
    originalRowCount: execution.counts.original,
    processedRowCount: execution.counts.processed,
    availableTimezones: execution.availableTimezones,
    timezone: execution.timezone,
    appRowCount: execution.counts.app,
    screenRowCount: execution.counts.screen,
    timezoneAction: execution.timezoneAction,
    rowsBeforeTimezoneHandling: execution.rowsBeforeTimezoneHandling,
    rowsAfterTimezoneHandling: execution.rowsAfterTimezoneHandling,
    rowsRemovedByTimezone: execution.rowsRemovedByTimezone,
    duplicateTimestampsCorrected: execution.duplicateTimestampsCorrected,
    exactDuplicateRowsRemoved: execution.exactDuplicateRowsRemoved,
    reviewSummaryJsonBytes: execution.reviewSummaryJsonBytes,
    ...(execution.reviewSummaryReused ? { reviewSummaryReused: true } : {}),
    reviewOnly: true,
    rustReviewReceipt: {
      protocolVersion: "chronicle-preprocessing-runtime/v1",
      workspaceId: execution.workspaceId,
      previousWorkspaceRootDigest: execution.previousWorkspaceRootDigest,
      inputDigest: execution.inputDigest,
      optionsDigest: execution.optionsDigest,
      implementationDigest: execution.implementationDigest,
      buildEnvironmentDigest: execution.buildEnvironmentDigest,
      planDigest: execution.planDigest,
      profileDigest: execution.profileDigest,
      profileLockDigest: execution.profileLockDigest,
      productContractDigest: execution.productContractDigest,
      dependencyCertificateDigest: execution.dependencyCertificateDigest,
      reviewSummaryDigest: execution.reviewSummaryDigest,
      comparisonDigest: execution.comparisonDigest,
      cacheSources: execution.cacheSources,
      suppliedReviewBaseBytes: execution.suppliedReviewBaseBytes,
      suppliedReconstructionBaseBytes:
        execution.suppliedReconstructionBaseBytes,
      recomputedStepIds: execution.recomputedStepIds,
      cachedStepIds: execution.cachedStepIds,
      bypassedStepIds: execution.bypassedStepIds,
      skippedStepIds: execution.skippedStepIds,
      errorStepIds: execution.errorStepIds,
    },
  };
}
