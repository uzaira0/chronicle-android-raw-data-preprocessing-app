#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const options = new Map();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!key || !["--input", "--source", "--output"].includes(key) || !value || options.has(key)) {
    throw new Error("Usage: node run_bjerre_preparation.mjs --input analysis.csv --source load_data.R --output NEW_DIRECTORY");
  }
  options.set(key, value);
}
if (options.size !== 3) throw new Error("--input, --source and --output are required");
const input = realpathSync(options.get("--input"));
const source = realpathSync(options.get("--source"));
const output = resolve(options.get("--output"));
const driver = fileURLToPath(new URL("./run_bjerre_preparation.R", import.meta.url));
/** @param {Uint8Array} bytes */
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceBytes = readFileSync(source);
const sourceDigest = digest(sourceBytes);
if (sourceDigest !== "b2c12ecb356742dd05c23abb9c7ca78013125a87f24bf279c0b38f778e16302c") {
  throw new Error("load_data.R does not match the retained released source");
}
const inputBytes = readFileSync(input);
const inputDigest = digest(inputBytes);
const driverBytes = readFileSync(driver);
const driverDigest = digest(driverBytes);
// Do not overwrite any prior run, including an incomplete one.
mkdirSync(output, { mode: 0o700 });
// Retain the exact executed inputs, not mutable paths or only readr's parsed values.
for (const [name, bytes] of Object.entries({ "source-input.csv": inputBytes, "source-load_data.R": sourceBytes, "driver.R": driverBytes })) {
  writeFileSync(resolve(output, name), bytes, { mode: 0o600 });
}
const image = "rocker/tidyverse@sha256:747abe4759da18f321f7c62ff213e81d69abd4fc9499a402a5280d9e3bd972be";
const command = [
  "run", "--rm", "--pull=never", "--network=none", "--platform", "linux/amd64",
  "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
  // ponytail: 64 MiB scratch bounds this local preparation command; raise explicitly for larger supplied tables.
  "--tmpfs", "/work:rw,mode=0700,size=64m", "--workdir", "/work", "-e", "TMPDIR=/work", "-e", "TZ=UTC",
  "-v", `${resolve(output, "source-input.csv")}:/input/analysis.csv:ro`,
  "-v", `${resolve(output, "source-load_data.R")}:/source/load_data.R:ro`,
  "-v", `${resolve(output, "driver.R")}:/driver.R:ro`, "-v", `${output}:/output`,
  image, "Rscript", "--vanilla", "/driver.R",
];
const execution = spawnSync("docker", command, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
writeFileSync(resolve(output, "execution.log"), [execution.stdout, execution.stderr, execution.error?.message].filter(Boolean).join("\n"), { mode: 0o600 });
if (execution.status !== 0) throw new Error(`Released preparation failed; private details retained in ${output}/execution.log`);
const metadata = JSON.parse(readFileSync(resolve(output, "tables.json"), "utf8"));
if (metadata.sourceSha256 !== sourceDigest || metadata.inputSha256 !== inputDigest) {
  throw new Error("Source/input changed before the execution snapshot; refusing a successful receipt");
}
const artifacts = ["course_ind_df.rds", "ind_avr_df.rds", "course_ind_df.csv", "ind_avr_df.csv", "tables.json", "source-input.csv", "source-load_data.R", "driver.R"].map((name) => {
  const path = resolve(output, name);
  chmodSync(path, 0o600);
  return { name, sha256: `sha256:${digest(readFileSync(path))}` };
});
writeFileSync(resolve(output, "run.json"), JSON.stringify({
  schemaVersion: "chronicle-bjerre-preparation-run/v1", executionStatus: "executed",
  sourceWorkId: "doi:10.1177/0956797620956613", fullProfileExecutionStatus: "blocked",
  scope: "released load_data.R preparation; synthetic or user-supplied analysis.csv, not original-cohort reproduction",
  image, command, inputSha256: inputDigest, sourceSha256: sourceDigest,
  driverSha256: driverDigest, artifacts,
}, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ executionStatus: "executed", sourceRows: metadata.inputRows,
  courseRows: metadata.course.rows.length, participantRows: metadata.participant.rows.length,
  outputDirectory: output, fullProfileExecutionStatus: "blocked" }));
