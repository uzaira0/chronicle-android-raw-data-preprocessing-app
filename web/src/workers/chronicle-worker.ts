import * as Comlink from "comlink";
import {
  DEFAULT_BROWSER_OPTIONS,
  discoverTimezonesFromRawCsv,
  processRawCsvContent,
} from "@/lib/browserPipeline";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
  MatcherInput,
  MatcherOutput,
  ProcessedFileResult,
  ProgressEvent,
} from "@/lib/types";

/**
 * Decode an ArrayBuffer to UTF-8 string and immediately drop the buffer
 * reference. The buffer was transferred (zero-copy) from the main thread,
 * so the main thread no longer holds the bytes. Decoding produces a JS
 * string that we then feed into the existing CSV pipeline. Net peak memory
 * for the input phase: one copy of the file content (vs. two before).
 */
function decodeCsvBytes(bytes: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(bytes);
}

let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
    await module.default();
  })();
  return initPromise;
}

async function runMatcher(input: MatcherInput): Promise<MatcherOutput> {
  await ensureInit();
  const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
  return module.matchAppUsageUpdateIndices(
    input.appCodes,
    input.timestampNs,
    input.resumed,
    input.sameStop,
    input.otherStop,
    input.stopped,
    input.options.allowStopEventReuse,
    input.options.useActivityStoppedAsFallback,
    input.options.applyThresholdToFallback,
    input.options.longDurationThresholdNs,
  ) as MatcherOutput;
}

const api = {
  async matcherVersion(): Promise<string> {
    await ensureInit();
    const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
    return module.matcherVersion();
  },
  async discoverTimezones(
    csvText: string,
    runtime?: BrowserProcessingRuntime,
  ): Promise<string[]> {
    return discoverTimezonesFromRawCsv(csvText, runtime);
  },
  async processRawCsv(
    inputFileName: string,
    csvText: string,
    incomingOptions?: Partial<BrowserProcessingOptions>,
    supportFiles?: BrowserSupportFiles,
    runtime?: BrowserProcessingRuntime,
  ): Promise<ProcessedFileResult> {
    const options: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS, ...incomingOptions };
    return processRawCsvContent(
      inputFileName,
      csvText,
      options,
      supportFiles,
      runMatcher,
      runtime,
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
    const forward = onProgress
      ? (event: ProgressEvent) => {
          try {
            onProgress(event);
          } catch {
            // Ignore progress callback failures so they cannot abort processing.
          }
        }
      : undefined;
    return processRawCsvContent(
      inputFileName,
      csvText,
      options,
      supportFiles,
      runMatcher,
      runtime,
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
    const csvText = decodeCsvBytes(csvBytes);
    const forward = onProgress
      ? (event: ProgressEvent) => {
          try {
            onProgress(event);
          } catch {
            // Ignore progress callback failures so they cannot abort processing.
          }
        }
      : undefined;
    return processRawCsvContent(
      inputFileName,
      csvText,
      options,
      supportFiles,
      runMatcher,
      runtime,
      forward,
    );
  },
};

export type ChronicleWorkerApi = typeof api;

Comlink.expose(api);
