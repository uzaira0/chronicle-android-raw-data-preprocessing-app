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
/**
 * Full-processing amplification only. Review-materialization dispatch (the
 * View-tab A/B comparison pool) measures far lower and must not be routed
 * through this constant: 2026-07-28 verify-many-files receipts over distinct
 * 19 MB inputs put a cold review worker at ~124 MB process-tree RSS
 * (~6.6x input; 8 workers added 0.99 GB over the processing-only peak) and a
 * warm salsa-memory repeat worker at ~38 MB (~2x). Governing the comparison
 * pool with 128x would cut it from 8 workers to 1 and the measured ~6.6x
 * under the 600 MB budget would still cap it at 3 — a wall-clock regression
 * with no measured safety need, so that dispatch stays ungoverned.
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
      WORKER_BASELINE_BYTES + (normalizedSizes[index] ?? 0) * PEAK_AMPLIFICATION;
    if (inFlightBytes <= budget) {
      memoryCap = index + 1;
    } else {
      break;
    }
  }
  return Math.max(1, Math.min(fileCount, cores, memoryCap));
}

const WARM_REVIEW_WORKER_BYTES = 38 * 1024 * 1024;
const COMPARISON_BUDGET_FRACTION = 0.15;

export function computeSafeComparisonPoolSize(input: {
  uniqueFileCount: number;
  hardCap: number;
  deviceMemory: number | undefined;
}): number {
  const { uniqueFileCount, hardCap, deviceMemory } = input;
  if (uniqueFileCount <= 0) return 0;
  const reportedGiB = deviceMemory && deviceMemory > 0 ? deviceMemory : 8;
  const comparisonBudget =
    reportedGiB * 1024 * 1024 * 1024 * COMPARISON_BUDGET_FRACTION;
  const memoryLimit = Math.max(
    1,
    Math.floor(comparisonBudget / (WARM_REVIEW_WORKER_BYTES + WORKER_BASELINE_BYTES)),
  );
  return Math.min(uniqueFileCount, hardCap, memoryLimit);
}

/** `navigator.deviceMemory` if the browser exposes it, else undefined. */
export function readDeviceMemory(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
}

/**
 * Worker-heap budget on the 8-GiB `deviceMemory` baseline for the measured
 * (adaptive) admission path. An 8-GiB device keeps roughly half its RAM for
 * the OS, the browser, and this page's main thread; the other half can hold
 * batch-worker WASM heaps. Devices reporting less memory scale down through
 * `deviceMemoryBudgetScale`; Chromium clamps reports at 8, so machines with
 * more RAM are still treated as 8-GiB — the platform hides real capacity.
 */
const ADAPTIVE_WORKER_BUDGET_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * Measured admission control for the full-processing batch. The static
 * `computeSafeConcurrency` guess uses the worst-case 128x amplification and
 * admits one 19 MB file at a time; workers report their actual WASM
 * linear-memory high-water after each completed file (WASM memory never
 * shrinks, so `memory.buffer.byteLength` IS the high-water), and this
 * function converts that observation into how many lanes fit the budget.
 * Before the first observation (`observedWorkerHighWaterBytes` undefined)
 * the static result stays authoritative via `fallbackLanes`.
 */
export function computeAdaptiveLaneTarget(input: {
  /** min(fileCount, hardwareConcurrency/2, user cap) — never exceeded. */
  laneCap: number;
  /** Largest worker WASM memory observed so far this batch, in bytes. */
  observedWorkerHighWaterBytes: number | undefined;
  deviceMemory: number | undefined;
  /** Pre-measurement lane count (the static governor's answer). */
  fallbackLanes: number;
}): number {
  const { laneCap, observedWorkerHighWaterBytes, deviceMemory, fallbackLanes } =
    input;
  const cap = Math.max(1, Math.floor(laneCap));
  if (
    observedWorkerHighWaterBytes === undefined ||
    !Number.isFinite(observedWorkerHighWaterBytes) ||
    observedWorkerHighWaterBytes <= 0
  ) {
    return Math.max(1, Math.min(cap, Math.floor(fallbackLanes)));
  }
  const budget =
    ADAPTIVE_WORKER_BUDGET_BYTES * deviceMemoryBudgetScale(deviceMemory);
  const perLane = observedWorkerHighWaterBytes + WORKER_BASELINE_BYTES;
  return Math.max(1, Math.min(cap, Math.floor(budget / perLane)));
}
