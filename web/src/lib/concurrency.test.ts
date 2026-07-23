import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
