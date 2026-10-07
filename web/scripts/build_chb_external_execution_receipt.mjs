#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.
// Mechanical adapter from the source-specific CHB validator to the shared receipt contract.

import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const run = ".tmp-literature-review-private/profile-runs/chb-107977-runtime";
const auditPath = ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1016-j.chb.2023.107977.json";
const evidencePath = `${run}/receipts/validation.json`;
const outputPath = resolve(repo, `${run}/receipts/external-execution.json`);
const sha256 = (path) => `sha256:${createHash("sha256").update(readFileSync(resolve(repo, path))).digest("hex")}`;
const scripts = {
  "macro-a": ["scripts/analysis/macro/Macrodata_analyses_DatasetA.R", 20],
  "macro-b": ["scripts/analysis/macro/Macrodata_analyses_DatasetB.R", 16],
  "micro-fixed-a": ["scripts/analysis/micro/RandomInterceptFixedSlope/Microdata_DatasetA_FE-Models.R", 4],
  "micro-fixed-b": ["scripts/analysis/micro/RandomInterceptFixedSlope/Microdata_DatasetB_FE-Models.R", 4],
  "micro-random-a": ["scripts/analysis/micro/RandomInterceptRandomSlope/Microdata_DatasetA.R", 4],
  "micro-random-b": ["scripts/analysis/micro/RandomInterceptRandomSlope/Microdata_DatasetB.R", 4],
  "micro-social-a-nonsocial": ["scripts/analysis/micro/socialSituations/Microdata_DatasetA_Nonsocial Situations.R", 4],
  "micro-social-a-social": ["scripts/analysis/micro/socialSituations/Microdata_DatasetA_Social Situations.R", 4],
  "micro-social-b-nonsocial": ["scripts/analysis/micro/socialSituations/Microdata_DatasetB_Nonsocial Situations.R", 4],
  "micro-social-b-social": ["scripts/analysis/micro/socialSituations/Microdata_DatasetB_Social Situations.R", 4],
};
const validation = JSON.parse(readFileSync(resolve(repo, evidencePath), "utf8"));
const artifacts = Object.keys(scripts).map((id) => {
  const path = `${run}/receipts/${id}.models.rds`;
  return { path, sha256: sha256(path) };
});
const resultById = new Map(artifacts.map((artifact) => [artifact.path.split("/").at(-1).replace(".models.rds", ""), artifact.sha256]));
const receipt = {
  schema_version: "chronicle-literature-external-execution-receipt/v1",
  passed: true,
  source_work_id: validation.source_work_id,
  executor_id: "chronicle.external.r:schoedel-smartphoneusage-wellbeing@4.1.2",
  executor_version: "4.1.2",
  runtime: "R",
  container_image_digest: "sha256:6ae57bef96a03da4ce94c16d30458166213ec8423dd2eb820de7c818f9f825b1",
  fixture_id: "external-r.schoedel-smartphoneusage-wellbeing.released-models.v1",
  semantic_digest_sha256: validation.semantic_digest_sha256,
  execution_command: "bash /runtime/run-core-models.sh",
  audit: { path: auditPath, sha256: sha256(auditPath) },
  evidence: { path: evidencePath, sha256: sha256(evidencePath) },
  configuration_bindings: validation.configuration_bindings.map((binding) => {
    const [script, expected] = scripts[binding.receipt_id] ?? [];
    if (!script) throw new Error(`unknown CHB source script receipt: ${binding.receipt_id}`);
    return {
      ...binding,
      command: `Rscript --vanilla /runtime/run-model-script.R ${JSON.stringify(script)} ${expected} /runtime/receipts/${binding.receipt_id}.models.rds`,
      result_digest: resultById.get(binding.receipt_id),
    };
  }),
  artifacts,
};
const generated = `${JSON.stringify(receipt, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== generated) throw new Error("CHB external execution receipt is stale");
  console.log("CHB external execution receipt is current");
} else {
  writeFileSync(outputPath, generated, { mode: 0o600 });
  chmodSync(outputPath, 0o600);
  console.log(`CHB external execution receipt: ${receipt.configuration_bindings.length} configurations`);
}
