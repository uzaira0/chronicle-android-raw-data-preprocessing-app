import { describe, expect, it } from "vitest";

import type {
  MaximumDurationApplicability,
  MaximumDurationPreflightDecision,
  OpenerSetPreflightDecision,
} from "@/lib/generatedRuntimeBoundary";
import {
  RustMaximumDurationRefusalError,
  RustOpenerSetRefusalError,
  RustScientificPreflightRefusalError,
  decodeMaximumDurationPreflightDecision,
  decodeOpenerSetPreflightDecision,
  isExplicitMaximumDurationSelection,
  buildMaximumDurationRequestFields,
} from "@/lib/rustPipelineRuntime";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  runtimeScientificPreflightFixture,
  runtimeScientificRefusalFixture,
} from "@/testSupport/runtimeScientificPreflightFixture";

const DIGEST = `sha256:${"c".repeat(64)}`;
it.each([[Infinity, "Infinity"], [-Infinity, "-Infinity"], [NaN, "NaN"], [0, "0"], [-0, "0"]] as const)("retains the explicit legacy maximum-duration input %s for kernel refusal", (hours, spelling) => {
  expect(buildMaximumDurationRequestFields({ ...DEFAULT_BROWSER_OPTIONS, maximumDurationPolicy: "post_reconstruction_strict_max_v1", longDurationThresholdHours: hours })).toMatchObject({
    b06_legacy_threshold_hours_canonical: spelling, b06_legacy_threshold_ns_canonical: spelling,
  });
});

/**
 * Field-complete `OpenerSetPreflightDecision` as `generatedRuntimeBoundary.ts`
 * declares it. `decodeOpenerSetPreflightDecision` runs the generated struct
 * decoder first, so a partial object would fail on shape before reaching the
 * consistency rules these tests are about.
 */
function executableOpenerDecision(): OpenerSetPreflightDecision {
  return {
    status: "executable",
    requestedOpenerSetId: "activity_resumed_only",
    resolvedOpenerSetId: "activity_resumed_only",
    effectiveOpenerSetId: "activity_resumed_only",
    relation: "baseline_equivalent",
    reasonCode: null,
    optionsDigest: DIGEST,
  };
}

function refusedOpenerDecision(): OpenerSetPreflightDecision {
  return {
    status: "refused",
    requestedOpenerSetId: "activity_resumed_only",
    resolvedOpenerSetId: "activity_resumed_only",
    effectiveOpenerSetId: null,
    relation: "refused",
    reasonCode: "eyes_requires_lifecycle_triplets",
    optionsDigest: DIGEST,
  };
}

function applicability(
  overrides: Partial<MaximumDurationApplicability> = {},
): MaximumDurationApplicability {
  return {
    protocolVersion: "chronicle-maximum-duration/v1",
    shape: "explicit_generic_fixed",
    requestedPolicy: "post_reconstruction_strict_max_v1",
    effectivePolicy: "post_reconstruction_strict_max_v1",
    disposition: "truncate_to_threshold",
    thresholdSource: "fixed_parameter",
    thresholdNs: "21600000000000",
    relation: "controlled_derivative",
    refusalReason: null,
    b06EffectiveStage: "post_reconstruction",
    reconstructionNativeStage: "post_reconstruction",
    checkedI128Preflight: null,
    legacyThresholdHoursCanonical: null,
    legacyThresholdNsCanonical: null,
    legacyOrigin: "absent",
    ...overrides,
  };
}

function executableMaximumDurationDecision(): MaximumDurationPreflightDecision {
  return {
    status: "executable",
    applicability: applicability(),
    reasonCode: null,
    optionsDigest: DIGEST,
  };
}

function refusedMaximumDurationDecision(): MaximumDurationPreflightDecision {
  return {
    status: "refused",
    applicability: applicability({
      relation: "refused",
      refusalReason: "policy_incompatible_with_reconstruction_strategy",
      effectivePolicy: null,
    }),
    reasonCode:
      "maximum_duration_policy_incompatible_with_reconstruction_strategy",
    optionsDigest: DIGEST,
  };
}

