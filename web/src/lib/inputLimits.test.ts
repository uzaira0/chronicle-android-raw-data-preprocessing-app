import { describe, expect, it } from "vitest";

import {
  WASM32_ADDRESS_SPACE_BYTES,
  WORKER_BYTES_PER_INPUT_BYTE,
  WORKER_HEADROOM_BYTES,
} from "@/lib/concurrency";
import { BROWSER_ENGINE_ROW_CEILING } from "@/lib/fileInspection";
import {
  MAX_RAW_INPUT_BYTES,
  admitRawFilesBySize,
  assertRawFileWithinLimit,
  outOfMemoryRefusal,
  rawFileSizeRefusal,
} from "@/lib/inputLimits";

describe("raw input size bound", () => {
  it("stays inside the measured limits from docs/perf/BASELINE.md", () => {
    // The TECH/GNSM preset at the bound, plus the headroom, fits 4 GiB.
    const presetPeak = 3_666_870_272 + WORKER_BYTES_PER_INPUT_BYTE * (MAX_RAW_INPUT_BYTES - 749_999_909);
    expect(presetPeak + WORKER_HEADROOM_BYTES).toBeLessThanOrEqual(WASM32_ADDRESS_SPACE_BYTES);
    // The real-layout export at the bound has no more rows than the row ceiling.
    expect(MAX_RAW_INPUT_BYTES * (4_384_636 / 749_999_909)).toBeLessThanOrEqual(BROWSER_ENGINE_ROW_CEILING);
  });

  it("accepts a file at the bound and refuses one byte over with a plain message", () => {
    expect(rawFileSizeRefusal({ name: "P01.csv", size: MAX_RAW_INPUT_BYTES })).toBeNull();
    const refusal = rawFileSizeRefusal({ name: "P01.csv", size: MAX_RAW_INPUT_BYTES + 1 });
    expect(refusal).toContain("P01.csv is 750 MB, larger than the 750 MB");
    expect(refusal).toContain("Split the export into shorter date ranges");
  });

  it("throws the refusal right before a whole-file read", () => {
    expect(() => assertRawFileWithinLimit({ name: "big.csv", size: 900_000_000 })).toThrow(
      "big.csv is 900 MB",
    );
    expect(() => assertRawFileWithinLimit({ name: "ok.csv", size: 1_000 })).not.toThrow();
  });

  it("keeps the files that fit and names every one that does not", () => {
    const files = [
      { name: "a.csv", size: 10 },
      { name: "huge.csv", size: 900_000_000 },
      { name: "b.csv", size: 20 },
    ];
    const { accepted, refusals } = admitRawFilesBySize(files);
    expect(accepted.map((file) => file.name)).toEqual(["a.csv", "b.csv"]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("huge.csv is 900 MB");
  });
});

describe("out-of-memory message", () => {
  const trap = new WebAssembly.RuntimeError("unreachable");

  it("names the file when a trap leaves the worker at the 4 GiB ceiling", () => {
    expect(outOfMemoryRefusal(trap, "big.csv", 4 * 1024 ** 3)).toContain(
      "big.csv ran out of memory",
    );
  });

  it("leaves every other failure alone", () => {
    expect(outOfMemoryRefusal(trap, "big.csv", 1024 ** 3)).toBeNull();
    expect(outOfMemoryRefusal(trap, "big.csv", null)).toBeNull();
    expect(outOfMemoryRefusal(new Error("boom"), "big.csv", 4 * 1024 ** 3)).toBeNull();
  });
});
