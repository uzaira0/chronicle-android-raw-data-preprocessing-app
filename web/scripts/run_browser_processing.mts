import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { processRawCsvContent } from "../src/lib/browserPipeline";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
  MatcherInput,
  MatcherOutput,
  SplitterInput,
  SplitterOutput,
} from "../src/lib/types";

type ProcessingSpec = {
  inputFileName: string;
  rawCsvPath: string;
  outputDir: string;
  options: Partial<BrowserProcessingOptions>;
  runtime?: BrowserProcessingRuntime;
  supportFilePaths?: {
    filterFile?: string;
    appsForcingScreenOpenFile?: string;
    appCodebookFile?: string;
  };
};

async function loadSupportFile(
  filePath: string | undefined,
): Promise<BrowserSupportFiles[keyof BrowserSupportFiles] | undefined> {
  if (!filePath) {
    return undefined;
  }
  const bytes = await readFile(filePath);
  return {
    name: path.basename(filePath),
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

async function loadSupportFiles(
  supportFilePaths: ProcessingSpec["supportFilePaths"],
): Promise<BrowserSupportFiles> {
  const filterFile = await loadSupportFile(supportFilePaths?.filterFile);
  const appsForcingScreenOpenFile = await loadSupportFile(supportFilePaths?.appsForcingScreenOpenFile);
  const appCodebookFile = await loadSupportFile(supportFilePaths?.appCodebookFile);
  return {
    ...(filterFile ? { filterFile } : {}),
    ...(appsForcingScreenOpenFile ? { appsForcingScreenOpenFile } : {}),
    ...(appCodebookFile ? { appCodebookFile } : {}),
  };
}

let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    const module = await import("../src/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
    const wasmPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../src/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm_bg.wasm",
    );
    await module.default({ module_or_path: await readFile(wasmPath) });
  })();
  return initPromise;
}

async function runMatcher(input: MatcherInput): Promise<MatcherOutput> {
  await ensureInit();
  const module = await import("../src/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
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

async function runSplitter(input: SplitterInput): Promise<SplitterOutput> {
  await ensureInit();
  const module = await import("../src/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
  const wasmModule = module as unknown as {
    splitOverlappingSessions: (starts: BigInt64Array, stops: BigInt64Array) => SplitterOutput;
  };
  return wasmModule.splitOverlappingSessions(input.starts, input.stops);
}

async function main(): Promise<void> {
  const specPath = process.argv[2];
  if (!specPath) {
    throw new Error("Usage: vite-node web/scripts/run_browser_processing.mts <spec.json>");
  }

  const spec = JSON.parse(await readFile(specPath, "utf-8")) as ProcessingSpec;
  const rawCsv = await readFile(spec.rawCsvPath, "utf-8");
  const supportFiles = await loadSupportFiles(spec.supportFilePaths);
  const result = await processRawCsvContent(
    spec.inputFileName,
    rawCsv,
    spec.options,
    supportFiles,
    runMatcher,
    spec.runtime,
    undefined,
    runSplitter,
  );

  await mkdir(spec.outputDir, { recursive: true });
  // Output bytes now live in a Blob (file-backed in browsers); on Node the
  // Blob is in-memory but exposes the same async-stream API.
  const serializableOutputs: Array<{
    kind: string;
    outputFileName: string;
    rowCount: number;
    previewRows: string[][];
  }> = [];
  for (const output of result.outputs) {
    const bytes = new Uint8Array(await output.blob.arrayBuffer());
    await writeFile(path.join(spec.outputDir, output.outputFileName), bytes);
    serializableOutputs.push({
      kind: output.kind,
      outputFileName: output.outputFileName,
      rowCount: output.rowCount,
      previewRows: output.previewRows,
    });
  }
  await writeFile(
    path.join(spec.outputDir, "browser_result.json"),
    JSON.stringify({ ...result, outputs: serializableOutputs }, null, 2),
    "utf-8",
  );
}

await main();
