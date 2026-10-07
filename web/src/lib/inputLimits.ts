/**
 * Largest raw CSV the browser engine accepts, checked against `File.size`
 * before any byte is read (every raw read is a whole-file `arrayBuffer()`
 * that is then copied into a wasm32 worker).
 *
 * Derived from the measured numbers in docs/perf/BASELINE.md ("Large-export
 * memory peak"), not guessed:
 *
 * - The 580,793-row synthetic export is 110,463,056 bytes (190.2 bytes per
 *   row). In the shipped browser build its worker's WASM memory high-water
 *   was 2,097,741,824 bytes at the 512 MiB payload budget and 2,665,611,264
 *   at 1 GiB: about 14.1–14.4 bytes of memory above the budget per input
 *   byte.
 * - A wasm32 worker addresses at most 4 GiB. `concurrency.ts` keeps
 *   NON_PAYLOAD_RESERVE_BYTES = 2.5 GiB of that beside the largest (1.5 GiB)
 *   payload budget, so 2.5 GiB / 14.4 ≈ 186 MB of input fits the reserve.
 * - `BROWSER_ENGINE_ROW_CEILING` (950,000 rows, about 3.3 GiB at the measured
 *   3.6 KB per row) at 190.2 bytes per row is ≈ 180.7 MB.
 *
 * The bound is the smaller of the two, rounded down: 180 MB. Real exports are
 * far below it (the largest of 124 measured real files has 73,568 rows).
 * A file above it would run out of memory part-way through and can take the
 * tab down with it; splitting the export by date range is the remedy.
 */
export const MAX_RAW_INPUT_BYTES = 180_000_000;

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
