import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginRustRawInspectionBatch,
  disposeRustRawInspectionBatch,
  getComparisonCacheRetained,
  inspectRustRawFile,
  registerRustRawParticipantPartitionArtifact,
  setComparisonCacheCapacity,
  setRustRuntimeForTesting,
} from "@/lib/rustPipelineRuntime";

/**
 * These four exports are the browser worker's only door to the kernel's
 * participant-partition batch boundary (`src/workers/chronicle-worker.ts`
 * re-exports them). Each one probes for its optional wasm-bindgen export and
 * fails closed by name when a runtime predating that boundary is loaded, which
 * is the behaviour asserted here. The kernel is injected through the module's
 * own `setRustRuntimeForTesting` seam so the absent-export arm is reachable.
 */
type PartialKernel = Parameters<typeof setRustRuntimeForTesting>[0];

function kernel(overrides: Record<string, unknown>): PartialKernel {
  return overrides as unknown as PartialKernel;
}

afterEach(() => {
  setRustRuntimeForTesting(kernel({}));
});

describe("raw inspection batch boundary", () => {
  it("requires exactly 32 secret bytes before it reaches the kernel", async () => {
    const beginBatch = vi.fn(() => "batch-1");
    setRustRuntimeForTesting(kernel({ begin_raw_inspection_batch: beginBatch }));
    await expect(
      beginRustRawInspectionBatch(new Uint8Array(31)),
    ).rejects.toThrow("raw inspection batch requires exactly 32 secret bytes");
    await expect(
      beginRustRawInspectionBatch(new Uint8Array(33)),
    ).rejects.toThrow("raw inspection batch requires exactly 32 secret bytes");
    expect(beginBatch).not.toHaveBeenCalled();
  });

  it("returns the batch id the kernel mints for a 32-byte secret", async () => {
    const secret = new Uint8Array(32).fill(7);
    const beginBatch = vi.fn(() => "batch-42");
    setRustRuntimeForTesting(kernel({ begin_raw_inspection_batch: beginBatch }));
    await expect(beginRustRawInspectionBatch(secret)).resolves.toBe("batch-42");
    expect(beginBatch).toHaveBeenCalledWith(secret);
  });

  it("fails closed when the loaded runtime has no batch boundary", async () => {
    setRustRuntimeForTesting(kernel({}));
    await expect(
      beginRustRawInspectionBatch(new Uint8Array(32)),
    ).rejects.toThrow(
      "runtime WASM does not expose the v2 raw-inspection batch boundary",
    );
  });

  it("returns the kernel's disposal verdict for a known batch", async () => {
    const disposeBatch = vi.fn(() => true);
    setRustRuntimeForTesting(
      kernel({ dispose_raw_inspection_batch: disposeBatch }),
    );
    await expect(disposeRustRawInspectionBatch("batch-42")).resolves.toBe(true);
    expect(disposeBatch).toHaveBeenCalledWith("batch-42");
  });

  it("reports false when the kernel does not know the batch", async () => {
    setRustRuntimeForTesting(
      kernel({ dispose_raw_inspection_batch: () => false }),
    );
    await expect(disposeRustRawInspectionBatch("batch-absent")).resolves.toBe(
      false,
    );
  });

  it("fails closed when disposal has no batch boundary to call", async () => {
    setRustRuntimeForTesting(kernel({}));
    await expect(disposeRustRawInspectionBatch("batch-42")).rejects.toThrow(
      "runtime WASM does not expose the v2 raw-inspection batch boundary",
    );
  });

  it("hands the partition artifact and its batch id to the kernel", async () => {
    const registerArtifact = vi.fn();
    const csvBytes = new TextEncoder().encode("study_id\nS1\n");
    setRustRuntimeForTesting(
      kernel({ register_raw_participant_partition_artifact: registerArtifact }),
    );
    await expect(
      registerRustRawParticipantPartitionArtifact(csvBytes, "batch-42"),
    ).resolves.toBeUndefined();
    expect(registerArtifact).toHaveBeenCalledWith(csvBytes, "batch-42");
  });

  it("fails closed when the participant-partition boundary is absent", async () => {
    setRustRuntimeForTesting(kernel({}));
    await expect(
      registerRustRawParticipantPartitionArtifact(new Uint8Array(), "batch-42"),
    ).rejects.toThrow(
      "runtime WASM does not expose the v2 participant-partition boundary",
    );
  });

  it("refuses a batch-scoped inspection on a runtime with only the v1 boundary", async () => {
    setRustRuntimeForTesting(kernel({ inspect_raw_file_v1: () => "{}" }));
    await expect(
      inspectRustRawFile(new Uint8Array(), "Raw P01.csv", 0, "batch-42"),
    ).rejects.toThrow(
      "runtime WASM does not expose the v2 raw-inspection boundary",
    );
  });
});

describe("comparison cache controls", () => {
  it("passes the capacity through to the kernel", async () => {
    const setCapacity = vi.fn();
    setRustRuntimeForTesting(
      kernel({ set_comparison_cache_capacity: setCapacity }),
    );
    await expect(setComparisonCacheCapacity(5)).resolves.toBeUndefined();
    expect(setCapacity).toHaveBeenCalledWith(5);
  });

  it("returns the kernel's retained-entry count", async () => {
    setRustRuntimeForTesting(
      kernel({ get_comparison_cache_retained: () => 3 }),
    );
    await expect(getComparisonCacheRetained()).resolves.toBe(3);
  });
});
