export const DEPENDENCY_EVIDENCE_GENERATED_PATHS: readonly string[];

export function snapshotGeneratedPaths(input: {
  repositoryRoot: string;
  backupRoot: string;
  relativePaths: string[];
}): {
  restore(): void;
  cleanup(): void;
};