describe("opener-set preflight decoding", () => {
  it("accepts the refused shape the kernel is allowed to emit", () => {
    expect(decodeOpenerSetPreflightDecision(refusedOpenerDecision())).toEqual(
      refusedOpenerDecision(),
    );
  });

  it("accepts an executable decision whose effective id equals the resolved id", () => {
    expect(
      decodeOpenerSetPreflightDecision(executableOpenerDecision()),
    ).toEqual(executableOpenerDecision());
  });

  it("rejects a refused decision that still names an effective opener set", () => {
    expect(() =>
      decodeOpenerSetPreflightDecision({
        ...refusedOpenerDecision(),
        effectiveOpenerSetId: "activity_resumed_only",
      }),
    ).toThrow(
      "runtime manifest contract violation at openerSetPreflightDecision: refused decision has inconsistent relation, effective id, or reason",
    );
  });

  it("rejects a refused decision whose relation is not itself refused", () => {
    expect(() =>
      decodeOpenerSetPreflightDecision({
        ...refusedOpenerDecision(),
        relation: "baseline_native",
      }),
    ).toThrow(
      "runtime manifest contract violation at openerSetPreflightDecision: refused decision has inconsistent relation, effective id, or reason",
    );
  });

  it("rejects a refused decision carrying no reason code", () => {
    expect(() =>
      decodeOpenerSetPreflightDecision({
        ...refusedOpenerDecision(),
        reasonCode: null,
      }),
    ).toThrow(
      "runtime manifest contract violation at openerSetPreflightDecision: refused decision has inconsistent relation, effective id, or reason",
    );
  });

  it("rejects an executable decision whose relation is refused", () => {
    expect(() =>
      decodeOpenerSetPreflightDecision({
        ...executableOpenerDecision(),
        relation: "refused",
      }),
    ).toThrow(
      "runtime manifest contract violation at openerSetPreflightDecision: executable decision has inconsistent relation, effective id, or reason",
    );
  });

  it("rejects an executable decision whose effective id drifts from the resolved id", () => {
    expect(() =>
      decodeOpenerSetPreflightDecision({
        ...executableOpenerDecision(),
        effectiveOpenerSetId: "strategy_defined",
      }),
    ).toThrow(
      "runtime manifest contract violation at openerSetPreflightDecision: executable decision has inconsistent relation, effective id, or reason",
    );
  });

  it("rejects an executable decision that still carries a reason code", () => {
    expect(() =>
      decodeOpenerSetPreflightDecision({
        ...executableOpenerDecision(),
        reasonCode: "eyes_requires_lifecycle_triplets",
      }),
    ).toThrow(
      "runtime manifest contract violation at openerSetPreflightDecision: executable decision has inconsistent relation, effective id, or reason",
    );
  });
});

