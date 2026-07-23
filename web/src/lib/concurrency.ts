/**
 * Compute a memory-safe parallel worker count.
 *
 * The production Rust runtime retains exact row checkpoints and builds the
 * source-coordinate, result-cell, lineage, visualization, and researcher
 * outputs before returning. A measured 11.53 MB / 60,624-row input peaked at
 * 0.95 GB (default) and 1.45 GB (artifact-heavy options): 83–126× the input.
 * Use the conservative measured ceiling until browser-process RSS telemetry
 * supports a more precise option-sensitive model.
 *
 * Strategy:
 *   - A user `parallelMaxWorkers` value is an upper bound, never permission to
 *     bypass the memory/core limits.
 *   - Otherwise budget for in-flight worker state using the largest files that
 *     can actually be active together. An average is unsafe for a skewed batch:
 *     one 500 MB export plus many tiny files can look cheap while still
 *     exhausting the renderer.
 *   - Scale that budget down on low-`deviceMemory` machines, since the renderer
 *     ceiling there is far lower — this is the real memory governor (the
 *     reference's "pinned-URL cap" has no analogue here; concurrency is what
 *     bounds peak RAM during a batch).
 *   - Clamp to [1, hardwareConcurrency/2] and never exceed file count.
 */
const PEAK_AMPLIFICATION = 128;
const WORKER_BASELINE_BYTES = 48 * 1024 * 1024;
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
  fileSizes?: readonly number[];
  userCap: number | undefined;
  hardwareConcurrency: number | undefined;
  deviceMemory?: number | undefined;
}): number {
  const { fileCount, totalInputBytes, fileSizes, userCap, hardwareConcurrency, deviceMemory } = input;
  if (fileCount <= 1) return 1;
  const cores = Math.max(1, Math.floor((hardwareConcurrency ?? 2) / 2));
  const budget = IN_FLIGHT_BUDGET_BYTES * deviceMemoryBudgetScale(deviceMemory);
  const normalizedSizes = fileSizes?.length === fileCount
    ? [...fileSizes].map((size) => Math.max(1, size)).sort((left, right) => right - left)
    : Array.from(
        { length: fileCount },
        () => Math.max(1, totalInputBytes > 0 ? totalInputBytes / fileCount : 1024),
      );
  const requestedLimit = userCap && userCap > 0 ? Math.floor(userCap) : fileCount;
  const candidateLimit = Math.min(fileCount, cores, Math.max(1, requestedLimit));
  let inFlightBytes = 0;
  let memoryCap = 1;
  for (let index = 0; index < candidateLimit; index += 1) {
    inFlightBytes +=
      WORKER_BASELINE_BYTES + normalizedSizes[index] * PEAK_AMPLIFICATION;
    if (inFlightBytes <= budget) {
      memoryCap = index + 1;
    } else {
      break;
    }
  }
  return Math.max(1, Math.min(fileCount, cores, memoryCap));
}

/** `navigator.deviceMemory` if the browser exposes it, else undefined. */
export function readDeviceMemory(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
}
