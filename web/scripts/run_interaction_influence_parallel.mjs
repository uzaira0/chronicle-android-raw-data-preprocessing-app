import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";

const requestedWorkers = Number(
  process.env.CHRONICLE_CAMPAIGN_WORKERS ?? availableParallelism() - 1,
);
if (!Number.isInteger(requestedWorkers) || requestedWorkers < 1) {
  throw new Error("CHRONICLE_CAMPAIGN_WORKERS must be a positive integer");
}
const workerCount = Math.min(12, requestedWorkers);
const testFile = "src/lib/pipelineGraph/golden/interactionTomography.test.ts";
const testName =
  "exhausts all computational-axis pairs and proves every warm two-factor cone";
const expectedFile = path.resolve(
  "src/lib/pipelineGraph/golden/family-expected/interaction-influence-ledger.json",
);
const temporaryRoot = mkdtempSync(
  path.resolve(".tmp-interaction-influence-"),
);

/**
 * @typedef {{
 *   evidence: Record<string, any>,
 *   pairCases: string[],
 *   pairOrder: Array<{ ordinal: number, pairId: string }>
 * }} ShardResult
 */

/** @param {number} index @returns {Promise<ShardResult>} */
function runShard(index) {
  const output = path.join(temporaryRoot, `shard-${index}.json`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/run-clean-env.mjs", "vitest", "run", testFile, "-t", testName],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          INTERACTION_SHARD_COUNT: String(workerCount),
          INTERACTION_SHARD_INDEX: String(index),
          INTERACTION_SHARD_OUTPUT: output,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        process.stdout.write(
          `interaction influence shard ${index + 1}/${workerCount} passed\n`,
        );
        resolve(JSON.parse(readFileSync(output, "utf8")));
      } else {
        reject(
          new Error(
            `interaction influence shard ${index + 1}/${workerCount} failed (${code})\n${stdout}\n${stderr}`,
          ),
        );
      }
    });
  });
}

/** @param {ShardResult[]} shards @param {string} field @returns {any} */
function sameAcross(shards, field) {
  const firstShard = shards[0];
  if (!firstShard) throw new Error("no shard results to aggregate");
  const first = JSON.stringify(firstShard.evidence[field]);
  if (shards.some((shard) => JSON.stringify(shard.evidence[field]) !== first)) {
    throw new Error(`interaction influence shards disagree on ${field}`);
  }
  return firstShard.evidence[field];
}

/** @param {ShardResult[]} shards @param {string} field */
function sumCoverage(shards, field) {
  return shards.reduce((total, shard) => total + shard.evidence.coverage[field], 0);
}

