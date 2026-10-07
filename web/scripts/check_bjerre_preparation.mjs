#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const source = process.argv[2];
if (!source || process.argv.length !== 3) throw new Error("Usage: node check_bjerre_preparation.mjs PATH_TO_RELEASED_load_data.R");
const oracle = JSON.parse(readFileSync(resolve(repo, "rust/chronicle_preprocessing_runtime_wasm/tests/fixtures/bjerre_preparation_oracle.json"), "utf8"));
const directory = mkdtempSync(resolve(repo, ".tmp-literature-review-private/profile-runs/bjerre-cli-conformance-"));
/** @type {Map<string, string> | undefined} */
let baselineDigests;
let passed = 0;
for (const probe of [...oracle.cases, { ...oracle.cases[0], name: "baseline_repeat" }]) {
  const caseDirectory = resolve(directory, probe.name);
  mkdirSync(caseDirectory, { mode: 0o700 });
  const input = resolve(caseDirectory, "analysis.csv");
  writeFileSync(input, [probe.inputCsvLines].flat().join("\n") + "\n", { mode: 0o600 });
  const output = resolve(caseDirectory, "results");
  /** @type {import("node:child_process").SpawnSyncReturns<string>} */
  const result = spawnSync(process.execPath, [resolve(repo, "web/scripts/run_bjerre_preparation.mjs"),
    "--input", input, "--source", resolve(source), "--output", output], { encoding: "utf8" });
  if (probe.status === "error") {
    assert.notEqual(result.status, 0, probe.name);
    assert.equal(existsSync(resolve(output, "run.json")), false, probe.name);
    const failure = JSON.parse(readFileSync(resolve(output, "failure.json"), "utf8"));
    assert.equal(failure.error, probe.error, probe.name);
    assert.deepEqual(failure.warnings, [probe.warnings].flat(), `${probe.name}:warnings`);
  } else {
    assert.equal(result.status, 0, `${probe.name}: inspect private execution.log`);
    const metadata = JSON.parse(readFileSync(resolve(output, "tables.json"), "utf8"));
    for (const table of ["input", "course", "participant"]) assert.deepEqual(metadata[table], probe[table], `${probe.name}:${table}`);
    assert.deepEqual(metadata.warnings, [probe.warnings].flat(), `${probe.name}:warnings`);
    for (const key of ["sourceSha256", "R", "locale"]) assert.equal(metadata[key], oracle[key], `${probe.name}:${key}`);
    for (const key of ["initialAssignmentPipeAttachments", "finalAssignmentPipeAttachments"]) {
      assert.deepEqual(metadata[key], [oracle[key]].flat(), `${probe.name}:${key}`);
    }
    for (const pkg of oracle.packages) assert.deepEqual(metadata.packages.find(/** @param {{package: string}} candidate */ (candidate) => candidate.package === pkg.package), pkg);
    const run = JSON.parse(readFileSync(resolve(output, "run.json"), "utf8"));
    assert.deepEqual(run.artifacts.map(/** @param {{name: string}} artifact */ (artifact) => artifact.name).sort(), [
      "course_ind_df.rds", "ind_avr_df.rds", "course_ind_df.csv", "ind_avr_df.csv", "tables.json",
      "source-input.csv", "source-load_data.R", "driver.R",
    ].sort());
    const digests = new Map();
    for (const artifact of run.artifacts) {
      const path = resolve(output, artifact.name);
      assert.equal(`sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`, artifact.sha256);
      assert.equal(statSync(path).mode & 0o777, 0o600);
      digests.set(artifact.name, artifact.sha256);
    }
    assert.equal(digests.get("source-input.csv"), `sha256:${run.inputSha256}`);
    assert.equal(digests.get("source-load_data.R"), `sha256:${run.sourceSha256}`);
    assert.equal(digests.get("driver.R"), `sha256:${run.driverSha256}`);
    if (probe.name === "baseline") baselineDigests = digests;
    if (probe.name === "baseline_repeat") assert.deepEqual(digests, baselineDigests, "all eight retained artifacts must be byte-repeatable");
  }
  passed += 1;
  console.log(`${probe.name}: passed`);
}
console.log(JSON.stringify({ passed, retainedEvidenceDirectory: directory, fullProfileExecutionStatus: "blocked" }));
