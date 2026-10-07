import {
  beginRawInspectionBatch,
  disposeRawInspectionBatch,
  inspectRawCsvBytes,
  splitRawCsvByStudy,
} from "@/lib/rustWorkerClient";
import { recordError } from "@/lib/diagnostics";
import { requireDefined } from "@/lib/invariant";
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
  /** Ephemeral, batch-scoped identity; null only on the legacy v1 test seam. */
  participantPartitionBatchId: string | null;
  /** Sorted opaque tokens. They are neither participant IDs nor stable hashes. */
  participantTokens: string[];
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
  /** Rows whose canonical interaction type opens a screen session (Rust decides which). */
  screenStartEventCount: number;
  warnings: string[];
};

/**
 * Raw rows above which one file is expected to exhaust the browser engine.
 * Measured in the browser 2026-09-15 on a 580,793-row synthetic export
 * (docs/perf/BASELINE.md, "Budgeted payload residency"): the worker's WASM
 * memory high-water mark was 2,097,741,824 bytes on both Chromium and stock
 * Firefox, about 3.6 KB per raw row, with the 512 MiB payload budget
 * spilling to OPFS. A wasm32 worker cannot address more than 4 GiB;
 * 950,000 rows extrapolates to about 3.3 GiB at that rate, so this constant
 * errs toward warning.
 * ponytail: one fixture-derived constant; measure per run if real exports diverge.
 */
export const BROWSER_ENGINE_ROW_CEILING = 950_000;

export function effectiveWarnings(
  inspection: RawFileInspection,
  options: BrowserProcessingOptions,
): string[] {
  const warnings = [...inspection.warnings];
  if (inspection.rowCount > BROWSER_ENGINE_ROW_CEILING) {
    warnings.push(
      `This file has ${inspection.rowCount.toLocaleString()} rows. The browser engine holds a whole run ` +
        `in a 4 GB memory space, and files above about ${BROWSER_ENGINE_ROW_CEILING.toLocaleString()} rows ` +
        "are expected to run out of memory part-way through. That ceiling was measured with the " +
        "browser's private file storage available for spill; without it the engine holds everything " +
        "in memory and runs out sooner. Split the export into shorter date ranges " +
        "and process the parts as separate files.",
    );
  }
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
  // Inspection runs without options, so it cannot see a custom mapping that
  // turns some other raw type into a screen-session start at run time. With
  // any custom mapping present the count proves nothing and the warning stays
  // silent rather than TypeScript guessing what the mapping means.
  if (
    options.processScreenUsage &&
    inspection.rowCount > 0 &&
    inspection.screenStartEventCount === 0 &&
    options.interactionTypeRemap.length === 0
  ) {
    warnings.push(
      "No screen events. This export has no screen-session start events (Screen Interactive), " +
        "so the screen usage output will contain zero rows. App usage is unaffected. " +
        "Re-export with screen events, or turn off screen usage processing to skip the empty file.",
    );
  }
  return warnings;
}

type RawFileInspector = (
  fileName: string,
  sizeBytes: number,
  csvBytes: ArrayBuffer,
  verifiedInputSha256?: string,
  participantPartitionBatchId?: string,
) => Promise<RawFileInspection>;

let rawFileInspector: RawFileInspector = inspectRawCsvBytes;

/** Test seam for running the same Rust inspection function without a browser Worker. */
export function setRawFileInspectorForTesting(
  inspector: RawFileInspector | null,
): void {
  rawFileInspector = inspector ?? inspectRawCsvBytes;
}

type RawStudySplitter = (
  csvBytes: ArrayBuffer,
) => Promise<Array<{ studyId: string; bytes: ArrayBuffer }>>;

let rawStudySplitter: RawStudySplitter = splitRawCsvByStudy;

/** Test seam for running the same Rust split without a browser Worker. */
export function setRawStudySplitterForTesting(
  splitter: RawStudySplitter | null,
): void {
  rawStudySplitter = splitter ?? splitRawCsvByStudy;
}

/**
 * A person is a participant within a study, so a file that mixes studies is
 * replaced by one file per study before inspection. Every downstream step
 * then keys by study and participant; single-study files pass through as-is.
 * Each part is its own raw input: its SHA-256, provenance and data-row numbers
 * are the part's, so capability evidence bound to the mixed file's digest is
 * refused (fail-closed) and row numbers in messages count within the part.
 */
