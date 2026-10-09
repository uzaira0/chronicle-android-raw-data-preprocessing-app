import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type {
  PersistedRuntimeArtifact,
  WorkspaceRootSlot,
} from "@/lib/opfsArtifactStore";
import {
  MemoryDirectoryHandle,
  memoryDirectoryHandle,
} from "@/testSupport/memoryFileSystem";

const opfs = vi.hoisted(() => ({
  collectRuntimeHistoryDigests: vi.fn(),
  collectRuntimeVerifiedHistory: vi.fn(),
  exportRuntimeClosure: vi.fn(),
  garbageCollectRuntimeObjects: vi.fn(),
  importRuntimeClosure: vi.fn(),
  inspectVerifiedRuntimeClosure: vi.fn(),
  openOpfsWorkspace: vi.fn(),
  persistRuntimeWorkspace: vi.fn(),
  readRuntimeObject: vi.fn(),
  readRuntimeObjectPrefix: vi.fn(),
  recoverRuntimeWorkspace: vi.fn(),
  recoverRuntimeWorkspaceHead: vi.fn(),
  recoverRuntimeWorkspaceRoots: vi.fn(),
  removeOpfsWorkspace: vi.fn(),
  runtimeClosureWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/opfsArtifactStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/opfsArtifactStore")>()),
  ...opfs,
}));

import {
  executeRustRuntime,
  discoverRustTimezones,
  exportPersistedRustWorkspace,
  FRESH_PORTABLE_SEMANTIC_INDEX_REVISION,
  garbageCollectPersistedRustWorkspace,
  getRustWorkflowExplorerView,
  getRustRuntimeVersion,
  initializeRustRuntime,
  importPersistedRustWorkspace,
  importPersistedRustWorkspaceArchive,
  installRustPayloadSpill,
  readVerifiedPersistedRustWorkspaceArchiveCapture,
  SavedByOtherAppVersionError,
  inspectRustRawFile,
  queryPersistedRustReview,
  queryRustReview,
  readPersistedRustArtifact,
  readPersistedRustReviewBases,
  readPersistedRustWorkspaceHead,
  readVerifiedSemanticIndexSnapshot,
  readVerifiedSemanticIndexSnapshotFromArchive,
  runtimeWorkspaceId,
  setRustRuntimeForTesting,
  setRustPersistenceForTesting,
  verifyPersistedRustWorkspace,
  RustMaximumDurationRefusalError,
  RustOpenerSetRefusalError,
  RustScientificPreflightRefusalError,
} from "@/lib/rustPipelineRuntime";
import { runtimeScientificPreflightFixture } from "@/testSupport/runtimeScientificPreflightFixture";
import type { PayloadSpillBridge } from "@/workers/payloadSpill";

const enc = new TextEncoder();
const workspaceId = `sha256:${"1".repeat(64)}`;
const rootDigest = `sha256:${"2".repeat(64)}`;
const journalDigest = `sha256:${"3".repeat(64)}`;
const closureDigest = `sha256:${"4".repeat(64)}`;
const payloadDigest = `sha256:${"5".repeat(64)}`;
const previousDigest = `sha256:${"6".repeat(64)}`;
const dependencyCertificateDigest = `sha256:${"8".repeat(64)}`;
const executionStateDigest = `sha256:${"9".repeat(64)}`;
const implementationDigest = `sha256:${"0".repeat(64)}`;
const buildEnvironmentDigest = `sha256:${"f".repeat(64)}`;
const productContractDigest = `sha256:${"e".repeat(64)}`;
const planDigest = `sha256:${"d".repeat(64)}`;
const profileDigest = `sha256:${"c".repeat(64)}`;
const profileLockDigest = `sha256:${"b".repeat(64)}`;
const runtimeAuthorityDigest = `sha256:${"a".repeat(64)}`;
const workflowModelVersion = "workflow-v1";
const workflowContractDigests = {
  semantic: `sha256:${"01".repeat(32)}`,
  presentation: `sha256:${"23".repeat(32)}`,
  execution: `sha256:${"45".repeat(32)}`,
  checkpointPolicy: `sha256:${"67".repeat(32)}`,
  evidence: `sha256:${"89".repeat(32)}`,
  workspaceCompatibility: `sha256:${"ab".repeat(32)}`,
};
const viewDigests = ["a", "b", "c", "d"].map(
  (marker) => `sha256:${marker.repeat(64)}`,
);
function viewDigest(index: number): string {
  const digest = viewDigests[index];
  if (digest === undefined) throw new Error(`no view digest at index ${index}`);
  return digest;
}
const root = {} as FileSystemDirectoryHandle;
const archive = new Blob([enc.encode("archive")]);
const workspaceLockRequest = vi.fn();
const supportHandleFree = vi.fn();

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

type VerifiedRuntimeHistory = {
  digests: string[];
  verifiedSizes: ReadonlyMap<string, number>;
  headDirectDigests: string[];
};

/** The history fake installed by `beforeEach`, typed so one test can wrap it. */
function intactRuntimeHistory(): (
  root: FileSystemDirectoryHandle,
  head: string,
) => Promise<VerifiedRuntimeHistory> {
  return opfs.collectRuntimeVerifiedHistory.getMockImplementation() as (
    root: FileSystemDirectoryHandle,
    head: string,
  ) => Promise<VerifiedRuntimeHistory>;
}

function encodedArtifact(
  kind: string,
  bytes: Uint8Array,
): PersistedRuntimeArtifact {
  return {
    kind,
    digest: digestBytes(bytes),
    size: bytes.byteLength,
    bytes,
  };
}

function buildPortableSemanticWorkspace(
  previousWorkspaceRootDigest: string | null,
): {
  artifacts: PersistedRuntimeArtifact[];
  workspaceRootDigest: string;
  dependencyCertificateDigest: string;
  source: Uint8Array;
  scientificArtifactBundle: Uint8Array;
} {
  const scientific = [
    encodedArtifact(
      "b05-schoedel-validation-receipt-json",
      enc.encode(JSON.stringify({ protocolVersion: "synthetic-validation/v1" })),
    ),
    encodedArtifact(
      "foundational-semantics-receipt-json",
      enc.encode(JSON.stringify({ protocolVersion: "synthetic-foundational/v1" })),
    ),
  ];
  const artifactMetadata = (value: PersistedRuntimeArtifact) => ({
    artifactId: `urn:test:${value.kind}`,
    kind: value.kind,
    mediaType: value.kind.endsWith("json")
      ? "application/json"
      : "application/octet-stream",
    digest: value.digest,
    size: value.size,
    derivedFrom: [],
  });
  const source = encodedArtifact(
    "semantic-index-source-json",
    enc.encode(
      JSON.stringify({
        protocolVersion: "chronicle-semantic-index-source/v7",
        scientificValidationSubstrateKinds: scientific.map(({ kind }) => kind),
        scientificEvidenceArtifacts: scientific.map(artifactMetadata),
      }),
    ),
  );
  const journal = encodedArtifact("evidence-journal", enc.encode("synthetic journal"));
  const certificate = encodedArtifact(
    "dependency-certificate-json",
    enc.encode(JSON.stringify({ protocolVersion: "synthetic-certificate/v1" })),
  );
  const assignmentDigests = { raw_chronicle_csv: source.digest };
  const stateArtifacts = [journal, source, certificate, ...scientific];
  const state = encodedArtifact(
    "execution-state-json",
    enc.encode(
      JSON.stringify({
        protocolVersion: "chronicle-execution-state/v1",
        implementationDigest,
        buildEnvironmentDigest,
        productContractDigest,
        planDigest,
        profileDigest,
        profileLockDigest,
        runtimeAuthorityDigest,
        dependencyCertificateDigest: certificate.digest,
        dependencyCacheMode: "certified_narrow",
        workspaceId,
        previousWorkspaceRootDigest,
        inputDigest: source.digest,
        optionsDigest: source.digest,
        assignmentDigests,
        computationalArtifactDigests: stateArtifacts.map(({ digest }) => digest),
        journalDigest: journal.digest,
      }),
    ),
  );
  const viewSpecs = [
    {
      kind: "workflow-explorer-view-json",
      viewId: "chronicle-workflow-explorer/v1",
      schemaId: "urn:chronicle:view:workflow-explorer:v1",
      value: {
        protocolVersion: "chronicle-workflow-explorer/v1",
        viewId: "chronicle-workflow-explorer/v1",
        schemaId: "urn:chronicle:view:workflow-explorer:v1",
        revision: 1,
        rootDigest: state.digest,
        selectedRunRoot: state.digest,
        contractDigests: workflowContractDigests,
        phases: [],
        operations: [],
        artifacts: [],
        queries: [],
        decisions: [],
      },
    },
    ...[
      ["artifact-view-json", "chronicle.artifact.v1", "urn:chronicle:view:artifact:v1"],
      [
        "obligation-view-json",
        "chronicle.obligation.v1",
        "urn:chronicle:view:obligation:v1",
      ],
      [
        "explanation-view-json",
        "chronicle.explanation.v1",
        "urn:chronicle:view:explanation:v1",
      ],
    ].map(([kind, viewId, schemaId]) => ({
      kind: kind!,
      viewId: viewId!,
      schemaId: schemaId!,
      value: {
        protocol_version: "0.1",
        view_id: viewId,
        family: "incremental-dataflow",
        schema_id: schemaId,
        revision: 1,
        root_digest: state.digest,
        payload: {},
      },
    })),
  ];
  const views = viewSpecs.map(({ kind, value }) =>
    encodedArtifact(kind, enc.encode(JSON.stringify(value))),
  );
  const closureMembers = [journal, source, certificate, state, ...views, ...scientific];
  const closure = encodedArtifact(
    "artifact-closure-json",
    enc.encode(
      JSON.stringify({
        protocolVersion: "chronicle-artifact-closure/v1",
        workspaceId,
        inputDigest: source.digest,
        implementationDigest,
        buildEnvironmentDigest,
        planDigest,
        profileDigest,
        profileLockDigest,
        runtimeAuthorityDigest,
        productContractDigest,
        journalDigest: journal.digest,
        dependencyCertificateDigest: certificate.digest,
        dependencyCacheMode: "certified_narrow",
        previousWorkspaceRootDigest,
        optionsDigest: source.digest,
        assignmentDigests,
        executionStateDigest: state.digest,
        artifacts: closureMembers.map(artifactMetadata),
      }),
    ),
  );
  const artifactDigests = [...closureMembers.map(({ digest }) => digest), closure.digest];
  const rootArtifact = encodedArtifact(
    "workspace-root-json",
    enc.encode(
      JSON.stringify({
        protocolVersion: "chronicle-preprocessing-runtime/v2",
        workflowModelVersion,
        workflowCompatibilityDigest: workflowContractDigests.workspaceCompatibility,
        command: "ExecuteWorkspace",
        implementationDigest,
        buildEnvironmentDigest,
        productContractDigest,
        planDigest,
        profileDigest,
        profileLockDigest,
        runtimeAuthorityDigest,
        dependencyCertificateDigest: certificate.digest,
        dependencyCacheMode: "certified_narrow",
        workspaceId,
        previousWorkspaceRootDigest,
        inputDigest: source.digest,
        optionsDigest: source.digest,
        assignmentDigests,
        artifactDigests,
        executionStateDigest: state.digest,
        requiredViews: viewSpecs.map(({ kind, viewId, schemaId }, index) => ({
          artifactKind: kind,
          viewId,
          schemaId,
          artifactDigest: views[index]!.digest,
        })),
        journalDigest: journal.digest,
        artifactClosureDigest: closure.digest,
      }),
    ),
  );
  const scientificArtifactBundle = new Uint8Array(
    scientific.reduce((total, value) => total + value.size, 0),
  );
  let offset = 0;
  for (const value of scientific) {
    scientificArtifactBundle.set(value.bytes, offset);
    offset += value.size;
  }
  return {
    artifacts: [rootArtifact, closure, ...closureMembers],
    workspaceRootDigest: rootArtifact.digest,
    dependencyCertificateDigest: certificate.digest,
    source: source.bytes,
    scientificArtifactBundle,
  };
}

function reviewCacheWorkspace(input: {
  review?: Uint8Array;
  reconstruction?: Uint8Array;
  reviewDeclaredSize?: number;
  reconstructionDeclaredSize?: number;
  rootBuildEnvironmentDigest?: string;
  datetimeOfPreprocessing?: string | null;
}) {
  const artifacts: Array<{
    kind: string;
    digest: string;
    size: number;
  }> = [];
  const objects = new Map<string, Uint8Array>();
  for (const [kind, bytes] of [
    ["review-base", input.review],
    ["reconstruction-base", input.reconstruction],
  ] as const) {
    if (!bytes) continue;
    const digest = digestBytes(bytes);
    const declaredSize =
      kind === "review-base"
        ? input.reviewDeclaredSize
        : input.reconstructionDeclaredSize;
    artifacts.push({ kind, digest, size: declaredSize ?? bytes.byteLength });
    objects.set(digest, bytes);
  }
  if (input.datetimeOfPreprocessing !== null) {
    const processingOptions = enc.encode(
      JSON.stringify({
        datetime_of_preprocessing:
          input.datetimeOfPreprocessing ?? "2026-04-24 00:32:53",
      }),
    );
    const digest = digestBytes(processingOptions);
    artifacts.push({
      kind: "processing-options-json",
      digest,
      size: processingOptions.byteLength,
    });
    objects.set(digest, processingOptions);
  }
  const rootBuildEnvironmentDigest =
    input.rootBuildEnvironmentDigest ?? buildEnvironmentDigest;
  const closureBytes = enc.encode(
    JSON.stringify({
      implementationDigest,
      buildEnvironmentDigest: rootBuildEnvironmentDigest,
      workspaceId,
      inputDigest: payloadDigest,
      artifacts,
    }),
  );
  const artifactClosureDigest = digestBytes(closureBytes);
  objects.set(artifactClosureDigest, closureBytes);
  const rootBytes = enc.encode(
    JSON.stringify({
      artifactClosureDigest,
      implementationDigest,
      buildEnvironmentDigest: rootBuildEnvironmentDigest,
      workspaceId,
      inputDigest: payloadDigest,
    }),
  );
  const cacheRootDigest = digestBytes(rootBytes);
  objects.set(cacheRootDigest, rootBytes);
  return {
    objects,
    slot: {
      ...slot,
      workspaceRootDigest: cacheRootDigest,
      artifactDigests: [cacheRootDigest, artifactClosureDigest],
    },
  };
}

/**
 * A persisted workspace addressed by the SAME workspace id a real
 * `queryPersistedRustReview` call derives from its verified input digest, so
 * the review path reaches the probe reader instead of failing identity checks
 * first. `reviewCacheWorkspace` above pins the shared fixture identity; this
 * one is parameterised because the review entry point computes its own.
 */
