import { describe, expect, it, vi } from "vitest";

import {
  PartialComparisonFailureError,
  comparisonFailure,
  partialComparisonFailureFromError,
} from "@/lib/comparisonFailures";
import {
  completeMaximumDurationVector,
  isValidMaximumDurationSelectionShape,
} from "@/lib/maximumDurationVector";
import { withParticipantPartitionLane } from "@/lib/participantPartitionLane";
import { resolveRetryExecutionBinding } from "@/lib/retryExecutionBinding";
import {
  rehydrateScientificPreflightRefusal,
  scientificPreflightReceiptFromError,
  serializeScientificPreflightRefusal,
  throwSerializableScientificPreflightRefusal,
} from "@/lib/scientificPreflightTransport";
import {
  runtimeScientificPreflightFixture,
} from "@/testSupport/runtimeScientificPreflightFixture";

/**
 * The small runtime helpers around the worker boundary: the comparison-failure
 * envelope, the Comlink transport for a scientific-preflight refusal, the
 * retry binding selector, the B10 maximum-duration vector rules from the LinkML
 * contract, and the participant-partition lane that owns the ephemeral batch
 * secret.
 */

function refusalError(message = "Scientific preflight refused (B05).") {
  const error = new Error(message);
  Object.defineProperties(error, {
    code: { value: "scientific_preflight_refused", enumerable: true },
    receipt: { value: runtimeScientificPreflightFixture(), enumerable: true },
  });
  return error;
}

describe("scientific preflight transport", () => {
  it.each([
    ["a plain error", new Error("boom")],
    ["a non-object", "boom"],
    ["null", null],
    ["an object with no refusal code", { receipt: {} }],
  ])("reads no receipt out of %s", (_label, candidate) => {
    expect(scientificPreflightReceiptFromError(candidate)).toBeUndefined();
    expect(serializeScientificPreflightRefusal(candidate)).toBeNull();
  });

  it("reads the receipt back out of a refusal error", () => {
    expect(scientificPreflightReceiptFromError(refusalError())).toEqual(
      runtimeScientificPreflightFixture(),
    );
  });

  it("serializes a refusal into a structured-cloneable envelope", () => {
    expect(serializeScientificPreflightRefusal(refusalError("refused"))).toEqual({
      kind: "chronicle-scientific-preflight-refusal/v1",
      message: "refused",
      receipt: runtimeScientificPreflightFixture(),
    });
  });

  it("rehydrates that envelope into a typed refusal error", () => {
    const envelope = serializeScientificPreflightRefusal(refusalError("refused"));
    const hydrated = rehydrateScientificPreflightRefusal(envelope);
    expect(hydrated).toBeInstanceOf(Error);
    expect((hydrated as Error).name).toBe("RustScientificPreflightRefusalError");
    expect(scientificPreflightReceiptFromError(hydrated)).toEqual(
      runtimeScientificPreflightFixture(),
    );
  });

  it.each([
    ["an error that is not an envelope", new Error("boom")],
    ["a non-object", "boom"],
    ["null", null],
    ["an envelope of another kind", { kind: "other", message: "m", receipt: {} }],
  ])("passes %s through unchanged", (_label, candidate) => {
    expect(rehydrateScientificPreflightRefusal(candidate)).toBe(candidate);
  });

  it("throws the envelope for a refusal and the original error otherwise", () => {
    expect(() => throwSerializableScientificPreflightRefusal(refusalError())).toThrow(
      expect.objectContaining({ kind: "chronicle-scientific-preflight-refusal/v1" }),
    );
    const plain = new Error("boom");
    expect(() => throwSerializableScientificPreflightRefusal(plain)).toThrow(plain);
  });
});

describe("comparison failures", () => {
  it("wraps a thrown non-error as its string message", () => {
    const failure = comparisonFailure(["Raw P01.csv"], "disk went away");
    expect(failure).toMatchObject({
      fileNames: ["Raw P01.csv"],
      message: "disk went away",
    });
    expect(failure.cause).toBeInstanceOf(Error);
    expect(failure.scientificPreflightRefusal).toBeUndefined();
  });

  it("carries a scientific preflight refusal receipt onto the failure", () => {
    expect(
      comparisonFailure(["Raw P01.csv"], refusalError()).scientificPreflightRefusal,
    ).toEqual(runtimeScientificPreflightFixture());
  });

  it("counts one compared file in the singular and promotes the first refusal", () => {
    const error = new PartialComparisonFailureError(
      [comparisonFailure(["Raw P02.csv"], refusalError("refused"))],
      [{ fileName: "Raw P01.csv" } as never],
    );
    expect(error.message).toBe("Compared 1 file; 1 failed. refused");
    expect(error.code).toBe("scientific_preflight_refused");
    expect(error.receipt).toEqual(runtimeScientificPreflightFixture());
    expect(partialComparisonFailureFromError(error)).toBe(error);
  });

  it("reports no failure message and no refusal when nothing failed", () => {
    const error = new PartialComparisonFailureError([], []);
    expect(error.message).toBe("Compared 0 files; 0 failed. Unknown comparison failure.");
    expect(error.code).toBeUndefined();
    expect(error.receipt).toBeUndefined();
  });

  it.each([
    ["a plain error", new Error("boom")],
    ["a non-error", "boom"],
  ])("recognizes %s as something other than a partial failure", (_label, candidate) => {
    expect(partialComparisonFailureFromError(candidate)).toBeUndefined();
  });
});

