import * as Comlink from "comlink";
import {
  openPayloadSpill,
  payloadSpillDelta,
  PAYLOAD_BUDGET_BYTES,
  type PayloadSpill,
} from "./payloadSpill";
import { MAX_PAYLOAD_BUDGET_BYTES } from "@/lib/concurrency";
import { WORKER_BACKGROUND_FAILURE_MESSAGE } from "@/lib/workerBackgroundFailure";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  discoverRustTimezones,
  beginRustRawInspectionBatch,
  disposeRustRawInspectionBatch,
  executeLiteratureComponentRuntime,
  deletePersistedRustWorkspace,
  exportPersistedRustWorkspace,
  garbageCollectPersistedRustWorkspace,
  importPersistedRustWorkspace,
  importPersistedRustWorkspaceArchive,
  initializeRustRuntime,
  installRustPayloadSpill,
  verifyPersistedRustWorkspace,
  getRustRuntimeVersion,
  getRustWorkflowExplorerView,
  inspectRustRawFile,
  splitRustRawFileByStudy,
  registerRustRawParticipantPartitionArtifact,
  readPersistedRustWorkspaceHead,
  readVerifiedSemanticIndexSnapshot,
  rustWasmMemoryBytes,
  setComparisonCacheCapacity,
  getComparisonCacheRetained,
} from "@/lib/rustPipelineRuntime";
import type { LiteratureComponentRuntimeExecution } from "@/lib/rustPipelineRuntime";
import type { RegisteredLiteratureComponentExecution } from "@/lib/literatureInputAdapters";
import type { RawFileInspection } from "@/lib/fileInspection";
import type { ParticipantPartitionTransport } from "@/lib/fileInspection";
import {
  probeOpfsCapability,
  type OpfsCapability,
} from "@/lib/opfsArtifactStore";
import {
  processPersistedReviewWithRustAuthority,
  processRawCsvReviewWithRustAuthority,
  processRawCsvWithRustAuthority,
} from "@/lib/rustPipelineAuthority";
import { queryRegisteredSemanticIndex } from "@/lib/semanticIndex";
import { rebuildSemanticIndexDisposable } from "@/lib/disposableSemanticRebuild";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
  ProcessedFileResult,
  ProgressEvent,
  WorkflowExplorerSupportRole,
} from "@/lib/types";
import { comparisonSupportCacheKey } from "@/lib/comparisonSupportKey";
import { requiresLiveScientificPreflight } from "@/lib/inputCapabilityEvidence";
import {
  beginParticipantInspectionBatchZeroing,
  withRuntimeExecutionLane,
  withParticipantPartitionLane,
} from "@/lib/participantPartitionLane";
import { throwSerializableScientificPreflightRefusal } from "@/lib/scientificPreflightTransport";

/**
 * SHA-256 of the raw input, returned as a lowercase hex string. Runs in the
 * worker so hashing large batches stays off the main thread. Used for the
 * run-manifest provenance sidecar.
 */
async function computeSha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const sessionDatetimes = new Map<
  string,
  { inputSha256: string; datetime: string }
>();
const MAX_SESSION_DATETIMES = 32;
const MAX_SEMANTIC_INDEXES = 8;
type SemanticIndexCacheEntry = {
  workspaceRootDigest: string;
  revision: number;
  index: Uint8Array;
};
const semanticIndexes = new Map<string, SemanticIndexCacheEntry>();
const comparisonSupportFiles = new Map<string, BrowserSupportFiles>();
const MAX_COMPARISON_SUPPORT_BUNDLES = 2;

function cachedComparisonSupportFiles(key: string): BrowserSupportFiles {
  const cached = comparisonSupportFiles.get(key);
  if (!cached) {
    throw new Error("comparison support bundle is not cached on this worker");
  }
  comparisonSupportFiles.delete(key);
  comparisonSupportFiles.set(key, cached);
  return cached;
}

function transferReviewResult<Result extends ProcessedFileResult | null>(
  result: Result,
): Result {
  if (result) result.workerWasmMemoryBytes = rustWasmMemoryBytes() ?? undefined;
  const reviewBytes = result?.reviewSummaryJsonBytes;
  return reviewBytes
    ? Comlink.transfer(result, [reviewBytes.buffer as ArrayBuffer])
    : result;
}

function invalidateSemanticIndex(workspaceId: string): void {
  semanticIndexes.delete(workspaceId);
}