function persistedReviewWorkspace(input: {
  reviewWorkspaceId: string;
  inputDigest: string;
  artifacts: ReadonlyArray<{
    kind: string;
    bytes: Uint8Array;
    declaredSize?: number;
  }>;
}) {
  const objects = new Map<string, Uint8Array>();
  const closureArtifacts = input.artifacts.map(
    ({ kind, bytes, declaredSize }) => {
      const digest = digestBytes(bytes);
      objects.set(digest, bytes);
      return { kind, digest, size: declaredSize ?? bytes.byteLength };
    },
  );
  const identity = {
    implementationDigest,
    buildEnvironmentDigest,
    workspaceId: input.reviewWorkspaceId,
    inputDigest: input.inputDigest,
  };
  const closureBytes = enc.encode(
    JSON.stringify({ ...identity, artifacts: closureArtifacts }),
  );
  const artifactClosureDigest = digestBytes(closureBytes);
  objects.set(artifactClosureDigest, closureBytes);
  const rootBytes = enc.encode(
    JSON.stringify({ artifactClosureDigest, ...identity }),
  );
  const workspaceRootDigest = digestBytes(rootBytes);
  objects.set(workspaceRootDigest, rootBytes);
  return {
    objects,
    slot: {
      ...slot,
      workspaceRootDigest,
      artifactDigests: [workspaceRootDigest, artifactClosureDigest],
    },
  };
}

const slot: WorkspaceRootSlot = {
  protocolVersion: "chronicle-opfs-root/v1",
  generation: 1,
  workspaceRootDigest: rootDigest,
  previousWorkspaceRootDigest: null,
  artifactDigests: [
    rootDigest,
    journalDigest,
    closureDigest,
    payloadDigest,
    dependencyCertificateDigest,
    executionStateDigest,
    ...viewDigests,
  ],
  checksum: `sha256:${"7".repeat(64)}`,
};

const validCommit = {
  protocolVersion: "chronicle-preprocessing-runtime/v2",
  workflowModelVersion,
  workflowCompatibilityDigest:
    workflowContractDigests.workspaceCompatibility,
  command: "ExecuteWorkspace",
  implementationDigest,
  buildEnvironmentDigest,
  productContractDigest,
  planDigest,
  profileDigest,
  profileLockDigest,
  runtimeAuthorityDigest,
  workspaceId,
  previousWorkspaceRootDigest: null,
  inputDigest: payloadDigest,
  optionsDigest: payloadDigest,
  assignmentDigests: { raw_chronicle_csv: payloadDigest },
  artifactDigests: [
    journalDigest,
    closureDigest,
    payloadDigest,
    dependencyCertificateDigest,
    executionStateDigest,
    ...viewDigests,
  ],
  executionStateDigest,
  requiredViews: (
    [
      ["workflow-explorer-view-json", "chronicle-workflow-explorer/v1", "urn:chronicle:view:workflow-explorer:v1"],
      [
        "artifact-view-json",
        "chronicle.artifact.v1",
        "urn:chronicle:view:artifact:v1",
      ],
      [
        "obligation-view-json",
        "chronicle.obligation.v1",
        "urn:chronicle:view:obligation:v1",
      ],
      [
        "explanation-view-json",
        "chronicle.explanation.v1",
        "urn:chronicle:view:explanation:v1",
      ],
    ] satisfies Array<[string, string, string]>
  ).map(([artifactKind, viewId, schemaId], index) => ({
    artifactKind,
    viewId,
    schemaId,
    artifactDigest: viewDigest(index),
  })),
  journalDigest,
  artifactClosureDigest: closureDigest,
  dependencyCertificateDigest,
  dependencyCacheMode: "certified_narrow",
};
const viewValues = validCommit.requiredViews.map((binding) =>
  binding.viewId === "chronicle-workflow-explorer/v1"
    ? {
        protocolVersion: "chronicle-workflow-explorer/v1",
        viewId: binding.viewId,
        schemaId: binding.schemaId,
        revision: 1,
        rootDigest: executionStateDigest,
        selectedRunRoot: executionStateDigest,
        contractDigests: workflowContractDigests,
        phases: [],
        operations: [],
        artifacts: [],
        queries: [],
        decisions: [],
      }
    : {
        protocol_version: "0.1",
        view_id: binding.viewId,
        family: "incremental-dataflow",
        schema_id: binding.schemaId,
        revision: 1,
        root_digest: executionStateDigest,
        payload: {},
      },
);
const executionState = {
  protocolVersion: "chronicle-execution-state/v1",
  implementationDigest,
  buildEnvironmentDigest,
  productContractDigest,
  planDigest,
  profileDigest,
  profileLockDigest,
  runtimeAuthorityDigest,
  dependencyCertificateDigest,
  dependencyCacheMode: "certified_narrow",
  workspaceId,
  previousWorkspaceRootDigest: null,
  inputDigest: payloadDigest,
  optionsDigest: payloadDigest,
  assignmentDigests: { raw_chronicle_csv: payloadDigest },
  computationalArtifactDigests: [
    journalDigest,
    payloadDigest,
    dependencyCertificateDigest,
  ],
  journalDigest,
};
const artifactBytes = new Map<string, Uint8Array>([
  [journalDigest, enc.encode("journal")],
  [payloadDigest, enc.encode("payload")],
  [dependencyCertificateDigest, enc.encode("dependency certificate")],
  [executionStateDigest, enc.encode(JSON.stringify(executionState))],
  ...viewDigests.map(
    (digest, index) =>
      [digest, enc.encode(JSON.stringify(viewValues[index]))] as const,
  ),
]);
const metadata = (kind: string, digest: string) => ({
  artifactId: `urn:test:${kind}`,
  kind,
  mediaType: kind.endsWith("json")
    ? "application/json"
    : "application/octet-stream",
  digest,
  size: artifactBytes.get(digest)!.byteLength,
  derivedFrom: [],
});
const validClosure = {
  protocolVersion: "chronicle-artifact-closure/v1",
  workspaceId,
  inputDigest: payloadDigest,
  implementationDigest,
  buildEnvironmentDigest,
  planDigest,
  profileDigest,
  profileLockDigest,
  runtimeAuthorityDigest,
  productContractDigest,
  journalDigest,
  dependencyCertificateDigest,
  dependencyCacheMode: "certified_narrow",
  previousWorkspaceRootDigest: null,
  optionsDigest: payloadDigest,
  assignmentDigests: { raw_chronicle_csv: payloadDigest },
  executionStateDigest,
  artifacts: [
    metadata("evidence-journal", journalDigest),
    metadata("semantic-index-source-json", payloadDigest),
    metadata("dependency-certificate-json", dependencyCertificateDigest),
    metadata("execution-state-json", executionStateDigest),
    ...validCommit.requiredViews.map((binding) =>
      metadata(binding.artifactKind, binding.artifactDigest),
    ),
  ],
};

const bytesByDigest = new Map([
  [rootDigest, enc.encode(JSON.stringify(validCommit))],
  [closureDigest, enc.encode(JSON.stringify(validClosure))],
  ...artifactBytes,
]);

const kernel = {
  default: () => Promise.resolve(),
  runtime_version: vi.fn(() => "test-runtime"),
  implementation_build_digest: vi.fn(() => `sha256:${"0".repeat(64)}`),
  build_environment_digest: vi.fn(() => `sha256:${"f".repeat(64)}`),
  runtime_identity: vi.fn(() => ({
    protocolVersion: "chronicle-preprocessing-runtime/v2",
    implementationDigest,
    buildEnvironmentDigest,
    productContractDigest,
    planDigest,
    profileDigest,
    profileLockDigest,
    runtimeAuthorityDigest,
    dependencyCertificateDigest,
  })),
  runtime_identity_json: vi.fn(() =>
    JSON.stringify({
      protocolVersion: "chronicle-preprocessing-runtime/v2",
      implementationDigest,
      buildEnvironmentDigest,
      productContractDigest,
      planDigest,
      profileDigest,
      profileLockDigest,
      runtimeAuthorityDigest,
      dependencyCertificateDigest,
    }),
  ),
  workflow_contract_json: vi.fn(() =>
    JSON.stringify({
      protocolVersion: "chronicle-workflow-contract/v1",
      workflowModelVersion,
      semantic: { operations: [], artifacts: [] },
      presentation: { phases: [] },
      execution: { queryGroups: [], queries: [] },
      digests: workflowContractDigests,
    }),
  ),
  plan_workflow_explorer_view_json: vi.fn(() =>
    JSON.stringify({
      protocolVersion: "chronicle-workflow-explorer/v1",
      viewId: "chronicle-workflow-explorer/v1",
      schemaId: "urn:chronicle:view:workflow-explorer:v1",
      revision: 0,
      rootDigest,
      selectedRunRoot: null,
      contractDigests: workflowContractDigests,
      phases: [],
      operations: [],
      artifacts: [],
      queries: [],
      decisions: [],
    }),
  ),
  review_base_probe_spec_json: vi.fn(() =>
    JSON.stringify({
      reviewBaseBytes: 148,
      reconstructionBaseBytes: 116,
    }),
  ),
  opener_set_applicability_json: vi.fn((requestJson: string) => {
    const request = JSON.parse(requestJson) as {
      options: { opener_set: string; episode_reconstruction_strategy: string };
    };
    const opener = request.options.opener_set;
    const refused =
      opener === "gesis_app_scoped_starts" &&
      request.options.episode_reconstruction_strategy === "eyes_complement";
    return JSON.stringify({
      status: refused ? "refused" : "executable",
      requestedOpenerSetId: opener,
      resolvedOpenerSetId: opener,
      effectiveOpenerSetId: refused ? null : opener,
      relation: refused ? "refused" : "baseline_native",
      reasonCode: refused ? "eyes_requires_lifecycle_triplets" : null,
      optionsDigest: payloadDigest,
    });
  }),
  // The persistence fakes never select a maximum-duration policy, so the
  // runtime never consults this preflight; a call is a contract error here.
  maximum_duration_applicability_json: vi.fn((): string => {
    throw new Error("maximum-duration preflight must not run for an omitted request");
  }),
  RuntimeSupportFiles: class {
    put() {}
    put_with_name() {}
    free() {
      supportHandleFree();
    }
  },
  discover_timezones_v2: () => ["UTC"],
  inspect_raw_file_v1: () =>
    JSON.stringify({
      fileName: "raw.csv",
      sizeBytes: 3,
      rowCount: 0,
      participantCount: 0,
      warnings: [],
      columns: [],
      timezones: [],
      hasRequiredColumns: false,
      invalidTimestampCount: 0,
      missingTimestampCount: 0,
      missingTimezoneCount: 0,
      duplicateTimestampCount: 0,
      outOfOrderTimestampCount: 0,
      firstOutOfOrderRow: null,
      unrecognizedInteractionTypes: [],
    screenStartEventCount: 0,
    }),
  execute_workspace: vi.fn(),
  execute_workspace_with_review_base: vi.fn(),
  execute_workspace_with_review_bases: vi.fn(),
  prepare_persisted_workspace_review: vi.fn(),
  prepare_workspace_review: vi.fn(),
  verify_evidence_journal_cbor: vi.fn(() => 1),
  set_comparison_cache_capacity: vi.fn(),
  get_comparison_cache_retained: vi.fn(() => 0),
  set_payload_budget_bytes: vi.fn(),
  install_payload_spill: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  workspaceLockRequest.mockImplementation(
    async (
      _name: string,
      _options: LockOptions,
      operation: () => Promise<unknown>,
    ) => operation(),
  );
  vi.stubGlobal("navigator", {
    locks: {
      request: workspaceLockRequest,
    },
  });
  setRustRuntimeForTesting(kernel);
  setRustPersistenceForTesting(null);
  opfs.openOpfsWorkspace.mockResolvedValue(root);
  opfs.recoverRuntimeWorkspace.mockResolvedValue(slot);
  opfs.recoverRuntimeWorkspaceHead.mockResolvedValue(slot);
  opfs.recoverRuntimeWorkspaceRoots.mockResolvedValue([slot]);
  opfs.collectRuntimeHistoryDigests.mockResolvedValue(slot.artifactDigests);
  opfs.collectRuntimeVerifiedHistory.mockImplementation(async () => {
    const digests = (await opfs.collectRuntimeHistoryDigests()) as string[];
    return {
      digests,
      verifiedSizes: new Map(
        digests.map((digest: string) => [
          digest,
          (bytesByDigest.get(digest) ?? enc.encode("missing")).byteLength,
        ]),
      ),
      headDirectDigests: [],
    };
  });
  opfs.readRuntimeObject.mockImplementation(
    (_root: FileSystemDirectoryHandle, digest: string) =>
      Promise.resolve(
        Uint8Array.from(bytesByDigest.get(digest) ?? enc.encode("missing")),
      ),
  );
  opfs.readRuntimeObjectPrefix.mockImplementation(
    (
      _root: FileSystemDirectoryHandle,
      digest: string,
      _expectedSize: number,
      prefixBytes: number,
    ) =>
      Promise.resolve(
        (bytesByDigest.get(digest) ?? enc.encode("missing")).subarray(
          0,
          prefixBytes,
        ),
      ),
  );
  opfs.exportRuntimeClosure.mockResolvedValue(archive);
  opfs.garbageCollectRuntimeObjects.mockResolvedValue(4);
  opfs.runtimeClosureWorkspaceId.mockResolvedValue(workspaceId);
  opfs.importRuntimeClosure.mockImplementation(
    async (
      _root: FileSystemDirectoryHandle,
      _archive: Blob,
      verify: (closure: unknown) => Promise<void>,
    ) => {
      await verify({
        manifest: {
          workspaceId,
          workspaceRootDigest: rootDigest,
          previousWorkspaceRootDigest: null,
          objects: [
            rootDigest,
            journalDigest,
            closureDigest,
            payloadDigest,
            dependencyCertificateDigest,
            executionStateDigest,
            ...viewDigests,
          ].map((digest) => ({
            digest,
            size: bytesByDigest.get(digest)!.byteLength,
            offset: 0,
          })),
        },
        object: (digest: string) =>
          Promise.resolve(Uint8Array.from(bytesByDigest.get(digest)!)),
      });
      return slot;
    },
  );
  opfs.inspectVerifiedRuntimeClosure.mockResolvedValue({
    manifest: {
      protocolVersion: "chronicle-runtime-closure/v1",
      workspaceId,
      workspaceRootDigest: rootDigest,
      previousWorkspaceRootDigest: null,
      objects: [
        rootDigest,
        journalDigest,
        closureDigest,
        payloadDigest,
        dependencyCertificateDigest,
        executionStateDigest,
        ...viewDigests,
      ].map((digest) => ({
        digest,
        size: bytesByDigest.get(digest)!.byteLength,
        offset: 0,
      })),
    },
    object: (digest: string) =>
      Promise.resolve(Uint8Array.from(bytesByDigest.get(digest)!)),
  });
});