describe("maximum-duration preflight decoding", () => {
  it("accepts a refused decision whose reason code ends with the typed reason", () => {
    expect(
      decodeMaximumDurationPreflightDecision(refusedMaximumDurationDecision()),
    ).toEqual(refusedMaximumDurationDecision());
  });

  it("accepts an executable decision with no relation or reason of refusal", () => {
    expect(
      decodeMaximumDurationPreflightDecision(
        executableMaximumDurationDecision(),
      ),
    ).toEqual(executableMaximumDurationDecision());
  });

  it("rejects a refused decision whose applicability relation is not refused", () => {
    const decision = refusedMaximumDurationDecision();
    expect(() =>
      decodeMaximumDurationPreflightDecision({
        ...decision,
        applicability: { ...decision.applicability, relation: "baseline_native" },
      }),
    ).toThrow(
      "runtime manifest contract violation at maximumDurationPreflightDecision: refused decision has inconsistent relation or reason",
    );
  });

  it("rejects a refused decision with no typed applicability reason", () => {
    const decision = refusedMaximumDurationDecision();
    expect(() =>
      decodeMaximumDurationPreflightDecision({
        ...decision,
        applicability: { ...decision.applicability, refusalReason: null },
      }),
    ).toThrow(
      "runtime manifest contract violation at maximumDurationPreflightDecision: refused decision has inconsistent relation or reason",
    );
  });

  it("rejects a refused decision with no canonical kernel reason code", () => {
    expect(() =>
      decodeMaximumDurationPreflightDecision({
        ...refusedMaximumDurationDecision(),
        reasonCode: null,
      }),
    ).toThrow(
      "runtime manifest contract violation at maximumDurationPreflightDecision: refused decision has inconsistent relation or reason",
    );
  });

  it("rejects a refused decision whose kernel reason code does not end with the typed reason", () => {
    expect(() =>
      decodeMaximumDurationPreflightDecision({
        ...refusedMaximumDurationDecision(),
        reasonCode: "maximum_duration_threshold_malformed",
      }),
    ).toThrow(
      "runtime manifest contract violation at maximumDurationPreflightDecision: refused decision has inconsistent relation or reason",
    );
  });

  it("rejects an executable decision whose applicability relation is refused", () => {
    const decision = executableMaximumDurationDecision();
    expect(() =>
      decodeMaximumDurationPreflightDecision({
        ...decision,
        applicability: { ...decision.applicability, relation: "refused" },
      }),
    ).toThrow(
      "runtime manifest contract violation at maximumDurationPreflightDecision: executable decision has inconsistent relation or reason",
    );
  });

  it("rejects an executable decision that still carries a typed refusal reason", () => {
    const decision = executableMaximumDurationDecision();
    expect(() =>
      decodeMaximumDurationPreflightDecision({
        ...decision,
        applicability: {
          ...decision.applicability,
          refusalReason: "threshold_malformed",
        },
      }),
    ).toThrow(
      "runtime manifest contract violation at maximumDurationPreflightDecision: executable decision has inconsistent relation or reason",
    );
  });

  it("rejects an executable decision that still carries a kernel reason code", () => {
    expect(() =>
      decodeMaximumDurationPreflightDecision({
        ...executableMaximumDurationDecision(),
        reasonCode: "maximum_duration_threshold_malformed",
      }),
    ).toThrow(
      "runtime manifest contract violation at maximumDurationPreflightDecision: executable decision has inconsistent relation or reason",
    );
  });
});

describe("explicit maximum-duration selection", () => {
  it("is false when every B06 key is absent from the options object", () => {
    expect(isExplicitMaximumDurationSelection(DEFAULT_BROWSER_OPTIONS)).toBe(
      false,
    );
  });

  it.each([
    ["maximumDurationPolicy", "post_reconstruction_strict_max_v1"],
    ["maximumDurationDisposition", "truncate_to_threshold"],
    ["maximumDurationThresholdSource", "fixed_parameter"],
    ["maximumDurationThresholdNs", "21600000000000"],
  ] as const)("is true when only %s is present", (key, value) => {
    expect(
      isExplicitMaximumDurationSelection({
        ...DEFAULT_BROWSER_OPTIONS,
        [key]: value,
      }),
    ).toBe(true);
  });
});

