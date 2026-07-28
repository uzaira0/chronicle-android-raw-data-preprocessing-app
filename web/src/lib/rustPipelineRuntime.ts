/**
 * Browser transport and persistence boundary for the authoritative Rust/WASM
 * preprocessing runtime.
 */
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFile,
  BrowserSupportFiles,
  ReviewSummary,
  TimezoneAction,
} from "@/lib/types";
import type { RawFileInspection } from "@/lib/fileInspection";
import defaultAppCodebookUrl from "@/assets/defaults/unified_app_codebook.csv?url";
import defaultAppsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import defaultAppsForcingScreenOpenUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?url";
import defaultBackgroundAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?url";
import { fetchBundledAssetBytes } from "@/lib/bundledAssetLoader";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  collectRuntimeHistoryDigests,
  exportRuntimeClosure,
  garbageCollectRuntimeObjects,
  importRuntimeClosure,
  openOpfsWorkspace,
  persistRuntimeWorkspace,
  readRuntimeObject,
  recoverRuntimeWorkspace,
  recoverRuntimeWorkspaceHead,
  recoverRuntimeWorkspaceRoots,
  runtimeClosureWorkspaceId,
  type PersistedRuntimeArtifact,
  type RuntimeClosureInspection,
  type WorkspaceRootSlot,
} from "@/lib/opfsArtifactStore";

type KernelHandle = {
  readonly artifact_count: number;
  manifest_json(): string;
  artifact_metadata_json(index: number): string;
  take_artifact_bytes(index: number): Uint8Array;
  free(): void;
};

type RuntimeSupportFilesHandle = {
  put(role: string, bytes: Uint8Array): void;
  put_with_name(role: string, name: string, bytes: Uint8Array): void;
  free(): void;
};

type KernelModule = {
  default(input?: {
    module_or_path: WebAssembly.Module;
  }): Promise<unknown>;
  runtime_version(): string;
  implementation_build_digest(): string;
  build_environment_digest(): string;
  runtime_identity_json(): string;
  pipeline_step_contract_json(): string;
  plan_stage_view_json(optionsJson: string): string;
  RuntimeSupportFiles: new () => RuntimeSupportFilesHandle;
  discover_timezones_v2(csvBytes: Uint8Array): string[];
  inspect_raw_file_v1(
    csvBytes: Uint8Array,
    fileName: string,
    sizeBytes: number,
  ): string;
  execute_workspace(
    requestJson: string,
    csvBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): KernelHandle;
  execute_workspace_with_review_base(
    requestJson: string,
    csvBytes: Uint8Array,
    reviewBaseBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): KernelHandle;
  execute_workspace_with_review_bases(
    requestJson: string,
    csvBytes: Uint8Array,
    reviewBaseBytes: Uint8Array,
    reconstructionBaseBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): KernelHandle;
  verify_evidence_journal_cbor(bytes: Uint8Array): number;
};

type RuntimeArtifactMetadata = {
  artifactId: string;
  kind: string;
  mediaType: string;
  digest: string;
  size: number;
  derivedFrom: string[];
  rowCount?: number;
  previewRows?: string[][];
};

type RuntimeCheckpoint = {
  protocolVersion: string;
  nodeId: string;
  rowMembershipDigest: string;
  rowOrderDigest: string;
  temporalStateDigest: string;
  classificationDigest: string;
  payloadDigest: string;
  schemaDigest: string;
  terminalDigest: string;
};

type RuntimeMaterializationState =
  "open" | "ready" | "satisfied" | "blocked" | "invalid" | "not_applicable";

type RuntimeQualificationTrace = {
  trace_id: string;
  candidate_id: string;
  candidate_revision: number;
  artifact_digest: string;
  qualifiers_digest: string;
  asserted_role_ids: string[];
  selected_role_id: string | null;
  decision: "accepted" | "rejected" | "ambiguous";
  rule_evaluations: Array<{
    rule_id: string;
    passed: boolean;
    expected: string;
    observed: string;
  }>;
  reason_id: string;
};

type RuntimeRequirementTrace = {
  trace_id: string;
  role_id: string;
  required: boolean;
  unconditional: boolean;
  condition_id: string | null;
  condition_result: boolean | null;
  candidate_trace_ids: string[];
  accepted_assignment_ids: string[];
  state: RuntimeMaterializationState;
  reason_id: string;
};

type RuntimeOpenObligation = {
  obligation_id: string;
  role_id: string;
  node_id: string | null;
  state: RuntimeMaterializationState;
  reason_id: string;
};

type RuntimeStateReason = {
  reason_id: string;
  subject_id: string;
  state: RuntimeMaterializationState;
  source_id: string;
  message: string;
};

export type RuntimeManifest = {
  protocolVersion: "chronicle-preprocessing-runtime/v1";
  preprocessorVersion: string;
  requestId: string;
  command: "ExecuteWorkspace";
  implementation: string;
  scope: string;
  counts: { original: number; processed: number; app: number; screen: number };
  input: {
    artifact_id: string;
    digest: string;
    media_type: string;
    size: number;
    derived_from: string[];
    qualifiers: Record<string, string>;
  };
  workspaceRootDigest: string;
  workspaceId: string;
  planDigest: string;
  implementationDigest: string;
  buildEnvironmentDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  runtimeAuthorityDigest: string;
  productContractDigest: string;
  dependencyCertificateDigest: string;
  dependencyCacheDecision: {
    mode: "certified_narrow" | "conservative_full";
    certificate_digest: string | null;
    binding_surface_digest: string | null;
    empirical_evidence_current: boolean;
    reasons: string[];
  };
  qualificationTraces: RuntimeQualificationTrace[];
  requirementTraces: RuntimeRequirementTrace[];
  openObligations: RuntimeOpenObligation[];
  stateReasons: RuntimeStateReason[];
  journalDigest: string;
  artifacts: RuntimeArtifactMetadata[];
  previousWorkspaceRootDigest: string | null;
  roleAssignments: Array<{
    assignment_id: string;
    role_id: string;
    artifact: RuntimeManifest["input"];
    qualifiers: Record<string, string>;
    revision: number;
  }>;
  nodeExecutions: Array<{
    node_id: string;
    capability_id: string;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
    input_key: string;
    output: RuntimeManifest["input"] | null;
    reason_id: string;
  }>;
  stepExecutions: Array<{
    step_id: string;
    unit_id: string;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
    input_key: string;
    output_digest: string;
    reason_id: string;
  }>;
  processingSummary: {
    availableTimezones: string[];
    timezone: string;
    timezoneAction:
      | "none"
      | "filtered_to_selected"
      | "converted_to_selected"
      | "filtered_to_primary"
      | "converted_to_primary";
    rowsBeforeTimezoneHandling: number;
    rowsAfterTimezoneHandling: number;
    rowsRemovedByTimezone: number;
    timezoneRetainedSourceRowsDigest: string;
    timezoneStageDigest: string;
    logicalStageDigests: Record<string, string>;
    logicalStageCheckpoints: Record<string, RuntimeCheckpoint>;
    pipelineStepDigests: Record<string, string>;
    pipelineStepCheckpoints: Record<string, RuntimeCheckpoint>;
    publishedOutputsDigest: string;
    provenanceDigest: string;
    duplicateTimestampsCorrected: number;
    exactDuplicateRowsRemoved: number;
  };
};

type JsonObject = Record<string, unknown>;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BLAKE3_PATTERN = /^blake3:[0-9a-f]{64}$/;
const EXECUTION_STATUSES = new Set([
  "cached",
  "recomputed",
  "error",
  "skipped",
  "bypassed",
]);
const TIMEZONE_ACTIONS = new Set([
  "none",
  "filtered_to_selected",
  "converted_to_selected",
  "filtered_to_primary",
  "converted_to_primary",
]);
const MATERIALIZATION_STATES = new Set([
  "open",
  "ready",
  "satisfied",
  "blocked",
  "invalid",
  "not_applicable",
]);

function contractError(path: string, expectation: string): never {
  throw new Error(
    `runtime manifest contract violation at ${path}: ${expectation}`,
  );
}

function objectAt(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    contractError(path, "expected an object");
  }
  return value as JsonObject;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) contractError(path, "expected an array");
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    contractError(path, "expected a non-empty string");
  }
  return value;
}

function nullableStringAt(value: unknown, path: string): string | null {
  return value === null ? null : stringAt(value, path);
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") contractError(path, "expected a boolean");
  return value;
}

function nullableBooleanAt(value: unknown, path: string): boolean | null {
  return value === null ? null : booleanAt(value, path);
}

function integerAt(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    contractError(path, "expected a non-negative safe integer");
  }
  return value as number;
}

function digestAt(value: unknown, path: string): string {
  const digest = stringAt(value, path);
  if (!SHA256_PATTERN.test(digest)) {
    contractError(path, "expected a lowercase sha256 digest");
  }
  return digest;
}

function checkpointComponentDigestAt(value: unknown, path: string): string {
  const digest = stringAt(value, path);
  if (!BLAKE3_PATTERN.test(digest)) {
    contractError(path, "expected a lowercase blake3 digest");
  }
  return digest;
}

function nullableDigestAt(value: unknown, path: string): string | null {
  return value === null ? null : digestAt(value, path);
}

function checkpointDomainAt(
  digestsValue: unknown,
  checkpointsValue: unknown,
  path: string,
  expectedCount: number,
): {
  digests: Record<string, string>;
  checkpoints: Record<string, RuntimeCheckpoint>;
} {
  const digests = Object.fromEntries(
    Object.entries(objectAt(digestsValue, `${path}Digests`)).map(
      ([id, digest]) => [id, digestAt(digest, `${path}Digests.${id}`)],
    ),
  );
  const checkpoints = Object.fromEntries(
    Object.entries(objectAt(checkpointsValue, `${path}Checkpoints`)).map(
      ([id, value]) => {
        const checkpointPath = `${path}Checkpoints.${id}`;
        const checkpoint = objectAt(value, checkpointPath);
        const decoded: RuntimeCheckpoint = {
          protocolVersion: stringAt(
            checkpoint.protocolVersion,
            `${checkpointPath}.protocolVersion`,
          ),
          nodeId: stringAt(checkpoint.nodeId, `${checkpointPath}.nodeId`),
          rowMembershipDigest: checkpointComponentDigestAt(
            checkpoint.rowMembershipDigest,
            `${checkpointPath}.rowMembershipDigest`,
          ),
          rowOrderDigest: checkpointComponentDigestAt(
            checkpoint.rowOrderDigest,
            `${checkpointPath}.rowOrderDigest`,
          ),
          temporalStateDigest: checkpointComponentDigestAt(
            checkpoint.temporalStateDigest,
            `${checkpointPath}.temporalStateDigest`,
          ),
          classificationDigest: checkpointComponentDigestAt(
            checkpoint.classificationDigest,
            `${checkpointPath}.classificationDigest`,
          ),
          payloadDigest: checkpointComponentDigestAt(
            checkpoint.payloadDigest,
            `${checkpointPath}.payloadDigest`,
          ),
          schemaDigest: checkpointComponentDigestAt(
            checkpoint.schemaDigest,
            `${checkpointPath}.schemaDigest`,
          ),
          terminalDigest: digestAt(
            checkpoint.terminalDigest,
            `${checkpointPath}.terminalDigest`,
          ),
        };
        if (
          decoded.protocolVersion !== "chronicle-logical-stage-checkpoint/v3"
        ) {
          contractError(
            `${checkpointPath}.protocolVersion`,
            "unsupported checkpoint protocol",
          );
        }
        if (decoded.nodeId !== id || decoded.terminalDigest !== digests[id]) {
          contractError(
            checkpointPath,
            "checkpoint identity or terminal digest does not match its domain",
          );
        }
        return [id, decoded];
      },
    ),
  );
  const digestIds = Object.keys(digests).sort();
  const checkpointIds = Object.keys(checkpoints).sort();
  if (
    digestIds.length !== expectedCount ||
    JSON.stringify(digestIds) !== JSON.stringify(checkpointIds)
  ) {
    contractError(
      `${path}Checkpoints`,
      `digest and checkpoint domains must contain the same ${expectedCount} identities`,
    );
  }
  return { digests, checkpoints };
}

