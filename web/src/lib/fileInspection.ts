import { inspectRawCsvBytes } from "@/lib/chronicleMatcher";
import { parseInteractionRemap } from "@/lib/interactionTypes";
import type { BrowserProcessingOptions } from "@/lib/types";

export type RawFileInspection = {
  fileName: string;
  sizeBytes: number;
  rowCount: number;
  /** Distinct participant_id values. >1 means multiple participants are
   * concatenated in one file, which the per-file pipeline doesn't group by. */
  participantCount: number;
  columns: string[];
  timezones: string[];
  hasRequiredColumns: boolean;
  invalidTimestampCount: number;
  missingTimestampCount: number;
  missingTimezoneCount: number;
  duplicateTimestampCount: number;
  /** Rows whose event_timestamp is earlier than a preceding row for the same participant. */
  outOfOrderTimestampCount: number;
  /** 1-based data-row ordinal of the first out-of-order timestamp, if any. */
  firstOutOfOrderRow: number | null;
  /** Distinct interaction_type values not recognized by the pipeline's map. */
  unrecognizedInteractionTypes: string[];
  warnings: string[];
};

export function effectiveWarnings(
  inspection: RawFileInspection,
  options: BrowserProcessingOptions,
): string[] {
  const warnings = [...inspection.warnings];
  if (
    inspection.duplicateTimestampCount > 0 &&
    !options.correctDuplicateEventTimestamps
  ) {
    warnings.push(
      `${inspection.duplicateTimestampCount.toLocaleString()} event timestamps appear more than once.`,
    );
  }
  // Interaction types the built-in map doesn't recognize, minus any the user
  // has remapped to a canonical name (#4). Computed here (not in inspectRawFile)
  // because whether a type is "unrecognized" depends on the remap option.
  const remapped = parseInteractionRemap(options.interactionTypeRemap);
  const stillUnrecognized = inspection.unrecognizedInteractionTypes.filter(
    (type) => !remapped.has(type),
  );
  if (stillUnrecognized.length) {
    const sample = stillUnrecognized.slice(0, 5).join(", ");
    const more = stillUnrecognized.length > 5 ? ", …" : "";
    warnings.push(
      `${stillUnrecognized.length.toLocaleString()} unrecognized interaction type` +
        `${stillUnrecognized.length === 1 ? "" : "s"}: ${sample}${more}. ` +
        "They're kept in the output but won't start or end app-usage sessions. " +
        "Map a vendor-specific type to a canonical one under custom interaction-type mappings; " +
        "to make one end sessions add it under the interaction types that end a session; " +
        "to drop it add it under interaction types to remove (all in Interaction semantics).",
    );
  }
  return warnings;
}

type RawFileInspector = (
  fileName: string,
  sizeBytes: number,
  csvBytes: ArrayBuffer,
) => Promise<RawFileInspection>;

let rawFileInspector: RawFileInspector = inspectRawCsvBytes;

/** Test seam for running the same Rust inspection function without a browser Worker. */
export function setRawFileInspectorForTesting(inspector: RawFileInspector | null): void {
  rawFileInspector = inspector ?? inspectRawCsvBytes;
}

export async function inspectRawFile(file: File): Promise<RawFileInspection> {
  return rawFileInspector(file.name, file.size, await file.arrayBuffer());
}

export async function inspectRawFiles(files: File[]): Promise<RawFileInspection[]> {
  return Promise.all(files.map((file) => inspectRawFile(file)));
}
