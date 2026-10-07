import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_BROWSER_OPTIONS,
  MAXIMUM_DURATION_DISPOSITION_VALUES,
  MAXIMUM_DURATION_POLICY_VALUES,
  MAXIMUM_DURATION_THRESHOLD_SOURCE_VALUES,
} from "@/lib/generatedContract";
import {
  MAXIMUM_DURATION_VECTOR_KEYS,
  completeMaximumDurationVector,
  isValidMaximumDurationSelectionShape,
  withMaximumDurationVector,
  type MaximumDurationVector,
} from "@/lib/maximumDurationVector";
import {
  buildMaximumDurationRequestFields,
  buildRustV2Options,
  decodeMaximumDurationPreflightDecision,
  exactLegacyHoursToNsSpelling,
} from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

const RUNTIME = { datetimeOfPreprocessing: "2026-08-17 00:00:00 UTC" };

function preflight(options: BrowserProcessingOptions) {
  const requestJson = JSON.stringify({
    protocolVersion: "chronicle-preprocessing-runtime/v2",
    requestId: "b06-vector-preflight",
    command: "ExecuteWorkspace",
    workspaceRootDigest: null,
    workspaceId: `sha256:${"0".repeat(64)}`,
    inputFileName: "vector.csv",
    inputSha256: `sha256:${"1".repeat(64)}`,
    options: buildRustV2Options(options, RUNTIME),
  });
  return decodeMaximumDurationPreflightDecision(
    JSON.parse(runtimeWasm.maximum_duration_applicability_json(requestJson)),
  );
}

