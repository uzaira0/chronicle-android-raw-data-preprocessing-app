import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEPENDENCY_EVIDENCE_GENERATED_PATHS,
  snapshotGeneratedPaths,
} from "../../scripts/generated_path_transaction.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((temporaryRoot) =>
      rm(temporaryRoot, { recursive: true, force: true }),
    ),
  );
});

describe("generated path transaction", () => {
  it("snapshots both generated WASM packages as one reseal transaction", () => {
    expect(DEPENDENCY_EVIDENCE_GENERATED_PATHS).toEqual(
      expect.arrayContaining([
        "web/src/wasm/chronicle_preprocessing_runtime_wasm",
        "web/src/wasm/chronicle_semantic_index_wasm",
      ]),
    );
  });

  it("restores every existing and newly-created generated package after failure", async () => {
    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "chronicle-generated-transaction-"),
    );
    temporaryRoots.push(temporaryRoot);
    const repositoryRoot = path.join(temporaryRoot, "repo");
    const backupRoot = path.join(temporaryRoot, "backup");
    const runtimePackage = path.join(repositoryRoot, "generated/runtime/pkg");
    const semanticPackage = path.join(repositoryRoot, "generated/semantic/pkg");
    const initiallyAbsent = path.join(repositoryRoot, "generated/new-evidence");
    await mkdir(runtimePackage, { recursive: true });
    await mkdir(semanticPackage, { recursive: true });
    writeFileSync(path.join(runtimePackage, "module.wasm"), "runtime-before");
    writeFileSync(path.join(semanticPackage, "module.wasm"), "semantic-before");

    const transaction = snapshotGeneratedPaths({
      repositoryRoot,
      backupRoot,
      relativePaths: [
        "generated/runtime",
        "generated/semantic",
        "generated/new-evidence",
      ],
    });
    writeFileSync(path.join(runtimePackage, "module.wasm"), "runtime-after");
    await rm(path.join(repositoryRoot, "generated/semantic"), {
      recursive: true,
      force: true,
    });
    await mkdir(initiallyAbsent, { recursive: true });
    writeFileSync(path.join(initiallyAbsent, "receipt.json"), "new");

    transaction.restore();

    expect(readFileSync(path.join(runtimePackage, "module.wasm"), "utf8")).toBe(
      "runtime-before",
    );
    expect(readFileSync(path.join(semanticPackage, "module.wasm"), "utf8")).toBe(
      "semantic-before",
    );
    expect(existsSync(initiallyAbsent)).toBe(false);
    transaction.cleanup();
    expect(existsSync(backupRoot)).toBe(false);
  });

  it("keeps restoring later paths and reports a part-way restore failure", async () => {
    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "chronicle-generated-transaction-"),
    );
    temporaryRoots.push(temporaryRoot);
    const repositoryRoot = path.join(temporaryRoot, "repo");
    const backupRoot = path.join(temporaryRoot, "backup");
    const runtimePackage = path.join(repositoryRoot, "generated/runtime/pkg");
    const semanticPackage = path.join(repositoryRoot, "generated/semantic/pkg");
    const initiallyAbsent = path.join(repositoryRoot, "generated/new-evidence");
    await mkdir(runtimePackage, { recursive: true });
    await mkdir(semanticPackage, { recursive: true });
    writeFileSync(path.join(runtimePackage, "module.wasm"), "runtime-before");
    writeFileSync(path.join(semanticPackage, "module.wasm"), "semantic-before");

    const transaction = snapshotGeneratedPaths({
      repositoryRoot,
      backupRoot,
      relativePaths: [
        "generated/runtime",
        "generated/semantic",
        "generated/new-evidence",
      ],
    });
    writeFileSync(path.join(runtimePackage, "module.wasm"), "runtime-after");
    writeFileSync(path.join(semanticPackage, "module.wasm"), "semantic-after");
    await mkdir(initiallyAbsent, { recursive: true });
    writeFileSync(path.join(initiallyAbsent, "receipt.json"), "new");
    // Break exactly the first path's backup so its aside-copy fails before
    // its source is touched.
    await rm(path.join(backupRoot, "0"), { recursive: true, force: true });

    let caught: unknown;
    try {
      transaction.restore();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).message).toContain("1 of 3");
    expect((caught as AggregateError).errors).toHaveLength(1);
    // Per-path atomicity: the failed path keeps its pre-restore content
    // rather than being deleted or half-copied.
    expect(readFileSync(path.join(runtimePackage, "module.wasm"), "utf8")).toBe(
      "runtime-after",
    );
    // No early abort: every later path still restored.
    expect(readFileSync(path.join(semanticPackage, "module.wasm"), "utf8")).toBe(
      "semantic-before",
    );
    expect(existsSync(initiallyAbsent)).toBe(false);
    // The backup survives for manual recovery.
    expect(existsSync(backupRoot)).toBe(true);
  });

  it("rejects duplicate and repository-escaping snapshot targets", () => {
    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "chronicle-generated-transaction-"),
    );
    temporaryRoots.push(temporaryRoot);
    const repositoryRoot = path.join(temporaryRoot, "repo");

    expect(() =>
      snapshotGeneratedPaths({
        repositoryRoot,
        backupRoot: path.join(temporaryRoot, "duplicate-backup"),
        relativePaths: ["generated/runtime", "generated/runtime"],
      }),
    ).toThrow("must be unique");
    expect(() =>
      snapshotGeneratedPaths({
        repositoryRoot,
        backupRoot: path.join(temporaryRoot, "escape-backup"),
        relativePaths: ["../outside"],
      }),
    ).toThrow("escapes the repository");
  });
});
