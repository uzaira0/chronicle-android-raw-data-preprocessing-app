import type { RuntimeScientificPreflightReceipt } from "@/lib/generatedRuntimeBoundary";
import { failureText, UserFacingError } from "@/lib/diagnostics";
import { scientificPreflightReceiptFromError } from "@/lib/scientificPreflightTransport";
import type { ProcessedFileResult } from "@/lib/types";

export type ComparisonFailure = {
  fileNames: string[];
  message: string;
  details?: string;
  cause: Error;
  scientificPreflightRefusal?: RuntimeScientificPreflightReceipt;
};

export function comparisonFailure(
  fileNames: string[],
  error: unknown,
): ComparisonFailure {
  const cause = error instanceof Error ? error : new Error(String(error));
  const failure = failureText(
    error,
    fileNames.length === 1
      ? "This file could not be compared."
      : "These files could not be compared.",
  );
  return {
    fileNames: [...fileNames],
    message: failure.message,
    ...(failure.details !== undefined ? { details: failure.details } : {}),
    cause,
    scientificPreflightRefusal: scientificPreflightReceiptFromError(error),
  };
}

export class PartialComparisonFailureError extends UserFacingError {
  readonly failures: ComparisonFailure[];
  readonly partialResults: ProcessedFileResult[];
  readonly code?: "scientific_preflight_refused";
  readonly receipt?: RuntimeScientificPreflightReceipt;

  constructor(
    failures: ComparisonFailure[],
    partialResults: ProcessedFileResult[],
  ) {
    super(
      `Compared ${partialResults.length} file${partialResults.length === 1 ? "" : "s"}; ${failures.length} failed. ${failures[0]?.message ?? ""}`.trimEnd(),
      failures.map(({ details }) => details).filter((detail): detail is string => detail !== undefined).join("\n") || undefined,
    );
    this.name = "PartialComparisonFailureError";
    this.failures = failures;
    this.partialResults = partialResults;
    const firstRefusal = failures.find(
      (failure) => failure.scientificPreflightRefusal,
    )?.scientificPreflightRefusal;
    if (firstRefusal) {
      this.code = "scientific_preflight_refused";
      this.receipt = firstRefusal;
    }
  }
}

export function partialComparisonFailureFromError(
  error: unknown,
): PartialComparisonFailureError | undefined {
  return error instanceof PartialComparisonFailureError ? error : undefined;
}
