import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  decodeReviewRuntimeManifest,
  decodeRuntimeManifest,
  executeRustRuntime,
  queryPersistedRustReview,
  queryRustReview,
  setRustRuntimeForTesting,
  verifyRuntimeArtifactCatalog,
  type RuntimeManifest,
} from "@/lib/rustPipelineRuntime";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

let manifest: RuntimeManifest;
let fullArtifacts: Map<string, Uint8Array>;
let reviewManifest: Record<string, unknown>;
let reviewSummaryBytes: Uint8Array;

function reviewSourceFixture(): Uint8Array {
  return new TextEncoder().encode(
    [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Review,P99,Target Child,Example,Activity Resumed,example.app,2026-03-08 10:00:00,America/Chicago",
      "Review,P99,Target Child,Example,Activity Paused,example.app,2026-03-08 10:01:00,America/Chicago",
    ].join("\n"),
  );
}

function reviewOptions() {
  return {
    ...DEFAULT_BROWSER_OPTIONS,
    studyName: "Review contract proof",
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-convert" as const,
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useBackgroundAppsFile: false,
    useAppCodebook: false,
    processScreenUsage: false,
    enablePlotting: false,
  };
}

const REVIEW_RUNTIME = {
  datetimeOfPreprocessing: "2026-07-26 00:00:00 UTC",
  persistRustWorkspace: false,
} as const;

function fullSourceFixture(): Uint8Array {
  return new TextEncoder().encode(
    [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Example,Unknown importance: 1,example.app,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Example,Unknown importance: 2,example.app,2026-03-07 10:01:00,America/Chicago",
    ].join("\n"),
  );
}

function continuationDisplacementFixture(): Uint8Array {
  return new TextEncoder().encode(
    new TextDecoder().decode(reviewSourceFixture()).replaceAll("P99", "P98"),
  );
}

function fullOptions() {
  return {
    ...DEFAULT_BROWSER_OPTIONS,
    studyName: "Runtime Contract Proof",
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-convert" as const,
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useBackgroundAppsFile: false,
    useAppCodebook: false,
    processScreenUsage: false,
    enablePlotting: false,
  };
}

const FULL_RUNTIME = {
  datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
  persistRustWorkspace: false,
} as const;

class MemoryFileHandle {
  readonly kind = "file" as const;
  bytes = new Uint8Array();

  getFile(): Promise<File> {
    return Promise.resolve(new File([this.bytes], "object"));
  }

  createWritable(): Promise<FileSystemWritableFileStream> {
    let pending = new Uint8Array();
    return Promise.resolve({
      write(data: FileSystemWriteChunkType) {
        if (data instanceof Uint8Array) pending = Uint8Array.from(data);
        else if (data instanceof ArrayBuffer) pending = new Uint8Array(data);
        else throw new Error("unsupported test write");
        return Promise.resolve();
      },
      close: () => {
        this.bytes = pending;
        return Promise.resolve();
      },
    } as FileSystemWritableFileStream);
  }
}

class MemoryDirectoryHandle {
  readonly kind = "directory" as const;
  readonly directories = new Map<string, MemoryDirectoryHandle>();
  readonly files = new Map<string, MemoryFileHandle>();

  getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle> {
    let directory = this.directories.get(name);
    if (!directory && options?.create) {
      directory = new MemoryDirectoryHandle();
      this.directories.set(name, directory);
    }
    if (!directory) throw new DOMException("missing", "NotFoundError");
    return Promise.resolve(directory as unknown as FileSystemDirectoryHandle);
  }

  getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<FileSystemFileHandle> {
    let file = this.files.get(name);
    if (!file && options?.create) {
      file = new MemoryFileHandle();
      this.files.set(name, file);
    }
    if (!file) throw new DOMException("missing", "NotFoundError");
    return Promise.resolve(file as unknown as FileSystemFileHandle);
  }

  removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException("missing", "NotFoundError");
    }
    return Promise.resolve();
  }

  async *entries(): AsyncIterableIterator<
    [string, FileSystemFileHandle | FileSystemDirectoryHandle]
  > {
    await Promise.resolve();
    for (const [name, directory] of this.directories) {
      yield [name, directory as unknown as FileSystemDirectoryHandle];
    }
    for (const [name, file] of this.files) {
      yield [name, file as unknown as FileSystemFileHandle];
    }
  }
}

function memoryOpfsRoot(
  root: MemoryDirectoryHandle,
): FileSystemDirectoryHandle {
  return root as unknown as FileSystemDirectoryHandle;
}

function cloneManifest(): RuntimeManifest {
  return structuredClone(manifest);
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  return value as unknown[];
}

function firstRecord(
  candidate: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  return record(array(candidate[field])[0]);
}

function representativeSourceFixture(): Uint8Array {
  const rows = [
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
  ];
  for (let index = 0; index < 600; index += 1) {
    const hour = Math.floor(index / 60);
    const minute = index % 60;
    const interaction =
      index % 2 === 0 ? "Activity Resumed" : "Activity Paused";
    rows.push(
      `Study,P01,Target Child,Chat,${interaction},com.example.chat,2026-03-07 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00,America/Chicago`,
    );
  }
  return new TextEncoder().encode(rows.join("\n"));
}

type FakeReviewRuntimeOptions = {
  manifestJson?: string;
  mutateManifest?: (candidate: Record<string, unknown>) => void;
  artifactCount?: number;
  mutateMetadata?: (candidate: Record<string, unknown>) => void;
  artifactBytes?: Uint8Array;
  handleFreeError?: Error;
  supportFreeError?: Error;
};

function installFakeReviewRuntime({
  manifestJson,
  mutateManifest,
  artifactCount = 1,
  mutateMetadata,
  artifactBytes = reviewSummaryBytes,
  handleFreeError,
  supportFreeError,
}: FakeReviewRuntimeOptions = {}) {
  const candidate = structuredClone(reviewManifest);
  mutateManifest?.(candidate);
  const metadata: Record<string, unknown> = {
    artifactId: "artifact:review-summary-json",
    kind: "review-summary-json",
    mediaType: "application/json",
    digest: candidate.reviewSummaryDigest,
    size: artifactBytes.byteLength,
    derivedFrom: [],
  };
  mutateMetadata?.(metadata);
  const handleFree = vi.fn(() => {
    if (handleFreeError) throw handleFreeError;
  });
  const supportFree = vi.fn(() => {
    if (supportFreeError) throw supportFreeError;
  });
  const fakeRuntime = {
    implementation_build_digest: () => reviewManifest.implementationDigest,
    build_environment_digest: () => reviewManifest.buildEnvironmentDigest,
    RuntimeSupportFiles: class {
      put() {}
      put_with_name() {}
      free() {
        supportFree();
      }
    },
    execute_workspace: () => ({
      artifact_count: artifactCount,
      manifest_json: () => manifestJson ?? JSON.stringify(candidate),
      artifact_metadata_json: () => JSON.stringify(metadata),
      take_artifact_bytes: () => artifactBytes,
      free: handleFree,
    }),
  } as unknown as Parameters<typeof setRustRuntimeForTesting>[0];
  setRustRuntimeForTesting(fakeRuntime);
  return { handleFree, supportFree };
}

