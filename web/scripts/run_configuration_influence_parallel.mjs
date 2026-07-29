import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";

// On the 32-core reference machine, 12 workers and 31 workers both finish in
// about 60 seconds; 31 workers consume substantially more CPU. Keep the
// measured efficient default while allowing explicit scaling experiments.
const workerCount = Math.min(
  32,
  Math.max(
    1,
    Number(
      process.env.CHRONICLE_CAMPAIGN_WORKERS ??
        Math.min(12, availableParallelism() - 1),
    ),
  ),
);
if (!Number.isSafeInteger(workerCount)) {
  throw new Error("CHRONICLE_CAMPAIGN_WORKERS must be a positive integer");
}
const testFile = "src/lib/pipelineGraph/golden/configurationSpaceCampaign.test.ts";
const testName =
  "derives a digest-bound empirical influence map for every computational value transition";
const expectedFile = path.resolve(
  "src/lib/pipelineGraph/golden/family-expected/configuration-influence-ledger.json",
);
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "chronicle-config-influence-"));

/** @typedef {{ evidence: Record<string, any>, caseIdentities: string[] }} ShardResult */

/**
 * @param {number} index
 * @returns {Promise<ShardResult>}
 */
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
          INFLUENCE_SHARD_COUNT: String(workerCount),
          INFLUENCE_SHARD_INDEX: String(index),
          INFLUENCE_SHARD_OUTPUT: output,
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
        process.stdout.write(`configuration influence shard ${index + 1}/${workerCount} passed\n`);
        resolve(JSON.parse(readFileSync(output, "utf8")));
      } else {
        reject(
          new Error(
            `configuration influence shard ${index + 1}/${workerCount} failed (${code})\n${stdout}\n${stderr}`,
          ),
        );
      }
    });
  });
}

/** @param {ShardResult[]} shards @param {string} field */
function sum(shards, field) {
  return shards.reduce((total, shard) => total + shard.evidence.executionCounts[field], 0);
}

/** @param {ShardResult[]} shards @param {string} field */
function sumProof(shards, field) {
  return shards.reduce(
    (total, shard) => total + shard.evidence.exactPercolationProof[field],
    0,
  );
}

/** @param {ShardResult[]} shards @param {string} field @returns {any} */
function sameAcross(shards, field) {
  const first = JSON.stringify(shards[0].evidence[field]);
  if (shards.some((shard) => JSON.stringify(shard.evidence[field]) !== first)) {
    throw new Error(`configuration influence shards disagree on ${field}`);
  }
  return shards[0].evidence[field];
}

try {
  process.stdout.write(
    `running configuration influence campaign with ${workerCount} isolated WASM processes\n`,
  );
  const shards = await Promise.all(
    Array.from({ length: workerCount }, (_, index) => runShard(index)),
  );
  /** @type {string[]} */
  const optionOrder = sameAcross(shards, "computationalOptionOrder");
  const orderIndex = new Map(optionOrder.map((key, index) => [key, index]));
  /** @param {string} key */
  const optionRank = (key) => {
    const rank = orderIndex.get(key);
    if (rank === undefined) throw new Error(`unknown option report ${key}`);
    return rank;
  };
  const optionInfluence = shards
    .flatMap((shard) => shard.evidence.optionInfluence)
    .sort((left, right) => optionRank(left.optionKey) - optionRank(right.optionKey));
  if (optionInfluence.length !== optionOrder.length) {
    throw new Error(
      `parallel configuration influence campaign produced ${optionInfluence.length}/${optionOrder.length} option reports`,
    );
  }
  const axesWith = new Set(
    shards.flatMap((shard) => shard.evidence.axesWithSubstantiveObservedEffects),
  );
  const caseIdentities = shards.flatMap((shard) => shard.caseIdentities).sort();
  const caseSetDigest = `sha256:${createHash("sha256")
    .update(caseIdentities.join("\n"))
    .digest("hex")}`;
  const first = shards[0].evidence;
  const evidence = {
    protocolVersion: sameAcross(shards, "protocolVersion"),
    logicalCheckpointProtocol: sameAcross(shards, "logicalCheckpointProtocol"),
    claimBoundary: sameAcross(shards, "claimBoundary"),
    contractAuthority: sameAcross(shards, "contractAuthority"),
    planAuthority: sameAcross(shards, "planAuthority"),
    equivalenceClassAuthority: sameAcross(shards, "equivalenceClassAuthority"),
    implementationReceipt: sameAcross(shards, "implementationReceipt"),
    computationalDomainDigest: sameAcross(shards, "computationalDomainDigest"),
    computationalOptionCount: sameAcross(shards, "computationalOptionCount"),
    equivalenceClassValueCount: sameAcross(shards, "equivalenceClassValueCount"),
    syntheticCorpora: sameAcross(shards, "syntheticCorpora"),
    executionCounts: {
      requirementEvaluations: sum(shards, "requirementEvaluations"),
      coldExecutions: sum(shards, "coldExecutions"),
      orderedTransitions: sum(shards, "orderedTransitions"),
      incrementalExecutions: sum(shards, "incrementalExecutions"),
      totalRustExecutions: sum(shards, "totalRustExecutions"),
    },
    exactPercolationProof: {
      logicalStageCount: first.exactPercolationProof.logicalStageCount,
      pipelineStepCount: first.exactPercolationProof.pipelineStepCount,
      warmColdCheckpointComparisons: sumProof(shards, "warmColdCheckpointComparisons"),
      warmColdStepCheckpointComparisons: sumProof(
        shards,
        "warmColdStepCheckpointComparisons",
      ),
      exactClusterComparisons: sumProof(shards, "exactClusterComparisons"),
      staleCheckpointCases: sumProof(shards, "staleCheckpointCases"),
      clusterMismatchCases: sumProof(shards, "clusterMismatchCases"),
      stepClusterMismatchCases: sumProof(shards, "stepClusterMismatchCases"),
    },
    physicalExecutionBoundary: sameAcross(shards, "physicalExecutionBoundary"),
    axesWithSubstantiveObservedEffects: [...axesWith].sort(),
    axesWithoutSubstantiveObservedEffects: optionOrder.filter((key) => !axesWith.has(key)),
    computationalOptionOrder: optionOrder,
    optionInfluence,
    caseSetDigest,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (process.env.UPDATE_CONFIGURATION_SPACE === "1") {
    writeFileSync(expectedFile, serialized, "utf8");
    process.stdout.write(`updated ${path.relative(process.cwd(), expectedFile)}\n`);
  } else if (serialized !== readFileSync(expectedFile, "utf8")) {
    throw new Error(
      "parallel configuration influence result differs from the checked-in evidence; rerun with UPDATE_CONFIGURATION_SPACE=1 only after reviewing the change",
    );
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
