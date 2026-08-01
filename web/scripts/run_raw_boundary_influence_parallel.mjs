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
import { gzipSync } from "node:zlib";

const corpusCount = 6;
const workerCount = Math.min(
  corpusCount,
  Math.max(1, Number(process.env.CHRONICLE_CAMPAIGN_WORKERS ?? availableParallelism() - 1)),
);
if (!Number.isSafeInteger(workerCount)) {
  throw new Error(`invalid raw-boundary worker count ${workerCount}`);
}

const testFile = "src/lib/pipelineGraph/golden/rawBoundaryTomography.test.ts";
const expectedFile = path.resolve(
  "src/lib/pipelineGraph/golden/family-expected/raw-boundary-influence-ledger.json",
);
const cellEvidenceFile = path.resolve(
  "src/lib/pipelineGraph/golden/family-expected/raw-boundary-output-cell-correspondence.json.gz",
);
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "chronicle-raw-boundary-"));

/** @typedef {{ evidence: Record<string, any>, cellEvidenceCases: any[], caseIdentities: string[] }} ShardResult */

/** @param {number} index @returns {Promise<ShardResult>} */
function runShard(index) {
  const output = path.join(temporaryRoot, `shard-${index}.json`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/run-clean-env.mjs", "vitest", "run", testFile],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          RAW_BOUNDARY_SHARD_COUNT: String(workerCount),
          RAW_BOUNDARY_SHARD_INDEX: String(index),
          RAW_BOUNDARY_SHARD_OUTPUT: output,
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
        process.stdout.write(`raw-boundary shard ${index + 1}/${workerCount} passed\n`);
        resolve(JSON.parse(readFileSync(output, "utf8")));
      } else {
        reject(
          new Error(
            `raw-boundary shard ${index + 1}/${workerCount} failed (${code})\n${stdout}\n${stderr}`,
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
    throw new Error(`raw-boundary shards disagree on ${field}`);
  }
  return firstShard.evidence[field];
}

/** @param {ShardResult[]} shards @param {string} field */
function sumExecution(shards, field) {
  return shards.reduce((total, shard) => total + shard.evidence.executionCounts[field], 0);
}

try {
  process.stdout.write(
    `running raw-boundary campaign with ${workerCount} isolated WASM processes\n`,
  );
  const shards = await Promise.all(
    Array.from({ length: workerCount }, (_, index) => runShard(index)),
  );
  const coverage = sameAcross(shards, "coverage");
  /** @type {string[]} */
  const corpusOrder = coverage.corpora;
  const corpusRank = new Map(corpusOrder.map((id, index) => [id, index]));
  /** @param {string} id */
  const rankCorpus = (id) => {
    const rank = corpusRank.get(id);
    if (rank === undefined) throw new Error(`unknown raw-boundary corpus ${id}`);
    return rank;
  };
  const fixtureReceipts = shards
    .flatMap((shard) => shard.evidence.fixtureReceipts)
    .sort((left, right) => rankCorpus(left.corpusId) - rankCorpus(right.corpusId));
  const reports = shards
    .flatMap((shard) => shard.evidence.interventions)
    .sort((left, right) => rankCorpus(left.corpusId) - rankCorpus(right.corpusId));
  if (
    fixtureReceipts.length !== corpusOrder.length ||
    new Set(fixtureReceipts.map(({ corpusId }) => corpusId)).size !== corpusOrder.length
  ) {
    throw new Error("parallel raw-boundary campaign did not cover every corpus exactly once");
  }

  const receipt = sameAcross(shards, "implementationReceipt");
  const cellEvidenceCases = shards
    .flatMap((shard) => shard.cellEvidenceCases)
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  const cellEvidenceSerialized = `${JSON.stringify(
    {
      protocolVersion: "chronicle-output-cell-correspondence/v1",
      implementationReceipt: receipt,
      claimBoundary:
        "Exact changed canonical CSV/JSON output cell addresses for each named raw timestamp boundary intervention. Binary exports and the Arrow lineage sidecar are digest-bound separately and are not interpreted as cells.",
      cases: cellEvidenceCases,
    },
    null,
    2,
  )}\n`;
  const cellEvidenceCompressed = gzipSync(cellEvidenceSerialized, { level: 9 });
  const cellEvidenceDigest = `sha256:${createHash("sha256")
    .update(cellEvidenceSerialized)
    .digest("hex")}`;
  const caseIdentities = shards.flatMap((shard) => shard.caseIdentities).sort();
  const caseSetDigest = `sha256:${createHash("sha256")
    .update(caseIdentities.join("\n"))
    .digest("hex")}`;
  const firstShard = shards[0];
  if (!firstShard) throw new Error("no shard results to aggregate");
  const first = firstShard.evidence;
  const evidence = {
    protocolVersion: sameAcross(shards, "protocolVersion"),
    logicalCheckpointProtocol: sameAcross(shards, "logicalCheckpointProtocol"),
    claimBoundary: sameAcross(shards, "claimBoundary"),
    plan: sameAcross(shards, "plan"),
    implementationReceipt: receipt,
    cellEvidence: {
      protocolVersion: "chronicle-output-cell-correspondence/v1",
      path: "raw-boundary-output-cell-correspondence.json.gz",
      contentDigest: cellEvidenceDigest,
      cases: cellEvidenceCases.length,
      changedCellAddresses: cellEvidenceCases.reduce(
        (total, entry) => total + entry.changedOutputCellAddresses.length,
        0,
      ),
    },
    coverage,
    fixtureReceipts,
    executionCounts: Object.fromEntries(
      Object.keys(first.executionCounts).map((field) => [
        field,
        sumExecution(shards, field),
      ]),
    ),
    interventions: reports,
    caseSetDigest,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (process.env.UPDATE_RAW_BOUNDARY_INFLUENCE === "1") {
    writeFileSync(cellEvidenceFile, cellEvidenceCompressed);
    writeFileSync(expectedFile, serialized, "utf8");
    process.stdout.write("updated raw-boundary influence evidence\n");
  } else if (
    serialized !== readFileSync(expectedFile, "utf8") ||
    !cellEvidenceCompressed.equals(readFileSync(cellEvidenceFile))
  ) {
    throw new Error(
      "parallel raw-boundary result differs from the checked-in evidence; rerun with UPDATE_RAW_BOUNDARY_INFLUENCE=1 only after reviewing the change",
    );
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
