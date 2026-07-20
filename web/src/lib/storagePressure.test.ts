import { afterEach, describe, expect, it, vi } from "vitest";

import {
  estimateStoragePressure,
  formatBytes,
  isStoragePressureHigh,
  requestPersistentStorage,
  STORAGE_PRESSURE_THRESHOLD,
} from "@/lib/storagePressure";

describe("storagePressure", () => {
  it("flags pressure only at/above the threshold with a real estimate", () => {
    expect(
      isStoragePressureHigh({ usage: 90, quota: 100, ratio: 0.9, supported: true }),
    ).toBe(true);
    expect(
      isStoragePressureHigh({ usage: 50, quota: 100, ratio: 0.5, supported: true }),
    ).toBe(false);
    // Exactly at threshold counts.
    expect(
      isStoragePressureHigh({
        usage: STORAGE_PRESSURE_THRESHOLD * 100,
        quota: 100,
        ratio: STORAGE_PRESSURE_THRESHOLD,
        supported: true,
      }),
    ).toBe(true);
  });

  it("never flags when the browser gave no usable estimate", () => {
    expect(isStoragePressureHigh({ usage: 0, quota: 0, ratio: 0, supported: false })).toBe(false);
    expect(isStoragePressureHigh({ usage: 99, quota: 0, ratio: 0, supported: true })).toBe(false);
  });

  it("formats bytes compactly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });
});

describe("requestPersistentStorage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, "storage");
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "storage", original);
    vi.restoreAllMocks();
  });

  function stubStorage(value: unknown): void {
    Object.defineProperty(navigator, "storage", { configurable: true, value });
  }

  it("requests persistence when not already persistent", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("does not re-request when storage is already persistent", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("resolves false (no throw) when the API is unavailable", async () => {
    stubStorage({});
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it("resolves false when the browser throws on persist", async () => {
    stubStorage({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockRejectedValue(new Error("denied")),
    });
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});

describe("estimateStoragePressure", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, "storage");
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "storage", original);
    vi.restoreAllMocks();
  });

  function stubStorage(value: unknown): void {
    Object.defineProperty(navigator, "storage", { configurable: true, value });
  }

  it("reports usage/quota/ratio from a real estimate", async () => {
    stubStorage({ estimate: () => Promise.resolve({ usage: 80, quota: 100 }) });
    await expect(estimateStoragePressure()).resolves.toEqual({
      usage: 80,
      quota: 100,
      ratio: 0.8,
      supported: true,
    });
  });

  it("defaults missing usage/quota to zero (ratio stays 0 on zero quota)", async () => {
    stubStorage({ estimate: () => Promise.resolve({}) });
    await expect(estimateStoragePressure()).resolves.toEqual({
      usage: 0,
      quota: 0,
      ratio: 0,
      supported: true,
    });
  });

  it("returns the unsupported shape when the API is missing or throws", async () => {
    const empty = { usage: 0, quota: 0, ratio: 0, supported: false };
    stubStorage({});
    await expect(estimateStoragePressure()).resolves.toEqual(empty);
    stubStorage({
      estimate: () => Promise.reject(new Error("blocked")),
    });
    await expect(estimateStoragePressure()).resolves.toEqual(empty);
  });
});
