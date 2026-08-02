import * as Comlink from "comlink";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  discoverRustTimezones,
  exportPersistedRustWorkspace,
  garbageCollectPersistedRustWorkspace,
  importPersistedRustWorkspace,
  importPersistedRustWorkspaceArchive,
  initializeRustRuntime,
  verifyPersistedRustWorkspace,
  getRustRuntimeVersion,
  getRustPlanStageView,
  inspectRustRawFile,
  readPersistedRustWorkspaceHead,
  readVerifiedSemanticIndexSnapshot,
  rustWasmMemoryBytes,
} from "@/lib/rustPipelineRuntime";
import type { RawFileInspection } from "@/lib/fileInspection";
import {
  probeOpfsCapability,
  type OpfsCapability,
} from "@/lib/opfsArtifactStore";
import {
  processPersistedReviewWithRustAuthority,
  processRawCsvReviewWithRustAuthority,
  processRawCsvWithRustAuthority,
} from "@/lib/rustPipelineAuthority";
import {
  queryRegisteredSemanticIndex,
  rebuildSemanticIndex,
} from "@/lib/semanticIndex";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
  ProcessedFileResult,
  ProgressEvent,
} from "@/lib/types";
import { comparisonSupportCacheKey } from "@/lib/comparisonSupportKey";

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

function transferReviewResult(
  result: ProcessedFileResult | null,
): ProcessedFileResult | null {
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
    index: await rebuildSemanticIndex(snapshot.source),
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

const api = {
  async initializeRuntime(compiledModule: WebAssembly.Module): Promise<void> {
    await initializeRustRuntime(compiledModule);
  },
  planStageView(options: BrowserProcessingOptions) {
    return getRustPlanStageView(options);
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
  async exportWorkspaceClosure(workspaceId: string): Promise<Uint8Array> {
    const archive = await exportPersistedRustWorkspace(workspaceId);
    return Comlink.transfer(archive, [archive.buffer]);
  },
  async importWorkspaceClosure(workspaceId: string, bytes: Uint8Array) {
    const result = await importPersistedRustWorkspace(workspaceId, bytes);
    invalidateSemanticIndex(workspaceId);
    return result;
  },
  async importWorkspaceClosureArchive(bytes: Uint8Array) {
    const result = await importPersistedRustWorkspaceArchive(bytes);
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
  async rebuildIndex(workspaceId: string): Promise<Uint8Array> {
    const snapshot = await readVerifiedSemanticIndexSnapshot(workspaceId);
    const entry = cacheSemanticIndex(workspaceId, {
      workspaceRootDigest: snapshot.workspaceRootDigest,
      index: await rebuildSemanticIndex(snapshot.source),
    });
    return entry.index;
  },
  async queryRegistered(workspaceId: string, queryId: string) {
    const entry = await getSemanticIndex(workspaceId);
    return {
      ...(await queryRegisteredSemanticIndex(entry.index, queryId)),
      workspaceRootDigest: entry.workspaceRootDigest,
    };
  },
  async runtimeVersion(): Promise<string> {
    return getRustRuntimeVersion();
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
  async inspectRawCsvBytes(
    fileName: string,
    sizeBytes: number,
    csvBytes: ArrayBuffer,
    verifiedInputSha256?: string,
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
    );
    return { ...inspection, inputSha256: digest };
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
    const result = await processRawCsvWithRustAuthority(
      inputFileName,
      inputBytes,
      options,
      supportFiles,
      resolvedRuntime,
      forward,
      inputSha256,
    );
    result.inputSha256 = inputSha256;
    result.workerWasmMemoryBytes = rustWasmMemoryBytes() ?? undefined;
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
    return transferReviewResult(
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
    const result = await processRawCsvReviewWithRustAuthority(
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
    );
    return transferReviewResult(result)!;
  },
};

export type ChronicleWorkerApi = typeof api;

Comlink.expose(api);