async function expectFakeReviewFailure(
  options: FakeReviewRuntimeOptions,
  expected: RegExp,
): Promise<void> {
  installFakeReviewRuntime(options);
  try {
    await expect(
      queryRustReview(
        reviewSourceFixture(),
        "review-contract.csv",
        reviewOptions(),
        undefined,
        REVIEW_RUNTIME,
      ),
    ).rejects.toThrow(expected);
  } finally {
    setRustRuntimeForTesting(runtimeWasm);
  }
}

type FakeFullRuntimeOptions = {
  mutateManifest?: (candidate: RuntimeManifest) => void;
  artifactMetadataJson?: (
    index: number,
    metadata: RuntimeManifest["artifacts"][number],
  ) => string;
  mutateArtifactBytes?: (kind: string, bytes: Uint8Array) => Uint8Array;
};

function installFakeFullRuntime({
  mutateManifest,
  artifactMetadataJson,
  mutateArtifactBytes,
}: FakeFullRuntimeOptions = {}): void {
  const candidate = cloneManifest();
  mutateManifest?.(candidate);
  const metadata = structuredClone(candidate.artifacts);
  const fakeRuntime = {
    implementation_build_digest: () => manifest.implementationDigest,
    build_environment_digest: () => manifest.buildEnvironmentDigest,
    runtime_identity_json: () => runtimeWasm.runtime_identity_json(),
    RuntimeSupportFiles: class {
      put() {}
      put_with_name() {}
      free() {}
    },
    execute_workspace: () => ({
      artifact_count: metadata.length,
      manifest_json: () => JSON.stringify(candidate),
      artifact_metadata_json: (index: number) =>
        artifactMetadataJson?.(index, metadata[index]) ??
        JSON.stringify(metadata[index]),
      take_artifact_bytes: (index: number) => {
        const kind = metadata[index].kind;
        const bytes = fullArtifacts.get(kind);
        if (!bytes) throw new Error(`missing fixture bytes for ${kind}`);
        const owned = Uint8Array.from(bytes);
        return mutateArtifactBytes?.(kind, owned) ?? owned;
      },
      free() {},
    }),
    verify_evidence_journal_cbor: () => 1,
  } as unknown as Parameters<typeof setRustRuntimeForTesting>[0];
  setRustRuntimeForTesting(fakeRuntime);
}

async function expectFakeFullFailure(
  options: FakeFullRuntimeOptions,
  expected: RegExp,
): Promise<void> {
  installFakeFullRuntime(options);
  try {
    await expect(
      executeRustRuntime(
        fullSourceFixture(),
        "runtime-contract.csv",
        fullOptions(),
        undefined,
        FULL_RUNTIME,
      ),
    ).rejects.toThrow(expected);
  } finally {
    setRustRuntimeForTesting(runtimeWasm);
  }
}

async function expectFakeStreamFullFailure(
  options: FakeFullRuntimeOptions,
  expected: RegExp,
): Promise<void> {
  const root = new MemoryDirectoryHandle();
  const priorNavigator = globalThis.navigator;
  vi.stubGlobal("navigator", {
    storage: {
      getDirectory: () => Promise.resolve(memoryOpfsRoot(root)),
    },
    locks: {
      request: (
        _name: string,
        _options: LockOptions,
        operation: () => Promise<unknown>,
      ) => operation(),
    },
  });
  installFakeFullRuntime(options);
  try {
    await expect(
      executeRustRuntime(
        fullSourceFixture(),
        "runtime-contract.csv",
        fullOptions(),
        undefined,
        { ...FULL_RUNTIME, persistRustWorkspace: true },
      ),
    ).rejects.toThrow(expected);
  } finally {
    setRustRuntimeForTesting(runtimeWasm);
    vi.stubGlobal("navigator", priorNavigator);
  }
}

const INVALID_CASES: Array<
  [string, (candidate: Record<string, unknown>) => void, RegExp]
