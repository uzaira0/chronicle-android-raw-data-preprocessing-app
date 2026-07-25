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
  recoverRuntimeWorkspace: vi.fn(),
  recoverRuntimeWorkspaceRoots: vi.fn(),
  runtimeClosureWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/opfsArtifactStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/opfsArtifactStore")>()),
  ...opfs,
}));

import {
  executeRustRuntime,
  exportPersistedRustWorkspace,
  garbageCollectPersistedRustWorkspace,
  getRustPlanStageView,
  getRustRuntimeVersion,
  importPersistedRustWorkspace,
  importPersistedRustWorkspaceArchive,
  readPersistedRustArtifact,
  readPersistedRustWorkspaceHead,
  runtimeWorkspaceId,
  setRustRuntimeForTesting,
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
    ["artifact-view-json", "chronicle.artifact.v1", "urn:chronicle:view:artifact:v1"],
    ["obligation-view-json", "chronicle.obligation.v1", "urn:chronicle:view:obligation:v1"],
    ["explanation-view-json", "chronicle.explanation.v1", "urn:chronicle:view:explanation:v1"],
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
  ...viewDigests.map((digest, index) => [
    digest,
    enc.encode(JSON.stringify(viewValues[index])),
  ] as const),
]);
const metadata = (kind: string, digest: string) => ({
  artifactId: `urn:test:${kind}`,
  kind,
  mediaType: kind.endsWith("json") ? "application/json" : "application/octet-stream",
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
  RuntimeSupportFiles: class {
    put() {}
    put_with_name() {}
    free() {}
  },
  discover_timezones_v2: () => ["UTC"],
  inspect_raw_file_v1: () =>
    JSON.stringify({ fileName: "raw.csv", warnings: [], columns: [], timezones: [] }),
  execute_workspace: vi.fn(),
  execute_workspace_with_review_base: vi.fn(),
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
  opfs.openOpfsWorkspace.mockResolvedValue(root);
  opfs.recoverRuntimeWorkspace.mockResolvedValue(slot);
  opfs.recoverRuntimeWorkspaceRoots.mockResolvedValue([slot]);
  opfs.collectRuntimeHistoryDigests.mockResolvedValue(slot.artifactDigests);
  opfs.readRuntimeObject.mockImplementation(
    (_root: FileSystemDirectoryHandle, digest: string) =>
      Promise.resolve(bytesByDigest.get(digest) ?? enc.encode("missing")),
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
          ].map(
            (digest) => ({ digest, size: bytesByDigest.get(digest)!.byteLength, offset: 0 }),
          ),
        },
        object: (digest: string) => bytesByDigest.get(digest)!,
      });
      return slot;
    },
  );
});