try {
  process.stdout.write(
    `running interaction influence campaign with ${workerCount} isolated WASM processes\n`,
  );
  const settled = await Promise.allSettled(
    Array.from({ length: workerCount }, (_, index) => runShard(index)),
  );
  const failures = settled.filter(
    (result) => result.status === "rejected",
  );
  if (failures.length > 0) {
    throw new Error(
      failures
        .map((failure) => String(failure.reason))
        .join("\n\n"),
    );
  }
  const shards = settled.map((result) => {
    if (result.status !== "fulfilled") {
      throw new Error("unreachable rejected interaction shard");
    }
    return result.value;
  });
  const pairOrder = shards
    .flatMap((shard) => shard.pairOrder)
    .sort((left, right) => left.ordinal - right.ordinal);
  for (let index = 0; index < pairOrder.length; index += 1) {
    if (pairOrder[index]?.ordinal !== index) {
      throw new Error(`interaction pair ordinal ${index} is missing or duplicated`);
    }
  }
  const pairRank = new Map(
    pairOrder.map(({ pairId, ordinal }) => [pairId, ordinal]),
  );
  if (pairRank.size !== pairOrder.length) {
    throw new Error("interaction pair identifiers are not unique");
  }
  /** @param {Record<string, any>} entry */
  const rankPair = (entry) => {
    const rank = pairRank.get(entry.pairId);
    if (rank === undefined) throw new Error(`unknown interaction pair ${entry.pairId}`);
    return rank;
  };
  /** @param {string} field */
  const mergedPairs = (field) =>
    shards
      .flatMap((shard) => shard.evidence[field])
      .sort((left, right) => rankPair(left) - rankPair(right));

  const invalidPairs = mergedPairs("invalidPairs");
  const qualificationEnabledPairs = mergedPairs("qualificationEnabledPairs");
  const nonAdditivePairs = mergedPairs("nonAdditivePairs");
  const pairCases = shards.flatMap((shard) => shard.pairCases).sort();
  const pairCaseDigest = `sha256:${createHash("sha256")
    .update(pairCases.join("\n"))
    .digest("hex")}`;
  const firstShard = shards[0];
  if (!firstShard) throw new Error("no shard results to aggregate");
  const firstCoverage = firstShard.evidence.coverage;
  const validPairContrasts = sumCoverage(shards, "validPairContrasts");
  const invalidPairContrasts = sumCoverage(shards, "invalidPairContrasts");
  const enumeratedPairContrasts = validPairContrasts + invalidPairContrasts;
  if (enumeratedPairContrasts !== pairOrder.length) {
    throw new Error(
      `interaction shards reported ${enumeratedPairContrasts} contrasts but ordered ${pairOrder.length}`,
    );
  }
  if (pairCases.length !== validPairContrasts) {
    throw new Error(
      `interaction shards produced ${pairCases.length}/${validPairContrasts} valid case records`,
    );
  }
  if (invalidPairs.length !== invalidPairContrasts) {
    throw new Error(
      `interaction shards produced ${invalidPairs.length}/${invalidPairContrasts} invalid pair records`,
    );
  }

  const evidence = {
    protocolVersion: sameAcross(shards, "protocolVersion"),
    claimBoundary: sameAcross(shards, "claimBoundary"),
    plan: sameAcross(shards, "plan"),
    implementationReceipt: sameAcross(shards, "implementationReceipt"),
    fixture: sameAcross(shards, "fixture"),
    coverage: {
      axes: firstCoverage.axes,
      declaredAlternates: firstCoverage.declaredAlternates,
      validSingleContrasts: firstCoverage.validSingleContrasts,
      invalidSingleContrasts: firstCoverage.invalidSingleContrasts,
      enumeratedPairContrasts,
      validPairContrasts,
      invalidPairContrasts,
      coldExecutions:
        1 + firstCoverage.validSingleContrasts + validPairContrasts,
      incrementalExecutions: validPairContrasts * 2,
      totalRustExecutions:
        1 + firstCoverage.validSingleContrasts + validPairContrasts * 3,
      warmColdComparisons: sumCoverage(shards, "warmColdComparisons"),
      warmColdQueryCheckpointComparisons: sumCoverage(
        shards,
        "warmColdQueryCheckpointComparisons",
      ),
      exactClusterComparisons: sumCoverage(shards, "exactClusterComparisons"),
      exactQueryClusterComparisons: sumCoverage(
        shards,
        "exactQueryClusterComparisons",
      ),
      workflowQueryGroupCount: firstCoverage.workflowQueryGroupCount,
      workflowQueryCount: firstCoverage.workflowQueryCount,
      nonAdditivePairs: nonAdditivePairs.length,
      qualificationEnabledPairs: qualificationEnabledPairs.length,
    },
    invalidSingles: sameAcross(shards, "invalidSingles"),
    invalidPairs,
    qualificationEnabledPairs,
    nonAdditivePairs,
    pairCaseDigest,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (process.env.UPDATE_INTERACTION_INFLUENCE === "1") {
    writeFileSync(expectedFile, serialized, "utf8");
    process.stdout.write(
      `updated ${path.relative(process.cwd(), expectedFile)}\n`,
    );
  } else {
    const expected = readFileSync(expectedFile, "utf8");
    if (serialized !== expected) {
      const expectedEvidence = JSON.parse(expected);
      const actualEvidence = /** @type {Record<string, any>} */ (evidence);
      const changedFields = [
        ...new Set([...Object.keys(expectedEvidence), ...Object.keys(actualEvidence)]),
      ].filter(
        (field) =>
          JSON.stringify(expectedEvidence[field]) !==
          JSON.stringify(actualEvidence[field]),
      );
      throw new Error(
        `parallel interaction influence result differs from the checked-in evidence (top-level drift: ${changedFields.join(", ")}); rerun with UPDATE_INTERACTION_INFLUENCE=1 only after reviewing the change`,
      );
    }
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
