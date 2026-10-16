/**
 * Largest raw CSV the browser engine accepts, checked against `File.size`
 * before any byte is read.
 *
 * Derived from the measured numbers in docs/perf/BASELINE.md ("Real-size
 * exports"), not guessed. At the 512 MiB payload budget a worker that
 * processed a 749,999,909-byte export peaked at 3,240,296,448 bytes of WASM
 * memory with the app defaults and 3,666,870,272 with the TECH/GNSM preset,
 * the most memory-hungry preset. A wasm32 worker addresses at most 4 GiB,
 * and `concurrency.ts` keeps WORKER_HEADROOM_BYTES (512 MiB) of that free:
 * the preset's 4.6 bytes per input byte (`WORKER_BYTES_PER_INPUT_BYTE`)
 * reaches that line at about 769 MB. The bound is 750 MB, the largest size
 * measured to fit. Turning on every optional output costs more and can run
 * out of memory below it; `outOfMemoryRefusal` names that case.
 */
export const MAX_RAW_INPUT_BYTES = 750_000_000;

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB`;
}

/** A plain-language refusal for a file over the bound, or null when it fits. */
export function rawFileSizeRefusal(file: { name: string; size: number }): string | null {
  if (file.size <= MAX_RAW_INPUT_BYTES) return null;
  return (
    `${file.name} is ${megabytes(file.size)}, larger than the ${megabytes(MAX_RAW_INPUT_BYTES)} ` +
    "this browser app can process: it would run out of memory part-way through. " +
    "Split the export into shorter date ranges and add the parts as separate files."
  );
}

/** Throw the refusal for an oversized file; used right before a whole-file read. */
export function assertRawFileWithinLimit(file: { name: string; size: number }): void {
  const refusal = rawFileSizeRefusal(file);
  if (refusal !== null) throw new Error(refusal);
}

/** Split a selection into files that fit and refusal messages for those that do not. */
export function admitRawFilesBySize<T extends { name: string; size: number }>(
  files: readonly T[],
): { accepted: T[]; refusals: string[] } {
  const accepted: T[] = [];
  const refusals: string[] = [];
  for (const file of files) {
    const refusal = rawFileSizeRefusal(file);
    if (refusal === null) accepted.push(file);
    else refusals.push(refusal);
  }
  return { accepted, refusals };
}

/**
 * Rust aborts on a failed allocation, which on wasm32 surfaces as a bare
 * `WebAssembly.RuntimeError` ("unreachable"). A trap with the worker's memory
 * this close to the 4 GiB a wasm32 worker can address is that abort.
 */
const OUT_OF_MEMORY_FLOOR_BYTES = 3.5 * 1024 ** 3;

/** A plain-language message for a worker that ran out of memory, or null for any other failure. */
export function outOfMemoryRefusal(
  error: unknown,
  fileName: string,
  wasmMemoryBytes: number | null | undefined,
): string | null {
  if (!(error instanceof WebAssembly.RuntimeError)) return null;
  if (!wasmMemoryBytes || wasmMemoryBytes < OUT_OF_MEMORY_FLOOR_BYTES) return null;
  return (
    `${fileName} ran out of memory: processing it used all of the 4 GB a browser worker can address. ` +
    "Turn off optional outputs in Settings, or split the export into shorter date ranges " +
    "and add the parts as separate files."
  );
}
