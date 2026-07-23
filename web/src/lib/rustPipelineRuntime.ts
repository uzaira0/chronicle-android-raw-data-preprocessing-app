/**
 * Browser transport and persistence boundary for the authoritative Rust/WASM
 * preprocessing runtime. The legacy parity helper at the end of this module is
 * retained only as migration-test evidence; production calls executeRustRuntime.
 */
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFile,
  BrowserSupportFiles,
  ProcessedFileResult,
  RustShadowArtifactComparison,
  RustShadowReport,
} from "@/lib/types";
import type { RawFileInspection } from "@/lib/fileInspection";
import defaultAppCodebookUrl from "@/assets/defaults/unified_app_codebook.csv?url";
import defaultAppsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import defaultAppsForcingScreenOpenUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?url";
import defaultBackgroundAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?url";
import { fetchBundledAssetBytes } from "@/lib/bundledAssetLoader";
import { canonicalJson } from "@/lib/processingReport";
import {
  exportRuntimeClosure,
  garbageCollectRuntimeObjects,
  importRuntimeClosure,
  openOpfsWorkspace,
  persistRuntimeWorkspace,
  readRuntimeObject,
  recoverRuntimeWorkspace,
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
  default(): Promise<unknown>;
  runtime_version(): string;
  implementation_build_digest(): string;
  build_environment_digest(): string;
  pipeline_step_contract_json(): string;
  plan_stage_view_json(optionsJson: string): string;
  RuntimeSupportFiles: new () => RuntimeSupportFilesHandle;
  discover_timezones_v2(csvBytes: Uint8Array): string[];
  inspect_raw_file_v1(csvBytes: Uint8Array, fileName: string, sizeBytes: number): string;
  execute_workspace(
    requestJson: string,
    csvBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): KernelHandle;
  execute_bounded_v2_shadow(
    requestJson: string,
    csvBytes: Uint8Array,
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
  | "open"
  | "ready"
  | "satisfied"
  | "blocked"
  | "invalid"
  | "not_applicable";

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
  throw new Error(`runtime manifest contract violation at ${path}: ${expectation}`);
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
    Object.entries(objectAt(digestsValue, `${path}Digests`)).map(([id, digest]) => [
      id,
      digestAt(digest, `${path}Digests.${id}`),
    ]),
  );
  const checkpoints = Object.fromEntries(
    Object.entries(objectAt(checkpointsValue, `${path}Checkpoints`)).map(([id, value]) => {
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
    }),
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

function artifactMetadataAt(value: unknown, path: string): RuntimeArtifactMetadata {
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
          previewRows: arrayAt(previewRows, `${path}.previewRows`).map((row, index) =>
            arrayAt(row, `${path}.previewRows[${index}]`).map((cell, cellIndex) => {
              if (typeof cell !== "string") {
                contractError(
                  `${path}.previewRows[${index}][${cellIndex}]`,
                  "expected a string",
                );
              }
              return cell;
            }),
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
    (!cacheDecision.certificate_digest ||
      !cacheDecision.binding_surface_digest)
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
      capability_id: stringAt(
        execution.capability_id,
        `${path}.capability_id`,
      ),
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
  if (rowsBeforeTimezoneHandling - rowsRemovedByTimezone !== rowsAfterTimezoneHandling) {
    contractError(
      "manifest.processingSummary",
      "timezone row accounting is inconsistent",
    );
  }

  const artifacts = arrayAt(manifest.artifacts, "manifest.artifacts").map(
    (value, index) =>
      artifactMetadataAt(value, `manifest.artifacts[${index}]`),
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
    requestId: stringAt(manifest.requestId, "manifest.requestId"),
    command: "ExecuteWorkspace",
    implementation: stringAt(manifest.implementation, "manifest.implementation"),
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
    stateReasons: arrayAt(
      manifest.stateReasons,
      "manifest.stateReasons",
    ).map((value, index) =>
      stateReasonAt(value, `manifest.stateReasons[${index}]`),
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
      timezone: stringAt(summary.timezone, "manifest.processingSummary.timezone"),
      timezoneAction: timezoneAction as RuntimeManifest["processingSummary"]["timezoneAction"],
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
  manifest: RuntimeManifest;
  artifacts: Map<string, Uint8Array>;
  persistedWorkspace?: WorkspaceRootSlot;
};

let initPromise: Promise<KernelModule> | null = null;

export type RustPersistenceAdapter = {
  openRoot(workspaceId: string): Promise<FileSystemDirectoryHandle>;
  recover(
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

const defaultPersistenceAdapter: RustPersistenceAdapter = {
  openRoot: openOpfsWorkspace,
  recover: recoverRuntimeWorkspace,
  async verify(root, slot, kernel, workspaceId) {
    const rootBytes = await readRuntimeObject(root, slot.workspaceRootDigest);
    await verifyRootClosure(
      rootBytes,
      (digest) => readRuntimeObject(root, digest),
      slot.artifactDigests,
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
): Promise<void> {
  const commit = JSON.parse(new TextDecoder().decode(rootBytes)) as {
    protocolVersion: string;
    command: string;
    workspaceId: string;
    previousWorkspaceRootDigest: string | null;
    artifactDigests: string[];
    inputDigest: string;
    optionsDigest: string;
    assignmentDigests: Record<string, string>;
    requiredViewIds: string[];
    journalDigest: string;
    artifactClosureDigest: string;
    dependencyCertificateDigest: string;
    dependencyCacheMode: "certified_narrow" | "conservative_full";
  };
  if (
    commit.protocolVersion !== "chronicle-preprocessing-runtime/v1" ||
    commit.command !== "ExecuteWorkspace" ||
    commit.workspaceId !== expectedWorkspaceId ||
    commit.previousWorkspaceRootDigest !== expectedPreviousRoot ||
    !Array.isArray(commit.requiredViewIds) ||
    !["certified_narrow", "conservative_full"].includes(
      commit.dependencyCacheMode,
    ) ||
    !commit.artifactDigests.includes(commit.dependencyCertificateDigest) ||
    !commit.artifactDigests.includes(commit.journalDigest) ||
    !commit.artifactDigests.includes(commit.artifactClosureDigest)
  ) {
    throw new Error("recovered workspace root contract is invalid");
  }
  const retained = new Set(retainedDigests);
  const assignmentDigests = Object.values(commit.assignmentDigests ?? {});
  if (
    !commit.artifactDigests.every((digest) => retained.has(digest)) ||
    !assignmentDigests.every((digest) => retained.has(digest)) ||
    !retained.has(commit.inputDigest) ||
    !retained.has(commit.optionsDigest)
  ) {
    throw new Error("recovered workspace closure is incomplete");
  }
  const journal = await object(commit.journalDigest);
  kernel.verify_evidence_journal_cbor(journal);
  const closure = JSON.parse(
    new TextDecoder().decode(await object(commit.artifactClosureDigest)),
  ) as {
    protocolVersion: string;
    workspaceId: string;
    journalDigest: string;
    dependencyCertificateDigest: string;
    artifacts: Array<{ digest: string }>;
  };
  if (
    closure.protocolVersion !== "chronicle-artifact-closure/v1" ||
    closure.workspaceId !== expectedWorkspaceId ||
    closure.journalDigest !== commit.journalDigest ||
    closure.dependencyCertificateDigest !== commit.dependencyCertificateDigest ||
    !closure.artifacts.every(({ digest }) =>
      commit.artifactDigests.includes(digest),
    )
  ) {
    throw new Error("recovered artifact closure is invalid");
  }
  const foundViewIds = new Set<string>();
  for (const digest of retained) {
    if (commit.artifactDigests.includes(digest) || digest === expectedWorkspaceRootDigest) {
      continue;
    }
    try {
      const candidate = JSON.parse(new TextDecoder().decode(await object(digest))) as {
        view_id?: string;
        root_digest?: string;
      };
      if (
        candidate.view_id &&
        candidate.root_digest === expectedWorkspaceRootDigest
      ) {
        foundViewIds.add(candidate.view_id);
      }
    } catch {
      // Non-view extras are allowed only when another root contract field
      // binds them; they do not satisfy a required typed projection.
    }
  }
  if (!commit.requiredViewIds.every((viewId) => foundViewIds.has(viewId))) {
    throw new Error("recovered workspace is missing a required typed view");
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
  const parsed: unknown = JSON.parse(kernel.inspect_raw_file_v1(csvBytes, fileName, sizeBytes));
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
): Promise<
  WorkspaceRootSlot | undefined
> {
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
    throw new Error("runtime closure workspace identity does not match the import target");
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
  const closure = JSON.parse(
    new TextDecoder().decode(
      await readRuntimeObject(root, rootCommit.artifactClosureDigest),
    ),
  ) as { artifacts: Array<{ kind: string; digest: string }> };
  const artifact = closure.artifacts.find((candidate) => candidate.kind === kind);
  if (!artifact) throw new Error(`persisted Rust artifact is missing: ${kind}`);
  return readRuntimeObject(root, artifact.digest);
}

/** Test-only dependency seam for deterministic OPFS fault/recovery tests. */
export function setRustPersistenceForTesting(
  adapter: RustPersistenceAdapter | null,
): void {
  persistenceAdapter = adapter ?? defaultPersistenceAdapter;
}

async function loadKernel(): Promise<KernelModule> {
  if (!initPromise) {
    /* v8 ignore start -- Vite's browser WASM loader is exercised by the Playwright offline/runtime smoke; unit tests inject the exact compiled module bytes. */
    initPromise = (async () => {
      const module =
        (await import("@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js")) as unknown as KernelModule;
      await module.default();
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
    options.timezoneHandling.startsWith("selected-") && !options.selectedTimezone?.trim()
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
export function rustV2IneligibilityReasons(
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

async function compareArtifact(
  kind: RustShadowArtifactComparison["kind"],
  tsResult: ProcessedFileResult,
  rustBytes: Uint8Array,
): Promise<RustShadowArtifactComparison> {
  const outputSuffix = {
    "credited-app": " Credited App Usage.csv",
    "day-coverage": " Day Coverage.csv",
    compliance: " Compliance Report.csv",
    "aggregate-daily": " Daily Summary.csv",
    "aggregate-weekly": " Weekly Summary.csv",
    "aggregate-top-apps": " Top Apps.csv",
    "aggregate-category-budget": " Category Time Budget.csv",
    "aggregate-co-usage": " App Co-Usage.csv",
    "app-spss": " Automatically Preprocessed.sav",
    "screen-spss": " Screen Usage Automatically Preprocessed.sav",
  } as const;
  const tsOutput = tsResult.outputs.find((output) => {
    if (kind === "app" || kind === "screen") return output.kind === kind;
    if (kind === "app-parquet" || kind === "screen-parquet") return false;
    return output.outputFileName.endsWith(outputSuffix[kind]);
  });
  const tsBytes = tsOutput
    ? new Uint8Array(await tsOutput.blob.arrayBuffer())
    : new Uint8Array();
  const [typescriptSha256, rustSha256] = await Promise.all([
    sha256Hex(tsBytes),
    sha256Hex(rustBytes),
  ]);
  return {
    kind,
    typescriptSha256,
    rustSha256,
    typescriptBytes: tsBytes.byteLength,
    rustBytes: rustBytes.byteLength,
    matches:
      typescriptSha256 === rustSha256 &&
      tsBytes.byteLength === rustBytes.byteLength,
    comparison: "exact-bytes",
  };
}

async function compareParquetArtifact(
  kind: "app-parquet" | "screen-parquet",
  tsResult: ProcessedFileResult,
  rustBytes: Uint8Array,
): Promise<RustShadowArtifactComparison> {
  const suffix =
    kind === "app-parquet"
      ? " Automatically Preprocessed.parquet"
      : " Screen Usage Automatically Preprocessed.parquet";
  const tsOutput = tsResult.outputs.find(
    (output) =>
      output.kind === "parquet" && output.outputFileName.endsWith(suffix),
  );
  const tsBytes = tsOutput
    ? new Uint8Array(await tsOutput.blob.arrayBuffer())
    : new Uint8Array();
  const { parquetReadObjects } = await import("hyparquet");
  const read = (bytes: Uint8Array) =>
    parquetReadObjects({
      file: {
        byteLength: bytes.byteLength,
        slice: (start: number, end?: number) => {
          const buffer = bytes.buffer;
          const absoluteStart = bytes.byteOffset + start;
          const absoluteEnd = bytes.byteOffset + (end ?? bytes.byteLength);
          return buffer instanceof ArrayBuffer
            ? buffer.slice(absoluteStart, absoluteEnd)
            : new Uint8Array(bytes.subarray(start, end)).buffer;
        },
      },
    });
  const [typescriptRows, rustRows, typescriptSha256, rustSha256] =
    await Promise.all([
      read(tsBytes),
      read(rustBytes),
      sha256Hex(tsBytes),
      sha256Hex(rustBytes),
    ]);
  return {
    kind,
    typescriptSha256,
    rustSha256,
    typescriptBytes: tsBytes.byteLength,
    rustBytes: rustBytes.byteLength,
    matches: canonicalJson(typescriptRows) === canonicalJson(rustRows),
    comparison: "decoded-values",
  };
}

function firstJsonDifference(
  left: unknown,
  right: unknown,
  path = "$",
): string | undefined {
  if (Object.is(left, right)) return undefined;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return `${path}.length: Rust=${left.length} TypeScript=${right.length}`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstJsonDifference(
        left[index],
        right[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return undefined;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const keys = new Set([
      ...Object.keys(left),
      ...Object.keys(right),
    ]);
    for (const key of [...keys].sort()) {
      const difference = firstJsonDifference(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (difference) return difference;
    }
    return undefined;
  }
  return `${path}: Rust=${JSON.stringify(left)} TypeScript=${JSON.stringify(right)}`;
}

async function executeRustRuntimeUnlocked(
  workspaceId: string,
  csvBytes: Uint8Array,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  inputSha256: string,
): Promise<RustRuntimeExecution> {
  const reasons = rustV2IneligibilityReasons(options);
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
      ["study_dates_file", supportFiles?.studyDatesFile?.name ?? "study_dates.csv"],
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
      recoveredRoot = await persistenceAdapter.recover(opfsRoot);
      if (recoveredRoot) {
        await persistenceAdapter.verify?.(
          opfsRoot,
          recoveredRoot,
          kernel,
          workspaceId,
        );
      }
    }
    const requestId = `execute-${inputSha256.slice(0, 16)}`;
    handle = kernel.execute_workspace(
      JSON.stringify({
        protocolVersion: "chronicle-preprocessing-runtime/v1",
        requestId,
        command: "ExecuteWorkspace",
        workspaceRootDigest: recoveredRoot?.workspaceRootDigest ?? null,
        workspaceId,
        inputFileName,
        inputSha256: `sha256:${inputSha256}`,
        options: buildRustV2Options(options, runtime),
      }),
      csvBytes,
      runtimeSupportFiles,
    );
    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(handle.manifest_json());
    } catch (error) {
      throw new Error(
        `runtime manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const manifest = decodeRuntimeManifest(manifestValue);
    if (manifest.requestId !== requestId) {
      throw new Error("runtime manifest request identity mismatch");
    }
    if (manifest.workspaceId !== workspaceId) {
      throw new Error("runtime manifest workspace identity mismatch");
    }
    if (manifest.implementationDigest !== kernel.implementation_build_digest()) {
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
    if (
      manifest.previousWorkspaceRootDigest !==
      (recoveredRoot?.workspaceRootDigest ?? null)
    ) {
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
      if (
        assignment.artifact.size !== bytes.byteLength
      ) {
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
    const persistedWorkspace =
      runtime.persistRustWorkspace && opfsRoot
        ? await persistenceAdapter.persist(opfsRoot, {
            workspaceRootDigest: manifest.workspaceRootDigest,
            previousWorkspaceRootDigest:
              manifest.previousWorkspaceRootDigest,
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
        console.warn("Committed Rust workspace but could not reclaim stale OPFS objects", error);
      }
    }
    return { workspaceId, manifest, artifacts, persistedWorkspace };
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
    throw new Error("verified input digest must be 64 lowercase hexadecimal characters");
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
): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    throw new Error(
      "Durable workspace mutation requires the browser Web Locks API",
    );
  }
  return navigator.locks.request(
    `chronicle-preprocessing:${workspaceId}`,
    { mode: "exclusive" },
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

export async function runRustV2Shadow(
  csvBytes: Uint8Array,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  typescriptResult: ProcessedFileResult,
): Promise<RustShadowReport> {
  const reasons = rustV2IneligibilityReasons(options);
  if (reasons.length > 0) {
    return {
      protocolVersion: "chronicle-rust-shadow/v1",
      implementation:
        "chronicle_preprocessing_runtime_wasm/execute_bounded_v2_shadow",
      scope: "selected-runtime-csv-artifacts",
      status: "ineligible",
      reasons,
      artifacts: [],
    };
  }

  try {
    const execution = await executeRustRuntime(
      csvBytes,
      typescriptResult.inputFileName,
      options,
      supportFiles,
      runtime,
    );
    const { manifest, artifacts: runtimeArtifacts, persistedWorkspace } =
      execution;
    const rustCounts = manifest.counts;
    const tsCounts = {
      original: typescriptResult.originalRowCount,
      processed: typescriptResult.processedRowCount,
      app: typescriptResult.appRowCount,
      screen: typescriptResult.screenRowCount,
    };
    const artifacts = await Promise.all([
      ...(options.processAppUsage
        ? [
            compareArtifact(
              "app" as const,
              typescriptResult,
              runtimeArtifacts.get("app-csv") ?? new Uint8Array(),
            ),
          ]
        : []),
      ...(options.processScreenUsage
        ? [
            compareArtifact(
              "screen" as const,
              typescriptResult,
              runtimeArtifacts.get("screen-csv") ?? new Uint8Array(),
            ),
          ]
        : []),
      ...(options.enableDayCoverage
        ? [
            compareArtifact(
              "day-coverage" as const,
              typescriptResult,
              runtimeArtifacts.get("day-coverage-csv") ?? new Uint8Array(),
            ),
          ]
        : []),
      ...(options.enableScreenGatedCrediting
        ? [
            compareArtifact(
              "credited-app" as const,
              typescriptResult,
              runtimeArtifacts.get("credited-app-csv") ?? new Uint8Array(),
            ),
          ]
        : []),
      ...(options.enableComplianceScoring
        ? [
            compareArtifact(
              "compliance" as const,
              typescriptResult,
              runtimeArtifacts.get("compliance-csv") ?? new Uint8Array(),
            ),
          ]
        : []),
      ...(options.enableAggregates
        ? [
            compareArtifact(
              "aggregate-daily" as const,
              typescriptResult,
              runtimeArtifacts.get("aggregate-daily-summary-csv") ??
                new Uint8Array(),
            ),
            compareArtifact(
              "aggregate-weekly" as const,
              typescriptResult,
              runtimeArtifacts.get("aggregate-weekly-summary-csv") ??
                new Uint8Array(),
            ),
            compareArtifact(
              "aggregate-top-apps" as const,
              typescriptResult,
              runtimeArtifacts.get("aggregate-top-apps-csv") ??
                new Uint8Array(),
            ),
            ...(options.useAppCodebook
              ? [
                  compareArtifact(
                    "aggregate-category-budget" as const,
                    typescriptResult,
                    runtimeArtifacts.get(
                      "aggregate-category-time-budget-csv",
                    ) ?? new Uint8Array(),
                  ),
                ]
              : []),
            ...(options.modelConcurrentUsage || options.useBackgroundAppsFile
              ? [
                  compareArtifact(
                    "aggregate-co-usage" as const,
                    typescriptResult,
                    runtimeArtifacts.get("aggregate-app-co-usage-csv") ??
                      new Uint8Array(),
                  ),
                ]
              : []),
          ]
        : []),
      ...(options.enableParquetExport
        ? [
            ...(options.processAppUsage
              ? [
                  compareParquetArtifact(
                    "app-parquet",
                    typescriptResult,
                    runtimeArtifacts.get("app-parquet") ?? new Uint8Array(),
                  ),
                ]
              : []),
            ...(options.processScreenUsage
              ? [
                  compareParquetArtifact(
                    "screen-parquet",
                    typescriptResult,
                    runtimeArtifacts.get("screen-parquet") ?? new Uint8Array(),
                  ),
                ]
              : []),
          ]
        : []),
      ...(options.enableSpssExport
        ? [
            ...(options.processAppUsage
              ? [
                  compareArtifact(
                    "app-spss",
                    typescriptResult,
                    runtimeArtifacts.get("app-spss") ?? new Uint8Array(),
                  ),
                ]
              : []),
            ...(options.processScreenUsage
              ? [
                  compareArtifact(
                    "screen-spss",
                    typescriptResult,
                    runtimeArtifacts.get("screen-spss") ?? new Uint8Array(),
                  ),
                ]
              : []),
          ]
        : []),
    ]);
    const rustReviewSummary = JSON.parse(
      new TextDecoder().decode(
        runtimeArtifacts.get("review-summary-json") ?? new Uint8Array(),
      ),
    ) as unknown;
    const reviewSummaryMatches =
      canonicalJson(rustReviewSummary) ===
      canonicalJson(typescriptResult.reviewSummary ?? { participants: [] });
    const reviewSummaryDifference = reviewSummaryMatches
      ? undefined
      : firstJsonDifference(
          rustReviewSummary,
          typescriptResult.reviewSummary ?? { participants: [] },
        );
    const countsMatch = JSON.stringify(tsCounts) === JSON.stringify(rustCounts);
    const matched =
      countsMatch &&
      reviewSummaryMatches &&
      artifacts.every((artifact) => artifact.matches);
    return {
      protocolVersion: "chronicle-rust-shadow/v1",
      implementation:
        "chronicle_preprocessing_runtime_wasm/execute_bounded_v2_shadow",
      scope: "selected-runtime-csv-artifacts",
      status: matched ? "matched" : "diverged",
      reasons: matched
        ? []
        : [
            "selected Rust CSV artifacts, review summary, or authoritative counts differ",
            ...(reviewSummaryDifference ? [reviewSummaryDifference] : []),
          ],
      artifacts,
      workspaceRootDigest: manifest.workspaceRootDigest,
      implementationDigest: manifest.implementationDigest,
      planDigest: manifest.planDigest,
      productContractDigest: manifest.productContractDigest,
      openObligationCount: manifest.openObligations.length,
      journalDigest: manifest.journalDigest,
      reviewSummaryMatches,
      ...(persistedWorkspace
        ? {
            persistedWorkspace: {
              generation: persistedWorkspace.generation,
              workspaceRootDigest: persistedWorkspace.workspaceRootDigest,
            },
          }
        : {}),
      counts: { typescript: tsCounts, rust: rustCounts, matches: countsMatch },
    };
  } catch (error) {
    return {
      protocolVersion: "chronicle-rust-shadow/v1",
      implementation:
        "chronicle_preprocessing_runtime_wasm/execute_bounded_v2_shadow",
      scope: "selected-runtime-csv-artifacts",
      status: "failed",
      reasons: [error instanceof Error ? error.message : String(error)],
      artifacts: [],
    };
  }
}