function stringArrayAt(value: unknown, path: string): string[] {
  return arrayAt(value, path).map((item, index) =>
    stringAt(item, `${path}[${index}]`),
  );
}

function stringMapAt(value: unknown, path: string): Record<string, string> {
  const object = objectAt(value, path);
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      key,
      stringAt(item, `${path}.${key}`),
    ]),
  );
}

function artifactRefAt(value: unknown, path: string): RuntimeManifest["input"] {
  const artifact = objectAt(value, path);
  return {
    artifact_id: stringAt(artifact.artifact_id, `${path}.artifact_id`),
    digest: digestAt(artifact.digest, `${path}.digest`),
    media_type: stringAt(artifact.media_type, `${path}.media_type`),
    size: integerAt(artifact.size, `${path}.size`),
    derived_from: stringArrayAt(artifact.derived_from, `${path}.derived_from`),
    qualifiers: stringMapAt(artifact.qualifiers, `${path}.qualifiers`),
  };
}

function artifactMetadataAt(
  value: unknown,
  path: string,
): RuntimeArtifactMetadata {
  const artifact = objectAt(value, path);
  const rowCount = artifact.rowCount;
  const previewRows = artifact.previewRows;
  return {
    artifactId: stringAt(artifact.artifactId, `${path}.artifactId`),
    kind: stringAt(artifact.kind, `${path}.kind`),
    mediaType: stringAt(artifact.mediaType, `${path}.mediaType`),
    digest: digestAt(artifact.digest, `${path}.digest`),
    size: integerAt(artifact.size, `${path}.size`),
    derivedFrom: stringArrayAt(artifact.derivedFrom, `${path}.derivedFrom`),
    ...(rowCount === undefined
      ? {}
      : { rowCount: integerAt(rowCount, `${path}.rowCount`) }),
    ...(previewRows === undefined
      ? {}
      : {
          previewRows: arrayAt(previewRows, `${path}.previewRows`).map(
            (row, index) =>
              arrayAt(row, `${path}.previewRows[${index}]`).map(
                (cell, cellIndex) => {
                  if (typeof cell !== "string") {
                    contractError(
                      `${path}.previewRows[${index}][${cellIndex}]`,
                      "expected a string",
                    );
                  }
                  return cell;
                },
              ),
          ),
        }),
  };
}

function materializationStateAt(
  value: unknown,
  path: string,
): RuntimeMaterializationState {
  const state = stringAt(value, path);
  if (!MATERIALIZATION_STATES.has(state)) {
    contractError(path, "unknown materialization state");
  }
  return state as RuntimeMaterializationState;
}

function qualificationTraceAt(
  value: unknown,
  path: string,
): RuntimeQualificationTrace {
  const trace = objectAt(value, path);
  const decision = stringAt(trace.decision, `${path}.decision`);
  if (!["accepted", "rejected", "ambiguous"].includes(decision)) {
    contractError(`${path}.decision`, "unknown qualification decision");
  }
  return {
    trace_id: stringAt(trace.trace_id, `${path}.trace_id`),
    candidate_id: stringAt(trace.candidate_id, `${path}.candidate_id`),
    candidate_revision: integerAt(
      trace.candidate_revision,
      `${path}.candidate_revision`,
    ),
    artifact_digest: digestAt(trace.artifact_digest, `${path}.artifact_digest`),
    qualifiers_digest: digestAt(
      trace.qualifiers_digest,
      `${path}.qualifiers_digest`,
    ),
    asserted_role_ids: stringArrayAt(
      trace.asserted_role_ids,
      `${path}.asserted_role_ids`,
    ),
    selected_role_id: nullableStringAt(
      trace.selected_role_id,
      `${path}.selected_role_id`,
    ),
    decision: decision as RuntimeQualificationTrace["decision"],
    rule_evaluations: arrayAt(
      trace.rule_evaluations,
      `${path}.rule_evaluations`,
    ).map((value, index) => {
      const rulePath = `${path}.rule_evaluations[${index}]`;
      const rule = objectAt(value, rulePath);
      return {
        rule_id: stringAt(rule.rule_id, `${rulePath}.rule_id`),
        passed: booleanAt(rule.passed, `${rulePath}.passed`),
        expected: stringAt(rule.expected, `${rulePath}.expected`),
        observed: stringAt(rule.observed, `${rulePath}.observed`),
      };
    }),
    reason_id: stringAt(trace.reason_id, `${path}.reason_id`),
  };
}

function requirementTraceAt(
  value: unknown,
  path: string,
): RuntimeRequirementTrace {
  const trace = objectAt(value, path);
  return {
    trace_id: stringAt(trace.trace_id, `${path}.trace_id`),
    role_id: stringAt(trace.role_id, `${path}.role_id`),
    required: booleanAt(trace.required, `${path}.required`),
    unconditional: booleanAt(trace.unconditional, `${path}.unconditional`),
    condition_id: nullableStringAt(trace.condition_id, `${path}.condition_id`),
    condition_result: nullableBooleanAt(
      trace.condition_result,
      `${path}.condition_result`,
    ),
    candidate_trace_ids: stringArrayAt(
      trace.candidate_trace_ids,
      `${path}.candidate_trace_ids`,
    ),
    accepted_assignment_ids: stringArrayAt(
      trace.accepted_assignment_ids,
      `${path}.accepted_assignment_ids`,
    ),
    state: materializationStateAt(trace.state, `${path}.state`),
    reason_id: stringAt(trace.reason_id, `${path}.reason_id`),
  };
}

function openObligationAt(value: unknown, path: string): RuntimeOpenObligation {
  const obligation = objectAt(value, path);
  return {
    obligation_id: stringAt(obligation.obligation_id, `${path}.obligation_id`),
    role_id: stringAt(obligation.role_id, `${path}.role_id`),
    node_id: nullableStringAt(obligation.node_id, `${path}.node_id`),
    state: materializationStateAt(obligation.state, `${path}.state`),
    reason_id: stringAt(obligation.reason_id, `${path}.reason_id`),
  };
}

function stateReasonAt(value: unknown, path: string): RuntimeStateReason {
  const reason = objectAt(value, path);
  return {
    reason_id: stringAt(reason.reason_id, `${path}.reason_id`),
    subject_id: stringAt(reason.subject_id, `${path}.subject_id`),
    state: materializationStateAt(reason.state, `${path}.state`),
    source_id: stringAt(reason.source_id, `${path}.source_id`),
    message: stringAt(reason.message, `${path}.message`),
  };
}

/**
 * Fail-closed decoder for the product-owned Rust/WASM execution contract.
 * Unknown fields remain forward-transportable, but every field consumed by the
 * browser and every identity/invalidation field is validated before use.
 */
