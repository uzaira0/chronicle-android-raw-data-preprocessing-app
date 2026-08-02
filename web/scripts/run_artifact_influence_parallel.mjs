import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";

const workerCount = Math.min(
  6,
  Math.max(1, Number(process.env.CHRONICLE_CAMPAIGN_WORKERS ?? availableParallelism() - 1)),
);
const testFile = "src/lib/pipelineGraph/golden/artifactInterventionCampaign.test.ts";
const expectedFile = path.resolve(
  "src/lib/pipelineGraph/golden/family-expected/artifact-influence-ledger.json",
);
const cellEvidenceFile = path.resolve(
  "src/lib/pipelineGraph/golden/family-expected/artifact-output-cell-correspondence.json.gz",
);
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "chronicle-artifact-influence-"));

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
          ARTIFACT_SHARD_COUNT: String(workerCount),
          ARTIFACT_SHARD_INDEX: String(index),
          ARTIFACT_SHARD_OUTPUT: output,
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
        process.stdout.write(`artifact influence shard ${index + 1}/${workerCount} passed\n`);
        resolve(JSON.parse(readFileSync(output, "utf8")));
      } else {
        reject(
          new Error(
            `artifact influence shard ${index + 1}/${workerCount} failed (${code})\n${stdout}\n${stderr}`,
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
    throw new Error(`artifact influence shards disagree on ${field}`);
  }
  return firstShard.evidence[field];
}

/** @param {ShardResult[]} shards @param {string} field */
function sumExecution(shards, field) {
  return shards.reduce((total, shard) => total + shard.evidence.executionCounts[field], 0);
}

try {
  process.stdout.write(
    `running artifact influence campaign with ${workerCount} isolated WASM processes\n`,
  );
  const shards = await Promise.all(
    Array.from({ length: workerCount }, (_, index) => runShard(index)),
  );
  /** @type {string[]} */
  const corpusOrder = sameAcross(shards, "coverage").corpora;
  const corpusRank = new Map(corpusOrder.map((id, index) => [id, index]));
  /** @param {string} id */
  const rankCorpus = (id) => corpusRank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const reports = shards
    .flatMap((shard) => shard.evidence.interventions)
    .sort((left, right) => rankCorpus(left.corpusId) - rankCorpus(right.corpusId));
  const fixtures = shards
    .flatMap((shard) => shard.evidence.fixtures)
    .sort((left, right) => rankCorpus(left.corpusId) - rankCorpus(right.corpusId));
  const substantiveIds = new Set(
    reports
      .filter((report) => report.expectedSemanticEffect === "required")
      .map((report) => report.interventionId),
  );
  const witnessedIds = new Set(
    reports.filter((report) => report.observedSemanticEffect).map((report) => report.interventionId),
  );
  const missingWitnesses = [...substantiveIds].filter((id) => !witnessedIds.has(id));
  if (missingWitnesses.length > 0) {
    throw new Error(`substantive artifact interventions lack witnesses: ${missingWitnesses.join(",")}`);
  }

  const activation = new Map();
  for (const shard of shards) {
    /** @type {Record<string, { activeCorpora: string[], convergedCorpora: string[] }>} */
    const shardContexts = shard.evidence.activationContexts;
    for (const [interventionId, contexts] of Object.entries(shardContexts)) {
      const aggregate = activation.get(interventionId) ?? {
        active: new Set(),
        converged: new Set(),
      };
      contexts.activeCorpora.forEach((id) => aggregate.active.add(id));
      contexts.convergedCorpora.forEach((id) => aggregate.converged.add(id));
      activation.set(interventionId, aggregate);
    }
  }
  const activationContexts = Object.fromEntries(
    [...activation]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, contexts]) => [
        id,
        {
          activeCorpora: [...contexts.active].sort(),
          convergedCorpora: [...contexts.converged].sort(),
        },
      ]),
  );

  const receipt = sameAcross(shards, "implementationReceipt");
  const cellEvidenceCases = shards
    .flatMap((shard) => shard.cellEvidenceCases)
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  const cellEvidenceSerialized = `${JSON.stringify(
    {
      protocolVersion: "chronicle-output-cell-correspondence/v2",
      implementationReceipt: receipt,
      claimBoundary:
        "Exact changed canonical CSV/JSON output cell addresses for each named raw/support intervention. Each case also names the exact supplied source columns that intervention rewrote (sourceFields), in the Rust step contract's field namespace, using source.raw_row_set / source.raw_row_order for structural raw changes and an empty list for representation-only controls. Binary exports and the Arrow lineage sidecar are digest-bound separately and are not interpreted as cells.",
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
      protocolVersion: "chronicle-output-cell-correspondence/v2",
      path: "artifact-output-cell-correspondence.json.gz",
      contentDigest: cellEvidenceDigest,
      cases: cellEvidenceCases.length,
      changedCellAddresses: cellEvidenceCases.reduce(
        (total, entry) => total + entry.changedOutputCellAddresses.length,
        0,
      ),
    },
    fixtures,
    coverage: sameAcross(shards, "coverage"),
    activationContexts,
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
  if (process.env.UPDATE_ARTIFACT_INFLUENCE === "1") {
    writeFileSync(cellEvidenceFile, cellEvidenceCompressed);
    writeFileSync(expectedFile, serialized, "utf8");
    process.stdout.write("updated artifact influence evidence\n");
  } else if (
    serialized !== readFileSync(expectedFile, "utf8") ||
    !cellEvidenceCompressed.equals(readFileSync(cellEvidenceFile))
  ) {
    throw new Error(
      "parallel artifact influence result differs from checked-in evidence; rerun with UPDATE_ARTIFACT_INFLUENCE=1 only after reviewing the change",
    );
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
