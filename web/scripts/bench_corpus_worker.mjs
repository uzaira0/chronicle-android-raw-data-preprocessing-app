// Worker for bench_corpus.mts. Loads its own WASM instance and processes
// fixtures dispatched from the main thread.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";

const SAME_STOP_TYPES = ["Activity Paused", "Activity Resumed"];
const OTHER_STOP_TYPES = [
  "Activity Resumed",
  "Filtered App Resumed",
  "Filtered App Usage",
  "Device Shutdown",
];
const LONG_DURATION_THRESHOLD_NS = BigInt(12 * 3600 * 1_000_000_000);

const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 12);

async function init() {
  const module = await import(path.join(workerData.kernelPkg, "chronicle_chrono_kernel_wasm.js"));
  const wasmBytes = await readFile(path.join(workerData.kernelPkg, "chronicle_chrono_kernel_wasm_bg.wasm"));
  await module.default({ module_or_path: wasmBytes });
  return (bytes, tz, filteredPackages) =>
    module.process_full_pipeline_e2e(
      bytes, tz, filteredPackages,
      SAME_STOP_TYPES, OTHER_STOP_TYPES,
      LONG_DURATION_THRESHOLD_NS, false, true, true,
    );
}

const Papa = (await import("papaparse")).default;

const k = await init();
parentPort.postMessage({ type: "ready" });

parentPort.on("message", async (msg) => {
  if (msg.type === "shutdown") {
    process.exit(0);
  }
  if (msg.type !== "process") return;
  try {
    const bytes = await readFile(msg.file);
    const parsed = Papa.parse(Buffer.from(bytes).toString("utf8"), {
      header: true,
      skipEmptyLines: true,
      preview: 1,
    });
    const tz = parsed.data[0]?.timezone ?? "UTC";
    const t = performance.now();
    const out = k(bytes, tz, msg.filterArr);
    const rustMs = performance.now() - t;
    parentPort.postMessage({
      type: "result",
      result: {
        file: path.basename(msg.file),
        bytes: bytes.length,
        outBytes: out.length,
        tsMs: 0,
        rustMs,
        byteDiff: 0,
        speedup: 0,
        shaTs: "",
        shaRust: sha(out),
      },
    });
  } catch (err) {
    parentPort.postMessage({ type: "error", error: String(err) });
  }
});