export function decodeRuntimeManifest(value: unknown): RuntimeManifest {
  const manifest = objectAt(value, "manifest");
  if (manifest.protocolVersion !== "chronicle-preprocessing-runtime/v1") {
    contractError("manifest.protocolVersion", "unsupported protocol version");
  }
  if (manifest.command !== "ExecuteWorkspace") {
    contractError("manifest.command", "expected ExecuteWorkspace");
  }
  const cache = objectAt(
    manifest.dependencyCacheDecision,
    "manifest.dependencyCacheDecision",
  );
  const mode = stringAt(cache.mode, "manifest.dependencyCacheDecision.mode");
  if (mode !== "certified_narrow" && mode !== "conservative_full") {
    contractError(
      "manifest.dependencyCacheDecision.mode",
      "expected certified_narrow or conservative_full",
    );
  }
  const cacheDecision = {
    mode,
    certificate_digest: nullableDigestAt(
      cache.certificate_digest,
      "manifest.dependencyCacheDecision.certificate_digest",
    ),
    binding_surface_digest: nullableDigestAt(
      cache.binding_surface_digest,
      "manifest.dependencyCacheDecision.binding_surface_digest",
    ),
    empirical_evidence_current: booleanAt(
      cache.empirical_evidence_current,
      "manifest.dependencyCacheDecision.empirical_evidence_current",
    ),
    reasons: stringArrayAt(
      cache.reasons,
      "manifest.dependencyCacheDecision.reasons",
    ),
  } satisfies RuntimeManifest["dependencyCacheDecision"];
  if (
    mode === "certified_narrow" &&
    (!cacheDecision.certificate_digest || !cacheDecision.binding_surface_digest)
  ) {
    contractError(
      "manifest.dependencyCacheDecision",
      "certified_narrow requires certificate and binding-surface identity",
    );
  }

  const roleAssignments = arrayAt(
    manifest.roleAssignments,
    "manifest.roleAssignments",
  ).map((value, index) => {
    const path = `manifest.roleAssignments[${index}]`;
    const assignment = objectAt(value, path);
    const qualifiers = stringMapAt(assignment.qualifiers, `${path}.qualifiers`);
    return {
      assignment_id: stringAt(
        assignment.assignment_id,
        `${path}.assignment_id`,
      ),
      role_id: stringAt(assignment.role_id, `${path}.role_id`),
      artifact: artifactRefAt(assignment.artifact, `${path}.artifact`),
      qualifiers,
      revision: integerAt(assignment.revision, `${path}.revision`),
    };
  });
  const nodeExecutions = arrayAt(
    manifest.nodeExecutions,
    "manifest.nodeExecutions",
  ).map((value, index) => {
    const path = `manifest.nodeExecutions[${index}]`;
    const execution = objectAt(value, path);
    const status = stringAt(execution.status, `${path}.status`);
    if (!EXECUTION_STATUSES.has(status)) {
      contractError(`${path}.status`, "unknown execution status");
    }
    return {
      node_id: stringAt(execution.node_id, `${path}.node_id`),
      capability_id: stringAt(execution.capability_id, `${path}.capability_id`),
      status: status as RuntimeManifest["nodeExecutions"][number]["status"],
      input_key: digestAt(execution.input_key, `${path}.input_key`),
      output:
        execution.output === null
          ? null
          : artifactRefAt(execution.output, `${path}.output`),
      reason_id: stringAt(execution.reason_id, `${path}.reason_id`),
    };
  });
  const stepExecutions = arrayAt(
    manifest.stepExecutions,
    "manifest.stepExecutions",
  ).map((value, index) => {
    const path = `manifest.stepExecutions[${index}]`;
    const execution = objectAt(value, path);
    const status = stringAt(execution.status, `${path}.status`);
    if (!EXECUTION_STATUSES.has(status)) {
      contractError(`${path}.status`, "unknown execution status");
    }
    return {
      step_id: stringAt(execution.step_id, `${path}.step_id`),
      unit_id: stringAt(execution.unit_id, `${path}.unit_id`),
      status: status as RuntimeManifest["stepExecutions"][number]["status"],
      input_key: digestAt(execution.input_key, `${path}.input_key`),
      output_digest: digestAt(execution.output_digest, `${path}.output_digest`),
      reason_id: digestAt(execution.reason_id, `${path}.reason_id`),
    };
  });
  if (
    stepExecutions.length !== 55 ||
    new Set(stepExecutions.map((execution) => execution.step_id)).size !== 55
  ) {
    contractError(
      "manifest.stepExecutions",
      "expected exactly 55 unique Rust step executions",
    );
  }

  const countsSource = objectAt(manifest.counts, "manifest.counts");
  const counts = {
    original: integerAt(countsSource.original, "manifest.counts.original"),
    processed: integerAt(countsSource.processed, "manifest.counts.processed"),
    app: integerAt(countsSource.app, "manifest.counts.app"),
    screen: integerAt(countsSource.screen, "manifest.counts.screen"),
  };
  const summary = objectAt(
    manifest.processingSummary,
    "manifest.processingSummary",
  );
  const timezoneAction = stringAt(
    summary.timezoneAction,
    "manifest.processingSummary.timezoneAction",
  );
  if (!TIMEZONE_ACTIONS.has(timezoneAction)) {
    contractError(
      "manifest.processingSummary.timezoneAction",
      "unknown timezone action",
    );
  }
  const logicalStages = checkpointDomainAt(
    summary.logicalStageDigests,
    summary.logicalStageCheckpoints,
    "manifest.processingSummary.logicalStage",
    15,
  );
  const pipelineSteps = checkpointDomainAt(
    summary.pipelineStepDigests,
    summary.pipelineStepCheckpoints,
    "manifest.processingSummary.pipelineStep",
    55,
  );
  for (const execution of stepExecutions) {
    if (pipelineSteps.digests[execution.step_id] !== execution.output_digest) {
      contractError(
        `manifest.stepExecutions.${execution.step_id}`,
        "step execution output does not match its Rust checkpoint",
      );
    }
  }
  const rowsBeforeTimezoneHandling = integerAt(
    summary.rowsBeforeTimezoneHandling,
    "manifest.processingSummary.rowsBeforeTimezoneHandling",
  );
  const rowsAfterTimezoneHandling = integerAt(
    summary.rowsAfterTimezoneHandling,
    "manifest.processingSummary.rowsAfterTimezoneHandling",
  );
  const rowsRemovedByTimezone = integerAt(
    summary.rowsRemovedByTimezone,
    "manifest.processingSummary.rowsRemovedByTimezone",
  );
  if (
    rowsBeforeTimezoneHandling - rowsRemovedByTimezone !==
    rowsAfterTimezoneHandling
  ) {
    contractError(
      "manifest.processingSummary",
      "timezone row accounting is inconsistent",
    );
  }

  const artifacts = arrayAt(manifest.artifacts, "manifest.artifacts").map(
    (value, index) => artifactMetadataAt(value, `manifest.artifacts[${index}]`),
  );
  for (const [field, values] of [
    ["artifact kind", artifacts.map(({ kind }) => kind)],
    ["artifact id", artifacts.map(({ artifactId }) => artifactId)],
    ["role", roleAssignments.map(({ role_id }) => role_id)],
    ["node", nodeExecutions.map(({ node_id }) => node_id)],
  ] as const) {
    if (new Set(values).size !== values.length) {
      contractError("manifest", `duplicate ${field}`);
    }
  }

  const dependencyCertificateDigest = digestAt(
    manifest.dependencyCertificateDigest,
    "manifest.dependencyCertificateDigest",
  );
  if (
    cacheDecision.certificate_digest !== null &&
    cacheDecision.certificate_digest !== dependencyCertificateDigest
  ) {
    contractError(
      "manifest.dependencyCacheDecision.certificate_digest",
      "does not match manifest dependency certificate",
    );
  }

  return {
    protocolVersion: "chronicle-preprocessing-runtime/v1",
    preprocessorVersion: stringAt(
      manifest.preprocessorVersion,
      "manifest.preprocessorVersion",
    ),
    requestId: stringAt(manifest.requestId, "manifest.requestId"),
    command: "ExecuteWorkspace",
    implementation: stringAt(
      manifest.implementation,
      "manifest.implementation",
    ),
    scope: stringAt(manifest.scope, "manifest.scope"),
    counts,
    input: artifactRefAt(manifest.input, "manifest.input"),
    workspaceRootDigest: digestAt(
      manifest.workspaceRootDigest,
      "manifest.workspaceRootDigest",
    ),
    workspaceId: digestAt(manifest.workspaceId, "manifest.workspaceId"),
    planDigest: digestAt(manifest.planDigest, "manifest.planDigest"),
    implementationDigest: digestAt(
      manifest.implementationDigest,
      "manifest.implementationDigest",
    ),
    buildEnvironmentDigest: digestAt(
      manifest.buildEnvironmentDigest,
      "manifest.buildEnvironmentDigest",
    ),
    profileDigest: digestAt(manifest.profileDigest, "manifest.profileDigest"),
    profileLockDigest: digestAt(
      manifest.profileLockDigest,
      "manifest.profileLockDigest",
    ),
    runtimeAuthorityDigest: digestAt(
      manifest.runtimeAuthorityDigest,
      "manifest.runtimeAuthorityDigest",
    ),
    productContractDigest: digestAt(
      manifest.productContractDigest,
      "manifest.productContractDigest",
    ),
    dependencyCertificateDigest,
    dependencyCacheDecision: cacheDecision,
    qualificationTraces: arrayAt(
      manifest.qualificationTraces,
      "manifest.qualificationTraces",
    ).map((value, index) =>
      qualificationTraceAt(value, `manifest.qualificationTraces[${index}]`),
    ),
    requirementTraces: arrayAt(
      manifest.requirementTraces,
      "manifest.requirementTraces",
    ).map((value, index) =>
      requirementTraceAt(value, `manifest.requirementTraces[${index}]`),
    ),
    openObligations: arrayAt(
      manifest.openObligations,
      "manifest.openObligations",
    ).map((value, index) =>
      openObligationAt(value, `manifest.openObligations[${index}]`),
    ),
    stateReasons: arrayAt(manifest.stateReasons, "manifest.stateReasons").map(
      (value, index) => stateReasonAt(value, `manifest.stateReasons[${index}]`),
    ),
    journalDigest: digestAt(manifest.journalDigest, "manifest.journalDigest"),
    artifacts,
    previousWorkspaceRootDigest: nullableDigestAt(
      manifest.previousWorkspaceRootDigest,
      "manifest.previousWorkspaceRootDigest",
    ),
    roleAssignments,
    nodeExecutions,
    stepExecutions,
    processingSummary: {
      availableTimezones: stringArrayAt(
        summary.availableTimezones,
        "manifest.processingSummary.availableTimezones",
      ),
      timezone: stringAt(
        summary.timezone,
        "manifest.processingSummary.timezone",
      ),
      timezoneAction:
        timezoneAction as RuntimeManifest["processingSummary"]["timezoneAction"],
      rowsBeforeTimezoneHandling,
      rowsAfterTimezoneHandling,
      rowsRemovedByTimezone,
      timezoneRetainedSourceRowsDigest: digestAt(
        summary.timezoneRetainedSourceRowsDigest,
        "manifest.processingSummary.timezoneRetainedSourceRowsDigest",
      ),
      timezoneStageDigest: digestAt(
        summary.timezoneStageDigest,
        "manifest.processingSummary.timezoneStageDigest",
      ),
      logicalStageDigests: logicalStages.digests,
      logicalStageCheckpoints: logicalStages.checkpoints,
      pipelineStepDigests: pipelineSteps.digests,
      pipelineStepCheckpoints: pipelineSteps.checkpoints,
      publishedOutputsDigest: digestAt(
        summary.publishedOutputsDigest,
        "manifest.processingSummary.publishedOutputsDigest",
      ),
      provenanceDigest: digestAt(
        summary.provenanceDigest,
        "manifest.processingSummary.provenanceDigest",
      ),
      duplicateTimestampsCorrected: integerAt(
        summary.duplicateTimestampsCorrected,
        "manifest.processingSummary.duplicateTimestampsCorrected",
      ),
      exactDuplicateRowsRemoved: integerAt(
        summary.exactDuplicateRowsRemoved,
        "manifest.processingSummary.exactDuplicateRowsRemoved",
      ),
    },
  };
}

export function verifyRuntimeArtifactCatalog(
  manifest: RuntimeManifest,
  exposedArtifacts: readonly RuntimeArtifactMetadata[],
): void {
  const exposedByKind = new Map(
    exposedArtifacts.map((metadata) => [metadata.kind, metadata]),
  );
  if (
    exposedByKind.size !== exposedArtifacts.length ||
    manifest.artifacts.length !== exposedByKind.size
  ) {
    throw new Error("runtime manifest artifact catalog length mismatch");
  }
  for (const metadata of manifest.artifacts) {
    const exposed = exposedByKind.get(metadata.kind);
    if (!exposed || canonicalJson(exposed) !== canonicalJson(metadata)) {
      throw new Error(
        `runtime manifest artifact catalog mismatch: ${metadata.kind}`,
      );
    }
  }
  const manifestArtifactDigests = new Set(
    manifest.artifacts.map(({ digest }) => digest),
  );
  if (
    !manifestArtifactDigests.has(manifest.journalDigest) ||
    !manifestArtifactDigests.has(manifest.dependencyCertificateDigest)
  ) {
    throw new Error(
      "runtime manifest artifact catalog omits evidence or dependency certificate",
    );
  }
}

export type RustRuntimeExecution = {
  workspaceId: string;
  manifestJson: string;
  manifest: RuntimeManifest;
  artifacts: Map<string, Uint8Array>;
  persistedWorkspace?: WorkspaceRootSlot;
};

export type RustReviewExecution = {
  workspaceId: string;
  previousWorkspaceRootDigest: string | null;
  manifestJson: string;
  inputDigest: string;
  optionsDigest: string;
  implementationDigest: string;
  buildEnvironmentDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  productContractDigest: string;
  dependencyCertificateDigest: string;
  comparisonDigest: string;
  reviewSummaryDigest: string;
  counts: { original: number; processed: number; app: number; screen: number };
  availableTimezones: string[];
  timezone: string;
  timezoneAction: TimezoneAction;
  rowsBeforeTimezoneHandling: number;
  rowsAfterTimezoneHandling: number;
  rowsRemovedByTimezone: number;
  duplicateTimestampsCorrected: number;
  exactDuplicateRowsRemoved: number;
  cacheSources: Array<
    | "salsa-memory"
    | "verified-review-base"
    | "verified-reconstruction-base"
  >;
  recomputedStepIds: string[];
  cachedStepIds: string[];
  bypassedStepIds: string[];
  skippedStepIds: string[];
  errorStepIds: string[];
  reviewSummary: ReviewSummary;
};

