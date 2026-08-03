import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type { WorkspaceRootSlot } from "@/lib/opfsArtifactStore";

const opfs = vi.hoisted(() => ({
  collectRuntimeHistoryDigests: vi.fn(),
  exportRuntimeClosure: vi.fn(),
  garbageCollectRuntimeObjects: vi.fn(),
  importRuntimeClosure: vi.fn(),
  openOpfsWorkspace: vi.fn(),
  persistRuntimeWorkspace: vi.fn(),
  readRuntimeObject: vi.fn(),
  readRuntimeObjectPrefix: vi.fn(),
  recoverRuntimeWorkspace: vi.fn(),
  recoverRuntimeWorkspaceHead: vi.fn(),
  recoverRuntimeWorkspaceRoots: vi.fn(),
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
  garbageCollectPersistedRustWorkspace,
  getRustPlanStageView,
  getRustRuntimeVersion,
  initializeRustRuntime,
  importPersistedRustWorkspace,
  importPersistedRustWorkspaceArchive,
  inspectRustRawFile,
  queryPersistedRustReview,
  queryRustReview,
  readPersistedRustArtifact,
  readPersistedRustReviewBases,
  readPersistedRustWorkspaceHead,
  readVerifiedSemanticIndexSnapshot,
  runtimeWorkspaceId,
  setRustRuntimeForTesting,
  setRustPersistenceForTesting,
  verifyPersistedRustWorkspace,
} from "@/lib/rustPipelineRuntime";

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

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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
  protocolVersion: "chronicle-preprocessing-runtime/v1",
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
      ["stage-view-json", "chronicle.stage.v1", "urn:chronicle:view:stage:v1"],
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
const viewValues = validCommit.requiredViews.map((binding) => ({
  protocol_version: "0.1",
  view_id: binding.viewId,
  family: "incremental-dataflow",
  schema_id: binding.schemaId,
  revision: 1,
  root_digest: executionStateDigest,
  payload: {},
}));
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
  runtime_identity_json: vi.fn(() =>
    JSON.stringify({
      protocolVersion: "chronicle-preprocessing-runtime/v1",
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
  pipeline_step_contract_json: vi.fn(() =>
    JSON.stringify({
      protocolVersion: "chronicle-preprocessing-step-contract/v3",
      groups: [],
      steps: [],
    }),
  ),
  plan_stage_view_json: vi.fn(() =>
    JSON.stringify({
      protocol_version: "0.1",
      view_id: "chronicle.stage.v1",
      family: "incremental-dataflow",
      schema_id: "urn:chronicle:view:stage:v1",
      revision: 0,
      root_digest: rootDigest,
      payload: { stage: null, node_states: [], step_states: [] },
    }),
  ),
  review_base_probe_spec_json: vi.fn(() =>
    JSON.stringify({
      reviewBaseBytes: 148,
      reconstructionBaseBytes: 116,
    }),
  ),
  RuntimeSupportFiles: class {
    put() {}
    put_with_name() {}
    free() {}
  },
  discover_timezones_v2: () => ["UTC"],
  inspect_raw_file_v1: () =>
    JSON.stringify({
      fileName: "raw.csv",
      warnings: [],
      columns: [],
      timezones: [],
    }),
  execute_workspace: vi.fn(),
  execute_workspace_with_review_base: vi.fn(),
  execute_workspace_with_review_bases: vi.fn(),
  prepare_persisted_workspace_review: vi.fn(),
  prepare_workspace_review: vi.fn(),
  verify_evidence_journal_cbor: vi.fn(() => 1),
  set_comparison_cache_capacity: vi.fn(),
  get_comparison_cache_retained: vi.fn(() => 0),
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
  opfs.readRuntimeObject.mockImplementation(
    (_root: FileSystemDirectoryHandle, digest: string) =>
      Promise.resolve(bytesByDigest.get(digest) ?? enc.encode("missing")),
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
        object: (digest: string) => Promise.resolve(bytesByDigest.get(digest)!),
      });
      return slot;
    },
  );
});

