import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DEPENDENCY_EVIDENCE_GENERATED_PATHS } from "./generated_path_transaction.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(webRoot, "..");
const backupArgument = process.argv[2];

if (process.argv.length !== 3 || !backupArgument) {
  throw new Error(
    "usage: node scripts/restore_dependency_evidence_backup.mjs <explicit-backup-path>",
  );
}

const backupRoot = realpathSync(path.resolve(backupArgument));
if (
  path.dirname(backupRoot) !== webRoot ||
  !path.basename(backupRoot).startsWith(".tmp-dependency-evidence-backup-")
) {
  throw new Error(`refusing non-Chronicle dependency-evidence backup: ${backupRoot}`);
}

const expectedIndices = DEPENDENCY_EVIDENCE_GENERATED_PATHS.map((_, index) =>
  String(index),
);
const actualIndices = readdirSync(backupRoot).sort(
  (left, right) => Number(left) - Number(right),
);
if (JSON.stringify(actualIndices) !== JSON.stringify(expectedIndices)) {
  throw new Error(
    `backup must contain exactly indices ${expectedIndices.join(",")}; saw ${actualIndices.join(",")}`,
  );
}

/** @param {string} target */
function fingerprint(target) {
  const stat = lstatSync(target);
  const hash = createHash("sha256");
  hash.update(String(stat.mode & 0o777));
  hash.update("\0");
  if (stat.isFile()) {
    hash.update("file\0");
    hash.update(readFileSync(target));
    return hash.digest("hex");
  }
  if (!stat.isDirectory()) {
    throw new Error(`refusing unsupported file type: ${target}`);
  }
  hash.update("directory\0");
  for (const name of readdirSync(target).sort()) {
    hash.update(name);
    hash.update("\0");
    hash.update(fingerprint(path.join(target, name)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const entries = DEPENDENCY_EVIDENCE_GENERATED_PATHS.map(
  (relativePath, index) => {
    const backup = path.join(backupRoot, String(index));
    const destination = path.resolve(repositoryRoot, relativePath);
    const staging = `${destination}.restore-tmp`;
    if (!existsSync(destination)) {
      throw new Error(`refusing missing destination: ${destination}`);
    }
    if (lstatSync(backup).isDirectory() !== lstatSync(destination).isDirectory()) {
      throw new Error(`backup/destination type mismatch: ${relativePath}`);
    }
    if (existsSync(staging)) {
      throw new Error(`refusing existing restore staging path: ${staging}`);
    }
    return {
      backup,
      before: fingerprint(destination),
      destination,
      expected: fingerprint(backup),
      relativePath,
      staging,
    };
  },
);

for (const entry of entries) {
  cpSync(entry.backup, entry.staging, { recursive: true });
  if (fingerprint(entry.staging) !== entry.expected) {
    throw new Error(`staged copy verification failed: ${entry.relativePath}`);
  }
}
for (const entry of entries) {
  if (fingerprint(entry.destination) !== entry.before) {
    throw new Error(`destination changed during staging: ${entry.relativePath}`);
  }
}

const failures = [];
for (const entry of entries) {
  try {
    rmSync(entry.destination, { recursive: true, force: true });
    renameSync(entry.staging, entry.destination);
    if (fingerprint(entry.destination) !== entry.expected) {
      throw new Error("post-rename verification failed");
    }
  } catch (error) {
    failures.push(new Error(`restore failed for ${entry.relativePath}: ${error}`));
  }
}
if (failures.length > 0) {
  throw new AggregateError(
    failures,
    `dependency-evidence recovery failed for ${failures.length} of ${entries.length} paths; backup retained at ${backupRoot}`,
  );
}

process.stdout.write(
  `restored and verified ${entries.length} generated paths; backup retained at ${backupRoot}\n`,
);
