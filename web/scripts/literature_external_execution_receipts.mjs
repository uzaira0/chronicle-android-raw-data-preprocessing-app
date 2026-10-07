// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CAMPAIGN_COUNTS = [
  "source_job_count", "executed_source_job_count", "generated_result_rows", "published_oracle_rows",
  "published_oracle_job_count", "numeric_oracle_cells_compared", "numeric_oracle_cells_mismatched",
  "jobs_without_published_numeric_oracles",
];
const CAMPAIGN_DIGESTS = [
  "source_jobs_sha256", "source_results_sha256", "generated_result_manifest_sha256",
];

const sha256 = (path) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
const privateMode = (path, expected) => {
  if ((statSync(path).mode & 0o777) !== expected) throw new Error(`${path} must be mode ${expected.toString(8)}`);
};
const pinnedFile = (repo, record, label) => {
  if (!record || typeof record.path !== "string" || !record.path
    || !DIGEST.test(record.sha256) || record.path.startsWith("/") || record.path.split("/").includes("..")) {
    throw new Error(`${label}: malformed pinned file`);
  }
  const path = resolve(repo, record.path);
  if (!path.startsWith(`${repo}/`) || !existsSync(path) || !statSync(path).isFile()
    || relative(repo, path).split("/")[0] !== ".tmp-literature-review-private") {
    throw new Error(`${label}: pinned file must be a private repository file`);
  }
  privateMode(path, 0o600);
  if (sha256(path) !== record.sha256) throw new Error(`${label}: digest drift`);
  return path;
};

export function loadLiteratureExternalExecutionReceipts(repo) {
  const runs = resolve(repo, ".tmp-literature-review-private/profile-runs");
  privateMode(runs, 0o700);
  const paths = readdirSync(runs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(runs, entry.name, "receipts/external-execution.json"))
    .filter(existsSync)
    .sort();
  if (!paths.length) throw new Error("no private literature external execution receipts");
  const seenSources = new Set();
  return paths.map((path) => {
    privateMode(path, 0o600);
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    const requiredStrings = [
      "source_work_id", "executor_id", "executor_version", "runtime", "container_image_digest",
      "fixture_id", "semantic_digest_sha256", "execution_command",
    ];
    if (receipt.schema_version !== "chronicle-literature-external-execution-receipt/v1"
      || receipt.passed !== true
      || requiredStrings.some((key) => typeof receipt[key] !== "string" || !receipt[key])
      || !DIGEST.test(receipt.container_image_digest)
      || !DIGEST.test(receipt.semantic_digest_sha256)
      || seenSources.has(receipt.source_work_id)) {
      throw new Error(`${path}: malformed or duplicate external execution receipt`);
    }
    seenSources.add(receipt.source_work_id);
    const auditPath = pinnedFile(repo, receipt.audit, `${receipt.source_work_id}.audit`);
    const audit = JSON.parse(readFileSync(auditPath, "utf8"));
    const evidencePath = pinnedFile(repo, receipt.evidence, `${receipt.source_work_id}.evidence`);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    const artifacts = Array.isArray(receipt.artifacts) ? receipt.artifacts : [];
    const artifactDigests = new Set(artifacts.map((artifact, index) => {
      pinnedFile(repo, artifact, `${receipt.source_work_id}.artifacts[${index}]`);
      return artifact.sha256;
    }));
    const bindings = receipt.configuration_bindings;
    const yesIds = (audit.configuration_verdicts ?? [])
      .filter((verdict) => verdict.verdict === "hard_yes")
      .map((verdict) => verdict.configuration_id)
      .sort();
    const verdictById = new Map((audit.configuration_verdicts ?? [])
      .map((verdict) => [verdict.configuration_id, verdict]));
    const campaignBinding = Array.isArray(bindings)
      ? bindings.find((binding) => binding.binding_kind === "campaign")
      : undefined;
    if (audit.source_work_id !== receipt.source_work_id
      || evidence.passed !== true || evidence.source_work_id !== receipt.source_work_id
      || evidence.semantic_digest_sha256 !== receipt.semantic_digest_sha256
      || !Array.isArray(bindings) || !bindings.length
      || new Set(bindings.map((binding) => binding.configuration_id)).size !== bindings.length
      || bindings.some((binding) => !verdictById.has(binding.configuration_id))
      || (campaignBinding
        ? bindings.length !== 1
        : JSON.stringify(bindings.map((binding) => binding.configuration_id).sort()) !== JSON.stringify(yesIds))
      || bindings.some((binding) => {
        const kind = binding.binding_kind ?? "model";
        const commonInvalid = typeof binding.receipt_id !== "string" || !binding.receipt_id
          || typeof binding.command !== "string" || !binding.command
          || !DIGEST.test(binding.result_digest) || !artifactDigests.has(binding.result_digest);
        if (commonInvalid) return true;
        if (kind === "model") return typeof binding.model_name !== "string" || !binding.model_name
          || typeof binding.formula !== "string" || !binding.formula
          || !Number.isInteger(binding.observations) || binding.observations < 1;
        if (kind !== "campaign" || binding.execution_scope !== "profile_component") return true;
        const verdict = verdictById.get(binding.configuration_id);
        if (!Array.isArray(verdict?.atom_keys)
          || !Array.isArray(binding.executed_atom_keys) || !binding.executed_atom_keys.length
          || new Set(binding.executed_atom_keys).size !== binding.executed_atom_keys.length
          || binding.executed_atom_keys.some((key) => !verdict.atom_keys.includes(key))) return true;
        const aggregate = binding.aggregate_evidence;
        return !aggregate || typeof aggregate !== "object"
          || aggregate.method_execution_passed !== true
          || typeof aggregate.published_numeric_oracle_passed !== "boolean"
          || CAMPAIGN_COUNTS.some((key) => !Number.isInteger(aggregate[key]) || aggregate[key] < 0
            || aggregate[key] !== evidence[key])
          || aggregate.source_job_count < 1
          || aggregate.executed_source_job_count !== aggregate.source_job_count
          || aggregate.published_oracle_job_count + aggregate.jobs_without_published_numeric_oracles
            !== aggregate.source_job_count
          || CAMPAIGN_DIGESTS.some((key) => !DIGEST.test(aggregate[key]) || aggregate[key] !== evidence[key]);
      })) {
      throw new Error(`${path}: execution bindings do not exactly cover the audit hard-YES configurations`);
    }
    return {
      path,
      digest: sha256(path),
      receipt,
      audit,
      evidencePath,
    };
  });
}