describe("persisted Rust workspace boundary", () => {
  it("separates same-named inputs when their raw bytes differ", async () => {
    const first = await runtimeWorkspaceId("Raw.csv", enc.encode("first"));
    const preverified = await runtimeWorkspaceId(
      "Raw.csv",
      enc.encode("first"),
      "a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e",
    );
    const second = await runtimeWorkspaceId("Raw.csv", enc.encode("second"));
    const renamed = await runtimeWorkspaceId("Renamed.csv", enc.encode("first"));

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(preverified).toBe(first);
    expect(second).not.toBe(first);
    expect(renamed).not.toBe(first);
    await expect(
      runtimeWorkspaceId("Raw.csv", enc.encode("first"), "not-a-digest"),
    ).rejects.toThrow("64 lowercase hexadecimal");
  });

  it("verifies, exports, reads, collects, and imports a complete closure", async () => {
    await expect(readPersistedRustWorkspaceHead(workspaceId)).resolves.toBe(rootDigest);
    await expect(verifyPersistedRustWorkspace(workspaceId)).resolves.toBe(slot);
    expect(kernel.verify_evidence_journal_cbor).toHaveBeenCalledWith(
      bytesByDigest.get(journalDigest),
    );
    await expect(exportPersistedRustWorkspace(workspaceId)).resolves.toBe(archive);
    await expect(
      readPersistedRustArtifact(workspaceId, "semantic-index-source-json"),
    ).resolves.toEqual(bytesByDigest.get(payloadDigest));
    await expect(
      readPersistedRustArtifact(workspaceId, "artifact-closure-json"),
    ).resolves.toEqual(bytesByDigest.get(closureDigest));
    await expect(garbageCollectPersistedRustWorkspace(workspaceId)).resolves.toBe(4);
    expect(workspaceLockRequest).toHaveBeenCalledWith(
      `chronicle-preprocessing:${workspaceId}`,
      { mode: "exclusive" },
      expect.any(Function),
    );
    await expect(importPersistedRustWorkspace(workspaceId, archive)).resolves.toBe(slot);
    await expect(importPersistedRustWorkspaceArchive(archive)).resolves.toEqual({
      workspaceId,
      slot,
    });
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

  it("returns no recovered root and fails closed when an operation requires one", async () => {
    opfs.recoverRuntimeWorkspace.mockResolvedValue(undefined);
    opfs.recoverRuntimeWorkspaceRoots.mockResolvedValue([]);
    await expect(verifyPersistedRustWorkspace(workspaceId)).resolves.toBeUndefined();
    await expect(exportPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /no persisted Rust workspace/,
    );
    await expect(readPersistedRustArtifact(workspaceId, "missing")).rejects.toThrow(
      /no persisted Rust workspace/,
    );
    await expect(garbageCollectPersistedRustWorkspace(workspaceId)).resolves.toBe(4);
    expect(opfs.garbageCollectRuntimeObjects).toHaveBeenLastCalledWith(root, []);
  });

  it("rejects import identity drift and absent artifact assignments", async () => {
    opfs.runtimeClosureWorkspaceId.mockReturnValue(`sha256:${"9".repeat(64)}`);
    await expect(importPersistedRustWorkspace(workspaceId, archive)).rejects.toThrow(
      /identity does not match/,
    );
    opfs.runtimeClosureWorkspaceId.mockReturnValue(workspaceId);
    const missing = { ...validClosure, artifacts: [] };
    bytesByDigest.set(closureDigest, enc.encode(JSON.stringify(missing)));
    await expect(readPersistedRustArtifact(workspaceId, "missing")).rejects.toThrow(
      /contract violation|artifact closure set is invalid/,
    );
    bytesByDigest.set(closureDigest, enc.encode(JSON.stringify(validClosure)));
  });

  it.each([
    [{ ...validCommit, protocolVersion: "bad" }, /root contract is invalid/],
    [{ ...validCommit, command: "Other" }, /root contract is invalid/],
    [{ ...validCommit, workspaceId: `sha256:${"8".repeat(64)}` }, /root identity is invalid/],
    [{ ...validCommit, previousWorkspaceRootDigest: previousDigest }, /root identity is invalid/],
    [{ ...validCommit, artifactDigests: [closureDigest, payloadDigest] }, /omits a required artifact/],
    [{ ...validCommit, artifactDigests: [journalDigest, payloadDigest] }, /omits a required artifact/],
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
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(pattern);
    bytesByDigest.set(rootDigest, enc.encode(JSON.stringify(validCommit)));
  });

  it("rejects an incomplete retained closure", async () => {
    const incomplete = {
      ...slot,
      artifactDigests: [rootDigest, journalDigest, closureDigest],
    };
    opfs.recoverRuntimeWorkspace.mockResolvedValue(incomplete);
    opfs.collectRuntimeHistoryDigests.mockResolvedValue(incomplete.artifactDigests);
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
    opfs.collectRuntimeHistoryDigests.mockResolvedValue(missingView.artifactDigests);
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /missing or unbound objects/,
    );
  });

  it.each([
    [{ ...validClosure, protocolVersion: "bad" }, /artifact closure identity mismatch|artifact closure set/],
    [{ ...validClosure, workspaceId: `sha256:${"8".repeat(64)}` }, /artifact closure identity mismatch/],
    [{ ...validClosure, journalDigest: payloadDigest }, /artifact closure identity mismatch/],
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
  ])("rejects invalid semantic artifact closure metadata", async (closure, pattern) => {
    bytesByDigest.set(closureDigest, enc.encode(JSON.stringify(closure)));
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(pattern);
    bytesByDigest.set(closureDigest, enc.encode(JSON.stringify(validClosure)));
  });

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
    await expect(getRustRuntimeVersion()).resolves.toBe("test-runtime");
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

  it("fails closed before execution when durable commits lack Web Locks", async () => {
    vi.stubGlobal("navigator", {});
    await expect(
      executeRustRuntime(
        enc.encode("raw"),
        "Raw.csv",
        { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC" },
        {},
        { persistRustWorkspace: true },
      ),
    ).rejects.toThrow(/Web Locks API/);
  });

});