describe("persisted Rust workspace boundary", () => {
  it("rejects a digest-valid full-recovery head missing its closure digest without falling back", async () => {
    const malformedBytes = enc.encode(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(validCommit).filter(([key]) => key !== "artifactClosureDigest"),
        ),
      ),
    );
    const malformedDigest = digestBytes(malformedBytes);
    const actualOpfs = await vi.importActual<
      typeof import("@/lib/opfsArtifactStore")
    >("@/lib/opfsArtifactStore");
    const directory = memoryDirectoryHandle(new MemoryDirectoryHandle());
    const olderClosure = encodedArtifact("artifact-closure-json", enc.encode("{}"));
    const olderRoot = encodedArtifact(
      "workspace-root-json",
      enc.encode(JSON.stringify({
        workspaceId,
        previousWorkspaceRootDigest: null,
        artifactDigests: [olderClosure.digest],
        artifactClosureDigest: olderClosure.digest,
      })),
    );
    const olderSlot = await actualOpfs.persistRuntimeWorkspace(directory, {
      workspaceRootDigest: olderRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [olderRoot, olderClosure],
    });
    await actualOpfs.persistRuntimeWorkspace(directory, {
      workspaceRootDigest: malformedDigest,
      previousWorkspaceRootDigest: olderRoot.digest,
      recoveredSlot: olderSlot,
      artifacts: [encodedArtifact("workspace-root-json", malformedBytes)],
    });
    expect(
      (await actualOpfs.recoverRuntimeWorkspaceHead(directory, true))
        ?.workspaceRootDigest,
    ).toBe(malformedDigest);
    expect(
      (await actualOpfs.recoverRuntimeWorkspaceHead(directory))
        ?.workspaceRootDigest,
    ).toBe(olderRoot.digest);

    opfs.recoverRuntimeWorkspaceHead.mockResolvedValue({
      ...slot,
      workspaceRootDigest: malformedDigest,
      artifactDigests: slot.artifactDigests.map((digest) =>
        digest === rootDigest ? malformedDigest : digest,
      ),
    });
    opfs.collectRuntimeVerifiedHistory.mockImplementation(() => Promise.resolve({
      digests: slot.artifactDigests.map((digest) =>
        digest === rootDigest ? malformedDigest : digest,
      ),
      verifiedSizes: new Map(
        slot.artifactDigests.map((digest) => [
          digest === rootDigest ? malformedDigest : digest,
          digest === rootDigest
            ? malformedBytes.byteLength
            : (bytesByDigest.get(digest) ?? enc.encode("missing")).byteLength,
        ]),
      ),
      headDirectDigests: [],
    }));
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(
          Uint8Array.from(
            digest === malformedDigest
              ? malformedBytes
              : (bytesByDigest.get(digest) ?? enc.encode("missing")),
          ),
        ),
    );
    await expect(
      executeRustRuntime(
        enc.encode("raw"),
        "Raw.csv",
        {
          ...DEFAULT_BROWSER_OPTIONS,
          selectedTimezone: "UTC",
          useFilterFile: false,
          useAppsForcingScreenOpenFile: false,
          useBackgroundAppsFile: false,
          useAppCodebook: false,
        },
        {},
        { persistRustWorkspace: true, incrementalEngine: false },
      ),
    ).rejects.toThrow(/root digest/);
    expect(opfs.recoverRuntimeWorkspace).not.toHaveBeenCalled();
    expect(kernel.execute_workspace).not.toHaveBeenCalled();
  });

  it("verifies a portable archive without importing it", async () => {
    const visited: string[] = [];
    const retained: Uint8Array[] = [];
    let visitsInFlight = 0;
    const inspected = await readVerifiedPersistedRustWorkspaceArchiveCapture(
      archive,
      async ({ digest, size }, bytes) => {
        visitsInFlight += 1;
        expect(visitsInFlight).toBe(1);
        expect(bytes).toHaveLength(size);
        visited.push(digest);
        retained.push(bytes);
        await Promise.resolve();
        visitsInFlight -= 1;
      },
    );
    expect(inspected.manifest.workspaceRootDigest).toBe(rootDigest);
    expect(inspected.objectCount).toBe(visited.length);
    expect(visited).toContain(rootDigest);
    expect(retained.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    expect(opfs.inspectVerifiedRuntimeClosure).toHaveBeenCalledWith(archive);
    expect(opfs.importRuntimeClosure).not.toHaveBeenCalled();
  });

  it("derives revision one from a verified fresh archive and rejects a valid two-root archive", async () => {
    expect(FRESH_PORTABLE_SEMANTIC_INDEX_REVISION).toBe(1);
    const actualOpfs = await vi.importActual<
      typeof import("@/lib/opfsArtifactStore")
    >("@/lib/opfsArtifactStore");
    const directory = new MemoryDirectoryHandle();
    const fresh = buildPortableSemanticWorkspace(null);
    const firstSlot = await actualOpfs.persistRuntimeWorkspace(
      memoryDirectoryHandle(directory),
      {
        workspaceRootDigest: fresh.workspaceRootDigest,
        previousWorkspaceRootDigest: null,
        artifacts: fresh.artifacts,
      },
    );
    expect(firstSlot.generation).toBe(1);
    const freshArchive = await actualOpfs.exportRuntimeClosure(
      memoryDirectoryHandle(directory),
      firstSlot,
    );
    opfs.inspectVerifiedRuntimeClosure.mockImplementationOnce((candidate: Blob) =>
      actualOpfs.inspectVerifiedRuntimeClosure(candidate),
    );
    kernel.runtime_identity.mockImplementationOnce(() => ({
      protocolVersion: "chronicle-preprocessing-runtime/v2",
      implementationDigest,
      buildEnvironmentDigest,
      productContractDigest,
      planDigest,
      profileDigest,
      profileLockDigest,
      runtimeAuthorityDigest,
      dependencyCertificateDigest: fresh.dependencyCertificateDigest,
    }));
    const snapshot = await readVerifiedSemanticIndexSnapshotFromArchive(
      freshArchive,
    );
    expect(snapshot).toMatchObject({
      workspaceRootDigest: fresh.workspaceRootDigest,
      revision: 1,
    });
    expect(snapshot.source).toEqual(fresh.source);
    expect(snapshot.scientificArtifactBundle).toEqual(
      fresh.scientificArtifactBundle,
    );

    const second = buildPortableSemanticWorkspace(fresh.workspaceRootDigest);
    const secondSlot = await actualOpfs.persistRuntimeWorkspace(
      memoryDirectoryHandle(directory),
      {
        workspaceRootDigest: second.workspaceRootDigest,
        previousWorkspaceRootDigest: fresh.workspaceRootDigest,
        recoveredSlot: firstSlot,
        artifacts: second.artifacts,
      },
    );
    expect(secondSlot.generation).toBe(2);
    const twoRootArchive = await actualOpfs.exportRuntimeClosure(
      memoryDirectoryHandle(directory),
      secondSlot,
    );
    opfs.inspectVerifiedRuntimeClosure.mockImplementationOnce((candidate: Blob) =>
      actualOpfs.inspectVerifiedRuntimeClosure(candidate),
    );
    await expect(
      readVerifiedSemanticIndexSnapshotFromArchive(twoRootArchive),
    ).rejects.toThrow(/fresh one-root workspace closure/);
    snapshot.source.fill(0);
    snapshot.scientificArtifactBundle.fill(0);
  });

  it("rejects a same-size substituted portable object before semantic assembly", async () => {
    opfs.inspectVerifiedRuntimeClosure.mockRejectedValueOnce(
      new Error(`runtime closure object digest mismatch: ${payloadDigest}`),
    );
    await expect(
      readVerifiedSemanticIndexSnapshotFromArchive(archive),
    ).rejects.toThrow(/object digest mismatch/);
  });

  it("returns a typed EYES/wider-opener refusal before execution and frees support state", async () => {
    const operation = executeRustRuntime(
      enc.encode("raw"),
      "Raw.csv",
      {
        ...DEFAULT_BROWSER_OPTIONS,
        selectedTimezone: "UTC",
        openerSet: "gesis_app_scoped_starts",
        episodeReconstructionStrategy: "eyes_complement",
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useBackgroundAppsFile: false,
        useAppCodebook: false,
      },
      {},
      {
        persistRustWorkspace: false,
        datetimeOfPreprocessing: "2026-08-11 00:00:00 UTC",
      },
    );

    const refusal = await operation.catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RustOpenerSetRefusalError);
    expect(refusal).toMatchObject({
      name: "RustOpenerSetRefusalError",
      code: "opener_set_refused",
      decision: {
        status: "refused",
        requestedOpenerSetId: "gesis_app_scoped_starts",
        resolvedOpenerSetId: "gesis_app_scoped_starts",
        effectiveOpenerSetId: null,
        relation: "refused",
        reasonCode: "eyes_requires_lifecycle_triplets",
        optionsDigest: payloadDigest,
      },
    });
    expect(kernel.opener_set_applicability_json).toHaveBeenCalledOnce();
    expect(kernel.execute_workspace).not.toHaveBeenCalled();
    expect(kernel.execute_workspace_with_review_base).not.toHaveBeenCalled();
    expect(kernel.execute_workspace_with_review_bases).not.toHaveBeenCalled();
    expect(kernel.prepare_workspace_review).not.toHaveBeenCalled();
    expect(kernel.prepare_persisted_workspace_review).not.toHaveBeenCalled();
    expect(supportHandleFree).toHaveBeenCalledOnce();
  });

  it("loads both typed review caches in one verified closure lookup", async () => {
    const review = enc.encode("review-cache");
    const reconstruction = enc.encode("reconstruction-cache");
    const cached = reviewCacheWorkspace({ review, reconstruction });
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(cached.objects.get(digest) ?? enc.encode("missing")),
    );

    await expect(
      readPersistedRustReviewBases(root, cached.slot, {
        implementationDigest,
        buildEnvironmentDigest,
        workspaceId,
        inputDigest: payloadDigest,
      }),
    ).resolves.toEqual({
      reviewBaseBytes: review,
      reconstructionBaseBytes: reconstruction,
      datetimeOfPreprocessing: "2026-04-24 00:32:53",
    });
    expect(opfs.readRuntimeObject).toHaveBeenCalledTimes(5);
  });

  it("treats either or both missing review caches as a normal cold fallback", async () => {
    for (const fixture of [
      reviewCacheWorkspace({ review: enc.encode("review-only") }),
      reviewCacheWorkspace({
        reconstruction: enc.encode("reconstruction-only"),
      }),
      reviewCacheWorkspace({}),
    ]) {
      opfs.readRuntimeObject.mockClear();
      opfs.readRuntimeObject.mockImplementation(
        (_root: FileSystemDirectoryHandle, digest: string) =>
          Promise.resolve(fixture.objects.get(digest) ?? enc.encode("missing")),
      );
      const bases = await readPersistedRustReviewBases(root, fixture.slot, {
        implementationDigest,
        buildEnvironmentDigest,
        workspaceId,
        inputDigest: payloadDigest,
      });
      expect(
        Number(bases.reviewBaseBytes.byteLength > 0) +
          Number(bases.reconstructionBaseBytes.byteLength > 0),
      ).toBe(fixture.objects.size - 3);
    }
  });

  it("rejects corrupt cache bytes and runtime identity drift", async () => {
    const review = enc.encode("review-cache");
    const cached = reviewCacheWorkspace({ review });
    const reviewDigest = digestBytes(review);
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        digest === reviewDigest
          ? Promise.reject(new Error(`corrupt OPFS object: ${digest}`))
          : Promise.resolve(
              cached.objects.get(digest) ?? enc.encode("missing"),
            ),
    );
    await expect(
      readPersistedRustReviewBases(root, cached.slot, {
        implementationDigest,
        buildEnvironmentDigest,
        workspaceId,
        inputDigest: payloadDigest,
      }),
    ).rejects.toThrow(/corrupt OPFS object/);

    const stale = reviewCacheWorkspace({
      review,
      rootBuildEnvironmentDigest: `sha256:${"4".repeat(64)}`,
    });
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(stale.objects.get(digest) ?? enc.encode("missing")),
    );
    await expect(
      readPersistedRustReviewBases(root, stale.slot, {
        implementationDigest,
        buildEnvironmentDigest,
        workspaceId,
        inputDigest: payloadDigest,
      }),
    ).rejects.toThrow(/workspace identity mismatch/);
  });

  it("rejects closure drift, invalid declared sizes, and short persisted bases", async () => {
    const review = enc.encode("review-cache");
    const fixture = reviewCacheWorkspace({ review });
    const rootCommit = JSON.parse(
      new TextDecoder().decode(
        fixture.objects.get(fixture.slot.workspaceRootDigest),
      ),
    ) as { artifactClosureDigest: string };
    const originalClosure = fixture.objects.get(
      rootCommit.artifactClosureDigest,
    )!;
    const closure = JSON.parse(new TextDecoder().decode(originalClosure)) as {
      implementationDigest: string;
      artifacts: Array<{ kind: string; digest: string; size: number }>;
    };
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(fixture.objects.get(digest) ?? enc.encode("missing")),
    );
    const read = () =>
      readPersistedRustReviewBases(root, fixture.slot, {
        implementationDigest,
        buildEnvironmentDigest,
        workspaceId,
        inputDigest: payloadDigest,
      });

    fixture.objects.set(
      rootCommit.artifactClosureDigest,
      enc.encode(
        JSON.stringify({
          ...closure,
          implementationDigest: `sha256:${"7".repeat(64)}`,
        }),
      ),
    );
    await expect(read()).rejects.toThrow(/closure identity mismatch/);

    const reviewArtifact = closure.artifacts.find(
      ({ kind }) => kind === "review-base",
    )!;
    fixture.objects.set(
      rootCommit.artifactClosureDigest,
      enc.encode(
        JSON.stringify({
          ...closure,
          artifacts: closure.artifacts.map((artifact) =>
            artifact.kind === "review-base"
              ? { ...artifact, size: -1 }
              : artifact,
          ),
        }),
      ),
    );
    await expect(read()).rejects.toThrow(/artifact size is invalid/);

    fixture.objects.set(
      rootCommit.artifactClosureDigest,
      enc.encode(JSON.stringify(closure)),
    );
    fixture.objects.set(reviewArtifact.digest, enc.encode("short"));
    await expect(read()).rejects.toThrow(/artifact integrity mismatch/);
  });

  it("rejects oversized persisted bases before reading their payloads", async () => {
    const oversized = reviewCacheWorkspace({
      review: enc.encode("review-cache"),
      reviewDeclaredSize: 64 * 1024 * 1024 + 1,
    });
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(oversized.objects.get(digest) ?? enc.encode("missing")),
    );

    await expect(
      readPersistedRustReviewBases(root, oversized.slot, {
        implementationDigest,
        buildEnvironmentDigest,
        workspaceId,
        inputDigest: payloadDigest,
      }),
    ).rejects.toThrow(/artifact exceeds size limit: review-base/);
    expect(opfs.readRuntimeObject).toHaveBeenCalledTimes(2);

    const combined = reviewCacheWorkspace({
      review: enc.encode("review-cache"),
      reconstruction: enc.encode("reconstruction-cache"),
      reviewDeclaredSize: 64 * 1024 * 1024,
      reconstructionDeclaredSize: 64 * 1024 * 1024 + 1,
    });
    opfs.readRuntimeObject.mockClear();
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(combined.objects.get(digest) ?? enc.encode("missing")),
    );
    await expect(
      readPersistedRustReviewBases(root, combined.slot, {
        implementationDigest,
        buildEnvironmentDigest,
        workspaceId,
        inputDigest: payloadDigest,
      }),
    ).rejects.toThrow(/combined persisted Rust bases exceed size limit/);
    expect(opfs.readRuntimeObject).toHaveBeenCalledTimes(2);
  });

  it("fails closed when persisted review bases have no valid run timestamp", async () => {
    for (const fixture of [
      reviewCacheWorkspace({
        review: enc.encode("review-cache"),
        datetimeOfPreprocessing: null,
      }),
      reviewCacheWorkspace({
        review: enc.encode("review-cache"),
        datetimeOfPreprocessing: "",
      }),
    ]) {
      opfs.readRuntimeObject.mockImplementation(
        (_root: FileSystemDirectoryHandle, digest: string) =>
          Promise.resolve(fixture.objects.get(digest) ?? enc.encode("missing")),
      );
      await expect(
        readPersistedRustReviewBases(root, fixture.slot, {
          implementationDigest,
          buildEnvironmentDigest,
          workspaceId,
          inputDigest: payloadDigest,
        }),
      ).rejects.toThrow(/processing options|non-empty (?:string|timestamp)/i);
    }

    // A whitespace-only timestamp passes the non-empty string check but is
    // still not a run timestamp. A/B holds this value fixed across the
    // comparison, so accepting blank whitespace would silently hand Rust a
    // meaningless `datetime_of_preprocessing` instead of failing closed.
    const blank = reviewCacheWorkspace({
      review: enc.encode("review-cache"),
      datetimeOfPreprocessing: "   ",
    });
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(blank.objects.get(digest) ?? enc.encode("missing")),
    );
    await expect(
      readPersistedRustReviewBases(root, blank.slot, {
        implementationDigest,
        buildEnvironmentDigest,
        workspaceId,
        inputDigest: payloadDigest,
      }),
    ).rejects.toThrow(
      /persistedProcessingOptions\.datetime_of_preprocessing.*non-empty timestamp/,
    );
  });

  it("fails closed on persisted review probes the workspace cannot back", async () => {
    const options = {
      ...DEFAULT_BROWSER_OPTIONS,
      processScreenUsage: false,
      selectedTimezone: "UTC",
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
    };
    const runtime = {
      persistRustWorkspace: true,
      incrementalEngine: true,
      provenanceEvidence: true,
      // The persisted run's own timestamp replaces this one once the bases
      // resolve; a caller-supplied value is still required to build a request.
      datetimeOfPreprocessing: "2026-07-26 00:00:00 UTC",
    } as const;
    // The mocked kernel advertises these probe prefixes; the persisted bases
    // must be at least that long or the prefix is not a probe of anything.
    const reviewProbeBytes = 148;
    const optionsJson = (datetime: string) =>
      enc.encode(JSON.stringify({ datetime_of_preprocessing: datetime }));
    const filled = (length: number, byte: number) =>
      new Uint8Array(length).fill(byte);

    const query = async (
      inputHex: string,
      artifacts: ReadonlyArray<{
        kind: string;
        bytes: Uint8Array;
        declaredSize?: number;
      }>,
    ) => {
      const reviewWorkspaceId = await runtimeWorkspaceId(
        "review.csv",
        new Uint8Array(),
        inputHex,
      );
      const fixture = persistedReviewWorkspace({
        reviewWorkspaceId,
        inputDigest: `sha256:${inputHex}`,
        artifacts,
      });
      opfs.recoverRuntimeWorkspaceHead.mockResolvedValue(fixture.slot);
      opfs.readRuntimeObject.mockImplementation(
        (_root: FileSystemDirectoryHandle, digest: string) =>
          Promise.resolve(fixture.objects.get(digest) ?? enc.encode("missing")),
      );
      opfs.readRuntimeObjectPrefix.mockImplementation(
        (
          _root: FileSystemDirectoryHandle,
          digest: string,
          _expectedSize: number,
          prefixBytes: number,
        ) =>
          Promise.resolve(
            (fixture.objects.get(digest) ?? enc.encode("missing")).subarray(
              0,
              prefixBytes,
            ),
          ),
      );
      return queryPersistedRustReview(
        3,
        "review.csv",
        options,
        undefined,
        runtime,
        inputHex,
      );
    };

    // A base whose whole object is shorter than the probe the kernel asked for
    // cannot be a truncated prefix of a valid base — it is a different (or
    // corrupt) artifact, and reusing it would seed Rust with wrong state.
    await expect(
      query("a".repeat(64), [
        { kind: "review-base", bytes: filled(10, 1) },
        {
          kind: "processing-options-json",
          bytes: optionsJson("2026-04-24 00:32:53"),
        },
      ]),
    ).rejects.toThrow("persisted Rust review base is shorter than its probe");

    // A base without its processing options has no run timestamp to hold fixed
    // across the A/B comparison, so the whole persisted set is refused rather
    // than silently re-timestamped from the receiving worker's clock.
    await expect(
      query("b".repeat(64), [
        { kind: "review-base", bytes: filled(reviewProbeBytes, 2) },
      ]),
    ).rejects.toThrow(
      "persisted Rust review bases are missing their processing options",
    );

    // Whitespace clears the non-empty string check but is not a timestamp.
    await expect(
      query("c".repeat(64), [
        { kind: "review-base", bytes: filled(reviewProbeBytes, 3) },
        { kind: "processing-options-json", bytes: optionsJson("  \t ") },
      ]),
    ).rejects.toThrow(
      /persistedProcessingOptions\.datetime_of_preprocessing.*non-empty timestamp/,
    );

    // The probe prefix passes its own length check, but the selected full base
    // must still match the size the closure declared for it.
    const preparedFree = vi.fn();
    kernel.prepare_persisted_workspace_review.mockImplementation(() => ({
      required_base_kind: () => "review-base",
      execute_selected_base: () => {
        throw new Error("test must not execute a base");
      },
      free: preparedFree,
    }));
    await expect(
      query("d".repeat(64), [
        {
          kind: "review-base",
          bytes: filled(reviewProbeBytes, 4),
          declaredSize: 500,
        },
        {
          kind: "processing-options-json",
          bytes: optionsJson("2026-04-24 00:32:53"),
        },
      ]),
    ).rejects.toThrow(
      "persisted Rust artifact integrity mismatch: review-base",
    );
    expect(preparedFree).toHaveBeenCalledTimes(1);

    // Rust may select a base this workspace never persisted. There is no
    // descriptor to read it from, so the run fails closed instead of handing
    // the kernel an empty or substituted buffer.
    kernel.prepare_persisted_workspace_review.mockImplementation(() => ({
      required_base_kind: () => "reconstruction-base",
      execute_selected_base: () => {
        throw new Error("test must not execute a base");
      },
      free: preparedFree,
    }));
    await expect(
      query("e".repeat(64), [
        { kind: "review-base", bytes: filled(reviewProbeBytes, 5) },
        {
          kind: "processing-options-json",
          bytes: optionsJson("2026-04-24 00:32:53"),
        },
      ]),
    ).rejects.toThrow(
      "persisted Rust workspace is missing reconstruction-base",
    );
    expect(preparedFree).toHaveBeenCalledTimes(2);
  });

  // A raw-less persisted review of a screen-processing file: the DEFAULT
  // options keep `processScreenUsage` on, and the workspace carries both
  // persisted bases. `query(inputHex)` runs `queryPersistedRustReview` over a
  // fresh workspace for that input digest.
  const screenProcessingPersistedReview = () => {
    const options = {
      ...DEFAULT_BROWSER_OPTIONS,
      selectedTimezone: "UTC",
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
    };
    const runtime = {
      persistRustWorkspace: true,
      datetimeOfPreprocessing: "2026-07-26 00:00:00 UTC",
      incrementalEngine: true,
      provenanceEvidence: true,
    } as const;
    const reviewProbeBytes = 148;
    const reconstructionProbeBytes = 116;
    const filled = (length: number, byte: number) =>
      new Uint8Array(length).fill(byte);
    const artifacts = [
      { kind: "review-base", bytes: filled(reviewProbeBytes, 8) },
      {
        kind: "reconstruction-base",
        bytes: filled(reconstructionProbeBytes, 9),
      },
      {
        kind: "processing-options-json",
        bytes: enc.encode(
          JSON.stringify({
            datetime_of_preprocessing: "2026-04-24 00:32:53",
          }),
        ),
      },
    ];

    const query = async (inputHex: string) => {
      const reviewWorkspaceId = await runtimeWorkspaceId(
        "review.csv",
        new Uint8Array(),
        inputHex,
      );
      const fixture = persistedReviewWorkspace({
        reviewWorkspaceId,
        inputDigest: `sha256:${inputHex}`,
        artifacts,
      });
      opfs.recoverRuntimeWorkspaceHead.mockResolvedValue(fixture.slot);
      opfs.readRuntimeObject.mockImplementation(
        (_root: FileSystemDirectoryHandle, digest: string) =>
          Promise.resolve(fixture.objects.get(digest) ?? enc.encode("missing")),
      );
      opfs.readRuntimeObjectPrefix.mockImplementation(
        (
          _root: FileSystemDirectoryHandle,
          digest: string,
          _expectedSize: number,
          prefixBytes: number,
        ) =>
          Promise.resolve(
            (fixture.objects.get(digest) ?? enc.encode("missing")).subarray(
              0,
              prefixBytes,
            ),
          ),
      );
      return queryPersistedRustReview(
        3,
        "review.csv",
        options,
        undefined,
        runtime,
        inputHex,
      );
    };
    return { options, query };
  };

  // Under DEFAULT settings `processScreenUsage` is on, so
  // `requiresLiveScientificPreflight` is true and the persisted review used to
  // be refused before Rust was even asked which base it wanted. A persisted
  // base carries the scientific commitment that lets a raw-less resume proceed,
  // so the decision belongs after `required_base_kind()`.
  it("resumes a screen-processing review from a persisted base", async () => {
    const { options, query } = screenProcessingPersistedReview();
    expect(options.processScreenUsage).toBe(true);

    const reached = vi.fn();
    const prepared = (kind: string) => ({
      required_base_kind: () => kind,
      execute_selected_base: () => {
        reached();
        throw new Error("reached the kernel with a single base");
      },
      execute_selected_base_pair: () => {
        reached();
        throw new Error("reached the kernel with the base pair");
      },
      free: vi.fn(),
    });

    // A warm Salsa engine holds no persisted base, so there is no commitment
    // to adopt and the review misses without reading anything.
    kernel.prepare_persisted_workspace_review.mockImplementation(() =>
      prepared("salsa-memory"),
    );
    await expect(query("a".repeat(64))).resolves.toBeNull();
    expect(reached).not.toHaveBeenCalled();

    // Either persisted base carries one, so the resume now reaches Rust
    // instead of being refused by the browser.
    kernel.prepare_persisted_workspace_review.mockImplementation(() =>
      prepared("review-base"),
    );
    await expect(query("b".repeat(64))).rejects.toThrow(
      "reached the kernel with a single base",
    );
    kernel.prepare_persisted_workspace_review.mockImplementation(() =>
      prepared("reconstruction-base"),
    );
    await expect(query("c".repeat(64))).rejects.toThrow(
      "reached the kernel with the base pair",
    );
    expect(reached).toHaveBeenCalledTimes(2);

    // Rust remains the authority: when it refuses the adoption by name, that
    // is a cache miss, not a run failure.
    kernel.prepare_persisted_workspace_review.mockImplementation(() => ({
      required_base_kind: () => "reconstruction-base",
      execute_selected_base_pair: () => {
        throw new Error(
          "scientific_preflight_retry_required:verified_raw_and_support_required:required_base_kind=none",
        );
      },
      free: vi.fn(),
    }));
    await expect(query("d".repeat(64))).resolves.toBeNull();
  });

  // A raw-less resume leaves the kernel with the input digest beside zero
  // bytes; when the review has to decode the raw file, `decode_source_records`
  // refuses with `decode_source_records_error:retained_raw_input_required`.
  // That is a cache miss — the caller falls back to the raw file — not a run
  // failure. wasm-bindgen throws `JsValue::from_str` as a bare string.
  it("treats the kernel's retained-raw-input refusal as a persisted-review miss", async () => {
    const { query } = screenProcessingPersistedReview();
    const refusing = (thrown: unknown) => ({
      required_base_kind: () => "review-base",
      execute_selected_base: () => {
        throw thrown;
      },
      free: vi.fn(),
    });

    kernel.prepare_persisted_workspace_review.mockImplementation(() =>
      refusing("decode_source_records_error:retained_raw_input_required"),
    );
    await expect(query("a".repeat(64))).resolves.toBeNull();
    kernel.prepare_persisted_workspace_review.mockImplementation(() =>
      refusing(new Error("decode_source_records_error:retained_raw_input_required")),
    );
    await expect(query("b".repeat(64))).resolves.toBeNull();

    // Any other kernel refusal still fails the run.
    kernel.prepare_persisted_workspace_review.mockImplementation(() =>
      refusing("decode_source_records_error:malformed_csv"),
    );
    await expect(query("c".repeat(64))).rejects.toBe(
      "decode_source_records_error:malformed_csv",
    );
  });

  it("keys workspaces by semantic input bytes and factors out filename labels", async () => {
    const first = await runtimeWorkspaceId("Raw.csv", enc.encode("first"));
    const preverified = await runtimeWorkspaceId(
      "Raw.csv",
      enc.encode("first"),
      "a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e",
    );
    const second = await runtimeWorkspaceId("Raw.csv", enc.encode("second"));
    const renamed = await runtimeWorkspaceId(
      "Renamed.csv",
      enc.encode("first"),
    );

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(preverified).toBe(first);
    expect(second).not.toBe(first);
    expect(renamed).toBe(first);
    await expect(
      runtimeWorkspaceId("Raw.csv", enc.encode("first"), "not-a-digest"),
    ).rejects.toThrow("64 lowercase hexadecimal");
  });

  it("verifies, exports, reads, collects, and imports a complete closure", async () => {
    await expect(readPersistedRustWorkspaceHead(workspaceId)).resolves.toBe(
      rootDigest,
    );
    await expect(verifyPersistedRustWorkspace(workspaceId)).resolves.toBe(slot);
    expect(kernel.verify_evidence_journal_cbor).toHaveBeenCalledOnce();
    const journalArgument = (
      kernel.verify_evidence_journal_cbor.mock.calls as unknown as Uint8Array[][]
    )[0]?.[0];
    expect(journalArgument?.every((byte) => byte === 0)).toBe(true);
    await expect(exportPersistedRustWorkspace(workspaceId)).resolves.toBe(
      archive,
    );
    await expect(
      readPersistedRustArtifact(workspaceId, "semantic-index-source-json"),
    ).resolves.toEqual(bytesByDigest.get(payloadDigest));
    await expect(
      readPersistedRustArtifact(workspaceId, "artifact-closure-json"),
    ).resolves.toEqual(bytesByDigest.get(closureDigest));
    await expect(
      readPersistedRustArtifact(workspaceId, "workspace-root-json", rootDigest),
    ).resolves.toEqual(bytesByDigest.get(rootDigest));
    await expect(
      garbageCollectPersistedRustWorkspace(workspaceId),
    ).resolves.toBe(4);
    expect(workspaceLockRequest).toHaveBeenCalledWith(
      `chronicle-workflow-v1:${workspaceId}`,
      { mode: "exclusive" },
      expect.any(Function),
    );
    await expect(
      importPersistedRustWorkspace(workspaceId, archive),
    ).resolves.toBe(slot);
    await expect(importPersistedRustWorkspaceArchive(archive)).resolves.toEqual(
      {
        workspaceId,
        slot,
      },
    );
  });

  it("pins artifact reads to the advertised root under a shared lock", async () => {
    workspaceLockRequest.mockClear();
    opfs.recoverRuntimeWorkspace.mockClear();
    opfs.recoverRuntimeWorkspaceHead.mockClear();
    await expect(
      readPersistedRustArtifact(
        workspaceId,
        "semantic-index-source-json",
        rootDigest,
      ),
    ).resolves.toEqual(bytesByDigest.get(payloadDigest));
    expect(opfs.recoverRuntimeWorkspaceHead).not.toHaveBeenCalled();
    expect(opfs.recoverRuntimeWorkspace).not.toHaveBeenCalled();
    expect(workspaceLockRequest).toHaveBeenLastCalledWith(
      `chronicle-workflow-v1:${workspaceId}`,
      { mode: "shared" },
      expect.any(Function),
    );

    opfs.recoverRuntimeWorkspaceHead.mockResolvedValue({
      ...slot,
      workspaceRootDigest: previousDigest,
    });
    await expect(
      readPersistedRustArtifact(
        workspaceId,
        "semantic-index-source-json",
        rootDigest,
      ),
    ).resolves.toEqual(bytesByDigest.get(payloadDigest));
    // A receipt-pinned Merkle read does not depend on or scan the current head.
    expect(opfs.recoverRuntimeWorkspaceHead).not.toHaveBeenCalled();
  });

  it("rejects a persisted head from a different loaded Rust identity", async () => {
    kernel.runtime_identity.mockReturnValueOnce({
      protocolVersion: "chronicle-preprocessing-runtime/v2",
      implementationDigest: `sha256:${"7".repeat(64)}`,
      buildEnvironmentDigest,
      productContractDigest,
      planDigest,
      profileDigest,
      profileLockDigest,
      runtimeAuthorityDigest,
      dependencyCertificateDigest,
    });
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /different runtime identity/,
    );
  });

  it("rejects a slot whose retained digests disagree with its committed head", async () => {
    const unlisted = `sha256:${"e3".repeat(32)}`;
    const intactHistory = intactRuntimeHistory();
    // The head commits an object the slot never retained.
    opfs.collectRuntimeVerifiedHistory.mockImplementationOnce(
      async (historyRoot: FileSystemDirectoryHandle, head: string) => ({
        ...(await intactHistory(historyRoot, head)),
        headDirectDigests: [journalDigest, unlisted],
      }),
    );
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      "workspace slot does not match its committed head root",
    );
    // The slot retains an object the verified history never reached.
    opfs.collectRuntimeVerifiedHistory.mockImplementationOnce(
      async (historyRoot: FileSystemDirectoryHandle, head: string) => {
        const history = await intactHistory(historyRoot, head);
        const verifiedSizes = new Map(history.verifiedSizes);
        verifiedSizes.delete(payloadDigest);
        return { ...history, verifiedSizes };
      },
    );
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      "workspace slot does not match its committed head root",
    );
    // The unmodified history verifies, so both refusals came from the drift.
    await expect(verifyPersistedRustWorkspace(workspaceId)).resolves.toEqual(slot);
  });

  it("re-processes a file whose stored head came from an earlier runtime build", async () => {
    // Workspaces are keyed by input content, so after an app update the same
    // file finds the head the earlier build committed. A full run only chains
    // onto it, so it verifies the head without requiring this build's
    // identity; requiring it refused every re-run until site data was cleared.
    const verify = vi.fn(() => Promise.resolve());
    setRustPersistenceForTesting({
      openRoot: () => Promise.resolve(root),
      recover: () => Promise.resolve(slot),
      verify,
      persist: () => Promise.resolve(slot),
    });
    try {
      await executeRustRuntime(
        enc.encode("raw"),
        "Raw.csv",
        {
          ...DEFAULT_BROWSER_OPTIONS,
          selectedTimezone: "UTC",
          useFilterFile: false,
          useAppsForcingScreenOpenFile: false,
          useBackgroundAppsFile: false,
          useAppCodebook: false,
        },
        {},
        { persistRustWorkspace: true, incrementalEngine: false },
      ).catch(() => undefined);
      expect(verify).toHaveBeenCalledWith(
        root,
        slot,
        expect.anything(),
        expect.any(String),
        true,
      );
    } finally {
      setRustPersistenceForTesting(null);
    }
  });

  describe("full run whose newest head has a damaged downstream object", () => {
    const raw = enc.encode("raw");
    const fullOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      processScreenUsage: false,
      selectedTimezone: "UTC",
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
    };
    const headDigest = `sha256:${"e1".repeat(32)}`;
    const damagedDigest = `sha256:${"e2".repeat(32)}`;
    const headSlot: WorkspaceRootSlot = {
      ...slot,
      generation: 2,
      workspaceRootDigest: headDigest,
      previousWorkspaceRootDigest: rootDigest,
      artifactDigests: [headDigest, damagedDigest],
    };

    // The shared fixture commits under a fixed workspace id; a real full run
    // derives its id from the raw bytes, so serve the same closure re-keyed to
    // that id. Only then can the older slot pass full verification.
    async function serveFixtureUnderRunWorkspace(): Promise<void> {
      const runWorkspaceId = await runtimeWorkspaceId("Raw.csv", raw);
      const rekeyed = new Map(
        [rootDigest, closureDigest, executionStateDigest].map((digest) => [
          digest,
          enc.encode(
            JSON.stringify({
              ...(JSON.parse(
                new TextDecoder().decode(bytesByDigest.get(digest)),
              ) as Record<string, unknown>),
              workspaceId: runWorkspaceId,
            }),
          ),
        ]),
      );
      opfs.readRuntimeObject.mockImplementation(
        (_root: FileSystemDirectoryHandle, digest: string) =>
          Promise.resolve(
            Uint8Array.from(
              rekeyed.get(digest) ??
                bytesByDigest.get(digest) ??
                enc.encode("missing"),
            ),
          ),
      );
      const intactHistory = intactRuntimeHistory();
      opfs.collectRuntimeVerifiedHistory.mockImplementation(
        (historyRoot: FileSystemDirectoryHandle, head: string) =>
          head === headDigest
            ? Promise.reject(new Error(`corrupt OPFS object: ${damagedDigest}`))
            : intactHistory(historyRoot, head),
      );
      opfs.recoverRuntimeWorkspaceHead.mockResolvedValue(headSlot);
    }

    it("chains the run onto the prior independent slot instead of refusing it", async () => {
      await serveFixtureUnderRunWorkspace();
      opfs.recoverRuntimeWorkspace.mockResolvedValue(slot);
      let request: { workspaceRootDigest?: unknown } | undefined;
      kernel.execute_workspace.mockImplementationOnce((requestJson: string) => {
        request = JSON.parse(requestJson) as typeof request;
        throw new Error("full execution reached Rust after fallback");
      });

      await expect(
        executeRustRuntime(raw, "Raw.csv", fullOptions, {}, {
          persistRustWorkspace: true,
          incrementalEngine: false,
          datetimeOfPreprocessing: "2026-07-26 00:00:00 UTC",
        }),
      ).rejects.toThrow(/full execution reached Rust after fallback/);

      expect(opfs.recoverRuntimeWorkspaceHead).toHaveBeenCalledWith(root, true);
      expect(opfs.recoverRuntimeWorkspace).toHaveBeenCalledTimes(1);
      expect(opfs.recoverRuntimeWorkspace).toHaveBeenCalledWith(root);
      // The damaged head is not chained onto; the verified older slot is.
      expect(request?.workspaceRootDigest).toBe(rootDigest);
      expect(opfs.removeOpfsWorkspace).not.toHaveBeenCalled();
    });

    it("keeps the damaged-head error when recovery offers no different slot", async () => {
      await serveFixtureUnderRunWorkspace();
      for (const fallback of [undefined, headSlot]) {
        opfs.recoverRuntimeWorkspace.mockResolvedValueOnce(fallback);
        await expect(
          executeRustRuntime(raw, "Raw.csv", fullOptions, {}, {
            persistRustWorkspace: true,
            incrementalEngine: false,
            datetimeOfPreprocessing: "2026-07-26 00:00:00 UTC",
          }),
        ).rejects.toThrow(`corrupt OPFS object: ${damagedDigest}`);
      }
      expect(opfs.recoverRuntimeWorkspace).toHaveBeenCalledTimes(2);
      expect(kernel.execute_workspace).not.toHaveBeenCalled();
    });
  });

  describe("saved run committed under another runtime protocol", () => {
    // The 2026-08-05 production build committed `chronicle-preprocessing-runtime/v1`
    // roots; every later build refused them, so re-running such a file failed
    // with "recovered workspace root contract is invalid" until site data was
    // cleared.
    const raw = enc.encode("raw");
    const fullOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      processScreenUsage: false,
      selectedTimezone: "UTC",
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
    };
    async function withV1Head(check: () => Promise<void>): Promise<void> {
      const current = bytesByDigest.get(rootDigest)!;
      bytesByDigest.set(
        rootDigest,
        enc.encode(
          JSON.stringify({
            ...validCommit,
            protocolVersion: "chronicle-preprocessing-runtime/v1",
          }),
        ),
      );
      try {
        await check();
      } finally {
        bytesByDigest.set(rootDigest, current);
      }
    }

    it("clears it and processes the file fresh instead of refusing", async () => {
      let request: { workspaceRootDigest?: unknown } | undefined;
      kernel.execute_workspace.mockImplementationOnce((requestJson: string) => {
        request = JSON.parse(requestJson) as typeof request;
        throw new Error("full execution reached Rust");
      });
      await withV1Head(() =>
        expect(
          executeRustRuntime(raw, "Raw.csv", fullOptions, {}, {
            persistRustWorkspace: true,
            incrementalEngine: false,
            datetimeOfPreprocessing: "2026-07-26 00:00:00 UTC",
          }),
        ).rejects.toThrow(/full execution reached Rust/),
      );
      expect(opfs.removeOpfsWorkspace).toHaveBeenCalledWith(
        await runtimeWorkspaceId("Raw.csv", raw),
      );
      expect(request?.workspaceRootDigest).toBeNull();
    });

    it("refuses to reopen it with a message a user can act on", async () => {
      await withV1Head(() =>
        expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
          SavedByOtherAppVersionError,
        ),
      );
      expect(opfs.removeOpfsWorkspace).not.toHaveBeenCalled();
    });
  });

  it("rejects an unsupported loaded runtime protocol and duplicate retained digests", async () => {
    kernel.runtime_identity.mockReturnValueOnce({
      protocolVersion: "chronicle-preprocessing-runtime/v99",
      implementationDigest,
      buildEnvironmentDigest,
      productContractDigest,
      planDigest,
      profileDigest,
      profileLockDigest,
      runtimeAuthorityDigest,
      dependencyCertificateDigest,
    });
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /identity protocol is invalid/,
    );

    opfs.collectRuntimeHistoryDigests.mockResolvedValue([
      ...slot.artifactDigests,
      rootDigest,
    ]);
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /retained-object table is invalid/,
    );
  });

  it("rejects a loaded workflow contract of an unsupported protocol", async () => {
    kernel.workflow_contract_json.mockReturnValueOnce(
      JSON.stringify({
        protocolVersion: "chronicle-workflow-contract/v99",
        workflowModelVersion,
        digests: {},
      }),
    );
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      "loaded workflow contract protocol is invalid",
    );
  });

  it("rejects a loaded workflow contract with an empty digest set", async () => {
    kernel.workflow_contract_json.mockReturnValueOnce(
      JSON.stringify({
        protocolVersion: "chronicle-workflow-contract/v1",
        workflowModelVersion,
        digests: {},
      }),
    );

    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /workflowContract\.digests\.semantic/,
    );
  });

  it("returns no recovered root and fails closed when an operation requires one", async () => {
    opfs.recoverRuntimeWorkspace.mockResolvedValue(undefined);
    opfs.recoverRuntimeWorkspaceRoots.mockResolvedValue([]);
    await expect(readVerifiedSemanticIndexSnapshot(workspaceId)).rejects.toThrow("no persisted Rust workspace exists");
    await expect(
      verifyPersistedRustWorkspace(workspaceId),
    ).resolves.toBeUndefined();
    await expect(exportPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /no persisted Rust workspace/,
    );
    await expect(
      readPersistedRustArtifact(workspaceId, "missing"),
    ).rejects.toThrow(/no persisted Rust workspace/);
    await expect(
      garbageCollectPersistedRustWorkspace(workspaceId),
    ).resolves.toBe(4);
    expect(opfs.garbageCollectRuntimeObjects).toHaveBeenLastCalledWith(
      root,
      [],
    );
  });

  it("rejects import identity drift and absent artifact assignments", async () => {
    opfs.runtimeClosureWorkspaceId.mockResolvedValue(`sha256:${"9".repeat(64)}`);
    await expect(
      importPersistedRustWorkspace(workspaceId, archive),
    ).rejects.toThrow(/identity does not match/);
    opfs.runtimeClosureWorkspaceId.mockResolvedValue(workspaceId);
    const missing = { ...validClosure, artifacts: [] };
    bytesByDigest.set(closureDigest, enc.encode(JSON.stringify(missing)));
    await expect(
      readPersistedRustArtifact(workspaceId, "missing"),
    ).rejects.toThrow(/contract violation|artifact closure set is invalid/);
    bytesByDigest.set(closureDigest, enc.encode(JSON.stringify(validClosure)));
  });

  it.each([
    [{ ...validCommit, protocolVersion: "bad" }, /root contract is invalid/],
    [{ ...validCommit, command: "Other" }, /root contract is invalid/],
    [
      { ...validCommit, workflowModelVersion: undefined },
      /root\.workflowModelVersion/,
    ],
    [
      { ...validCommit, workflowCompatibilityDigest: undefined },
      /root\.workflowCompatibilityDigest/,
    ],
    [
      { ...validCommit, workflowModelVersion: "workflow-v2" },
      /workflow identity is invalid/,
    ],
    [
      {
        ...validCommit,
        workflowCompatibilityDigest: `sha256:${"cd".repeat(32)}`,
      },
      /workflow identity is invalid/,
    ],
    [
      { ...validCommit, workspaceId: `sha256:${"8".repeat(64)}` },
      /root identity is invalid/,
    ],
    [
      { ...validCommit, previousWorkspaceRootDigest: previousDigest },
      /root identity is invalid/,
    ],
    [
      { ...validCommit, artifactDigests: [closureDigest, payloadDigest] },
      /omits a required artifact/,
    ],
    [
      { ...validCommit, artifactDigests: [journalDigest, payloadDigest] },
      /omits a required artifact/,
    ],
    [{ ...validCommit, requiredViews: [] }, /root contract is invalid/],
    [
      {
        ...validCommit,
        requiredViews: validCommit.requiredViews.map((binding, index) =>
          index === 0 ? { ...binding, schemaId: "urn:wrong" } : binding,
        ),
      },
      /view binding is invalid/,
    ],
  ])("rejects an invalid recovered root contract", async (commit, pattern) => {
    bytesByDigest.set(rootDigest, enc.encode(JSON.stringify(commit)));
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      pattern,
    );
    bytesByDigest.set(rootDigest, enc.encode(JSON.stringify(validCommit)));
  });

  it("rejects an incomplete retained closure", async () => {
    const incomplete = {
      ...slot,
      artifactDigests: [rootDigest, journalDigest, closureDigest],
    };
    opfs.recoverRuntimeWorkspace.mockResolvedValue(incomplete);
    opfs.collectRuntimeHistoryDigests.mockResolvedValue(
      incomplete.artifactDigests,
    );
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /missing or unbound objects/,
    );
  });

  it("requires every assigned ingress artifact and typed view", async () => {
    bytesByDigest.set(
      rootDigest,
      enc.encode(
        JSON.stringify({
          ...validCommit,
          assignmentDigests: {
            raw_chronicle_csv: `sha256:${"9".repeat(64)}`,
          },
        }),
      ),
    );
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /execution state is invalid/,
    );
    bytesByDigest.set(rootDigest, enc.encode(JSON.stringify(validCommit)));

    const missingView = {
      ...slot,
      artifactDigests: slot.artifactDigests.filter(
        (digest) => digest !== viewDigests[0],
      ),
    };
    opfs.recoverRuntimeWorkspace.mockResolvedValue(missingView);
    opfs.collectRuntimeHistoryDigests.mockResolvedValue(
      missingView.artifactDigests,
    );
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /missing or unbound objects/,
    );
  });

  it("rejects execution-identity drift and a same-size fake view", async () => {
    const originalRoot = bytesByDigest.get(rootDigest)!;
    const originalState = bytesByDigest.get(executionStateDigest)!;
    const originalView = bytesByDigest.get(viewDigest(0))!;
    try {
      bytesByDigest.set(
        executionStateDigest,
        enc.encode(
          JSON.stringify({
            ...executionState,
            implementationDigest: `sha256:${"7".repeat(64)}`,
          }),
        ),
      );
      await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
        /execution state identity mismatch: implementationDigest/,
      );

      bytesByDigest.set(executionStateDigest, originalState);
      const expectedViewId = "chronicle-workflow-explorer/v1";
      const invalidViewId = "chronicle.invalid".padEnd(expectedViewId.length, "_");
      const fakeView = new TextDecoder()
        .decode(originalView)
        .replace(expectedViewId, invalidViewId);
      expect(enc.encode(fakeView).byteLength).toBe(originalView.byteLength);
      bytesByDigest.set(viewDigest(0), enc.encode(fakeView));
      await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
        /typed view is invalid/,
      );
    } finally {
      bytesByDigest.set(rootDigest, originalRoot);
      bytesByDigest.set(executionStateDigest, originalState);
      bytesByDigest.set(viewDigest(0), originalView);
    }
  });

  it("rejects an explorer view with empty workflow contract digests", async () => {
    const originalView = bytesByDigest.get(viewDigest(0))!;
    const serializedDigests = JSON.stringify(workflowContractDigests);
    const emptyDigests = "{}".padEnd(serializedDigests.length, " ");
    const invalidView = new TextDecoder()
      .decode(originalView)
      .replace(serializedDigests, emptyDigests);
    expect(enc.encode(invalidView).byteLength).toBe(originalView.byteLength);
    bytesByDigest.set(viewDigest(0), enc.encode(invalidView));
    try {
      await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
        /workflowExplorer\.contractDigests\.semantic/,
      );
    } finally {
      bytesByDigest.set(viewDigest(0), originalView);
    }
  });

  it("fails receipt-pinned reads for root, closure, assignment, and size drift", async () => {
    const originalRoot = bytesByDigest.get(rootDigest)!;
    const originalClosure = bytesByDigest.get(closureDigest)!;
    try {
      bytesByDigest.set(
        rootDigest,
        enc.encode(
          JSON.stringify({
            ...validCommit,
            workspaceId: `sha256:${"7".repeat(64)}`,
          }),
        ),
      );
      await expect(
        readPersistedRustArtifact(
          workspaceId,
          "semantic-index-source-json",
          rootDigest,
        ),
      ).rejects.toThrow(/workspace identity mismatch/);

      bytesByDigest.set(rootDigest, originalRoot);
      const closure = JSON.parse(
        new TextDecoder().decode(originalClosure),
      ) as typeof validClosure;
      bytesByDigest.set(
        closureDigest,
        enc.encode(
          JSON.stringify({
            ...closure,
            workspaceId: `sha256:${"7".repeat(64)}`,
          }),
        ),
      );
      await expect(
        readPersistedRustArtifact(
          workspaceId,
          "semantic-index-source-json",
          rootDigest,
        ),
      ).rejects.toThrow(/closure identity mismatch/);

      bytesByDigest.set(
        closureDigest,
        enc.encode(
          JSON.stringify({
            ...closure,
            artifacts: closure.artifacts.filter(
              ({ kind }) => kind !== "semantic-index-source-json",
            ),
          }),
        ),
      );
      await expect(
        readPersistedRustArtifact(
          workspaceId,
          "semantic-index-source-json",
          rootDigest,
        ),
      ).rejects.toThrow(/artifact is missing/);

      bytesByDigest.set(
        closureDigest,
        enc.encode(
          JSON.stringify({
            ...closure,
            artifacts: closure.artifacts.map((artifact) =>
              artifact.kind === "semantic-index-source-json"
                ? { ...artifact, size: artifact.size + 1 }
                : artifact,
            ),
          }),
        ),
      );
      await expect(
        readPersistedRustArtifact(
          workspaceId,
          "semantic-index-source-json",
          rootDigest,
        ),
      ).rejects.toThrow(/artifact integrity mismatch/);
    } finally {
      bytesByDigest.set(rootDigest, originalRoot);
      bytesByDigest.set(closureDigest, originalClosure);
    }
  });

  it.each([
    [
      { ...validClosure, protocolVersion: "bad" },
      /artifact closure identity mismatch|artifact closure set/,
    ],
    [
      { ...validClosure, workspaceId: `sha256:${"8".repeat(64)}` },
      /artifact closure identity mismatch/,
    ],
    [
      { ...validClosure, journalDigest: payloadDigest },
      /artifact closure identity mismatch/,
    ],
    [
      { ...validClosure, dependencyCertificateDigest: payloadDigest },
      /artifact closure identity mismatch/,
    ],
    [
      {
        ...validClosure,
        artifacts: [{ kind: "x", digest: `sha256:${"0".repeat(64)}` }],
      },
      /contract violation|artifact closure set is invalid/,
    ],
  ])(
    "rejects invalid semantic artifact closure metadata",
    async (closure, pattern) => {
      bytesByDigest.set(closureDigest, enc.encode(JSON.stringify(closure)));
      await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
        pattern,
      );
      bytesByDigest.set(
        closureDigest,
        enc.encode(JSON.stringify(validClosure)),
      );
    },
  );

  it("rejects fake typed views and unbound retained objects", async () => {
    const original = bytesByDigest.get(viewDigest(0))!;
    bytesByDigest.set(viewDigest(0),
      enc.encode(
        JSON.stringify({
          view_id: "chronicle-workflow-explorer/v1",
          root_digest: executionStateDigest,
        }),
      ),
    );
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /artifact size mismatch|typed view is invalid/,
    );
    bytesByDigest.set(viewDigest(0), original);

    opfs.collectRuntimeHistoryDigests.mockResolvedValue([
      ...slot.artifactDigests,
      previousDigest,
    ]);
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /missing or unbound objects/,
    );
  });

  it("exposes runtime identity and a Rust-evaluated pre-run view", async () => {
    await expect(initializeRustRuntime({})).resolves.toBeUndefined();
    await expect(getRustRuntimeVersion()).resolves.toBe("test-runtime");
    await expect(discoverRustTimezones(enc.encode("raw"))).resolves.toEqual([
      "UTC",
    ]);
    await expect(
      inspectRustRawFile(enc.encode("raw"), "raw.csv", 3),
    ).resolves.toMatchObject({ fileName: "raw.csv" });
    await expect(
      getRustWorkflowExplorerView({
        ...DEFAULT_BROWSER_OPTIONS,
        selectedTimezone: "   ",
      }, [{ roleId: "filter_file", present: true }]),
    ).resolves.toMatchObject({ viewId: "chronicle-workflow-explorer/v1" });
    expect(kernel.plan_workflow_explorer_view_json).toHaveBeenCalledWith(
      expect.stringContaining('"timezone":"UTC"'),
    );
    expect(kernel.plan_workflow_explorer_view_json).toHaveBeenCalledWith(
      expect.stringContaining('"supportRoles":[{"roleId":"filter_file","present":true}]'),
    );
    await getRustWorkflowExplorerView({
      ...DEFAULT_BROWSER_OPTIONS,
      timezoneHandling: "primary-convert",
      selectedTimezone: "America/Chicago",
    });
    expect(kernel.plan_workflow_explorer_view_json).toHaveBeenLastCalledWith(
      expect.stringContaining('"timezone":"America/Chicago"'),
    );
  });

  it("rejects a raw inspection whose participant tokens are not strictly ascending", async () => {
    // The token list is the partition's identity: the kernel emits it sorted
    // and deduplicated, so any other order means the reply was not the one
    // this request asked for.
    kernel.inspect_raw_file_v1 = vi.fn(() =>
      JSON.stringify({
        fileName: "raw.csv",
        sizeBytes: 3,
        rowCount: 2,
        participantCount: 2,
        participantTokens: [`sha256:${"b".repeat(64)}`, `sha256:${"a".repeat(64)}`],
        participantPartitionBatchId: null,
        screenStartEventCount: 0,
        warnings: [],
        columns: [],
        timezones: [],
        hasRequiredColumns: false,
        invalidTimestampCount: 0,
        missingTimestampCount: 0,
        missingTimezoneCount: 0,
        duplicateTimestampCount: 0,
        outOfOrderTimestampCount: 0,
        firstOutOfOrderRow: null,
        unrecognizedInteractionTypes: [],
      }),
    );
    await expect(
      inspectRustRawFile(enc.encode("raw"), "raw.csv", 3),
    ).rejects.toThrow("Rust raw-file inspection returned an invalid identity.");
  });

  it("rejects malformed raw inspection and persisted-review identities", async () => {
    kernel.inspect_raw_file_v1 = vi.fn(() =>
      JSON.stringify({
        fileName: "wrong.csv",
        sizeBytes: 3,
        rowCount: 0,
        participantCount: 0,
        warnings: [],
        columns: [],
        timezones: [],
        hasRequiredColumns: false,
        invalidTimestampCount: 0,
        missingTimestampCount: 0,
        missingTimezoneCount: 0,
        duplicateTimestampCount: 0,
        outOfOrderTimestampCount: 0,
        firstOutOfOrderRow: null,
        unrecognizedInteractionTypes: [],
      screenStartEventCount: 0,
      }),
    );
    await expect(
      inspectRustRawFile(enc.encode("raw"), "raw.csv", 3),
    ).rejects.toThrow(/invalid identity/);

    await expect(
      queryPersistedRustReview(
        -1,
        "raw.csv",
        DEFAULT_BROWSER_OPTIONS,
        undefined,
        { persistRustWorkspace: true },
        "1".repeat(64),
      ),
    ).rejects.toThrow(/non-negative safe integer/);
    await expect(
      queryPersistedRustReview(
        3,
        "raw.csv",
        DEFAULT_BROWSER_OPTIONS,
        undefined,
        { persistRustWorkspace: true },
        "not-a-digest",
      ),
    ).rejects.toThrow(/64 lowercase hexadecimal/);
  });

  it("reads a fully verified semantic-index snapshot", async () => {
    const foundational = enc.encode('{"foundation":true}');
    const attestation = enc.encode('{"attested":true}');
    const zeroCleanup = enc.encode('{"removedRows":[]}');
    const scientificMetadata = ([
      ["b05-schoedel-validation-receipt-json", attestation],
      ["foundational-semantics-receipt-json", foundational],
      ["zero-duration-cleanup-evidence-json", zeroCleanup],
    ] satisfies Array<[string, Uint8Array]>).map(([kind, bytes]) => ({
      artifactId: `urn:test:${kind}`,
      kind,
      mediaType: "application/json",
      digest: digestBytes(bytes),
      size: bytes.byteLength,
      derivedFrom: [],
      scientificSourceBindings: [],
    }));
    const source = enc.encode(
      JSON.stringify({
        protocolVersion: "chronicle-semantic-index-source/v7",
        scientificValidationSubstrateKinds: [
          "b05-schoedel-validation-receipt-json",
          "foundational-semantics-receipt-json",
        ],
        scientificEvidenceArtifacts: scientificMetadata,
      }),
    );
    const sourceEntry = {
      artifactId: "urn:test:semantic-index-source-json",
      kind: "semantic-index-source-json",
      mediaType: "application/json",
      digest: digestBytes(source),
      size: source.byteLength,
      derivedFrom: [],
    };
    const closure = enc.encode(
      JSON.stringify({ workspaceId, artifacts: [sourceEntry, ...scientificMetadata] }),
    );
    const localClosureDigest = digestBytes(closure);
    const rootCommit = enc.encode(
      JSON.stringify({ artifactClosureDigest: localClosureDigest }),
    );
    const localRootDigest = digestBytes(rootCommit);
    const localObjects = new Map<string, Uint8Array>([
      [localRootDigest, rootCommit],
      [localClosureDigest, closure],
      [sourceEntry.digest, source],
      ...scientificMetadata.map((entry, index) => [
        entry.digest,
        [attestation, foundational, zeroCleanup][index]!,
      ] as const),
    ]);
    opfs.recoverRuntimeWorkspace.mockResolvedValue({
      ...slot,
      generation: 7,
      workspaceRootDigest: localRootDigest,
    });
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(localObjects.get(digest) ?? enc.encode("missing")),
    );
    setRustPersistenceForTesting({
      openRoot: () => Promise.resolve(root),
      recover: () => Promise.resolve(undefined),
      verify: () => Promise.resolve(),
      persist: () => Promise.resolve(slot),
    });
    try {
      const bundle = new Uint8Array(attestation.byteLength + foundational.byteLength);
      bundle.set(attestation, 0);
      bundle.set(foundational, attestation.byteLength);
      await expect(readVerifiedSemanticIndexSnapshot(workspaceId)).resolves.toEqual({
        workspaceRootDigest: localRootDigest,
        revision: 7,
        source,
        scientificArtifactBundle: bundle,
      });
    } finally {
      setRustPersistenceForTesting(null);
    }
  });

  /**
   * Every rule `assembleVerifiedSemanticIndexSnapshot` applies to a persisted
   * snapshot before it hands the source and the scientific bundle to the
   * disposable rebuild worker. Each case re-stores a coherent workspace — real
   * objects under their real digests — and changes exactly one declared fact,
   * so the rejection names the rule the change reaches.
   */
  type SnapshotDraft = {
    substrateKinds: string[];
    metadata: Array<Record<string, unknown>>;
    source: Record<string, unknown>;
    closure: Record<string, unknown>;
  };

  function installSemanticSnapshot(mutate: (draft: SnapshotDraft) => void): void {
    const bytesByKind = new Map<string, Uint8Array>([
      ["b05-schoedel-validation-receipt-json", enc.encode('{"attested":true}')],
      ["foundational-semantics-receipt-json", enc.encode('{"foundation":true}')],
    ]);
    const draft: SnapshotDraft = {
      substrateKinds: [...bytesByKind.keys()],
      metadata: [...bytesByKind].map(([kind, bytes]) => ({
        artifactId: `urn:test:${kind}`,
        kind,
        mediaType: "application/json",
        digest: digestBytes(bytes),
        size: bytes.byteLength,
        derivedFrom: [],
        scientificSourceBindings: [],
      })),
      source: {},
      closure: {},
    };
    mutate(draft);
    draft.source = {
      protocolVersion: "chronicle-semantic-index-source/v7",
      scientificValidationSubstrateKinds: draft.substrateKinds,
      scientificEvidenceArtifacts: draft.metadata,
      ...draft.source,
    };
    const source = enc.encode(JSON.stringify(draft.source));
    const sourceEntry: Record<string, unknown> = {
      artifactId: "urn:test:semantic-index-source-json",
      kind: "semantic-index-source-json",
      mediaType: "application/json",
      digest: digestBytes(source),
      size: source.byteLength,
      derivedFrom: [],
      ...draft.closure.sourceEntry as Record<string, unknown> | undefined,
    };
    const closure = enc.encode(
      JSON.stringify({
        workspaceId,
        artifacts: [sourceEntry, ...draft.metadata],
        ...draft.closure,
        sourceEntry: undefined,
      }),
    );
    const localClosureDigest = digestBytes(closure);
    const rootCommit = enc.encode(
      JSON.stringify({ artifactClosureDigest: localClosureDigest }),
    );
    const localRootDigest = digestBytes(rootCommit);
    const localObjects = new Map<string, Uint8Array>([
      [localRootDigest, rootCommit],
      [localClosureDigest, closure],
      [digestBytes(source), source],
      ...[...bytesByKind.values()].map(
        (bytes) => [digestBytes(bytes), bytes] as const,
      ),
    ]);
    opfs.recoverRuntimeWorkspace.mockResolvedValue({
      ...slot,
      workspaceRootDigest: localRootDigest,
    });
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(localObjects.get(digest) ?? enc.encode("missing")),
    );
    setRustPersistenceForTesting({
      openRoot: () => Promise.resolve(root),
      recover: () => Promise.resolve(undefined),
      verify: () => Promise.resolve(),
      persist: () => Promise.resolve(slot),
    });
  }

  it.each([
    [
      "a closure that names another workspace",
      (draft: SnapshotDraft) => {
        draft.closure.workspaceId = `sha256:${"f".repeat(64)}`;
      },
      "persisted Rust artifact closure identity mismatch",
    ],
    [
      "a source entry whose declared size exceeds the stored object",
      (draft: SnapshotDraft) => {
        draft.closure.sourceEntry = { size: 1_000_000 };
      },
      "persisted Rust artifact integrity mismatch: semantic-index-source-json",
    ],
    [
      "a semantic-index source of an older protocol",
      (draft: SnapshotDraft) => {
        draft.source.protocolVersion = "chronicle-semantic-index-source/v6";
      },
      "unsupported semantic index source protocol",
    ],
    [
      "substrate kinds that do not begin with the B05 receipt",
      (draft: SnapshotDraft) => {
        draft.substrateKinds = [
          "foundational-semantics-receipt-json",
          "schoedel-reconstruction-evidence-json",
        ];
      },
      "semantic scientific validation substrate set is invalid",
    ],
    [
      "a substrate kind the source declares no evidence artifact for",
      (draft: SnapshotDraft) => {
        draft.substrateKinds = [
          ...draft.substrateKinds,
          "schoedel-reconstruction-evidence-json",
        ];
      },
      "persisted Rust artifact is missing: schoedel-reconstruction-evidence-json",
    ],
    [
      "a scientific evidence artifact that is not JSON",
      (draft: SnapshotDraft) => {
        draft.metadata[0]!.mediaType = "application/octet-stream";
      },
      "semantic scientific artifact media invalid: b05-schoedel-validation-receipt-json",
    ],
    [
      "a scientific bundle larger than the 128 MiB ceiling",
      (draft: SnapshotDraft) => {
        draft.metadata[0]!.size = 200 * 1024 * 1024;
      },
      "semantic scientific artifact bundle size invalid",
    ],
    [
      "a scientific evidence object shorter than its declared size",
      (draft: SnapshotDraft) => {
        draft.metadata[0]!.size = 4096;
      },
      "persisted Rust artifact integrity mismatch: b05-schoedel-validation-receipt-json",
    ],
  ])("refuses a semantic snapshot with %s", async (_label, mutate, message) => {
    installSemanticSnapshot(mutate);
    try {
      await expect(
        readVerifiedSemanticIndexSnapshot(workspaceId),
      ).rejects.toThrow(message);
    } finally {
      setRustPersistenceForTesting(null);
    }
  });

  it("rejects a coherently re-rooted closure that drops only a derivative scientific object", async () => {
    const foundational = enc.encode('{"foundation":true}');
    const attestation = enc.encode('{"attested":true}');
    const zeroCleanup = enc.encode('{"removedRows":[]}');
    const scientificMetadata = ([
      ["b05-schoedel-validation-receipt-json", attestation],
      ["foundational-semantics-receipt-json", foundational],
      ["zero-duration-cleanup-evidence-json", zeroCleanup],
    ] satisfies Array<[string, Uint8Array]>).map(([kind, bytes]) => ({
      artifactId: `urn:test:${kind}`,
      kind,
      mediaType: "application/json",
      digest: digestBytes(bytes),
      size: bytes.byteLength,
      derivedFrom: [],
      scientificSourceBindings: [],
    }));
    const source = enc.encode(
      JSON.stringify({
        protocolVersion: "chronicle-semantic-index-source/v7",
        scientificValidationSubstrateKinds: [
          "b05-schoedel-validation-receipt-json",
          "foundational-semantics-receipt-json",
        ],
        scientificEvidenceArtifacts: scientificMetadata,
      }),
    );
    const sourceEntry = {
      artifactId: "urn:test:semantic-index-source-json",
      kind: "semantic-index-source-json",
      mediaType: "application/json",
      digest: digestBytes(source),
      size: source.byteLength,
      derivedFrom: [],
    };
    const closure = enc.encode(
      JSON.stringify({
        workspaceId,
        artifacts: [sourceEntry, ...scientificMetadata.slice(0, 2)],
      }),
    );
    const localClosureDigest = digestBytes(closure);
    const rootCommit = enc.encode(
      JSON.stringify({ artifactClosureDigest: localClosureDigest }),
    );
    const localRootDigest = digestBytes(rootCommit);
    const localObjects = new Map<string, Uint8Array>([
      [localRootDigest, rootCommit],
      [localClosureDigest, closure],
      [sourceEntry.digest, source],
      [scientificMetadata[0]!.digest, attestation],
      [scientificMetadata[1]!.digest, foundational],
      // The derivative zero-cleanup object and its closure entry are both
      // absent even though source v7 still declares them.
    ]);
    opfs.recoverRuntimeWorkspace.mockResolvedValue({
      ...slot,
      workspaceRootDigest: localRootDigest,
    });
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(localObjects.get(digest) ?? enc.encode("missing")),
    );
    setRustPersistenceForTesting({
      openRoot: () => Promise.resolve(root),
      recover: () => Promise.resolve(undefined),
      verify: () => Promise.resolve(),
      persist: () => Promise.resolve(slot),
    });
    try {
      await expect(readVerifiedSemanticIndexSnapshot(workspaceId)).rejects.toThrow(
        "semantic scientific artifact closure metadata mismatch",
      );
    } finally {
      setRustPersistenceForTesting(null);
    }
  });

  it("fails closed when a verified closure carries no semantic-index source", async () => {
    // The closure verifies end to end (same objects, same digests, same
    // sizes) — only the semantic-index role is absent. A snapshot reader must
    // say so rather than return an empty or substituted source.
    const closureWithoutIndex = {
      ...validClosure,
      artifacts: validClosure.artifacts.map((entry) =>
        entry.kind === "semantic-index-source-json"
          ? { ...entry, kind: "unassigned-payload-json" }
          : entry,
      ),
    };
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(
          Uint8Array.from(
            digest === closureDigest
              ? enc.encode(JSON.stringify(closureWithoutIndex))
              : (bytesByDigest.get(digest) ?? enc.encode("missing")),
          ),
        ),
    );

    await expect(readVerifiedSemanticIndexSnapshot(workspaceId)).rejects.toThrow(
      "persisted Rust artifact is missing: semantic-index-source-json",
    );
  });

  it("stops a recovered workspace history that loops back on itself", async () => {
    // Every commit points at its predecessor, so a root reached twice is not a
    // history: walking it would either never terminate or double-count objects
    // into the allowed set. The walk is bounded and fails loudly instead.
    const selfReferencing = {
      ...validCommit,
      previousWorkspaceRootDigest: rootDigest,
    };
    const selfReferencingState = {
      ...executionState,
      previousWorkspaceRootDigest: rootDigest,
    };
    const stateBytes = enc.encode(JSON.stringify(selfReferencingState));
    const selfReferencingClosure = {
      ...validClosure,
      previousWorkspaceRootDigest: rootDigest,
      // The closure keeps declaring the real size of every object it lists.
      artifacts: validClosure.artifacts.map((entry) =>
        entry.kind === "execution-state-json"
          ? { ...entry, size: stateBytes.byteLength }
          : entry,
      ),
    };
    const cyclicBytes = new Map<string, Uint8Array>([
      [rootDigest, enc.encode(JSON.stringify(selfReferencing))],
      [closureDigest, enc.encode(JSON.stringify(selfReferencingClosure))],
      [executionStateDigest, stateBytes],
    ]);
    opfs.recoverRuntimeWorkspace.mockResolvedValue({
      ...slot,
      previousWorkspaceRootDigest: rootDigest,
    });
    opfs.readRuntimeObject.mockImplementation(
      (_root: FileSystemDirectoryHandle, digest: string) =>
        Promise.resolve(
          Uint8Array.from(
            cyclicBytes.get(digest) ??
              bytesByDigest.get(digest) ??
              enc.encode("missing"),
          ),
        ),
    );
    opfs.collectRuntimeVerifiedHistory.mockResolvedValueOnce({
      digests: slot.artifactDigests,
      verifiedSizes: new Map(
        slot.artifactDigests.map((digest) => [
          digest,
          (cyclicBytes.get(digest) ?? bytesByDigest.get(digest) ?? enc.encode("missing"))
            .byteLength,
        ]),
      ),
      headDirectDigests: [],
    });

    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      "recovered workspace history is cyclic or too large",
    );
  });

  it("fails closed before execution when durable commits lack Web Locks", async () => {
    vi.stubGlobal("navigator", {});
    await expect(
      executeRustRuntime(
        enc.encode("raw"),
        "Raw.csv",
        {
          ...DEFAULT_BROWSER_OPTIONS,
          processScreenUsage: false,
          selectedTimezone: "UTC",
          useFilterFile: false,
          useAppsForcingScreenOpenFile: false,
          useBackgroundAppsFile: false,
          useAppCodebook: false,
        },
        {},
        { persistRustWorkspace: true },
      ),
    ).rejects.toThrow(/Web Locks API/);
    await expect(
      queryRustReview(
        enc.encode("raw"),
        "Raw.csv",
        { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC" },
        {},
        { persistRustWorkspace: true },
      ),
    ).rejects.toThrow(/Web Locks API/);
    await expect(
      queryPersistedRustReview(
        3,
        "Raw.csv",
        { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC" },
        {},
        { persistRustWorkspace: true },
        "1".repeat(64),
      ),
    ).rejects.toThrow(/Web Locks API/);
  });

  it("traces Rust kernel failures without replacing the original error", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const priorFetch = globalThis.fetch;
    const execute = (traceId: string, useUploadedSupport: boolean) =>
      executeRustRuntime(
        enc.encode("raw"),
        "Raw.csv",
        {
          ...DEFAULT_BROWSER_OPTIONS,
          processScreenUsage: false,
          selectedTimezone: "UTC",
          useFilterFile: true,
          useAppsForcingScreenOpenFile: false,
          useBackgroundAppsFile: false,
          useAppCodebook: false,
          enableStudyWindowFilter: useUploadedSupport,
        },
        useUploadedSupport
          ? {
              filterFile: {
                name: "filter.csv",
                bytes: enc.encode("app_package_name\nexample.filtered").buffer,
              },
              studyDatesFile: {
                name: "study-dates.csv",
                bytes: enc.encode("participant_id,start_date,end_date").buffer,
              },
            }
          : {},
        {
          persistRustWorkspace: false,
          performanceTraceId: traceId,
          datetimeOfPreprocessing: "2026-07-26 00:00:00 UTC",
        },
      );
    try {
      kernel.execute_workspace.mockImplementationOnce(() => {
        throw new Error("profiled kernel failure");
      });
      await expect(execute("error-object", true)).rejects.toThrow(
        "profiled kernel failure",
      );
      expect(info).toHaveBeenLastCalledWith(
        expect.stringContaining('"outcome":"error","elapsedMs":'),
      );
      expect(info).toHaveBeenLastCalledWith(
        expect.stringContaining('"error":"profiled kernel failure"'),
      );

      kernel.execute_workspace.mockImplementationOnce(() => {
        // Deliberately model a non-Error value crossing the WASM boundary.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "non-error failure";
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(new Response("app_package_name\nexample.filtered")),
        ),
      );
      await expect(execute("non-error-value", false)).rejects.toBe(
        "non-error failure",
      );
      expect(info).toHaveBeenLastCalledWith(
        expect.stringContaining('"error":"non-error failure"'),
      );
    } finally {
      vi.stubGlobal("fetch", priorFetch);
      info.mockRestore();
    }
  });

  it("requires uploaded study inputs before entering the Rust kernel", async () => {
    await expect(
      executeRustRuntime(
        enc.encode("raw"),
        "Raw.csv",
        {
          ...DEFAULT_BROWSER_OPTIONS,
          selectedTimezone: "UTC",
          useFilterFile: false,
          useAppsForcingScreenOpenFile: false,
          useBackgroundAppsFile: false,
          useAppCodebook: false,
          enableStudyWindowFilter: true,
        },
        {},
        {
          persistRustWorkspace: false,
          datetimeOfPreprocessing: "2026-07-26 00:00:00 UTC",
        },
      ),
    ).rejects.toThrow(/studyDatesFile is required/);
    expect(kernel.execute_workspace).not.toHaveBeenCalled();
  });

  it("allows an injected persistence adapter to run without browser Web Locks", async () => {
    vi.stubGlobal("navigator", {});
    setRustPersistenceForTesting({
      openRoot: () => Promise.resolve(root),
      recover: () => Promise.resolve(undefined),
      persist: () => Promise.resolve(slot),
    });
    const runtime = {
      persistRustWorkspace: true,
      datetimeOfPreprocessing: "2026-07-26 00:00:00 UTC",
      incrementalEngine: true,
      provenanceEvidence: true,
    } as const;
    const options = {
      ...DEFAULT_BROWSER_OPTIONS,
      processScreenUsage: false,
      selectedTimezone: "UTC",
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
    };
    try {
      kernel.execute_workspace.mockImplementationOnce(() => {
        throw new Error("custom full execution reached Rust");
      });
      await expect(
        executeRustRuntime(enc.encode("raw"), "Raw.csv", options, {}, runtime),
      ).rejects.toThrow(/custom full execution reached Rust/);

      kernel.execute_workspace.mockImplementationOnce(() => {
        throw new Error("custom review execution reached Rust");
      });
      await expect(
        queryRustReview(enc.encode("raw"), "Raw.csv", options, {}, runtime),
      ).rejects.toThrow(/custom review execution reached Rust/);
    } finally {
      setRustPersistenceForTesting(null);
    }
  });

  it("installs the payload spill bridge with the requested budget", async () => {
    const bridge: PayloadSpillBridge = {
      put: () => {},
      get: () => new Uint8Array(),
      remove: () => {},
    };

    await installRustPayloadSpill(bridge, 512 * 1024 * 1024);

    expect(kernel.install_payload_spill).toHaveBeenCalledWith(
      bridge,
      536870912n,
    );
  });
});

