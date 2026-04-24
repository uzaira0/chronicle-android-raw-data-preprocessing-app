import * as Comlink from "comlink";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
  ProcessedFileResult,
} from "@/lib/types";
import type { ChronicleWorkerApi } from "@/workers/chronicle-worker";

let workerApiPromise: Promise<Comlink.Remote<ChronicleWorkerApi>> | null = null;

async function createWorkerApi(): Promise<{
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: Worker;
}> {
  const worker = new Worker(new URL("../workers/chronicle-worker.ts", import.meta.url), {
    type: "module",
  });
  return {
    api: Comlink.wrap<ChronicleWorkerApi>(worker),
    worker,
  };
}

async function getWorkerApi(): Promise<Comlink.Remote<ChronicleWorkerApi>> {
  if (workerApiPromise) {
    return workerApiPromise;
  }
  workerApiPromise = createWorkerApi().then(({ api }) => api);
  return workerApiPromise;
}

async function withIsolatedWorker<T>(
  action: (api: Comlink.Remote<ChronicleWorkerApi>) => Promise<T>,
): Promise<T> {
  const { api, worker } = await createWorkerApi();
  try {
    return await action(api);
  } finally {
    worker.terminate();
  }
}

export async function getMatcherVersion(): Promise<string> {
  const api = await getWorkerApi();
  return api.matcherVersion();
}

export async function discoverTimezones(
  csvText: string,
  runtime?: BrowserProcessingRuntime,
): Promise<string[]> {
  const api = await getWorkerApi();
  return api.discoverTimezones(csvText, runtime);
}

export async function processRawCsv(
  inputFileName: string,
  csvText: string,
  options?: Partial<BrowserProcessingOptions>,
  supportFiles?: BrowserSupportFiles,
  runtime?: BrowserProcessingRuntime,
): Promise<ProcessedFileResult> {
  const api = await getWorkerApi();
  return api.processRawCsv(inputFileName, csvText, options, supportFiles, runtime);
}

export async function processRawCsvIsolated(
  inputFileName: string,
  csvText: string,
  options?: Partial<BrowserProcessingOptions>,
  supportFiles?: BrowserSupportFiles,
  runtime?: BrowserProcessingRuntime,
): Promise<ProcessedFileResult> {
  return withIsolatedWorker((api) =>
    api.processRawCsv(inputFileName, csvText, options, supportFiles, runtime),
  );
}
