import type { RawFileInspection } from "@/lib/fileInspection";

export function rawInspectionSelectionIsReady(
  files: File[],
  inspections: RawFileInspection[],
  participantPartitionBatchId: string | undefined,
  digestForFile: (file: File) => string | undefined,
): boolean {
  return (
    !!participantPartitionBatchId &&
    inspections.length === files.length &&
    files.every((file, index) => {
      const inspection = inspections[index];
      const digest = digestForFile(file);
      return (
        !!inspection &&
        inspection.fileName === file.name &&
        inspection.sizeBytes === file.size &&
        !!digest &&
        inspection.inputSha256 === digest &&
        inspection.participantPartitionBatchId ===
          participantPartitionBatchId &&
        inspection.participantCount === inspection.participantTokens.length
      );
    })
  );
}