describe("persisted Rust workspace boundary", () => {
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
      selectedTimezone: "UTC",
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
    };
    const runtime = {
      persistRustWorkspace: true,
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
    expect(kernel.verify_evidence_journal_cbor).toHaveBeenCalledWith(
      bytesByDigest.get(journalDigest),
    );
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
      garbageCollectPersistedRustWorkspace(workspaceId),
    ).resolves.toBe(4);
    expect(workspaceLockRequest).toHaveBeenCalledWith(
      `chronicle-preprocessing:${workspaceId}`,
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
      `chronicle-preprocessing:${workspaceId}`,
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
    kernel.runtime_identity_json.mockReturnValueOnce(
      JSON.stringify({
        protocolVersion: "chronicle-preprocessing-runtime/v1",
        implementationDigest: `sha256:${"7".repeat(64)}`,
        buildEnvironmentDigest,
        productContractDigest,
        planDigest,
        profileDigest,
        profileLockDigest,
        runtimeAuthorityDigest,
        dependencyCertificateDigest,
      }),
    );
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /different runtime identity/,
    );
  });

  it("rejects an unsupported loaded runtime protocol and duplicate retained digests", async () => {
    kernel.runtime_identity_json.mockReturnValueOnce(
      JSON.stringify({
        protocolVersion: "chronicle-preprocessing-runtime/v99",
        implementationDigest,
        buildEnvironmentDigest,
        productContractDigest,
        planDigest,
        profileDigest,
        profileLockDigest,
        runtimeAuthorityDigest,
        dependencyCertificateDigest,
      }),
    );
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

  it("returns no recovered root and fails closed when an operation requires one", async () => {
    opfs.recoverRuntimeWorkspace.mockResolvedValue(undefined);
    opfs.recoverRuntimeWorkspaceRoots.mockResolvedValue([]);
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
      const fakeView = new TextDecoder()
        .decode(originalView)
        .replace("chronicle.stage.v1", "chronicle.wrong.v1");
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
          view_id: "chronicle.stage.v1",
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
      getRustPlanStageView({
        ...DEFAULT_BROWSER_OPTIONS,
        selectedTimezone: "   ",
      }),
    ).resolves.toMatchObject({ view_id: "chronicle.stage.v1" });
    expect(kernel.plan_stage_view_json).toHaveBeenCalledWith(
      expect.stringContaining('"timezone":"UTC"'),
    );
    await getRustPlanStageView({
      ...DEFAULT_BROWSER_OPTIONS,
      timezoneHandling: "primary-convert",
      selectedTimezone: "America/Chicago",
    });
    expect(kernel.plan_stage_view_json).toHaveBeenLastCalledWith(
      expect.stringContaining('"timezone":"America/Chicago"'),
    );
  });

  it("rejects malformed raw inspection and persisted-review identities", async () => {
    kernel.inspect_raw_file_v1 = vi.fn(() =>
      JSON.stringify({ fileName: "wrong.csv" }),
    );
    await expect(
      inspectRustRawFile(enc.encode("raw"), "raw.csv", 3),
    ).rejects.toThrow(/invalid result/);

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
    await expect(
      readVerifiedSemanticIndexSnapshot(workspaceId),
    ).resolves.toEqual({
      workspaceRootDigest: rootDigest,
      source: bytesByDigest.get(payloadDigest),
    });
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
          digest === closureDigest
            ? enc.encode(JSON.stringify(closureWithoutIndex))
            : (bytesByDigest.get(digest) ?? enc.encode("missing")),
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
          cyclicBytes.get(digest) ??
            bytesByDigest.get(digest) ??
            enc.encode("missing"),
        ),
    );

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
    } as const;
    const options = {
      ...DEFAULT_BROWSER_OPTIONS,
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
});
