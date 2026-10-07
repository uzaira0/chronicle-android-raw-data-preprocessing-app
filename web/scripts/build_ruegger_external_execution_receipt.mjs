#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.
// Mechanical adapter from the source campaign validator to the shared receipt contract.

import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const run = ".tmp-literature-review-private/profile-runs/rueegger-per2309-runtime";
const auditPath = ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1002-per.2309.json";
const evidencePath = `${run}/receipts/evidence.json`;
const outputPath = resolve(repo, `${run}/receipts/external-execution.json`);
const sha256 = (path) => `sha256:${createHash("sha256").update(readFileSync(resolve(repo, path))).digest("hex")}`;
const evidence = JSON.parse(readFileSync(resolve(repo, evidencePath), "utf8"));
const audit = JSON.parse(readFileSync(resolve(repo, auditPath), "utf8"));
if (evidence.passed !== true || evidence.method_execution_passed !== true
  || evidence.source_work_id !== "doi:10.1002/per.2309"
  || evidence.source_job_count !== 1390 || evidence.generated_result_rows !== 16860
  || evidence.published_oracle_job_count !== 830 || evidence.published_oracle_rows !== 16300) {
  throw new Error("Ruegger model campaign evidence is incomplete or malformed");
}
const aggregateKeys = [
  "method_execution_passed", "published_numeric_oracle_passed", "source_job_count",
  "executed_source_job_count", "jobs_without_published_numeric_oracles",
  "generated_result_rows", "published_oracle_rows", "published_oracle_job_count",
  "numeric_oracle_cells_compared", "numeric_oracle_cells_mismatched", "source_jobs_sha256",
  "source_results_sha256", "generated_result_manifest_sha256",
];
const aggregateEvidence = Object.fromEntries(aggregateKeys.map((key) => [key, evidence[key]]));
const artifactPaths = [...new Set([
  evidencePath,
  ...evidence.source_artifacts.map((artifact) => artifact.path),
  ...evidence.generated_result_files.map((artifact) => artifact.path),
])].sort();
for (const path of [auditPath, ...artifactPaths]) chmodSync(resolve(repo, path), 0o600);
const artifacts = artifactPaths.map((path) => ({ path, sha256: sha256(path) }));
const evidenceDigest = sha256(evidencePath);
const sourceDigest = evidence.source_artifacts.find((artifact) => artifact.path.endsWith("/learn_revision2.py"))?.sha256;
if (!sourceDigest) throw new Error("Ruegger source-code digest is absent");
const campaign = audit.source_pipeline_component_inventory?.components?.find(
  (component) => component.configuration_id === "rueegger2020:model-campaign:released-revision2",
);
if (!campaign || new Set(campaign.atom_keys).size !== 57) throw new Error("Ruegger model campaign atom inventory drift");
const command = "python learn_revision2.py --traits <O,C,E,A,N> --algorithms <Linear,XGBoost,Lasso,Ridge> --cores 1 --output-suffix <trait-algorithm shard>";
const receipt = {
  schema_version: "chronicle-literature-external-execution-receipt/v1",
  passed: true,
  source_work_id: evidence.source_work_id,
  executor_id: evidence.executor_id,
  executor_version: `python-3.7.1+source-${sourceDigest.slice(7, 19)}`,
  runtime: evidence.runtime,
  container_image_digest: evidence.container_image_digest,
  fixture_id: "external-python.rueegger-per2309.released-revision2-model-campaign.v1",
  semantic_digest_sha256: evidence.semantic_digest_sha256,
  execution_command: command,
  audit: { path: auditPath, sha256: sha256(auditPath) },
  evidence: { path: evidencePath, sha256: evidenceDigest },
  configuration_bindings: [{
    configuration_id: "rueegger2020:fixed-source-method",
    binding_kind: "campaign",
    execution_scope: "profile_component",
    executed_atom_keys: campaign.atom_keys,
    receipt_id: "released-revision2-model-campaign",
    command,
    result_digest: evidenceDigest,
    aggregate_evidence: aggregateEvidence,
  }],
  artifacts,
};
const generated = `${JSON.stringify(receipt, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== generated) throw new Error("Ruegger external execution receipt is stale");
  console.log("Ruegger external execution receipt is current");
} else {
  writeFileSync(outputPath, generated, { mode: 0o600 });
  chmodSync(outputPath, 0o600);
  console.log("Ruegger external execution receipt: 1 aggregate campaign / 1,390 source jobs");
}
