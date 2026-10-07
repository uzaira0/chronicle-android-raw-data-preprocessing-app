import { describe, expect, it } from "vitest";

import {
  comparisonFailure,
  PartialComparisonFailureError,
} from "@/lib/comparisonFailures";
import { rehydrateScientificPreflightRefusal } from "@/lib/scientificPreflightTransport";
import { runtimeScientificRefusalFixture } from "@/testSupport/runtimeScientificPreflightFixture";
import type { ProcessedFileResult } from "@/lib/types";

describe("comparison failure preservation", () => {
  it("keeps the exact refusal for every failed digest group and partial result", () => {
    const firstReceipt = runtimeScientificRefusalFixture();
    const secondReceipt = {
      ...runtimeScientificRefusalFixture(),
      commitDigest: `sha256:${"9".repeat(64)}`,
    };
    const transported = (receipt: typeof firstReceipt) =>
      rehydrateScientificPreflightRefusal({
        kind: "chronicle-scientific-preflight-refusal/v1",
        message: "refused",
        receipt,
      });
    const failures = [
      comparisonFailure(["a.csv"], transported(firstReceipt)),
      comparisonFailure(["b.csv", "copy.csv"], transported(secondReceipt)),
    ];
    const partial = [
      { inputFileName: "ok.csv" } as ProcessedFileResult,
    ];
    const error = new PartialComparisonFailureError(failures, partial);
    expect(error.partialResults).toBe(partial);
    expect(error.receipt).toEqual(firstReceipt);
    expect(error.failures.map((failure) => failure.fileNames)).toEqual([
      ["a.csv"],
      ["b.csv", "copy.csv"],
    ]);
    expect(error.failures[1]?.scientificPreflightRefusal).toEqual(
      secondReceipt,
    );
  });

  it("keeps both exact receipts when every digest group is refused", () => {
    const firstReceipt = runtimeScientificRefusalFixture();
    const secondReceipt = {
      ...runtimeScientificRefusalFixture(),
      commitDigest: `sha256:${"8".repeat(64)}`,
    };
    const transported = (receipt: typeof firstReceipt) =>
      rehydrateScientificPreflightRefusal({
        kind: "chronicle-scientific-preflight-refusal/v1",
        message: "refused",
        receipt,
      });
    const error = new PartialComparisonFailureError(
      [
        comparisonFailure(["a.csv"], transported(firstReceipt)),
        comparisonFailure(["b.csv"], transported(secondReceipt)),
      ],
      [],
    );
    expect(error.partialResults).toEqual([]);
    expect(
      error.failures.map(({ scientificPreflightRefusal }) =>
        scientificPreflightRefusal?.commitDigest,
      ),
    ).toEqual([firstReceipt.commitDigest, secondReceipt.commitDigest]);
  });
});
