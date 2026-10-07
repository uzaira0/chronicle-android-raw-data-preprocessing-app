import type { RuntimeScientificPreflightReceipt } from "@/lib/generatedRuntimeBoundary";
import { decodeScientificPreflightReceipt } from "@/lib/scientificPreflightBoundary";

const REFUSAL_KIND = "chronicle-scientific-preflight-refusal/v1" as const;

export type ScientificPreflightRefusalTransport = {
  kind: typeof REFUSAL_KIND;
  message: string;
  receipt: RuntimeScientificPreflightReceipt;
};

type TransportedScientificPreflightRefusalError = Error & {
  readonly code: "scientific_preflight_refused";
  readonly receipt: RuntimeScientificPreflightReceipt;
};

export function scientificPreflightReceiptFromError(
  error: unknown,
): RuntimeScientificPreflightReceipt | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "scientific_preflight_refused" &&
    "receipt" in error
    ? decodeScientificPreflightReceipt(error.receipt)
    : undefined;
}

export function serializeScientificPreflightRefusal(
  error: unknown,
): ScientificPreflightRefusalTransport | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "scientific_preflight_refused" ||
    !("receipt" in error) ||
    !("message" in error) ||
    typeof error.message !== "string"
  ) {
    return null;
  }
  return {
    kind: REFUSAL_KIND,
    message: error.message,
    receipt: decodeScientificPreflightReceipt(error.receipt),
  };
}

export function rehydrateScientificPreflightRefusal(error: unknown): unknown {
  if (
    typeof error !== "object" ||
    error === null ||
    !("kind" in error) ||
    error.kind !== REFUSAL_KIND ||
    !("message" in error) ||
    typeof error.message !== "string" ||
    !("receipt" in error)
  ) {
    return error;
  }
  const receipt = decodeScientificPreflightReceipt(error.receipt);
  const hydrated = new Error(
    error.message,
  ) as TransportedScientificPreflightRefusalError;
  hydrated.name = "RustScientificPreflightRefusalError";
  Object.defineProperties(hydrated, {
    code: { value: "scientific_preflight_refused", enumerable: true },
    receipt: { value: receipt, enumerable: true },
  });
  return hydrated;
}

/** Throw a plain structured-cloneable object so Comlink preserves the receipt. */
export function throwSerializableScientificPreflightRefusal(
  error: unknown,
): never {
  const serialized = serializeScientificPreflightRefusal(error);
  throw serialized ?? error;
}
