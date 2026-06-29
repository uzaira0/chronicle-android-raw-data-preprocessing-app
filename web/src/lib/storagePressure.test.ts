import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
});
