/**
 * Compute a memory-safe parallel worker count.
 *
 * Each in-flight worker holds, at peak, roughly a 5–10× expansion of its file's
 * input bytes (parsed `CanonicalRow[]`, intermediate matcher buffers,
 * codebook-enriched rows, and a Blob being assembled). Hardcoding 8 workers
 * regardless of input size is what crashes the tab on a 540 MB batch — the sum
 * of in-flight expansions exceeds Chrome's renderer ceiling.
 *
 * Strategy:
 *   - If the user pinned `parallelMaxWorkers`, respect it.
 *   - Otherwise budget for in-flight worker state and divide by an 8×
 *     amplification of the average file size.
 *   - Scale that budget down on low-`deviceMemory` machines, since the renderer
 *     ceiling there is far lower — this is the real memory governor (the
 *     reference's "pinned-URL cap" has no analogue here; concurrency is what
 *     bounds peak RAM during a batch).
 *   - Clamp to [1, hardwareConcurrency/2] and never exceed file count.
 */
const PEAK_AMPLIFICATION = 8;
const IN_FLIGHT_BUDGET_BYTES = 600 * 1024 * 1024;
/** `navigator.deviceMemory` is reported in GiB; treat 8 as the full-budget baseline. */
const BASELINE_DEVICE_MEMORY_GB = 8;

/**
 * Fraction of the in-flight budget to allow given `deviceMemory` (GiB). Unknown
 * (Firefox/Safari don't expose it) → full budget, preserving prior behavior.
 * Low-memory devices (which Chrome *does* report) get a tighter budget.
 */
export function deviceMemoryBudgetScale(deviceMemory: number | undefined): number {
  if (!deviceMemory || deviceMemory <= 0) return 1;
  return Math.min(1, Math.max(0.25, deviceMemory / BASELINE_DEVICE_MEMORY_GB));
}

export function computeSafeConcurrency(input: {
  fileCount: number;
  totalInputBytes: number;
  userCap: number | undefined;
  hardwareConcurrency: number | undefined;
  deviceMemory?: number | undefined;
}): number {
  const { fileCount, totalInputBytes, userCap, hardwareConcurrency, deviceMemory } = input;
  if (fileCount <= 1) return 1;
  if (userCap && userCap > 0) {
    return Math.max(1, Math.min(fileCount, Math.floor(userCap)));
  }
  const cores = Math.max(1, Math.floor((hardwareConcurrency ?? 2) / 2));
  const avgBytes = totalInputBytes > 0 ? totalInputBytes / fileCount : 1024;
  const budget = IN_FLIGHT_BUDGET_BYTES * deviceMemoryBudgetScale(deviceMemory);
  const memoryCap = Math.max(
    1,
    Math.floor(budget / Math.max(1, avgBytes * PEAK_AMPLIFICATION)),
  );
  return Math.max(1, Math.min(fileCount, cores, memoryCap));
}

/** `navigator.deviceMemory` if the browser exposes it, else undefined. */
export function readDeviceMemory(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
}