function cacheSemanticIndex(
  workspaceId: string,
  entry: SemanticIndexCacheEntry,
): SemanticIndexCacheEntry {
  semanticIndexes.delete(workspaceId);
  semanticIndexes.set(workspaceId, entry);
  while (semanticIndexes.size > MAX_SEMANTIC_INDEXES) {
    const oldest = semanticIndexes.keys().next().value;
    if (oldest === undefined) break;
    semanticIndexes.delete(oldest);
  }
  return entry;
}

async function rebuildVerifiedSemanticSnapshot(
  snapshot: Awaited<ReturnType<typeof readVerifiedSemanticIndexSnapshot>>,
): Promise<Uint8Array> {
  // The long-lived workspace worker never loads raw-equivalent substrates into
  // its semantic WASM heap. A disposable child worker validates/rebuilds and
  // returns only the PHI-safe N-Quads index, then its entire realm is destroyed.
  return rebuildSemanticIndexDisposable(
    snapshot.source,
    snapshot.scientificArtifactBundle,
  );
}

async function getSemanticIndex(
  workspaceId: string,
): Promise<SemanticIndexCacheEntry> {
  const cached = semanticIndexes.get(workspaceId);
  if (
    cached &&
    cached.workspaceRootDigest ===
      (await readPersistedRustWorkspaceHead(workspaceId))
  ) {
    semanticIndexes.delete(workspaceId);
    semanticIndexes.set(workspaceId, cached);
    return cached;
  }
  const snapshot = await readVerifiedSemanticIndexSnapshot(workspaceId);
  return cacheSemanticIndex(workspaceId, {
    workspaceRootDigest: snapshot.workspaceRootDigest,
    revision: snapshot.revision,
    index: await rebuildVerifiedSemanticSnapshot(snapshot),
  });
}

function resolveSessionDatetime(fileName: string, inputSha256: string): string {
  const existing = sessionDatetimes.get(fileName);
  if (existing?.inputSha256 === inputSha256) {
    sessionDatetimes.delete(fileName);
    sessionDatetimes.set(fileName, existing);
    return existing.datetime;
  }
  const datetime = `${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`;
  if (
    !sessionDatetimes.has(fileName) &&
    sessionDatetimes.size >= MAX_SESSION_DATETIMES
  ) {
    const oldest = sessionDatetimes.keys().next().value;
    if (oldest !== undefined) sessionDatetimes.delete(oldest);
  }
  sessionDatetimes.delete(fileName);
  sessionDatetimes.set(fileName, { inputSha256, datetime });
  return datetime;
}

function effectiveRuntime(
  runtime: BrowserProcessingRuntime | undefined,
  fileName: string,
  inputSha256: string,
): BrowserProcessingRuntime {
  return {
    ...runtime,
    executionAuthority: runtime?.executionAuthority ?? "rust",
    datetimeOfPreprocessing:
      runtime?.datetimeOfPreprocessing ??
      resolveSessionDatetime(fileName, inputSha256),
  };
}

let payloadSpill: PayloadSpill | null = null;