/**
 * The three preflights `executeRustRuntimeUnlocked` runs before it ever calls
 * `execute_workspace`, exercised through the public entry point. Their order is
 * opener set, then maximum duration, then scientific inputs, so each block below
 * keeps the earlier preflights executable.
 */
describe("pre-execution preflight refusals", () => {
  const baseOptions = {
    ...DEFAULT_BROWSER_OPTIONS,
    processScreenUsage: false,
    selectedTimezone: "UTC",
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useBackgroundAppsFile: false,
    useAppCodebook: false,
  };
  const runtime = {
    persistRustWorkspace: false,
    datetimeOfPreprocessing: "2026-08-11 00:00:00 UTC",
  } as const;
  const explicitB06 = {
    ...baseOptions,
    maximumDurationPolicy: "post_reconstruction_strict_max_v1" as const,
    maximumDurationDisposition: "truncate_to_threshold" as const,
    maximumDurationThresholdSource: "fixed_parameter" as const,
    maximumDurationThresholdNs: "21600000000000",
  };

  function maximumDurationJson(
    overrides: Record<string, unknown> = {},
    applicabilityOverrides: Record<string, unknown> = {},
  ): string {
    return JSON.stringify({
      status: "executable",
      applicability: {
        protocolVersion: "chronicle-maximum-duration/v1",
        shape: "explicit_generic_fixed",
        requestedPolicy: "post_reconstruction_strict_max_v1",
        effectivePolicy: "post_reconstruction_strict_max_v1",
        disposition: "truncate_to_threshold",
        thresholdSource: "fixed_parameter",
        thresholdNs: "21600000000000",
        relation: "controlled_derivative",
        refusalReason: null,
        b06EffectiveStage: "post_reconstruction",
        reconstructionNativeStage: "post_reconstruction",
        checkedI128Preflight: null,
        legacyThresholdHoursCanonical: null,
        legacyThresholdNsCanonical: null,
        legacyOrigin: "absent",
        ...applicabilityOverrides,
      },
      reasonCode: null,
      optionsDigest: payloadDigest,
      ...overrides,
    });
  }

  function run(options: typeof baseOptions) {
    return executeRustRuntime(enc.encode("raw"), "Raw.csv", options, {}, runtime);
  }
  it.each(["throws", "malformed"] as const)("preserves the original binding refusal when its diagnostic %s", async mode => {
    const refusal = new Error("unresolved binding holes for required roles: filter_file; evaluate requirements before execution");
    const diagnostic = vi.fn(() => { if (mode === "throws") throw new Error("diagnostic failed"); return "{}"; });
    setRustRuntimeForTesting({ ...kernel, evaluate_workspace_requirements: diagnostic });
    kernel.execute_workspace.mockImplementationOnce(() => { throw refusal; });
    try { await expect(run(baseOptions)).rejects.toBe(refusal); expect(diagnostic).toHaveBeenCalledOnce(); }
    finally { setRustRuntimeForTesting(kernel); }
  });

  it("wraps an unreadable opener-set preflight answer with the failing boundary", async () => {
    kernel.opener_set_applicability_json.mockImplementationOnce(
      () => "not-json",
    );
    await expect(run(baseOptions)).rejects.toThrow(/^opener-set preflight failed: /);
    expect(kernel.execute_workspace).not.toHaveBeenCalled();
  });

  it("rejects an opener-set answer about a different opener set than the sanitized request", async () => {
    kernel.opener_set_applicability_json.mockImplementationOnce(() =>
      JSON.stringify({
        status: "executable",
        requestedOpenerSetId: "gesis_app_scoped_starts",
        resolvedOpenerSetId: "gesis_app_scoped_starts",
        effectiveOpenerSetId: "gesis_app_scoped_starts",
        relation: "baseline_native",
        reasonCode: null,
        optionsDigest: payloadDigest,
      }),
    );
    await expect(run(baseOptions)).rejects.toThrow(
      "runtime manifest contract violation at openerSetPreflightDecision: requested or resolved id disagrees with sanitized browser settings",
    );
    expect(kernel.execute_workspace).not.toHaveBeenCalled();
  });

  it("does not consult the maximum-duration preflight when every B06 key is omitted", async () => {
    kernel.execute_workspace.mockImplementationOnce(() => {
      throw new Error("reached Rust with no maximum-duration preflight");
    });
    await expect(run(baseOptions)).rejects.toThrow(
      /reached Rust with no maximum-duration preflight/,
    );
    expect(kernel.maximum_duration_applicability_json).not.toHaveBeenCalled();
  });

  it("wraps an unreadable maximum-duration preflight answer with the failing boundary", async () => {
    kernel.maximum_duration_applicability_json.mockImplementationOnce(
      () => "not-json",
    );
    await expect(run(explicitB06)).rejects.toThrow(
      /^maximum-duration preflight failed: /,
    );
    expect(kernel.execute_workspace).not.toHaveBeenCalled();
  });

  it("rejects an explicit B06 request that the kernel resolves to the omitted shape", async () => {
    kernel.maximum_duration_applicability_json.mockImplementationOnce(() =>
      maximumDurationJson({}, { shape: "omitted_legacy" }),
    );
    await expect(run(explicitB06)).rejects.toThrow(
      "runtime manifest contract violation at maximumDurationPreflightDecision: explicit request resolved to the omitted shape",
    );
    expect(kernel.execute_workspace).not.toHaveBeenCalled();
  });

  it("returns a typed maximum-duration refusal before execution", async () => {
    kernel.maximum_duration_applicability_json.mockImplementationOnce(() =>
      maximumDurationJson(
        {
          status: "refused",
          reasonCode:
            "maximum_duration_policy_incompatible_with_reconstruction_strategy",
        },
        {
          relation: "refused",
          effectivePolicy: null,
          refusalReason: "policy_incompatible_with_reconstruction_strategy",
        },
      ),
    );
    const refusal = await run(explicitB06).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RustMaximumDurationRefusalError);
    expect(refusal).toMatchObject({
      name: "RustMaximumDurationRefusalError",
      code: "maximum_duration_refused",
      decision: {
        status: "refused",
        reasonCode:
          "maximum_duration_policy_incompatible_with_reconstruction_strategy",
      },
    });
    expect(kernel.execute_workspace).not.toHaveBeenCalled();
  });

  describe("scientific inputs", () => {
    const scientificOptions = { ...baseOptions, processScreenUsage: true };

    function withScientificPreflight(
      implementation: (requestJson: string) => string,
      body: () => Promise<void>,
    ): Promise<void> {
      const target = kernel as unknown as Record<string, unknown>;
      target.scientific_preflight_json = implementation;
      return body().finally(() => {
        delete target.scientific_preflight_json;
      });
    }

    it("refuses a raw-less full run rather than preflighting nothing", async () => {
      await expect(
        executeRustRuntime(
          new Uint8Array(),
          "Raw.csv",
          scientificOptions,
          {},
          runtime,
        ),
      ).rejects.toThrow(
        "Scientific preflight requires the verified raw artifact; re-inspect and retry.",
      );
      expect(kernel.execute_workspace).not.toHaveBeenCalled();
    });

    it("fails closed when the loaded runtime has no v2 scientific-preflight boundary", async () => {
      await expect(run(scientificOptions)).rejects.toThrow(
        "Scientific preflight failed: runtime WASM does not expose the v2 scientific-preflight boundary",
      );
      expect(kernel.execute_workspace).not.toHaveBeenCalled();
    });

    it("rejects a receipt bound to a different raw artifact than the verified one", async () => {
      await withScientificPreflight(
        () => JSON.stringify(runtimeScientificPreflightFixture()),
        async () => {
          await expect(run(scientificOptions)).rejects.toThrow(
            "runtime manifest contract violation at scientificPreflightReceipt.key: input identity disagrees with the verified raw artifact",
          );
          expect(kernel.execute_workspace).not.toHaveBeenCalled();
        },
      );
    });

    it("returns a typed scientific refusal when an active arm is refused", async () => {
      await withScientificPreflight(
        (requestJson: string) => {
          const request = JSON.parse(requestJson) as { inputSha256: string };
          const receipt = runtimeScientificPreflightFixture();
          return JSON.stringify({
            ...receipt,
            key: {
              ...receipt.key,
              inputDigest: request.inputSha256,
              inputSizeBytes: 3,
            },
            b05Schoedel: {
              ...receipt.b05Schoedel,
              disposition: "refused",
              screenConstructionPhase: "prepared_raw_source_arm",
              screenApplicability: {
                protocolVersion: "chronicle-b05-foundational-semantics/v1",
                relation: "refused",
                executable: false,
                refusalReason: "input_capability_evidence_absent",
                refusalDetail: "capability_evidence_absent",
              },
            },
            eyesInputPartition: {
              ...receipt.eyesInputPartition,
              inputDigest: request.inputSha256,
            },
          });
        },
        async () => {
          const refusal = await run(scientificOptions).catch(
            (error: unknown) => error,
          );
          expect(refusal).toBeInstanceOf(RustScientificPreflightRefusalError);
          // The researcher-facing remedy (#51) leads; the typed code follows.
          expect((refusal as Error).message).toBe(
            "The selected screen-session strategy needs an input capability evidence CSV " +
              "(Files → Study inputs). Supply one, or choose the Chronicle screen strategy. " +
              "Scientific preflight refused (B05/Schoedel: input_capability_evidence_absent/capability_evidence_absent).",
          );
          expect(kernel.execute_workspace).not.toHaveBeenCalled();
        },
      );
    });

    it("rejects an active arm that is neither executable nor explicitly refused", async () => {
      await withScientificPreflight(
        (requestJson: string) => {
          const request = JSON.parse(requestJson) as { inputSha256: string };
          const receipt = runtimeScientificPreflightFixture();
          return JSON.stringify({
            ...receipt,
            key: {
              ...receipt.key,
              inputDigest: request.inputSha256,
              inputSizeBytes: 3,
            },
            eyesInputPartition: {
              ...receipt.eyesInputPartition,
              inputDigest: request.inputSha256,
            },
          });
        },
        async () => {
          await expect(run(scientificOptions)).rejects.toThrow(
            "runtime manifest contract violation at scientificPreflightReceipt: an active scientific arm must be executable or explicitly refused",
          );
          expect(kernel.execute_workspace).not.toHaveBeenCalled();
        },
      );
    });
  });
});
