import { describe, expect, it } from "vitest";

import {
  formatBytes,
  isStoragePressureHigh,
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