const api = {
  async initializeRuntime(
    compiledModule: WebAssembly.Module,
    payloadBudgetBytes = PAYLOAD_BUDGET_BYTES,
  ): Promise<void> {
    await initializeRustRuntime(compiledModule);
    // Spill budgeted row tables to OPFS so a large export is bounded by the
    // budget, not by the 4 GB WASM address space. Without sync access
    // handles the runtime keeps everything resident, as before.
    payloadSpill = await openPayloadSpill((message) => {
      // Off the result path: the page shows it in its storage notices.
      postMessage({
        type: WORKER_BACKGROUND_FAILURE_MESSAGE,
        operation: "spill-sweep",
        message,
      });
    });
    if (payloadSpill) {
      if (!Number.isSafeInteger(payloadBudgetBytes) || payloadBudgetBytes < PAYLOAD_BUDGET_BYTES
          || payloadBudgetBytes > MAX_PAYLOAD_BUDGET_BYTES) {
        throw new Error("Invalid worker payload budget");
      }
      await installRustPayloadSpill(payloadSpill.bridge, payloadBudgetBytes);
    }
  },
  workflowExplorerView(
    options: BrowserProcessingOptions,
    supportRoles: WorkflowExplorerSupportRole[] = [],
  ) {
    return getRustWorkflowExplorerView(options, supportRoles);
  },
  /**
   * Probe durable storage from the thread that actually persists it. Every
   * workspace write in production happens here (this worker calls into
   * rustPipelineRuntime.ts), so a main-thread-only probe can pass while the
   * worker context is the one that has no OPFS.
   */
  probeWorkspaceCapability(): Promise<OpfsCapability> {
    return probeOpfsCapability();
  },
  async verifyWorkspace(workspaceId: string) {
    return (await verifyPersistedRustWorkspace(workspaceId)) ?? null;
  },
  // The archive crosses the worker boundary as a Blob, not a buffer: a
  // structured-cloned Blob is a reference to browser-held (disk-backed)
  // storage, so neither side ever materializes the whole closure to hand it
  // over, and no transfer list is needed.
  async exportWorkspaceClosure(workspaceId: string, expectedWorkspaceRootDigest?: string): Promise<Blob> {
    return exportPersistedRustWorkspace(workspaceId, expectedWorkspaceRootDigest);
  },
  async importWorkspaceClosure(workspaceId: string, archive: Blob) {
    const result = await importPersistedRustWorkspace(workspaceId, archive);
    invalidateSemanticIndex(workspaceId);
    return result;
  },
  async importWorkspaceClosureArchive(archive: Blob) {
    const result = await importPersistedRustWorkspaceArchive(archive);
    invalidateSemanticIndex(result.workspaceId);
    return result;
  },
  async garbageCollectWorkspace(
    workspaceId: string,
  ): Promise<{ removedObjects: number }> {
    const removedObjects =
      await garbageCollectPersistedRustWorkspace(workspaceId);
    invalidateSemanticIndex(workspaceId);
    return { removedObjects };
  },
  /** Remove the workspace's persisted history and every cache derived from it. */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    await deletePersistedRustWorkspace(workspaceId);
    invalidateSemanticIndex(workspaceId);
  },
  async rebuildIndex(workspaceId: string): Promise<Uint8Array> {
    const snapshot = await readVerifiedSemanticIndexSnapshot(workspaceId);
    const entry = cacheSemanticIndex(workspaceId, {
      workspaceRootDigest: snapshot.workspaceRootDigest,
      revision: snapshot.revision,
      index: await rebuildVerifiedSemanticSnapshot(snapshot),
    });
    return entry.index;
  },
  async queryRegistered(workspaceId: string, queryId: string) {
    const entry = await getSemanticIndex(workspaceId);
    const result = await queryRegisteredSemanticIndex(entry.index, queryId, {
      workspaceRootDigest: entry.workspaceRootDigest,
      revision: entry.revision,
    });
    // Typed scientific views are already exact schema envelopes whose root is
    // supplied by the verified workspace slot. Never spread transport fields
    // onto them: their schema deliberately rejects extra top-level keys.
    if ("view_id" in result) return result;
    return { ...result, workspaceRootDigest: entry.workspaceRootDigest };
  },
  async runtimeVersion(): Promise<string> {
    return getRustRuntimeVersion();
  },
  async setComparisonCacheCapacity(capacity: number): Promise<void> {
    return setComparisonCacheCapacity(capacity);
  },
  async getComparisonCacheRetained(): Promise<number> {
    return getComparisonCacheRetained();
  },
  hasComparisonSupportFiles(key: string): boolean {
    return comparisonSupportFiles.has(key);
  },
  async cacheComparisonSupportFiles(
    key: string,
    supportFiles: BrowserSupportFiles,
  ): Promise<void> {
    if (!/^sha256:[0-9a-f]{64}$/.test(key)) {
      throw new Error("comparison support cache key is invalid");
    }
    if ((await comparisonSupportCacheKey(supportFiles)) !== key) {
      throw new Error("comparison support cache key does not match its bytes");
    }
    comparisonSupportFiles.delete(key);
    comparisonSupportFiles.set(key, supportFiles);
    while (comparisonSupportFiles.size > MAX_COMPARISON_SUPPORT_BUNDLES) {
      const oldest = comparisonSupportFiles.keys().next().value;
      if (oldest === undefined) break;
      comparisonSupportFiles.delete(oldest);
    }
  },
  discoverTimezonesBytes(csvBytes: ArrayBuffer): Promise<string[]> {
    return discoverRustTimezones(new Uint8Array(csvBytes));
  },
  async splitRawCsvByStudy(
    csvBytes: ArrayBuffer,
  ): Promise<Array<{ studyId: string; bytes: ArrayBuffer }>> {
    const parts = (await splitRustRawFileByStudy(new Uint8Array(csvBytes))).map(
      ({ studyId, bytes }) => ({ studyId, bytes: bytes.slice().buffer }),
    );
    return Comlink.transfer(
      parts,
      parts.map((part) => part.bytes),
    );
  },
  async beginRawInspectionBatch(secretBytes: ArrayBuffer): Promise<string> {
    return beginParticipantInspectionBatchZeroing(
      secretBytes,
      beginRustRawInspectionBatch,
    );
  },
  disposeRawInspectionBatch(batchId: string): Promise<boolean> {
    return disposeRustRawInspectionBatch(batchId);
  },
  async inspectRawCsvBytes(
    fileName: string,
    sizeBytes: number,
    csvBytes: ArrayBuffer,
    verifiedInputSha256?: string,
    participantPartitionBatchId?: string,
  ): Promise<RawFileInspection> {
    // Inspection already owns the immutable File bytes. Hash them here once so
    // the full batch can reuse exact duplicate content and avoid hashing again.
    const digest = verifiedInputSha256 ?? (await computeSha256Hex(csvBytes));
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(
        "verified input digest must be 64 lowercase hexadecimal characters",
      );
    }
    const inspection = await inspectRustRawFile(
      new Uint8Array(csvBytes),
      fileName,
      sizeBytes,
      participantPartitionBatchId,
    );
    return { ...inspection, inputSha256: digest };
  },
  async executeLiteratureComponentBytes(
    registration: RegisteredLiteratureComponentExecution,
    inputFileName: string,
    csvBytes: ArrayBuffer,
    supportFiles: BrowserSupportFiles,
    persistRustWorkspace: boolean,
    verifiedInputSha256?: string,
  ): Promise<LiteratureComponentRuntimeExecution> {
    const inputSha256 =
      verifiedInputSha256 ?? (await computeSha256Hex(csvBytes));
    const result = await withRuntimeExecutionLane(() =>
      executeLiteratureComponentRuntime(
        registration,
        new Uint8Array(csvBytes),
        inputFileName,
        supportFiles,
        persistRustWorkspace,
        inputSha256,
      ),
    );
    const transfers = result.artifacts.flatMap(({ bytes }) =>
      bytes?.buffer instanceof ArrayBuffer ? [bytes.buffer] : [],
    );
    return transfers.length ? Comlink.transfer(result, transfers) : result;
  },
  /**
   * Zero-copy variant: caller transfers ownership of the raw CSV bytes.
   * Worker decodes them once and drops the ArrayBuffer; main thread no
   * longer holds the file content while processing is in flight.
   */
  async processRawCsvBytes(
    inputFileName: string,
    csvBytes: ArrayBuffer,
    incomingOptions?: Partial<BrowserProcessingOptions>,
    supportFiles?: BrowserSupportFiles,
    runtime?: BrowserProcessingRuntime,
    onProgress?: (event: ProgressEvent) => void,
    verifiedInputSha256?: string,
    participantPartition?: ParticipantPartitionTransport,
    participantPartitionSecret?: ArrayBuffer,
  ): Promise<ProcessedFileResult> {
    const options: BrowserProcessingOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      ...incomingOptions,
    };
    // Hash the raw bytes before decoding (and before the buffer is dropped).
    const inputBytes = new Uint8Array(csvBytes);
    const inputSha256 =
      verifiedInputSha256 ?? (await computeSha256Hex(csvBytes));
    if (!/^[0-9a-f]{64}$/.test(inputSha256)) {
      throw new Error(
        "verified input digest must be 64 lowercase hexadecimal characters",
      );
    }
    const resolvedRuntime = effectiveRuntime(
      runtime,
      inputFileName,
      inputSha256,
    );
    const forward = onProgress
      ? (event: ProgressEvent) => {
          try {
            onProgress(event);
          } catch {
            // Ignore progress callback failures so they cannot abort processing.
          }
        }
      : undefined;
    const activePartition = requiresLiveScientificPreflight(options)
      ? participantPartition
      : undefined;
    if (!activePartition && participantPartitionSecret) {
      new Uint8Array(participantPartitionSecret).fill(0);
    }
    // The spill counters run for the worker's lifetime and one worker serves
    // many files, so this file's traffic is the delta across its run.
    const spillBefore = payloadSpill?.stats();
    let result: ProcessedFileResult;
    try {
      result = await withParticipantPartitionLane({
        csvBytes: inputBytes,
        partition: activePartition,
        secretBuffer: activePartition ? participantPartitionSecret : undefined,
        operations: {
          begin: beginRustRawInspectionBatch,
          register: registerRustRawParticipantPartitionArtifact,
          dispose: disposeRustRawInspectionBatch,
        },
        execute: (resolvedPartition) =>
          processRawCsvWithRustAuthority(
            inputFileName,
            inputBytes,
            options,
            supportFiles,
            resolvedRuntime,
            forward,
            inputSha256,
            resolvedPartition,
          ),
      });
    } catch (error) {
      throwSerializableScientificPreflightRefusal(error);
    }
    result.inputSha256 = inputSha256;
    result.workerWasmMemoryBytes = rustWasmMemoryBytes() ?? undefined;
    const spillAfter = payloadSpill?.stats();
    result.workerPayloadSpill =
      spillBefore && spillAfter
        ? payloadSpillDelta(spillBefore, spillAfter)
        : spillAfter;
    // A terminated sibling's file is inside the boot window when this
    // worker boots; it ages out while files are processed, so reclaim
    // it here rather than at some later boot. Best effort, off the
    // result path.
    void payloadSpill?.sweep();
    if (result.rustRuntimeReceipt)
      invalidateSemanticIndex(result.rustRuntimeReceipt.workspaceId);
    return result;
  },
  /** Fast A/B path: execute the same Rust graph and return review metrics only. */
  async processPersistedReview(
    inputFileName: string,
    inputSizeBytes: number,
    incomingOptions: Partial<BrowserProcessingOptions> | undefined,
    supportFiles: BrowserSupportFiles | undefined,
    runtime: BrowserProcessingRuntime | undefined,
    verifiedInputSha256: string,
    supportCacheKey?: string,
    knownReviewSummaryDigests?: string[],
  ): Promise<ProcessedFileResult | null> {
    const options: BrowserProcessingOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      ...incomingOptions,
    };
    const resolvedRuntime = effectiveRuntime(
      runtime,
      inputFileName,
      verifiedInputSha256,
    );
    return withRuntimeExecutionLane(async () =>
      transferReviewResult(
        await processPersistedReviewWithRustAuthority(
          inputFileName,
          inputSizeBytes,
          options,
          supportCacheKey
            ? cachedComparisonSupportFiles(supportCacheKey)
            : supportFiles,
          resolvedRuntime,
          verifiedInputSha256,
          supportCacheKey,
          knownReviewSummaryDigests,
        ),
      ),
    );
  },

  /** Fast A/B fallback when no verified persisted base can answer the request. */
  async processReviewCsvBytes(
    inputFileName: string,
    csvBytes: ArrayBuffer,
    incomingOptions?: Partial<BrowserProcessingOptions>,
    supportFiles?: BrowserSupportFiles,
    runtime?: BrowserProcessingRuntime,
    verifiedInputSha256?: string,
    supportCacheKey?: string,
    knownReviewSummaryDigests?: string[],
    participantPartition?: ParticipantPartitionTransport,
    participantPartitionSecret?: ArrayBuffer,
  ): Promise<ProcessedFileResult> {
    const options: BrowserProcessingOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      ...incomingOptions,
    };
    const inputBytes = new Uint8Array(csvBytes);
    const inputSha256 =
      verifiedInputSha256 ?? (await computeSha256Hex(csvBytes));
    if (!/^[0-9a-f]{64}$/.test(inputSha256)) {
      throw new Error(
        "verified input digest must be 64 lowercase hexadecimal characters",
      );
    }
    const resolvedRuntime = effectiveRuntime(
      runtime,
      inputFileName,
      inputSha256,
    );
    const activePartition = requiresLiveScientificPreflight(options)
      ? participantPartition
      : undefined;
    if (!activePartition && participantPartitionSecret) {
      new Uint8Array(participantPartitionSecret).fill(0);
    }
    let result: ProcessedFileResult;
    try {
      result = await withParticipantPartitionLane({
        csvBytes: inputBytes,
        partition: activePartition,
        secretBuffer: activePartition ? participantPartitionSecret : undefined,
        operations: {
          begin: beginRustRawInspectionBatch,
          register: registerRustRawParticipantPartitionArtifact,
          dispose: disposeRustRawInspectionBatch,
        },
        execute: (resolvedPartition) =>
          processRawCsvReviewWithRustAuthority(
            inputFileName,
            inputBytes,
            options,
            supportCacheKey
              ? cachedComparisonSupportFiles(supportCacheKey)
              : supportFiles,
            resolvedRuntime,
            inputSha256,
            supportCacheKey,
            knownReviewSummaryDigests,
            resolvedPartition,
          ),
      });
    } catch (error) {
      throwSerializableScientificPreflightRefusal(error);
    }
    return transferReviewResult(result);
  },
};

export type ChronicleWorkerApi = typeof api;

Comlink.expose(api);
postMessage({ type: "chronicle-worker-api-ready/v1" });
