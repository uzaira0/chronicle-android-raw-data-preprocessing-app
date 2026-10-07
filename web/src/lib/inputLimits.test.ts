import { describe, expect, it } from "vitest";

import { BROWSER_ENGINE_ROW_CEILING } from "@/lib/fileInspection";
import {
  MAX_RAW_INPUT_BYTES,
  admitRawFilesBySize,
  assertRawFileWithinLimit,
  rawFileSizeRefusal,
} from "@/lib/inputLimits";

describe("raw input size bound", () => {
  it("stays inside both measured limits from docs/perf/BASELINE.md", () => {
    // 580,793 rows were 110,463,056 bytes; the row ceiling at that density.
    const bytesPerRow = 110_463_056 / 580_793;
    expect(MAX_RAW_INPUT_BYTES).toBeLessThanOrEqual(BROWSER_ENGINE_ROW_CEILING * bytesPerRow);
    // 2.5 GiB of non-payload reserve at the measured ~14.4 bytes above budget per input byte.
    const aboveBudgetPerByte = (2_665_611_264 - 1024 ** 3) / 110_463_056;
    expect(MAX_RAW_INPUT_BYTES * aboveBudgetPerByte).toBeLessThan(2.5 * 1024 ** 3);
  });

  it("accepts a file at the bound and refuses one byte over with a plain message", () => {
    expect(rawFileSizeRefusal({ name: "P01.csv", size: MAX_RAW_INPUT_BYTES })).toBeNull();
    const refusal = rawFileSizeRefusal({ name: "P01.csv", size: MAX_RAW_INPUT_BYTES + 1 });
    expect(refusal).toContain("P01.csv is 180 MB, larger than the 180 MB");
    expect(refusal).toContain("Split the export into shorter date ranges");
  });

  it("throws the refusal right before a whole-file read", () => {
    expect(() => assertRawFileWithinLimit({ name: "big.csv", size: 250_000_000 })).toThrow(
      "big.csv is 250 MB",
    );
    expect(() => assertRawFileWithinLimit({ name: "ok.csv", size: 1_000 })).not.toThrow();
  });

  it("keeps the files that fit and names every one that does not", () => {
    const files = [
      { name: "a.csv", size: 10 },
      { name: "huge.csv", size: 400_000_000 },
      { name: "b.csv", size: 20 },
    ];
    const { accepted, refusals } = admitRawFilesBySize(files);
    expect(accepted.map((file) => file.name)).toEqual(["a.csv", "b.csv"]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("huge.csv is 400 MB");
  });
});
