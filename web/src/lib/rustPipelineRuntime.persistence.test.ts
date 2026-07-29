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
const root = {} as FileSystemDirectoryHandle;
const archive = enc.encode("archive");
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
  requiredViews: [
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
  ].map(([artifactKind, viewId, schemaId], index) => ({
    artifactKind,
    viewId,
    schemaId,
    artifactDigest: viewDigests[index],
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
  opfs.runtimeClosureWorkspaceId.mockReturnValue(workspaceId);
  opfs.importRuntimeClosure.mockImplementation(
    async (
      _root: FileSystemDirectoryHandle,
      _archive: Uint8Array,
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
        object: (digest: string) => bytesByDigest.get(digest)!,
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
    opfs.runtimeClosureWorkspaceId.mockReturnValue(`sha256:${"9".repeat(64)}`);
    await expect(
      importPersistedRustWorkspace(workspaceId, archive),
    ).rejects.toThrow(/identity does not match/);
    opfs.runtimeClosureWorkspaceId.mockReturnValue(workspaceId);
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
    const originalView = bytesByDigest.get(viewDigests[0])!;
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
      bytesByDigest.set(viewDigests[0], enc.encode(fakeView));
      await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
        /typed view is invalid/,
      );
    } finally {
      bytesByDigest.set(rootDigest, originalRoot);
      bytesByDigest.set(executionStateDigest, originalState);
      bytesByDigest.set(viewDigests[0], originalView);
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
    const original = bytesByDigest.get(viewDigests[0])!;
    bytesByDigest.set(
      viewDigests[0],
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
    bytesByDigest.set(viewDigests[0], original);

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