describe("retry execution binding", () => {
  const binding = { options: { minimumUsageDuration: 60 } } as never;

  it("resolves the current binding only when there is no prior attempt", async () => {
    const resolveCurrent = vi.fn().mockResolvedValue(binding);
    await expect(resolveRetryExecutionBinding(0, null, null, resolveCurrent)).resolves.toBe(
      binding,
    );
    expect(resolveCurrent).toHaveBeenCalledOnce();
  });

  it("refuses to resolve live state when a prior attempt exists without its binding", async () => {
    const resolveCurrent = vi.fn();
    await expect(
      resolveRetryExecutionBinding(1, null, null, resolveCurrent),
    ).rejects.toThrow(
      "The exact binding for this prior attempt is unavailable; run the full batch again before retrying a file.",
    );
    expect(resolveCurrent).not.toHaveBeenCalled();
  });

  it("refuses a prior binding whose options are not the options that ran", async () => {
    await expect(
      resolveRetryExecutionBinding(
        1,
        { minimumUsageDuration: 120 } as never,
        binding,
        vi.fn(),
      ),
    ).rejects.toThrow(
      "The exact binding for this prior attempt is unavailable; run the full batch again before retrying a file.",
    );
  });

  it("returns the prior binding when its options are exactly the options that ran", async () => {
    await expect(
      resolveRetryExecutionBinding(
        1,
        { minimumUsageDuration: 60 } as never,
        binding,
        vi.fn(),
      ),
    ).resolves.toBe(binding);
  });
});

describe("maximum duration vector shape", () => {
  it("accepts a vector that declares nothing", () => {
    expect(
      isValidMaximumDurationSelectionShape({
        maximumDurationPolicy: undefined,
        maximumDurationDisposition: undefined,
        maximumDurationThresholdSource: undefined,
        maximumDurationThresholdNs: undefined,
      }),
    ).toBe(true);
  });

  it.each([
    [
      "a strict-max policy with an adaptive source and no threshold",
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "drop",
        maximumDurationThresholdSource: "b12_adaptive_participant",
        maximumDurationThresholdNs: undefined,
      },
      true,
    ],
    [
      "a strict-max policy left not applicable",
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "not_applicable",
        maximumDurationThresholdSource: "fixed_parameter",
        maximumDurationThresholdNs: "21600000000000",
      },
      false,
    ],
    [
      "a strict-max policy with an adaptive source that still names a threshold",
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "drop",
        maximumDurationThresholdSource: "b12_adaptive_participant",
        maximumDurationThresholdNs: "21600000000000",
      },
      false,
    ],
    [
      "a strict-max policy with a legacy source",
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "drop",
        maximumDurationThresholdSource: "chronicle_legacy_config",
        maximumDurationThresholdNs: undefined,
      },
      false,
    ],
    [
      "a policy outside the contract's vocabulary",
      {
        maximumDurationPolicy: "invented_policy",
        maximumDurationDisposition: "drop",
        maximumDurationThresholdSource: "fixed_parameter",
        maximumDurationThresholdNs: "21600000000000",
      },
      false,
    ],
    [
      "a policy declared without its sibling source",
      {
        maximumDurationPolicy: "strategy_native",
        maximumDurationDisposition: "not_applicable",
        maximumDurationThresholdSource: undefined,
        maximumDurationThresholdNs: undefined,
      },
      false,
    ],
  ] as Array<[string, Record<string, unknown>, boolean]>)(
    "reports %s as %s",
    (_label, vector, valid) => {
      expect(isValidMaximumDurationSelectionShape(vector as never)).toBe(valid);
    },
  );

  it.each([
    ["maximumDurationPolicy", undefined],
    ["maximumDurationDisposition", undefined],
    ["maximumDurationThresholdSource", undefined],
    ["maximumDurationThresholdNs", undefined],
  ])("clears the whole vector when %s is cleared", (key, value) => {
    expect(
      completeMaximumDurationVector(
        {
          maximumDurationPolicy: "post_reconstruction_strict_max_v1",
          maximumDurationDisposition: "drop",
          maximumDurationThresholdSource: "fixed_parameter",
          maximumDurationThresholdNs: "21600000000000",
        } as never,
        key as never,
        value,
      ),
    ).toEqual({
      maximumDurationPolicy: undefined,
      maximumDurationDisposition: undefined,
      maximumDurationThresholdSource: undefined,
      maximumDurationThresholdNs: undefined,
    });
  });

  it.each([
    ["maximumDurationPolicy", "invented_policy"],
    ["maximumDurationThresholdSource", "invented_source"],
  ])("keeps only the unrecognized %s and clears its siblings", (key, value) => {
    expect(
      completeMaximumDurationVector(
        {
          maximumDurationPolicy: "strategy_native",
          maximumDurationDisposition: "not_applicable",
          maximumDurationThresholdSource: "strategy_native",
          maximumDurationThresholdNs: undefined,
        } as never,
        key as never,
        value,
      ),
    ).toEqual({
      maximumDurationPolicy: undefined,
      maximumDurationDisposition: undefined,
      maximumDurationThresholdSource: undefined,
      maximumDurationThresholdNs: undefined,
      [key]: value,
    });
  });
});

