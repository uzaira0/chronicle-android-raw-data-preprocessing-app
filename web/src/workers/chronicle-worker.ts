import * as Comlink from "comlink";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  discoverRustTimezones,
  exportPersistedRustWorkspace,
  garbageCollectPersistedRustWorkspace,
  importPersistedRustWorkspace,
  importPersistedRustWorkspaceArchive,
  verifyPersistedRustWorkspace,
  getRustRuntimeVersion,
  getRustPlanStageView,
  inspectRustRawFile,
  readPersistedRustWorkspaceHead,
  readVerifiedSemanticIndexSnapshot,
} from "@/lib/rustPipelineRuntime";
import type { RawFileInspection } from "@/lib/fileInspection";
import { processRawCsvWithRustAuthority } from "@/lib/rustPipelineAuthority";
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

/**
 * SHA-256 of the raw input, returned as a lowercase hex string. Runs in the
 * worker so hashing large batches stays off the main thread. Used for the
 * run-manifest provenance sidecar.
 */
async function computeSha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  return cacheSemanticIndex(
    workspaceId,
    {
      workspaceRootDigest: snapshot.workspaceRootDigest,
      index: await rebuildSemanticIndex(snapshot.source),
    },
  );
}

function resolveSessionDatetime(
  fileName: string,
  inputSha256: string,
): string {
  const existing = sessionDatetimes.get(fileName);
  if (existing?.inputSha256 === inputSha256) {
    sessionDatetimes.delete(fileName);
    sessionDatetimes.set(fileName, existing);
    return existing.datetime;
  }
  const datetime = `${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`;
  if (!sessionDatetimes.has(fileName) && sessionDatetimes.size >= MAX_SESSION_DATETIMES) {
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
  planStageView(options: BrowserProcessingOptions) {
    return getRustPlanStageView(options);
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
    const removedObjects = await garbageCollectPersistedRustWorkspace(workspaceId);
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
  discoverTimezones(csvText: string): Promise<string[]> {
    return discoverRustTimezones(new TextEncoder().encode(csvText));
  },
  discoverTimezonesBytes(csvBytes: ArrayBuffer): Promise<string[]> {
    return discoverRustTimezones(new Uint8Array(csvBytes));
  },
  inspectRawCsvBytes(
    fileName: string,
    sizeBytes: number,
    csvBytes: ArrayBuffer,
  ): Promise<RawFileInspection> {
    return inspectRustRawFile(new Uint8Array(csvBytes), fileName, sizeBytes);
  },
  async processRawCsv(
    inputFileName: string,
    csvText: string,
    incomingOptions?: Partial<BrowserProcessingOptions>,
    supportFiles?: BrowserSupportFiles,
    runtime?: BrowserProcessingRuntime,
  ): Promise<ProcessedFileResult> {
    const options: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS, ...incomingOptions };
    const bytes = new TextEncoder().encode(csvText);
    const inputSha256 = await computeSha256Hex(bytes);
    const resolvedRuntime = effectiveRuntime(runtime, inputFileName, inputSha256);
    const result = await processRawCsvWithRustAuthority(
      inputFileName,
      bytes,
      options,
      supportFiles,
      resolvedRuntime,
      undefined,
      inputSha256,
    );
    if (result.rustRuntimeReceipt) invalidateSemanticIndex(result.rustRuntimeReceipt.workspaceId);
    return result;
  },
  async processRawCsvWithProgress(
    inputFileName: string,
    csvText: string,
    incomingOptions?: Partial<BrowserProcessingOptions>,
    supportFiles?: BrowserSupportFiles,
    runtime?: BrowserProcessingRuntime,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<ProcessedFileResult> {
    const options: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS, ...incomingOptions };
    const bytes = new TextEncoder().encode(csvText);
    const inputSha256 = await computeSha256Hex(bytes);
    const resolvedRuntime = effectiveRuntime(runtime, inputFileName, inputSha256);
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
      bytes,
      options,
      supportFiles,
      resolvedRuntime,
      forward,
      inputSha256,
    );
    if (result.rustRuntimeReceipt) invalidateSemanticIndex(result.rustRuntimeReceipt.workspaceId);
    return result;
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
  ): Promise<ProcessedFileResult> {
    const options: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS, ...incomingOptions };
    // Hash the raw bytes before decoding (and before the buffer is dropped).
    const inputBytes = new Uint8Array(csvBytes);
    const inputSha256 = await computeSha256Hex(csvBytes);
    const resolvedRuntime = effectiveRuntime(runtime, inputFileName, inputSha256);
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
    if (result.rustRuntimeReceipt) invalidateSemanticIndex(result.rustRuntimeReceipt.workspaceId);
    return result;
  },
};

export type ChronicleWorkerApi = typeof api;

Comlink.expose(api);
