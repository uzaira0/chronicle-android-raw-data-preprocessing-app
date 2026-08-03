import { afterEach, describe, expect, it, vi } from "vitest";

import {
  computeAdaptiveLaneTarget,
  computeSafeComparisonPoolSize,
  computeSafeConcurrency,
  deviceMemoryBudgetScale,
  readDeviceMemory,
} from "@/lib/concurrency";

const MB = 1024 * 1024;

describe("deviceMemoryBudgetScale", () => {
  it("returns full budget when deviceMemory is unknown or high", () => {
    expect(deviceMemoryBudgetScale(undefined)).toBe(1);
    expect(deviceMemoryBudgetScale(8)).toBe(1);
    expect(deviceMemoryBudgetScale(16)).toBe(1);
  });

  it("tightens proportionally on low-memory devices, with a floor", () => {
    expect(deviceMemoryBudgetScale(4)).toBeCloseTo(0.5);
    expect(deviceMemoryBudgetScale(2)).toBeCloseTo(0.25);
    expect(deviceMemoryBudgetScale(1)).toBe(0.25); // floored
  });
});

describe("computeSafeConcurrency", () => {
  const base = {
    fileCount: 8,
    totalInputBytes: 8 * MB,
    userCap: undefined,
    hardwareConcurrency: 16,
  };

  it("single file is always serial", () => {
    expect(computeSafeConcurrency({ ...base, fileCount: 1 })).toBe(1);
  });

  it("treats a user-pinned cap as an upper bound without bypassing memory", () => {
    expect(computeSafeConcurrency({ ...base, userCap: 3, deviceMemory: 8 })).toBe(3);
    expect(computeSafeConcurrency({ ...base, userCap: 32, deviceMemory: 1 })).toBe(1);
  });

  it("never lets a user cap bypass the core limit", () => {
    expect(
      computeSafeConcurrency({ ...base, userCap: 32, hardwareConcurrency: 4, deviceMemory: 8 }),
    ).toBe(2);
  });

  it("a low-deviceMemory machine gets fewer workers than a high-memory one", () => {
    const high = computeSafeConcurrency({ ...base, deviceMemory: 8 });
    const low = computeSafeConcurrency({ ...base, deviceMemory: 2 });
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(1);
  });

  it("unknown deviceMemory matches the prior (full-budget) behavior", () => {
    const unknown = computeSafeConcurrency({ ...base, deviceMemory: undefined });
    const full = computeSafeConcurrency({ ...base, deviceMemory: 8 });
    expect(unknown).toBe(full);
  });

  it("never exceeds the file count", () => {
    expect(
      computeSafeConcurrency({
        fileCount: 2,
        totalInputBytes: 2 * 1024,
        userCap: undefined,
        hardwareConcurrency: 32,
        deviceMemory: 8,
      }),
    ).toBeLessThanOrEqual(2);
  });

  it("uses safe defaults when CPU and aggregate-size telemetry are absent", () => {
    expect(
      computeSafeConcurrency({
        fileCount: 4,
        totalInputBytes: 0,
        userCap: undefined,
        hardwareConcurrency: undefined,
        deviceMemory: 8,
      }),
    ).toBe(1);
  });

  it("uses the actual largest files instead of an unsafe batch average", () => {
    const fileSizes = [4 * MB, 1024, 1024, 1024, 1024, 1024, 1024, 1024];
    expect(
      computeSafeConcurrency({
        fileCount: fileSizes.length,
        totalInputBytes: fileSizes.reduce((sum, size) => sum + size, 0),
        fileSizes,
        userCap: undefined,
        hardwareConcurrency: 16,
        deviceMemory: 8,
      }),
    ).toBe(1);
  });
});

