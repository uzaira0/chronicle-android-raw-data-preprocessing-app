import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const expectedDirectory = resolve(
  webRoot,
  "src/lib/pipelineGraph/golden/family-expected",
);
const aggregateFile = join(
  expectedDirectory,
  "mixed-artifact-configuration-ledger.json",
);
const testFile = "src/lib/pipelineGraph/golden/mixedArtifactConfigurationTomography.test.ts";
const roles = [
  "raw_chronicle_csv",
  "filter_file",
  "apps_forcing_screen_open_file",
  "background_apps_file",
  "app_codebook_file",
  "study_dates_file",
  "device_sharing_file",
  "survey_attribution_file",
  "enrolled_devices_file",
];
const update = process.env.UPDATE_MIXED_INFLUENCE === "1";
const maxParallel = Number(process.env.MIXED_MAX_PARALLEL ?? "3");
if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > roles.length) {
  throw new Error("MIXED_MAX_PARALLEL must be an integer from 1 through 9");
}

/** @param {import("node:crypto").BinaryLike} bytes */
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** @param {string} role */
async function runRole(role) {
  process.stdout.write(`\n── mixed artifact × configuration shard: ${role}\n`);
  const child = spawn(
    resolve(webRoot, "node_modules/.bin/vitest"),
    ["run", testFile],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        MIXED_ROLE: role,
        UPDATE_MIXED_INFLUENCE: update ? "1" : "0",
      },
      stdio: "inherit",
    },
  );
  await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise(undefined);
      else reject(new Error(`${role}: shard exited code=${code} signal=${signal}`));
    });
  });
}

for (let index = 0; index < roles.length; index += maxParallel) {
  await Promise.all(roles.slice(index, index + maxParallel).map(runRole));
}

const shards = roles.map((role) => {
  const path = join(
    expectedDirectory,
    `mixed-artifact-configuration-${role}.json`,
  );
  const bytes = readFileSync(path);
  return {
    roleId: role,
    path: relative(expectedDirectory, path),
    contentDigest: sha256(bytes),
    ledger: JSON.parse(bytes.toString("utf8")),
  };
});
const firstShard = shards[0];
if (!firstShard) throw new Error("no mixed influence shards to aggregate");
const receipt = firstShard.ledger.implementationReceipt;
for (const shard of shards) {
  if (JSON.stringify(shard.ledger.implementationReceipt) !== JSON.stringify(receipt)) {
    throw new Error(`${shard.roleId}: mixed ledger authority receipt drift`);
  }
}
/** @param {string} field */
const sum = (field) =>
  shards.reduce((total, shard) => total + shard.ledger.coverage[field], 0);
const aggregate = {
  protocolVersion: "chronicle-mixed-artifact-configuration-aggregate/v1",
  claimBoundary:
    "Aggregate of nine independently recycled exhaustive role/value shards. Each shard selects one empirically branch-activating intervention for its source role, crosses it with every valid alternate value of all 46 computational axes, executes both transition orders, and compares every final workflow checkpoint, output artifact, and canonical output cell with an independent cold Rust/WASM target. Field/record interactions beyond the selected representative remain outside this claim.",
  implementationReceipt: receipt,
  coverage: {
    sourceRoles: shards.length,
    computationalAxes: firstShard.ledger.coverage.computationalAxes,
    declaredAlternateValues: firstShard.ledger.coverage.declaredAlternateValues,
    validConfigurationVariants: firstShard.ledger.coverage.validConfigurationVariants,
    invalidConfigurationVariants: firstShard.ledger.coverage.invalidConfigurationVariants,
    validRoleValuePairs: sum("validRoleValuePairs"),
    coldExecutions: sum("coldExecutions"),
    incrementalExecutions: sum("incrementalExecutions"),
    totalRustExecutions: sum("totalRustExecutions"),
    warmColdComparisons: sum("warmColdComparisons"),
    exactClusterComparisons: sum("exactClusterComparisons"),
    nonAdditiveOrMaskedPairs: sum("nonAdditiveOrMaskedPairs"),
  },
  roleShards: shards.map(({ roleId, path, contentDigest, ledger }) => ({
    roleId,
    path,
    contentDigest,
    representative: ledger.roleRepresentatives[roleId],
    validRoleValuePairs: ledger.coverage.validRoleValuePairs,
    nonAdditiveOrMaskedPairs: ledger.coverage.nonAdditiveOrMaskedPairs,
    caseSetDigest: ledger.caseSetDigest,
  })),
};
const serialized = `${JSON.stringify(aggregate, null, 2)}\n`;
if (update) {
  writeFileSync(aggregateFile, serialized, "utf8");
} else if (serialized !== readFileSync(aggregateFile, "utf8")) {
  throw new Error("mixed artifact/configuration aggregate ledger drift");
}
process.stdout.write(
  `\nmixed_role_value_pairs=${aggregate.coverage.validRoleValuePairs} total_rust_executions=${aggregate.coverage.totalRustExecutions} interactions=${aggregate.coverage.nonAdditiveOrMaskedPairs}\n`,
);
