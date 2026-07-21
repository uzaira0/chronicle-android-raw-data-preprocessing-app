import Papa from "papaparse";
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
  type RustRuntimeExecution,
} from "@/lib/rustPipelineRuntime";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
  ProcessedFileResult,
  ProcessedOutputFileResult,
  ProgressEvent,
  ProgressStepKind,
  ReviewSummary,
  RustStageView,
  TimelineViewData,
} from "@/lib/types";
import type { ExecutionLedger } from "@/lib/pipelineGraph/executionRecords";

const CSV_MIME = "text/csv;charset=utf-8";
const PARQUET_MIME = "application/vnd.apache.parquet";
const SAV_MIME = "application/x-spss-sav";
const ARROW_MIME = "application/vnd.apache.arrow.file";
const PREPROCESSOR_VERSION = "1.0.0";

type SerializedVisualizationRow = {
  participantId: string;
  date: string;
  startTimestampNs: string | null;
  stopTimestampNs: string | null;
  eventTimestampNs: string;
  interactionType: string;
  broadAppCategory: string | null;
  appPackageName: string;
  applicationLabel: string;
  username: string;
  screenUsageEndReason: string | null;
};

type VisualizationData = {
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

function deriveOutputFileName(inputFileName: string, suffix: string): string {
  return inputFileName.replace(/\.csv$/i, "") + suffix;
}

function requiredArtifact(
  execution: RustRuntimeExecution,
  kind: string,
): Uint8Array {
  const bytes = execution.artifacts.get(kind);
  if (!bytes) throw new Error(`Rust runtime omitted required artifact: ${kind}`);
  return bytes;
}

function parseJsonArtifact<T>(
  execution: RustRuntimeExecution,
  kind: string,
): T {
  return JSON.parse(new TextDecoder().decode(requiredArtifact(execution, kind))) as T;
}

function previewRows(bytes: Uint8Array): string[][] {
  const parsed = Papa.parse<string[]>(new TextDecoder().decode(bytes), {
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(`Rust CSV preview parse failed: ${parsed.errors[0].message}`);
  }
  return parsed.data.slice(0, 51);
}

function csvRowCount(bytes: Uint8Array): number {
  const parsed = Papa.parse<string[]>(new TextDecoder().decode(bytes), {
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(`Rust CSV row-count parse failed: ${parsed.errors[0].message}`);
  }
  return Math.max(0, parsed.data.length - 1);
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
  const bytes = requiredArtifact(execution, artifactKind);
  outputs.push({
    kind,
    outputFileName: deriveOutputFileName(inputFileName, suffix),
    blob: new Blob([Uint8Array.from(bytes)], { type: CSV_MIME }),
    rowCount: rowCount ?? csvRowCount(bytes),
    previewRows: previewRows(bytes),
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
  const bytes = requiredArtifact(execution, artifactKind);
  outputs.push({
    kind,
    outputFileName: deriveOutputFileName(inputFileName, suffix),
    blob: new Blob([Uint8Array.from(bytes)], { type: mediaType }),
    rowCount,
    previewRows: [],
  });
}

function hydrateVisualizationRow(row: SerializedVisualizationRow): VisualizationRow {
  return {
    participant_id: row.participantId,
    date: row.date,
    start_timestamp_ns:
      row.startTimestampNs === null ? null : BigInt(row.startTimestampNs),
    stop_timestamp_ns:
      row.stopTimestampNs === null ? null : BigInt(row.stopTimestampNs),
    event_timestamp_ns: BigInt(row.eventTimestampNs),
    interaction_type: row.interactionType,
    broad_app_category: row.broadAppCategory,
    app_package_name: row.appPackageName,
    application_label: row.applicationLabel,
    username: row.username,
    screen_usage_end_reason: row.screenUsageEndReason,
  };
}

async function addRenderedViews(
  outputs: ProcessedOutputFileResult[],
  inputFileName: string,
  options: BrowserProcessingOptions,
  timezone: string,
  visualization: VisualizationData,
): Promise<TimelineViewData> {
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
  const appFilteredExcluded = options.processAppUsage
    ? buildAppTimelineViews(
        appPlotRows,
        timezone,
        options,
        PREPROCESSOR_VERSION,
        eventTimestamps,
        false,
      )
    : [];
  const appFilteredIncluded = options.processAppUsage
    ? buildAppTimelineViews(
        appPlotRows,
        timezone,
        options,
        PREPROCESSOR_VERSION,
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
        PREPROCESSOR_VERSION,
        eventTimestamps,
      )
    : [];

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
  if (options.enablePlotting && options.processAppUsage) {
    pushPlots(
      await generateAllPlots(
        appPlotRows,
        timezone,
        options,
        PREPROCESSOR_VERSION,
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
          PREPROCESSOR_VERSION,
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
          PREPROCESSOR_VERSION,
        ),
        (participantId) => ` ${participantId} App Usage Heatmap.png`,
      );
      if (options.exportPlotsAsSvg) {
        pushPlots(
          await generateAllHeatmapSvgs(
            appPlotRows,
            timezone,
            options,
            PREPROCESSOR_VERSION,
          ),
          (participantId) => ` ${participantId} App Usage Heatmap.svg`,
        );
      }
    }
  }
  if (options.enablePlotting && options.processScreenUsage) {
    pushPlots(
      await generateAllScreenPlots(
        screenPlotRows,
        timezone,
        PREPROCESSOR_VERSION,
        eventTimestamps,
      ),
      (participantId) => ` ${participantId} Screen Usage Plot.png`,
    );
    if (options.exportPlotsAsSvg) {
      pushPlots(
        await generateAllScreenPlotSvgs(
          screenPlotRows,
          timezone,
          PREPROCESSOR_VERSION,
          eventTimestamps,
        ),
        (participantId) => ` ${participantId} Screen Usage Plot.svg`,
      );
    }
  }
  if (options.enableInteractiveTimeline) {
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

export async function processRawCsvWithRustAuthority(
  inputFileName: string,
  csvBytes: Uint8Array,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  onProgress?: (event: ProgressEvent) => void,
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
  const visualization = parseJsonArtifact<VisualizationData>(
    execution,
    "visualization-data-json",
  );
  const timelineView = await addRenderedViews(
    outputs,
    inputFileName,
    options,
    manifest.processingSummary.timezone,
    visualization,
  );
  const reviewSummary = parseJsonArtifact<ReviewSummary>(
    execution,
    "review-summary-json",
  );
  const executionLedger = parseJsonArtifact<ExecutionLedger>(
    execution,
    "execution-ledger-json",
  );
  const rustStageView = parseJsonArtifact<RustStageView>(
    execution,
    "stage-view-json",
  );
  for (const stepKind of [
    "parse",
    "timezone",
    "filter",
    "screen",
    "matcher",
    "codebook",
    "enrich",
    "output",
  ] as const) {
    onProgress?.({
      type: "step",
      fileName: inputFileName,
      stepKind,
      percent: 1,
    });
  }
  const statuses = Object.fromEntries(
    manifest.nodeExecutions.map((node) => [node.node_id, node.status]),
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
    reviewSummary,
    executionLedger,
    rustStageView,
    graphReport: { statuses, errors: {} },
    rustRuntimeReceipt: {
      protocolVersion: "chronicle-preprocessing-runtime/v1",
      workspaceId: execution.workspaceId,
      workspaceRootDigest: manifest.workspaceRootDigest,
      previousWorkspaceRootDigest: manifest.previousWorkspaceRootDigest,
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
