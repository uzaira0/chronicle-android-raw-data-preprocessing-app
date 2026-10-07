import { describe, expect, it } from "vitest";

import {
  rehydrateScientificPreflightRefusal,
  scientificPreflightReceiptFromError,
  serializeScientificPreflightRefusal,
} from "@/lib/scientificPreflightTransport";
import type { RuntimeScientificPreflightReceipt } from "@/lib/generatedRuntimeBoundary";
import { runtimeScientificPreflightFixture } from "@/testSupport/runtimeScientificPreflightFixture";

describe("scientific preflight transport", () => {
  it("preserves the exact typed receipt through a structured-cloneable throw", () => {
    const receipt = runtimeScientificPreflightFixture();
    const error = Object.assign(new Error("typed refusal"), {
      code: "scientific_preflight_refused",
      receipt,
    });
    const transported = serializeScientificPreflightRefusal(error);
    expect(structuredClone(transported)).toEqual(transported);
    const hydrated = rehydrateScientificPreflightRefusal(
      structuredClone(transported),
    ) as Error & { code: string; receipt: RuntimeScientificPreflightReceipt };
    expect(hydrated).toBeInstanceOf(Error);
    expect(hydrated.code).toBe("scientific_preflight_refused");
    expect(hydrated.receipt).toEqual(receipt);
    expect(scientificPreflightReceiptFromError(hydrated)).toEqual(receipt);
  });

  it.each([
    ["missing fields", {}],
    [
      "old protocol",
      {
        ...runtimeScientificPreflightFixture(),
        protocolVersion: "chronicle-runtime-scientific-preflight/v1",
      },
    ],
    [
      "unexpected field",
      { ...runtimeScientificPreflightFixture(), participantIds: ["P01"] },
    ],
    [
      "nested unexpected field",
      {
        ...runtimeScientificPreflightFixture(),
        key: {
          ...runtimeScientificPreflightFixture().key,
          participantIds: ["P01"],
        },
      },
    ],
  ])("rejects %s as a generic boundary error", (_label, receipt) => {
    const transported = structuredClone({
      kind: "chronicle-scientific-preflight-refusal/v1",
      message: "typed refusal",
      receipt,
    });
    expect(() => rehydrateScientificPreflightRefusal(transported)).toThrow(
      /runtime manifest contract violation/,
    );
    expect(() =>
      scientificPreflightReceiptFromError({
        code: "scientific_preflight_refused",
        receipt,
      }),
    ).toThrow(/runtime manifest contract violation/);
  });
});