describe("refusal error messages", () => {
  it("names the requested opener set and its reason code", () => {
    const error = new RustOpenerSetRefusalError(refusedOpenerDecision());
    expect(error.code).toBe("opener_set_refused");
    expect(error.name).toBe("RustOpenerSetRefusalError");
    expect(error.decision).toEqual(refusedOpenerDecision());
    expect(error.message).toBe(
      "Opener set activity_resumed_only is incompatible with the selected reconstruction strategy (eyes_requires_lifecycle_triplets)",
    );
  });

  it("falls back to unspecified_reason when the opener decision names none", () => {
    expect(
      new RustOpenerSetRefusalError({
        ...refusedOpenerDecision(),
        reasonCode: null,
      }).message,
    ).toBe(
      "Opener set activity_resumed_only is incompatible with the selected reconstruction strategy (unspecified_reason)",
    );
  });

  it("names the requested maximum-duration policy and its reason code", () => {
    const decision = refusedMaximumDurationDecision();
    const error = new RustMaximumDurationRefusalError(decision);
    expect(error.code).toBe("maximum_duration_refused");
    expect(error.name).toBe("RustMaximumDurationRefusalError");
    expect(error.decision).toEqual(decision);
    expect(error.message).toBe(
      "Maximum-duration policy post_reconstruction_strict_max_v1 cannot run with the selected settings (maximum_duration_policy_incompatible_with_reconstruction_strategy)",
    );
  });

  it("falls back to unspecified_reason when the maximum-duration decision names none", () => {
    expect(
      new RustMaximumDurationRefusalError({
        ...refusedMaximumDurationDecision(),
        reasonCode: null,
      }).message,
    ).toBe(
      "Maximum-duration policy post_reconstruction_strict_max_v1 cannot run with the selected settings (unspecified_reason)",
    );
  });
});

describe("scientific preflight refusal message", () => {
  it("reports the B05 axis from the non-executable screen projection", () => {
    const error = new RustScientificPreflightRefusalError(
      runtimeScientificRefusalFixture(),
    );
    expect(error.code).toBe("scientific_preflight_refused");
    expect(error.name).toBe("RustScientificPreflightRefusalError");
    expect(error.message).toBe(
      "Scientific preflight refused (B05/Schoedel: capability_evidence_not_bound_to_input/capability_evidence_not_bound_to_input).",
    );
  });

  it("falls through to the Schoedel projection when the screen arm is executable", () => {
    const receipt = runtimeScientificRefusalFixture();
    const refused = {
      ...receipt,
      b05Schoedel: {
        ...receipt.b05Schoedel,
        screenApplicability: {
          ...receipt.b05Schoedel.screenApplicability!,
          relation: "baseline_native" as const,
          executable: true,
          refusalReason: null,
          refusalDetail: null,
        },
        schoedelApplicability: {
          protocolVersion: "chronicle-b05-schoedel-reconstruction/v1",
          relation: "refused" as const,
          executable: false,
          refusalReason: "invalid_screen_interval_dependency" as const,
          refusalDetail: "invalid_screen_interval_dependency" as const,
        },
      },
    };
    expect(new RustScientificPreflightRefusalError(refused).message).toBe(
      "Scientific preflight refused (B05/Schoedel: invalid_screen_interval_dependency/invalid_screen_interval_dependency).",
    );
  });

  it("reports the EYES axis when only the input partition is refused", () => {
    const receipt = runtimeScientificPreflightFixture();
    const refused = {
      ...receipt,
      eyesInputPartition: {
        ...receipt.eyesInputPartition,
        disposition: "refused" as const,
        relation: "refused" as const,
        refusalReason: "unsupported_input_chunk" as const,
        refusalDetail: "participant_stream_fragmented",
      },
    };
    // A fragmented stream has a researcher-facing remedy (#51); the typed code follows it.
    expect(new RustScientificPreflightRefusalError(refused).message).toBe(
      "This file's participant also appears in another file of this batch, and " +
        "sessions cannot be closed safely across a split export. Combine the " +
        "participant's files into one, or turn off screen usage to process app usage alone. " +
        "Scientific preflight refused (EYES input partition: unsupported_input_chunk/participant_stream_fragmented).",
    );
  });

  it("falls back to non_executable/unspecified when neither arm names a reason", () => {
    expect(
      new RustScientificPreflightRefusalError(
        runtimeScientificPreflightFixture(),
      ).message,
    ).toBe("Scientific preflight refused (scientific input: non_executable/unspecified).");
  });
});
