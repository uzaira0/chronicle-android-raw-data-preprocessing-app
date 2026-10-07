import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repository = resolve(import.meta.dirname, "../..");
const packet = resolve(
  repository,
  ".tmp-literature-review-private/ontology-sublation-20260831/source-artifact-provenance-registry",
);
const output = resolve(
  repository,
  "web/src/generated/source-artifact-provenance-registry.json",
);
const blockedSettingId = "method-setting-ba42e53a2bb684a034aa67e0";
const expectedManifestSha256 = "sha256:54fe6f58398f34e66377950dfc53ba37f1225f3b7ee6255f48c22f69fdc1c10e";
const expectedImmutableProjectionSha256 = "sha256:acc53ad3dc930ed7e3d7a3c620e7a42c7132b36f34c8966dbe4efce4ffebe297";

/** @param {string} name @returns {any[]} */
const jsonLines = (name) => readFileSync(resolve(packet, name), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
/** @param {any} value @returns {string} */
const jcs = (value) => {
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${jcs(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
};
/** @param {import("node:crypto").BinaryLike} value @returns {string} */
const sha256 = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
/** @param {any} value @returns {string} */
const digest = (value) => sha256(jcs(value));
/** @param {string} errorCode */
const reject = (errorCode) => ({
  accepted: false,
  registryStatus: "rejected",
  errorCode,
  artifactContentsAvailable: false,
  contentDigestVerified: false,
  executionEligible: false,
});
/** @template T @param {T} value @returns {T} */
const clone = (value) => structuredClone(value);

execFileSync(process.execPath, [resolve(packet, "validate.mjs")], {
  cwd: repository,
  stdio: "ignore",
});

const manifestBytes = readFileSync(resolve(packet, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const validation = JSON.parse(readFileSync(resolve(packet, "validation.json"), "utf8"));
const candidates = jsonLines("registry-candidates.jsonl");
const positiveFixtures = jsonLines("fixtures.jsonl");
const sourceSpaces = readFileSync(resolve(repository,
  ".tmp-literature-review-private/ontology-sublation-20260831/variant-partition/source-spaces/source-configuration-spaces.jsonl"), "utf8")
  .trim().split("\n").map((line) => JSON.parse(line));

if (
  !validation.passed || Object.values(validation.checks).some((passed) => !passed) ||
  sha256(manifestBytes) !== expectedManifestSha256 ||
  manifest.schema_version !== "chronicle-source-artifact-provenance-packet-manifest/v2" ||
  manifest.batch_id !== "source-artifact-provenance-receipt-batch-1" ||
  manifest.canonical_ledger_row_count !== 1806 ||
  manifest.selected_immutable_source_projection_sha256 !== expectedImmutableProjectionSha256 ||
  manifest.registered_native_replay_count !== 18 ||
  manifest.unchanged_blocked_replay_count !== 1 || manifest.negative_fixture_count !== 11 ||
  candidates.length !== 19 || positiveFixtures.length !== 19 ||
  candidates.filter((row) => row.candidate_status === "ready_for_typed_registry").length !== 18 ||
  candidates.filter((row) => row.candidate_status.startsWith("blocked_")).length !== 1 ||
  candidates.find((row) => row.method_setting_id === blockedSettingId)?.candidate_status !==
    "blocked_missing_exact_mounted_provider_version_link"
) {
  throw new Error("accepted source-artifact packet identity or count drift");
}

const profileIdentities = [...new Set(candidates.map((candidate) => candidate.source_work_id))]
  .sort().map((sourceWorkId) => {
    const matches = sourceSpaces.filter((space) => space.source_work_id === sourceWorkId);
    if (matches.length !== 1 || typeof matches[0].source_configuration_space_id !== "string") {
      throw new Error(`source configuration-space authority mismatch: ${sourceWorkId}`);
    }
    return {
      method_profile_id: `method-profile:${sourceWorkId}`,
      source_work_id: sourceWorkId,
      source_method_variant_id: matches[0].source_configuration_space_id,
      method_profile_version: "literature-sublation-v3-atomic",
    };
  });
if (profileIdentities.length !== 3) throw new Error("source-artifact profile identity count drift");

const rows = candidates.map((candidate, index) => {
  const fixture = positiveFixtures[index];
  if (
    fixture.method_setting_id !== candidate.method_setting_id ||
    digest(candidate.source_artifact_provenance) !==
      candidate.source_artifact_provenance_object_digest
  ) {
    throw new Error(`candidate/fixture drift: ${candidate.method_setting_id}`);
  }
  return {
    method_setting_id: candidate.method_setting_id,
    source_work_id: candidate.source_work_id,
    source_extraction_id: candidate.source_extraction_id,
    source_value_sha256: candidate.source_value_sha256,
    source_artifact_provenance: candidate.source_artifact_provenance,
    source_artifact_provenance_object_digest:
      candidate.source_artifact_provenance_object_digest,
    provenance_keys: Object.keys(candidate.source_artifact_provenance).sort(),
    candidate_status: candidate.candidate_status,
  };
});

const base = positiveFixtures[0].input;
const figshare = positiveFixtures.find((fixture) =>
  fixture.method_setting_id === "method-setting-5b818543f0912f925ede6377"
).input;
/** @type {Array<[string, string, (input: any) => void, any?]>} */
const negativeCases = [
  ["forged-setting-id", "unknown_setting_id", (input) => {
    input.method_setting_id = "method-setting-forged0000000000000000";
  }],
  ["forged-work-id", "source_work_identity_mismatch", (input) => {
    input.source_work_id = "doi:10.0000/forged";
  }],
  ["forged-extraction-id", "source_extraction_identity_mismatch", (input) => {
    input.source_extraction_id = "extraction-forged";
  }],
  ["forged-source-value-digest", "source_value_digest_mismatch", (input) => {
    input.source_value_sha256 = "0".repeat(64);
  }],
  ["forged-provenance-digest", "provenance_digest_mismatch", (input) => {
    input.source_artifact_provenance_object_digest = `sha256:${"0".repeat(64)}`;
  }],
  ["forged-selector-rehashed", "unregistered_provenance_object", (input) => {
    input.source_artifact_provenance.member_selector.project_root = "forged/";
    input.source_artifact_provenance_object_digest =
      digest(input.source_artifact_provenance);
  }],
  ["forged-version-rehashed", "unregistered_provenance_object", (input) => {
    input.source_artifact_provenance.artifact_version = "3";
    input.source_artifact_provenance_object_digest =
      digest(input.source_artifact_provenance);
  }, figshare],
  ["unknown-input-key", "invalid_input_keys", (input) => {
    input.unregistered_input_key = true;
  }],
  ["unknown-provenance-key", "invalid_provenance_keys", (input) => {
    input.source_artifact_provenance.unregistered_provenance_key = true;
    input.source_artifact_provenance_object_digest =
      digest(input.source_artifact_provenance);
  }],
  ["unknown-selector-key-rehashed", "unregistered_provenance_object", (input) => {
    input.source_artifact_provenance.member_selector.unregistered_selector_key = true;
    input.source_artifact_provenance_object_digest =
      digest(input.source_artifact_provenance);
  }],
  ["unknown-relationship-key-rehashed", "unregistered_provenance_object", (input) => {
    input.source_artifact_provenance.artifact_relationship.unregistered_relationship_key = true;
    input.source_artifact_provenance_object_digest =
      digest(input.source_artifact_provenance);
  }, figshare],
];
const negativeFixtures = negativeCases.map(([name, errorCode, mutate, source = base]) => {
  const input = clone(source);
  mutate(input);
  const expectedResult = reject(errorCode);
  return {
    schema_version:
      "chronicle-source-artifact-provenance-registry-negative-conformance-fixture/v2",
    fixture_id: `source-artifact-provenance.negative.${name}.v2`,
    mutation: name,
    input,
    case_digest: digest(input),
    expected_result: expectedResult,
    result_digest: digest(expectedResult),
  };
});

const payload = {
  schema_version: "chronicle-source-artifact-provenance-closed-registry/v2",
  source_packet: {
    batch_id: manifest.batch_id,
    canonical_ledger_row_count: manifest.canonical_ledger_row_count,
    selected_immutable_source_projection_sha256:
      manifest.selected_immutable_source_projection_sha256,
    packet_manifest_sha256: sha256(manifestBytes),
    imported_candidate_count: rows.length,
    receipt_ready_count: rows.filter((row) =>
      row.candidate_status === "ready_for_typed_registry"
    ).length,
    blocked_method_setting_ids: [blockedSettingId],
  },
  profile_identities: profileIdentities,
  rows,
  positive_fixtures: positiveFixtures,
  negative_fixtures: negativeFixtures,
};
const generated = `${JSON.stringify({
  ...payload,
  content_digest: digest(payload),
}, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== generated) {
    throw new Error("source-artifact provenance registry is stale; run this script without --check");
  }
  console.log("source-artifact provenance registry is current");
} else {
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, generated);
  console.log(`wrote ${output}`);
}