> = [
  [
    "protocol drift",
    (candidate) => {
      candidate.protocolVersion = "chronicle-preprocessing-runtime/v2";
    },
    /protocolVersion/,
  ],
  [
    "command substitution",
    (candidate) => {
      candidate.command = "GetView";
    },
    /command/,
  ],
  [
    "empty request identity",
    (candidate) => {
      candidate.requestId = "";
    },
    /requestId.*non-empty string/,
  ],
  [
    "malformed authority digest",
    (candidate) => {
      candidate.productContractDigest = "sha256:not-a-digest";
    },
    /productContractDigest/,
  ],
  [
    "unknown cache mode",
    (candidate) => {
      record(candidate.dependencyCacheDecision).mode = "optimistic_guess";
    },
    /expected certified_narrow or conservative_full/,
  ],
  [
    "non-boolean empirical currency",
    (candidate) => {
      record(candidate.dependencyCacheDecision).empirical_evidence_current =
        "yes";
    },
    /empirical_evidence_current.*boolean/,
  ],
  [
    "false narrow-cache structural claim",
    (candidate) => {
      const decision = record(candidate.dependencyCacheDecision);
      decision.mode = "certified_narrow";
      decision.certificate_digest = candidate.dependencyCertificateDigest;
      decision.binding_surface_digest = null;
    },
    /certified_narrow requires certificate and binding-surface identity/,
  ],
  [
    "certificate identity split",
    (candidate) => {
      record(candidate.dependencyCacheDecision).certificate_digest =
        `sha256:${"f".repeat(64)}`;
    },
    /does not match manifest dependency certificate/,
  ],
  [
    "negative row count",
    (candidate) => {
      record(candidate.counts).original = -1;
    },
    /counts\.original.*non-negative safe integer/,
  ],
  [
    "role assignment is not an object",
    (candidate) => {
      array(candidate.roleAssignments)[0] = "not-an-assignment";
    },
    /roleAssignments\[0\].*object/,
  ],
  [
    "role assignment has a non-string qualifier",
    (candidate) => {
      record(firstRecord(candidate, "roleAssignments").qualifiers).scope = 7;
    },
    /roleAssignments\[0\]\.qualifiers\.scope.*non-empty string/,
  ],
  [
    "role assignment has a fractional revision",
    (candidate) => {
      firstRecord(candidate, "roleAssignments").revision = 1.5;
    },
    /roleAssignments\[0\]\.revision.*non-negative safe integer/,
  ],
  [
    "artifact reference has malformed ancestry",
    (candidate) => {
      record(firstRecord(candidate, "roleAssignments").artifact).derived_from =
        "not-an-array";
    },
    /derived_from.*array/,
  ],
  [
    "artifact reference has a non-string ancestor",
    (candidate) => {
      record(firstRecord(candidate, "roleAssignments").artifact).derived_from =
        [7];
    },
    /derived_from\[0\].*non-empty string/,
  ],
  [
    "unknown node execution status",
    (candidate) => {
      firstRecord(candidate, "nodeExecutions").status = "silently_stale";
    },
    /nodeExecutions\[0\]\.status.*unknown execution status/,
  ],
  [
    "qualification trace has an unknown decision",
    (candidate) => {
      firstRecord(candidate, "qualificationTraces").decision = "maybe";
    },
    /qualificationTraces\[0\]\.decision.*unknown qualification decision/,
  ],
  [
    "qualification rule has a non-boolean result",
    (candidate) => {
      const trace = firstRecord(candidate, "qualificationTraces");
      record(array(trace.rule_evaluations)[0]).passed = "true";
    },
    /rule_evaluations\[0\]\.passed.*boolean/,
  ],
  [
    "requirement trace has an unknown materialization state",
    (candidate) => {
      firstRecord(candidate, "requirementTraces").state = "silently_stale";
    },
    /requirementTraces\[0\]\.state.*unknown materialization state/,
  ],
  [
    "requirement trace has an invalid nullable condition result",
    (candidate) => {
      firstRecord(candidate, "requirementTraces").condition_result = "false";
    },
    /condition_result.*boolean/,
  ],
  [
    "timezone accounting drift",
    (candidate) => {
      const summary = record(candidate.processingSummary);
      summary.rowsRemovedByTimezone = Number(summary.rowsRemovedByTimezone) + 1;
    },
    /row accounting is inconsistent/,
  ],
  [
    "unknown timezone action",
    (candidate) => {
      record(candidate.processingSummary).timezoneAction = "infer-silently";
    },
    /timezoneAction.*unknown timezone action/,
  ],
  [
    "checkpoint substitution",
    (candidate) => {
      const summary = record(candidate.processingSummary);
      const checkpoints = record(summary.logicalStageCheckpoints);
      const nodeId = Object.keys(checkpoints)[0];
      record(checkpoints[nodeId]).terminalDigest = `sha256:${"f".repeat(64)}`;
    },
    /checkpoint identity or terminal digest/,
  ],
  [
    "checkpoint component uses the wrong digest family",
    (candidate) => {
      const checkpoints = record(
        record(candidate.processingSummary).logicalStageCheckpoints,
      );
      const nodeId = Object.keys(checkpoints)[0];
      record(checkpoints[nodeId]).payloadDigest = `sha256:${"a".repeat(64)}`;
    },
    /payloadDigest.*lowercase xxh3-128 digest/,
  ],
  [
    "checkpoint protocol is unsupported",
    (candidate) => {
      const checkpoints = record(
        record(candidate.processingSummary).logicalStageCheckpoints,
      );
      const nodeId = Object.keys(checkpoints)[0];
      record(checkpoints[nodeId]).protocolVersion =
        "chronicle-logical-stage-checkpoint/v99";
    },
    /protocolVersion.*unsupported checkpoint protocol/,
  ],
  [
    "checkpoint stage identity substitution",
    (candidate) => {
      const checkpoints = record(
        record(candidate.processingSummary).logicalStageCheckpoints,
      );
      const nodeId = Object.keys(checkpoints)[0];
      record(checkpoints[nodeId]).nodeId = "different-node";
    },
    /checkpoint identity or terminal digest/,
  ],
  [
    "empty stage checkpoint domain",
    (candidate) => {
      const summary = record(candidate.processingSummary);
      summary.logicalStageDigests = {};
      summary.logicalStageCheckpoints = {};
    },
    /digest and checkpoint domains must contain the same 15 identities/,
  ],
  [
    "stage digest and checkpoint domain mismatch",
    (candidate) => {
      const summary = record(candidate.processingSummary);
      const checkpoints = record(summary.logicalStageCheckpoints);
      delete checkpoints[Object.keys(checkpoints)[0]];
    },
    /digest and checkpoint domains must contain the same 15 identities/,
  ],
  [
    "artifact metadata has a negative row count",
    (candidate) => {
      firstRecord(candidate, "artifacts").rowCount = -1;
    },
    /artifacts\[0\]\.rowCount.*non-negative safe integer/,
  ],
  [
    "artifact preview contains a non-string cell",
    (candidate) => {
      firstRecord(candidate, "artifacts").previewRows = [["valid", 7]];
    },
    /previewRows\[0\]\[1\].*expected a string/,
  ],
  [
    "step execution has an unknown status",
    (candidate) => {
      firstRecord(candidate, "stepExecutions").status = "silently_stale";
    },
    /stepExecutions\[0\]\.status.*unknown execution status/,
  ],
  [
    "step execution domain is incomplete",
    (candidate) => {
      array(candidate.stepExecutions).pop();
    },
    /expected exactly 55 unique Rust step executions/,
  ],
  [
    "step execution output disagrees with its Rust checkpoint",
    (candidate) => {
      firstRecord(candidate, "stepExecutions").output_digest =
        `sha256:${"a".repeat(64)}`;
    },
    /step execution output does not match its Rust checkpoint/,
  ],
  [
    "duplicate artifact identity",
    (candidate) => {
      const artifacts = array(candidate.artifacts);
      artifacts.push(structuredClone(artifacts[0]));
    },
    /duplicate artifact kind/,
  ],
  [
    "duplicate artifact id with distinct kinds",
    (candidate) => {
      const artifacts = array(candidate.artifacts);
      const duplicate = structuredClone(record(artifacts[0]));
      duplicate.kind = "different-kind";
      artifacts.push(duplicate);
    },
    /duplicate artifact id/,
  ],
  [
    "duplicate role assignment",
    (candidate) => {
      const assignments = array(candidate.roleAssignments);
      const duplicate = structuredClone(record(assignments[0]));
      duplicate.assignment_id = "duplicate-role-assignment";
      assignments.push(duplicate);
    },
    /duplicate role/,
  ],
  [
    "duplicate node execution",
    (candidate) => {
      const executions = array(candidate.nodeExecutions);
      const duplicate = structuredClone(record(executions[0]));
      duplicate.capability_id = "duplicate-node-capability";
      executions.push(duplicate);
    },
    /duplicate node/,
  ],
  [
    "missing materialization trace surface",
    (candidate) => {
      delete candidate.requirementTraces;
    },
    /requirementTraces/,
  ],
];