function decodeReviewRuntimeManifest(
  value: unknown,
): Omit<RustReviewExecution, "manifestJson" | "reviewSummary"> {
  const manifest = objectAt(value, "reviewManifest");
  if (manifest.protocolVersion !== "chronicle-preprocessing-runtime/v1") {
    contractError(
      "reviewManifest.protocolVersion",
      "unsupported protocol version",
    );
  }
  if (manifest.command !== "QueryReview") {
    contractError("reviewManifest.command", "expected QueryReview");
  }
  const timezoneAction = stringAt(
    manifest.timezoneAction,
    "reviewManifest.timezoneAction",
  );
  if (!TIMEZONE_ACTIONS.has(timezoneAction)) {
    contractError("reviewManifest.timezoneAction", "unknown timezone action");
  }
  const countsValue = objectAt(manifest.counts, "reviewManifest.counts");
  const steps = arrayAt(
    manifest.stepExecutions,
    "reviewManifest.stepExecutions",
  ).map((value, index) => {
    const path = `reviewManifest.stepExecutions[${index}]`;
    const step = objectAt(value, path);
    const status = stringAt(step.status, `${path}.status`);
    if (!EXECUTION_STATUSES.has(status)) {
      contractError(`${path}.status`, "unknown execution status");
    }
    return { id: stringAt(step.step_id, `${path}.step_id`), status };
  });
  if (steps.length !== 55 || new Set(steps.map(({ id }) => id)).size !== 55) {
    contractError(
      "reviewManifest.stepExecutions",
      "expected exactly 55 unique Rust step executions",
    );
  }
  const cacheSources = stringArrayAt(
    manifest.cacheSources,
    "reviewManifest.cacheSources",
  );
  const supportedCacheSources = new Set([
    "salsa-memory",
    "verified-review-base",
    "verified-reconstruction-base",
  ]);
  if (
    new Set(cacheSources).size !== cacheSources.length ||
    cacheSources.some((source) => !supportedCacheSources.has(source))
  ) {
    contractError(
      "reviewManifest.cacheSources",
      "unknown or duplicate cache source",
    );
  }
  return {
    workspaceId: digestAt(manifest.workspaceId, "reviewManifest.workspaceId"),
    previousWorkspaceRootDigest: nullableDigestAt(
      manifest.previousWorkspaceRootDigest,
      "reviewManifest.previousWorkspaceRootDigest",
    ),
    inputDigest: digestAt(manifest.inputDigest, "reviewManifest.inputDigest"),
    optionsDigest: digestAt(
      manifest.optionsDigest,
      "reviewManifest.optionsDigest",
    ),
    implementationDigest: digestAt(
      manifest.implementationDigest,
      "reviewManifest.implementationDigest",
    ),
    buildEnvironmentDigest: digestAt(
      manifest.buildEnvironmentDigest,
      "reviewManifest.buildEnvironmentDigest",
    ),
    planDigest: digestAt(manifest.planDigest, "reviewManifest.planDigest"),
    profileDigest: digestAt(
      manifest.profileDigest,
      "reviewManifest.profileDigest",
    ),
    profileLockDigest: digestAt(
      manifest.profileLockDigest,
      "reviewManifest.profileLockDigest",
    ),
    productContractDigest: digestAt(
      manifest.productContractDigest,
      "reviewManifest.productContractDigest",
    ),
    dependencyCertificateDigest: digestAt(
      manifest.dependencyCertificateDigest,
      "reviewManifest.dependencyCertificateDigest",
    ),
    comparisonDigest: digestAt(
      manifest.comparisonDigest,
      "reviewManifest.comparisonDigest",
    ),
    reviewSummaryDigest: digestAt(
      manifest.reviewSummaryDigest,
      "reviewManifest.reviewSummaryDigest",
    ),
    counts: {
      original: integerAt(
        countsValue.original,
        "reviewManifest.counts.original",
      ),
      processed: integerAt(
        countsValue.processed,
        "reviewManifest.counts.processed",
      ),
      app: integerAt(countsValue.app, "reviewManifest.counts.app"),
      screen: integerAt(countsValue.screen, "reviewManifest.counts.screen"),
    },
    availableTimezones: stringArrayAt(
      manifest.availableTimezones,
      "reviewManifest.availableTimezones",
    ),
    timezone: stringAt(manifest.timezone, "reviewManifest.timezone"),
    timezoneAction: timezoneAction as TimezoneAction,
    rowsBeforeTimezoneHandling: integerAt(
      manifest.rowsBeforeTimezoneHandling,
      "reviewManifest.rowsBeforeTimezoneHandling",
    ),
    rowsAfterTimezoneHandling: integerAt(
      manifest.rowsAfterTimezoneHandling,
      "reviewManifest.rowsAfterTimezoneHandling",
    ),
    rowsRemovedByTimezone: integerAt(
      manifest.rowsRemovedByTimezone,
      "reviewManifest.rowsRemovedByTimezone",
    ),
    duplicateTimestampsCorrected: integerAt(
      manifest.duplicateTimestampsCorrected,
      "reviewManifest.duplicateTimestampsCorrected",
    ),
    exactDuplicateRowsRemoved: integerAt(
      manifest.exactDuplicateRowsRemoved,
      "reviewManifest.exactDuplicateRowsRemoved",
    ),
    cacheSources: cacheSources as RustReviewExecution["cacheSources"],
    recomputedStepIds: steps
      .filter(({ status }) => status === "recomputed")
      .map(({ id }) => id),
    cachedStepIds: steps
      .filter(({ status }) => status === "cached")
      .map(({ id }) => id),
    bypassedStepIds: steps
      .filter(({ status }) => status === "bypassed")
      .map(({ id }) => id),
    skippedStepIds: steps
      .filter(({ status }) => status === "skipped")
      .map(({ id }) => id),
    errorStepIds: steps
      .filter(({ status }) => status === "error")
      .map(({ id }) => id),
  };
}

let initPromise: Promise<KernelModule> | null = null;

// The Rust worker retains exactly one live Salsa database. Keep the matching
// root token here when OPFS persistence is disabled so repeated calls still
// continue that database instead of accidentally forcing a cold reset.
let ephemeralContinuation:
  { workspaceId: string; workspaceRootDigest: string } | undefined;

// These encoded-size limits mirror the Rust runtime's pre-decode limits. OPFS
// checks them before File.arrayBuffer() so a bad closure cannot allocate an
// oversized cache merely to have Rust reject it afterward.
const MAX_REVIEW_BASE_ENCODED_BYTES = 64 * 1024 * 1024;
const MAX_RECONSTRUCTION_BASE_ENCODED_BYTES = 96 * 1024 * 1024;
const MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES = 128 * 1024 * 1024;

export type RustPersistenceAdapter = {
  openRoot(workspaceId: string): Promise<FileSystemDirectoryHandle>;
  recover(
    root: FileSystemDirectoryHandle,
  ): Promise<WorkspaceRootSlot | undefined>;
  recoverHead?(
    root: FileSystemDirectoryHandle,
  ): Promise<WorkspaceRootSlot | undefined>;
  verify?(
    root: FileSystemDirectoryHandle,
    slot: WorkspaceRootSlot,
    kernel: KernelModule,
    workspaceId: string,
  ): Promise<void>;
  persist(
    root: FileSystemDirectoryHandle,
    input: {
      workspaceRootDigest: string;
      previousWorkspaceRootDigest: string | null;
      artifacts: PersistedRuntimeArtifact[];
      recoveredSlot?: WorkspaceRootSlot;
    },
  ): Promise<WorkspaceRootSlot>;
};

async function readArtifactsFromWorkspaceSlot(
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
  kinds: readonly string[],
  expected?: {
    implementationDigest?: string;
    buildEnvironmentDigest?: string;
    workspaceId?: string;
    inputDigest?: string;
  },
): Promise<Map<string, Uint8Array>> {
  const rootBytes = await readRuntimeObject(root, slot.workspaceRootDigest);
  const rootCommit = JSON.parse(new TextDecoder().decode(rootBytes)) as {
    artifactClosureDigest: string;
    implementationDigest: string;
    buildEnvironmentDigest: string;
    workspaceId: string;
    inputDigest: string;
  };
  if (
    (expected?.implementationDigest !== undefined &&
      rootCommit.implementationDigest !== expected.implementationDigest) ||
    (expected?.buildEnvironmentDigest !== undefined &&
      rootCommit.buildEnvironmentDigest !== expected.buildEnvironmentDigest) ||
    (expected?.workspaceId !== undefined &&
      rootCommit.workspaceId !== expected.workspaceId) ||
    (expected?.inputDigest !== undefined &&
      rootCommit.inputDigest !== expected.inputDigest)
  ) {
    throw new Error("persisted Rust workspace identity mismatch");
  }
  const closureBytes = await readRuntimeObject(
    root,
    rootCommit.artifactClosureDigest,
  );
  const closure = JSON.parse(new TextDecoder().decode(closureBytes)) as {
    implementationDigest: string;
    buildEnvironmentDigest: string;
    workspaceId: string;
    inputDigest: string;
    artifacts: Array<{ kind: string; digest: string; size: number }>;
  };
  if (
    closure.implementationDigest !== rootCommit.implementationDigest ||
    closure.buildEnvironmentDigest !== rootCommit.buildEnvironmentDigest ||
    closure.workspaceId !== rootCommit.workspaceId ||
    closure.inputDigest !== rootCommit.inputDigest
  ) {
    throw new Error("persisted Rust artifact closure identity mismatch");
  }
  const selected = kinds.flatMap((kind) => {
    const artifact = closure.artifacts.find(
      (candidate) => candidate.kind === kind,
    );
    const limit =
      kind === "review-base"
        ? MAX_REVIEW_BASE_ENCODED_BYTES
        : kind === "reconstruction-base"
          ? MAX_RECONSTRUCTION_BASE_ENCODED_BYTES
          : undefined;
    return artifact ? [{ kind, artifact, limit }] : [];
  });
  let combinedBaseBytes = 0;
  for (const { kind, artifact, limit } of selected) {
    if (!Number.isSafeInteger(artifact.size) || artifact.size < 0) {
      throw new Error(`persisted Rust artifact size is invalid: ${kind}`);
    }
    if (limit !== undefined && artifact.size > limit) {
      throw new Error(`persisted Rust artifact exceeds size limit: ${kind}`);
    }
    if (limit !== undefined) combinedBaseBytes += artifact.size;
  }
  if (combinedBaseBytes > MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES) {
    throw new Error("combined persisted Rust bases exceed size limit");
  }
  const entries = await Promise.all(
    selected.map(async ({ kind, artifact, limit }) => {
      const bytes = await readRuntimeObject(root, artifact.digest, limit);
      return { kind, artifact, bytes };
    }),
  );
  const requested = new Map<string, Uint8Array>();
  for (const { kind, artifact, bytes } of entries) {
    // readRuntimeObject already verifies the content digest. Keep the closure's
    // declared-size check here without hashing every multi-megabyte base twice.
    if (bytes.byteLength !== artifact.size) {
      throw new Error(`persisted Rust artifact integrity mismatch: ${kind}`);
    }
    requested.set(kind, bytes);
  }
  return requested;
}

export async function readPersistedRustReviewBases(
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
  expected: {
    implementationDigest: string;
    buildEnvironmentDigest: string;
    workspaceId: string;
    inputDigest: string;
  },
): Promise<{
  reviewBaseBytes: Uint8Array;
  reconstructionBaseBytes: Uint8Array;
}> {
  const artifacts = await readArtifactsFromWorkspaceSlot(
    root,
    slot,
    ["review-base", "reconstruction-base"],
    expected,
  );
  return {
    reviewBaseBytes: artifacts.get("review-base") ?? new Uint8Array(),
    reconstructionBaseBytes:
      artifacts.get("reconstruction-base") ?? new Uint8Array(),
  };
}

const defaultPersistenceAdapter: RustPersistenceAdapter = {
  openRoot: openOpfsWorkspace,
  recover: recoverRuntimeWorkspace,
  recoverHead: recoverRuntimeWorkspaceHead,
  async verify(root, slot, kernel, workspaceId) {
    const rootBytes = await readRuntimeObject(root, slot.workspaceRootDigest);
    const historyDigests = await collectRuntimeHistoryDigests(
      root,
      slot.workspaceRootDigest,
    );
    await verifyRootClosure(
      rootBytes,
      (digest) => readRuntimeObject(root, digest),
      historyDigests,
      slot.previousWorkspaceRootDigest,
      kernel,
      workspaceId,
      slot.workspaceRootDigest,
    );
  },
  persist: persistRuntimeWorkspace,
};

