import { describe, expect, it } from "vitest";

import type { RawFileInspection } from "@/lib/fileInspection";
import { rawInspectionSelectionIsReady } from "@/lib/rawInspectionReadiness";

const batchId = `sha256:${"a".repeat(64)}`;
const token = `sha256:${"b".repeat(64)}`;
const digest = "c".repeat(64);

function fixture(): {
  file: File;
  inspection: RawFileInspection;
} {
  const file = new File(["x"], "raw.csv");
  return {
    file,
    inspection: {
      fileName: file.name,
      sizeBytes: file.size,
      inputSha256: digest,
      rowCount: 1,
      participantCount: 1,
      participantPartitionBatchId: batchId,
      participantTokens: [token],
      columns: [],
      timezones: [],
      hasRequiredColumns: true,
      invalidTimestampCount: 0,
      missingTimestampCount: 0,
      missingTimezoneCount: 0,
      duplicateTimestampCount: 0,
      outOfOrderTimestampCount: 0,
      firstOutOfOrderRow: null,
      unrecognizedInteractionTypes: [],
      screenStartEventCount: 0,
      warnings: [],
    },
  };
}

describe("rawInspectionSelectionIsReady", () => {
  it("requires an exact current file/digest/batch/token witness", () => {
    const { file, inspection } = fixture();
    expect(
      rawInspectionSelectionIsReady(
        [file],
        [inspection],
        batchId,
        () => digest,
      ),
    ).toBe(true);
    for (const changed of [
      [],
      [{ ...inspection, inputSha256: "d".repeat(64) }],
      [{ ...inspection, participantPartitionBatchId: null }],
      [{ ...inspection, participantTokens: [] }],
    ]) {
      expect(
        rawInspectionSelectionIsReady([file], changed, batchId, () => digest),
      ).toBe(false);
    }
    expect(
      rawInspectionSelectionIsReady(
        [file],
        [inspection],
        undefined,
        () => digest,
      ),
    ).toBe(false);
  });
});
