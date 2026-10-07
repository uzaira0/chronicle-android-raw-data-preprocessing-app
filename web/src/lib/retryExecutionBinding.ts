import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
} from "@/lib/types";

export type ResultExecutionBinding = {
  options: BrowserProcessingOptions;
  supportFiles: BrowserSupportFiles;
  runtime: BrowserProcessingRuntime;
};

/**
 * A retry that is merged into an existing batch must use the exact binding
 * that produced that batch. Live settings/support edits are intentionally
 * ignored; applying them requires a full rerun so one result collection can
 * never claim two scientific configurations.
 */
export function selectRetryExecutionBinding(
  existingResultCount: number,
  resultsOptions: BrowserProcessingOptions | null,
  resultsBinding: ResultExecutionBinding | null,
  currentBinding: ResultExecutionBinding | null,
): ResultExecutionBinding {
  const hasPriorAttempt =
    existingResultCount > 0 || resultsOptions !== null || resultsBinding !== null;
  if (hasPriorAttempt) {
    if (
      !resultsOptions ||
      !resultsBinding ||
      JSON.stringify(resultsOptions) !== JSON.stringify(resultsBinding.options)
    ) {
      throw new Error(
        "The exact binding for this prior attempt is unavailable; run the full batch again before retrying a file.",
      );
    }
    return resultsBinding;
  }
  if (!currentBinding) {
    throw new Error(
      "The current retry binding has not been resolved.",
    );
  }
  return currentBinding;
}

/** Resolve live state only when this selection has no prior run attempt. */
export async function resolveRetryExecutionBinding(
  existingResultCount: number,
  resultsOptions: BrowserProcessingOptions | null,
  resultsBinding: ResultExecutionBinding | null,
  resolveCurrent: () => Promise<ResultExecutionBinding>,
): Promise<ResultExecutionBinding> {
  if (
    existingResultCount > 0 ||
    resultsOptions !== null ||
    resultsBinding !== null
  ) {
    return selectRetryExecutionBinding(
      existingResultCount,
      resultsOptions,
      resultsBinding,
      null,
    );
  }
  return selectRetryExecutionBinding(0, null, null, await resolveCurrent());
}
