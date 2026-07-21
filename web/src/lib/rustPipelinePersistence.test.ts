import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type { WorkspaceRootSlot } from "@/lib/opfsArtifactStore";

const opfs = vi.hoisted(() => ({
  exportRuntimeClosure: vi.fn(),
  garbageCollectRuntimeObjects: vi.fn(),
  importRuntimeClosure: vi.fn(),
  openOpfsWorkspace: vi.fn(),
  persistRuntimeWorkspace: vi.fn(),
  readRuntimeObject: vi.fn(),
  recoverRuntimeWorkspace: vi.fn(),
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
  runRustV2Shadow,
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
const root = {} as FileSystemDirectoryHandle;
const archive = enc.encode("archive");

const slot: WorkspaceRootSlot = {
  protocolVersion: "chronicle-opfs-root/v1",
  generation: 3,
  workspaceRootDigest: rootDigest,
  previousWorkspaceRootDigest: previousDigest,
  artifactDigests: [rootDigest, journalDigest, closureDigest, payloadDigest],
  checksum: `sha256:${"7".repeat(64)}`,
};

const validCommit = {
  protocolVersion: "chronicle-preprocessing-runtime/v1",
  command: "ExecuteWorkspace",
  workspaceId,
  previousWorkspaceRootDigest: previousDigest,
  artifactDigests: [journalDigest, closureDigest, payloadDigest],
  journalDigest,
  artifactClosureDigest: closureDigest,
};
const validClosure = {
  protocolVersion: "chronicle-artifact-closure/v1",
  workspaceId,
  journalDigest,
  artifacts: [{ kind: "semantic-index-source-json", digest: payloadDigest }],
};

const bytesByDigest = new Map([
  [rootDigest, enc.encode(JSON.stringify(validCommit))],
  [journalDigest, enc.encode("journal")],
  [closureDigest, enc.encode(JSON.stringify(validClosure))],
  [payloadDigest, enc.encode("payload")],
]);

const kernel = {
  default: () => Promise.resolve(),
  runtime_version: vi.fn(() => "test-runtime"),
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
  execute_workspace: vi.fn(),
  execute_bounded_v2_shadow: vi.fn(),
  verify_evidence_journal_cbor: vi.fn(() => 1),
};

beforeEach(() => {
  vi.clearAllMocks();
  setRustRuntimeForTesting(kernel);
  opfs.openOpfsWorkspace.mockResolvedValue(root);
  opfs.recoverRuntimeWorkspace.mockResolvedValue(slot);
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
          previousWorkspaceRootDigest: previousDigest,
          objects: [rootDigest, journalDigest, closureDigest, payloadDigest].map(
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
  it("verifies, exports, reads, collects, and imports a complete closure", async () => {
    await expect(verifyPersistedRustWorkspace(workspaceId)).resolves.toBe(slot);
    expect(kernel.verify_evidence_journal_cbor).toHaveBeenCalledWith(
      bytesByDigest.get(journalDigest),
    );
    await expect(exportPersistedRustWorkspace(workspaceId)).resolves.toBe(archive);
    await expect(
      readPersistedRustArtifact(workspaceId, "semantic-index-source-json"),
    ).resolves.toEqual(bytesByDigest.get(payloadDigest));
    await expect(garbageCollectPersistedRustWorkspace(workspaceId)).resolves.toBe(4);
    await expect(importPersistedRustWorkspace(workspaceId, archive)).resolves.toBe(slot);
    await expect(importPersistedRustWorkspaceArchive(archive)).resolves.toEqual({
      workspaceId,
      slot,
    });
  });

  it("returns no recovered root and fails closed when an operation requires one", async () => {
    opfs.recoverRuntimeWorkspace.mockResolvedValue(undefined);
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
      /artifact is missing/,
    );
    bytesByDigest.set(closureDigest, enc.encode(JSON.stringify(validClosure)));
  });

  it.each([
    [{ ...validCommit, protocolVersion: "bad" }, /root contract is invalid/],
    [{ ...validCommit, command: "Other" }, /root contract is invalid/],
    [{ ...validCommit, workspaceId: `sha256:${"8".repeat(64)}` }, /root contract is invalid/],
    [{ ...validCommit, previousWorkspaceRootDigest: null }, /root contract is invalid/],
    [{ ...validCommit, artifactDigests: [closureDigest, payloadDigest] }, /root contract is invalid/],
    [{ ...validCommit, artifactDigests: [journalDigest, payloadDigest] }, /root contract is invalid/],
  ])("rejects an invalid recovered root contract", async (commit, pattern) => {
    bytesByDigest.set(rootDigest, enc.encode(JSON.stringify(commit)));
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(pattern);
    bytesByDigest.set(rootDigest, enc.encode(JSON.stringify(validCommit)));
  });

  it("rejects an incomplete retained closure", async () => {
    opfs.recoverRuntimeWorkspace.mockResolvedValue({
      ...slot,
      artifactDigests: [rootDigest, journalDigest, closureDigest],
    });
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(
      /closure is incomplete/,
    );
  });

  it.each([
    [{ ...validClosure, protocolVersion: "bad" }, /artifact closure is invalid/],
    [{ ...validClosure, workspaceId: `sha256:${"8".repeat(64)}` }, /artifact closure is invalid/],
    [{ ...validClosure, journalDigest: payloadDigest }, /artifact closure is invalid/],
    [{ ...validClosure, artifacts: [{ kind: "x", digest: `sha256:${"8".repeat(64)}` }] }, /artifact closure is invalid/],
  ])("rejects invalid semantic artifact closure metadata", async (closure, pattern) => {
    bytesByDigest.set(closureDigest, enc.encode(JSON.stringify(closure)));
    await expect(verifyPersistedRustWorkspace(workspaceId)).rejects.toThrow(pattern);
    bytesByDigest.set(closureDigest, enc.encode(JSON.stringify(validClosure)));
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

  it("reports ineligible and failed comparison modes without claiming parity", async () => {
    const result = {
      inputFileName: "Raw.csv",
      outputs: [],
      originalRowCount: 0,
      processedRowCount: 0,
      availableTimezones: [],
      timezone: "UTC",
      appRowCount: 0,
      screenRowCount: 0,
      timezoneAction: "none" as const,
      rowsBeforeTimezoneHandling: 0,
      rowsAfterTimezoneHandling: 0,
      rowsRemovedByTimezone: 0,
      duplicateTimestampsCorrected: 0,
      exactDuplicateRowsRemoved: 0,
    };
    await expect(
      runRustV2Shadow(
        enc.encode("raw"),
        DEFAULT_BROWSER_OPTIONS,
        {},
        { persistRustWorkspace: false },
        result,
      ),
    ).resolves.toMatchObject({ status: "ineligible" });
    vi.stubGlobal("navigator", {});
    await expect(
      runRustV2Shadow(
        enc.encode("raw"),
        { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC" },
        {},
        { persistRustWorkspace: true },
        result,
      ),
    ).resolves.toMatchObject({ status: "failed", reasons: [expect.stringMatching(/Web Locks/)] });
  });
});
