import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { processRawCsvContent } from "../src/lib/browserPipeline";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
} from "../src/lib/types";

import { runMatcher, runSplitter } from "./_matcherHarness.mjs";

type ProcessingSpec = {
  inputFileName: string;
  rawCsvPath: string;
  outputDir: string;
  options: Partial<BrowserProcessingOptions>;
  runtime?: BrowserProcessingRuntime;
  supportFilePaths?: {
    filterFile?: string;
    appsForcingScreenOpenFile?: string;
    backgroundAppsFile?: string;
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
  const backgroundAppsFile = await loadSupportFile(supportFilePaths?.backgroundAppsFile);
  const appCodebookFile = await loadSupportFile(supportFilePaths?.appCodebookFile);
  return {
    ...(filterFile ? { filterFile } : {}),
    ...(appsForcingScreenOpenFile ? { appsForcingScreenOpenFile } : {}),
    ...(backgroundAppsFile ? { backgroundAppsFile } : {}),
    ...(appCodebookFile ? { appCodebookFile } : {}),
  };
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