async function verifyRootClosure(
  rootBytes: Uint8Array,
  object: (digest: string) => Promise<Uint8Array> | Uint8Array,
  retainedDigests: readonly string[],
  expectedPreviousRoot: string | null,
  kernel: KernelModule,
  expectedWorkspaceId: string,
  expectedWorkspaceRootDigest: string,
  verifyHistory = true,
): Promise<void> {
  const currentIdentity = objectAt(
    JSON.parse(kernel.runtime_identity_json()),
    "runtimeIdentity",
  );
  const identityFields = [
    "implementationDigest",
    "buildEnvironmentDigest",
    "productContractDigest",
    "planDigest",
    "profileDigest",
    "profileLockDigest",
    "runtimeAuthorityDigest",
    "dependencyCertificateDigest",
  ] as const;
  if (
    currentIdentity.protocolVersion !== "chronicle-preprocessing-runtime/v1"
  ) {
    throw new Error("loaded runtime identity protocol is invalid");
  }
  for (const field of identityFields)
    digestAt(currentIdentity[field], `runtimeIdentity.${field}`);
  const requiredViews = new Map([
    [
      "chronicle.stage.v1",
      {
        artifactKind: "stage-view-json",
        schemaId: "urn:chronicle:view:stage:v1",
      },
    ],
    [
      "chronicle.artifact.v1",
      {
        artifactKind: "artifact-view-json",
        schemaId: "urn:chronicle:view:artifact:v1",
      },
    ],
    [
      "chronicle.obligation.v1",
      {
        artifactKind: "obligation-view-json",
        schemaId: "urn:chronicle:view:obligation:v1",
      },
    ],
    [
      "chronicle.explanation.v1",
      {
        artifactKind: "explanation-view-json",
        schemaId: "urn:chronicle:view:explanation:v1",
      },
    ],
  ]);
  const retained = new Set(
    retainedDigests.map((digest) => digestAt(digest, "retainedDigest")),
  );
  if (
    retained.size !== retainedDigests.length ||
    !retained.has(expectedWorkspaceRootDigest)
  ) {
    throw new Error("recovered workspace retained-object table is invalid");
  }
  const bytesByDigest = new Map<string, Uint8Array>([
    [expectedWorkspaceRootDigest, rootBytes],
  ]);
  const readObject = async (digest: string): Promise<Uint8Array> => {
    digestAt(digest, "objectDigest");
    const cached = bytesByDigest.get(digest);
    if (cached) return cached;
    const bytes = await object(digest);
    bytesByDigest.set(digest, bytes);
    return bytes;
  };
  type Root = {
    protocolVersion: string;
    command: string;
    implementationDigest: string;
    buildEnvironmentDigest: string;
    productContractDigest: string;
    planDigest: string;
    profileDigest: string;
    profileLockDigest: string;
    runtimeAuthorityDigest: string;
    dependencyCertificateDigest: string;
    dependencyCacheMode: "certified_narrow" | "conservative_full";
    workspaceId: string;
    previousWorkspaceRootDigest: string | null;
    inputDigest: string;
    optionsDigest: string;
    assignmentDigests: Record<string, string>;
    artifactDigests: string[];
    executionStateDigest: string;
    requiredViews: Array<{
      artifactKind: string;
      viewId: string;
      schemaId: string;
      artifactDigest: string;
    }>;
    journalDigest: string;
    artifactClosureDigest: string;
  };
  const decodeRoot = (bytes: Uint8Array): Root => {
    const root = JSON.parse(new TextDecoder().decode(bytes)) as Root;
    if (
      root.protocolVersion !== "chronicle-preprocessing-runtime/v1" ||
      root.command !== "ExecuteWorkspace" ||
      !["certified_narrow", "conservative_full"].includes(
        root.dependencyCacheMode,
      ) ||
      !Array.isArray(root.artifactDigests) ||
      new Set(root.artifactDigests).size !== root.artifactDigests.length ||
      !Array.isArray(root.requiredViews) ||
      root.requiredViews.length !== requiredViews.size ||
      !root.assignmentDigests ||
      typeof root.assignmentDigests !== "object" ||
      Array.isArray(root.assignmentDigests)
    ) {
      throw new Error("recovered workspace root contract is invalid");
    }
    for (const digest of [
      root.implementationDigest,
      root.buildEnvironmentDigest,
      root.productContractDigest,
      root.planDigest,
      root.profileDigest,
      root.profileLockDigest,
      root.runtimeAuthorityDigest,
      root.dependencyCertificateDigest,
      root.workspaceId,
      root.inputDigest,
      root.optionsDigest,
      root.executionStateDigest,
      root.journalDigest,
      root.artifactClosureDigest,
      ...root.artifactDigests,
      ...Object.values(root.assignmentDigests),
    ])
      digestAt(digest, "root digest");
    if (root.previousWorkspaceRootDigest !== null) {
      digestAt(
        root.previousWorkspaceRootDigest,
        "root.previousWorkspaceRootDigest",
      );
    }
    return root;
  };

  const allowed = new Set<string>();
  const seenRoots = new Set<string>();
  let rootDigest: string | null = expectedWorkspaceRootDigest;
  let head = true;
  while (rootDigest !== null) {
    if (seenRoots.has(rootDigest) || seenRoots.size >= 10_000) {
      throw new Error("recovered workspace history is cyclic or too large");
    }
    seenRoots.add(rootDigest);
    const commit = decodeRoot(await readObject(rootDigest));
    if (
      head &&
      identityFields.some((field) => commit[field] !== currentIdentity[field])
    ) {
      throw new Error(
        "recovered workspace head was produced by a different runtime identity",
      );
    }
    if (
      commit.workspaceId !== expectedWorkspaceId ||
      (head && commit.previousWorkspaceRootDigest !== expectedPreviousRoot)
    ) {
      throw new Error("recovered workspace root identity is invalid");
    }
    head = false;
    const assignmentDigests = Object.values(commit.assignmentDigests);
    for (const digest of [
      rootDigest,
      commit.inputDigest,
      commit.optionsDigest,
      ...assignmentDigests,
      ...commit.artifactDigests,
    ])
      allowed.add(digest);
    if (
      !commit.artifactDigests.includes(commit.dependencyCertificateDigest) ||
      !commit.artifactDigests.includes(commit.executionStateDigest) ||
      !commit.artifactDigests.includes(commit.journalDigest) ||
      !commit.artifactDigests.includes(commit.artifactClosureDigest)
    ) {
      throw new Error("recovered workspace root omits a required artifact");
    }

    const bindings = new Map<string, Root["requiredViews"][number]>();
    for (const binding of commit.requiredViews) {
      const expected = requiredViews.get(binding.viewId);
      digestAt(binding.artifactDigest, "root.requiredViews.artifactDigest");
      if (
        !expected ||
        bindings.has(binding.viewId) ||
        binding.artifactKind !== expected.artifactKind ||
        binding.schemaId !== expected.schemaId ||
        !commit.artifactDigests.includes(binding.artifactDigest)
      ) {
        throw new Error("recovered workspace view binding is invalid");
      }
      bindings.set(binding.viewId, binding);
    }
    if ([...requiredViews.keys()].some((viewId) => !bindings.has(viewId))) {
      throw new Error("recovered workspace is missing a required typed view");
    }

    const state = JSON.parse(
      new TextDecoder().decode(await readObject(commit.executionStateDigest)),
    ) as Record<string, unknown>;
    const stateArtifacts = arrayAt(
      state.computationalArtifactDigests,
      "executionState.computationalArtifactDigests",
    ).map((digest, index) =>
      digestAt(digest, `executionState.artifacts[${index}]`),
    );
    const expectedStateArtifacts = commit.artifactDigests.filter(
      (digest) =>
        digest !== commit.executionStateDigest &&
        digest !== commit.artifactClosureDigest &&
        ![...bindings.values()].some(
          (binding) => binding.artifactDigest === digest,
        ),
    );
    if (
      state.protocolVersion !== "chronicle-execution-state/v1" ||
      state.workspaceId !== commit.workspaceId ||
      state.previousWorkspaceRootDigest !==
        commit.previousWorkspaceRootDigest ||
      state.inputDigest !== commit.inputDigest ||
      state.optionsDigest !== commit.optionsDigest ||
      canonicalJson(state.assignmentDigests) !==
        canonicalJson(commit.assignmentDigests) ||
      state.journalDigest !== commit.journalDigest ||
      state.dependencyCacheMode !== commit.dependencyCacheMode ||
      canonicalJson([...stateArtifacts].sort()) !==
        canonicalJson([...expectedStateArtifacts].sort())
    ) {
      throw new Error("recovered execution state is invalid");
    }
    for (const field of [
      "implementationDigest",
      "buildEnvironmentDigest",
      "productContractDigest",
      "planDigest",
      "profileDigest",
      "profileLockDigest",
      "runtimeAuthorityDigest",
      "dependencyCertificateDigest",
    ] as const) {
      if (state[field] !== commit[field]) {
        throw new Error(
          `recovered execution state identity mismatch: ${field}`,
        );
      }
    }

    kernel.verify_evidence_journal_cbor(await readObject(commit.journalDigest));
    const closure = JSON.parse(
      new TextDecoder().decode(await readObject(commit.artifactClosureDigest)),
    ) as Record<string, unknown>;
    const closureArtifacts = arrayAt(
      closure.artifacts,
      "closure.artifacts",
    ).map((value, index) =>
      artifactMetadataAt(value, `closure.artifacts[${index}]`),
    );
    const closureKinds = closureArtifacts.map(({ kind }) => kind);
    const closureDigests = closureArtifacts.map(({ digest }) => digest);
    const uniqueClosureDigests = [...new Set(closureDigests)].sort();
    if (
      closure.protocolVersion !== "chronicle-artifact-closure/v1" ||
      new Set(closureKinds).size !== closureKinds.length ||
      canonicalJson(uniqueClosureDigests) !==
        canonicalJson(
          commit.artifactDigests
            .filter((digest) => digest !== commit.artifactClosureDigest)
            .sort(),
        )
    ) {
      throw new Error("recovered artifact closure set is invalid");
    }
    for (const field of [
      "workspaceId",
      "inputDigest",
      "implementationDigest",
      "buildEnvironmentDigest",
      "planDigest",
      "profileDigest",
      "profileLockDigest",
      "runtimeAuthorityDigest",
      "productContractDigest",
      "dependencyCertificateDigest",
      "dependencyCacheMode",
      "previousWorkspaceRootDigest",
      "optionsDigest",
      "assignmentDigests",
      "executionStateDigest",
      "journalDigest",
    ] as const) {
      if (canonicalJson(closure[field]) !== canonicalJson(commit[field])) {
        throw new Error(
          `recovered artifact closure identity mismatch: ${field}`,
        );
      }
    }
    for (const metadata of closureArtifacts) {
      if ((await readObject(metadata.digest)).byteLength !== metadata.size) {
        throw new Error(`recovered artifact size mismatch: ${metadata.kind}`);
      }
    }
    for (const binding of bindings.values()) {
      const metadata = closureArtifacts.find(
        (artifact) => artifact.kind === binding.artifactKind,
      );
      const view = JSON.parse(
        new TextDecoder().decode(await readObject(binding.artifactDigest)),
      ) as Record<string, unknown>;
      if (
        metadata?.digest !== binding.artifactDigest ||
        view.protocol_version !== "0.1" ||
        view.view_id !== binding.viewId ||
        view.family !== "incremental-dataflow" ||
        view.schema_id !== binding.schemaId ||
        view.root_digest !== commit.executionStateDigest ||
        !Number.isSafeInteger(view.revision) ||
        !("payload" in view)
      ) {
        throw new Error(`recovered typed view is invalid: ${binding.viewId}`);
      }
    }
    rootDigest = verifyHistory ? commit.previousWorkspaceRootDigest : null;
  }
  if (
    allowed.size !== retained.size ||
    [...allowed].some((digest) => !retained.has(digest))
  ) {
    throw new Error(
      "recovered workspace closure has missing or unbound objects",
    );
  }
}

