import * as Comlink from "comlink";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  discoverRustTimezones,
  exportPersistedRustWorkspace,
  garbageCollectPersistedRustWorkspace,
  importPersistedRustWorkspace,
  importPersistedRustWorkspaceArchive,
  readPersistedRustArtifact,
  verifyPersistedRustWorkspace,
  getRustRuntimeVersion,
  getRustPlanStageView,
} from "@/lib/rustPipelineRuntime";
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

function resolveSessionDatetime(
  fileName: string,
  inputSha256: string,
): string {
  const existing = sessionDatetimes.get(fileName);
  if (existing?.inputSha256 === inputSha256) return existing.datetime;
  const datetime = `${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`;
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
  exportWorkspaceClosure(workspaceId: string): Promise<Uint8Array> {
    return exportPersistedRustWorkspace(workspaceId);
  },
  importWorkspaceClosure(workspaceId: string, bytes: Uint8Array) {
    return importPersistedRustWorkspace(workspaceId, bytes);
  },
  importWorkspaceClosureArchive(bytes: Uint8Array) {
    return importPersistedRustWorkspaceArchive(bytes);
  },
  async garbageCollectWorkspace(
    workspaceId: string,
  ): Promise<{ removedObjects: number }> {
    return {
      removedObjects: await garbageCollectPersistedRustWorkspace(workspaceId),
    };
  },
  async rebuildIndex(workspaceId: string): Promise<Uint8Array> {
    return rebuildSemanticIndex(
      await readPersistedRustArtifact(workspaceId, "semantic-index-source-json"),
    );
  },
  async queryRegistered(workspaceId: string, queryId: string) {
    const index = await rebuildSemanticIndex(
      await readPersistedRustArtifact(workspaceId, "semantic-index-source-json"),
    );
    return queryRegisteredSemanticIndex(index, queryId);
  },
  async matcherVersion(): Promise<string> {
    return getRustRuntimeVersion();
  },
  discoverTimezones(csvText: string): Promise<string[]> {
    return discoverRustTimezones(new TextEncoder().encode(csvText));
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
    return processRawCsvWithRustAuthority(
      inputFileName,
      bytes,
      options,
      supportFiles,
      resolvedRuntime,
    );
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
    return processRawCsvWithRustAuthority(
      inputFileName,
      bytes,
      options,
      supportFiles,
      resolvedRuntime,
      forward,
    );
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
    );
    result.inputSha256 = inputSha256;
    return result;
  },
};

export type ChronicleWorkerApi = typeof api;

Comlink.expose(api);
