/**
 * Shared type contracts for the pipeline graph: the run context, the support
 * data, and each execution unit's output shape.
 *
 * TYPE-ONLY module (every import is `import type`, fully erased at runtime)
 * so step modules, the step runner and graphDef can all depend on these
 * contracts without creating runtime import cycles.
 */

import type {
  applyTimezoneHandling,
  CanonicalRow,
  CodebookRecord,
  MatcherRunner,
  SplitterRunner,
} from "@/lib/browserPipeline";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  ProgressStepKind,
} from "@/lib/types";
import type { CreditResult } from "@/lib/stages/effectiveUsage";
import type { ObservationWindowResult } from "@/lib/stages/observationWindow";
import type { AttributionResult } from "@/lib/stages/attributePerson";
import type { ComplianceResult } from "@/lib/stages/scoreCompliance";
import type { DayCoverageResult } from "@/lib/stages/dayCoverage";
import type {
  EnrolledDevice,
  SharingEntry,
  StudyWindow,
  SurveyAnswer,
} from "@/lib/stages/studySupportFiles";
import type { StepExecutionRecord } from "@/lib/pipelineGraph/executionRecords";

export interface PipelineSupportData {
  filterMap: Map<string, Set<string>>;
  appsForcingScreenOpenMap: Map<string, string>;
  backgroundAppsSet: Set<string>;
  codebookMap: Map<string, CodebookRecord>;
  /** Study Inputs (Analyze tier); null = file not provided. */
  studyWindows: StudyWindow[] | null;
  sharingEntries: SharingEntry[] | null;
  surveyAnswers: SurveyAnswer[] | null;
  enrolledDevices: EnrolledDevice[] | null;
}

export interface PipelineCtx {
  csvText: string;
  options: BrowserProcessingOptions;
  runtime?: BrowserProcessingRuntime;
  support: PipelineSupportData;
  runMatcher: MatcherRunner;
  runSplitter: SplitterRunner;
  emit: (stepKind: ProgressStepKind, percent: number) => void;
  /**
   * Lineage sink: the step runner reports one StepExecutionRecord per
   * executed step here. Optional — steps themselves never call it, and
   * runs without a recorder behave identically (observation only).
   */
  stepRecorder?: (record: StepExecutionRecord) => void;
}

export interface ParseEventsOutput {
  rows: CanonicalRow[];
  availableTimezones: string[];
  originalRowCount: number;
}

export interface NormalizeTimezonesOutput {
  rows: CanonicalRow[];
  timezone: string;
  action: ReturnType<typeof applyTimezoneHandling>["action"];
  rowsBefore: number;
  rowsAfter: number;
  rowsRemoved: number;
}

export interface DedupAndOrderOutput {
  rows: CanonicalRow[];
  duplicateTimestampsCorrected: number;
  exactDuplicateRowsRemoved: number;
}

export interface AttributePersonOutput {
  rows: CanonicalRow[];
  /** Null when person attribution is off (pass-through). */
  report: AttributionResult["report"] | null;
}

export interface DayCoverageNodeOutput {
  rows: CanonicalRow[];
  coverage: DayCoverageResult | null;
}

export interface PipelineOutputs {
  /** Canonical post-policy events used by visualization/review projections. */
  policyRows: CanonicalRow[];
  appRows: CanonicalRow[];
  screenRows: CanonicalRow[];
  credited: CreditResult | null;
  windowReport: Pick<ObservationWindowResult, "droppedRows" | "participantsWithoutWindow"> | null;
  attribution: AttributionResult["report"] | null;
  coverage: DayCoverageResult | null;
  compliance: ComplianceResult | null;
}