describe("participant partition lane", () => {
  const operations = () => ({
    begin: vi.fn().mockResolvedValue("sha256:batch"),
    register: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  });
  const partition = { participantPartitionBatchId: "sha256:batch" } as never;

  it("runs an unpartitioned execution on the serialized runtime lane", async () => {
    const execute = vi.fn().mockResolvedValue("done");
    await expect(
      withParticipantPartitionLane({
        csvBytes: new Uint8Array(),
        partition: undefined,
        secretBuffer: undefined,
        operations: operations(),
        execute,
      }),
    ).resolves.toBe("done");
    expect(execute).toHaveBeenCalledWith(undefined);
  });

  it("refuses a secret handed over without partition metadata and zeroes it", async () => {
    const secretBuffer = new ArrayBuffer(32);
    new Uint8Array(secretBuffer).fill(7);
    await expect(
      withParticipantPartitionLane({
        csvBytes: new Uint8Array(),
        partition: undefined,
        secretBuffer,
        operations: operations(),
        execute: vi.fn(),
      }),
    ).rejects.toThrow(
      "participant partition secret was supplied without partition metadata",
    );
    expect([...new Uint8Array(secretBuffer)].every((byte) => byte === 0)).toBe(true);
  });

  it("refuses partition metadata with no batch secret", async () => {
    await expect(
      withParticipantPartitionLane({
        csvBytes: new Uint8Array(),
        partition,
        secretBuffer: undefined,
        operations: operations(),
        execute: vi.fn(),
      }),
    ).rejects.toThrow(
      "participant partition execution requires its ephemeral batch secret",
    );
  });

  it("refuses a secret that is not exactly 32 bytes and zeroes it", async () => {
    const secretBuffer = new ArrayBuffer(31);
    new Uint8Array(secretBuffer).fill(7);
    await expect(
      withParticipantPartitionLane({
        csvBytes: new Uint8Array(),
        partition,
        secretBuffer,
        operations: operations(),
        execute: vi.fn(),
      }),
    ).rejects.toThrow("participant partition secret must contain exactly 32 bytes");
    expect([...new Uint8Array(secretBuffer)].every((byte) => byte === 0)).toBe(true);
  });

  it("refuses a batch the kernel minted under a different identity and disposes it", async () => {
    const lane = operations();
    lane.begin.mockResolvedValue("sha256:other");
    await expect(
      withParticipantPartitionLane({
        csvBytes: new Uint8Array(),
        partition,
        secretBuffer: new ArrayBuffer(32),
        operations: lane,
        execute: vi.fn(),
      }),
    ).rejects.toThrow("participant partition batch identity mismatch");
    expect(lane.dispose).toHaveBeenCalledWith("sha256:other");
  });

  it("registers the partition artifact and disposes the batch after execution", async () => {
    const lane = operations();
    const csvBytes = new TextEncoder().encode("study_id\nS1\n");
    const execute = vi.fn().mockResolvedValue("done");
    await expect(
      withParticipantPartitionLane({
        csvBytes,
        partition,
        secretBuffer: new ArrayBuffer(32),
        operations: lane,
        execute,
      }),
    ).resolves.toBe("done");
    expect(lane.register).toHaveBeenCalledWith(csvBytes, "sha256:batch");
    expect(execute).toHaveBeenCalledWith(partition);
    expect(lane.dispose).toHaveBeenCalledWith("sha256:batch");
  });
});