async function verifyPortableClosure(
  closure: RuntimeClosureInspection,
  kernel: KernelModule,
  workspaceId: string,
): Promise<void> {
  await verifyRootClosure(
    closure.object(closure.manifest.workspaceRootDigest),
    (digest) => closure.object(digest),
    closure.manifest.objects.map(({ digest }) => digest),
    closure.manifest.previousWorkspaceRootDigest,
    kernel,
    workspaceId,
    closure.manifest.workspaceRootDigest,
  );
}

let persistenceAdapter = defaultPersistenceAdapter;

/** Test-only dependency seam for initializing the generated module from local bytes. */
export function setRustRuntimeForTesting(module: KernelModule): void {
  initPromise = Promise.resolve(module);
}

/** Instantiate the generated bindings from a module compiled once by the main
 * thread. Each worker still owns an independent WASM memory and Rust runtime. */
export async function initializeRustRuntime(
  compiledModule: WebAssembly.Module,
): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const module =
        (await import("@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js")) as unknown as KernelModule;
      captureWasmMemory(await module.default({ module_or_path: compiledModule }));
      return module;
    })();
  }
  await initPromise;
}

export async function discoverRustTimezones(
  csvBytes: Uint8Array,
): Promise<string[]> {
  const kernel = await loadKernel();
  return kernel.discover_timezones_v2(csvBytes);
}

export async function inspectRustRawFile(
  csvBytes: Uint8Array,
  fileName: string,
  sizeBytes: number,
): Promise<RawFileInspection> {
  const kernel = await loadKernel();
  const parsed: unknown = JSON.parse(
    kernel.inspect_raw_file_v1(csvBytes, fileName, sizeBytes),
  );
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { fileName?: unknown }).fileName !== fileName ||
    !Array.isArray((parsed as { warnings?: unknown }).warnings) ||
    !Array.isArray((parsed as { columns?: unknown }).columns) ||
    !Array.isArray((parsed as { timezones?: unknown }).timezones)
  ) {
    throw new Error("Rust raw-file inspection returned an invalid result.");
  }
  return parsed as RawFileInspection;
}

export async function verifyPersistedRustWorkspace(
  workspaceId: string,
): Promise<WorkspaceRootSlot | undefined> {
  const [kernel, root] = await Promise.all([
    loadKernel(),
    openOpfsWorkspace(workspaceId),
  ]);
  const slot = await recoverRuntimeWorkspace(root);
  if (slot) {
    await defaultPersistenceAdapter.verify?.(root, slot, kernel, workspaceId);
  }
  return slot;
}

export async function exportPersistedRustWorkspace(
  workspaceId: string,
): Promise<Uint8Array> {
  const [kernel, root] = await Promise.all([
    loadKernel(),
    openOpfsWorkspace(workspaceId),
  ]);
  const slot = await recoverRuntimeWorkspace(root);
  if (!slot) throw new Error("no persisted Rust workspace exists");
  await defaultPersistenceAdapter.verify?.(root, slot, kernel, workspaceId);
  return exportRuntimeClosure(root, slot);
}

export async function importPersistedRustWorkspace(
  workspaceId: string,
  archive: Uint8Array,
): Promise<WorkspaceRootSlot> {
  if (runtimeClosureWorkspaceId(archive) !== workspaceId) {
    throw new Error(
      "runtime closure workspace identity does not match the import target",
    );
  }
  return withWorkspaceLock(workspaceId, async () => {
    const [kernel, root] = await Promise.all([
      loadKernel(),
      openOpfsWorkspace(workspaceId),
    ]);
    return importRuntimeClosure(root, archive, (closure) =>
      verifyPortableClosure(closure, kernel, workspaceId),
    );
  });
}

export async function importPersistedRustWorkspaceArchive(
  archive: Uint8Array,
): Promise<{ workspaceId: string; slot: WorkspaceRootSlot }> {
  const workspaceId = runtimeClosureWorkspaceId(archive);
  return {
    workspaceId,
    slot: await importPersistedRustWorkspace(workspaceId, archive),
  };
}

export async function garbageCollectPersistedRustWorkspace(
  workspaceId: string,
): Promise<number> {
  return withWorkspaceLock(workspaceId, async () => {
    const root = await openOpfsWorkspace(workspaceId);
    const slots = await recoverRuntimeWorkspaceRoots(root);
    return garbageCollectRuntimeObjects(root, slots);
  });
}

export async function readPersistedRustArtifact(
  workspaceId: string,
  kind: string,
): Promise<Uint8Array> {
  const [kernel, root] = await Promise.all([
    loadKernel(),
    openOpfsWorkspace(workspaceId),
  ]);
  const slot = await recoverRuntimeWorkspace(root);
  if (!slot) throw new Error("no persisted Rust workspace exists");
  await defaultPersistenceAdapter.verify?.(root, slot, kernel, workspaceId);
  const rootCommit = JSON.parse(
    new TextDecoder().decode(
      await readRuntimeObject(root, slot.workspaceRootDigest),
    ),
  ) as { artifactClosureDigest: string };
  const closureBytes = await readRuntimeObject(
    root,
    rootCommit.artifactClosureDigest,
  );
  // The closure cannot list itself without making its own digest recursive.
  // Its exact bytes are nevertheless addressed by the verified root commit.
  if (kind === "artifact-closure-json") return closureBytes;
  const closure = JSON.parse(new TextDecoder().decode(closureBytes)) as {
    artifacts: Array<{ kind: string; digest: string }>;
  };
  const artifact = closure.artifacts.find(
    (candidate) => candidate.kind === kind,
  );
  if (!artifact) throw new Error(`persisted Rust artifact is missing: ${kind}`);
  return readRuntimeObject(root, artifact.digest);
}

export async function readVerifiedSemanticIndexSnapshot(
  workspaceId: string,
): Promise<{ workspaceRootDigest: string; source: Uint8Array }> {
  return withWorkspaceLock(
    workspaceId,
    async () => {
      const [kernel, root] = await Promise.all([
        loadKernel(),
        openOpfsWorkspace(workspaceId),
      ]);
      const slot = await recoverRuntimeWorkspace(root);
      if (!slot) throw new Error("no persisted Rust workspace exists");
      await defaultPersistenceAdapter.verify?.(root, slot, kernel, workspaceId);
      const artifacts = await readArtifactsFromWorkspaceSlot(root, slot, [
        "semantic-index-source-json",
      ]);
      const source = artifacts.get("semantic-index-source-json");
      if (!source) {
        throw new Error(
          "persisted Rust artifact is missing: semantic-index-source-json",
        );
      }
      return { workspaceRootDigest: slot.workspaceRootDigest, source };
    },
    "shared",
  );
}

/**
 * Read only the newest independently recoverable root. A semantic index that
 * was already fully verified for this exact digest can use this cheap check
 * instead of re-reading and hashing the complete append-only history.
 */
export async function readPersistedRustWorkspaceHead(
  workspaceId: string,
): Promise<string | null> {
  return withWorkspaceLock(
    workspaceId,
    async () => {
      const root = await openOpfsWorkspace(workspaceId);
      return (await recoverRuntimeWorkspace(root))?.workspaceRootDigest ?? null;
    },
    "shared",
  );
}

/** Test-only dependency seam for deterministic OPFS fault/recovery tests. */
export function setRustPersistenceForTesting(
  adapter: RustPersistenceAdapter | null,
): void {
  persistenceAdapter = adapter ?? defaultPersistenceAdapter;
  ephemeralContinuation = undefined;
}

async function loadKernel(): Promise<KernelModule> {
  if (!initPromise) {
    /* v8 ignore start -- Vite's browser WASM loader is exercised by the Playwright offline/runtime smoke; unit tests inject the exact compiled module bytes. */
    initPromise = (async () => {
      const module =
        (await import("@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js")) as unknown as KernelModule;
      captureWasmMemory(await module.default());
      return module;
    })();
    /* v8 ignore stop */
  }
  return initPromise;
}

export async function getRustRuntimeVersion(): Promise<string> {
  return (await loadKernel()).runtime_version();
}

export async function getRustPlanStageView(
  options: BrowserProcessingOptions,
): Promise<import("@/lib/types").RustStageView> {
  const kernel = await loadKernel();
  // The pre-run projection has no raw input from which to discover a timezone.
  // A deterministic placeholder satisfies the execution ABI only; Rust still
  // evaluates all topology and applicability, and the actual run separately
  // resolves or rejects the selected timezone before ingestion.
  const projectionOptions =
    options.timezoneHandling.startsWith("selected-") &&
    !options.selectedTimezone?.trim()
      ? { ...options, selectedTimezone: "UTC" }
      : options;
  return JSON.parse(
    kernel.plan_stage_view_json(
      JSON.stringify(
        buildRustV2Options(projectionOptions, {
          datetimeOfPreprocessing: "1970-01-01 00:00:00 UTC",
        }),
      ),
    ),
  ) as import("@/lib/types").RustStageView;
}

function fileBytes(file: BrowserSupportFile | undefined): Uint8Array {
  return file ? new Uint8Array(file.bytes) : new Uint8Array();
}

async function supportBytes(
  enabled: boolean,
  file: BrowserSupportFile | undefined,
  bundledUrl: string,
): Promise<Uint8Array> {
  if (!enabled) return new Uint8Array();
  if (file) return fileBytes(file);
  return new Uint8Array(await fetchBundledAssetBytes(bundledUrl));
}

function requiredUploadedBytes(
  enabled: boolean,
  file: BrowserSupportFile | undefined,
  role: string,
): Uint8Array {
  if (!enabled) return new Uint8Array();
  if (!file) {
    throw new Error(`${role} is required when its processing stage is enabled`);
  }
  return fileBytes(file);
}

function putSupport(
  supportFiles: RuntimeSupportFilesHandle,
  role: string,
  name: string,
  bytes: Uint8Array,
): void {
  if (bytes.byteLength > 0) supportFiles.put_with_name(role, name, bytes);
}

/**
 * Exact, conservative eligibility boundary for the existing fused v2 kernel.
 * Every unsupported option is loud; adding support requires changing this
 * list and proving it with parity fixtures.
 */
export function rustRuntimeIneligibilityReasons(
  options: BrowserProcessingOptions,
): string[] {
  const reasons: string[] = [];
  if (
    options.timezoneHandling.startsWith("selected-") &&
    !options.selectedTimezone?.trim()
  ) {
    reasons.push(
      "selectedTimezone is required for the selected timezone policy",
    );
  }
  return reasons;
}

