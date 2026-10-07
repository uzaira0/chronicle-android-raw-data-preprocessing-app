import type {
  MaximumDurationDisposition,
  MaximumDurationPolicy,
  MaximumDurationThresholdSource,
} from "@/lib/generatedContract";
import type { BrowserProcessingOptions } from "@/lib/types";

/// The B06 maximum-duration axis travels as one selection vector of four
/// optional keys. This module holds the browser's copy of the kernel's shape
/// table (`b06_maximum_duration::select_shape`): which pairings are legal, and
/// how a single-key edit completes to a legal vector. The kernel's
/// `maximum_duration_applicability_json` preflight remains the authority at run
/// time; `maximumDurationVector.test.ts` cross-checks every combination of this
/// table against it so the two cannot drift.

export const MAXIMUM_DURATION_VECTOR_KEYS = [
  "maximumDurationPolicy",
  "maximumDurationDisposition",
  "maximumDurationThresholdSource",
  "maximumDurationThresholdNs",
] as const;

export type MaximumDurationVectorKey = (typeof MAXIMUM_DURATION_VECTOR_KEYS)[number];

export type MaximumDurationVector = Pick<
  BrowserProcessingOptions,
  MaximumDurationVectorKey
>;

/// Legacy default (12 h) spelled as exact nanoseconds; the value a fixed
/// threshold takes when a vector is completed without one.
const DEFAULT_MAXIMUM_DURATION_THRESHOLD_NS = "43200000000000";
const DEFAULT_ACTIVE_MAXIMUM_DURATION_DISPOSITION: MaximumDurationDisposition =
  "flag_and_retain";

/// Exact base-10 nanoseconds: no sign, point, exponent, or leading zero, and
/// numerically at most i64::MAX (9223372036854775807). The value stays a
/// string so it never rounds through a JavaScript number.
const MAXIMUM_DURATION_THRESHOLD_NS_PATTERN = /^[1-9][0-9]{0,18}$/;
const I64_MAX_TEXT = "9223372036854775807";

export function isCanonicalMaximumDurationThresholdNs(value: unknown): value is string {
  if (typeof value !== "string" || !MAXIMUM_DURATION_THRESHOLD_NS_PATTERN.test(value)) {
    return false;
  }
  return value.length < I64_MAX_TEXT.length || value <= I64_MAX_TEXT;
}

export function isExplicitMaximumDurationVector(vector: MaximumDurationVector): boolean {
  return MAXIMUM_DURATION_VECTOR_KEYS.some((key) => vector[key] !== undefined);
}

/// The five legal presence shapes of the four selection keys (research
/// decision §2). Every other combination — including a partial set — is
/// invalid; nothing here fills in a missing sibling.
export function isValidMaximumDurationSelectionShape(vector: MaximumDurationVector): boolean {
  const policy = vector.maximumDurationPolicy;
  const disposition = vector.maximumDurationDisposition;
  const source = vector.maximumDurationThresholdSource;
  const threshold = vector.maximumDurationThresholdNs;
  if (!isExplicitMaximumDurationVector(vector)) return true;
  if (policy === undefined || disposition === undefined || source === undefined) {
    return false;
  }
  switch (policy) {
    case "strategy_native":
      return (
        disposition === "not_applicable" &&
        source === "strategy_native" &&
        threshold === undefined
      );
    case "chronicle_observed_close_rejection_v1":
      return (
        disposition === "not_applicable" &&
        source === "chronicle_legacy_config" &&
        threshold === undefined
      );
    case "post_reconstruction_strict_max_v1":
      if (disposition === "not_applicable") return false;
      if (source === "fixed_parameter") {
        return isCanonicalMaximumDurationThresholdNs(threshold);
      }
      if (source === "b12_adaptive_participant") return threshold === undefined;
      return false;
    default:
      return false;
  }
}

const OMITTED_VECTOR: MaximumDurationVector = {
  maximumDurationPolicy: undefined,
  maximumDurationDisposition: undefined,
  maximumDurationThresholdSource: undefined,
  maximumDurationThresholdNs: undefined,
};

function activeDisposition(
  current: MaximumDurationDisposition | undefined,
): MaximumDurationDisposition {
  return current !== undefined && current !== "not_applicable"
    ? current
    : DEFAULT_ACTIVE_MAXIMUM_DURATION_DISPOSITION;
}

function genericVector(
  disposition: MaximumDurationDisposition | undefined,
  source: "fixed_parameter" | "b12_adaptive_participant",
  threshold: string | undefined,
): MaximumDurationVector {
  return {
    maximumDurationPolicy: "post_reconstruction_strict_max_v1",
    maximumDurationDisposition: activeDisposition(disposition),
    maximumDurationThresholdSource: source,
    maximumDurationThresholdNs:
      source === "fixed_parameter"
        ? (threshold ?? DEFAULT_MAXIMUM_DURATION_THRESHOLD_NS)
        : undefined,
  };
}

