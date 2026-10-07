import type { RuntimeScientificPreflightReceipt } from "@/lib/generatedRuntimeBoundary";
import { scientificPreflightReceiptFromError } from "@/lib/scientificPreflightTransport";
import type { ProcessedFileResult } from "@/lib/types";

export type ComparisonFailure = {
  fileNames: string[];
  message: string;
  cause: Error;
  scientificPreflightRefusal?: RuntimeScientificPreflightReceipt;
};

export function comparisonFailure(
  fileNames: string[],
  error: unknown,
): ComparisonFailure {
  const cause = error instanceof Error ? error : new Error(String(error));
  return {
    fileNames: [...fileNames],
    message: cause.message,
    cause,
    scientificPreflightRefusal: scientificPreflightReceiptFromError(error),
  };
}

export class PartialComparisonFailureError extends Error {
  readonly failures: ComparisonFailure[];
  readonly partialResults: ProcessedFileResult[];
  readonly code?: "scientific_preflight_refused";
  readonly receipt?: RuntimeScientificPreflightReceipt;

  constructor(
    failures: ComparisonFailure[],
    partialResults: ProcessedFileResult[],
  ) {
    super(
      `Compared ${partialResults.length} file${partialResults.length === 1 ? "" : "s"}; ${failures.length} failed. ${failures[0]?.message ?? "Unknown comparison failure."}`,
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