export function buildRustV2Options(
  options: BrowserProcessingOptions,
  runtime: BrowserProcessingRuntime,
): Record<string, unknown> {
  if (
    options.timezoneHandling.startsWith("selected-") &&
    !options.selectedTimezone?.trim()
  ) {
    throw new Error(
      "selectedTimezone is required for the selected timezone policy",
    );
  }
  if (!runtime.datetimeOfPreprocessing)
    throw new Error("datetimeOfPreprocessing is required");
  const usageSessionMode = options.processAppUsage
    ? options.processScreenUsage
      ? "app_and_screen_usage"
      : "app_usage"
    : options.processScreenUsage
      ? "screen_usage"
      : "no_usage";
  return {
    study_name: options.studyName,
    timezone: options.selectedTimezone?.trim() || "UTC",
    timezone_handling: options.timezoneHandling,
    usage_session_mode: usageSessionMode,
    include_app_output: options.processAppUsage,
    include_screen_output: options.processScreenUsage,
    use_filter_file: options.useFilterFile,
    use_apps_forcing_screen_open: options.useAppsForcingScreenOpenFile,
    use_background_apps_file: options.useBackgroundAppsFile,
    use_app_codebook: options.useAppCodebook,
    include_category_column: options.includeCategoryColumn,
    deduplicate_exact_rows: options.deduplicateExactRows,
    interaction_type_remap: options.interactionTypeRemap,
    correct_duplicate_event_timestamps: options.correctDuplicateEventTimestamps,
    allow_stop_event_reuse: options.allowStopEventReuse,
    use_activity_stopped_as_fallback: options.useActivityStoppedAsFallback,
    apply_threshold_to_fallback: options.applyThresholdToFallback,
    long_duration_threshold_ns:
      options.longDurationThresholdHours * 3_600_000_000_000,
    proximity_interval_ns: options.proximityIntervalSeconds * 1_000_000_000,
    custom_app_engagement_duration: options.customAppEngagementDuration,
    long_data_time_gap_thresholds: options.longDataTimeGapThresholds,
    long_usage_duration_thresholds: options.longUsageDurationThresholds,
    same_app_stop_types: options.sameAppInteractionTypesToStopUsageAt,
    other_stop_types: options.otherInteractionTypesToStopUsageAt,
    interaction_types_to_remove: options.interactionTypesToRemove,
    screen_auto_lock_timeout_seconds: options.screenUsageAutoLockTimeoutSeconds,
    screen_auto_lock_tolerance_seconds:
      options.screenUsageAutoLockToleranceSeconds,
    screen_manual_lock_max_tail_seconds:
      options.screenUsageManualLockMaxTailGapSeconds,
    screen_keyguard_near_stop_seconds:
      options.screenUsageKeyguardNearStopSeconds,
    datetime_of_preprocessing: runtime.datetimeOfPreprocessing,
    model_concurrent_usage: options.modelConcurrentUsage,
    minimum_usage_duration: options.minimumUsageDuration,
    apply_minimum_usage_duration_to_concurrent_subintervals:
      options.applyMinimumUsageDurationToConcurrentSubintervals,
    filter_zero_duration_sessions: options.filterZeroDurationSessions,
    add_no_activity_placeholder_days: options.addNoActivityPlaceholderDays,
    enable_study_window_filter: options.enableStudyWindowFilter,
    enable_person_attribution: options.enablePersonAttribution,
    enable_day_coverage: options.enableDayCoverage,
    enable_compliance_scoring: options.enableComplianceScoring,
    compliance_threshold_percent: options.complianceThresholdPercent,
    enable_screen_gated_crediting: options.enableScreenGatedCrediting,
    enable_parquet_export: options.enableParquetExport,
    enable_spss_export: options.enableSpssExport,
    enable_aggregates: options.enableAggregates,
    aggregate_shape: options.aggregateShape,
    credited_session_cap_minutes: options.creditedSessionCapMinutes,
    device_liveness_gap_tolerance_minutes:
      options.deviceLivenessGapToleranceMinutes,
    auto_lock_bridge_seconds: options.autoLockBridgeSeconds,
    no_witness_min_day_apps: options.noWitnessMinDayApps,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned =
    bytes.buffer instanceof ArrayBuffer
      ? (bytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function executeRustRuntimeUnlocked(
  workspaceId: string,
  csvBytes: Uint8Array,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  inputSha256: string,
  materialization: "full",
): Promise<RustRuntimeExecution>;
async function executeRustRuntimeUnlocked(
  workspaceId: string,
  csvBytes: Uint8Array,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  inputSha256: string,
  materialization: "review",
): Promise<RustReviewExecution>;
async function executeRustRuntimeUnlocked(
  workspaceId: string,
  csvBytes: Uint8Array,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  inputSha256: string,
  materialization: "full" | "review",
): Promise<RustRuntimeExecution | RustReviewExecution> {
  const reasons = rustRuntimeIneligibilityReasons(options);
  if (reasons.length > 0) {
    throw new Error(`Rust runtime is ineligible: ${reasons.join("; ")}`);
  }
  let handle: KernelHandle | null = null;
  let runtimeSupportFiles: RuntimeSupportFilesHandle | null = null;
  try {
    const kernel = await loadKernel();
    const [filterBytes, forcingBytes, backgroundBytes, codebookBytes] =
      await Promise.all([
        supportBytes(
          options.useFilterFile,
          supportFiles?.filterFile,
          defaultAppsToFilterUrl,
        ),
        supportBytes(
          options.useAppsForcingScreenOpenFile,
          supportFiles?.appsForcingScreenOpenFile,
          defaultAppsForcingScreenOpenUrl,
        ),
        supportBytes(
          options.useBackgroundAppsFile,
          supportFiles?.backgroundAppsFile,
          defaultBackgroundAppsUrl,
        ),
        supportBytes(
          options.useAppCodebook,
          supportFiles?.appCodebookFile,
          defaultAppCodebookUrl,
        ),
      ]);
    const studyDatesBytes = options.enableStudyWindowFilter
      ? requiredUploadedBytes(
          true,
          supportFiles?.studyDatesFile,
          "studyDatesFile",
        )
      : options.enableDayCoverage
        ? fileBytes(supportFiles?.studyDatesFile)
        : new Uint8Array();
    const deviceSharingBytes = requiredUploadedBytes(
      options.enablePersonAttribution,
      supportFiles?.deviceSharingFile,
      "deviceSharingFile",
    );
    const surveyAttributionBytes = fileBytes(
      supportFiles?.surveyAttributionFile,
    );
    const enrolledDevicesBytes = fileBytes(supportFiles?.enrolledDevicesFile);
    const ingressBytesByRole = new Map<string, Uint8Array>([
      ["raw_chronicle_csv", csvBytes],
      ["filter_file", filterBytes],
      ["apps_forcing_screen_open_file", forcingBytes],
      ["background_apps_file", backgroundBytes],
      ["app_codebook_file", codebookBytes],
      ["study_dates_file", studyDatesBytes],
      ["device_sharing_file", deviceSharingBytes],
      ["survey_attribution_file", surveyAttributionBytes],
      ["enrolled_devices_file", enrolledDevicesBytes],
    ]);
    const supportNameByRole = new Map<string, string>([
      [
        "filter_file",
        supportFiles?.filterFile?.name ??
          "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv",
      ],
      [
        "apps_forcing_screen_open_file",
        supportFiles?.appsForcingScreenOpenFile?.name ??
          "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv",
      ],
      [
        "background_apps_file",
        supportFiles?.backgroundAppsFile?.name ??
          "Chronicle_Android_raw_data_preprocessor_background_apps.csv",
      ],
      [
        "app_codebook_file",
        supportFiles?.appCodebookFile?.name ?? "unified_app_codebook.csv",
      ],
      [
        "study_dates_file",
        supportFiles?.studyDatesFile?.name ?? "study_dates.csv",
      ],
      [
        "device_sharing_file",
        supportFiles?.deviceSharingFile?.name ?? "device_sharing.csv",
      ],
      [
        "survey_attribution_file",
        supportFiles?.surveyAttributionFile?.name ?? "survey_attribution.csv",
      ],
      [
        "enrolled_devices_file",
        supportFiles?.enrolledDevicesFile?.name ?? "enrolled_devices.csv",
      ],
    ]);
    runtimeSupportFiles = new kernel.RuntimeSupportFiles();
    for (const [role, bytes] of ingressBytesByRole) {
      if (role !== "raw_chronicle_csv") {
        putSupport(
          runtimeSupportFiles,
          role,
          supportNameByRole.get(role) ?? `${role}.csv`,
          bytes,
        );
      }
    }
    let opfsRoot: FileSystemDirectoryHandle | undefined;
    let recoveredRoot: WorkspaceRootSlot | undefined;
    if (runtime.persistRustWorkspace) {
      opfsRoot = await persistenceAdapter.openRoot(workspaceId);
      recoveredRoot =
        materialization === "review"
          ? await (persistenceAdapter.recoverHead ?? persistenceAdapter.recover)(
              opfsRoot,
            )
          : await persistenceAdapter.recover(opfsRoot);
      if (recoveredRoot && materialization === "full") {
        await persistenceAdapter.verify?.(
          opfsRoot,
          recoveredRoot,
          kernel,
          workspaceId,
        );
      }
    }
    const previousWorkspaceRootDigest =
      recoveredRoot?.workspaceRootDigest ??
      (!runtime.persistRustWorkspace &&
      ephemeralContinuation?.workspaceId === workspaceId
        ? ephemeralContinuation.workspaceRootDigest
        : null);
    const requestId = `${materialization === "review" ? "review" : "execute"}-${inputSha256.slice(0, 16)}`;
    let reviewBaseBytes: Uint8Array = new Uint8Array();
    let reconstructionBaseBytes: Uint8Array = new Uint8Array();
    if (
      materialization === "review" &&
      opfsRoot &&
      recoveredRoot &&
      persistenceAdapter === defaultPersistenceAdapter
    ) {
      ({ reviewBaseBytes, reconstructionBaseBytes } =
        await readPersistedRustReviewBases(opfsRoot, recoveredRoot, {
          implementationDigest: kernel.implementation_build_digest(),
          buildEnvironmentDigest: kernel.build_environment_digest(),
          workspaceId,
          inputDigest: `sha256:${inputSha256}`,
        }));
    }
    const requestJson = JSON.stringify({
      protocolVersion: "chronicle-preprocessing-runtime/v1",
      requestId,
      command:
        materialization === "review" ? "QueryReview" : "ExecuteWorkspace",
      workspaceRootDigest: previousWorkspaceRootDigest,
      workspaceId,
      inputFileName,
      inputSha256: `sha256:${inputSha256}`,
      options: buildRustV2Options(options, runtime),
    });
    handle =
      materialization === "review" &&
      (reviewBaseBytes.byteLength > 0 || reconstructionBaseBytes.byteLength > 0)
        ? kernel.execute_workspace_with_review_bases(
            requestJson,
            csvBytes,
            reviewBaseBytes,
            reconstructionBaseBytes,
            runtimeSupportFiles,
          )
/** The instantiated kernel's linear memory; null until wasm-bindgen init runs. */
let kernelWasmMemory: WebAssembly.Memory | null = null;

function captureWasmMemory(initOutput: unknown): void {
  const memory = (initOutput as { memory?: WebAssembly.Memory } | undefined)
    ?.memory;
  if (memory instanceof WebAssembly.Memory) kernelWasmMemory = memory;
}

/**
 * Current WASM linear-memory size of this thread's kernel instance, in bytes.
 * WASM memory never shrinks, so this is also the high-water mark — the input
 * `computeAdaptiveLaneTarget` uses for measured batch admission. Null when the
 * kernel has not initialized (or was injected via setRustRuntimeForTesting).
 */
export function rustWasmMemoryBytes(): number | null {
  return kernelWasmMemory ? kernelWasmMemory.buffer.byteLength : null;
}

        : kernel.execute_workspace(requestJson, csvBytes, runtimeSupportFiles);
    let manifestValue: unknown;
    let manifestJson: string;
    try {
      manifestJson = handle.manifest_json();
      manifestValue = JSON.parse(manifestJson);
    } catch (error) {
      throw new Error(
        `runtime manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (materialization === "review") {
      const manifest = decodeReviewRuntimeManifest(manifestValue);
      if (manifest.workspaceId !== workspaceId) {
        throw new Error("review manifest workspace identity mismatch");
      }
      if (manifest.inputDigest !== `sha256:${inputSha256}`) {
        throw new Error("review manifest input identity mismatch");
      }
      if (
        manifest.previousWorkspaceRootDigest !== previousWorkspaceRootDigest
      ) {
        throw new Error("review manifest previous-root identity mismatch");
      }
      if (
        manifest.implementationDigest !== kernel.implementation_build_digest()
      ) {
        throw new Error("review manifest implementation identity mismatch");
      }
      if (
        manifest.buildEnvironmentDigest !== kernel.build_environment_digest()
      ) {
        throw new Error("review manifest build-environment identity mismatch");
      }
      if (handle.artifact_count !== 1) {
        throw new Error(
          "review query must expose exactly one compact artifact",
        );
      }
      const metadata = artifactMetadataAt(
        JSON.parse(handle.artifact_metadata_json(0)),
        "reviewArtifact",
      );
      if (
        metadata.kind !== "review-summary-json" ||
        metadata.digest !== manifest.reviewSummaryDigest
      ) {
        throw new Error("review artifact identity mismatch");
      }
      const reviewBytes = handle.take_artifact_bytes(0);
      if (
        metadata.size !== reviewBytes.byteLength ||
        metadata.digest !== `sha256:${await sha256Hex(reviewBytes)}`
      ) {
        throw new Error("review artifact integrity mismatch");
      }
      let reviewSummary: ReviewSummary;
      try {
        reviewSummary = JSON.parse(
          new TextDecoder().decode(reviewBytes),
        ) as ReviewSummary;
      } catch (error) {
        throw new Error(
          `review summary is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return { ...manifest, manifestJson, reviewSummary };
    }
    const manifest = decodeRuntimeManifest(manifestValue);
    if (manifest.requestId !== requestId) {
      throw new Error("runtime manifest request identity mismatch");
    }
    if (manifest.workspaceId !== workspaceId) {
      throw new Error("runtime manifest workspace identity mismatch");
    }
    if (
      manifest.implementationDigest !== kernel.implementation_build_digest()
    ) {
      throw new Error("runtime manifest implementation identity mismatch");
    }
    if (manifest.buildEnvironmentDigest !== kernel.build_environment_digest()) {
      throw new Error("runtime manifest build-environment identity mismatch");
    }
    if (
      manifest.input.digest !== `sha256:${inputSha256}` ||
      manifest.input.size !== csvBytes.byteLength
    ) {
      throw new Error("runtime manifest input identity mismatch");
    }
    if (manifest.previousWorkspaceRootDigest !== previousWorkspaceRootDigest) {
      throw new Error("runtime manifest previous-root identity mismatch");
    }
    const artifacts = new Map<string, Uint8Array>();
    const persistedArtifacts: PersistedRuntimeArtifact[] = [];
    const handleMetadata = new Map<string, RuntimeArtifactMetadata>();
    const extractedArtifacts: Array<{
      metadata: RuntimeArtifactMetadata;
      bytes: Uint8Array;
    }> = [];
    for (let index = 0; index < handle.artifact_count; index += 1) {
      let metadataValue: unknown;
      try {
        metadataValue = JSON.parse(handle.artifact_metadata_json(index));
      } catch (error) {
        throw new Error(
          `runtime artifact metadata is not valid JSON at index ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const metadata = artifactMetadataAt(
        metadataValue,
        `artifactMetadata[${index}]`,
      );
      const bytes = handle.take_artifact_bytes(index);
      if (metadata.size !== bytes.byteLength) {
        throw new Error(
          `runtime artifact integrity mismatch: ${metadata.kind}`,
        );
      }
      if (handleMetadata.has(metadata.kind)) {
        throw new Error(`duplicate runtime artifact kind: ${metadata.kind}`);
      }
      handleMetadata.set(metadata.kind, metadata);
      extractedArtifacts.push({ metadata, bytes });
    }
    // WebCrypto hashing can use the browser's native worker pool. Extract all
    // owned WASM buffers first, then verify them concurrently instead of
    // serializing every large digest behind an `await` in the handle loop.
    const verificationQueue = [...extractedArtifacts].sort(
      (left, right) => right.bytes.byteLength - left.bytes.byteLength,
    );
    let verificationIndex = 0;
    const verifyNext = async (): Promise<void> => {
      for (;;) {
        const entry = verificationQueue[verificationIndex];
        verificationIndex += 1;
        if (!entry) return;
        const { metadata, bytes } = entry;
        if (metadata.digest !== `sha256:${await sha256Hex(bytes)}`) {
          throw new Error(
            `runtime artifact integrity mismatch: ${metadata.kind}`,
          );
        }
      }
    };
    await Promise.all([verifyNext(), verifyNext()]);
    for (const { metadata, bytes } of extractedArtifacts) {
      artifacts.set(metadata.kind, bytes);
      persistedArtifacts.push({ ...metadata, bytes, digestVerified: true });
    }
    verifyRuntimeArtifactCatalog(manifest, [...handleMetadata.values()]);
    for (const assignment of manifest.roleAssignments) {
      if (assignment.role_id === "processing_options") continue;
      const bytes = ingressBytesByRole.get(assignment.role_id);
      if (!bytes) {
        throw new Error(
          `runtime declared an unknown ingress role: ${assignment.role_id}`,
        );
      }
      if (assignment.artifact.size !== bytes.byteLength) {
        throw new Error(
          `runtime ingress assignment size mismatch: ${assignment.role_id}`,
        );
      }
      persistedArtifacts.push({
        kind: `ingress:${assignment.role_id}`,
        digest: assignment.artifact.digest,
        size: assignment.artifact.size,
        bytes,
        digestVerified: true,
      });
    }
    const persistedByDigest = new Map(
      persistedArtifacts.map((artifact) => [artifact.digest, artifact.bytes]),
    );
    const rootBytes = persistedByDigest.get(manifest.workspaceRootDigest);
    if (!rootBytes) {
      throw new Error("runtime artifact set is missing its workspace root");
    }
    await verifyRootClosure(
      rootBytes,
      (digest) => {
        const bytes = persistedByDigest.get(digest);
        if (!bytes)
          throw new Error(`runtime artifact set is missing ${digest}`);
        return bytes;
      },
      [...persistedByDigest.keys()],
      manifest.previousWorkspaceRootDigest,
      kernel,
      workspaceId,
      manifest.workspaceRootDigest,
      false,
    );
    const persistedWorkspace =
      runtime.persistRustWorkspace && opfsRoot
        ? await persistenceAdapter.persist(opfsRoot, {
            workspaceRootDigest: manifest.workspaceRootDigest,
            previousWorkspaceRootDigest: manifest.previousWorkspaceRootDigest,
            artifacts: persistedArtifacts,
            recoveredSlot: recoveredRoot,
          })
        : undefined;
    if (
      persistedWorkspace &&
      recoveredRoot &&
      opfsRoot &&
      persistenceAdapter === defaultPersistenceAdapter
    ) {
      try {
        await garbageCollectRuntimeObjects(opfsRoot, [
          persistedWorkspace,
          recoveredRoot,
        ]);
      } catch (error) {
        console.warn(
          "Committed Rust workspace but could not reclaim stale OPFS objects",
          error,
        );
      }
    }
    if (runtime.persistRustWorkspace) {
      ephemeralContinuation = undefined;
    } else {
      ephemeralContinuation = {
        workspaceId,
        workspaceRootDigest: manifest.workspaceRootDigest,
      };
    }
    return {
      workspaceId,
      manifestJson,
      manifest,
      artifacts,
      persistedWorkspace,
    };
  } finally {
    // A trapped WASM call can leave wasm-bindgen's internal borrow flag set.
    // Cleanup must not replace the primary execution error with a secondary
    // "attempted to take ownership while borrowed" exception.
    try {
      handle?.free();
    } catch (error) {
      console.warn("Could not release trapped Rust runtime handle", error);
    }
    try {
      runtimeSupportFiles?.free();
    } catch (error) {
      console.warn("Could not release trapped Rust support handle", error);
    }
  }
}

export async function runtimeWorkspaceId(
  inputFileName: string,
  csvBytes: Uint8Array,
  verifiedInputSha256?: string,
): Promise<string> {
  const inputDigest = verifiedInputSha256 ?? (await sha256Hex(csvBytes));
  if (!/^[0-9a-f]{64}$/.test(inputDigest)) {
    throw new Error(
      "verified input digest must be 64 lowercase hexadecimal characters",
    );
  }
  return `sha256:${await sha256Hex(
    new TextEncoder().encode(
      `chronicle-preprocessing-workspace:${inputFileName}\n${inputDigest}`,
    ),
  )}`;
}

async function withWorkspaceLock<T>(
  workspaceId: string,
  operation: () => Promise<T>,
  mode: "exclusive" | "shared" = "exclusive",
): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    throw new Error(
      "Durable workspace mutation requires the browser Web Locks API",
    );
  }
  return navigator.locks.request(
    `chronicle-preprocessing:${workspaceId}`,
    { mode },
    operation,
  );
}

export async function executeRustRuntime(
  csvBytes: Uint8Array,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  verifiedInputSha256?: string,
): Promise<RustRuntimeExecution> {
  const inputSha256 = verifiedInputSha256 ?? (await sha256Hex(csvBytes));
  const workspaceId = await runtimeWorkspaceId(
    inputFileName,
    csvBytes,
    inputSha256,
  );
  const execute = () =>
    executeRustRuntimeUnlocked(
      workspaceId,
      csvBytes,
      inputFileName,
      options,
      supportFiles,
      runtime,
      inputSha256,
      "full",
    );
  if (!runtime.persistRustWorkspace) return execute();
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    if (persistenceAdapter === defaultPersistenceAdapter) {
      throw new Error(
        "Durable processing requires the browser Web Locks API to serialize workspace commits",
      );
    }
    return execute();
  }
  return withWorkspaceLock(workspaceId, execute);
}

/**
 * Re-evaluate the authoritative Rust graph for interactive A/B review without
 * serializing downloadable exports, timeline geometry, or a new OPFS root.
 * The returned comparison digest commits to the exact input, options, plan,
 * implementation, and review bytes used by the UI.
 */
export async function queryRustReview(
  csvBytes: Uint8Array,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  verifiedInputSha256?: string,
): Promise<RustReviewExecution> {
  const inputSha256 = verifiedInputSha256 ?? (await sha256Hex(csvBytes));
  const workspaceId = await runtimeWorkspaceId(
    inputFileName,
    csvBytes,
    inputSha256,
  );
  const execute = () =>
    executeRustRuntimeUnlocked(
      workspaceId,
      csvBytes,
      inputFileName,
      options,
      supportFiles,
      runtime,
      inputSha256,
      "review",
    );
  if (!runtime.persistRustWorkspace) return execute();
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    if (persistenceAdapter === defaultPersistenceAdapter) {
      throw new Error(
        "Durable comparison requires the browser Web Locks API to serialize access to the Rust workspace",
      );
    }
    return execute();
  }
  return withWorkspaceLock(workspaceId, execute);
}