export async function splitMixedStudyFiles(
  files: File[],
  /** Files already split, e.g. the ones still listed after a removal. */
  alreadySplit: ReadonlySet<File> = new Set(),
): Promise<File[]> {
  const split: File[] = [];
  const nameKey = (name: string) => name.normalize("NFC").toLowerCase();
  const taken = new Set(files.map((file) => nameKey(file.name)));
  for (const file of files) {
    let parts: Awaited<ReturnType<RawStudySplitter>> = [];
    if (!alreadySplit.has(file)) {
      try {
        parts = await rawStudySplitter(await file.arrayBuffer());
      } catch {
        // Keep the file whole; inspection reports what is wrong with it.
        parts = [];
      }
    }
    if (parts.length === 0) {
      split.push(file);
      continue;
    }
    const dot = file.name.lastIndexOf(".");
    const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
    const extension = dot > 0 ? file.name.slice(dot) : "";
    for (const { studyId, bytes } of parts) {
      const label = studyId.replace(/[\\/:*?"<>|]/g, "_") || "blank";
      // Study IDs that differ only in case or in replaced characters would
      // collide under the unique-filename rule; number the later ones.
      let name = `${stem} [study ${label}]${extension}`;
      for (let copy = 2; taken.has(nameKey(name)); copy += 1) {
        name = `${stem} [study ${label} ${copy}]${extension}`;
      }
      taken.add(nameKey(name));
      split.push(
        new File([bytes], name, {
          type: file.type,
          lastModified: file.lastModified,
        }),
      );
    }
  }
  return split;
}

export async function inspectRawFile(file: File): Promise<RawFileInspection> {
  const bytes = await file.arrayBuffer();
  const inputSha256 = await sha256Hex(bytes);
  return {
    ...(await rawFileInspector(file.name, file.size, bytes, inputSha256)),
    inputSha256,
  };
}

export type RawFileInspectionBatch = {
  participantPartitionBatchId: string;
  /** Main-thread-only transient entropy. Never serialize or persist this. */
  secret: Uint8Array;
};

export type ParticipantPartitionTransport = {
  participantPartitionBatchId: string;
  fragmentedParticipantTokens: string[];
};

/**
 * Filename is the legacy progress/result identity. Until that surface carries
 * a stable per-selection ID, duplicate names must refuse instead of aliasing
 * distinct raw bytes in comparison, inspection display, or Retry.
 */
export function assertUniqueRawFileNames(files: File[]): void {
  const names = new Set<string>();
  if (
    files.some((file) => {
      const key = file.name.normalize("NFC").toLowerCase();
      if (names.has(key)) return true;
      names.add(key);
      return false;
    })
  ) {
    throw new Error(
      "Raw filenames must be unique; rename duplicates before inspection.",
    );
  }
}

export function commitRawFileSelectionAtomically(
  files: File[],
  commit: () => void,
): void {
  assertUniqueRawFileNames(files);
  commit();
}

export async function createRawFileInspectionBatch(): Promise<RawFileInspectionBatch> {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  try {
    const participantPartitionBatchId = await beginRawInspectionBatch(
      secret.slice().buffer,
    );
    return { participantPartitionBatchId, secret };
  } catch (error) {
    secret.fill(0);
    throw error;
  }
}

export async function disposeRawFileInspectionBatch(
  batch: RawFileInspectionBatch,
): Promise<void> {
  try {
    await disposeRawInspectionBatch(batch.participantPartitionBatchId);
  } finally {
    batch.secret.fill(0);
  }
}

/**
 * Release a batch whose result is no longer wanted (superseded, failed, or
 * unmounted). A failed release leaves only its scratch partitions behind, which
 * the next batch and "Delete all local data" remove, and must not replace the
 * error or result the user is about to see, so it is kept in the diagnostic
 * log instead of being shown.
 */
export async function releaseRawFileInspectionBatch(
  batch: RawFileInspectionBatch,
): Promise<void> {
  try {
    await disposeRawFileInspectionBatch(batch);
  } catch (error) {
    recordError("background", error, "raw file inspection batch cleanup");
  }
}

export async function inspectRawFiles(
  files: File[],
  batch?: RawFileInspectionBatch,
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
        inspection = rawFileInspector(
          file.name,
          file.size,
          bytes,
          inputSha256,
          batch?.participantPartitionBatchId,
        );
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

/**
 * Find participant streams present in more than one DISTINCT raw artifact.
 * Renamed byte-identical copies count once, and each result token vector is
 * sorted/unique for the strict Rust request boundary.
 */
export function fragmentedParticipantTokensByInputDigest(
  inspections: RawFileInspection[],
  expectedBatchId: string,
): Map<string, string[]> {
  if (!/^sha256:[0-9a-f]{64}$/.test(expectedBatchId)) {
    throw new Error(
      "Active raw-file inspection batch identity is malformed; re-inspect the files.",
    );
  }
  const tokensByDigest = new Map<string, string[]>();
  for (const inspection of inspections) {
    if (inspection.participantPartitionBatchId !== expectedBatchId) {
      throw new Error(
        "Raw-file participant partitions do not belong to the active inspection batch; re-inspect the files.",
      );
    }
    if (
      inspection.participantCount !== inspection.participantTokens.length ||
      inspection.participantTokens.some(
        (token, index) =>
          !/^sha256:[0-9a-f]{64}$/.test(token) ||
          (index > 0 && requireDefined(inspection.participantTokens[index - 1], "a token after the first has a predecessor") >= token),
      )
    ) {
      throw new Error(
        "Raw-file participant partition tokens are malformed; re-inspect the files.",
      );
    }
    const digest = inspection.inputSha256;
    if (!digest || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(
        "Raw-file inspection is missing its verified input digest; re-inspect the files.",
      );
    }
    const priorTokens = tokensByDigest.get(digest);
    if (
      priorTokens &&
      (priorTokens.length !== inspection.participantTokens.length ||
        priorTokens.some(
          (token, index) => token !== inspection.participantTokens[index],
        ))
    ) {
      throw new Error(
        "Byte-identical raw files have inconsistent participant partitions; re-inspect the files.",
      );
    }
    tokensByDigest.set(digest, [...inspection.participantTokens]);
  }
  const digestsByToken = new Map<string, Set<string>>();
  for (const [digest, tokens] of tokensByDigest) {
    for (const token of tokens) {
      const digests = digestsByToken.get(token) ?? new Set<string>();
      digests.add(digest);
      digestsByToken.set(token, digests);
    }
  }
  const fragmented = new Map<string, string[]>();
  for (const [digest, tokens] of tokensByDigest) {
    const selected = tokens
      .filter((token) => (digestsByToken.get(token)?.size ?? 0) > 1)
      .sort();
    if (selected.length) fragmented.set(digest, selected);
  }
  return fragmented;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