beforeAll(async () => {
  const campaignPackage = process.env.CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR;
  const runtimeBytes = await readFile(
    campaignPackage
      ? path.join(
          campaignPackage,
          "chronicle_preprocessing_runtime_wasm_bg.wasm",
        )
      : new URL(
          "../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
          import.meta.url,
        ),
  );
  runtimeWasm.initSync({ module: runtimeBytes });
  setRustRuntimeForTesting(runtimeWasm);
  const full = await executeRustRuntime(
    fullSourceFixture(),
    "runtime-contract.csv",
    fullOptions(),
    undefined,
    FULL_RUNTIME,
  );
  manifest = full.manifest;
  fullArtifacts = full.artifacts;
  const review = await queryRustReview(
    reviewSourceFixture(),
    "review-contract.csv",
    reviewOptions(),
    undefined,
    REVIEW_RUNTIME,
  );
  reviewManifest = JSON.parse(review.manifestJson) as Record<string, unknown>;
  reviewSummaryBytes = review.reviewSummaryJsonBytes;
  // Move the process-local continuation to a different input so fake full-run
  // checks replay the captured manifest's original null predecessor exactly.
  await executeRustRuntime(
    continuationDisplacementFixture(),
    "continuation-displacement.csv",
    fullOptions(),
    undefined,
    FULL_RUNTIME,
  );
});

