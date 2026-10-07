import {
  RUNTIME_BOUNDARY_MODEL,
  type RuntimeScientificPreflightReceipt,
} from "@/lib/generatedRuntimeBoundary";
import {
  contractError,
  decodeBoundaryStructExact,
} from "@/lib/runtimeBoundaryModel";

export function decodeScientificPreflightReceipt(
  value: unknown,
): RuntimeScientificPreflightReceipt {
  const receipt = decodeBoundaryStructExact<RuntimeScientificPreflightReceipt>(
    RUNTIME_BOUNDARY_MODEL,
    "RuntimeScientificPreflightReceipt",
    value,
    "scientificPreflightReceipt",
  );
  if (
    receipt.protocolVersion !== "chronicle-runtime-scientific-preflight/v2" ||
    receipt.key.protocolVersion !== "chronicle-runtime-scientific-preflight/v2" ||
    receipt.b05Schoedel.protocolVersion !==
      "chronicle-b05-schoedel-preflight/v1" ||
    receipt.eyesInputPartition.protocolVersion !==
      "chronicle-eyes-input-partition-preflight/v2" ||
    (receipt.b05Schoedel.screenApplicability !== null &&
      receipt.b05Schoedel.screenApplicability.protocolVersion !==
        "chronicle-b05-foundational-semantics/v1") ||
    (receipt.b05Schoedel.schoedelApplicability !== null &&
      receipt.b05Schoedel.schoedelApplicability.protocolVersion !==
        "chronicle-b05-foundational-semantics/v1")
  ) {
    contractError(
      "scientificPreflightReceipt.protocolVersion",
      "expected the runtime scientific-preflight v2 protocol",
    );
  }
  return receipt;
}
