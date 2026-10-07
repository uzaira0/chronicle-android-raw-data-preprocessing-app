import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

export const DEPENDENCY_EVIDENCE_GENERATED_PATHS = Object.freeze([
  "web/src/lib/pipelineGraph/golden/family-expected",
  "web/src/wasm/chronicle_preprocessing_runtime_wasm",
  "web/src/wasm/chronicle_semantic_index_wasm",
  ".semantic-federation/proofs/dependency-certificate.json",
  ".semantic-federation/proofs/footprints",
  ".semantic-federation/semantic/capability-bindings.json",
  ".semantic-federation/semantic/conformance-report.json",
  ".semantic-federation/semantic/artifact-closure.json",
  ".semantic-federation/semantic/resources",
  ".semantic-federation/semantic/semantic-profile.json",
  ".semantic-federation/semantic/semantic-profile.lock",
  "docs/semantic-federation/behavior-inventory.json",
]);

/**
 * @param {string} repositoryRoot
 * @param {string} relativePath
 */
function resolveGeneratedPath(repositoryRoot, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`generated path must be a non-empty relative path: ${relativePath}`);
  }
  const root = path.resolve(repositoryRoot);
  const source = path.resolve(root, relativePath);
  if (source === root || !source.startsWith(`${root}${path.sep}`)) {
    throw new Error(`generated path escapes the repository: ${relativePath}`);
  }
  return source;
}

/**
 * Snapshot every generated path before a multi-stage reseal begins.
 *
 * The returned restore operation is idempotent and restores both paths that
 * existed and paths that were absent at snapshot time. Call cleanup only after
 * restore is no longer needed.
 *
 * @param {{repositoryRoot: string, backupRoot: string, relativePaths: string[]}} input
 */
export function snapshotGeneratedPaths({
  repositoryRoot,
  backupRoot,
  relativePaths,
}) {
  const uniquePaths = new Set(relativePaths);
  if (uniquePaths.size !== relativePaths.length) {
    throw new Error("generated snapshot paths must be unique");
  }
  const snapshots = relativePaths.map((relativePath, index) => {
    const source = resolveGeneratedPath(repositoryRoot, relativePath);
    const backup = path.join(backupRoot, String(index));
    const existed = existsSync(source);
    if (existed) cpSync(source, backup, { recursive: true });
    return { source, backup, existed };
  });
  let cleaned = false;
  return {
    restore() {
      if (cleaned) {
        throw new Error("generated snapshot backup was already cleaned");
      }
      // Two properties this loop must keep:
      //   1. per-path atomicity -- copy the backup ASIDE first, then swap it
      //      into place with rename, so a failure (disk full mid-copy) never
      //      leaves a path deleted-or-partial;
      //   2. no early abort -- one failing path must not leave every later
      //      path still holding campaign output. Collect the failures and
      //      throw them together at the end.
      const failures = [];
      for (const snapshot of snapshots) {
        try {
          if (snapshot.existed) {
            mkdirSync(path.dirname(snapshot.source), { recursive: true });
            const staging = `${snapshot.source}.restore-tmp`;
            rmSync(staging, { recursive: true, force: true });
            cpSync(snapshot.backup, staging, { recursive: true });
            rmSync(snapshot.source, { recursive: true, force: true });
            renameSync(staging, snapshot.source);
          } else {
            rmSync(snapshot.source, { recursive: true, force: true });
          }
        } catch (error) {
          failures.push(
            new Error(`restore of ${snapshot.source} failed: ${error}`),
          );
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `generated-path restore failed for ${failures.length} of ${snapshots.length} paths; the backup is retained`,
        );
      }
    },
    cleanup() {
      if (cleaned) return;
      rmSync(backupRoot, { recursive: true, force: true });
      cleaned = true;
    },
  };
}