describe("maximum-duration vector", () => {
  beforeAll(async () => {
    const bytes = await readFile(
      new URL(
        "../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
        import.meta.url,
      ),
    );
    runtimeWasm.initSync({ module: bytes });
  });

  it("agrees with the kernel shape table on every combination of the four keys", () => {
    // 4 policies (incl. absent) × 6 dispositions × 5 sources × 3 thresholds.
    const policies = [undefined, ...MAXIMUM_DURATION_POLICY_VALUES];
    const dispositions = [undefined, ...MAXIMUM_DURATION_DISPOSITION_VALUES];
    const sources = [undefined, ...MAXIMUM_DURATION_THRESHOLD_SOURCE_VALUES];
    const thresholds = [undefined, "3600000000000", "0"];
    let checked = 0;
    for (const policy of policies) {
      for (const disposition of dispositions) {
        for (const source of sources) {
          for (const threshold of thresholds) {
            const vector: MaximumDurationVector = {
              maximumDurationPolicy: policy,
              maximumDurationDisposition: disposition,
              maximumDurationThresholdSource: source,
              maximumDurationThresholdNs: threshold,
            };
            const options = withMaximumDurationVector(
              { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC" },
              vector,
            );
            const decision = preflight(options);
            const browserSaysLegal = isValidMaximumDurationSelectionShape(vector);
            const kernelSaysShapeInvalid =
              decision.status === "refused" &&
              (decision.applicability.refusalReason === "request_shape_invalid" ||
                decision.applicability.refusalReason === "threshold_malformed");
            expect(
              browserSaysLegal,
              `${JSON.stringify(vector)} → ${decision.status}/${decision.applicability.refusalReason}`,
            ).toBe(!kernelSaysShapeInvalid);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(4 * 6 * 5 * 3);
  });

  it("completes every single-key edit to a vector the kernel accepts as a shape", () => {
    const starts: MaximumDurationVector[] = [
      {},
      completeMaximumDurationVector({}, "maximumDurationPolicy", "strategy_native"),
      completeMaximumDurationVector({}, "maximumDurationPolicy", "chronicle_observed_close_rejection_v1"),
      completeMaximumDurationVector({}, "maximumDurationPolicy", "post_reconstruction_strict_max_v1"),
      completeMaximumDurationVector({}, "maximumDurationDisposition", "drop_row"),
    ];
    const edits: Array<[(typeof MAXIMUM_DURATION_VECTOR_KEYS)[number], unknown[]]> = [
      ["maximumDurationPolicy", [undefined, ...MAXIMUM_DURATION_POLICY_VALUES]],
      ["maximumDurationDisposition", [undefined, ...MAXIMUM_DURATION_DISPOSITION_VALUES]],
      ["maximumDurationThresholdSource", [undefined, ...MAXIMUM_DURATION_THRESHOLD_SOURCE_VALUES]],
      ["maximumDurationThresholdNs", [undefined, "1", "43200000000000"]],
    ];
    for (const start of starts) {
      for (const [key, values] of edits) {
        for (const value of values) {
          const completed = completeMaximumDurationVector(start, key, value);
          expect(
            isValidMaximumDurationSelectionShape(completed),
            `${JSON.stringify(start)} + ${key}=${JSON.stringify(value)} → ${JSON.stringify(completed)}`,
          ).toBe(true);
          expect(completed[key], `${key} keeps the edited value`).toBe(value);
          const decision = preflight(
            withMaximumDurationVector(
              { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC" },
              completed,
            ),
          );
          // b12 is a legal shape that refuses for a different reason (no
          // provider in v1); everything else executes.
          if (completed.maximumDurationThresholdSource === "b12_adaptive_participant") {
            expect(decision.applicability.refusalReason).toBe(
              "adaptive_maximum_threshold_provider_unavailable",
            );
            // A refused-but-legal shape keeps the shape it selected. Reporting
            // "omitted_legacy" here makes preflightMaximumDuration raise
            // "explicit request resolved to the omitted shape", which hides the
            // typed refusal behind a contract violation.
            expect(decision.applicability.shape).toBe("explicit_generic_adaptive");
          } else {
            expect(decision.status, JSON.stringify(completed)).toBe("executable");
          }
        }
      }
    }
  });

  it("projects the five browser keys under exact Rust snake-case fields, and the canonical legacy companions only when explicit", () => {
    const omitted = buildRustV2Options(
      { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC" },
      RUNTIME,
    );
    for (const field of [
      "maximum_duration_policy",
      "maximum_duration_disposition",
      "maximum_duration_threshold_source",
      "maximum_duration_threshold_ns",
      "long_duration_threshold_explicit",
      "b06_legacy_threshold_hours_canonical",
      "b06_legacy_threshold_ns_canonical",
    ]) {
      expect(omitted, field).not.toHaveProperty(field);
    }
    const explicit = buildRustV2Options(
      {
        ...DEFAULT_BROWSER_OPTIONS,
        selectedTimezone: "UTC",
        longDurationThresholdHours: 1.25,
        longDurationThresholdHoursExplicit: true,
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "truncate_to_threshold",
        maximumDurationThresholdSource: "fixed_parameter",
        maximumDurationThresholdNs: "3600000000000",
      },
      RUNTIME,
    );
    expect(explicit).toMatchObject({
      maximum_duration_policy: "post_reconstruction_strict_max_v1",
      maximum_duration_disposition: "truncate_to_threshold",
      maximum_duration_threshold_source: "fixed_parameter",
      maximum_duration_threshold_ns: "3600000000000",
      long_duration_threshold_explicit: true,
      long_duration_threshold_ns: 4_500_000_000_000,
      b06_legacy_threshold_hours_canonical: "1.25",
      b06_legacy_threshold_ns_canonical: "4500000000000",
    });
    for (const camel of MAXIMUM_DURATION_VECTOR_KEYS) {
      expect(explicit).not.toHaveProperty(camel);
    }
    // The threshold is a string on the wire, never a number.
    expect(typeof explicit.maximum_duration_threshold_ns).toBe("string");
    // The marker alone travels without companions (omitted shape).
    const markerOnly = buildMaximumDurationRequestFields({
      ...DEFAULT_BROWSER_OPTIONS,
      longDurationThresholdHoursExplicit: true,
    });
    expect(markerOnly).toEqual({ long_duration_threshold_explicit: true });
  });

  it("derives the legacy nanosecond companion exactly on the digit string", () => {
    expect(exactLegacyHoursToNsSpelling("12")).toBe("43200000000000");
    expect(exactLegacyHoursToNsSpelling("1.25")).toBe("4500000000000");
    expect(exactLegacyHoursToNsSpelling("0.5")).toBe("1800000000000");
    // Not a whole number of nanoseconds: the exact fraction is spelled out so
    // the kernel refuses `legacy_threshold_not_integer_ns` instead of accepting
    // a rounded value.
    expect(exactLegacyHoursToNsSpelling("1.1")).toBe("3960000000000");
    expect(exactLegacyHoursToNsSpelling("0.0000000000001")).toBe("0.36");
    expect(exactLegacyHoursToNsSpelling("0")).toBe("0");
  });

  it("hands back a spelling that is not a plain decimal for the kernel to refuse", () => {
    // The conversion is defined on the digit string only. An exponent spelling
    // or a non-numeric one is returned unchanged, so the kernel's own
    // comparison against the wire hours is what refuses it.
    expect(exactLegacyHoursToNsSpelling("1e3")).toBe("1e3");
    expect(exactLegacyHoursToNsSpelling("Infinity")).toBe("Infinity");
    expect(exactLegacyHoursToNsSpelling("-")).toBe("-");
  });

  it("refuses at preflight when a legacy companion disagrees with the wire hours", () => {
    const options = buildRustV2Options(
      {
        ...DEFAULT_BROWSER_OPTIONS,
        selectedTimezone: "UTC",
        maximumDurationPolicy: "strategy_native",
        maximumDurationDisposition: "not_applicable",
        maximumDurationThresholdSource: "strategy_native",
      },
      RUNTIME,
    );
    expect(options.b06_legacy_threshold_hours_canonical).toBe("12");
    const tampered = { ...options, b06_legacy_threshold_ns_canonical: "43200000000001" };
    const decision = decodeMaximumDurationPreflightDecision(
      JSON.parse(
        runtimeWasm.maximum_duration_applicability_json(
          JSON.stringify({
            protocolVersion: "chronicle-preprocessing-runtime/v2",
            requestId: "b06-vector-preflight",
            command: "ExecuteWorkspace",
            workspaceRootDigest: null,
            workspaceId: `sha256:${"0".repeat(64)}`,
            inputFileName: "vector.csv",
            inputSha256: `sha256:${"1".repeat(64)}`,
            options: tampered,
          }),
        ),
      ),
    );
    expect(decision.status).toBe("refused");
    expect(decision.applicability.refusalReason).toBe(
      "legacy_threshold_canonicalization_mismatch",
    );
    expect(decision.reasonCode).toBe(
      "maximum_duration_legacy_threshold_canonicalization_mismatch",
    );
  });
});
