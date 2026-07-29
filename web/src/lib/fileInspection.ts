import { inspectRawCsvBytes } from "@/lib/rustWorkerClient";
import type { BrowserProcessingOptions } from "@/lib/types";

export type RawFileInspection = {
  fileName: string;
  sizeBytes: number;
  /** SHA-256 computed from this exact immutable File while it is already in the inspection worker. */
  inputSha256?: string;
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
  // Rust owns interaction-type interpretation. This preflight warning reports
  // the file inspection result verbatim; TypeScript must not decide whether a
  // user mapping changes the pipeline's meaning.
  const stillUnrecognized = inspection.unrecognizedInteractionTypes;
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
  verifiedInputSha256?: string,
) => Promise<RawFileInspection>;

let rawFileInspector: RawFileInspector = inspectRawCsvBytes;

/** Test seam for running the same Rust inspection function without a browser Worker. */
export function setRawFileInspectorForTesting(
  inspector: RawFileInspector | null,
): void {
  rawFileInspector = inspector ?? inspectRawCsvBytes;
}

export async function inspectRawFile(file: File): Promise<RawFileInspection> {
  const bytes = await file.arrayBuffer();
  const inputSha256 = await sha256Hex(bytes);
  return {
    ...(await rawFileInspector(file.name, file.size, bytes, inputSha256)),
    inputSha256,
  };
}

export async function inspectRawFiles(
  files: File[],
): Promise<RawFileInspection[]> {
  // Hashing is cheaper than parsing. Exact duplicate content is parsed once,
  // while each selected File keeps its own display name and size. Bound both
  // worker count and total queued bytes so large files cannot exhaust memory.
  const results: Array<RawFileInspection | undefined> = Array.from(
    { length: files.length },
    () => undefined,
  );
  const inspectionByDigest = new Map<string, Promise<RawFileInspection>>();
  let cursor = 0;
  const inspectNext = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const file = files[index];
      if (!file) return;
      const bytes = await file.arrayBuffer();
      const inputSha256 = await sha256Hex(bytes);
      let inspection = inspectionByDigest.get(inputSha256);
      if (!inspection) {
        inspection = rawFileInspector(file.name, file.size, bytes, inputSha256);
        inspectionByDigest.set(inputSha256, inspection);
      }
      const canonical = await inspection;
      results[index] = {
        ...canonical,
        fileName: file.name,
        sizeBytes: file.size,
        inputSha256,
      };
    }
  };
  const largestFileBytes = Math.max(1, ...files.map((file) => file.size));
  const byteBound = Math.max(
    1,
    Math.floor((256 * 1024 * 1024) / largestFileBytes),
  );
  const concurrency = Math.min(8, byteBound, files.length);
  await Promise.all(Array.from({ length: concurrency }, () => inspectNext()));
  return results.filter(
    (inspection): inspection is RawFileInspection => inspection !== undefined,
  );
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