describe("Rust/WASM runtime manifest contract firewall", () => {
  it.each([
    [
      "protocol drift",
      (candidate: Record<string, unknown>) => {
        candidate.protocolVersion = "chronicle-preprocessing-runtime/v2";
      },
      /reviewManifest\.protocolVersion.*unsupported protocol version/,
    ],
    [
      "the wrong command",
      (candidate: Record<string, unknown>) => {
        candidate.command = "ExecuteWorkspace";
      },
      /reviewManifest\.command.*expected QueryReview/,
    ],
    [
      "an unknown timezone action",
      (candidate: Record<string, unknown>) => {
        candidate.timezoneAction = "guess";
      },
      /reviewManifest\.timezoneAction.*unknown timezone action/,
    ],
    [
      "an unknown execution status",
      (candidate: Record<string, unknown>) => {
        firstRecord(candidate, "stepExecutions").status = "silently_stale";
      },
      /reviewManifest\.stepExecutions\[0\]\.status.*unknown execution status/,
    ],
    [
      "an incomplete step domain",
      (candidate: Record<string, unknown>) => {
        array(candidate.stepExecutions).pop();
      },
      /expected exactly 55 unique Rust step executions/,
    ],
    [
      "duplicate step identities",
      (candidate: Record<string, unknown>) => {
        const steps = array(candidate.stepExecutions);
        record(steps[1]).step_id = record(steps[0]).step_id;
      },
      /expected exactly 55 unique Rust step executions/,
    ],
    [
      "an unknown cache source",
      (candidate: Record<string, unknown>) => {
        candidate.cacheSources = ["unverified-cache"];
      },
      /reviewManifest\.cacheSources.*unknown or duplicate cache source/,
    ],
    [
      "duplicate cache sources",
      (candidate: Record<string, unknown>) => {
        candidate.cacheSources = ["salsa-memory", "salsa-memory"];
      },
      /reviewManifest\.cacheSources.*unknown or duplicate cache source/,
    ],
  ] as const)(
    "rejects a compact review manifest with %s",
    (_name, mutate, expected) => {
      const candidate = structuredClone(reviewManifest);
      mutate(candidate);
      expect(() => decodeReviewRuntimeManifest(candidate)).toThrow(expected);
    },
  );

  it("maps every valid review execution status to its exact step identity", () => {
    const candidate = structuredClone(reviewManifest);
    const steps = array(candidate.stepExecutions).map(record);
    const statuses = ["recomputed", "cached", "bypassed", "skipped", "error"];
    statuses.forEach((status, index) => {
      steps[index].status = status;
    });

    const decoded = decodeReviewRuntimeManifest(candidate);
    expect(decoded.recomputedStepIds).toContain(steps[0].step_id);
    expect(decoded.cachedStepIds).toContain(steps[1].step_id);
    expect(decoded.bypassedStepIds).toContain(steps[2].step_id);
    expect(decoded.skippedStepIds).toContain(steps[3].step_id);
    expect(decoded.errorStepIds).toEqual([steps[4].step_id]);
  });

  it.each([
    [
      "workspace identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.workspaceId = `sha256:${"1".repeat(64)}`;
        },
      },
      /review manifest workspace identity mismatch/,
    ],
    [
      "input identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.inputDigest = `sha256:${"2".repeat(64)}`;
        },
      },
      /review manifest input identity mismatch/,
    ],
    [
      "previous-root identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.previousWorkspaceRootDigest = `sha256:${"3".repeat(64)}`;
        },
      },
      /review manifest previous-root identity mismatch/,
    ],
    [
      "implementation identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.implementationDigest = `sha256:${"4".repeat(64)}`;
        },
      },
      /review manifest implementation identity mismatch/,
    ],
    [
      "build-environment identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.buildEnvironmentDigest = `sha256:${"5".repeat(64)}`;
        },
      },
      /review manifest build-environment identity mismatch/,
    ],
    [
      "artifact count",
      { artifactCount: 2 },
      /review query must expose exactly one compact artifact/,
    ],
    [
      "artifact kind",
      {
        mutateMetadata: (candidate: Record<string, unknown>): void => {
          candidate.kind = "wrong-kind";
        },
      },
      /review artifact identity mismatch/,
    ],
    [
      "artifact digest identity",
      {
        mutateMetadata: (candidate: Record<string, unknown>): void => {
          candidate.digest = `sha256:${"6".repeat(64)}`;
        },
      },
      /review artifact identity mismatch/,
    ],
    [
      "artifact size",
      {
        mutateMetadata: (candidate: Record<string, unknown>): void => {
          candidate.size = reviewSummaryBytes.byteLength + 1;
        },
      },
      /review artifact integrity mismatch/,
    ],
    [
      "artifact content digest",
      { artifactBytes: new Uint8Array([0]) },
      /review artifact integrity mismatch/,
    ],
  ] as const)(
    "fails closed at the review execution boundary for %s",
    async (_name, options, expected) => {
      await expectFakeReviewFailure(options, expected);
    },
  );

  it("preserves the primary manifest error when both WASM cleanup calls fail", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const { handleFree, supportFree } = installFakeReviewRuntime({
      manifestJson: "not-json",
      handleFreeError: new Error("handle cleanup failed"),
      supportFreeError: new Error("support cleanup failed"),
    });
    try {
      await expect(
        queryRustReview(
          reviewSourceFixture(),
          "review-contract.csv",
          reviewOptions(),
          undefined,
          REVIEW_RUNTIME,
        ),
      ).rejects.toThrow(/runtime manifest is not valid JSON/);
      expect(handleFree).toHaveBeenCalledOnce();
      expect(supportFree).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledTimes(2);
    } finally {
      warning.mockRestore();
      setRustRuntimeForTesting(runtimeWasm);
    }
  });

  it.each([
    [
      "request identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.requestId = "wrong-request";
        },
      },
      /runtime manifest request identity mismatch/,
    ],
    [
      "workspace identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.workspaceId = `sha256:${"7".repeat(64)}`;
        },
      },
      /runtime manifest workspace identity mismatch/,
    ],
    [
      "implementation identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.implementationDigest = `sha256:${"8".repeat(64)}`;
        },
      },
      /runtime manifest implementation identity mismatch/,
    ],
    [
      "build-environment identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.buildEnvironmentDigest = `sha256:${"9".repeat(64)}`;
        },
      },
      /runtime manifest build-environment identity mismatch/,
    ],
    [
      "input digest",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.input.digest = `sha256:${"a".repeat(64)}`;
        },
      },
      /runtime manifest input identity mismatch/,
    ],
    [
      "input size",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.input.size += 1;
        },
      },
      /runtime manifest input identity mismatch/,
    ],
    [
      "previous-root identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.previousWorkspaceRootDigest = `sha256:${"b".repeat(64)}`;
        },
      },
      /runtime manifest previous-root identity mismatch/,
    ],
    [
      "invalid artifact metadata JSON",
      { artifactMetadataJson: () => "not-json" },
      /runtime artifact metadata is not valid JSON at index 0/,
    ],
    [
      "duplicate artifact kinds",
      {
        artifactMetadataJson: (
          index: number,
          metadata: RuntimeManifest["artifacts"][number],
        ): string =>
          JSON.stringify(index === 1 ? manifest.artifacts[0] : metadata),
      },
      /duplicate runtime artifact kind/,
    ],
    [
      "artifact byte size",
      {
        mutateArtifactBytes: (_kind: string, bytes: Uint8Array): Uint8Array =>
          bytes.subarray(0, Math.max(0, bytes.byteLength - 1)),
      },
      /runtime artifact integrity mismatch/,
    ],
    [
      "artifact content digest",
      {
        mutateArtifactBytes: (_kind: string, bytes: Uint8Array): Uint8Array => {
          if (bytes.byteLength > 0) bytes[0] ^= 1;
          return bytes;
        },
      },
      /runtime artifact integrity mismatch/,
    ],
    [
      "unknown ingress role",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          const assignment = candidate.roleAssignments.find(
            ({ role_id }) => role_id !== "processing_options",
          );
          if (!assignment) throw new Error("fixture has no ingress assignment");
          assignment.role_id = "unknown_ingress";
        },
      },
      /runtime declared an unknown ingress role/,
    ],
    [
      "ingress byte size",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          const assignment = candidate.roleAssignments.find(
            ({ role_id }) => role_id !== "processing_options",
          );
          if (!assignment) throw new Error("fixture has no ingress assignment");
          assignment.artifact.size += 1;
        },
      },
      /runtime ingress assignment size mismatch/,
    ],
    [
      "missing workspace root artifact",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.artifacts = candidate.artifacts.filter(
            ({ kind }) => kind !== "workspace-root-json",
          );
        },
      },
      /runtime artifact set is missing its workspace root/,
    ],
    [
      "missing referenced closure artifact",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.artifacts = candidate.artifacts.filter(
            ({ kind }) => kind !== "source-coordinate-index-arrow",
          );
        },
      },
      /runtime artifact set is missing sha256:/,
    ],
  ] as Array<[string, FakeFullRuntimeOptions, RegExp]>)(
    "fails closed at the full execution boundary for %s",
    async (_name, options, expected) => {
      await expectFakeFullFailure(options, expected);
    },
  );

  it.each([
    [
      "artifact integrity",
      {
        mutateArtifactBytes: (_kind: string, bytes: Uint8Array): Uint8Array =>
          bytes.subarray(0, Math.max(0, bytes.byteLength - 1)),
      },
      /artifact size mismatch/,
    ],
    [
      "artifact digest integrity",
      {
        mutateArtifactBytes: (_kind: string, bytes: Uint8Array): Uint8Array => {
          const changed = Uint8Array.from(bytes);
          if (changed.byteLength > 0) changed[0] ^= 1;
          return changed;
        },
      },
      /OPFS verification failed/,
    ],
    [
      "unknown ingress role",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          const assignment = candidate.roleAssignments.find(
            ({ role_id }) => role_id !== "processing_options",
          );
          if (!assignment) throw new Error("fixture has no ingress assignment");
          assignment.role_id = "unknown_ingress";
        },
      },
      /runtime declared an unknown ingress role/,
    ],
    [
      "ingress integrity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          const assignment = candidate.roleAssignments.find(
            ({ role_id }) => role_id !== "processing_options",
          );
          if (!assignment) throw new Error("fixture has no ingress assignment");
          assignment.artifact.size += 1;
        },
      },
      /runtime ingress assignment integrity mismatch/,
    ],
  ] as Array<[string, FakeFullRuntimeOptions, RegExp]>)(
    "fails closed while streaming to OPFS for %s",
    async (_name, options, expected) => {
      await expectFakeStreamFullFailure(options, expected);
    },
  );

  it("rejects unknown persisted-base selections, frees the prepared handle, and treats none as a clean miss", async () => {
    const root = new MemoryDirectoryHandle();
    const priorNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve(memoryOpfsRoot(root)),
      },
      locks: {
        request: (
          _name: string,
          _options: LockOptions,
          operation: () => Promise<unknown>,
        ) => operation(),
      },
    });
    const raw = fullSourceFixture();
    const runtime = { ...FULL_RUNTIME, persistRustWorkspace: true };
    try {
      const persisted = await executeRustRuntime(
        raw,
        "runtime-contract.csv",
        fullOptions(),
        undefined,
        runtime,
      );
      const inputDigest = persisted.manifest.input.digest.replace(
        /^sha256:/,
        "",
      );
      const realReview = await queryPersistedRustReview(
        raw.byteLength,
        "runtime-contract.csv",
        fullOptions(),
        undefined,
        runtime,
        inputDigest,
      );
      if (!realReview) throw new Error("fixture review unexpectedly missed");
      const installPreparedRuntime = (required: string) => {
        const preparedFree = vi.fn();
        const fakeRuntime = {
          implementation_build_digest: () => manifest.implementationDigest,
          build_environment_digest: () => manifest.buildEnvironmentDigest,
          review_base_probe_spec_json: () =>
            runtimeWasm.review_base_probe_spec_json(),
          RuntimeSupportFiles: class {
            put() {}
            put_with_name() {}
            free() {}
          },
          prepare_persisted_workspace_review: () => ({
            required_base_kind: () => required,
            execute_selected_base: () => {
              throw new Error("test must not execute a base");
            },
            free: preparedFree,
          }),
        } as unknown as Parameters<typeof setRustRuntimeForTesting>[0];
        setRustRuntimeForTesting(fakeRuntime);
        return preparedFree;
      };

      const unknownFree = installPreparedRuntime("mystery-base");
      await expect(
        queryPersistedRustReview(
          raw.byteLength,
          "runtime-contract.csv",
          fullOptions(),
          undefined,
          runtime,
          inputDigest,
        ),
      ).rejects.toThrow(/Rust selected an unknown review base: mystery-base/);
      expect(unknownFree).toHaveBeenCalledOnce();

      const noneFree = installPreparedRuntime("none");
      await expect(
        queryPersistedRustReview(
          raw.byteLength,
          "runtime-contract.csv",
          fullOptions(),
          undefined,
          runtime,
          inputDigest,
        ),
      ).resolves.toBeNull();
      expect(noneFree).toHaveBeenCalledOnce();

      const supportConstructed = vi.fn();
      const supportPut = vi.fn();
      const supportFreed = vi.fn();
      const warmPreparedFreed = vi.fn();
      const warmHandleFreed = vi.fn();
      const selectedBaseSizes: number[] = [];
      setRustRuntimeForTesting({
        implementation_build_digest: () => manifest.implementationDigest,
        build_environment_digest: () => manifest.buildEnvironmentDigest,
        review_base_probe_spec_json: () =>
          runtimeWasm.review_base_probe_spec_json(),
        RuntimeSupportFiles: class {
          constructor() {
            supportConstructed();
          }
          put() {}
          put_with_name() {
            supportPut();
          }
          free() {
            supportFreed();
          }
        },
        prepare_persisted_workspace_review: () => ({
          required_base_kind: () => "salsa-memory",
          execute_selected_base: (bytes: Uint8Array) => {
            selectedBaseSizes.push(bytes.byteLength);
            return {
              artifact_count: 1,
              manifest_json: () => realReview.manifestJson,
              artifact_metadata_json: () =>
                JSON.stringify({
                  artifactId: "artifact:review-summary-json",
                  kind: "review-summary-json",
                  mediaType: "application/json",
                  digest: realReview.reviewSummaryDigest,
                  size: realReview.reviewSummaryJsonBytes.byteLength,
                  derivedFrom: [],
                }),
              take_artifact_bytes: () =>
                Uint8Array.from(realReview.reviewSummaryJsonBytes),
              free: warmHandleFreed,
            };
          },
          free: warmPreparedFreed,
        }),
      } as unknown as Parameters<typeof setRustRuntimeForTesting>[0]);
      const supportBundle = {
        surveyAttributionFile: {
          name: "survey.csv",
          bytes: new TextEncoder().encode("participant_id,survey_id\nP01,S01")
            .buffer,
        },
      };
      const verifiedSupportKey = `sha256:${"a".repeat(64)}`;
      for (let index = 0; index < 2; index += 1) {
        await expect(
          queryPersistedRustReview(
            raw.byteLength,
            "runtime-contract.csv",
            fullOptions(),
            supportBundle,
            runtime,
            inputDigest,
            verifiedSupportKey,
          ),
        ).resolves.not.toBeNull();
      }
      expect(selectedBaseSizes).toEqual([0, 0]);
      expect(supportConstructed).toHaveBeenCalledOnce();
      expect(supportPut).toHaveBeenCalledOnce();
      expect(warmPreparedFreed).toHaveBeenCalledTimes(2);
      expect(warmHandleFreed).toHaveBeenCalledTimes(2);
      expect(supportFreed).not.toHaveBeenCalled();

      const fallbackPreparedFree = vi.fn();
      const fallbackHandleFree = vi.fn();
      const fallbackRuntime = {
        implementation_build_digest: () => manifest.implementationDigest,
        build_environment_digest: () => manifest.buildEnvironmentDigest,
        review_base_probe_spec_json: () =>
          runtimeWasm.review_base_probe_spec_json(),
        RuntimeSupportFiles: class {
          put() {}
          put_with_name() {}
          free() {}
        },
        prepare_persisted_workspace_review: () => ({
          required_base_kind: () => "none",
          execute_selected_base: () => {
            throw new Error("test must fall back to raw bytes");
          },
          free: fallbackPreparedFree,
        }),
        execute_workspace: () => ({
          artifact_count: 1,
          manifest_json: () => realReview.manifestJson,
          artifact_metadata_json: () =>
            JSON.stringify({
              artifactId: "artifact:review-summary-json",
              kind: "review-summary-json",
              mediaType: "application/json",
              digest: realReview.reviewSummaryDigest,
              size: realReview.reviewSummaryJsonBytes.byteLength,
              derivedFrom: [],
            }),
          take_artifact_bytes: () => realReview.reviewSummaryJsonBytes,
          free: fallbackHandleFree,
        }),
      } as unknown as Parameters<typeof setRustRuntimeForTesting>[0];
      setRustRuntimeForTesting(fallbackRuntime);
      expect(supportFreed).toHaveBeenCalledOnce();
      const trace = vi
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      const fallback = await queryRustReview(
        raw,
        "runtime-contract.csv",
        fullOptions(),
        undefined,
        { ...runtime, performanceTraceId: "review-fallback-contract" },
        inputDigest,
      );
      trace.mockRestore();
      expect(fallback.reviewSummaryJsonBytes).toEqual(
        realReview.reviewSummaryJsonBytes,
      );
      expect(fallbackPreparedFree).toHaveBeenCalledOnce();
      expect(fallbackHandleFree).toHaveBeenCalledOnce();
    } finally {
      setRustRuntimeForTesting(runtimeWasm);
      vi.stubGlobal("navigator", priorNavigator);
    }
  });

  it("accepts the exact compiled runtime manifest and artifact catalog", () => {
    expect(decodeRuntimeManifest(cloneManifest())).toEqual(manifest);
    expect(manifest.dependencyCacheDecision).toMatchObject({
      mode: "certified_narrow",
      empirical_evidence_current: true,
    });
    expect(() =>
      verifyRuntimeArtifactCatalog(
        manifest,
        structuredClone(manifest.artifacts),
      ),
    ).not.toThrow();
  });

  it("keeps all 55 query results warm when OPFS persistence is disabled", async () => {
    const raw = new TextEncoder().encode(
      [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Example,Unknown importance: 1,example.app,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Example,Unknown importance: 2,example.app,2026-03-07 10:01:00,America/Chicago",
      ].join("\n"),
    );
    const options = {
      ...DEFAULT_BROWSER_OPTIONS,
      studyName: "Ephemeral continuation proof",
      selectedTimezone: "America/Chicago",
      timezoneHandling: "selected-convert" as const,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
      processScreenUsage: false,
      enablePlotting: false,
    };
    const runtime = {
      datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
      persistRustWorkspace: false,
    };
    const first = await executeRustRuntime(
      raw,
      "ephemeral-continuation.csv",
      options,
      undefined,
      runtime,
    );
    const second = await executeRustRuntime(
      raw,
      "ephemeral-continuation.csv",
      options,
      undefined,
      runtime,
    );
    expect(second.manifest.previousWorkspaceRootDigest).toBe(
      first.manifest.workspaceRootDigest,
    );
    expect(
      second.manifest.stepExecutions.filter(
        ({ status }) => status === "recomputed" || status === "error",
      ),
    ).toEqual([]);
    const runSpecificArtifacts = new Set([
      "execution-ledger-json",
      "semantic-index-source-json",
      "correspondence-index-json",
      "evidence-journal",
      "execution-state-json",
      "stage-view-json",
      "artifact-view-json",
      "obligation-view-json",
      "explanation-view-json",
      "artifact-closure-json",
      "workspace-root-json",
    ]);
    const stableKinds = [...first.artifacts.keys()]
      .filter((kind) => !runSpecificArtifacts.has(kind))
      .sort();
    expect(
      [...second.artifacts.keys()]
        .filter((kind) => !runSpecificArtifacts.has(kind))
        .sort(),
    ).toEqual(stableKinds);
    for (const kind of stableKinds) {
      expect(second.artifacts.get(kind), kind).toEqual(
        first.artifacts.get(kind),
      );
    }
  });

  it("streams a complete Rust run into OPFS and resumes review from its verified bases", async () => {
    const root = new MemoryDirectoryHandle();
    const priorNavigator = globalThis.navigator;
    const lockRequest = vi.fn(
      async (
        _name: string,
        _options: LockOptions,
        operation: () => Promise<unknown>,
      ) => operation(),
    );
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve(memoryOpfsRoot(root)),
      },
      locks: { request: lockRequest },
    });
    try {
      const raw = new TextEncoder().encode(
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,Target Child,Example,Activity Resumed,example.app,2026-03-07 10:00:00,America/Chicago",
          "Study,P01,Target Child,Example,Activity Paused,example.app,2026-03-07 10:01:00,America/Chicago",
        ].join("\n"),
      );
      const options = {
        ...DEFAULT_BROWSER_OPTIONS,
        studyName: "Persisted runtime proof",
        selectedTimezone: "America/Chicago",
        timezoneHandling: "selected-convert" as const,
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useBackgroundAppsFile: false,
        useAppCodebook: false,
        processScreenUsage: false,
        enablePlotting: false,
      };
      const runtime = {
        datetimeOfPreprocessing: "2026-07-25 00:00:00 UTC",
        persistRustWorkspace: true,
      };

      const first = await executeRustRuntime(
        raw,
        "persisted-runtime-proof.csv",
        options,
        undefined,
        runtime,
      );
      expect(first.persistedWorkspace?.workspaceRootDigest).toBe(
        first.manifest.workspaceRootDigest,
      );
      expect([...first.artifacts.keys()].sort()).toEqual([
        "execution-ledger-json",
        "stage-view-json",
      ]);

      const review = await queryPersistedRustReview(
        raw.byteLength,
        "persisted-runtime-proof.csv",
        { ...options, minimumUsageDuration: 0.25 },
        undefined,
        runtime,
        first.manifest.input.digest.replace(/^sha256:/, ""),
      );
      expect(review).not.toBeNull();
      if (!review) throw new Error("persisted review unexpectedly missed");
      expect(review.previousWorkspaceRootDigest).toBe(
        first.manifest.workspaceRootDigest,
      );
      expect(review.suppliedReviewBaseBytes).toBeGreaterThan(0);
      expect(review.suppliedReconstructionBaseBytes).toBeGreaterThan(0);
      expect(review.cacheSources).toEqual(["salsa-memory"]);
      const timezoneReview = await queryPersistedRustReview(
        raw.byteLength,
        "persisted-runtime-proof.csv",
        { ...options, timezoneHandling: "primary-convert" },
        undefined,
        runtime,
        first.manifest.input.digest.replace(/^sha256:/, ""),
      );
      expect(timezoneReview).not.toBeNull();
      expect(timezoneReview?.cacheSources).toEqual(["salsa-memory"]);
      expect(timezoneReview?.recomputedStepIds).toEqual([
        "select_timezone_strategy",
        "restamp_rows",
        "row_count_report",
        "relabel_usage_with_floor",
        "junk_downstream_mark",
        "sort_episodes",
        "assemble_result",
      ]);
      expect(lockRequest).toHaveBeenCalledTimes(3);
      expect(lockRequest.mock.calls.map(([, options]) => options.mode)).toEqual(
        ["exclusive", "shared", "shared"],
      );
    } finally {
      vi.stubGlobal("navigator", priorNavigator);
    }
  });

  it("returns byte-identical review metrics without materializing full exports", async () => {
    const raw = representativeSourceFixture();
    const options = {
      ...DEFAULT_BROWSER_OPTIONS,
      studyName: "Selective review proof",
      selectedTimezone: "America/Chicago",
      timezoneHandling: "selected-convert" as const,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
      processScreenUsage: false,
      enablePlotting: false,
    };
    const runtime = {
      datetimeOfPreprocessing: "2026-07-25 00:00:00 UTC",
      persistRustWorkspace: false,
    };
    const full = await executeRustRuntime(
      raw,
      "selective-review-proof.csv",
      options,
      undefined,
      runtime,
    );
    const review = await queryRustReview(
      raw,
      "selective-review-proof.csv",
      options,
      undefined,
      runtime,
    );
    expect(review.reviewSummaryJsonBytes).toEqual(
      full.artifacts.get("review-summary-json"),
    );
    expect(review.cachedStepIds).toHaveLength(35);
    expect(review.recomputedStepIds).toEqual([
      "resolve_participant_windows",
      "filter_rows_to_window",
      "resolve_sharing_status",
      "attribute_rows",
      "inject_placeholders",
      "assemble_result",
    ]);
    expect(review.bypassedStepIds).toHaveLength(13);
    expect(review.skippedStepIds).toEqual(["build_raw_date_index"]);
    expect(review.errorStepIds).toEqual([]);
    expect(review.comparisonDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("forces conservative recomputation when empirical release evidence is stale", () => {
    const stale = cloneManifest();
    stale.dependencyCacheDecision.mode = "conservative_full";
    stale.dependencyCacheDecision.empirical_evidence_current = false;
    expect(decodeRuntimeManifest(stale).dependencyCacheDecision).toMatchObject({
      mode: "conservative_full",
      empirical_evidence_current: false,
    });
  });

  it("accepts explicit open obligations and non-null prior-root identity", () => {
    const candidate = cloneManifest();
    candidate.previousWorkspaceRootDigest = `sha256:${"a".repeat(64)}`;
    candidate.openObligations = [
      {
        obligation_id: "obligation:filter-file",
        role_id: "role:filter-file",
        node_id: "filter-rows",
        state: "open",
        reason_id: "reason:missing-filter-file",
      },
      {
        obligation_id: "obligation:workspace",
        role_id: "role:workspace",
        node_id: null,
        state: "blocked",
        reason_id: "reason:workspace-blocked",
      },
    ];

    expect(decodeRuntimeManifest(candidate)).toMatchObject({
      previousWorkspaceRootDigest: `sha256:${"a".repeat(64)}`,
      openObligations: [
        {
          obligation_id: "obligation:filter-file",
          state: "open",
        },
        {
          node_id: null,
          state: "blocked",
        },
      ],
    });
  });

  it("accepts an explicit no-output node execution without inventing an artifact", () => {
    const candidate = cloneManifest();
    candidate.nodeExecutions[0].output = null;

    expect(
      decodeRuntimeManifest(candidate).nodeExecutions[0].output,
    ).toBeNull();
  });

  it("rejects an ineligible selected-timezone request before entering WASM", async () => {
    await expect(
      executeRustRuntime(
        new TextEncoder().encode("header\n"),
        "missing-timezone.csv",
        {
          ...DEFAULT_BROWSER_OPTIONS,
          timezoneHandling: "selected-filter",
          selectedTimezone: "",
        },
        undefined,
        {
          datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
          persistRustWorkspace: false,
        },
      ),
    ).rejects.toThrow(/Rust runtime is ineligible.*selectedTimezone/);
  });

  it("rejects durable mutation when Web Locks are unavailable", async () => {
    await expect(
      executeRustRuntime(
        new TextEncoder().encode("header\n"),
        "no-web-locks.csv",
        {
          ...DEFAULT_BROWSER_OPTIONS,
          timezoneHandling: "primary-convert",
        },
        undefined,
        {
          datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
          persistRustWorkspace: true,
        },
      ),
    ).rejects.toThrow(/Durable processing requires the browser Web Locks API/);
  });

  it("bounds the exact source-coordinate sidecar on a 600-event fixture", async () => {
    const raw = representativeSourceFixture();
    const execution = await executeRustRuntime(
      raw,
      "source-coordinate-budget.csv",
      {
        ...DEFAULT_BROWSER_OPTIONS,
        studyName: "Source Coordinate Budget",
        selectedTimezone: "America/Chicago",
        timezoneHandling: "selected-convert",
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useBackgroundAppsFile: false,
        useAppCodebook: false,
        processScreenUsage: false,
        enablePlotting: false,
      },
      undefined,
      {
        datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
        persistRustWorkspace: false,
      },
    );
    const metadata = execution.manifest.artifacts.find(
      ({ kind }) => kind === "source-coordinate-index-arrow",
    );
    const bytes = execution.artifacts.get("source-coordinate-index-arrow");
    expect(metadata).toBeDefined();
    expect(bytes).toBeDefined();
    expect(metadata?.rowCount).toBeGreaterThanOrEqual(4_800);
    expect(metadata?.size).toBe(bytes?.byteLength);
    expect(metadata?.size).toBeLessThanOrEqual(raw.byteLength * 3 + 65_536);
  });

  it.each(INVALID_CASES)("rejects %s", (_name, mutate, expected) => {
    const candidate = cloneManifest() as unknown as Record<string, unknown>;
    mutate(candidate);
    expect(() => decodeRuntimeManifest(candidate)).toThrow(expected);
  });

  it("rejects disagreement between manifest metadata and exposed WASM bytes", () => {
    const exposed = structuredClone(manifest.artifacts);
    exposed[0].size += 1;
    expect(() => verifyRuntimeArtifactCatalog(manifest, exposed)).toThrow(
      /artifact catalog mismatch/,
    );

    expect(() =>
      verifyRuntimeArtifactCatalog(manifest, [
        ...structuredClone(manifest.artifacts),
        structuredClone(manifest.artifacts[0]),
      ]),
    ).toThrow(/artifact catalog length mismatch/);

    const missingEvidence = cloneManifest();
    missingEvidence.journalDigest = `sha256:${"f".repeat(64)}`;
    expect(() =>
      verifyRuntimeArtifactCatalog(missingEvidence, manifest.artifacts),
    ).toThrow(/omits evidence or dependency certificate/);
  });
});