describe("computeAdaptiveLaneTarget", () => {
  const GB = 1024 * MB;

  it("stays on the static fallback until a measurement arrives", () => {
    expect(
      computeAdaptiveLaneTarget({
        laneCap: 8,
        observedWorkerHighWaterBytes: undefined,
        deviceMemory: 8,
        fallbackLanes: 1,
      }),
    ).toBe(1);
    expect(
      computeAdaptiveLaneTarget({
        laneCap: 8,
        observedWorkerHighWaterBytes: 0,
        deviceMemory: 8,
        fallbackLanes: 3,
      }),
    ).toBe(3);
    expect(
      computeAdaptiveLaneTarget({
        laneCap: 8,
        observedWorkerHighWaterBytes: Number.NaN,
        deviceMemory: 8,
        fallbackLanes: 2,
      }),
    ).toBe(2);
  });

  it("clamps the fallback into [1, laneCap]", () => {
    expect(
      computeAdaptiveLaneTarget({
        laneCap: 4,
        observedWorkerHighWaterBytes: undefined,
        deviceMemory: 8,
        fallbackLanes: 16,
      }),
    ).toBe(4);
    expect(
      computeAdaptiveLaneTarget({
        laneCap: 4,
        observedWorkerHighWaterBytes: undefined,
        deviceMemory: 8,
        fallbackLanes: 0,
      }),
    ).toBe(1);
  });

  it("converts a measured high-water into floor(budget / (highWater + baseline))", () => {
    // 4 GiB budget / (464 MiB + 48 MiB) = 8 lanes exactly.
    expect(
      computeAdaptiveLaneTarget({
        laneCap: 16,
        observedWorkerHighWaterBytes: 464 * MB,
        deviceMemory: 8,
        fallbackLanes: 1,
      }),
    ).toBe(8);
    // Slightly larger observation drops below the exact-fit boundary.
    expect(
      computeAdaptiveLaneTarget({
        laneCap: 16,
        observedWorkerHighWaterBytes: 464 * MB + 1,
        deviceMemory: 8,
        fallbackLanes: 1,
      }),
    ).toBe(7);
  });

  it("never exceeds laneCap even when the measurement is tiny", () => {
    expect(
      computeAdaptiveLaneTarget({
        laneCap: 5,
        observedWorkerHighWaterBytes: 1 * MB,
        deviceMemory: 8,
        fallbackLanes: 1,
      }),
    ).toBe(5);
  });

  it("never drops below one lane even for a giant measurement", () => {
    expect(
      computeAdaptiveLaneTarget({
        laneCap: 8,
        observedWorkerHighWaterBytes: 16 * GB,
        deviceMemory: 8,
        fallbackLanes: 4,
      }),
    ).toBe(1);
  });

  it("scales the budget down through deviceMemoryBudgetScale on low-memory devices", () => {
    const input = {
      laneCap: 16,
      observedWorkerHighWaterBytes: 464 * MB,
      fallbackLanes: 1,
    };
    // 8 GiB (and unknown) → full 4 GiB budget → 8 lanes.
    expect(computeAdaptiveLaneTarget({ ...input, deviceMemory: 8 })).toBe(8);
    expect(computeAdaptiveLaneTarget({ ...input, deviceMemory: undefined })).toBe(8);
    // 4 GiB device → half budget → 4 lanes; 1 GiB device → floored 0.25 → 2 lanes.
    expect(computeAdaptiveLaneTarget({ ...input, deviceMemory: 4 })).toBe(4);
    expect(computeAdaptiveLaneTarget({ ...input, deviceMemory: 1 })).toBe(2);
  });
});

describe("readDeviceMemory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns navigator.deviceMemory when the browser exposes it", () => {
    vi.stubGlobal("navigator", { deviceMemory: 4 });
    expect(readDeviceMemory()).toBe(4);
  });

  it("returns undefined when navigator is unavailable", () => {
    vi.stubGlobal("navigator", undefined);
    expect(readDeviceMemory()).toBeUndefined();
  });
});

describe("computeSafeComparisonPoolSize", () => {
  it("returns 0 when there are no unique files", () => {
    expect(
      computeSafeComparisonPoolSize({
        uniqueFileCount: 0,
        hardCap: 7,
        deviceMemory: 8,
      }),
    ).toBe(0);
  });

  it("respects the hard cap", () => {
    expect(
      computeSafeComparisonPoolSize({
        uniqueFileCount: 100,
        hardCap: 7,
        deviceMemory: 8,
      }),
    ).toBe(7);
  });

  it("caps to unique file count when fewer than hard cap", () => {
    expect(
      computeSafeComparisonPoolSize({
        uniqueFileCount: 3,
        hardCap: 7,
        deviceMemory: 8,
      }),
    ).toBe(3);
  });

  it("reduces pool size on a low-memory device", () => {
    const highMem = computeSafeComparisonPoolSize({
      uniqueFileCount: 100,
      hardCap: 16,
      deviceMemory: 8,
    });
    const lowMem = computeSafeComparisonPoolSize({
      uniqueFileCount: 100,
      hardCap: 16,
      deviceMemory: 2,
    });
    expect(lowMem).toBeLessThan(highMem);
    expect(lowMem).toBeGreaterThanOrEqual(1);
  });

  it("defaults to 8 GiB when deviceMemory is unknown", () => {
    const withMemory = computeSafeComparisonPoolSize({
      uniqueFileCount: 100,
      hardCap: 16,
      deviceMemory: 8,
    });
    const withoutMemory = computeSafeComparisonPoolSize({
      uniqueFileCount: 100,
      hardCap: 16,
      deviceMemory: undefined,
    });
    expect(withoutMemory).toBe(withMemory);
  });
});
