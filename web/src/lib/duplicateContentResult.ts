import type { ProcessedFileResult } from "@/lib/types";

/**
 * Reuse a durable result for another immutable File with the same verified
 * content digest. File names are display/download labels; Rust computation,
 * the workspace root, and every persisted artifact remain byte-identical.
 */
export function relabelDuplicateContentResult(
  source: ProcessedFileResult,
  inputFileName: string,
): ProcessedFileResult {
  const sourceStem = source.inputFileName.replace(/\.csv$/i, "");
  const targetStem = inputFileName.replace(/\.csv$/i, "");
  const outputs = source.outputs.map((output) => {
    if (!output.outputFileName.startsWith(sourceStem)) {
      throw new Error(
        `Rust output name is not derived from its input label: ${output.outputFileName}`,
      );
    }
    return {
      ...output,
      outputFileName:
        targetStem + output.outputFileName.slice(sourceStem.length),
    };
  });
  return {
    ...source,
    inputFileName,
    outputs,
    ...(source.persistedPlotRequest
      ? {
          persistedPlotRequest: {
            ...source.persistedPlotRequest,
            inputFileName,
          },
        }
      : {}),
    ...(source.persistedTimelineRequest
      ? {
          persistedTimelineRequest: {
            ...source.persistedTimelineRequest,
            inputFileName,
          },
        }
      : {}),
  };
}