/// The canonical legal vector after one key of `current` is set to `value`
/// (`undefined` = remove). Each key determines its siblings: a policy picks
/// its one legal pairing (the generic policy keeps a compatible active
/// disposition and threshold, else takes the defaults); a threshold source
/// picks the one policy it pairs with; a disposition of `not_applicable` picks
/// the explicit strategy-native shape and an active disposition picks the
/// generic fixed shape; a threshold picks the generic fixed shape, and
/// removing the threshold from a fixed-parameter vector returns to omission.
/// Removing the policy, disposition, or source removes the whole vector.
export function completeMaximumDurationVector(
  current: MaximumDurationVector,
  key: MaximumDurationVectorKey,
  value: unknown,
): MaximumDurationVector {
  const disposition = current.maximumDurationDisposition;
  const threshold = current.maximumDurationThresholdNs;
  const currentSource = current.maximumDurationThresholdSource;
  switch (key) {
    case "maximumDurationPolicy": {
      const policy = value as MaximumDurationPolicy | undefined;
      switch (policy) {
        case undefined:
          return { ...OMITTED_VECTOR };
        case "strategy_native":
          return {
            maximumDurationPolicy: policy,
            maximumDurationDisposition: "not_applicable",
            maximumDurationThresholdSource: "strategy_native",
            maximumDurationThresholdNs: undefined,
          };
        case "chronicle_observed_close_rejection_v1":
          return {
            maximumDurationPolicy: policy,
            maximumDurationDisposition: "not_applicable",
            maximumDurationThresholdSource: "chronicle_legacy_config",
            maximumDurationThresholdNs: undefined,
          };
        case "post_reconstruction_strict_max_v1":
          return genericVector(
            disposition,
            currentSource === "b12_adaptive_participant"
              ? "b12_adaptive_participant"
              : "fixed_parameter",
            threshold,
          );
        default:
          return { ...OMITTED_VECTOR, maximumDurationPolicy: policy };
      }
    }
    case "maximumDurationDisposition": {
      const next = value as MaximumDurationDisposition | undefined;
      if (next === undefined) return { ...OMITTED_VECTOR };
      if (next === "not_applicable") {
        return current.maximumDurationPolicy === "chronicle_observed_close_rejection_v1"
          ? {
              maximumDurationPolicy: "chronicle_observed_close_rejection_v1",
              maximumDurationDisposition: "not_applicable",
              maximumDurationThresholdSource: "chronicle_legacy_config",
              maximumDurationThresholdNs: undefined,
            }
          : {
              maximumDurationPolicy: "strategy_native",
              maximumDurationDisposition: "not_applicable",
              maximumDurationThresholdSource: "strategy_native",
              maximumDurationThresholdNs: undefined,
            };
      }
      return genericVector(
        next,
        currentSource === "b12_adaptive_participant"
          ? "b12_adaptive_participant"
          : "fixed_parameter",
        threshold,
      );
    }
    case "maximumDurationThresholdSource": {
      const source = value as MaximumDurationThresholdSource | undefined;
      switch (source) {
        case undefined:
          return { ...OMITTED_VECTOR };
        case "strategy_native":
          return {
            maximumDurationPolicy: "strategy_native",
            maximumDurationDisposition: "not_applicable",
            maximumDurationThresholdSource: "strategy_native",
            maximumDurationThresholdNs: undefined,
          };
        case "chronicle_legacy_config":
          return {
            maximumDurationPolicy: "chronicle_observed_close_rejection_v1",
            maximumDurationDisposition: "not_applicable",
            maximumDurationThresholdSource: "chronicle_legacy_config",
            maximumDurationThresholdNs: undefined,
          };
        case "fixed_parameter":
        case "b12_adaptive_participant":
          return genericVector(disposition, source, threshold);
        default:
          return { ...OMITTED_VECTOR, maximumDurationThresholdSource: source };
      }
    }
    case "maximumDurationThresholdNs": {
      const next = value as string | undefined;
      if (next === undefined) return { ...OMITTED_VECTOR };
      return genericVector(disposition, "fixed_parameter", next);
    }
  }
}

/// Apply a completed vector to an options object: absent keys are removed
/// (own-property presence is the omitted/explicit distinction on the wire).
export function withMaximumDurationVector<T extends BrowserProcessingOptions>(
  options: T,
  vector: MaximumDurationVector,
): T {
  const next = { ...options } as unknown as Record<string, unknown>;
  for (const key of MAXIMUM_DURATION_VECTOR_KEYS) {
    if (vector[key] === undefined) delete next[key];
    else next[key] = vector[key];
  }
  return next as unknown as T;
}
