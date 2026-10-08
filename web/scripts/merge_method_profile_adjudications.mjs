#!/usr/bin/env node
// @ts-nocheck -- executable corpus gate; --self-test is its smallest runnable check.

import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { sourceCompletenessExecutionClass } from "./source_completeness_execution_classification.mjs";
import { loadLiteratureExternalExecutionReceipts } from "./literature_external_execution_receipts.mjs";
import { applyAdmissionsToReviewQueue, loadPostFreezeAdmissions } from "./literature_post_freeze_admissions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const run = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
const decisionPaths = [
  "adjudication-c01-c10/decisions.jsonl",
  "adjudication-c11-c21/decisions.jsonl",
  "adjudication-auxiliary/decisions.jsonl",
].map((path) => resolve(run, path));
const atomicPaths = [
  "atomic-c01-c10/atomic-settings.jsonl",
  "atomic-c11-c21/atomic-settings.jsonl",
  "atomic-auxiliary/atomic-settings.jsonl",
].map((path) => resolve(run, path));
const sourceSpacesPath = resolve(run, "variant-partition/source-spaces/source-configuration-spaces.jsonl");
const protocolAttachmentsPath = resolve(run, "protocol-materialization/source-profiles/protocol-attachments.jsonl");
const operatorContractPath = resolve(run, "execution-contract-design/operator-contract.json");
const nativeConformanceDirectory = resolve(run, "native-conformance-execution");
const nativeConformanceMappingPath = resolve(nativeConformanceDirectory, "mapping.jsonl");
const nativeConformanceValidationPath = resolve(nativeConformanceDirectory, "validation.json");
const nativeConformanceFixturePath = resolve(repo, "rust/chronicle_preprocessing_runtime_wasm/tests/fixtures/literature_native_conformance.json");
const publishedSessionOutputConformanceDirectory = resolve(run, "published-session-output-conformance");
const publishedSessionOutputConformanceMappingPath = resolve(publishedSessionOutputConformanceDirectory, "mapping.jsonl");
const publishedSessionOutputConformanceValidationPath = resolve(publishedSessionOutputConformanceDirectory, "validation.json");
const sourceEvidenceRepairDirectory = resolve(run, "source-evidence-repair");
const sourceEvidenceRepairOverlayPath = resolve(sourceEvidenceRepairDirectory, "repair-overlay.jsonl");
const sourceEvidenceRepairValidationPath = resolve(sourceEvidenceRepairDirectory, "validation.json");
const missingInputAuditDirectory = resolve(run, "native-route-audit-missing-input-adapters");
const missingInputAuditDecisionsPath = resolve(missingInputAuditDirectory, "decisions.jsonl");
const missingInputAuditReportPath = resolve(missingInputAuditDirectory, "report.md");
const missingInputAuditValidationPath = resolve(missingInputAuditDirectory, "validation.json");
const externalExecutorAuditDirectory = resolve(run, "external-executor-audit");
const externalExecutorAuditDecisionsPath = resolve(externalExecutorAuditDirectory, "decisions.jsonl");
const externalExecutorAuditValidationPath = resolve(externalExecutorAuditDirectory, "validation.json");
const correctedNewOperatorDirectory = resolve(run, "new-operator-tranches");
const correctedNewOperatorManifestPath = resolve(correctedNewOperatorDirectory, "tranches.jsonl");
const correctedNewOperatorValidationPath = resolve(correctedNewOperatorDirectory, "validation.json");
const strictGapExtensionDirectory = resolve(run, "small-extension-implementations/small-ext-01-session-gap-strict-lt5");
const strictGapExtensionMappingPath = resolve(strictGapExtensionDirectory, "mapping.jsonl");
const strictGapExtensionValidationPath = resolve(strictGapExtensionDirectory, "validation.json");
const strictGapExtensionManifestPath = resolve(strictGapExtensionDirectory, "implementation-manifest.json");
const strictScreenGateExtensionDirectory = resolve(run, "small-extension-implementations/small-ext-06-strict-screen-credit-gate");
const strictScreenGateExtensionMappingPath = resolve(strictScreenGateExtensionDirectory, "mapping.jsonl");
const strictScreenGateExtensionValidationPath = resolve(strictScreenGateExtensionDirectory, "validation.json");
const strictScreenGateExtensionManifestPath = resolve(strictScreenGateExtensionDirectory, "implementation-manifest.json");
const directUnlockExtensionDirectory = resolve(run, "small-extension-implementations/small-ext-03a-direct-unlock-strategies");
const directUnlockExtensionMappingPath = resolve(directUnlockExtensionDirectory, "mapping.jsonl");
const directUnlockExtensionValidationPath = resolve(directUnlockExtensionDirectory, "validation.json");
const directUnlockExtensionManifestPath = resolve(directUnlockExtensionDirectory, "implementation-manifest.json");
const sourceOrderExtensionDirectory = resolve(run, "small-extension-implementations/small-ext-07-drop-out-of-source-order-events");
const sourceOrderExtensionMappingPath = resolve(sourceOrderExtensionDirectory, "mapping.jsonl");
const sourceOrderExtensionValidationPath = resolve(sourceOrderExtensionDirectory, "validation.json");
const sourceOrderExtensionManifestPath = resolve(sourceOrderExtensionDirectory, "implementation-manifest.json");
const screenPolicyExtensionDirectory = resolve(run, "small-extension-implementations/small-ext-05-screen-classification-cap-lock");
const screenPolicyExtensionMappingPath = resolve(screenPolicyExtensionDirectory, "mapping.jsonl");
const screenPolicyExtensionValidationPath = resolve(screenPolicyExtensionDirectory, "validation.json");
const screenPolicyExtensionManifestPath = resolve(screenPolicyExtensionDirectory, "implementation-manifest.json");
const behappIntervalExtensionDirectory = resolve(run, "small-extension-implementations/small-ext-02-behapp-half-open-1s");
const behappIntervalExtensionMappingPath = resolve(behappIntervalExtensionDirectory, "mapping.jsonl");
const behappIntervalExtensionValidationPath = resolve(behappIntervalExtensionDirectory, "validation.json");
const behappIntervalExtensionManifestPath = resolve(behappIntervalExtensionDirectory, "implementation-manifest.json");
const screenDurationParticipantExclusionDirectory = resolve(run, "new-operator-implementations/T28-scoped-quality-exclusion-rule-engine");
const screenDurationParticipantExclusionMappingPath = resolve(screenDurationParticipantExclusionDirectory, "mapping.jsonl");
const screenDurationParticipantExclusionValidationPath = resolve(screenDurationParticipantExclusionDirectory, "validation.json");
const screenDurationParticipantExclusionManifestPath = resolve(screenDurationParticipantExclusionDirectory, "implementation-manifest.json");
const appOpeningIterationDirectory = resolve(run, "new-operator-implementations/T29-each-app-opening-event");
const appOpeningIterationMappingPath = resolve(appOpeningIterationDirectory, "mapping.jsonl");
const appOpeningIterationValidationPath = resolve(appOpeningIterationDirectory, "validation.json");
const appOpeningIterationManifestPath = resolve(appOpeningIterationDirectory, "implementation-manifest.json");
const applicationLabelExtensionDirectory = resolve(run, "small-extension-implementations/small-ext-09-application-label-exclusion");
const applicationLabelExtensionMappingPath = resolve(applicationLabelExtensionDirectory, "mapping.jsonl");
const applicationLabelExtensionValidationPath = resolve(applicationLabelExtensionDirectory, "validation.json");
const applicationLabelExtensionManifestPath = resolve(applicationLabelExtensionDirectory, "implementation-manifest.json");
const bsnRepairDirectory = resolve(run, "bsn-profile-repair");
const bsnRepairOverlayPath = resolve(bsnRepairDirectory, "repair-overlay.jsonl");
const bsnRepairValidationPath = resolve(bsnRepairDirectory, "validation.json");
const bsnRepairValidatorPath = resolve(bsnRepairDirectory, "validate.mjs");
const bsnRepairManifestPath = resolve(bsnRepairDirectory, "manifest.json");
const bsnRepairManifestDigestPath = resolve(bsnRepairDirectory, "manifest.sha256");
const sourceCompletenessAuditDirectory = resolve(run, "source-completeness-audits");
const sourceCompletenessAuditValidatorPath = resolve(repo, "web/scripts/validate_source_completeness_audits.mjs");
const hammerSourceCompletenessAuditPath = resolve(sourceCompletenessAuditDirectory, "doi-10.1145-2634317.2634325.json");
const hushSourceCompletenessAuditPath = resolve(sourceCompletenessAuditDirectory, "doi-10.1145-2789168.2790107.json");
const configurationUnitKinds = new Set([
  "user_selectable_alternative",
  "fixed_pipeline_stage_component",
  "campaign_internal_job_model_cell",
  "output_result_oracle_row",
  "evidence_only_unavailable",
]);
const packet09IntegrationDirectory = resolve(repo, ".tmp-literature-review-private/packet09-canonical-integration-prep-20260831");
const packet09ValidatorPath = resolve(packet09IntegrationDirectory, "validate_packet.py");
const packet09ValidationPath = resolve(packet09IntegrationDirectory, "validation.json");
const packet09ChecksumsPath = resolve(packet09IntegrationDirectory, "checksums.jsonl");
const packet09DetachedChecksumPath = resolve(packet09IntegrationDirectory, "checksums.detached.sha256");
const packet09IdentityPath = resolve(packet09IntegrationDirectory, "input-identities.json");
const packet09SourceSettingMapPath = resolve(packet09IntegrationDirectory, "source-setting-map.jsonl");
const packet09AtomicSettingsPath = resolve(packet09IntegrationDirectory, "atomic-settings.jsonl");
const packet09MappedProfilesPath = resolve(packet09IntegrationDirectory, "mapped-profiles.jsonl");
const packet09ConfigurationGroupsPath = resolve(packet09IntegrationDirectory, "configuration-groups.jsonl");
const packet09ConfigurationLevelsPath = resolve(packet09IntegrationDirectory, "configuration-levels.jsonl");
const packet09StructuredProtocolCandidatesPath = resolve(packet09IntegrationDirectory, "structured-protocol-candidates.jsonl");
const packet09ImplementationClassificationPath = resolve(packet09IntegrationDirectory, "implementation-classification.jsonl");
const packet09PinnedHashes = Object.freeze({
  validation: "sha256:5d6410bbf48fc80a5e2c03ca5ed6213443962fb7fd1259b650ef430978f5a3aa",
  checksums: "sha256:879e0ca0d12a014e5d0276a3cb43868c23ff7ea28c5cee625eb8959d02c999bd",
  detached_checksum: "sha256:228c700efe05909d99d0389a76fc10426324efd00a5e28f68e7be8556f1c6df8",
});
const inputAdapterImplementationMappingPath = resolve(missingInputAuditDirectory, "implementation-conformance-mapping.jsonl");
const inputAdapterImplementationValidationPath = resolve(missingInputAuditDirectory, "implementation-validation.json");
const inputAdapterImplementationManifestPath = resolve(missingInputAuditDirectory, "implementation-manifest.json");
const inputAdapterContractPath = resolve(repo, "web/schema/literature-input-adapter-contract.json");
const inputAdapterFixturePath = resolve(repo, "rust/chronicle_preprocessing_runtime_wasm/tests/fixtures/literature_input_adapter_conformance.json");
const smallExtensionTranchePath = resolve(run, "small-extension-tranches/tranches.jsonl");
const smallExtensionTrancheValidationPath = resolve(run, "small-extension-tranches/validation.json");
const sourceArtifactRegistryPath = resolve(repo, "web/src/generated/source-artifact-provenance-registry.json");
const sourceArtifactPacketValidatorPath = resolve(run, "source-artifact-provenance-registry/validate.mjs");
const sourceArtifactImportPath = resolve(repo, "web/scripts/import_source_artifact_provenance_registry.mjs");
const sourceArtifactMergeLedgerPath = resolve(run, ".source-artifact-merge-input.jsonl");
const extensionGeneratedFiles = [
  "web/src/lib/generatedContract.ts",
  "web/openapi/chronicle-local-api.yaml",
  "web/schema/generated/json-schema/chronicle-research-ontology.schema.json",
  "web/schema/generated/owl/chronicle-research-ontology.owl.ttl",
  "web/schema/generated/pydantic/chronicle_research_ontology.py",
  "web/schema/generated/shacl/chronicle-research-ontology.shacl.ttl",
  "web/schema/generated/shacl/merged.shacl.ttl",
  "web/schema/generated/sql/chronicle-research-ontology.ddl.sql",
  "docs/METHODS.md",
];
const nativeRouteAuditSpecs = [
  ["event_schema", "literature.native.event_schema", "native-route-audit-event-schema"],
  ["reconstruction", "literature.native.reconstruction", "native-route-audit-reconstruction"],
  ["quality_control", "literature.native.quality_control", "native-route-audit-quality"],
].map(([name, destinationId, directory]) => ({ name, destinationId, directory: resolve(run, directory) }));
const nativeRouteAuditClassifications = new Set([
  "exact_existing_binding",
  "small_existing_operator_extension",
  "new_operator_required",
  "missing_input",
  "source_evidence_blocked",
]);
const missingInputClassifications = new Set([
  "existing_input_already_available_but_unwired",
  "small_extension_existing_support_schema_or_adapter",
  "genuinely_new_optional_input_artifact",
  "source_version_artifact_unavailable",
]);
const missingInputBlockerCodes = new Map([
  ["existing_input_already_available_but_unwired", "input_available_unwired"],
  ["small_extension_existing_support_schema_or_adapter", "input_adapter_extension_required"],
  ["genuinely_new_optional_input_artifact", "new_typed_input_artifact_required"],
  ["source_version_artifact_unavailable", "source_version_artifact_unavailable"],
]);
const externalExecutorDispositions = new Set([
  "already_present_repo_or_dependency",
  "extend_existing_downstream_operator",
  "external_artifact_available",
  "unavailable_or_underdetermined_source_version",
]);
const qualityBindingSlotAliases = new Map([
  ["same_app_stop_types", "same_app_interaction_types_to_stop_usage_at"],
  ["other_stop_types", "other_interaction_types_to_stop_usage_at"],
]);
const allowedStatuses = new Set([
  "native",
  "external_executor",
  "specification_only",
  "refused_missing_signal",
  "unresolved",
]);
const applicableDisclosures = new Set(["declared", "declared_partial", "delegated"]);
// The runtime is the public execution authority; the kernel alias is accepted
// from adjudication packets and normalized at this boundary.
const nativeExecutor = "chronicle_preprocessing_runtime_wasm";
const nativeExecutorAliases = new Set([nativeExecutor, "chronicle_chrono_kernel_wasm:pipeline_v2"]);
const lateSourceCompletenessInputAdapterGroups = [
  {
    adapterId: "chronicle.schoedel-screen-preprocessing/v1",
    sourceWorkId: "doi:10.1016/j.chb.2023.107977",
    methodSettingIds: new Set([
      "method-setting-66920366f1bcb47f4f886ad8",
      "method-setting-d394f2b6bd1e0c5482cdc8e8",
      "method-setting-d894de457ffd9173a998df81",
      "method-setting-1a379268d6597e7273b85f97",
      "method-setting-879e89f592983b25787dc49a",
      "method-setting-9e7e70906eff3625932b8f81",
      "method-setting-4e4f8e1d807ceba6ff65d242",
      "method-setting-7c2e0a9dea562d178ffc739e",
      "method-setting-4be360e1ca8503a6bed5f59a",
      "method-setting-3da63665c82daed18f4c9008",
      "method-setting-0821c923316fbd7ec5c6814d",
      "method-setting-f1b4ff01fc64090cdc638d2f",
      "method-setting-db9beb89a6cafd9f1a6e6085",
      "method-setting-21088bd2743bd3054e5fbb5b",
      "method-setting-860ae98831e6554b36c0c4f0",
      "method-setting-8a403a75a089c37effa21db6",
    ]),
  },
  {
    adapterId: "chronicle.dekker-post-persistence/v1",
    sourceWorkId: "doi:10.1080/15213269.2024.2334025",
    methodSettingIds: new Set([
      "method-setting-f8571aa881830cc5495030cd",
      "method-setting-131bbd265d0e0eb2be7f872d",
    ]),
  },
  {
    adapterId: "chronicle.ethica-app-usage-stream/v1",
    sourceWorkId: "doi:10.1177/00936502241276793",
    methodSettingIds: new Set([
      "method-setting-8a1d42e375008c6b34c79e60",
      "method-setting-283b3d30d8541590046a0451",
      "method-setting-ca06a70efe6dd99babafeef0",
      "method-setting-60a2079343ab336eda1a7704",
      "method-setting-26a0aa33a3ea41e02ff64863",
      "method-setting-dd694b0b2e2e141c40f2a46b",
      "method-setting-5110b31b451f7cc18d750ffb",
    ]),
  },
  {
    adapterId: "chronicle.phonestudy-phone-activity/v1",
    sourceWorkId: "doi:10.1037/pspp0000469",
    methodSettingIds: new Set([
      "method-setting-76fffb16cf433b25ad9f41b5",
      "method-setting-faf89bac61ad22df438c751c",
    ]),
  },
  {
    adapterId: "chronicle.phonestudy-phone-features/v1",
    sourceWorkId: "doi:10.1037/pspp0000469",
    methodSettingIds: new Set([
      "method-setting-2024dc3832e28339c35e77c6",
      "method-setting-25850bf69703fbf97a62f45a",
      "method-setting-82e5e52c5cb3226a61e79545",
      "method-setting-9bab1ec12ac7b8d13b09e1bc",
      "method-setting-9c0a51bb40b069aabe08c488",
    ]),
  },
  {
    adapterId: "chronicle.aggregated-app-observation/v1",
    sourceWorkId: "doi:10.1038/s41598-019-47493-x",
    methodSettingIds: new Set(["method-setting-7cc86be8b942308cd15285e8"]),
  },
  {
    adapterId: "chronicle.communication-detail-record/v1",
    sourceWorkId: "doi:10.1109/asonam.2012.243",
    methodSettingIds: new Set(["method-setting-41abbf6fc27ea43b4d3bed16"]),
  },
];
const lateSourceCompletenessInputAdapterIds = new Set(
  lateSourceCompletenessInputAdapterGroups.flatMap(({ methodSettingIds }) => [...methodSettingIds]),
);
const lateSourceCompletenessAdapterIds = new Set(
  lateSourceCompletenessInputAdapterGroups.map(({ adapterId }) => adapterId),
);
const lateSourceCompletenessInputAdapterBySetting = new Map(
  lateSourceCompletenessInputAdapterGroups.flatMap((adapter) =>
    [...adapter.methodSettingIds].map((methodSettingId) => [methodSettingId, adapter])),
);
const schoedelOracleDirectory = resolve(run, "schoedel-screen-preprocessing-oracle");
const schoedelOracleManifestPath = resolve(schoedelOracleDirectory, "artifact-digests.tsv");
const schoedelOracleManifestSha256 = "750755aff8bf02c027134b87983643a311f40334651976a8416d5607a0c6d2d7";
const schoedelRustAllCellBundleSha256 = "7d09ba95d267bea8f3c2745b5ec324d6aa71c8925055b328362396316838de1d";
const usageStatsPermissionSettingId = "atomic-0de0a9d6fd444d3568acb97f";
const knownRefusalExecutors = new Set(["chronicle_chrono_kernel_wasm:schoedel_full_osf_refusal"]);

function jsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${error.message}`, { cause: error });
    }
  });
}

function write(path, value) {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function writeJsonl(path, rows) {
  write(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined));
}

function requireString(value, name, id) {
  if (typeof value !== "string" || !value) throw new Error(`${id}: ${name} must be a non-empty string`);
  return value;
}

function canonicalJson(value, id) {
  requireString(value, "value_json", id);
  try {
    return JSON.stringify(JSON.parse(value));
  } catch (error) {
    throw new Error(`${id}: value_json is invalid JSON: ${error.message}`, { cause: error });
  }
}

function canonicalObjectJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalObjectJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalObjectJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sourceArtifactReplacesReleaseBlocker(blocker, profile, registeredRows) {
  const ids = blocker.blocked_method_setting_ids ?? [];
  return blocker.protocol_ontology_class === "MeasurementReleaseProfile"
    && blocker.protocol_profile_slot === "release_profiles"
    && ["unmapped_parameter_semantics", "missing_release_context"].includes(blocker.protocol_blocker_code)
    && ids.length > 0
    && ids.every((id) => {
      const row = registeredRows.get(id);
      return row?.candidate_status === "ready_for_typed_registry"
        && row.source_work_id === profile.source_work_id
        && blocker.protocol_materialization_id === `measurement-release-profile:${row.source_extraction_id}`;
    });
}

function applySourceArtifactRegistry(assertions, profiles) {
  if (existsSync(sourceArtifactMergeLedgerPath)) throw new Error("stale source-artifact merge ledger");
  const replayRows = jsonl(resolve(run, "source-artifact-provenance-registry/registered-replay-state.jsonl"));
  const replayById = new Map(replayRows.map((row) => [row.method_setting_id, row]));
  const validationAssertions = assertions.map((setting) => {
    const replay = replayById.get(setting.method_setting_id);
    if (!replay) return setting;
    const updated = { ...setting, ...replay.ledger_replay_fields };
    if (replay.replay_status === "registered_native_receipt") delete updated.method_execution_blocker_code;
    for (const field of replay.absent_registered_receipt_fields ?? []) delete updated[field];
    return updated;
  });
  writeJsonl(sourceArtifactMergeLedgerPath, validationAssertions);
  const validationEnvironment = {
    ...process.env,
    CHRONICLE_SOURCE_ARTIFACT_LEDGER: sourceArtifactMergeLedgerPath,
  };
  let packetValidation;
  let importValidation;
  let browserValidation;
  try {
    packetValidation = spawnSync(process.execPath, [sourceArtifactPacketValidatorPath], {
      cwd: repo, env: validationEnvironment, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    });
    importValidation = spawnSync(process.execPath, [sourceArtifactImportPath], {
      cwd: repo, env: validationEnvironment, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    });
    browserValidation = spawnSync(resolve(repo, "web/node_modules/.bin/vitest"), [
      "run", "src/lib/sourceArtifactProvenanceRegistry.test.ts",
    ], { cwd: resolve(repo, "web"), env: validationEnvironment, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } finally {
    rmSync(sourceArtifactMergeLedgerPath, { force: true });
  }
  if (packetValidation.status !== 0 || importValidation.status !== 0 || browserValidation.status !== 0) {
    throw new Error(`source-artifact provenance validation failed:\n${packetValidation.stdout}${packetValidation.stderr}\n${importValidation.stdout}${importValidation.stderr}\n${browserValidation.stdout}${browserValidation.stderr}`);
  }
  runRuntimeConformance(["test", "--locked", "--test", "source_artifact_provenance_registry"], "source-artifact registry");
  runRuntimeConformance(["test", "--locked", "documentary_receipt_requires_the_exact_closed_registry_fixture", "--lib"], "source-artifact receipt");
  const registry = JSON.parse(readFileSync(sourceArtifactRegistryPath, "utf8"));
  const fixtures = new Map(registry.positive_fixtures.map((fixture) => [fixture.method_setting_id, fixture]));
  const rows = new Map(registry.rows.map((row) => [row.method_setting_id, row]));
  if (rows.size !== 19 || registry.source_packet.receipt_ready_count !== 18
    || registry.source_packet.blocked_method_setting_ids.join("") !== "method-setting-ba42e53a2bb684a034aa67e0") {
    throw new Error("source-artifact registry partition drift during canonical merge");
  }
  let promoted = 0;
  const routedAssertions = assertions.map((setting) => {
    const row = rows.get(setting.method_setting_id);
    if (!row) return setting;
    if (setting.source_work_id !== row.source_work_id
      || setting.source_extraction_id !== row.source_extraction_id
      || setting.source_value_sha256 !== row.source_value_sha256) {
      throw new Error(`${setting.method_setting_id}: source-artifact registry lineage mismatch`);
    }
    if (row.candidate_status !== "ready_for_typed_registry") return setting;
    const fixture = fixtures.get(setting.method_setting_id);
    if (!fixture || fixture.input.source_artifact_provenance_object_digest !== row.source_artifact_provenance_object_digest
      || fixture.expected_result.executionEligible !== false) {
      throw new Error(`${setting.method_setting_id}: source-artifact registry fixture mismatch`);
    }
    promoted += 1;
    const { method_execution_blocker_code: _removedBlocker, ...rest } = setting;
    return {
      ...rest,
      contract_bindings: [],
      method_implementation_status: "native",
      method_execution_route: "receipt_conformance",
      method_execution_destination_id: "chronicle.source-artifact-provenance-registry",
      method_execution_parameter_path: "/methodProfileReceipt/documentaryBindings",
      executor_id: "chronicle_preprocessing_runtime_wasm:source_artifact_provenance_registry",
      conformance_fixture_id: fixture.fixture_id,
      conformance_result_digest: fixture.result_digest,
    };
  });
  if (promoted !== 18) throw new Error(`source-artifact registry promoted ${promoted}, expected 18`);
  const assertionsByWork = Map.groupBy([...rows.values()].filter((row) => row.candidate_status === "ready_for_typed_registry"), (row) => row.source_work_id);
  const routedProfiles = profiles.map((profile) => ({
    ...profile,
    protocol_materialization_blockers: (profile.protocol_materialization_blockers ?? []).filter((blocker) =>
      !sourceArtifactReplacesReleaseBlocker(blocker, profile, rows)),
    source_artifact_provenance_assertions: (assertionsByWork.get(profile.source_work_id) ?? []).map((row) => {
      const fixture = fixtures.get(row.method_setting_id);
      return {
        source_artifact_provenance_id: row.source_artifact_provenance.source_artifact_provenance_id,
        method_setting_id: row.method_setting_id,
        source_work_id: row.source_work_id,
        source_extraction_id: row.source_extraction_id,
        source_value_sha256: row.source_value_sha256,
        source_artifact_provenance_object_json: canonicalObjectJson(row.source_artifact_provenance),
        source_artifact_provenance_object_digest: row.source_artifact_provenance_object_digest,
        provenance_keys: row.provenance_keys,
        candidate_status: row.candidate_status,
        conformance_fixture_id: fixture.fixture_id,
        conformance_result_digest: fixture.result_digest,
        execution_eligibility: "documentary_only",
      };
    }),
  }));
  const blocked = routedAssertions.find((setting) => setting.method_setting_id === "method-setting-ba42e53a2bb684a034aa67e0");
  if (!blocked || blocked.method_implementation_status === "native") throw new Error("ba42 source-artifact row was improperly promoted");
  return { assertions: routedAssertions, profiles: routedProfiles, summary: {
    promoted_settings: 18,
    blocked_settings: 1,
    execution_eligible_artifacts: 0,
    packet_validation_passed: true,
    browser_validation_passed: true,
    rust_validation_passed: true,
  } };
}

const profileProtocolDocumentaryParameters = new Set([
  "collector", "collector_platform", "collector_platform_scope",
  "collector_operation", "duration", "platform", "platform_minimum_version",
]);
const correctedProfileProtocolDocumentaryIds = new Set([
  "atomic-087ff0dd09ee0acc91e280de", "atomic-154eae0709abe5e45de42073",
  "atomic-30d42af83a508351f19ab533", "atomic-30ddb7f10061ece92a681cda",
  "atomic-3827495cbdd6a292010ac318", "atomic-5ae3b05a2ad6d99fa88f4497",
  "atomic-dfb3ab268032e1ca7e273556", "atomic-fda36a53cbae0c4f3a78ae54",
  "method-setting-9a10572bb83581c8588ef6eb", "method-setting-9e17f6dce8f318969b85fa30",
  "method-setting-c16bcb13525d083e41c41127", "method-setting-e2b9e2fe9ad278917b758e24",
  "method-setting-facb6e4986817f17b8614e39", "method-setting-885cea0c19188f08ff616e2c",
  "method-setting-ce36bb14f65b60e46518d611",
]);
const sourceAuditedDocumentaryProfileIds = new Set([
  "atomic-03def6d42fe0dcf2efab0807", // Android collector platform
  "atomic-6313aa618bbc6f0f78be9096", // PhoneStudy collector identity
  "atomic-642eae12c89408e91c7670c8", // high-level input record description
  "atomic-bc7544176806c9eac5bab762", // source input dependency, not a second operator
]);
const repairedProfileProtocolDocumentaryIds = new Set(jsonl(sourceEvidenceRepairOverlayPath)
  .filter((row) => row.repair_disposition === "documentary_receipt")
  .map((row) => row.method_setting_id));
if (repairedProfileProtocolDocumentaryIds.size !== 28) {
  throw new Error(`source-evidence repair declared ${repairedProfileProtocolDocumentaryIds.size}, expected 28 documentary receipts`);
}

const safeEvidenceReceiptExpectedCounts = new Map([
  ["explicit_reported_numeric_or_statistical_oracle", 43],
  ["published_evaluation_metric_result", 4],
  ["published_framework_comparison_result_cell", 221],
  ["published_framework_comparison_table_schema", 20],
  ["published_table_or_figure_result", 35],
  ["reported_feature_count_not_feature_operator", 1],
  ["reported_validation_result_not_entropy_operator", 1],
]);

function safeEvidenceReceiptCategory(setting) {
  if (setting.method_execution_blocker_code === "indispensable_source_evidence_unavailable"
    || setting.integration_source?.endsWith(":source_gap_or_conflict")) return null;
  const key = setting.method_parameter_key;
  if (setting.source_work_id === "doi:10.3389/fpsyg.2016.01252" && key.startsWith("matrix.schema.")) {
    return "published_framework_comparison_table_schema";
  }
  if (setting.source_work_id === "doi:10.3389/fpsyg.2016.01252" && key.startsWith("matrix.row.")) {
    return "published_framework_comparison_result_cell";
  }
  if (/(^|\.)(oracle|oracles)(\.|_|$)/i.test(key) && setting.method_value_kind === "object") {
    return "explicit_reported_numeric_or_statistical_oracle";
  }
  if (setting.source_work_id === "doi:10.1007/978-3-319-23222-5_4"
      && setting.method_setting_role === "validation" && key.startsWith("result.")) {
    return "published_table_or_figure_result";
  }
  if (setting.source_work_id === "doi:10.5555/2442691.2442720"
      && /^result\.(previous_day|social|attributes|all)\.metrics_percent$/.test(key)) {
    return "published_evaluation_metric_result";
  }
  if (setting.source_work_id === "doi:10.1007/s10916-020-1530-z" && key === "feature.total") {
    return "reported_feature_count_not_feature_operator";
  }
  if (setting.source_work_id === "doi:10.1145/2493432.2493490"
      && key === "livelab.location_entropy_validation") {
    return "reported_validation_result_not_entropy_operator";
  }
  return null;
}

function applySafeEvidenceReceiptCorrections(assertions, profiles, spaces) {
  const counts = new Map();
  const correctedIds = new Set();
  const correctedAssertions = assertions.map((setting) => {
    const category = safeEvidenceReceiptCategory(setting);
    if (!category) return setting;
    const sourceCompletenessEvidenceLane = setting.integration_source?.startsWith("projectable_source_completeness_audit_v1:")
      && setting.method_execution_route === "receipt_conformance"
      && setting.method_execution_parameter_path === "/methodProfileReadiness/evidence"
      && ((setting.method_execution_destination_id === "chronicle.reported-result-oracle-evidence@comparison-required"
          && setting.method_execution_blocker_code === "scientific_oracle_comparison_receipt_required"
          && isDeepStrictEqual(setting.required_inputs, ["source_execution_output", "source_result_oracle"]))
        || (setting.method_execution_destination_id === "chronicle.source-execution-semantics@adjudication-required"
          && setting.method_execution_blocker_code === "source_execution_semantics_unadjudicated"
          && isDeepStrictEqual(setting.required_inputs, ["source_method_receipt"])));
    if (setting.method_applicability_status !== "applicable"
      || setting.method_disclosure_status !== "declared"
      || setting.source_coverage_status !== "DECLARED"
      || setting.method_implementation_status !== "specification_only"
      || (setting.method_execution_route !== "external_named_executor" && !sourceCompletenessEvidenceLane)
      || !Array.isArray(setting.source_locators)
      || !setting.source_locators.length) {
      throw new Error(`${setting.method_setting_id}: proven evidence-only row no longer matches its source classification preconditions`);
    }
    canonicalJson(setting.method_value_json, setting.method_setting_id);
    const documentarySchema = category === "published_framework_comparison_table_schema";
    counts.set(category, (counts.get(category) ?? 0) + 1);
    correctedIds.add(setting.method_setting_id);
    const {
      executor_id: _executor,
      conformance_fixture_id: _fixture,
      conformance_result_digest: _resultDigest,
      method_execution_blocker_code: _blocker,
      ...preserved
    } = setting;
    const corrected = {
      ...preserved,
      mapped_contract_slot: [],
      contract_bindings: [],
      required_inputs: documentarySchema ? [] : ["source_execution_output", "source_result_oracle"],
      method_execution_route: "receipt_conformance",
      method_execution_destination_id: documentarySchema
        ? "chronicle.profile-protocol-documentary-registry"
        : "chronicle.reported-result-oracle-evidence@comparison-required",
      method_execution_parameter_path: documentarySchema
        ? "/methodProfileReceipt/documentaryBindings"
        : "/methodProfileReadiness/evidence",
      method_execution_blocker_code: documentarySchema
        ? "receipt_binding_unimplemented"
        : "scientific_oracle_comparison_receipt_required",
      integration_source: `safe_evidence_receipt_reclassification_v1:${category}`,
      adjudication_confidence: 1,
      adjudication_rationale: documentarySchema
        ? "Source-located comparison-table schema is documentary structure, not a missing runtime operator or a reported scientific result. Preserve it in an execution-ineligible documentary receipt."
        : `Source-located ${category.replaceAll("_", " ")} is an expected result for checking scientific execution, not a missing runtime operator. Keep it evidence-blocked until an actual source-output comparison receipt exists; passive preservation of the source text does not prove reproduction.`,
    };
    if (corrected.method_setting_id !== setting.method_setting_id
      || corrected.source_extraction_id !== setting.source_extraction_id
      || corrected.source_work_id !== setting.source_work_id
      || corrected.method_setting_role !== setting.method_setting_role
      || corrected.method_target_layer !== setting.method_target_layer
      || corrected.method_parameter_key !== setting.method_parameter_key
      || corrected.method_value_json !== setting.method_value_json
      || corrected.source_value_json !== setting.source_value_json
      || corrected.source_value_sha256 !== setting.source_value_sha256
      || !isDeepStrictEqual(corrected.source_locators, setting.source_locators)) {
      throw new Error(`${setting.method_setting_id}: safe evidence receipt correction altered source identity, category, value, or locator`);
    }
    return corrected;
  });
  for (const [category, expected] of safeEvidenceReceiptExpectedCounts) {
    if (counts.get(category) !== expected) {
      throw new Error(`safe evidence receipt ${category} count ${counts.get(category) ?? 0}, expected ${expected}`);
    }
  }
  const expectedTotal = [...safeEvidenceReceiptExpectedCounts.values()].reduce((sum, count) => sum + count, 0);
  if (correctedIds.size !== expectedTotal || counts.size !== safeEvidenceReceiptExpectedCounts.size) {
    throw new Error(`safe evidence receipt correction selected ${correctedIds.size}/${expectedTotal} rows across ${counts.size}/${safeEvidenceReceiptExpectedCounts.size} categories`);
  }
  return {
    assertions: correctedAssertions,
    profiles,
    spaces,
    correctedIds,
    summary: {
      corrected_settings: correctedIds.size,
      categories: Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))),
      destination_route: "receipt_conformance",
      execution_eligible: false,
      scientific_result_reproduced: false,
      documentary_schema_settings: counts.get("published_framework_comparison_table_schema"),
      scientific_oracle_comparison_pending_settings: correctedIds.size
        - counts.get("published_framework_comparison_table_schema"),
      source_values_and_locators_preserved: true,
    },
  };
}

function applyProfileProtocolDocumentaryRegistry(assertions, profiles) {
  const profileByWork = new Map(profiles.map((profile) => [profile.source_work_id, profile]));
  const requiredDocumentaryIds = new Set([
    ...correctedProfileProtocolDocumentaryIds,
    ...repairedProfileProtocolDocumentaryIds,
  ]);
  const alreadyImplementedDocumentaryIds = new Set(assertions
    .filter((setting) => requiredDocumentaryIds.has(setting.method_setting_id)
      && setting.method_implementation_status === "native")
    .map((setting) => setting.method_setting_id));
  const failClosedIds = [];
  let provenanceReceipts = 0;
  let reportedResultReceipts = 0;
  let typedAcquisitionReceipts = 0;
  const routedAssertions = assertions.map((setting) => {
    const profile = profileByWork.get(setting.source_work_id);
    const acquisitionProtocol = setting.method_setting_role === "acquisition"
      && setting.method_target_layer === "collector"
      && profileProtocolDocumentaryParameters.has(setting.method_parameter_key)
      && setting.method_execution_route === "protocol_input"
      && setting.method_execution_blocker_code === "protocol_adapter_or_required_input_unimplemented";
    const correctedDocumentary = correctedProfileProtocolDocumentaryIds.has(setting.method_setting_id)
      && (["protocol_input", "receipt_conformance"].includes(setting.method_execution_route)
        && setting.method_execution_blocker_code?.includes("receipt_registration_required_no_new_operator")
        || setting.method_setting_id === "method-setting-ce36bb14f65b60e46518d611"
          && setting.method_setting_role === "acquisition"
          && setting.method_target_layer === "collector"
          && setting.method_execution_route === "native_operator_parameter"
          && setting.method_execution_blocker_code === "small_existing_operator_extension");
    const repairedDocumentary = repairedProfileProtocolDocumentaryIds.has(setting.method_setting_id)
      && setting.method_execution_route === "receipt_conformance"
      && setting.method_execution_blocker_code === "receipt_binding_unimplemented";
    const provenanceReceipt = setting.method_setting_role === "provenance"
      && setting.method_setting_id !== "method-setting-ba42e53a2bb684a034aa67e0"
      && setting.method_execution_route === "receipt_conformance"
      && setting.method_execution_destination_id === "literature.receipt.provenance"
      && setting.method_execution_blocker_code === "receipt_binding_unimplemented";
    const legacyDocumentaryReceipt = ["provenance", "reporting"].includes(setting.method_setting_role)
      && setting.method_execution_route === "receipt_conformance"
      && setting.method_execution_destination_id?.startsWith("literature.receipt_conformance.")
      && ["candidate_not_integrated_or_implemented", "source_evidence_unresolved"].includes(setting.method_execution_blocker_code);
    const reportedResultReceipt = ["provenance", "reporting"].includes(setting.method_setting_role)
      && ["outcome", "released_artifact"].includes(setting.method_target_layer)
      && setting.method_parameter_key.includes(".reported_")
      && setting.method_execution_route === "protocol_input"
      && setting.method_execution_blocker_code === "protocol_adapter_or_required_input_unimplemented";
    const noncomputationalDocumentary = setting.method_execution_route === "external_named_executor"
      && setting.method_execution_destination_id === "noncomputational.documentary-or-study-design@not-an-executor"
      && setting.method_execution_blocker_code === "noncomputational_route_correction_required";
    const typedAcquisitionReceipt = setting.method_execution_route === "protocol_input"
      && setting.method_execution_destination_id === "literature.protocol.acquisition"
      && setting.method_execution_blocker_code === "protocol_adapter_or_required_input_unimplemented"
      && profile?.acquisition_protocols?.some((protocol) =>
        protocol.method_settings?.some((nested) => nested.method_setting_id === setting.method_setting_id));
    const eligibleStatus = setting.method_implementation_status === "specification_only"
      || (reportedResultReceipt && setting.method_implementation_status === "refused_missing_signal");
    if (!eligibleStatus
      || (!acquisitionProtocol && !correctedDocumentary && !repairedDocumentary && !provenanceReceipt
        && !legacyDocumentaryReceipt && !reportedResultReceipt && !noncomputationalDocumentary && !typedAcquisitionReceipt)) return setting;
    if (!profile?.method_setting_ids.includes(setting.method_setting_id)
      || !Array.isArray(setting.source_locators) || !setting.source_locators.length) {
      throw new Error(`${setting.method_setting_id}: profile-protocol documentary source identity is incomplete`);
    }
    canonicalJson(setting.method_value_json, setting.method_setting_id);
    if (provenanceReceipt) provenanceReceipts += 1;
    if (reportedResultReceipt) reportedResultReceipts += 1;
    if (typedAcquisitionReceipt) typedAcquisitionReceipts += 1;
    failClosedIds.push(setting.method_setting_id);
    return setting;
  });
  const missingRequiredIds = [...correctedProfileProtocolDocumentaryIds, ...repairedProfileProtocolDocumentaryIds]
    .filter((id) => !failClosedIds.includes(id) && !alreadyImplementedDocumentaryIds.has(id));
  const expectedFailClosed = 723 - alreadyImplementedDocumentaryIds.size;
  if (failClosedIds.length !== expectedFailClosed || typedAcquisitionReceipts !== 178
    || reportedResultReceipts !== 162
    || new Set(failClosedIds).size !== expectedFailClosed
    || missingRequiredIds.length) {
    throw new Error(`profile-protocol documentary audit kept ${failClosedIds.length}/${expectedFailClosed} fail-closed, unique ${new Set(failClosedIds).size}/${expectedFailClosed}, typed acquisition ${typedAcquisitionReceipts}/178, reported results ${reportedResultReceipts}/162, missing required ${missingRequiredIds.join(",") || "none"}`);
  }
  const canonicalAssertionsById = new Map(routedAssertions.map((setting) => [setting.method_setting_id, setting]));
  const typedProtocolSlots = [
    "acquisition_protocols", "session_construction_policies", "notification_attribution_policies",
    "duration_policies", "timestamp_policies", "parameter_provenance_assertions", "release_profiles",
  ];
  return {
    assertions: routedAssertions,
    profiles: profiles.map((profile) => ({
      ...profile,
      ...refreshProtocolMethodSettings(
        Object.fromEntries(typedProtocolSlots.map((slot) => [slot, profile[slot] ?? []])),
        profile,
        canonicalAssertionsById,
      ),
    })),
    summary: {
      promoted_settings: 0,
      fail_closed_settings: failClosedIds.length,
      parameter_families: profileProtocolDocumentaryParameters.size,
      corrected_documentary_settings: correctedProfileProtocolDocumentaryIds.size,
      repaired_documentary_settings: repairedProfileProtocolDocumentaryIds.size,
      implemented_by_executable_adapter_settings: alreadyImplementedDocumentaryIds.size,
      provenance_receipt_settings: provenanceReceipts,
      reported_result_receipt_settings: reportedResultReceipts,
      typed_acquisition_receipt_settings: typedAcquisitionReceipts,
      execution_eligible: false,
      exact_source_identity: true,
      validation_passed: true,
    },
  };
}

function promoteProfileProtocolDocumentaryRegistry(assertions, profiles, auditSummary) {
  const profileByWork = new Map(profiles.map((profile) => [profile.source_work_id, profile]));
  const blockedArtifactIds = new Set(JSON.parse(readFileSync(sourceArtifactRegistryPath, "utf8")).rows
    .filter((row) => row.candidate_status !== "ready_for_typed_registry")
    .map((row) => row.method_setting_id));
  const publicLocator = (locator) => {
    const normalized = locator.replaceAll(`${repo}/`, "");
    if ((locator.startsWith("/") && normalized === locator) || normalized.includes("/Users/")) {
      throw new Error(`profile-protocol documentary locator is outside the repository: ${locator}`);
    }
    return normalized;
  };
  const promotedIds = new Set();
  const promotedAssertions = assertions.map((setting) => {
    const profile = profileByWork.get(setting.source_work_id);
    const projectableClass = /^(projectable|hammer|hush)_source_completeness_audit_v1:/.test(setting.integration_source ?? "")
      ? setting.integration_source.split(":").at(-1) : null;
    const safeEvidenceCategory = safeEvidenceReceiptCategory(setting);
    const safeDocumentarySchema = safeEvidenceCategory === "published_framework_comparison_table_schema";
    const sourceAuditedDocumentary = sourceAuditedDocumentaryProfileIds.has(setting.method_setting_id)
      && setting.source_work_id === "doi:10.1016/j.chb.2023.107977"
      && ((setting.method_setting_role === "acquisition"
          && setting.method_target_layer === "collector"
          && ["profile.collector", "profile.collector_platform"].includes(setting.method_parameter_key))
        || (setting.method_setting_role === "event_schema"
          && setting.method_target_layer === "raw_record"
          && setting.method_parameter_key === "profile.reconstruction_input_record_type")
        || (setting.method_setting_role === "reconstruction"
          && setting.method_target_layer === "app_episode"
          && setting.method_parameter_key === "profile.reconstruction_input_dependency"))
      && ["protocol_input", "receipt_conformance"].includes(setting.method_execution_route)
      && setting.method_execution_destination_id?.startsWith("literature.source-completeness.")
      && ["source_completeness_execution_pending", "receipt_binding_unimplemented"].includes(setting.method_execution_blocker_code);
    const eligible = profile
      && setting.method_applicability_status === "applicable"
      && setting.method_disclosure_status === "declared"
      && setting.source_coverage_status === "DECLARED"
      && ((!projectableClass && ["provenance", "reporting"].includes(setting.method_setting_role))
        || projectableClass === "documentary_fact"
        || safeDocumentarySchema || sourceAuditedDocumentary)
      && setting.method_implementation_status === "specification_only"
      && !blockedArtifactIds.has(setting.method_setting_id)
      && (setting.method_execution_route === "receipt_conformance" || sourceAuditedDocumentary)
      && (!safeEvidenceCategory || (safeDocumentarySchema
        && setting.integration_source === `safe_evidence_receipt_reclassification_v1:${safeEvidenceCategory}`))
      && (setting.contract_bindings?.length ?? 0) === 0
      && Array.isArray(setting.source_locators)
      && setting.source_locators.length > 0;
    if (!eligible) return setting;
    canonicalJson(setting.method_value_json, setting.method_setting_id);
    const registryInput = {
      schema_version: "chronicle-profile-protocol-documentary-binding/v1",
      method_profile_id: profile.method_profile_id,
      source_work_id: profile.source_work_id,
      source_method_variant_id: profile.source_method_variant_id,
      method_profile_version: profile.method_profile_version,
      method_setting_id: setting.method_setting_id,
      method_setting_role: setting.method_setting_role,
      method_target_layer: setting.method_target_layer,
      method_parameter_key: setting.method_parameter_key,
      method_value_json: setting.method_value_json,
      source_locators: setting.source_locators.map(publicLocator),
      source_clause_ids: setting.source_clause_ids ?? [],
    };
    const fixtureId = `profile-protocol-documentary.${setting.method_setting_id}.v1`;
    const registryInputSha256 = sha256Bytes(canonicalObjectJson(registryInput));
    const result = {
      schema_version: "chronicle-profile-protocol-documentary-result/v1",
      accepted: true,
      fixture_id: fixtureId,
      registry_input_sha256: registryInputSha256,
      execution_eligible: false,
    };
    const { method_execution_blocker_code: _blocker, ...rest } = setting;
    promotedIds.add(setting.method_setting_id);
    return {
      ...rest,
      method_implementation_status: "native",
      method_execution_route: "receipt_conformance",
      method_execution_destination_id: "chronicle.profile-protocol-documentary-registry",
      method_execution_parameter_path: "/methodProfileReceipt/documentaryBindings",
      executor_id: "chronicle_preprocessing_runtime_wasm:profile_protocol_documentary_registry",
      conformance_fixture_id: fixtureId,
      conformance_result_digest: sha256Bytes(canonicalObjectJson(result)),
      integration_source: safeEvidenceCategory
        ? `safe_evidence_documentary_receipt_v1:${safeEvidenceCategory}`
        : sourceAuditedDocumentary
          ? "source_audited_nonbehavioral_profile_receipt_v1"
          : "profile_protocol_documentary_counterfactual_v1",
      adjudication_confidence: 1,
      adjudication_rationale: safeEvidenceCategory
        ? `Closed execution-ineligible receipt preserves this exact ${safeEvidenceCategory.replaceAll("_", " ")} as evidence; it does not execute an operator or prove reproduction of the reported result.`
        : sourceAuditedDocumentary
          ? "Source audit established this as collector/input-description metadata, not a preprocessing operation or serialized field mapping. The closed execution-ineligible receipt preserves it without inventing runtime behavior."
          : "Closed receipt-only binding preserves the exact disclosed fact; it changes receipt identity and cannot alter processing options or claim execution eligibility.",
    };
  });
  const canonicalById = new Map(promotedAssertions.map((setting) => [setting.method_setting_id, setting]));
  const typedProtocolSlots = [
    "acquisition_protocols", "session_construction_policies", "notification_attribution_policies",
    "duration_policies", "timestamp_policies", "parameter_provenance_assertions", "release_profiles",
  ];
  const updateIds = (ids, keepPromoted) => unique([
    ...(ids ?? []).filter((id) => !promotedIds.has(id)),
    ...(keepPromoted ? (ids ?? []).filter((id) => promotedIds.has(id)) : []),
  ]);
  const promotedProfiles = profiles.map((profile) => {
    const profilePromoted = new Set(profile.method_setting_ids.filter((id) => promotedIds.has(id)));
    if (!profilePromoted.size) return profile;
    const updateSpace = (space) => {
      const globallyScopedIds = new Set([
        ...(space.invariant_method_setting_ids ?? []),
        ...(space.documentary_method_setting_ids ?? []),
        ...(space.unresolved_method_setting_ids ?? []),
      ]);
      return {
        ...space,
        documentary_method_setting_ids: unique([...(space.documentary_method_setting_ids ?? []),
          ...[...profilePromoted].filter((id) => globallyScopedIds.has(id))]),
        unresolved_method_setting_ids: updateIds(space.unresolved_method_setting_ids, false),
        method_configuration_groups: (space.method_configuration_groups ?? []).map((group) => ({
          ...group,
          documentary_method_setting_ids: unique([...(group.documentary_method_setting_ids ?? []),
            ...(group.unresolved_method_setting_ids ?? []).filter((id) => profilePromoted.has(id))]),
          unresolved_method_setting_ids: updateIds(group.unresolved_method_setting_ids, false),
          method_configuration_levels: (group.method_configuration_levels ?? []).map((level) => ({
            ...level,
            documentary_method_setting_ids: unique([...(level.documentary_method_setting_ids ?? []),
              ...(level.included_method_setting_ids ?? []).filter((id) => profilePromoted.has(id))]),
            unresolved_method_setting_ids: updateIds(level.unresolved_method_setting_ids, false),
          })),
        })),
      };
    };
    return {
      ...profile,
      ...refreshProtocolMethodSettings(
        Object.fromEntries(typedProtocolSlots.map((slot) => [slot, profile[slot] ?? []])),
        profile,
        canonicalById,
      ),
      method_configuration_space: updateSpace(profile.method_configuration_space),
    };
  });
  const remaining = promotedAssertions.filter((setting) =>
    setting.method_applicability_status === "applicable"
    && setting.method_disclosure_status === "declared"
    && ["provenance", "reporting"].includes(setting.method_setting_role)
    && setting.method_implementation_status === "specification_only"
    && setting.method_execution_route === "receipt_conformance").length;
  if ([...sourceAuditedDocumentaryProfileIds].some((id) => !promotedIds.has(id))) {
    throw new Error("source-audited Schoedel documentary profile receipt promotion drift");
  }
  return {
    assertions: promotedAssertions,
    profiles: promotedProfiles,
    summary: {
      ...auditSummary,
      promoted_settings: promotedIds.size,
      safe_evidence_receipt_settings: [...promotedIds].filter((id) =>
        safeEvidenceReceiptCategory(promotedAssertions.find((setting) => setting.method_setting_id === id))).length,
      fail_closed_settings: remaining,
      behavioral_counterfactual: "receipt_identity_changes_processing_options_do_not",
      execution_eligible: false,
      exact_source_identity: true,
      validation_passed: true,
    },
  };
}

function applyExistingAggregateConformance(assertions, profiles) {
  const fixtures = new Map(JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures
    .filter((fixture) => fixture.fixture_id.startsWith("aggregate.daily-"))
    .map((fixture) => [fixture.fixture_id, fixture]));
  const fixtureBySetting = new Map([
    ["method-setting-atomic-b6473e2fbf27ce98db5b", "aggregate.daily-event-count-and-window.v1"],
    ["method-setting-bbc442dee45edfe015ff5c95", "aggregate.daily-event-count-and-window.v1"],
    ["method-setting-49617f4dad052c564155c91e", "aggregate.daily-screen-time-sum.v1"],
  ]);
  const expectedDigests = new Map([
    ["aggregate.daily-event-count-and-window.v1", "sha256:4dfc6eb5417f502f55d62f3e26fda83f1a2a7f3abee31e2f66cf61126785498b"],
    ["aggregate.daily-screen-time-sum.v1", "sha256:f02cf37c2124988be0d263b57b1bb00d242c269569485a171537900ea05960c1"],
  ]);
  for (const [fixtureId, digest] of expectedDigests) {
    const fixture = fixtures.get(fixtureId);
    if (!fixture || fixture.result_digest !== digest
      || !isDeepStrictEqual(fixture.browser_contract_bindings, { enable_aggregates: true })) {
      throw new Error(`${fixtureId}: existing aggregate conformance fixture drift`);
    }
  }
  let promoted = 0;
  const routedAssertions = assertions.map((setting) => {
    const fixtureId = fixtureBySetting.get(setting.method_setting_id);
    if (!fixtureId) return setting;
    if (setting.method_implementation_status !== "specification_only"
      || setting.method_execution_route !== "external_named_executor"
      || setting.method_execution_destination_id !== "chronicle.aggregate-exports-kernel@0.1.0+git.cfbc198be110"
      || setting.method_execution_blocker_code !== "external_executor_binding_conformance_pending") {
      throw new Error(`${setting.method_setting_id}: existing aggregate executor route drift`);
    }
    const fixture = fixtures.get(fixtureId);
    if (!fixture.method_setting_ids.includes(setting.method_setting_id)) {
      throw new Error(`${setting.method_setting_id}: aggregate fixture membership drift`);
    }
    const { method_execution_blocker_code: _blocker, ...unblocked } = setting;
    promoted += 1;
    return {
      ...unblocked,
      mapped_contract_slot: ["enable_aggregates"],
      contract_bindings: [{ contract_slot: "enable_aggregates", contract_value_json: "true" }],
      method_implementation_status: "native",
      method_execution_route: "native_option_binding",
      method_execution_destination_id: nativeExecutor,
      method_execution_parameter_path: "/browser-processing-options",
      executor_id: nativeExecutor,
      conformance_fixture_id: fixture.fixture_id,
      conformance_result_digest: fixture.result_digest,
      adjudication_rationale: `${setting.adjudication_rationale} The existing aggregate export is enabled through its public option and proven by the source-specific daily fixture.`,
    };
  });
  if (promoted !== fixtureBySetting.size
    || [...fixtureBySetting].some(([id]) => !profiles.some((profile) => profile.method_setting_ids.includes(id)))) {
    throw new Error(`existing aggregate conformance promoted ${promoted}, expected ${fixtureBySetting.size}`);
  }
  return { assertions: routedAssertions, profiles, summary: {
    promoted_settings: promoted,
    executed_fixtures: fixtures.size,
    existing_backend_and_gui_reused: true,
    validation_passed: true,
  } };
}

function applyPublishedSessionOutputSchemaConformance(assertions, profiles) {
  requirePrivate(publishedSessionOutputConformanceDirectory, 0o700);
  requirePrivate(publishedSessionOutputConformanceMappingPath, 0o600);
  requirePrivate(publishedSessionOutputConformanceValidationPath, 0o600);
  const rows = jsonl(publishedSessionOutputConformanceMappingPath);
  const validation = JSON.parse(readFileSync(publishedSessionOutputConformanceValidationPath, "utf8"));
  const fixtureTestPath = resolve(repo, "rust/chronicle_preprocessing_runtime_wasm/tests/literature_native_conformance.rs");
  if (validation.schema_version !== "chronicle-published-session-output-conformance-validation/v1"
    || validation.mapping_sha256 !== sha256(publishedSessionOutputConformanceMappingPath)
    || validation.native_fixture_manifest_sha256 !== sha256(nativeConformanceFixturePath)
    || validation.native_fixture_test_sha256 !== sha256(fixtureTestPath)
    || validation.proven_setting_count !== 7
    || validation.executed_fixture_count !== 2
    || validation.source_work_count !== 2
    || validation.existing_backend_and_gui_reused !== true
    || validation.new_algorithm_added !== false
    || validation.new_gui_control_added !== false
    || validation.all_fixture_digests_are_from_executed_passing_results !== true
    || validation.validation_passed !== true
    || !isDeepStrictEqual(validation.blocked_constructor_setting_ids, [
      "method-setting-200aba0960cd74de9c073974",
      "method-setting-a50a61416c9ac4897bf7cd32",
    ])) {
    throw new Error("published session-output conformance validation or content hash drift");
  }

  const expectedBySetting = new Map([
    ["method-setting-0838bf4b5c0246ccf5371d08", {
      source_extraction_id: "extraction-7526cfa30d5d8b723a8c", source_work_id: "doi:10.1186/s13104-015-1280-z",
      source_value_sha256: "29eda172e5c50687740fb596a24f5ff5a6f91b62f8cea05981d5ab078a39c1ba",
      source_clause_text: "end-time", method_parameter_key: "app_session_output_field.end_time", method_value_json: "\"end-time\"",
      method_target_layer: "app_session", chronicle_output_kind: "app-csv", chronicle_output_column: "stop_timestamp", source_output_position: 3,
      fixture_id: "output-schema.phone-app-session-tuple.v1", conformance_result_digest: "sha256:3803f20b10ea9e2f6a7b45d13d2fa579ab8f1324023bfc16788ac1b61222f94e",
      contract_bindings: [{ contract_slot: "process_app_usage", contract_value_json: "true" }],
    }],
    ["method-setting-6a3d2320f781538a15821616", {
      source_extraction_id: "extraction-7526cfa30d5d8b723a8c", source_work_id: "doi:10.1186/s13104-015-1280-z",
      source_value_sha256: "29eda172e5c50687740fb596a24f5ff5a6f91b62f8cea05981d5ab078a39c1ba",
      source_clause_text: "user-ID", method_parameter_key: "app_session_output_field.user_id", method_value_json: "\"user-ID\"",
      method_target_layer: "app_session", chronicle_output_kind: "app-csv", chronicle_output_column: "participant_id", source_output_position: 0,
      fixture_id: "output-schema.phone-app-session-tuple.v1", conformance_result_digest: "sha256:3803f20b10ea9e2f6a7b45d13d2fa579ab8f1324023bfc16788ac1b61222f94e",
      contract_bindings: [{ contract_slot: "process_app_usage", contract_value_json: "true" }],
    }],
    ["method-setting-db0216ebf7b3be75c6ca51d0", {
      source_extraction_id: "extraction-7526cfa30d5d8b723a8c", source_work_id: "doi:10.1186/s13104-015-1280-z",
      source_value_sha256: "29eda172e5c50687740fb596a24f5ff5a6f91b62f8cea05981d5ab078a39c1ba",
      source_clause_text: "app-name", method_parameter_key: "app_session_output_field.app_name", method_value_json: "\"app-name\"",
      method_target_layer: "app_session", chronicle_output_kind: "app-csv", chronicle_output_column: "application_label", source_output_position: 1,
      fixture_id: "output-schema.phone-app-session-tuple.v1", conformance_result_digest: "sha256:3803f20b10ea9e2f6a7b45d13d2fa579ab8f1324023bfc16788ac1b61222f94e",
      contract_bindings: [{ contract_slot: "process_app_usage", contract_value_json: "true" }],
    }],
    ["method-setting-dd59db0aa39192129c3881eb", {
      source_extraction_id: "extraction-7526cfa30d5d8b723a8c", source_work_id: "doi:10.1186/s13104-015-1280-z",
      source_value_sha256: "29eda172e5c50687740fb596a24f5ff5a6f91b62f8cea05981d5ab078a39c1ba",
      source_clause_text: "start-time", method_parameter_key: "app_session_output_field.start_time", method_value_json: "\"start-time\"",
      method_target_layer: "app_session", chronicle_output_kind: "app-csv", chronicle_output_column: "start_timestamp", source_output_position: 2,
      fixture_id: "output-schema.phone-app-session-tuple.v1", conformance_result_digest: "sha256:3803f20b10ea9e2f6a7b45d13d2fa579ab8f1324023bfc16788ac1b61222f94e",
      contract_bindings: [{ contract_slot: "process_app_usage", contract_value_json: "true" }],
    }],
    ["method-setting-67287c58efdab036798b5e17", {
      source_extraction_id: "extraction-856b83a7b3ce2aca6cca", source_work_id: "doi:10.3390/bs5040434",
      source_value_sha256: "0e66606d1f0c548673276a83652d1c77fa65243556e057019315075463a7eb7b",
      source_clause_text: "User-ID", method_parameter_key: "phone_session_output_field.user_id", method_value_json: "\"User-ID\"",
      method_target_layer: "device_session", chronicle_output_kind: "screen-csv", chronicle_output_column: "participant_id", source_output_position: 0,
      fixture_id: "output-schema.phone-session-tuple.v1", conformance_result_digest: "sha256:b5c42281e7dfefc1ce2bd96e16477a856de576403b9e14443d372cbdea64dca6",
      contract_bindings: [{ contract_slot: "process_screen_usage", contract_value_json: "true" }],
    }],
    ["method-setting-c3673c2db80ff230a7368f0f", {
      source_extraction_id: "extraction-856b83a7b3ce2aca6cca", source_work_id: "doi:10.3390/bs5040434",
      source_value_sha256: "0e66606d1f0c548673276a83652d1c77fa65243556e057019315075463a7eb7b",
      source_clause_text: "stop-time", method_parameter_key: "phone_session_output_field.stop_time", method_value_json: "\"stop-time\"",
      method_target_layer: "device_session", chronicle_output_kind: "screen-csv", chronicle_output_column: "stop_timestamp", source_output_position: 2,
      fixture_id: "output-schema.phone-session-tuple.v1", conformance_result_digest: "sha256:b5c42281e7dfefc1ce2bd96e16477a856de576403b9e14443d372cbdea64dca6",
      contract_bindings: [{ contract_slot: "process_screen_usage", contract_value_json: "true" }],
    }],
    ["method-setting-fb1c5e5a511cefee50e4e5b6", {
      source_extraction_id: "extraction-856b83a7b3ce2aca6cca", source_work_id: "doi:10.3390/bs5040434",
      source_value_sha256: "0e66606d1f0c548673276a83652d1c77fa65243556e057019315075463a7eb7b",
      source_clause_text: "start-time", method_parameter_key: "phone_session_output_field.start_time", method_value_json: "\"start-time\"",
      method_target_layer: "device_session", chronicle_output_kind: "screen-csv", chronicle_output_column: "start_timestamp", source_output_position: 1,
      fixture_id: "output-schema.phone-session-tuple.v1", conformance_result_digest: "sha256:b5c42281e7dfefc1ce2bd96e16477a856de576403b9e14443d372cbdea64dca6",
      contract_bindings: [{ contract_slot: "process_screen_usage", contract_value_json: "true" }],
    }],
  ]);
  if (rows.length !== expectedBySetting.size
    || new Set(rows.map((row) => row.method_setting_id)).size !== rows.length) {
    throw new Error("published session-output conformance setting identity drift");
  }
  const rowsBySetting = new Map(rows.map((row) => [row.method_setting_id, row]));
  for (const [settingId, expected] of expectedBySetting) {
    const row = rowsBySetting.get(settingId);
    if (!row
      || row.schema_version !== "chronicle-published-session-output-conformance/v1"
      || row.proof_status !== "executed_and_passed"
      || row.test_command !== "cargo test --locked --test literature_native_conformance"
      || Object.entries(expected).some(([key, value]) => !isDeepStrictEqual(row[key], value))) {
      throw new Error(`${settingId}: published session-output conformance mapping drift`);
    }
  }

  const fixtures = new Map(JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures
    .filter((fixture) => fixture.fixture_id.startsWith("output-schema."))
    .map((fixture) => [fixture.fixture_id, fixture]));
  for (const [fixtureId, slot, digest] of [
    ["output-schema.phone-app-session-tuple.v1", "process_app_usage", "sha256:3803f20b10ea9e2f6a7b45d13d2fa579ab8f1324023bfc16788ac1b61222f94e"],
    ["output-schema.phone-session-tuple.v1", "process_screen_usage", "sha256:b5c42281e7dfefc1ce2bd96e16477a856de576403b9e14443d372cbdea64dca6"],
  ]) {
    const fixture = fixtures.get(fixtureId);
    const fixtureRows = rows.filter((row) => row.fixture_id === fixtureId);
    const mappedIds = fixtureRows.map((row) => row.method_setting_id).sort();
    const expectedOutputBindings = fixtureRows
      .map((row) => {
        const sourceOutputField = JSON.parse(row.method_value_json);
        if (typeof sourceOutputField !== "string" || sourceOutputField !== row.source_clause_text) {
          throw new Error(`${row.method_setting_id}: published output field source spelling drift`);
        }
        return {
          method_setting_id: row.method_setting_id,
          source_output_field: sourceOutputField,
          chronicle_output_kind: row.chronicle_output_kind,
          chronicle_output_column: row.chronicle_output_column,
          source_output_position: row.source_output_position,
        };
      })
      .sort((left, right) => left.source_output_position - right.source_output_position);
    if (!fixture
      || !isDeepStrictEqual(fixture.method_setting_ids.slice().sort(), mappedIds)
      || !isDeepStrictEqual(fixture.browser_contract_bindings, { [slot]: true })
      || !isDeepStrictEqual(fixture.output_bindings, expectedOutputBindings)
      || fixture.result_digest !== digest) {
      throw new Error(`${fixtureId}: published session-output fixture drift`);
    }
  }

  let promoted = 0;
  const promotedAssertions = assertions.map((setting) => {
    const row = rowsBySetting.get(setting.method_setting_id);
    if (!row) return setting;
    if (setting.source_work_id !== row.source_work_id
      || setting.source_extraction_id !== row.source_extraction_id
      || setting.source_value_sha256 !== row.source_value_sha256
      || setting.source_clause_text !== row.source_clause_text
      || setting.method_parameter_key !== row.method_parameter_key
      || setting.method_value_json !== row.method_value_json
      || setting.method_target_layer !== row.method_target_layer
      || setting.method_implementation_status !== "specification_only"
      || setting.method_execution_route !== "native_operator_parameter"
      || setting.method_execution_blocker_code !== "native_operator_unimplemented") {
      throw new Error(`${setting.method_setting_id}: published session-output source or blocked route drift`);
    }
    promoted += 1;
    return {
      ...applyExecutedNativeExtension(setting, row),
      chronicle_output_kind: row.chronicle_output_kind,
      chronicle_output_column: row.chronicle_output_column,
      source_output_position: row.source_output_position,
      adjudication_rationale: `${setting.adjudication_rationale} Chronicle already emits the published ${row.chronicle_output_column} field when ${row.contract_bindings[0].contract_slot} is enabled; the executed fixture proves the emitted value without claiming the source's undisclosed session-construction rule.`,
    };
  });
  const blockedConstructors = promotedAssertions.filter((setting) =>
    validation.blocked_constructor_setting_ids.includes(setting.method_setting_id));
  if (promoted !== expectedBySetting.size
    || blockedConstructors.length !== validation.blocked_constructor_setting_ids.length
    || blockedConstructors.some((setting) => setting.method_implementation_status === "native"
      || setting.method_execution_route !== "native_operator_parameter"
      || setting.method_execution_blocker_code !== "native_operator_unimplemented")) {
    throw new Error("published session-output promotion count drift or constructor was improperly promoted");
  }
  const canonicalAssertionsById = new Map(promotedAssertions.map((setting) => [setting.method_setting_id, setting]));
  const typedProtocolSlots = [
    "acquisition_protocols", "session_construction_policies", "notification_attribution_policies",
    "duration_policies", "timestamp_policies", "parameter_provenance_assertions", "release_profiles",
  ];
  const refreshedProfiles = profiles.map((profile) => ({
    ...profile,
    ...refreshProtocolMethodSettings(
      Object.fromEntries(typedProtocolSlots.map((slot) => [slot, profile[slot] ?? []])),
      profile,
      canonicalAssertionsById,
    ),
  }));
  return { assertions: promotedAssertions, profiles: refreshedProfiles, summary: {
    promoted_settings: promoted,
    executed_fixtures: fixtures.size,
    blocked_constructor_settings: blockedConstructors.length,
    existing_backend_and_gui_reused: true,
    validation_passed: true,
  } };
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function sha256(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function runRuntimeConformance(arguments_, label) {
  const [command, ...argumentsAfterCommand] = arguments_;
  const execution = spawnSync(process.env.CARGO ?? "cargo", [
    command,
    "--manifest-path", resolve(repo, "rust/chronicle_preprocessing_runtime_wasm/Cargo.toml"),
    ...argumentsAfterCommand,
  ], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (execution.status !== 0) {
    throw new Error(`${label} executable conformance failed:\n${execution.stdout}\n${execution.stderr}`);
  }
  return `${execution.stdout}\n${execution.stderr}`;
}

function requireExactManifestFiles(manifest, expectedSourceControlled, expectedGenerated, declaredHashes, id) {
  if (!isDeepStrictEqual(manifest.source_controlled_files, expectedSourceControlled)
    || !isDeepStrictEqual(manifest.generated_files, expectedGenerated)) {
    throw new Error(`${id}: implementation manifest file inventory drift`);
  }
  const expectedFiles = [...expectedSourceControlled, ...expectedGenerated];
  if (!declaredHashes || !isDeepStrictEqual(Object.keys(declaredHashes).sort(), [...expectedFiles].sort())) {
    throw new Error(`${id}: implementation validation file-hash inventory drift`);
  }
  for (const path of expectedFiles) {
    if (!existsSync(resolve(repo, path))) throw new Error(`${id}: declared implementation file is missing: ${path}`);
    if (declaredHashes[path] !== sha256(resolve(repo, path))) {
      throw new Error(`${id}: declared implementation file hash drift: ${path}`);
    }
  }
}

function fixtureObjectSpans(raw) {
  const fixturesKey = raw.indexOf('"fixtures"');
  const arrayStart = fixturesKey < 0 ? -1 : raw.indexOf("[", fixturesKey);
  if (arrayStart < 0) throw new Error("native conformance fixture manifest has no fixtures array");
  const spans = [];
  let objectStart = -1;
  let objectDepth = 0;
  let inString = false;
  let escaped = false;
  for (let index = arrayStart + 1; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      if (objectDepth === 0) objectStart = index;
      objectDepth += 1;
    } else if (character === "}") {
      objectDepth -= 1;
      if (objectDepth === 0) {
        const value = JSON.parse(raw.slice(objectStart, index + 1));
        spans.push({ start: objectStart, end: index, fixture_id: value.fixture_id, value });
      }
    } else if (character === "]" && objectDepth === 0) {
      return spans;
    }
  }
  throw new Error("native conformance fixture manifest fixtures array is unterminated");
}

function projectNativeConformanceManifest(raw, expectedFixtureIds, expectedSettingIds) {
  let projected = raw;
  const removed = [];
  for (;;) {
    const spans = fixtureObjectSpans(projected);
    const extraIndex = spans.findIndex((span) => !expectedFixtureIds.has(span.fixture_id));
    if (extraIndex < 0) break;
    const extra = spans[extraIndex];
    removed.push(extra.value);
    const lineStart = projected.lastIndexOf("\n", extra.start - 1) + 1;
    let after = extra.end + 1;
    while (projected[after] === " " || projected[after] === "\t") after += 1;
    if (projected[after] === ",") {
      after += 1;
      if (projected[after] === "\r") after += 1;
      if (projected[after] === "\n") after += 1;
      projected = projected.slice(0, lineStart) + projected.slice(after);
      continue;
    }
    const previous = spans[extraIndex - 1];
    if (!previous) throw new Error("cannot project an all-additive native conformance fixture manifest");
    let suffix = extra.end + 1;
    if (projected[suffix] === "\r") suffix += 1;
    if (projected[suffix] === "\n") suffix += 1;
    projected = `${projected.slice(0, previous.end + 1)}\n${projected.slice(suffix)}`;
  }
  const removedSettingIds = [];
  if (expectedSettingIds) {
    for (const fixture of fixtureObjectSpans(projected).reverse()) {
      const retained = fixture.value.method_setting_ids.filter((id) => expectedSettingIds.has(id));
      const additive = fixture.value.method_setting_ids.filter((id) => !expectedSettingIds.has(id));
      if (!additive.length) continue;
      removedSettingIds.push(...additive);
      const keyStart = projected.indexOf('"method_setting_ids"', fixture.start);
      const arrayStart = projected.indexOf("[", keyStart);
      const arrayEnd = projected.indexOf("]", arrayStart);
      const lineStart = projected.lastIndexOf("\n", keyStart - 1) + 1;
      const indent = projected.slice(lineStart, keyStart);
      const replacement = retained.length === 1
        ? JSON.stringify(retained)
        : `[\n${retained.map((id) => `${indent}  ${JSON.stringify(id)}`).join(",\n")}\n${indent}]`;
      projected = projected.slice(0, arrayStart) + replacement + projected.slice(arrayEnd + 1);
    }
  }
  return { projected, removed, removedSettingIds };
}

function requirePrivate(path, expectedMode) {
  const actualMode = statSync(path).mode & 0o777;
  if (actualMode !== expectedMode) {
    throw new Error(`${path}: expected mode ${expectedMode.toString(8)}, found ${actualMode.toString(8)}`);
  }
}

function auditValidationChecks(value, path = "validation") {
  if (typeof value === "boolean") return [[path, value]];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => auditValidationChecks(child, `${path}.${key}`));
}

function auditRationale(decision, id) {
  return requireString(
    decision.rationale
      ?? decision.binding_decision?.semantic_match
      ?? decision.blocker_detail?.rationale
      ?? decision.blocker_detail?.evidence_gap,
    "native route audit rationale",
    id,
  );
}

function exactAuditBindings(decision, contractSlots) {
  const id = decision.method_setting_id;
  const browserBindings = decision.binding_decision?.parameter_schema?.bindings;
  let pairs;
  if (Array.isArray(browserBindings)) {
    pairs = browserBindings.map((binding) => {
      const browserSlot = requireString(binding.browser, "audited browser binding", id);
      return [camelToSnake(browserSlot), binding.value];
    });
  } else if (decision.binding && typeof decision.binding === "object" && !Array.isArray(decision.binding)) {
    const controls = decision.gui_control_mapping?.controls;
    if (!Array.isArray(controls) || controls.some((control) => typeof control !== "string")) {
      throw new Error(`${id}: exact quality binding lacks an auditable GUI control map`);
    }
    const controlSlots = new Set(controls.map(camelToSnake));
    pairs = Object.entries(decision.binding).map(([internalSlot, value]) => {
      const contractSlot = qualityBindingSlotAliases.get(internalSlot) ?? internalSlot;
      if (!controlSlots.has(contractSlot)) {
        throw new Error(`${id}: internal binding ${internalSlot} has no exact BrowserProcessingOptions control`);
      }
      return [contractSlot, value];
    });
    if (pairs.length !== controlSlots.size) throw new Error(`${id}: quality binding/control cardinality drift`);
  } else {
    throw new Error(`${id}: exact audit decision has no BrowserProcessingOptions binding`);
  }
  if (!pairs.length) throw new Error(`${id}: exact audit decision has no bindings`);
  const uniqueSlots = new Set(pairs.map(([slot]) => slot));
  if (uniqueSlots.size !== pairs.length) throw new Error(`${id}: duplicate audited BrowserProcessingOptions binding`);
  for (const slot of uniqueSlots) {
    if (!contractSlots.has(slot)) throw new Error(`${id}: audited binding is not a BrowserProcessingOptions slot: ${slot}`);
  }
  return pairs.map(([contractSlot, value]) => ({
    contract_slot: contractSlot,
    contract_value_json: JSON.stringify(value),
  }));
}

function loadNativeRouteAudits(operatorContract, contractSlots) {
  const bySetting = new Map();
  const classificationCounts = Object.fromEntries([...nativeRouteAuditClassifications].map((value) => [value, 0]));
  for (const spec of nativeRouteAuditSpecs) {
    const decisionsPath = resolve(spec.directory, "decisions.jsonl");
    const validationPath = resolve(spec.directory, "validation.json");
    requirePrivate(spec.directory, 0o700);
    requirePrivate(decisionsPath, 0o600);
    requirePrivate(validationPath, 0o600);
    const decisions = jsonl(decisionsPath);
    const validation = JSON.parse(readFileSync(validationPath, "utf8"));
    const validationChecks = auditValidationChecks(validation);
    const failedCheck = validationChecks.find(([, passed]) => !passed);
    if (!validationChecks.length || failedCheck) {
      throw new Error(`${spec.name}: native route audit validation failed${failedCheck ? ` at ${failedCheck[0]}` : ""}`);
    }
    const expectedIds = new Set(operatorContract.setting_routes
      .filter((route) => route.destination_node_template_id === spec.destinationId)
      .map((route) => route.method_setting_id));
    const decisionIds = decisions.map((decision) => requireString(decision.method_setting_id, "method_setting_id", spec.name));
    if (new Set(decisionIds).size !== decisionIds.length
      || decisionIds.length !== expectedIds.size
      || decisionIds.some((id) => !expectedIds.has(id))) {
      throw new Error(`${spec.name}: native route audit identity set does not exactly match ${spec.destinationId}`);
    }
    for (const decision of decisions) {
      const id = decision.method_setting_id;
      if (bySetting.has(id)) throw new Error(`${id}: duplicate native route audit decision`);
      const classification = decision.classification ?? decision.audit_classification;
      if (!nativeRouteAuditClassifications.has(classification)) {
        throw new Error(`${id}: unknown native route audit classification ${classification}`);
      }
      classificationCounts[classification] += 1;
      bySetting.set(id, {
        classification,
        rationale: auditRationale(decision, id),
        requiredInputs: unique([
          ...(decision.required_inputs ?? []),
          ...(decision.missing_inputs ?? []),
          ...(decision.current_route?.required_inputs ?? []),
          ...(decision.blocker_detail?.missing_inputs ?? []),
        ]),
        bindings: classification === "exact_existing_binding" ? exactAuditBindings(decision, contractSlots) : [],
        decision: {
          ...decision,
          method_value_json: decision.method_value_json ?? decision.source_semantics?.method_value_json,
        },
      });
    }
  }
  return {
    bySetting,
    summary: {
      audited_settings: bySetting.size,
      classifications: classificationCounts,
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

const correctedNewOperatorRouteCategories = new Map([
  ["documentary_protocol_input_receipt", "documentary_or_protocol_receipt"],
  ["documentary_protocol_receipt", "documentary_or_protocol_receipt"],
  ["documentary_receipt", "documentary_or_protocol_receipt"],
  ["exact_existing_binding_needs_registration_and_fixture", "exact_existing_binding_conformance"],
  ["missing_typed_input", "missing_typed_input_first"],
  ["missing_typed_input_then_existing_operator_extension", "missing_typed_input_first"],
  ["missing_typed_input_then_new_operator", "missing_typed_input_first"],
  ["external_executor_not_native_preprocessing", "external_executor_incomplete_contract"],
  ["existing_aggregate_operator_extension", "existing_operator_extension"],
  ["existing_daily_aggregate_extension", "existing_operator_extension"],
  ["existing_notification_operator_extension", "existing_operator_extension"],
  ["existing_study_window_operator_extension", "existing_operator_extension"],
  ["existing_timeline_sampling_operator_extension", "existing_operator_extension"],
  ["new_native_operator", "input_complete_new_native_computation"],
]);
const correctedNewOperatorPublicRoutes = new Map([
  ["documentary_protocol_input_receipt", "protocol_input"],
  ["documentary_protocol_receipt", "receipt_conformance"],
  ["documentary_receipt", "receipt_conformance"],
  ["exact_existing_binding_needs_registration_and_fixture", "native_operator_parameter"],
  ["missing_typed_input", "protocol_input"],
  ["missing_typed_input_then_existing_operator_extension", "protocol_input"],
  ["missing_typed_input_then_new_operator", "protocol_input"],
  ["external_executor_not_native_preprocessing", "external_named_executor"],
  ["existing_aggregate_operator_extension", "native_operator_parameter"],
  ["existing_daily_aggregate_extension", "native_operator_parameter"],
  ["existing_notification_operator_extension", "native_operator_parameter"],
  ["existing_study_window_operator_extension", "native_operator_parameter"],
  ["existing_timeline_sampling_operator_extension", "native_operator_parameter"],
  ["new_native_operator", "native_operator_parameter"],
]);

const semanticTokenStopWords = new Set([
  "a", "also", "an", "and", "as", "at", "be", "by", "clause", "code", "data", "derived",
  "each", "exact", "for", "from", "has", "if", "in", "into", "is", "it", "method", "of",
  "only", "or", "out", "source", "the", "this", "through", "to", "under", "using", "value",
  "where", "while", "with", "without", "inspect",
]);

function semanticTokens(value) {
  return JSON.stringify(value)
    .toLowerCase()
    .replace(/(\d+)h\b/g, "$1 hours")
    .replace(/longer\s+than|exceeded|over/g, " greater ")
    .replace(/less\s+than/g, " less ")
    .replace(/>/g, " greater ")
    .replace(/</g, " less ")
    .replace(/[→−]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !semanticTokenStopWords.has(token));
}

function correctedNewOperatorCategoryCounts(tranches) {
  const counts = {};
  for (const tranche of tranches) {
    const category = correctedNewOperatorRouteCategories.get(tranche.corrected_route);
    if (!category) throw new Error(`${tranche.tranche_id}: unknown corrected new-operator route ${tranche.corrected_route}`);
    counts[category] = (counts[category] ?? 0) + tranche.method_setting_ids.length;
  }
  return counts;
}

function validateCorrectedNewOperatorPartition(tranches, validation, nativeRouteAudits, expectedCount = 58) {
  const expectedIds = new Set([...nativeRouteAudits.bySetting]
    .filter(([, audit]) => audit.classification === "new_operator_required")
    .map(([id]) => id));
  if (expectedIds.size !== expectedCount) {
    throw new Error(`corrected new-operator partition expected ${expectedCount} audited IDs, found ${expectedIds.size}`);
  }
  const repairedSiblingId = "method-setting-0c549383fd539ac9ee4fa5f1";
  const expectedRepair = expectedCount === 58 ? {
    source_work_id: "doi:10.1016/j.compedu.2019.103611",
    source_locator: resolve(repo, ".tmp-literature-review-private/corrective-packet-08-ranks277-329-20260831/fulltext/rank288-primary.txt:409-414"),
    before_method_setting_ids: [
      "method-setting-acbce6b9d05461111a8792b1",
      "method-setting-e5a87fa0f1a10d4184bfe018",
    ],
    after_method_setting_ids: [
      "method-setting-e5a87fa0f1a10d4184bfe018",
      "method-setting-acbce6b9d05461111a8792b1",
      repairedSiblingId,
    ],
    added_method_setting_id: repairedSiblingId,
    added_atomic_value: 16,
    source_group_operator: "CONJUNCTION",
    explicit_date_support_required: true,
    week_1_anchor_inference_allowed: false,
    support_claimed: false,
  } : undefined;
  if (!isDeepStrictEqual(validation.t27_source_planning_repair, expectedRepair)) {
    throw new Error("corrected new-operator T27 source-planning repair metadata drift");
  }
  const repairedSiblingIds = new Set(expectedRepair ? [repairedSiblingId] : []);
  const plannedCount = expectedCount + repairedSiblingIds.size;
  if (expectedRepair) {
    const repairedAudit = nativeRouteAudits.bySetting.get(repairedSiblingId);
    const decision = repairedAudit?.decision;
    if (repairedAudit?.classification !== "source_evidence_blocked"
      || decision?.source_work_id !== expectedRepair.source_work_id
      || decision?.source_clause_text !== "16"
      || !Array.isArray(decision?.source_locators)
      || !decision.source_locators.includes(expectedRepair.source_locator)
      || JSON.parse(canonicalJson(decision.method_value_json, repairedSiblingId)) !== "16") {
      throw new Error(`${repairedSiblingId}: T27 source-repaired audit lineage drift`);
    }
    expectedIds.add(repairedSiblingId);
  }
  if (validation.schema_version !== "chronicle-new-operator-tranche-validation/v1"
    || validation.validation_status !== "PASS"
    || validation.audit_input_count !== expectedCount
    || validation.audit_input_unique_count !== expectedCount
    || validation.source_repaired_sibling_count !== repairedSiblingIds.size
    || validation.planning_input_count !== plannedCount
    || validation.planning_input_unique_count !== plannedCount
    || validation.manifest_flattened_count !== plannedCount
    || validation.manifest_flattened_unique_count !== plannedCount
    || validation.tranche_count !== tranches.length
    || validation.recommended_first_count !== 1
    || !Array.isArray(validation.missing_method_setting_ids) || validation.missing_method_setting_ids.length
    || !Array.isArray(validation.unexpected_method_setting_ids) || validation.unexpected_method_setting_ids.length
    || !Array.isArray(validation.duplicate_method_setting_ids) || validation.duplicate_method_setting_ids.length
    || validation.all_manifest_lines_valid_json !== true
    || validation.all_rows_have_source_semantics !== true
    || validation.all_rows_have_contract_backend_gui_receipt_fixture_paths !== true
    || validation.all_planned_support_fail_closed !== true
    || validation.repo_source_files_modified_by_this_task !== false) {
    throw new Error(`corrected new-operator validation record is not an exact passing ${plannedCount}-row result`);
  }

  const flattenedIds = [];
  const bySetting = new Map();
  const recommended = [];
  for (const tranche of tranches) {
    const trancheId = requireString(tranche.tranche_id, "tranche_id", "corrected new-operator partition");
    if (tranche.schema_version !== "chronicle-new-operator-tranche/v1"
      || !Number.isInteger(tranche.dependency_order) || tranche.dependency_order < 0
      || !correctedNewOperatorRouteCategories.has(tranche.corrected_route)
      || !correctedNewOperatorPublicRoutes.has(tranche.corrected_route)
      || typeof tranche.implementation_status !== "string" || !tranche.implementation_status
      || tranche.support_claimed !== false
      || !Array.isArray(tranche.method_setting_ids) || !tranche.method_setting_ids.length
      || new Set(tranche.method_setting_ids).size !== tranche.method_setting_ids.length
      || !Array.isArray(tranche.source_semantics) || !tranche.source_semantics.length
      || typeof tranche.rationale !== "string" || !tranche.rationale
      || !tranche.paths || ["contract", "backend", "gui", "receipt", "fixture"].some((key) =>
        !Array.isArray(tranche.paths[key]) || tranche.paths[key].some((value) => typeof value !== "string"))) {
      throw new Error(`${trancheId}: malformed or support-claiming corrected new-operator tranche`);
    }
    if (tranche.recommended_first === true) recommended.push(trancheId);
    const semanticMembership = new Map();
    for (const semantic of tranche.source_semantics) {
      requireString(semantic.source_work_id, "source_semantics.source_work_id", trancheId);
      requireString(semantic.source_value, "source_semantics.source_value", trancheId);
      if (!semantic.atomic_values || typeof semantic.atomic_values !== "object" || Array.isArray(semantic.atomic_values)) {
        throw new Error(`${trancheId}: source semantics must provide atomic_values`);
      }
      for (const [id, atomicValue] of Object.entries(semantic.atomic_values)) {
        if (!tranche.method_setting_ids.includes(id)) throw new Error(`${trancheId}: source semantics names out-of-tranche setting ${id}`);
        if (semanticMembership.has(id)) throw new Error(`${trancheId}: duplicate source semantics for ${id}`);
        if (atomicValue === null || atomicValue === undefined || (typeof atomicValue === "string" && !atomicValue)) {
          throw new Error(`${trancheId}: empty source value lineage for ${id}`);
        }
        semanticMembership.set(id, { semantic, atomicValue });
      }
    }
    for (const id of tranche.method_setting_ids) {
      flattenedIds.push(id);
      if (bySetting.has(id)) throw new Error(`${id}: duplicate corrected new-operator tranche membership`);
      const audit = nativeRouteAudits.bySetting.get(id);
      if (!audit || (audit.classification !== "new_operator_required"
        && !(repairedSiblingIds.has(id) && audit.classification === "source_evidence_blocked"))) {
        throw new Error(`${id}: corrected partition includes a setting outside the exact audited and T27-repaired identity set`);
      }
      const lineage = semanticMembership.get(id);
      if (!lineage) throw new Error(`${id}: corrected partition has no per-setting source value lineage`);
      const decision = audit.decision;
      if (lineage.semantic.source_work_id !== decision.source_work_id) {
        throw new Error(`${id}: corrected partition source-work lineage drift`);
      }
      if (repairedSiblingIds.has(id)
        && (lineage.semantic.source_work_id !== expectedRepair.source_work_id
          || lineage.atomicValue !== expectedRepair.added_atomic_value)) {
        throw new Error(`${id}: corrected partition T27 repaired source-value lineage drift`);
      }
      const methodValueJson = decision.method_value_json ?? decision.source_semantics?.method_value_json;
      const methodValue = JSON.parse(canonicalJson(methodValueJson, id));
      const lineageTokens = new Set(semanticTokens([lineage.atomicValue, lineage.semantic.source_value]));
      const missingValueTokens = semanticTokens(methodValue).filter((token) => !lineageTokens.has(token));
      if (missingValueTokens.length) {
        throw new Error(`${id}: corrected partition source-value lineage drift (${missingValueTokens.join(",")})`);
      }
      bySetting.set(id, { tranche, semantic: lineage.semantic, atomicValue: lineage.atomicValue });
    }
  }

  if (flattenedIds.length !== plannedCount
    || new Set(flattenedIds).size !== plannedCount
    || flattenedIds.some((id) => !expectedIds.has(id))
    || [...expectedIds].some((id) => !bySetting.has(id))
    || recommended.length !== 1
    || recommended[0] !== validation.recommended_first_tranche) {
    throw new Error("corrected new-operator manifest identity set or recommended-first selection drift");
  }
  const categoryCounts = correctedNewOperatorCategoryCounts(tranches);
  const reportedCategoryCounts = validation.corrected_route_counts;
  if (!reportedCategoryCounts || typeof reportedCategoryCounts !== "object"
    || Object.keys(categoryCounts).length !== Object.keys(reportedCategoryCounts).length
    || Object.entries(categoryCounts).some(([category, count]) => reportedCategoryCounts[category] !== count)
    || Object.values(categoryCounts).reduce((sum, count) => sum + count, 0) !== plannedCount
    || validation.input_complete_new_native_operator_family_count
      !== tranches.filter((tranche) => tranche.corrected_route === "new_native_operator").length) {
    throw new Error("corrected new-operator route summary drift");
  }
  return {
    bySetting,
    summary: {
      corrected_settings: plannedCount,
      tranches: tranches.length,
      corrected_route_counts: categoryCounts,
      input_complete_new_native_operator_families: validation.input_complete_new_native_operator_family_count,
      recommended_first_tranche: recommended[0],
      exact_identity_coverage: true,
      source_work_value_lineage: true,
      all_non_executable: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadCorrectedNewOperatorPartition(nativeRouteAudits) {
  requirePrivate(correctedNewOperatorDirectory, 0o700);
  requirePrivate(correctedNewOperatorManifestPath, 0o600);
  requirePrivate(correctedNewOperatorValidationPath, 0o600);
  const tranches = jsonl(correctedNewOperatorManifestPath);
  const validation = JSON.parse(readFileSync(correctedNewOperatorValidationPath, "utf8"));
  return validateCorrectedNewOperatorPartition(tranches, validation, nativeRouteAudits);
}

function loadNativeConformance(nativeRouteAudits) {
  requirePrivate(nativeConformanceDirectory, 0o700);
  requirePrivate(nativeConformanceMappingPath, 0o600);
  requirePrivate(nativeConformanceValidationPath, 0o600);
  const validation = JSON.parse(readFileSync(nativeConformanceValidationPath, "utf8"));
  const rows = jsonl(nativeConformanceMappingPath);
  runRuntimeConformance(["test", "--locked", "--test", "literature_native_conformance"], "native literature");
  const expectedIds = new Set([...nativeRouteAudits.bySetting]
    .filter(([, audit]) => audit.classification === "exact_existing_binding")
    .map(([id]) => id));
  if (validation.validation_passed !== true
    || validation.all_fixture_digests_are_from_executed_passing_results !== true
    || validation.proven_setting_count !== expectedIds.size
    || validation.unproven_setting_count !== 0
    || validation.mapping_sha256 !== sha256(nativeConformanceMappingPath)) {
    throw new Error("native conformance validation or mapping content hash failed");
  }
  if (new Set(rows.map((row) => row.method_setting_id)).size !== rows.length
    || rows.length !== expectedIds.size
    || rows.some((row) => !expectedIds.has(row.method_setting_id))) {
    throw new Error("native conformance identity set does not exactly match audited exact bindings");
  }

  const fixtureManifestRaw = readFileSync(nativeConformanceFixturePath, "utf8");
  const fixtureManifest = JSON.parse(fixtureManifestRaw);
  if (fixtureManifest.schema_version !== "chronicle-literature-native-conformance/v1"
    || !Array.isArray(fixtureManifest.fixtures)) {
    throw new Error("native conformance fixture manifest schema failed");
  }
  const referencedFixtureIds = new Set(rows.map((row) => row.fixture_id));
  if (referencedFixtureIds.size !== validation.executed_fixture_count) {
    throw new Error("native conformance referenced fixture count drift");
  }
  const currentManifestHash = sha256Bytes(fixtureManifestRaw);
  const fullManifestHashMatch = currentManifestHash === validation.source_manifest_sha256;
  const projection = fullManifestHashMatch
    ? { projected: fixtureManifestRaw, removed: [], removedSettingIds: [] }
    : projectNativeConformanceManifest(fixtureManifestRaw, referencedFixtureIds, expectedIds);
  if (sha256Bytes(projection.projected) !== validation.source_manifest_sha256) {
    throw new Error("native conformance referenced fixture subset differs from the executed manifest");
  }

  const fixtureIds = fixtureManifest.fixtures.map((fixture) => fixture.fixture_id);
  if (new Set(fixtureIds).size !== fixtureIds.length) {
    throw new Error("native conformance fixture manifest has duplicate fixture IDs");
  }
  const fixturesById = new Map();
  for (const fixture of fixtureManifest.fixtures) {
    if (typeof fixture.fixture_id !== "string" || !fixture.fixture_id
      || !Array.isArray(fixture.method_setting_ids)
      || new Set(fixture.method_setting_ids).size !== fixture.method_setting_ids.length
      || fixture.method_setting_ids.some((id) => typeof id !== "string" || !id)
      || typeof fixture.result_digest !== "string"
      || !/^sha256:[0-9a-f]{64}$/.test(fixture.result_digest)
      || !fixture.browser_contract_bindings
      || typeof fixture.browser_contract_bindings !== "object"
      || Array.isArray(fixture.browser_contract_bindings)) {
      throw new Error(`${fixture.fixture_id ?? "unknown fixture"}: malformed native conformance fixture`);
    }
    fixturesById.set(fixture.fixture_id, fixture);
  }
  for (const fixture of projection.removed) {
    if (fixture.method_setting_ids.some((id) => expectedIds.has(id))) {
      throw new Error(`${fixture.fixture_id}: additive fixture overlaps the validated exact-binding identity set`);
    }
  }
  for (const fixtureId of referencedFixtureIds) {
    const fixture = fixturesById.get(fixtureId);
    if (!fixture) throw new Error(`${fixtureId}: referenced native conformance fixture is absent`);
    const fixtureRows = rows.filter((row) => row.fixture_id === fixtureId);
    const mappedIds = fixtureRows.map((row) => row.method_setting_id).sort();
    const fixtureSettingIds = fixture.method_setting_ids.filter((id) => expectedIds.has(id)).sort();
    if (JSON.stringify(mappedIds) !== JSON.stringify(fixtureSettingIds)) {
      throw new Error(`${fixtureId}: fixture setting membership differs from the executed mapping`);
    }
    const resultDigests = new Set(fixtureRows.map((row) => row.conformance_result_digest));
    if (resultDigests.size !== 1 || !resultDigests.has(fixture.result_digest)) {
      throw new Error(`${fixtureId}: fixture result digest differs from the executed mapping`);
    }
    const bindingVariants = new Set(fixtureRows.map((row) => JSON.stringify(row.contract_bindings)));
    if (bindingVariants.size !== 1) {
      throw new Error(`${fixtureId}: grouped fixture rows do not have identical contract bindings`);
    }
    const bindings = fixtureRows[0].contract_bindings;
    if (!Array.isArray(bindings)
      || new Set(bindings.map((binding) => binding.contract_slot)).size !== bindings.length) {
      throw new Error(`${fixtureId}: malformed or duplicate mapped contract bindings`);
    }
    const fixtureBindingSlots = Object.keys(fixture.browser_contract_bindings).sort();
    const mappedBindingSlots = bindings.map((binding) => binding.contract_slot).sort();
    if (JSON.stringify(fixtureBindingSlots) !== JSON.stringify(mappedBindingSlots)) {
      throw new Error(`${fixtureId}: fixture binding slots differ from the executed mapping`);
    }
    for (const binding of bindings) {
      let expectedValue;
      try {
        expectedValue = JSON.parse(binding.contract_value_json);
      } catch (error) {
        throw new Error(`${fixtureId}: invalid mapped contract value JSON`, { cause: error });
      }
      if (JSON.stringify(fixture.browser_contract_bindings[binding.contract_slot]) !== JSON.stringify(expectedValue)) {
        throw new Error(`${fixtureId}: fixture binding value differs for ${binding.contract_slot}`);
      }
    }
  }

  const bySetting = new Map();
  for (const row of rows) {
    const id = row.method_setting_id;
    const audit = nativeRouteAudits.bySetting.get(id);
    if (row.proof_status !== "executed_and_passed"
      || typeof row.fixture_id !== "string" || !row.fixture_id
      || typeof row.conformance_result_digest !== "string"
      || !/^sha256:[0-9a-f]{64}$/.test(row.conformance_result_digest)
      || JSON.stringify(row.contract_bindings) !== JSON.stringify(audit.bindings)) {
      throw new Error(`${id}: conformance proof does not exactly match the audited binding`);
    }
    bySetting.set(id, row);
  }
  return {
    bySetting,
    summary: {
      proven_settings: rows.length,
      unproven_settings: 0,
      executed_fixtures: validation.executed_fixture_count,
      validation_passed: true,
      content_hashes_match: fullManifestHashMatch,
      full_manifest_hash_match: fullManifestHashMatch,
      validated_fixture_subset_match: true,
      referenced_fixture_count: referencedFixtureIds.size,
      additive_fixture_count: projection.removed.length,
      additive_fixture_setting_count: projection.removedSettingIds.length,
      recorded_source_manifest_sha256: validation.source_manifest_sha256,
      current_source_manifest_sha256: currentManifestHash,
      current_manifest_runtime_test_passed: true,
    },
  };
}

function loadStrictGapExtension(nativeRouteAudits, contractSlots) {
  requirePrivate(strictGapExtensionDirectory, 0o700);
  for (const path of [strictGapExtensionMappingPath, strictGapExtensionValidationPath, strictGapExtensionManifestPath]) {
    requirePrivate(path, 0o600);
  }
  const rows = jsonl(strictGapExtensionMappingPath);
  const validation = JSON.parse(readFileSync(strictGapExtensionValidationPath, "utf8"));
  const manifest = JSON.parse(readFileSync(strictGapExtensionManifestPath, "utf8"));
  const expectedId = "method-setting-21088bd2743bd3054e5fbb5b";
  const row = rows[0];
  const audit = nativeRouteAudits.bySetting.get(expectedId);
  if (rows.length !== 1
    || validation.schema_version !== "chronicle-literature-small-extension-implementation-validation/v1"
    || validation.passed !== true
    || validation.input_setting_count !== 1
    || validation.output_mapping_count !== 1
    || validation.method_setting_identity_exact !== true
    || Object.values(validation.checks ?? {}).some((passed) => passed !== true)
    || validation.hashes?.mapping_sha256 !== sha256(strictGapExtensionMappingPath)
    || validation.hashes?.implementation_manifest_sha256 !== sha256(strictGapExtensionManifestPath)
    || manifest.schema_version !== "chronicle-literature-small-extension-implementation/v1"
    || manifest.tranche_id !== validation.tranche_id
    || JSON.stringify(manifest.method_setting_ids) !== JSON.stringify([expectedId])
    || row?.schema_version !== "chronicle-literature-small-extension-conformance-mapping/v1"
    || row.method_setting_id !== expectedId
    || row.implementation_tranche_id !== manifest.tranche_id
    || row.source_extraction_id !== manifest.source_extraction_id
    || row.source_work_id !== manifest.source_work_id
    || row.proof_status !== "executed_and_passed"
    || row.method_implementation_status !== "native"
    || row.method_execution_route !== "native_option_binding"
    || row.method_execution_blocker_code !== null
    || row.conformance_result_digest !== validation.conformance_result_digest
    || row.fixture_id !== manifest.conformance?.fixture_id
    || row.conformance_result_digest !== manifest.conformance?.result_digest
    || audit?.classification !== "small_existing_operator_extension"
    || audit.decision.source_extraction_id !== row.source_extraction_id
    || audit.decision.source_work_id !== row.source_work_id
    || row.source_clause_text !== audit.decision.source_semantics.source_clause_text
    || row.source_value_sha256 !== sha256Bytes(JSON.parse(audit.decision.source_semantics.source_value_json)).slice(7)
    || !audit.decision.source_semantics.source_locators.includes(row.source_execution_witness?.locator)
    || !isDeepStrictEqual(manifest.source_semantics, {
      gap_basis: "previous episode stop to next episode start",
      threshold_seconds: 5,
      join_comparator: "less_than",
      equality_disposition: "split",
    })
    || !isDeepStrictEqual(row.source_execution_witness, {
      comparator: "less_than",
      locator: manifest.source_locator,
      operator_text: "if(diff.to.previous < 5)",
      unit: "seconds",
    })
    || !isDeepStrictEqual(manifest.conformance?.boundary_probes, [
      { gap_seconds: "4.999999999", expected_session_relation: "join" },
      { gap_seconds: "5.000000000", expected_session_relation: "split" },
    ])
    || !isDeepStrictEqual(manifest.conformance?.expected_usage_session_ids, [0, 0, 1])) {
    throw new Error("strict-gap extension validation, identity, or executed proof failed");
  }
  if (!Array.isArray(row.contract_bindings) || row.contract_bindings.length !== 3
    || new Set(row.contract_bindings.map((binding) => binding.contract_slot)).size !== row.contract_bindings.length
    || row.contract_bindings.some((binding) => !contractSlots.has(binding.contract_slot)
      || canonicalJson(binding.contract_value_json, expectedId) !== binding.contract_value_json)) {
    throw new Error(`${expectedId}: strict-gap extension has invalid public bindings`);
  }
  const publicBinding = row.contract_bindings.find((binding) => binding.contract_slot === manifest.public_binding.wire_slot);
  if (!publicBinding
    || publicBinding.contract_value_json !== JSON.stringify(manifest.public_binding.value)
    || row.public_contract_binding?.wire_slot !== manifest.public_binding.wire_slot
    || row.public_contract_binding?.browser_slot !== manifest.public_binding.browser_slot
    || row.public_contract_binding?.contract_value_json !== JSON.stringify(manifest.public_binding.value)) {
    throw new Error(`${expectedId}: strict-gap public binding differs across proof artifacts`);
  }
  if (!isDeepStrictEqual(manifest.native_operator, {
    enum: "SessionGroupingPolicy::SmartphoneWellbeingStrictLtFiveSeconds",
    threshold_ns: 5_000_000_000,
    boundary_gap_starts_new_session: true,
    package_change_ends_session: false,
    assignment_function: "assign_usage_session_ids",
  })
    || !isDeepStrictEqual(manifest.gui, {
      component: "web/src/components/SessionDetectionCard.tsx",
      control_test_id: "session-grouping-policy-select",
      label: "Smartphone Wellbeing < 5 s",
    })
    || !isDeepStrictEqual(manifest.conformance?.receipt_retains, [
      "method_setting_id", "contract_binding", "fixture_id", "result_digest",
    ])) {
    throw new Error(`${expectedId}: strict-gap operator, GUI, or receipt manifest drift`);
  }
  requireExactManifestFiles(manifest, [
    "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs",
    "rust/chronicle_chrono_kernel_wasm/src/pipeline/options.rs",
    "rust/chronicle_preprocessing_runtime_wasm/tests/fixtures/literature_native_conformance.json",
    "rust/chronicle_preprocessing_runtime_wasm/tests/literature_native_conformance.rs",
    "web/schema/chronicle-research-ontology.linkml.yaml",
    "web/schema/chronicle-local-contract.linkml.yaml",
    "web/src/components/SessionDetectionCard.tsx",
    "web/src/testSupport/configurationEquivalenceClasses.ts",
    "web/src/lib/sessionGroupingStrictLt5Contract.test.ts",
  ], extensionGeneratedFiles, validation.hashes?.declared_file_sha256, expectedId);
  const sourceFile = manifest.source_locator.replace(/:\d.*$/, "");
  if (validation.hashes?.source_file_sha256 !== sha256(sourceFile)) {
    throw new Error(`${expectedId}: strict-gap deposited source file hash drift`);
  }
  for (const [hashKey, file] of [
    ["fixture_manifest_sha256", nativeConformanceFixturePath],
    ["kernel_sha256", resolve(repo, "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs")],
    ["research_ontology_sha256", resolve(repo, "web/schema/chronicle-research-ontology.linkml.yaml")],
    ["public_contract_sha256", resolve(repo, "web/schema/chronicle-local-contract.linkml.yaml")],
  ]) {
    if (validation.hashes?.[hashKey] !== sha256(file)) {
      throw new Error(`${expectedId}: strict-gap validated implementation hash drift at ${hashKey}`);
    }
  }
  const fixtures = JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures ?? [];
  const fixture = fixtures.find((candidate) => candidate.fixture_id === row.fixture_id);
  const mappedBindings = Object.fromEntries(row.contract_bindings.map((binding) => [
    binding.contract_slot, JSON.parse(binding.contract_value_json),
  ]));
  if (!fixture
    || JSON.stringify(fixture.method_setting_ids) !== JSON.stringify([expectedId])
    || fixture.result_digest !== row.conformance_result_digest
    || JSON.stringify(fixture.browser_contract_bindings) !== JSON.stringify(mappedBindings)) {
    throw new Error(`${expectedId}: strict-gap source fixture differs from its executed promotion mapping`);
  }
  return {
    bySetting: new Map([[expectedId, row]]),
    summary: {
      promoted_settings: 1,
      tranche_id: manifest.tranche_id,
      fixture_id: row.fixture_id,
      conformance_result_digest: row.conformance_result_digest,
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadStrictScreenGateExtension(nativeRouteAudits, contractSlots) {
  requirePrivate(strictScreenGateExtensionDirectory, 0o700);
  for (const path of [
    strictScreenGateExtensionMappingPath,
    strictScreenGateExtensionValidationPath,
    strictScreenGateExtensionManifestPath,
  ]) requirePrivate(path, 0o600);
  const rows = jsonl(strictScreenGateExtensionMappingPath);
  const validation = JSON.parse(readFileSync(strictScreenGateExtensionValidationPath, "utf8"));
  const manifest = JSON.parse(readFileSync(strictScreenGateExtensionManifestPath, "utf8"));
  const expectedIds = [
    "method-setting-20c6291c40273f06e2bc5c67",
    "method-setting-atomic-71ae27a346e4251d6303",
    "method-setting-d495a09693a4d1de867e6e64",
  ];
  const expectedBindings = [
    { contract_slot: "enable_screen_gated_crediting", contract_value_json: "true" },
    { contract_slot: "screen_gating_rule", contract_value_json: '"strict_visual_only"' },
    { contract_slot: "auto_lock_bridge_seconds", contract_value_json: "0" },
  ];
  const fixture = (JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures ?? [])
    .find((candidate) => candidate.fixture_id === manifest.conformance?.fixture_id);
  const witnesses = new Map((manifest.source_witnesses ?? []).map((row) => [row.method_setting_id, row]));
  if (rows.length !== expectedIds.length
    || JSON.stringify(rows.map((row) => row.method_setting_id)) !== JSON.stringify(expectedIds)
    || validation.schema_version !== "chronicle-literature-small-extension-implementation-validation/v1"
    || validation.passed !== true
    || validation.input_setting_count !== expectedIds.length
    || validation.output_mapping_count !== expectedIds.length
    || validation.method_setting_identity_exact !== true
    || Object.values(validation.checks ?? {}).some((passed) => passed !== true)
    || validation.hashes?.mapping_sha256 !== sha256(strictScreenGateExtensionMappingPath)
    || validation.hashes?.implementation_manifest_sha256 !== sha256(strictScreenGateExtensionManifestPath)
    || validation.hashes?.fixture_manifest_sha256 !== sha256(nativeConformanceFixturePath)
    || manifest.schema_version !== "chronicle-literature-small-extension-implementation/v1"
    || manifest.tranche_id !== "small-ext-06-strict-screen-credit-gate"
    || JSON.stringify(manifest.method_setting_ids) !== JSON.stringify(expectedIds)
    || !isDeepStrictEqual(manifest.source_semantics, {
      screen_witness_required: true,
      screen_off_disposition: "exclude",
      no_witness_disposition: "exclude",
      auto_lock_bridge_seconds: 0,
    })
    || !fixture
    || JSON.stringify(fixture.method_setting_ids) !== JSON.stringify(expectedIds)
    || JSON.stringify(fixture.browser_contract_bindings) !== JSON.stringify({
      enable_screen_gated_crediting: true,
      screen_gating_rule: "strict_visual_only",
      auto_lock_bridge_seconds: 0,
    })
    || fixture.result_digest !== manifest.conformance.result_digest) {
    throw new Error("strict-screen-gate extension validation, identity, or executed proof failed");
  }
  for (const row of rows) {
    const audit = nativeRouteAudits.bySetting.get(row.method_setting_id);
    const witness = witnesses.get(row.method_setting_id);
    if (row.schema_version !== "chronicle-literature-small-extension-conformance-mapping/v1"
      || row.implementation_tranche_id !== manifest.tranche_id
      || row.audit_classification !== "small_existing_operator_extension"
      || row.method_implementation_status !== "native"
      || row.method_execution_route !== "native_option_binding"
      || row.method_execution_blocker_code !== null
      || row.proof_status !== "executed_and_passed"
      || row.fixture_id !== fixture.fixture_id
      || row.conformance_result_digest !== fixture.result_digest
      || JSON.stringify(row.contract_bindings) !== JSON.stringify(expectedBindings)
      || row.contract_bindings.some((binding) => !contractSlots.has(binding.contract_slot)
        || canonicalJson(binding.contract_value_json, row.method_setting_id) !== binding.contract_value_json)
      || audit?.classification !== "small_existing_operator_extension"
      || audit.decision.source_extraction_id !== row.source_extraction_id
      || audit.decision.source_work_id !== row.source_work_id
      || sha256Bytes(JSON.parse(audit.decision.source_semantics.source_value_json)).slice(7) !== row.source_value_sha256
      || !audit.decision.source_semantics.source_locators.some((locator) => row.source_locator.endsWith(locator))
      || witness?.source_extraction_id !== row.source_extraction_id
      || witness.source_work_id !== row.source_work_id
      || witness.source_value_sha256 !== row.source_value_sha256) {
      throw new Error(`${row.method_setting_id}: strict-screen-gate source or binding proof drift`);
    }
    if (!witness.source_locator.startsWith("http")) {
      const sourceFile = witness.source_locator.replace(/:\d.*$/, "");
      if (witness.source_file_sha256 !== sha256(sourceFile)) {
        throw new Error(`${row.method_setting_id}: strict-screen-gate source witness hash drift`);
      }
    }
  }
  return {
    bySetting: new Map(rows.map((row) => [row.method_setting_id, row])),
    summary: {
      promoted_settings: rows.length,
      implementation_tranche_id: manifest.tranche_id,
      fixture_id: fixture.fixture_id,
      conformance_result_digest: fixture.result_digest,
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadDirectUnlockExtension(nativeRouteAudits, contractSlots) {
  requirePrivate(directUnlockExtensionDirectory, 0o700);
  for (const path of [
    directUnlockExtensionMappingPath,
    directUnlockExtensionValidationPath,
    directUnlockExtensionManifestPath,
  ]) requirePrivate(path, 0o600);
  const rows = jsonl(directUnlockExtensionMappingPath);
  const validation = JSON.parse(readFileSync(directUnlockExtensionValidationPath, "utf8"));
  const manifest = JSON.parse(readFileSync(directUnlockExtensionManifestPath, "utf8"));
  const fixtureById = new Map(
    (JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures ?? [])
      .map((fixture) => [fixture.fixture_id, fixture]),
  );
  const expectedIds = [
    "atomic-8710eccc4e07fdf1386e9324",
    "atomic-db0681e06cde303f9c4c9e5b",
    "method-setting-0768c878b31dc2690db34a59",
    "method-setting-2f457f8218476da4aa9027ec",
    "method-setting-745bfd1fc5633f1590def35e",
    "method-setting-c99b21724499990e7caba683",
    "atomic-174054a7d269c1868178e6fe",
    "atomic-4ad0b4b71c91b8049ddc3eb7",
    "atomic-5f6458eb3a4bb03c200ccf7c",
    "atomic-7234b32e1edf5a820d71acdf",
    "atomic-a396832ff2b10659ba2d3fb3",
    "atomic-faba94ec219a5a7bfe5ddead",
  ];
  const witnesses = new Map((manifest.source_witnesses ?? []).map((row) => [row.method_setting_id, row]));
  if (rows.length !== expectedIds.length
    || JSON.stringify(rows.map((row) => row.method_setting_id)) !== JSON.stringify(expectedIds)
    || validation.schema_version !== "chronicle-literature-small-extension-implementation-validation/v1"
    || validation.passed !== true
    || validation.input_setting_count !== expectedIds.length
    || validation.output_mapping_count !== expectedIds.length
    || validation.method_setting_identity_exact !== true
    || Object.values(validation.checks ?? {}).some((passed) => passed !== true)
    || validation.hashes?.mapping_sha256 !== sha256(directUnlockExtensionMappingPath)
    || validation.hashes?.implementation_manifest_sha256 !== sha256(directUnlockExtensionManifestPath)
    || validation.hashes?.fixture_manifest_sha256 !== sha256(nativeConformanceFixturePath)
    || manifest.schema_version !== "chronicle-literature-small-extension-implementation/v1"
    || manifest.tranche_id !== "small-ext-03a-direct-unlock-strategies"
    || JSON.stringify(manifest.method_setting_ids) !== JSON.stringify(expectedIds)
    || !isDeepStrictEqual(manifest.source_semantics, {
      opener_event: "keyguard_hidden",
      unlock_to_lock_closer: "keyguard_shown",
      unlock_to_off_or_lock_closer: "first_of_screen_non_interactive_or_keyguard_shown",
      preceding_screen_interactive_time_included: false,
    })
    || manifest.deliberately_blocked_settings?.count !== 4) {
    throw new Error("direct-unlock extension validation, identity, or executed proof failed");
  }
  for (const proof of manifest.conformance) {
    const fixture = fixtureById.get(proof.fixture_id);
    if (!fixture
      || JSON.stringify(fixture.method_setting_ids) !== JSON.stringify(proof.method_setting_ids)
      || fixture.result_digest !== proof.result_digest
      || validation.conformance_result_digests?.[proof.fixture_id] !== proof.result_digest) {
      throw new Error(`${proof.fixture_id}: direct-unlock executed fixture proof drift`);
    }
  }
  for (const row of rows) {
    const audit = nativeRouteAudits.bySetting.get(row.method_setting_id);
    const witness = witnesses.get(row.method_setting_id);
    const expectedBindings = [
      { contract_slot: "process_screen_usage", contract_value_json: "true" },
      { contract_slot: "screen_session_construction_strategy", contract_value_json: JSON.stringify(row.operator_id) },
    ];
    const fixture = fixtureById.get(row.fixture_id);
    if (row.schema_version !== "chronicle-literature-small-extension-conformance-mapping/v1"
      || row.implementation_tranche_id !== manifest.tranche_id
      || row.audit_classification !== "small_existing_operator_extension"
      || row.method_implementation_status !== "native"
      || row.method_execution_route !== "native_option_binding"
      || row.method_execution_blocker_code !== null
      || row.proof_status !== "executed_and_passed"
      || !fixture
      || !fixture.method_setting_ids.includes(row.method_setting_id)
      || row.conformance_result_digest !== fixture.result_digest
      || JSON.stringify(row.contract_bindings) !== JSON.stringify(expectedBindings)
      || row.contract_bindings.some((binding) => !contractSlots.has(binding.contract_slot)
        || canonicalJson(binding.contract_value_json, row.method_setting_id) !== binding.contract_value_json)
      || audit?.classification !== "small_existing_operator_extension"
      || audit.decision.source_extraction_id !== row.source_extraction_id
      || audit.decision.source_work_id !== row.source_work_id
      || sha256Bytes(JSON.parse(audit.decision.source_semantics.source_value_json)).slice(7) !== row.source_value_sha256
      || !audit.decision.source_semantics.source_locators.some((locator) => row.source_locator.endsWith(locator))
      || witness?.source_extraction_id !== row.source_extraction_id
      || witness.source_work_id !== row.source_work_id
      || witness.source_value_sha256 !== row.source_value_sha256) {
      throw new Error(`${row.method_setting_id}: direct-unlock source or binding proof drift`);
    }
    if (!witness.source_locator.startsWith("http")) {
      const sourceFile = witness.source_locator.split("#")[0].replace(/:\d.*$/, "");
      if (witness.source_file_sha256 !== sha256(sourceFile)) {
        throw new Error(`${row.method_setting_id}: direct-unlock source witness hash drift`);
      }
    }
  }
  return {
    bySetting: new Map(rows.map((row) => [row.method_setting_id, row])),
    summary: {
      promoted_settings: rows.length,
      implementation_tranche_id: manifest.tranche_id,
      fixture_ids: manifest.conformance.map((proof) => proof.fixture_id),
      conformance_result_digests: validation.conformance_result_digests,
      deliberately_blocked_settings: manifest.deliberately_blocked_settings.count,
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadSourceOrderExtension(nativeRouteAudits, contractSlots) {
  requirePrivate(sourceOrderExtensionDirectory, 0o700);
  for (const path of [sourceOrderExtensionMappingPath, sourceOrderExtensionValidationPath, sourceOrderExtensionManifestPath]) {
    requirePrivate(path, 0o600);
  }
  const rows = jsonl(sourceOrderExtensionMappingPath);
  const validation = JSON.parse(readFileSync(sourceOrderExtensionValidationPath, "utf8"));
  const manifest = JSON.parse(readFileSync(sourceOrderExtensionManifestPath, "utf8"));
  const expectedId = "method-setting-6022389c76d7682397a38dd7";
  const row = rows[0];
  const audit = nativeRouteAudits.bySetting.get(expectedId);
  const fixture = (JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures ?? [])
    .find((candidate) => candidate.fixture_id === row?.fixture_id);
  const expectedBindings = [
    { contract_slot: "drop_out_of_source_order_events", contract_value_json: "true" },
  ];
  if (rows.length !== 1
    || validation.schema_version !== "chronicle-literature-small-extension-implementation-validation/v1"
    || validation.passed !== true
    || Object.values(validation.checks ?? {}).some((passed) => passed !== true)
    || Object.values(validation.commands ?? {}).some((command) => command.passed !== true)
    || validation.hashes?.mapping_sha256 !== sha256(sourceOrderExtensionMappingPath)
    || validation.hashes?.implementation_manifest_sha256 !== sha256(sourceOrderExtensionManifestPath)
    || manifest.schema_version !== "chronicle-literature-small-extension-implementation/v1"
    || manifest.tranche_id !== "small-ext-07-drop-out-of-source-order-events"
    || !isDeepStrictEqual(manifest.method_setting_ids, [expectedId])
    || row?.method_setting_id !== expectedId
    || row.implementation_tranche_id !== manifest.tranche_id
    || row.source_extraction_id !== audit?.decision.source_extraction_id
    || row.source_work_id !== audit?.decision.source_work_id
    || row.source_clause_text !== audit?.decision.source_clause_text
    || row.source_value_sha256 !== sha256Bytes(JSON.parse(audit?.decision.source_value_json)).slice(7)
    || audit?.classification !== "small_existing_operator_extension"
    || !audit.decision.source_locators.some((locator) => row.source_locator.endsWith(locator))
    || !isDeepStrictEqual(row.contract_bindings, expectedBindings)
    || row.contract_bindings.some((binding) => !contractSlots.has(binding.contract_slot)
      || canonicalJson(binding.contract_value_json, expectedId) !== binding.contract_value_json)
    || row.method_implementation_status !== "native"
    || row.method_execution_route !== "native_option_binding"
    || row.method_execution_blocker_code !== null
    || row.proof_status !== "executed_and_passed"
    || !fixture
    || !isDeepStrictEqual(fixture.method_setting_ids, [expectedId])
    || !isDeepStrictEqual(fixture.browser_contract_bindings, { drop_out_of_source_order_events: true })
    || fixture.result_digest !== row.conformance_result_digest
    || manifest.conformance?.fixture_id !== row.fixture_id
    || manifest.conformance?.result_digest !== row.conformance_result_digest) {
    throw new Error("source-order cleanup extension validation, identity, or executed proof failed");
  }
  return {
    bySetting: new Map([[expectedId, row]]),
    summary: {
      promoted_settings: 1,
      implementation_tranche_id: manifest.tranche_id,
      fixture_id: row.fixture_id,
      conformance_result_digest: row.conformance_result_digest,
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadScreenPolicyExtension(nativeRouteAudits, contractSlots) {
  requirePrivate(screenPolicyExtensionDirectory, 0o700);
  for (const path of [screenPolicyExtensionMappingPath, screenPolicyExtensionValidationPath, screenPolicyExtensionManifestPath]) {
    requirePrivate(path, 0o600);
  }
  const rows = jsonl(screenPolicyExtensionMappingPath);
  const validation = JSON.parse(readFileSync(screenPolicyExtensionValidationPath, "utf8"));
  const manifest = JSON.parse(readFileSync(screenPolicyExtensionManifestPath, "utf8"));
  const expectedIds = [
    "method-setting-09a66035185861f4fb308bab",
    "method-setting-7780ec932ecfd0b5f8af2a95",
    "method-setting-7ce61f09839d039da32ba96a",
    "method-setting-b743a1b03254c30ec082fc96",
    "method-setting-d5341c56652a40d5b30af0e5",
    "method-setting-d9241c9a236a0303afeef109",
  ];
  const fixtures = JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures ?? [];
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.fixture_id, fixture]));
  const exactRows = rows.length === expectedIds.length && rows.every((row, index) => {
    const audit = nativeRouteAudits.bySetting.get(row.method_setting_id);
    const source = audit?.decision.source_semantics ?? audit?.decision;
    const fixture = fixtureById.get(row.fixture_id);
    const mappedBindings = Object.fromEntries(row.contract_bindings.map((binding) => [
      binding.contract_slot, JSON.parse(binding.contract_value_json),
    ]));
    return row.method_setting_id === expectedIds[index]
      && audit?.classification === "small_existing_operator_extension"
      && row.source_extraction_id === audit.decision.source_extraction_id
      && row.source_work_id === audit.decision.source_work_id
      && row.source_clause_text === source.source_clause_text
      && row.source_value_sha256 === sha256Bytes(JSON.parse(source.source_value_json)).slice(7)
      && source.source_locators.includes(row.source_locator)
      && row.contract_bindings.every((binding) => contractSlots.has(binding.contract_slot)
        && canonicalJson(binding.contract_value_json, row.method_setting_id) === binding.contract_value_json)
      && row.method_implementation_status === "native"
      && row.method_execution_route === "native_option_binding"
      && row.method_execution_blocker_code === null
      && row.proof_status === "executed_and_passed"
      && fixture?.method_setting_ids.includes(row.method_setting_id)
      && fixture.result_digest === row.conformance_result_digest
      && isDeepStrictEqual(fixture.browser_contract_bindings, mappedBindings);
  });
  const exactFixtures = manifest.conformance?.every((proof) => {
    const fixture = fixtureById.get(proof.fixture_id);
    const fixtureRows = rows.filter((row) => row.fixture_id === proof.fixture_id);
    return fixture
      && proof.result_digest === fixture.result_digest
      && isDeepStrictEqual(fixture.method_setting_ids, fixtureRows.map((row) => row.method_setting_id));
  });
  if (validation.schema_version !== "chronicle-literature-small-extension-implementation-validation/v1"
    || validation.passed !== true
    || validation.input_setting_count !== 6
    || validation.output_mapping_count !== 6
    || validation.method_setting_identity_exact !== true
    || Object.values(validation.checks ?? {}).some((passed) => passed !== true)
    || Object.values(validation.commands ?? {}).some((command) => command.passed !== true)
    || validation.hashes?.mapping_sha256 !== sha256(screenPolicyExtensionMappingPath)
    || validation.hashes?.implementation_manifest_sha256 !== sha256(screenPolicyExtensionManifestPath)
    || validation.hashes?.fixture_manifest_sha256 !== sha256(nativeConformanceFixturePath)
    || manifest.schema_version !== "chronicle-literature-small-extension-implementation/v1"
    || manifest.tranche_id !== "small-ext-05-screen-classification-cap-lock"
    || !isDeepStrictEqual(manifest.method_setting_ids, expectedIds)
    || !exactRows
    || !exactFixtures) {
    throw new Error("screen-policy extension validation, identity, or executed proof failed");
  }
  return {
    bySetting: new Map(rows.map((row) => [row.method_setting_id, row])),
    summary: {
      promoted_settings: rows.length,
      implementation_tranche_id: manifest.tranche_id,
      fixture_ids: manifest.conformance.map((proof) => proof.fixture_id),
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadBehappIntervalExtension(nativeRouteAudits, correctedNewOperatorPartition, contractSlots) {
  requirePrivate(behappIntervalExtensionDirectory, 0o700);
  for (const path of [behappIntervalExtensionMappingPath, behappIntervalExtensionValidationPath, behappIntervalExtensionManifestPath]) {
    requirePrivate(path, 0o600);
  }
  const rows = jsonl(behappIntervalExtensionMappingPath);
  const validation = JSON.parse(readFileSync(behappIntervalExtensionValidationPath, "utf8"));
  const manifest = JSON.parse(readFileSync(behappIntervalExtensionManifestPath, "utf8"));
  const expectedId = "method-setting-66b78a5d5b22a7c6e3d3668c";
  const row = rows[0];
  const audit = nativeRouteAudits.bySetting.get(expectedId);
  const partition = correctedNewOperatorPartition.bySetting.get(expectedId);
  if (rows.length !== 1
    || validation.schema_version !== "chronicle-literature-small-extension-implementation-validation/v1"
    || validation.passed !== true
    || validation.input_setting_count !== 1
    || validation.output_mapping_count !== 1
    || validation.method_setting_identity_exact !== true
    || validation.source_extraction_identity_exact !== true
    || Object.values(validation.checks ?? {}).some((passed) => passed !== true)
    || validation.hashes?.mapping_sha256 !== sha256(behappIntervalExtensionMappingPath)
    || validation.hashes?.implementation_manifest_sha256 !== sha256(behappIntervalExtensionManifestPath)
    || manifest.schema_version !== "chronicle-literature-small-extension-implementation/v1"
    || manifest.tranche_id !== validation.tranche_id
    || manifest.source_operator_tranche_id !== partition?.tranche.tranche_id
    || partition.tranche.corrected_route !== "existing_timeline_sampling_operator_extension"
    || JSON.stringify(manifest.method_setting_ids) !== JSON.stringify([expectedId])
    || row?.schema_version !== "chronicle-literature-small-extension-conformance-mapping/v1"
    || row.method_setting_id !== expectedId
    || row.implementation_tranche_id !== manifest.tranche_id
    || row.source_extraction_id !== manifest.source_extraction_id
    || row.source_work_id !== manifest.source_work_id
    || row.proof_status !== "executed_and_passed"
    || row.method_implementation_status !== "native"
    || row.method_execution_route !== "native_option_binding"
    || row.method_execution_blocker_code !== null
    || row.conformance_result_digest !== validation.conformance_result_digest
    || row.fixture_id !== manifest.conformance?.fixture_id
    || row.conformance_result_digest !== manifest.conformance?.result_digest
    || audit?.classification !== "new_operator_required"
    || audit.decision.source_extraction_id !== row.source_extraction_id
    || audit.decision.source_work_id !== row.source_work_id
    || row.source_clause_text !== audit.decision.source_semantics.source_clause_text
    || row.source_value_sha256 !== sha256Bytes(JSON.parse(audit.decision.source_semantics.source_value_json)).slice(7)
    || row.source_execution_witness?.locator !== manifest.source_locator
    || !audit.decision.source_semantics.source_locators.some((locator) => manifest.source_locator.startsWith(locator))
    || !isDeepStrictEqual(manifest.source_semantics, {
      timeline_anchor: "source interval start",
      duration_conversion: "truncate toward zero with int(duration)",
      cadence_seconds: 1,
      boundary: "half-open [start,end)",
      three_second_offsets: [0, 1, 2],
    })
    || !isDeepStrictEqual(row.source_execution_witness, {
      cadence_seconds: 1,
      duration_conversion: "int(duration)",
      end_expression: "start + int(duration) seconds",
      locator: manifest.source_locator,
      lower_boundary: "included",
      operator_text: "pd.date_range(start, end_time - 1 second, freq='s')",
      timeline_anchor: "source_interval_start",
      upper_boundary: "excluded",
    })
    || !isDeepStrictEqual(manifest.conformance?.boundary_probes, [
      { duration_seconds: "3.0", expected_offsets_seconds: [0, 1, 2] },
      { duration_seconds: "3.9", expected_offsets_seconds: [0, 1, 2] },
      { duration_seconds: "0.9", expected_offsets_seconds: [] },
    ])
    || manifest.conformance?.expected_expansion_row_count !== 6
    || manifest.conformance?.disabled_baseline !== "headline app CSV byte-identical and no interval-expansion artifact"
    || !isDeepStrictEqual(manifest.native_operator, {
      enum: "IntervalExpansionMethod::BehappStartAnchoredHalfOpen1sV1",
      function: "materialize_behapp_half_open_seconds",
      output_kind: "interval-expansion-csv",
      separate_from: "sample_polled_timeline",
      headline_output_changed: false,
    })
    || !isDeepStrictEqual(manifest.gui, {
      component: "web/src/components/AnalyzeSettingsCard.tsx",
      control_test_id: "interval-expansion-method-select",
      label: "Behapp — start-anchored half-open 1 s rows",
    })
    || !isDeepStrictEqual(manifest.conformance?.receipt_retains, [
      "method_setting_id", "contract_binding", "fixture_id", "result_digest",
    ])) {
    throw new Error("Behapp interval extension validation, identity, or executed proof failed");
  }
  requireExactManifestFiles(manifest, [
    "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs",
    "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs",
    "rust/chronicle_chrono_kernel_wasm/src/pipeline/options.rs",
    "rust/chronicle_chrono_kernel_wasm/src/pipeline/stages/polled.rs",
    "rust/chronicle_chrono_kernel_wasm/src/pipeline/payload.rs",
    "rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs",
    "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs",
    "rust/chronicle_preprocessing_runtime_wasm/tests/fixtures/literature_native_conformance.json",
    "rust/chronicle_preprocessing_runtime_wasm/tests/literature_native_conformance.rs",
    "rust/chronicle_preprocessing_runtime_wasm/tests/pipeline_v2_options_exactness.rs",
    "web/schema/chronicle-research-ontology.linkml.yaml",
    "web/schema/chronicle-local-contract.linkml.yaml",
    "web/src/components/AnalyzeSettingsCard.tsx",
    "web/src/lib/rustPipelineRuntime.ts",
    "web/src/lib/rustPipelineAuthority.ts",
  ], extensionGeneratedFiles, validation.hashes?.declared_file_sha256, expectedId);
  const sourceFile = manifest.source_locator.replace(/:\d.*$/, "");
  if (validation.hashes?.source_file_sha256 !== sha256(sourceFile)) {
    throw new Error(`${expectedId}: Behapp deposited source file hash drift`);
  }
  for (const [hashKey, file] of [
    ["fixture_manifest_sha256", nativeConformanceFixturePath],
    ["kernel_sha256", resolve(repo, "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs")],
    ["research_ontology_sha256", resolve(repo, "web/schema/chronicle-research-ontology.linkml.yaml")],
    ["public_contract_sha256", resolve(repo, "web/schema/chronicle-local-contract.linkml.yaml")],
  ]) {
    if (validation.hashes?.[hashKey] !== sha256(file)) {
      throw new Error(`${expectedId}: Behapp validated implementation hash drift at ${hashKey}`);
    }
  }
  if (!Array.isArray(row.contract_bindings) || row.contract_bindings.length !== 1
    || row.contract_bindings[0].contract_slot !== manifest.public_binding.wire_slot
    || row.public_contract_binding?.wire_slot !== manifest.public_binding.wire_slot
    || row.public_contract_binding?.browser_slot !== manifest.public_binding.browser_slot
    || row.public_contract_binding?.contract_value_json !== JSON.stringify(manifest.public_binding.value)
    || row.contract_bindings[0].contract_value_json !== JSON.stringify(manifest.public_binding.value)
    || !contractSlots.has(row.contract_bindings[0].contract_slot)
    || canonicalJson(row.contract_bindings[0].contract_value_json, expectedId) !== row.contract_bindings[0].contract_value_json) {
    throw new Error(`${expectedId}: Behapp interval extension has an invalid public binding`);
  }
  const fixture = (JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures ?? [])
    .find((candidate) => candidate.fixture_id === row.fixture_id);
  const mappedBindings = Object.fromEntries(row.contract_bindings.map((binding) => [
    binding.contract_slot, JSON.parse(binding.contract_value_json),
  ]));
  if (!fixture
    || JSON.stringify(fixture.method_setting_ids) !== JSON.stringify([expectedId])
    || fixture.result_digest !== row.conformance_result_digest
    || JSON.stringify(fixture.browser_contract_bindings) !== JSON.stringify(mappedBindings)) {
    throw new Error(`${expectedId}: Behapp interval fixture differs from its executed promotion mapping`);
  }
  return {
    bySetting: new Map([[expectedId, row]]),
    summary: {
      promoted_settings: 1,
      source_operator_tranche_id: manifest.source_operator_tranche_id,
      implementation_tranche_id: manifest.tranche_id,
      fixture_id: row.fixture_id,
      conformance_result_digest: row.conformance_result_digest,
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadTopAppSelectionExtension() {
  const fixture = (JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures ?? [])
    .find((candidate) => candidate.fixture_id === "extension.daily-top-apps-top5.v1");
  if (!fixture) throw new Error("generic top-five aggregate component fixture is missing");
  return {
    bySetting: new Map(),
    summary: {
      promoted_settings: 0,
      component_fixture_id: fixture.fixture_id,
      source_exact: false,
      reason: "The article does not disclose the ranking rule, day boundary, or social-app list; this fixture proves only generic top-N truncation.",
    },
  };
}

function loadScreenDurationParticipantExclusion(
  nativeRouteAudits, correctedNewOperatorPartition, contractSlots,
) {
  requirePrivate(screenDurationParticipantExclusionDirectory, 0o700);
  for (const path of [
    screenDurationParticipantExclusionMappingPath,
    screenDurationParticipantExclusionValidationPath,
    screenDurationParticipantExclusionManifestPath,
  ]) requirePrivate(path, 0o600);
  const rows = jsonl(screenDurationParticipantExclusionMappingPath);
  const validation = JSON.parse(readFileSync(screenDurationParticipantExclusionValidationPath, "utf8"));
  const manifest = JSON.parse(readFileSync(screenDurationParticipantExclusionManifestPath, "utf8"));
  const expectedId = "method-setting-0e3cf5dcc381e5aba25dc213";
  const row = rows[0];
  const audit = nativeRouteAudits.bySetting.get(expectedId);
  const partition = correctedNewOperatorPartition.bySetting.get(expectedId);
  const expectedBindings = [
    { contract_slot: "screen_session_maximum_duration_minutes", contract_value_json: "600" },
    { contract_slot: "screen_session_maximum_duration_disposition", contract_value_json: "\"exclude_participant\"" },
  ];
  const fixture = (JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures ?? [])
    .find((candidate) => candidate.fixture_id === row?.fixture_id);
  if (rows.length !== 1
    || validation.schema_version !== "chronicle-literature-small-extension-implementation-validation/v1"
    || validation.passed !== true
    || validation.input_setting_count !== 1
    || validation.output_mapping_count !== 1
    || validation.method_setting_identity_exact !== true
    || Object.values(validation.checks ?? {}).some((passed) => passed !== true)
    || validation.hashes?.mapping_sha256 !== sha256(screenDurationParticipantExclusionMappingPath)
    || validation.hashes?.implementation_manifest_sha256 !== sha256(screenDurationParticipantExclusionManifestPath)
    || validation.hashes?.fixture_manifest_sha256 !== sha256(nativeConformanceFixturePath)
    || manifest.schema_version !== "chronicle-literature-small-extension-implementation/v1"
    || manifest.tranche_id !== "T28-scoped-quality-exclusion-rule-engine"
    || JSON.stringify(manifest.method_setting_ids) !== JSON.stringify([expectedId])
    || row?.method_setting_id !== expectedId
    || row.implementation_tranche_id !== manifest.tranche_id
    || row.source_extraction_id !== manifest.source_extraction_id
    || row.source_work_id !== manifest.source_work_id
    || row.source_file_sha256 !== manifest.source_file_sha256
    || row.source_clause_text !== audit?.decision.source_clause_text
    || row.source_value_sha256 !== sha256Bytes(JSON.parse(audit?.decision.source_value_json)).slice(7)
    || audit?.classification !== "new_operator_required"
    || partition?.tranche.tranche_id !== manifest.tranche_id
    || !partition.tranche.method_setting_ids.includes(expectedId)
    || row.method_implementation_status !== "native"
    || row.method_execution_route !== "native_option_binding"
    || row.method_execution_blocker_code !== null
    || row.proof_status !== "executed_and_passed"
    || row.fixture_id !== manifest.conformance.fixture_id
    || row.conformance_result_digest !== manifest.conformance.result_digest
    || row.conformance_result_digest !== validation.conformance_result_digest
    || JSON.stringify(row.contract_bindings) !== JSON.stringify(expectedBindings)
    || row.contract_bindings.some((binding) => !contractSlots.has(binding.contract_slot)
      || canonicalJson(binding.contract_value_json, expectedId) !== binding.contract_value_json)
    || sha256(resolve(repo, manifest.source_file)) !== manifest.source_file_sha256
    || validation.hashes?.source_file_sha256 !== manifest.source_file_sha256
    || !fixture
    || JSON.stringify(fixture.method_setting_ids) !== JSON.stringify([expectedId])
    || JSON.stringify(fixture.browser_contract_bindings) !== JSON.stringify({
      screen_session_maximum_duration_minutes: 600,
      screen_session_maximum_duration_disposition: "exclude_participant",
    })
    || fixture.result_digest !== row.conformance_result_digest) {
    throw new Error("screen-duration participant-exclusion validation, identity, or executed proof failed");
  }
  return {
    bySetting: new Map([[expectedId, row]]),
    summary: {
      promoted_settings: 1,
      implementation_tranche_id: manifest.tranche_id,
      fixture_id: row.fixture_id,
      conformance_result_digest: row.conformance_result_digest,
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadAppOpeningIterationExtension(nativeRouteAudits, sourceEvidenceRepairs, contractSlots) {
  requirePrivate(appOpeningIterationDirectory, 0o700);
  for (const path of [
    appOpeningIterationMappingPath,
    appOpeningIterationValidationPath,
    appOpeningIterationManifestPath,
  ]) requirePrivate(path, 0o600);
  const rows = jsonl(appOpeningIterationMappingPath);
  const validation = JSON.parse(readFileSync(appOpeningIterationValidationPath, "utf8"));
  const manifest = JSON.parse(readFileSync(appOpeningIterationManifestPath, "utf8"));
  const expectedId = "method-setting-2e39007febbabdfad6a6b2a4";
  const row = rows[0];
  const audit = nativeRouteAudits.bySetting.get(expectedId);
  const repair = sourceEvidenceRepairs.bySetting.get(expectedId);
  const expectedBindings = [
    { contract_slot: "process_app_usage", contract_value_json: "true" },
    { contract_slot: "opener_set", contract_value_json: "\"activity_resumed_only\"" },
  ];
  const fixture = (JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures ?? [])
    .find((candidate) => candidate.fixture_id === row?.fixture_id);
  const adapterFixtures = (JSON.parse(readFileSync(inputAdapterFixturePath, "utf8")).groups ?? [])
    .flatMap((group) => group.cases ?? [])
    .filter((candidate) => candidate.sourceWorkId === row?.source_work_id
      && candidate.sourceValue === "AppOpenEvent"
      && candidate.expected?.outputContains?.includes("Activity Resumed"));
  const adapterFixture = adapterFixtures[0];
  if (rows.length !== 1
    || validation.schema_version !== "chronicle-literature-small-extension-implementation-validation/v1"
    || validation.passed !== true
    || validation.input_setting_count !== 1
    || validation.output_mapping_count !== 1
    || validation.method_setting_identity_exact !== true
    || Object.values(validation.checks ?? {}).some((passed) => passed !== true)
    || validation.hashes?.mapping_sha256 !== sha256(appOpeningIterationMappingPath)
    || validation.hashes?.implementation_manifest_sha256 !== sha256(appOpeningIterationManifestPath)
    || validation.hashes?.fixture_manifest_sha256 !== sha256(nativeConformanceFixturePath)
    || manifest.schema_version !== "chronicle-literature-small-extension-implementation/v1"
    || manifest.tranche_id !== "T29-each-app-opening-event"
    || JSON.stringify(manifest.method_setting_ids) !== JSON.stringify([expectedId])
    || row?.method_setting_id !== expectedId
    || row.implementation_tranche_id !== manifest.tranche_id
    || row.source_extraction_id !== manifest.source_extraction_id
    || row.source_work_id !== manifest.source_work_id
    || row.source_file_sha256 !== manifest.source_witness?.sha256
    || row.source_clause_text !== repair?.corrected_source_clause_text
    || row.source_value_sha256 !== sha256Bytes(JSON.parse(audit?.decision.source_value_json)).slice(7)
    || row.audit_classification !== "existing_app_open_iteration_binding"
    || audit?.classification !== "source_evidence_blocked"
    || repair?.repair_disposition !== "executable_clause_recovered"
    || repair.corrected_method_parameter_key !== "session_feature_recovery_iteration_unit"
    || row.method_implementation_status !== "native"
    || row.method_execution_route !== "native_option_binding"
    || row.method_execution_blocker_code !== null
    || row.proof_status !== "executed_and_passed"
    || row.fixture_id !== manifest.conformance.fixture_id
    || row.conformance_result_digest !== manifest.conformance.result_digest
    || row.conformance_result_digest !== validation.conformance_result_digest
    || JSON.stringify(row.contract_bindings) !== JSON.stringify(expectedBindings)
    || row.contract_bindings.some((binding) => !contractSlots.has(binding.contract_slot)
      || canonicalJson(binding.contract_value_json, expectedId) !== binding.contract_value_json)
    || sha256(resolve(repo, manifest.source_witness.path)) !== manifest.source_witness.sha256
    || validation.hashes?.source_file_sha256 !== manifest.source_witness.sha256
    || adapterFixtures.length !== 1
    || !fixture
    || JSON.stringify(fixture.method_setting_ids) !== JSON.stringify([expectedId])
    || JSON.stringify(fixture.browser_contract_bindings) !== JSON.stringify({
      process_app_usage: true,
      opener_set: "activity_resumed_only",
    })
    || fixture.result_digest !== row.conformance_result_digest) {
    throw new Error("each-app-opening-event validation, identity, adapter, or executed proof failed");
  }
  return {
    bySetting: new Map([[expectedId, row]]),
    summary: {
      promoted_settings: 1,
      implementation_tranche_id: manifest.tranche_id,
      fixture_id: row.fixture_id,
      conformance_result_digest: row.conformance_result_digest,
      source_adapter_fixture_id: adapterFixture.fixtureId,
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadApplicationLabelExtension(nativeRouteAudits, contractSlots) {
  requirePrivate(applicationLabelExtensionDirectory, 0o700);
  for (const path of [
    applicationLabelExtensionMappingPath,
    applicationLabelExtensionValidationPath,
    applicationLabelExtensionManifestPath,
  ]) requirePrivate(path, 0o600);
  const rows = jsonl(applicationLabelExtensionMappingPath);
  const validation = JSON.parse(readFileSync(applicationLabelExtensionValidationPath, "utf8"));
  const manifest = JSON.parse(readFileSync(applicationLabelExtensionManifestPath, "utf8"));
  const expectedIds = [
    "method-setting-3f07e9131d5492926afe8c63",
    "method-setting-6945d62974714b285e78cca0",
  ];
  const expectedLabels = ["YouTube Vanced", "Basic Daydreams"];
  const expectedBindings = [
    { contract_slot: "filter_match_field", contract_value_json: '"application_label"' },
    { contract_slot: "application_label_exclusions", contract_value_json: JSON.stringify(expectedLabels) },
  ];
  const expectedFiles = [
    ".tmp-literature-review-private/corrective-packet-06-ranks174-223-20260831/artifacts/rank209-osf-45q72/osfstorage/Notification-disabling intervention study/Data & Analyses/(2) R script data cleaning [raw survey & tracking data].R",
    ".semantic-federation/semantic/resources/chronicle-research-ontology.linkml.yaml",
    "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs",
    "rust/chronicle_chrono_kernel_wasm/src/pipeline/options.rs",
    "rust/chronicle_chrono_kernel_wasm/src/pipeline/stages/reconstruction.rs",
    "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs",
    "rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs",
    "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs",
    "rust/chronicle_preprocessing_runtime_wasm/tests/fixtures/literature_native_conformance.json",
    "rust/chronicle_preprocessing_runtime_wasm/tests/literature_native_conformance.rs",
    "web/openapi/chronicle-local-api.yaml",
    "web/schema/chronicle-local-contract.linkml.yaml",
    "web/schema/chronicle-research-ontology.linkml.yaml",
    "web/schema/generated/owl/chronicle-research-ontology.owl.ttl",
    "web/schema/generated/shacl/chronicle-research-ontology.shacl.ttl",
    "web/schema/generated/shacl/merged.shacl.ttl",
    "web/schema/generated/pydantic/chronicle_research_ontology.py",
    "web/schema/generated/json-schema/chronicle-research-ontology.schema.json",
    "web/schema/generated/sql/chronicle-research-ontology.ddl.sql",
    "docs/METHODS.md",
    "web/src/components/FilesAndInputsCard.tsx",
    "web/src/components/SettingsSearchResults.tsx",
    "web/src/components/StudyInputsCard.test.ts",
    "web/src/lib/generatedContract.ts",
    "web/src/lib/methodProfiles.test.ts",
    "web/src/lib/methodProfiles.ts",
    "web/src/lib/types.ts",
    "web/src/lib/settingsPersistence.ts",
    "web/src/lib/rustPipelineRuntime.ts",
    "web/scripts/merge_method_profile_adjudications.mjs",
  ];
  const inventory = manifest.file_inventory ?? [];
  const inventoryPaths = inventory.map((entry) => entry.path);
  if (rows.length !== 2
    || !isDeepStrictEqual(rows.map((row) => row.method_setting_id), expectedIds)
    || validation.schema_version !== "chronicle-literature-small-extension-implementation-validation/v1"
    || validation.passed !== true
    || Object.values(validation.checks ?? {}).some((passed) => passed !== true)
    || Object.values(validation.commands ?? {}).some((command) => command.passed !== true)
    || validation.hashes?.mapping_sha256 !== sha256(applicationLabelExtensionMappingPath)
    || validation.hashes?.implementation_manifest_sha256 !== sha256(applicationLabelExtensionManifestPath)
    || manifest.schema_version !== "chronicle-literature-small-extension-implementation/v1"
    || manifest.tranche_id !== "small-ext-09-application-label-exclusion"
    || !isDeepStrictEqual(manifest.method_setting_ids, expectedIds)
    || manifest.source_work_id !== "doi:10.1080/15213269.2024.2334025"
    || manifest.source_extraction_id !== "extraction-cc1f6a72d75b7f434d75"
    || !isDeepStrictEqual(inventoryPaths, expectedFiles)
    || new Set(inventoryPaths).size !== expectedFiles.length
    || inventory.some((entry) => !["source_witness", "source_controlled", "repo_candidate", "generated"].includes(entry.class)
      || entry.sha256 !== sha256(resolve(repo, entry.path)))) {
    throw new Error("application-label extension validation, identity, or complete inventory failed");
  }
  const sourcePath = resolve(repo, manifest.source_witness.path);
  if (manifest.source_witness.line !== 327
    || manifest.source_witness.sha256 !== sha256(sourcePath)
    || !readFileSync(sourcePath, "utf8").includes(manifest.source_witness.exact_text)
    || !isDeepStrictEqual(manifest.public_binding, {
      browser_slots: {
        filterMatchField: "application_label",
        applicationLabelExclusions: expectedLabels,
      },
      wire_slots: {
        filter_match_field: "application_label",
        application_label_exclusions: expectedLabels,
      },
    })
    || manifest.conformance?.fixture_id !== "extension.application-label-exclusion.v1"
    || manifest.conformance?.result_digest !== "sha256:003dbfa335b8b68fbece41d1f85fd8b7f481158c0417d5c7e3b43a71eb660345") {
    throw new Error("application-label extension source, binding, or conformance manifest drift");
  }
  const rowKeys = [
    "schema_version", "implementation_tranche_id", "audit_lane", "audit_classification",
    "method_setting_id", "source_extraction_id", "source_work_id", "source_locator",
    "source_file_sha256", "source_clause_text", "source_method_value_json", "source_value_sha256",
    "contract_bindings", "method_implementation_status", "method_execution_route",
    "method_execution_destination_id", "method_execution_parameter_path", "method_execution_blocker_code",
    "executor_id", "operator_id", "fixture_id", "conformance_result_digest", "gap_assessment", "proof_status",
  ];
  for (const row of rows) {
    const id = row.method_setting_id;
    const audit = nativeRouteAudits.bySetting.get(id);
    if (!isDeepStrictEqual(Object.keys(row), rowKeys)
      || row.schema_version !== "chronicle-literature-small-extension-conformance-mapping/v1"
      || row.implementation_tranche_id !== manifest.tranche_id
      || row.audit_lane !== "quality"
      || row.audit_classification !== "small_existing_operator_extension"
      || audit?.classification !== "small_existing_operator_extension"
      || row.source_extraction_id !== audit.decision.source_extraction_id
      || row.source_work_id !== audit.decision.source_work_id
      || row.source_clause_text !== audit.decision.source_clause_text
      || row.source_method_value_json !== audit.decision.method_value_json
      || row.source_value_sha256 !== sha256Bytes(JSON.parse(audit.decision.source_value_json)).slice(7)
      || row.source_file_sha256 !== manifest.source_witness.sha256
      || resolve(repo, row.source_locator.replace(/:\d+$/, "")) !== sourcePath
      || !isDeepStrictEqual(row.contract_bindings, expectedBindings)
      || row.contract_bindings.some((binding) => !contractSlots.has(binding.contract_slot)
        || canonicalJson(binding.contract_value_json, id) !== binding.contract_value_json)
      || row.method_implementation_status !== "native"
      || row.method_execution_route !== "native_option_binding"
      || row.method_execution_destination_id !== nativeExecutor
      || row.method_execution_parameter_path !== "/browser-processing-options"
      || row.method_execution_blocker_code !== null
      || row.executor_id !== nativeExecutor
      || row.operator_id !== manifest.native_operator.id
      || row.fixture_id !== manifest.conformance.fixture_id
      || row.conformance_result_digest !== manifest.conformance.result_digest
      || row.gap_assessment !== "implemented_exact_native"
      || row.proof_status !== "executed_and_passed") {
      throw new Error(`${id}: application-label extension proof differs from the source audit or public contract`);
    }
  }
  const fixture = (JSON.parse(readFileSync(nativeConformanceFixturePath, "utf8")).fixtures ?? [])
    .find((candidate) => candidate.fixture_id === manifest.conformance.fixture_id);
  if (!fixture
    || !isDeepStrictEqual(fixture.method_setting_ids, expectedIds)
    || !isDeepStrictEqual(fixture.browser_contract_bindings, manifest.public_binding.wire_slots)
    || fixture.result_digest !== manifest.conformance.result_digest) {
    throw new Error("application-label closed fixture identity/value/digest registry drift");
  }
  const execution = runRuntimeConformance([
    "test", "--test", "literature_native_conformance", "--", "--nocapture",
  ], "application-label extension");
  if (!execution.includes("2 passed")) {
    throw new Error("application-label extension executable closure test did not run");
  }
  return {
    bySetting: new Map(rows.map((row) => [row.method_setting_id, row])),
    summary: {
      promoted_settings: 2,
      implementation_tranche_id: manifest.tranche_id,
      fixture_id: manifest.conformance.fixture_id,
      conformance_result_digest: manifest.conformance.result_digest,
      exact_identity_coverage: true,
      closed_runtime_registry: true,
      gui_editable_without_filter_file: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadInputAdapterImplementations(
  nativeRouteAudits, missingInputAudit, correctedNewOperatorPartition, sourceEvidenceRepairs,
  assertions,
) {
  for (const path of [
    inputAdapterImplementationMappingPath,
    inputAdapterImplementationValidationPath,
    inputAdapterImplementationManifestPath,
  ]) requirePrivate(path, 0o600);
  const rows = jsonl(inputAdapterImplementationMappingPath);
  const validation = JSON.parse(readFileSync(inputAdapterImplementationValidationPath, "utf8"));
  const manifest = JSON.parse(readFileSync(inputAdapterImplementationManifestPath, "utf8"));
  const contract = JSON.parse(readFileSync(inputAdapterContractPath, "utf8"));
  const fixtureManifest = JSON.parse(readFileSync(inputAdapterFixturePath, "utf8"));
  requirePrivate(schoedelOracleDirectory, 0o700);
  requirePrivate(schoedelOracleManifestPath, 0o600);
  const schoedelOracleRows = readFileSync(schoedelOracleManifestPath, "utf8")
    .trimEnd().split("\n").map((line) => line.split("\t"));
  const schoedelOracleByFile = new Map(schoedelOracleRows.slice(1));
  const schoedelSemanticOraclePath = resolve(schoedelOracleDirectory, "semantic-oracles.tsv");
  requirePrivate(schoedelSemanticOraclePath, 0o600);
  const schoedelSemanticOracles = readFileSync(schoedelSemanticOraclePath, "utf8")
    .trimEnd().split("\n");
  if (sha256(schoedelOracleManifestPath).slice(7) !== schoedelOracleManifestSha256
    || schoedelOracleRows.length !== 46
    || schoedelOracleRows[0].join("\t") !== "file\tsha256"
    || schoedelOracleByFile.get("released/Screen_preprocessing.R")
      !== "ca5d3052b4a30e9a62ae046e57c890196fff1f84157b02ea324b4b0ae1c2b797"
    || schoedelOracleByFile.get("semantic-oracles.tsv")
      !== sha256(schoedelSemanticOraclePath).slice(7)
    || schoedelOracleByFile.get("rust-all-cell-bundle") !== schoedelRustAllCellBundleSha256
    || schoedelSemanticOracles.length !== 25
    || schoedelSemanticOracles.slice(1).some((line) => !line.endsWith("\tTRUE"))) {
    throw new Error("Schoedel released-R oracle manifest, 24 semantic oracles, or Rust all-cell bundle drift");
  }
  const regularRows = rows.filter((row) =>
    !lateSourceCompletenessInputAdapterIds.has(row.method_setting_id));
  const latePrivateRows = rows.filter((row) =>
    lateSourceCompletenessInputAdapterIds.has(row.method_setting_id));
  requirePrivate(smallExtensionTranchePath, 0o600);
  requirePrivate(smallExtensionTrancheValidationPath, 0o600);
  const smallExtensionValidation = JSON.parse(readFileSync(smallExtensionTrancheValidationPath, "utf8"));
  const sourceSchemaTranche = jsonl(smallExtensionTranchePath)
    .find((tranche) => tranche.tranche_id === "small-ext-12-source-event-schema-adapter");
  const sourceSchemaMembers = new Map((sourceSchemaTranche?.member_settings ?? [])
    .map((member) => [member.method_setting_id, member]));
  const executionOutput = runRuntimeConformance([
    "test", "literature_input_adapter_fixture_manifest_executes_exact_source_atoms",
    "--lib", "--", "--nocapture",
  ], "input-adapter");
  const schoedelAllCellOutput = runRuntimeConformance([
    "test", "schoedel_screen_preprocessing_matches_every_released_r_output_cell",
    "--lib", "--", "--nocapture",
  ], "Schoedel released-R all-cell comparator");
  if (!schoedelAllCellOutput.includes("1 passed")) {
    throw new Error("Schoedel released-R 800-cell comparator did not run");
  }
  const executionMarker = "LITERATURE_INPUT_CONFORMANCE ";
  const allExecutedRows = executionOutput.split("\n")
    .filter((line) => line.includes(executionMarker))
    .map((line) => JSON.parse(line.slice(line.indexOf(executionMarker) + executionMarker.length)));
  const executedRows = allExecutedRows.filter((row) =>
    !lateSourceCompletenessInputAdapterIds.has(row.method_setting_id));
  const lateExecutedRows = allExecutedRows.filter((row) =>
    lateSourceCompletenessInputAdapterIds.has(row.method_setting_id));
  const allContractIds = contract.groups.flatMap((group) => group.methodSettingIds);
  const contractIds = contract.groups
    .filter((group) => !lateSourceCompletenessAdapterIds.has(`${group.adapterId}/${group.adapterVersion}`))
    .flatMap((group) => group.methodSettingIds);
  const allFixtureCases = fixtureManifest.groups.flatMap((group) => group.cases.map((fixture) => ({
    ...fixture,
    adapterId: group.adapterId,
  })));
  const fixtureCases = allFixtureCases.filter((fixture) =>
    !lateSourceCompletenessInputAdapterIds.has(fixture.methodSettingId));
  const allFixtureIds = allFixtureCases.map((fixture) => fixture.methodSettingId);
  const fixtureIds = fixtureCases.map((fixture) => fixture.methodSettingId);
  const allMappedIds = rows.map((row) => row.method_setting_id);
  const mappedIds = regularRows.map((row) => row.method_setting_id);
  const sorted = (values) => [...values].sort();
  const allExpectedIds = sorted(allContractIds);
  const expectedIds = sorted(contractIds);
  if (validation.schema_version !== "chronicle-missing-input-adapter-implementation-validation/v2"
    || validation.status !== "source_exact_implemented_cases_executed"
    || validation.coverage?.public_contract_method_setting_ids !== rows.length
    || validation.coverage?.fixture_method_setting_ids !== rows.length
    || validation.coverage?.executed_mapping_method_setting_ids !== rows.length
    || validation.coverage?.unique_method_setting_ids !== rows.length
    || validation.coverage?.registry_fixture_mapping_exact_equality !== true
    || validation.coverage?.all_assertions_passed !== true
    || validation.coverage?.route_corrections_blocked !== manifest.route_correction_not_implemented_count
    || validation.digests?.private_executed_mapping_sha256 !== sha256(inputAdapterImplementationMappingPath).slice(7)
    || validation.digests?.implementation_manifest_sha256 !== sha256(inputAdapterImplementationManifestPath).slice(7)
    || contract.schemaVersion !== "chronicle-literature-input-adapter-contract/v1"
    || fixtureManifest.schemaVersion !== "chronicle-literature-input-adapter-conformance/v2"
    || manifest.schema_version !== "chronicle-missing-input-adapter-implementation/v2"
    || manifest.implemented_count !== rows.length
    || manifest.route_corrections.length !== manifest.route_correction_not_implemented_count
    || new Set(allContractIds).size !== allContractIds.length
    || new Set(allFixtureIds).size !== allFixtureIds.length
    || new Set(allMappedIds).size !== allMappedIds.length
    || new Set(allExecutedRows.map((row) => row.method_setting_id)).size !== allExecutedRows.length
    || new Set(executedRows.map((row) => row.method_setting_id)).size !== executedRows.length
    || allExecutedRows.length !== allContractIds.length
    || JSON.stringify(sorted(allFixtureIds)) !== JSON.stringify(allExpectedIds)
    || JSON.stringify(sorted(allExecutedRows.map((row) => row.method_setting_id))) !== JSON.stringify(allExpectedIds)
    || JSON.stringify(sorted(fixtureIds)) !== JSON.stringify(expectedIds)
    || mappedIds.some((id) => !expectedIds.includes(id))
    || allMappedIds.some((id) => !allExpectedIds.includes(id))
    || manifest.route_corrections.some((correction) => expectedIds.includes(correction.method_setting_id))) {
    throw new Error("input-adapter implementation validation, hashes, or exact identity coverage failed");
  }
  if (smallExtensionValidation.passed !== true
    || sourceSchemaTranche?.member_count !== 32
    || sourceSchemaMembers.size !== 32) {
    throw new Error("source event/schema adapter tranche authority failed validation");
  }
  const contractBySetting = new Map();
  for (const group of contract.groups) {
    if (!group.adapterId || !group.adapterVersion || !group.routeKind || !group.inputRole || !group.schemaId
      || !group.guiSurface || !Array.isArray(group.requiredFields) || !group.requiredFields.length) {
      throw new Error(`${group.adapterId ?? "unknown adapter"}: malformed literature input-adapter contract`);
    }
    for (const id of group.methodSettingIds) contractBySetting.set(id, group);
  }
  const fixturesBySetting = new Map(fixtureCases.map((fixture) => [fixture.methodSettingId, fixture]));
  const allFixturesBySetting = new Map(allFixtureCases
    .map((fixture) => [fixture.methodSettingId, fixture]));
  const assertionsById = new Map(assertions.map((setting) => [setting.method_setting_id, setting]));
  const sourceSchemaEvidenceVerified = (group, id) => {
    const registration = group?.sourceSchemas?.find((schema) => schema.methodSettingId === id);
    if (!registration) return true;
    const member = sourceSchemaMembers.get(id);
    return Boolean(registration.sourceExact !== false && member
      && registration.sourceWorkId === member.source_work_id
      && JSON.stringify(registration.sourceValue) === member.method_value_json
      && registration.sourceValueSha256
        === sha256Bytes(JSON.parse(member.source_value_json)).slice(7));
  };
  const bySetting = new Map();
  const deferredPostAuditBySetting = new Map();
  for (const row of regularRows) {
    const id = row.method_setting_id;
    const audit = nativeRouteAudits.bySetting.get(id);
    const inputAudit = missingInputAudit.bySetting.get(id);
    const group = contractBySetting.get(id);
    const fixture = fixturesBySetting.get(id);
    const sourceSchema = group?.sourceSchemas?.find((registration) => registration.methodSettingId === id);
    const correctedPartition = correctedNewOperatorPartition.bySetting.get(id);
    const sourceEvidenceRepair = sourceEvidenceRepairs.bySetting.get(id);
    const missingInputEligible = audit?.classification === "missing_input"
      && inputAudit
      && ["existing_input_already_available_but_unwired", "small_extension_existing_support_schema_or_adapter"]
        .includes(inputAudit.input_classification);
    const sourceSchemaEligible = audit?.classification === "small_existing_operator_extension"
      && !inputAudit
      && sourceSchema
      && sourceSchemaEvidenceVerified(group, id);
    const sourceSpecificAdapterEligible = audit?.classification === "small_existing_operator_extension"
      && !inputAudit
      && !sourceSchema
      && group?.adapterId === "chronicle.schoedel-standby-filter"
      && row.source_work_id === audit.decision.source_work_id
      && JSON.stringify(row.source_value) === audit.decision.method_value_json;
    const recoveredNotificationFilterEligible = id === "method-setting-375f65af66c209581c0539d3"
      && audit?.classification === "missing_input"
      && inputAudit?.input_classification === "source_version_artifact_unavailable"
      && inputAudit.source_extraction_id === audit.decision.source_extraction_id
      && group?.adapterId === "chronicle.notification-source-exclusion"
      && row.source_work_id === audit.decision.source_work_id
      && JSON.stringify(row.source_value) === audit.decision.method_value_json;
    const notificationDailyEligible = [
      "method-setting-00b9e68ec2f812485d70c809",
      "method-setting-1a54c43ea05a73d05fb96b06",
    ].includes(id)
      && audit?.classification === "small_existing_operator_extension"
      && !inputAudit
      && group?.adapterId === "chronicle.notification-study-daily"
      && row.source_work_id === audit.decision.source_work_id
      && JSON.stringify(row.source_value) === audit.decision.method_value_json;
    const notificationComplianceEligible = id === "method-setting-b4785babbe7649c9ea815804"
      && audit?.classification === "missing_input"
      && inputAudit?.input_classification === "genuinely_new_optional_input_artifact"
      && inputAudit.source_extraction_id === audit.decision.source_extraction_id
      && group?.adapterId === "chronicle.notification-study-daily"
      && row.source_work_id === audit.decision.source_work_id
      && JSON.stringify(row.source_value) === audit.decision.method_value_json;
    const analysisFeatureMissingnessEligible = audit?.classification === "missing_input"
      && inputAudit?.input_classification === "genuinely_new_optional_input_artifact"
      && group?.adapterId === "chronicle.analysis-feature-missingness"
      && row.source_work_id === audit.decision.source_work_id
      && isDeepStrictEqual(row.source_value, JSON.parse(audit.decision.method_value_json));
    const callSmsEligibilityEligible = audit?.classification === "missing_input"
      && inputAudit?.input_classification === "genuinely_new_optional_input_artifact"
      && ["chronicle.call-sms-volume-gate", "chronicle.call-modality-availability"]
        .includes(group?.adapterId)
      && row.source_work_id === audit.decision.source_work_id
      && isDeepStrictEqual(row.source_value, JSON.parse(audit.decision.method_value_json));
    const qualityControlAdapterEligible = audit?.classification === "small_existing_operator_extension"
      && !inputAudit
      && !sourceSchema
      && ["chronicle.study-window-quality-control", "chronicle.category-duration-outlier", "chronicle.screen-off-gap-bridge", "chronicle.screen-missing-gap-fill", "chronicle.keyguard-transition-fsm"]
        .includes(group?.adapterId)
      && row.source_work_id === audit.decision.source_work_id
      && JSON.stringify(row.source_value) === audit.decision.method_value_json;
    const repairedQualityControlEligible = audit?.classification === "source_evidence_blocked"
      && !inputAudit
      && sourceEvidenceRepair?.repair_disposition === "executable_clause_recovered"
      && sourceEvidenceRepair.source_extraction_id === audit.decision.source_extraction_id
      && sourceEvidenceRepair.source_work_id === audit.decision.source_work_id
      && group?.adapterId === "chronicle.battery-period-day-exclusion"
      && row.source_work_id === sourceEvidenceRepair.source_work_id
      && isDeepStrictEqual(row.source_value, JSON.parse(sourceEvidenceRepair.corrected_method_value_json));
    const correctedIntervalEligible = audit?.classification === "new_operator_required"
      && !inputAudit
      && correctedPartition?.tranche.tranche_id === "T11-interval-app-usage-input-adapter"
      && correctedPartition.tranche.corrected_route === "missing_typed_input"
      && correctedPartition.tranche.implementation_status === "input_adapter_required_before_existing_reconstruction"
      && group?.adapterId === "chronicle.raw-interval"
      && row.source_work_id === audit.decision.source_work_id
      && JSON.stringify(row.source_value) === audit.decision.method_value_json;
    const studyDateInteriorExclusionEligible = !inputAudit
      && correctedPartition?.tranche.tranche_id === "T27-study-window-interior-exclusion-extension"
      && correctedPartition.tranche.corrected_route === "existing_study_window_operator_extension"
      && correctedPartition.tranche.implementation_status === "extension_required"
      && group?.adapterId === "chronicle.study-date-interior-exclusion"
      && row.source_work_id === audit?.decision.source_work_id
      && (JSON.stringify(row.source_value) === audit.decision.method_value_json
        || sourceEvidenceRepair?.repair_disposition === "executable_clause_recovered"
        && sourceEvidenceRepair.source_extraction_id === audit.decision.source_extraction_id
        && isDeepStrictEqual(
          row.source_value,
          JSON.parse(sourceEvidenceRepair.corrected_method_value_json),
        ));
    const keyguardFieldEligible = group?.adapterId === "chronicle.keyguard-transition-fsm"
      && row.source_work_id === "doi:10.1145/2858036.2858267"
      && (audit?.classification === "missing_input"
        && inputAudit?.input_classification === "genuinely_new_optional_input_artifact"
        && JSON.stringify(row.source_value) === audit.decision.method_value_json
        || audit?.classification === "source_evidence_blocked"
        && sourceEvidenceRepair?.repair_disposition === "executable_clause_recovered"
        && sourceEvidenceRepair.source_extraction_id === audit.decision.source_extraction_id
        && sourceEvidenceRepair.source_work_id === audit.decision.source_work_id
        && JSON.stringify(row.source_value) === sourceEvidenceRepair.corrected_method_value_json);
    const keyguardOperatorEligible = audit?.classification === "new_operator_required"
      && !inputAudit
      && correctedPartition?.tranche.tranche_id === "T25-keyguard-pickup-state-machine"
      && correctedPartition.tranche.corrected_route === "new_native_operator"
      && correctedPartition.tranche.implementation_status === "input_complete_new_operator_required"
      && group?.adapterId === "chronicle.keyguard-transition-fsm"
      && row.source_work_id === audit.decision.source_work_id
      && JSON.stringify(row.source_value) === audit.decision.method_value_json
      && isDeepStrictEqual(row.source_value, correctedPartition.atomicValue);
    const protocolEventReceiptEligible = audit?.classification === "new_operator_required"
      && !inputAudit
      && correctedPartition?.tranche.tranche_id === "T00-protocol-input-event-vocabulary-receipts"
      && correctedPartition.tranche.corrected_route === "documentary_protocol_input_receipt"
      && correctedPartition.tranche.implementation_status === "receipt_registration_required_no_new_operator"
      && group?.adapterId === "chronicle.source-event-schema"
      && sourceSchema
      && sourceSchema.sourceWorkId === row.source_work_id
      && isDeepStrictEqual(sourceSchema.sourceValue, row.source_value)
      && sourceSchema.sourceValueSha256
        === sha256Bytes(JSON.parse(audit.decision.source_value_json)).slice(7)
      && row.source_work_id === audit.decision.source_work_id
      && JSON.stringify(row.source_value) === audit.decision.method_value_json
      && isDeepStrictEqual(row.source_value, correctedPartition.atomicValue);
    const usageStatsPermissionEligible = id === usageStatsPermissionSettingId
      && !audit
      && !inputAudit
      && group?.adapterId === "chronicle.input-capability-disposition"
      && row.source_work_id === "doi:10.1145/3544793.3563411"
      && row.source_value === "UsageStats";
    const screenStateNetworkClassifierEligible = audit?.classification === "source_evidence_blocked"
      && !inputAudit
      && sourceEvidenceRepair?.repair_disposition === "executable_clause_recovered"
      && sourceEvidenceRepair.source_extraction_id === audit.decision.source_extraction_id
      && sourceEvidenceRepair.source_work_id === audit.decision.source_work_id
      && group?.adapterId === "chronicle.screen-state-network-classifier"
      && row.source_work_id === sourceEvidenceRepair.source_work_id
      && isDeepStrictEqual(row.source_value, JSON.parse(sourceEvidenceRepair.corrected_method_value_json));
    const networkWindowCoalescerEligible = audit?.classification === "missing_input"
      && inputAudit?.input_classification === "genuinely_new_optional_input_artifact"
      && group?.adapterId === "chronicle.network-window-coalescer"
      && row.source_work_id === audit.decision.source_work_id
      && isDeepStrictEqual(row.source_value, JSON.parse(audit.decision.method_value_json));
    const smsResponseLinkerEligible = audit?.classification === "missing_input"
      && inputAudit?.input_classification === "genuinely_new_optional_input_artifact"
      && group?.adapterId === "chronicle.sms-response-linker"
      && row.source_work_id === audit.decision.source_work_id
      && isDeepStrictEqual(row.source_value, JSON.parse(audit.decision.method_value_json));
    const estarNetworkReconstructionEligible = audit?.classification === "missing_input"
      && inputAudit?.input_classification === "genuinely_new_optional_input_artifact"
      && group?.adapterId === "chronicle.estar-network-call-reconstruction"
      && row.source_work_id === "doi:10.1145/2745844.2745875"
      && row.source_work_id === audit.decision.source_work_id
      && isDeepStrictEqual(row.source_value, JSON.parse(audit.decision.method_value_json));
    const routeEligible = missingInputEligible || sourceSchemaEligible || sourceSpecificAdapterEligible
      || recoveredNotificationFilterEligible || notificationDailyEligible
      || notificationComplianceEligible || analysisFeatureMissingnessEligible
      || callSmsEligibilityEligible || qualityControlAdapterEligible || repairedQualityControlEligible
      || correctedIntervalEligible || studyDateInteriorExclusionEligible || keyguardFieldEligible
      || keyguardOperatorEligible || protocolEventReceiptEligible || usageStatsPermissionEligible
      || screenStateNetworkClassifierEligible || networkWindowCoalescerEligible
      || smsResponseLinkerEligible || estarNetworkReconstructionEligible;
    const failedChecks = [
      ["schema", row.schema_version === "chronicle-literature-input-conformance-mapping/v1"],
      ["assertions", row.assertions_passed === true],
      ["fixture_digest", /^sha256:[0-9a-f]{64}$/.test(row.fixture_source_digest)],
      ["adapted_digest", /^sha256:[0-9a-f]{64}$/.test(row.adapted_output_digest)],
      ["result_digest", /^sha256:[0-9a-f]{64}$/.test(row.conformance_result_digest)],
      ["contract_group", Boolean(group)],
      ["fixture", Boolean(fixture)],
      ["audit_source", !routeEligible || usageStatsPermissionEligible
        || row.source_work_id === audit?.decision.source_work_id],
      ["fixture_source", row.source_work_id === fixture?.sourceWorkId],
      ["source_value", isDeepStrictEqual(row.source_value, fixture?.sourceValue)],
      ["fixture_id", row.fixture_id === fixture?.fixtureId],
      ["fixture_adapter", row.adapter_id === fixture?.adapterId],
      ["contract_adapter", row.adapter_id === `${group?.adapterId}/${group?.adapterVersion}`],
      ["executed_mapping", isDeepStrictEqual(executedRows.find((executed) => executed.method_setting_id === id), row)],
    ].filter(([, passed]) => !passed).map(([name]) => name);
    if (failedChecks.length) {
      throw new Error(`${id}: input-adapter proof failed at ${failedChecks.join(", ")}`);
    }
    let currentSourceValue;
    try {
      currentSourceValue = JSON.parse(assertionsById.get(id)?.method_value_json);
    } catch {
      currentSourceValue = Symbol("invalid source value");
    }
    if (!routeEligible || !isDeepStrictEqual(currentSourceValue, row.source_value)) {
      deferredPostAuditBySetting.set(id, {
        mapping: row,
        contract: group,
        fixture,
        sourceMethodVariantId: fixtureManifest.sourceMethodVariants?.[id],
        sourceSchemaEvidenceVerified: sourceSchemaEvidenceVerified(group, id),
      });
      continue;
    }
    bySetting.set(id, {
      mapping: row,
      contract: group,
      sourceSchemaEvidenceVerified: sourceSchemaEvidenceVerified(group, id),
    });
  }
  if (new Set(rows.map((row) => row.fixture_id)).size !== rows.length
    || new Set(rows.map((row) => row.fixture_source_digest)).size !== rows.length
    || new Set(rows.map((row) => row.conformance_result_digest)).size !== rows.length) {
    throw new Error("input-adapter implementation proofs are not source-specific and unique");
  }
  const lateFixturesBySetting = new Map(allFixtureCases
    .filter((fixture) => lateSourceCompletenessInputAdapterIds.has(fixture.methodSettingId))
    .map((fixture) => [fixture.methodSettingId, fixture]));
  const lateExecutedBySetting = new Map(lateExecutedRows
    .map((row) => [row.method_setting_id, row]));
  const latePrivateBySetting = new Map(latePrivateRows
    .map((row) => [row.method_setting_id, row]));
  const lateContractsById = new Map(contract.groups
    .filter((group) => lateSourceCompletenessAdapterIds.has(`${group.adapterId}/${group.adapterVersion}`))
    .map((group) => [`${group.adapterId}/${group.adapterVersion}`, group]));
  if (lateContractsById.size !== lateSourceCompletenessInputAdapterGroups.length
    || lateFixturesBySetting.size !== lateSourceCompletenessInputAdapterIds.size
    || lateExecutedBySetting.size !== lateSourceCompletenessInputAdapterIds.size
    || latePrivateBySetting.size !== lateSourceCompletenessInputAdapterIds.size) {
    throw new Error("late source-completeness input-adapter identities are incomplete");
  }
  const lateBySetting = new Map();
  for (const adapter of lateSourceCompletenessInputAdapterGroups) {
    const contractGroup = lateContractsById.get(adapter.adapterId);
    if (!contractGroup
      || !isDeepStrictEqual(new Set(contractGroup.methodSettingIds), adapter.methodSettingIds)) {
      throw new Error(`${adapter.adapterId}: late source-completeness contract identity set is incomplete`);
    }
    for (const id of adapter.methodSettingIds) {
      const fixture = lateFixturesBySetting.get(id);
      const row = lateExecutedBySetting.get(id);
      const privateRow = latePrivateBySetting.get(id);
      const { verification_status: privateVerificationStatus, ...privateExecutedRow } = privateRow ?? {};
      const failedChecks = [
        ["schema", row?.schema_version === "chronicle-literature-input-conformance-mapping/v1"],
        ["assertions", row?.assertions_passed === true],
        ["source_work", row?.source_work_id === adapter.sourceWorkId],
        ["source_value", isDeepStrictEqual(row?.source_value, fixture?.sourceValue)],
        ["fixture_id", row?.fixture_id === fixture?.fixtureId],
        ["fixture_adapter", row?.adapter_id === fixture?.adapterId],
        ["contract_adapter", row?.adapter_id === adapter.adapterId],
        ["fixture_digest", /^sha256:[0-9a-f]{64}$/.test(row?.fixture_source_digest ?? "")],
        ["adapted_digest", /^sha256:[0-9a-f]{64}$/.test(row?.adapted_output_digest ?? "")],
        ["result_digest", /^sha256:[0-9a-f]{64}$/.test(row?.conformance_result_digest ?? "")],
        ["private_executed_mapping", isDeepStrictEqual(privateExecutedRow, row)],
        ["independent_oracle_status",
          adapter.adapterId === "chronicle.phonestudy-phone-features/v1"
            ? privateVerificationStatus
              === "executed_fixture_passed; independent_R_oracle_passed_13_of_13_570_of_570_zero_semantic_mismatches"
            : adapter.adapterId === "chronicle.schoedel-screen-preprocessing/v1"
              ? privateVerificationStatus
                === `executed_fixture_passed; independent_R_oracle_passed_24_of_24_800_of_800_zero_semantic_mismatches; oracle_manifest_sha256:${schoedelOracleManifestSha256}`
              : true],
      ].filter(([, passed]) => !passed).map(([name]) => name);
      if (failedChecks.length) {
        throw new Error(`${id}: late source-completeness adapter proof failed at ${failedChecks.join(", ")}`);
      }
      lateBySetting.set(id, { mapping: row, contract: contractGroup });
    }
  }
  const blockedBySetting = new Map();
  for (const correction of manifest.route_corrections) {
    if (!nativeRouteAudits.bySetting.has(correction.method_setting_id)
      || !missingInputAudit.bySetting.has(correction.method_setting_id)
      || typeof correction.disposition !== "string" || !correction.disposition.startsWith("blocked_")
      || typeof correction.reason !== "string" || !correction.reason) {
      throw new Error(`${correction.method_setting_id}: malformed input-adapter route correction`);
    }
    blockedBySetting.set(correction.method_setting_id, correction);
  }
  if (blockedBySetting.size !== manifest.route_correction_not_implemented_count) {
    throw new Error("input-adapter route corrections contain duplicate identities");
  }
  const postAuditBySetting = new Map([...deferredPostAuditBySetting, ...allExecutedRows
    .map((row) => {
      const group = contractBySetting.get(row.method_setting_id);
      return [row.method_setting_id, {
        mapping: row,
        contract: group,
        fixture: allFixturesBySetting.get(row.method_setting_id),
        sourceMethodVariantId: fixtureManifest.sourceMethodVariants?.[row.method_setting_id],
        sourceSchemaEvidenceVerified: sourceSchemaEvidenceVerified(group, row.method_setting_id),
      }];
    })]);
  return {
    bySetting,
    lateBySetting,
    blockedBySetting,
    postAuditBySetting,
    summary: {
      promoted_settings: bySetting.size,
      late_promoted_settings: latePrivateRows.length,
      post_audit_candidate_settings: postAuditBySetting.size,
      total_executed_mapping_settings: allExecutedRows.length,
      adapter_groups: contract.groups.length,
      blocked_false_promotions: manifest.route_correction_not_implemented_count,
      exact_identity_coverage: true,
      source_specific_executed_fixtures: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadSourceEvidenceRepairs(nativeRouteAudits) {
  requirePrivate(sourceEvidenceRepairDirectory, 0o700);
  requirePrivate(sourceEvidenceRepairOverlayPath, 0o600);
  requirePrivate(sourceEvidenceRepairValidationPath, 0o600);
  const validation = JSON.parse(readFileSync(sourceEvidenceRepairValidationPath, "utf8"));
  const expectedIds = new Set([...nativeRouteAudits.bySetting]
    .filter(([, audit]) => audit.classification === "source_evidence_blocked")
    .map(([id]) => id));
  const rows = jsonl(sourceEvidenceRepairOverlayPath);
  if (validation.passed !== true
    || validation.method_setting_identity_exact !== true
    || validation.source_extraction_identity_exact !== true
    || validation.source_work_identity_exact !== true
    || validation.source_locators_preserved !== true
    || validation.source_value_preserved !== true
    || validation.overlay_independently_replays_adjudicated_records !== true
    || validation.overlay_independently_replays_atomic_records !== true
    || validation.overlay_count !== expectedIds.size
    || new Set(rows.map((row) => row.method_setting_id)).size !== rows.length
    || rows.length !== expectedIds.size
    || rows.some((row) => !expectedIds.has(row.method_setting_id))) {
    throw new Error("source-evidence repair validation or exact identity coverage failed");
  }
  const bySetting = new Map();
  for (const row of rows) {
    const id = requireString(row.method_setting_id, "method_setting_id", "source-evidence repair");
    if (row.schema_version !== "chronicle-source-evidence-repair-overlay/v1"
      || !["documentary_receipt", "executable_clause_recovered", "genuine_evidence_gap"].includes(row.repair_disposition)
      || !Array.isArray(row.source_locators) || !row.source_locators.length
      || !Array.isArray(row.source_clause_ids) || !row.source_clause_ids.length
      || !Array.isArray(row.required_inputs)
      || row.required_inputs.some((value) => typeof value !== "string")
      || canonicalJson(row.corrected_method_value_json, id) !== row.corrected_method_value_json) {
      throw new Error(`${id}: malformed source-evidence repair overlay`);
    }
    bySetting.set(id, row);
  }
  return {
    bySetting,
    summary: {
      repaired_settings: rows.length,
      dispositions: validation.disposition_counts,
      genuine_evidence_gaps: validation.genuine_evidence_gap_count,
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function bsnConfigurationSpace(packetRows) {
  const grouped = Map.groupBy(packetRows, (row) => row.source_configuration_group_id);
  const groups = [...grouped.entries()].map(([groupId, rows]) => {
    rows.sort((left, right) => left.source_configuration_order - right.source_configuration_order
      || left.method_setting_id.localeCompare(right.method_setting_id));
    const relation = rows[0].source_configuration_relation;
    if (rows.some((row) => row.source_configuration_relation !== relation)) {
      throw new Error(`${groupId}: BSN source-configuration relation drift`);
    }
    const documentaryIds = rows.filter((row) => row.implementation_readiness === "documentary_receipt")
      .map((row) => row.method_setting_id);
    const unresolvedIds = rows.filter((row) => row.blocker_ids.length).map((row) => row.method_setting_id);
    const sourceLocators = unique(rows.flatMap((row) => row.source_locators));
    const levels = relation === "ALTERNATIVE"
      ? rows.map((row) => ({
        method_configuration_level_id: `${groupId}:${row.method_setting_id}`,
        method_configuration_level_label: `${row.method_parameter_key} = ${row.method_value_json}`,
        included_method_setting_ids: [row.method_setting_id],
        excluded_method_setting_ids: rows.filter((other) => other !== row).map((other) => other.method_setting_id),
        common_method_setting_ids: [],
        branch_method_setting_ids: [row.method_setting_id],
        documentary_method_setting_ids: row.implementation_readiness === "documentary_receipt" ? [row.method_setting_id] : [],
        unresolved_method_setting_ids: row.blocker_ids.length ? [row.method_setting_id] : [],
        source_locators: row.source_locators,
      }))
      : [{
        method_configuration_level_id: `${groupId}:${relation.toLowerCase()}`,
        method_configuration_level_label: relation === "CONDITIONAL"
          ? "source-declared conditional control"
          : "fixed deployed configuration",
        included_method_setting_ids: rows.filter((row) => row.implementation_readiness !== "documentary_receipt")
          .map((row) => row.method_setting_id),
        excluded_method_setting_ids: [],
        common_method_setting_ids: rows.filter((row) => row.implementation_readiness !== "documentary_receipt")
          .map((row) => row.method_setting_id),
        branch_method_setting_ids: [],
        documentary_method_setting_ids: documentaryIds,
        unresolved_method_setting_ids: unresolvedIds,
        source_locators: sourceLocators,
      }];
    return {
      method_configuration_group_id: groupId,
      method_configuration_group_kind: relation === "ALTERNATIVE" ? "source_declared_alternative"
        : relation === "CONDITIONAL" ? "conditional_control"
          : relation === "SET_MEMBERSHIP" ? "fixed_set_membership" : "fixed_joint_specification",
      method_configuration_axis: relation === "ALTERNATIVE" ? ["location_signal_source"] : [],
      method_selection_semantics: relation === "ALTERNATIVE" ? "choose_exactly_one_source_declared_level"
        : relation === "CONDITIONAL" ? "condition_driven_not_user_invented" : "jointly_applied",
      method_cross_product_policy: "not_enumerated_no_cartesian_product",
      method_configuration_levels: levels,
      documentary_method_setting_ids: documentaryIds,
      unresolved_method_setting_ids: unresolvedIds,
      source_locators: sourceLocators,
    };
  }).sort((left, right) => left.method_configuration_group_id.localeCompare(right.method_configuration_group_id));
  const documentaryIds = packetRows.filter((row) => row.implementation_readiness === "documentary_receipt")
    .map((row) => row.method_setting_id).sort();
  const unresolvedIds = packetRows.filter((row) => row.blocker_ids.length)
    .map((row) => row.method_setting_id).sort();
  return {
    method_configuration_space_id: "moodminer_deployed_fixed_configuration",
    method_configuration_structure: "source_declared_axes",
    invariant_method_setting_ids: [],
    method_configuration_groups: groups,
    allowed_method_combinations: [],
    documentary_method_setting_ids: documentaryIds,
    not_applicable_method_setting_ids: [],
    unresolved_method_setting_ids: unresolvedIds,
    source_locators: unique(packetRows.flatMap((row) => row.source_locators)),
  };
}

function applyBsnRepairOverlay(assertions, profiles, spaces, ontology) {
  requirePrivate(bsnRepairDirectory, 0o700);
  for (const path of [bsnRepairOverlayPath, bsnRepairValidationPath, bsnRepairManifestPath, bsnRepairManifestDigestPath]) {
    requirePrivate(path, 0o600);
  }
  const packetValidation = spawnSync(process.execPath, [bsnRepairValidatorPath], {
    cwd: bsnRepairDirectory,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (packetValidation.status !== 0) {
    throw new Error(`BSN repair packet validation failed:\n${packetValidation.stdout}\n${packetValidation.stderr}`);
  }
  const manifest = JSON.parse(readFileSync(bsnRepairManifestPath, "utf8"));
  const validation = JSON.parse(readFileSync(bsnRepairValidationPath, "utf8"));
  if (readFileSync(bsnRepairManifestDigestPath, "utf8")
      !== `${sha256(bsnRepairManifestPath).slice(7)}  manifest.json\n`
    || validation.passed !== true
    || validation.canonical_writes !== 0
    || validation.whole_variant_runnable !== false) {
    throw new Error("BSN repair manifest or fail-closed validation drift");
  }
  for (const file of manifest.declared_files) {
    const path = resolve(bsnRepairDirectory, file.path);
    if (!existsSync(path)
      || sha256(path).slice(7) !== file.sha256
      || statSync(path).size !== file.bytes
      || (statSync(path).mode & 0o777) !== 0o600) {
      throw new Error(`BSN repair declared-file drift: ${file.path}`);
    }
  }
  const packetRows = jsonl(bsnRepairOverlayPath);
  const oldTuple = {
    source_work_id: "doi:10.1109/bsn.2012.3",
    source_extraction_id: "extraction-677fb942a6913c051750",
    method_setting_id: "method-setting-2ec80b5027cfbfd24132e39b",
  };
  const replacement = packetRows.filter((row) => row.overlay_action === "replace_atomic_setting");
  const additions = packetRows.filter((row) => row.overlay_action === "add_atomic_setting");
  const oldRows = assertions.filter((row) => row.source_work_id === oldTuple.source_work_id);
  if (packetRows.length !== 80 || additions.length !== 79 || replacement.length !== 1
    || new Set(packetRows.map((row) => row.method_setting_id)).size !== 80
    || oldRows.length !== 1
    || oldRows[0].source_extraction_id !== oldTuple.source_extraction_id
    || oldRows[0].method_setting_id !== oldTuple.method_setting_id
    || !isDeepStrictEqual(replacement[0].replacement_target, oldTuple)
    || replacement[0].tombstone_metadata?.replacement_method_setting_id !== replacement[0].method_setting_id) {
    throw new Error("BSN repair replay identity or 79+1 partition drift");
  }
  const allowedSlots = new Set(ontology.classes.MethodSettingAssertion.slots);
  const projected = packetRows.map((row) => normalizeAtomicSetting({
    ...row,
    contract_bindings: [],
    mapped_contract_slot: [],
    integration_source: "bsn_profile_repair_overlay_v2",
    adjudication_confidence: 1,
    adjudication_rationale: "Independently validated BSN source repair; execution remains fail-closed until the exact route, GUI, receipt, and source-derived conformance gate pass.",
  }, allowedSlots)).sort((left, right) => left.method_setting_id.localeCompare(right.method_setting_id));
  if (projected.some((row) => row.method_implementation_status !== "specification_only"
    || row.executor_id || row.conformance_fixture_id || row.conformance_result_digest
    || row.contract_bindings.length || row.mapped_contract_slot.length)) {
    throw new Error("BSN repair attempted to claim execution");
  }
  const repairedAssertions = assertions.filter((row) => row.method_setting_id !== oldTuple.method_setting_id)
    .concat(projected)
    .sort((left, right) => left.source_work_id.localeCompare(right.source_work_id)
      || left.method_setting_id.localeCompare(right.method_setting_id));
  if (new Set(repairedAssertions.map((row) => row.method_setting_id)).size !== repairedAssertions.length) {
    throw new Error("BSN repair introduced a duplicate method-setting identity");
  }
  const settingIds = projected.map((row) => row.method_setting_id);
  const configurationSpace = bsnConfigurationSpace(packetRows);
  const repairedProfiles = profiles.map((profile) => profile.source_work_id === oldTuple.source_work_id ? {
    ...profile,
    source_method_variant_id: "moodminer_deployed_fixed_configuration",
    source_method_variant_label: "MoodMiner deployed fixed configuration (GPS or Wi-Fi)",
    method_configuration_structure: "source_declared_axes",
    method_configuration_space: configurationSpace,
    method_profile_version: "literature-sublation-v3-atomic+bsn-repair-v2",
    method_setting_ids: settingIds,
    method_setting_count: settingIds.length,
    profile_implementation_status: "blocked",
    source_locators: configurationSpace.source_locators,
  } : profile);
  const repairedSpaces = spaces.map((space) => space.source_work_id === oldTuple.source_work_id ? {
    ...space,
    source_configuration_space_id: "moodminer_deployed_fixed_configuration",
    space_kind: "selectable_axis_or_campaign",
    space_facets: { ...space.space_facets, has_selectable_axis_or_campaign: true },
    all_method_setting_ids: settingIds,
    source_locators: configurationSpace.source_locators,
  } : space);
  const aliases = replacement[0].superseded_alias_metadata;
  return {
    assertions: repairedAssertions,
    profiles: repairedProfiles,
    spaces: repairedSpaces,
    aliases,
    tombstones: [replacement[0].tombstone_metadata],
    summary: {
      replayed_settings: 80,
      additions: 79,
      replacements: 1,
      source_method_variants: 1,
      configuration_groups: configurationSpace.method_configuration_groups.length,
      configuration_levels: configurationSpace.method_configuration_groups
        .reduce((count, group) => count + group.method_configuration_levels.length, 0),
      source_evidence_blocked_settings: packetRows.filter((row) => row.blocker_ids.length).length,
      source_exact_no_semantic_blocker_settings: packetRows.filter((row) => !row.blocker_ids.length).length,
      documentary_settings: packetRows.filter((row) => row.implementation_readiness === "documentary_receipt").length,
      alternative_settings: packetRows.filter((row) => row.source_configuration_relation === "ALTERNATIVE").length,
      conditional_settings: packetRows.filter((row) => row.source_configuration_relation === "CONDITIONAL").length,
      old_method_setting_id: oldTuple.method_setting_id,
      replacement_method_setting_id: replacement[0].method_setting_id,
      all_specification_only: true,
      profile_blocked: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function applyHammerSourceCompletenessAudit(assertions, profiles, spaces, ontology) {
  const sourceWorkId = "doi:10.1145/2634317.2634325";
  requirePrivate(sourceCompletenessAuditDirectory, 0o700);
  requirePrivate(hammerSourceCompletenessAuditPath, 0o600);
  const auditValidation = spawnSync(process.execPath, [sourceCompletenessAuditValidatorPath], {
    cwd: repo,
    encoding: "utf8",
  });
  if (auditValidation.status !== 0) {
    throw new Error(`source-completeness audit validation failed:\n${auditValidation.stdout}\n${auditValidation.stderr}`);
  }
  const validation = JSON.parse(auditValidation.stdout);
  const audit = JSON.parse(readFileSync(hammerSourceCompletenessAuditPath, "utf8"));
  if (!validation.passed_current_records
    || !validation.audited_source_work_ids.includes(sourceWorkId)
    || audit.schema_version !== "chronicle-source-completeness-audit/v1"
    || audit.source_work_id !== sourceWorkId
    || audit.completion_verdict !== "hard_no"
    || audit.disclosed_atoms.length !== 66
    || audit.source_configuration_repairs.length !== 5) {
    throw new Error("Hammer source-completeness audit identity or inventory drift");
  }
  for (const artifact of audit.source_artifacts) {
    const path = resolve(repo, artifact.path);
    if (sha256(path).slice(7) !== artifact.sha256) throw new Error(`Hammer source artifact drift: ${artifact.path}`);
  }

  const textArtifact = audit.source_artifacts.find((artifact) => artifact.path.endsWith(".txt"));
  if (!textArtifact) throw new Error("Hammer audit has no source text artifact");
  const sourceTextPath = resolve(repo, textArtifact.path);
  const locators = (locator) => {
    const ranges = [...locator.matchAll(/(\d+)-(\d+)/g)];
    if (!ranges.length) throw new Error(`Hammer audit locator has no line range: ${locator}`);
    return ranges.map((match) => `${sourceTextPath}:${match[1]}-${match[2]}`);
  };
  const methodRoles = new Map([
    ["acquisition", "acquisition"],
    ["aggregation", "aggregation"],
    ["classification", "analysis"],
    ["derivation", "feature_engineering"],
    ["evidence_conflict", "provenance"],
    ["label_processing", "feature_engineering"],
    ["modeling", "analysis"],
    ["provenance", "provenance"],
    ["reconstruction", "reconstruction"],
    ["reported_result", "reporting"],
    ["segmentation", "feature_engineering"],
    ["study_protocol", "provenance"],
    ["validation", "validation"],
  ]);
  const targetLayers = new Map([
    ["binary_label", "outcome"],
    ["cohort", "study_window"],
    ["collector", "collector"],
    ["device_session", "device_session"],
    ["device_session_pair", "derived_feature"],
    ["energy_benchmark", "released_artifact"],
    ["frame_or_session", "derived_feature"],
    ["model", "model"],
    ["model_feature_set", "model"],
    ["notification", "derived_feature"],
    ["notification_pair", "derived_feature"],
    ["pipeline", "released_artifact"],
    ["raw_artifact", "acquired_snapshot"],
    ["raw_event", "raw_occurrence"],
    ["raw_label", "raw_record"],
    ["result_oracle", "released_artifact"],
    ["selected_group", "derived_feature"],
    ["session", "device_session"],
    ["source_dataset", "released_artifact"],
    ["study_window", "study_window"],
    ["training_instance", "derived_feature"],
    ["training_label", "outcome"],
  ]);
  const existingCoverage = new Map(Object.entries({
    "collector.foreground_app": ["method-setting-23440efe7a9e0cdf0d8a4a5e"],
    "session.boundary": ["method-setting-ae367bcfa8a615ce33dc5781"],
    "session.null": ["method-setting-b743a1b03254c30ec082fc96", "method-setting-09a66035185861f4fb308bab"],
    "session.app": ["method-setting-7780ec932ecfd0b5f8af2a95"],
    "feature.notification_response": ["method-setting-d50e7af4faa023f7bed48552", "method-setting-1703d5b4dfca795d3fa3b9c7"],
    "segmentation.frame_width": ["method-setting-eb95646883ae11bf7d903aaf"],
    "segmentation.overlap": ["method-setting-5a58e6df5cb44697dec3dfc2", "method-setting-5fc87d7d574c5f42a3d6f4f8"],
    "aggregation.unique_count": ["method-setting-70789f0afe781ffb0130098a"],
    "aggregation.categorical_mode": ["method-setting-08de94f2335df0107e070230"],
    "aggregation.numeric": ["method-setting-a49218925e40d5bf5e9df224", "method-setting-873d14abedfb5cbb1318bd2e", "method-setting-ee6a1044a7e6cd343fe9d51f"],
    "label.algorithm_threshold": ["method-setting-fb6aca85e2b6c1130e02147f"],
    "label.algorithm_weight": ["method-setting-4f6accf5604ed614bfa6bc2c"],
    "study.duration": ["method-setting-7e17b262110b6a49b28ff253"],
    "study.cohort": ["method-setting-9e3e7c1496857667b39d6a0f"],
    "study.volume": ["method-setting-acb80e2888981ca22d6f15aa"],
  }));
  const atomByKey = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  if ([...existingCoverage].some(([key]) => !atomByKey.has(key))) throw new Error("Hammer existing-setting coverage names an unknown atom");
  const canonicalRole = (atom) => atom.canonical_role ?? (atom.key === "study.duration" ? "acquisition"
    : atom.key === "result.inference_arms" ? "analysis"
      : methodRoles.get(atom.role) ?? (() => { throw new Error(`unmapped Hammer role: ${atom.role}`); })());
  const canonicalTarget = (atom) => atom.canonical_target
    ?? (["result.inference_arms", "result.energy_devices"].includes(atom.key) ? "model"
      : targetLayers.get(atom.target) ?? (() => { throw new Error(`unmapped Hammer target: ${atom.target}`); })());
  const valueKind = (value) => Array.isArray(value) ? "list"
    : value === null ? "unspecified"
      : Number.isInteger(value) ? "integer"
        : typeof value === "number" ? "float"
          : typeof value === "object" ? "object" : typeof value;
  const executionRoute = (role) => role === "acquisition" ? "protocol_input"
    : ["provenance", "reporting"].includes(role) ? "receipt_conformance" : "external_named_executor";
  const requiredInputs = (role, target) => role === "acquisition" ? ["source_collector_or_raw_stream"]
    : target === "released_artifact" || role === "provenance" ? ["source_method_receipt"]
      : target === "model" || target === "outcome" ? ["source_derived_feature_rows"]
        : ["source_reconstructed_rows"];
  const documentaryKeys = new Set([
    "platform.android_unmodified_unrooted", "collector.study_app", "collector.framework",
    "pipeline.execution_location", "pipeline.software", "study.cohort",
  ]);
  const runtimeOperationKeys = new Set(["study.duration", "result.inference_arms", "result.energy_devices"]);
  const executionClass = (atom, role, target) => documentaryKeys.has(atom.key) ? "documentary_fact"
    : runtimeOperationKeys.has(atom.key) ? "runtime_operation"
      : sourceCompletenessExecutionClass({ ...atom, source_work_id: sourceWorkId,
        canonical_role: role, canonical_target: target });
  const evidenceFields = (classification) => classification === "scientific_oracle" ? {
    required_inputs: ["source_execution_output", "source_result_oracle"],
    method_execution_route: "receipt_conformance",
    method_execution_destination_id: "chronicle.reported-result-oracle-evidence@comparison-required",
    method_execution_parameter_path: "/methodProfileReadiness/evidence",
    method_execution_blocker_code: "scientific_oracle_comparison_receipt_required",
  } : classification === "source_gap_or_conflict" ? {
    required_inputs: ["source_method_receipt"],
    method_execution_route: "receipt_conformance",
    method_execution_destination_id: "chronicle.source-evidence-gap@unresolved",
    method_execution_parameter_path: "/methodProfileReadiness/evidence",
    method_execution_blocker_code: "indispensable_source_evidence_unavailable",
  } : {};
  const settingId = (kind, ...identity) => `method-setting-${sha256Bytes(JSON.stringify([sourceWorkId, kind, ...identity])).slice(7, 31)}`;
  const extractionId = (kind, ...identity) => `extraction-${sha256Bytes(JSON.stringify([sourceWorkId, kind, ...identity])).slice(7, 31)}`;
  const sourceFields = (key, value, locator, sourceExtractionId) => {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    const observed = `${key}: ${rendered}`;
    return {
      source_extraction_id: sourceExtractionId,
      source_evidence_work_id: sourceWorkId,
      source_locators: locators(locator),
      source_clause_text: rendered,
      source_clause_path: "source_completeness_audit",
      source_clause_start: key.length + 2,
      source_clause_end: observed.length,
      source_observed_setting: observed,
      source_value_json: JSON.stringify(observed),
      source_value_sha256: sha256Bytes(observed).slice(7),
      source_coverage_status: "DECLARED",
      source_clause_ids: [`${sourceExtractionId}#source_completeness_audit[0]`],
    };
  };
  const ontologyTerms = (role) => [
    "StudyMethodProfile",
    "MethodSettingAssertion",
    role === "acquisition" ? "AcquisitionProtocol"
      : role === "reconstruction" ? "SessionConstructionPolicy"
        : role === "reporting" ? "MeasurementReleaseProfile" : "ParameterProvenanceAssertion",
  ];
  const atomRow = (atom) => {
    const role = canonicalRole(atom);
    const target = canonicalTarget(atom);
    const classification = executionClass(atom, role, target);
    const id = settingId("atom", atom.key);
    const sourceExtractionId = extractionId("atom", atom.key);
    const route = executionRoute(role);
    return {
      ...sourceFields(atom.key, atom.value, atom.locator, sourceExtractionId),
      source_work_id: sourceWorkId,
      source_component_id: `source-completeness:${atom.role}`,
      method_setting_id: id,
      method_setting_role: role,
      method_target_layer: target,
      method_parameter_key: atom.key,
      method_value_kind: valueKind(atom.value),
      method_value_json: JSON.stringify(atom.value),
      method_applicability_status: "applicable",
      method_disclosure_status: "declared",
      method_implementation_status: "specification_only",
      mapped_ontology_term: ontologyTerms(role),
      mapped_contract_slot: [],
      contract_bindings: [],
      ontology_mapping_note: `source-completeness audit atom ${atom.key}`,
      required_inputs: requiredInputs(role, target),
      integration_source: `hammer_source_completeness_audit_v1:${classification}`,
      adjudication_confidence: 1,
      adjudication_rationale: "Source-completeness audit projection; execution remains fail-closed pending a source-faithful fixture and semantic oracle.",
      method_execution_route: route,
      method_execution_destination_id: `literature.source-completeness.${role}`,
      method_execution_parameter_path: `/source-profiles/hammer/settings/${id}`,
      method_execution_blocker_code: "source_completeness_execution_pending",
      ...evidenceFields(classification),
    };
  };

  const oldRows = assertions.filter((row) => row.source_work_id === sourceWorkId);
  const oldById = new Map(oldRows.map((row) => [row.method_setting_id, row]));
  const coveredIds = new Set([...existingCoverage.values()].flat());
  if (oldRows.length !== 20 || coveredIds.size !== 20 || [...coveredIds].some((id) => !oldById.has(id))) {
    throw new Error("Hammer current 20-setting identity inventory drift");
  }
  const canonicalIdByOldId = new Map([...existingCoverage]
    .flatMap(([, ids]) => ids.map((id) => [id, ids[0]])));
  const correctedExisting = [...existingCoverage].map(([key, ids]) => {
    const atom = atomByKey.get(key);
    const row = oldById.get(ids[0]);
    const role = canonicalRole(atom);
    const target = canonicalTarget(atom);
    const classification = executionClass(atom, role, target);
    const corrected = {
      ...row,
      ...sourceFields(atom.key, atom.value, atom.locator, row.source_extraction_id),
      method_setting_role: role,
      method_target_layer: target,
      method_parameter_key: atom.key,
      method_value_kind: valueKind(atom.value),
      method_value_json: JSON.stringify(atom.value),
      mapped_ontology_term: ontologyTerms(role),
      ontology_mapping_note: `source-completeness audit correction for ${atom.key}`,
      required_inputs: requiredInputs(role, target),
      integration_source: `hammer_source_completeness_audit_v1:${classification}`,
      adjudication_confidence: 1,
      adjudication_rationale: "Corrected against the full Hammer paper audit; existing native proof is preserved only where it already establishes the exact disclosed behavior.",
    };
    if (row.method_implementation_status !== "native") Object.assign(corrected, {
      mapped_contract_slot: [],
      contract_bindings: [],
      method_execution_route: executionRoute(role),
      method_execution_destination_id: `literature.source-completeness.${role}`,
      method_execution_parameter_path: `/source-profiles/hammer/settings/${row.method_setting_id}`,
      method_execution_blocker_code: "source_completeness_execution_pending",
      ...evidenceFields(classification),
    });
    return corrected;
  });
  const aliases = [];
  const tombstones = [];
  for (const [key, ids] of existingCoverage) {
    const replacementMethodSettingId = ids[0];
    for (const id of ids.slice(1)) {
      const old = oldById.get(id);
      aliases.push({
        alias_method_setting_id: id,
        alias_source_extraction_id: old.source_extraction_id,
        alias_source_work_id: sourceWorkId,
        resolution: "superseded_by",
        replacement_method_setting_id: replacementMethodSettingId,
      });
      tombstones.push({
        method_setting_id: id,
        source_extraction_id: old.source_extraction_id,
        source_work_id: sourceWorkId,
        tombstone_status: "superseded",
        replacement_method_setting_id: replacementMethodSettingId,
        preserve_for_alias_resolution: true,
        source_completeness_atom_key: key,
      });
    }
  }
  const addedAtomRows = audit.disclosed_atoms.filter((atom) => !existingCoverage.has(atom.key)).map(atomRow);

  const configurationGroups = audit.source_configuration_repairs.map((repair) => {
    const groupId = `source-audit-group-${sha256Bytes(`${sourceWorkId}\0${repair.group}`).slice(7, 31)}`;
    const sourceLocators = locators(repair.locator);
    return {
      method_configuration_group_id: groupId,
      method_configuration_group_kind: repair.relation,
      method_configuration_axis: [repair.group],
      method_selection_semantics: "source_campaign_not_variant_no_user_selection",
      method_cross_product_policy: "source_reported_comparisons_no_cartesian_product",
      method_configuration_levels: repair.levels.map((level) => ({
        method_configuration_level_id: `source-audit-level-${sha256Bytes(`${sourceWorkId}\0${repair.group}\0${level}`).slice(7, 31)}`,
        method_configuration_level_label: String(level),
        included_method_setting_ids: [],
        excluded_method_setting_ids: [],
        common_method_setting_ids: [],
        branch_method_setting_ids: [],
        documentary_method_setting_ids: [],
        unresolved_method_setting_ids: [],
        source_locators: sourceLocators,
      })),
      documentary_method_setting_ids: [],
      unresolved_method_setting_ids: [],
      source_locators: sourceLocators,
    };
  });

  const allowedSlots = new Set(ontology.classes.MethodSettingAssertion.slots);
  const newRows = addedAtomRows.map((row) => normalizeAtomicSetting(row, allowedSlots));
  const targetRows = [...correctedExisting, ...newRows].sort((left, right) => left.method_setting_id.localeCompare(right.method_setting_id));
  const targetIds = new Set(targetRows.map((row) => row.method_setting_id));
  const expectedTargetRowCount = audit.disclosed_atoms.length;
  if (targetIds.size !== targetRows.length || targetRows.length !== expectedTargetRowCount) {
    throw new Error("Hammer repaired setting inventory drift");
  }
  const atomCoverage = new Map([...existingCoverage].map(([key, ids]) => [key, [ids[0]]]));
  for (const row of addedAtomRows) atomCoverage.set(row.method_parameter_key, [row.method_setting_id]);
  if (atomCoverage.size !== audit.disclosed_atoms.length
    || audit.disclosed_atoms.some((atom) => !atomCoverage.has(atom.key))) {
    throw new Error("Hammer disclosed-atom coverage is incomplete");
  }
  const evidenceRows = targetRows.filter((row) => ["scientific_oracle", "documentary_fact", "source_gap_or_conflict"]
    .some((classification) => row.integration_source?.endsWith(`:${classification}`)));
  const evidenceIds = new Set(evidenceRows.map((row) => row.method_setting_id));
  const energyDeviceRow = targetRows.find((row) => row.method_parameter_key === "result.energy_devices");
  if (!energyDeviceRow) throw new Error("Hammer energy-validation setup is missing");
  const invariantIds = targetRows.filter((row) => !evidenceIds.has(row.method_setting_id)
    && row.method_setting_id !== energyDeviceRow.method_setting_id)
    .map((row) => row.method_setting_id);
  const unresolvedInvariantIds = targetRows.filter((row) => invariantIds.includes(row.method_setting_id)
    && row.method_implementation_status !== "native")
    .map((row) => row.method_setting_id);
  const sourceLocators = unique(targetRows.flatMap((row) => row.source_locators));
  const evidenceGroup = evidenceRows.length ? [{
    method_configuration_group_id: `source-audit-evidence-group-${sha256Bytes(sourceWorkId).slice(7, 31)}`,
    method_configuration_group_kind: "source_evidence_not_method_decision",
    method_configuration_axis: ["source_evidence"],
    method_selection_semantics: "source_evidence_no_user_selection",
    method_cross_product_policy: "no_inferred_executable_method_decision",
    method_configuration_levels: [{
      method_configuration_level_id: `source-audit-evidence-level-${sha256Bytes(sourceWorkId).slice(7, 31)}`,
      method_configuration_level_label: "Source evidence and reported results",
      included_method_setting_ids: [],
      excluded_method_setting_ids: [],
      common_method_setting_ids: [],
      branch_method_setting_ids: [],
      documentary_method_setting_ids: [],
      unresolved_method_setting_ids: [],
      source_locators: unique(evidenceRows.flatMap((row) => row.source_locators)),
    }],
    documentary_method_setting_ids: evidenceRows.filter((row) =>
      !row.integration_source?.endsWith(":source_gap_or_conflict")).map((row) => row.method_setting_id),
    unresolved_method_setting_ids: evidenceRows.filter((row) =>
      row.integration_source?.endsWith(":source_gap_or_conflict")).map((row) => row.method_setting_id),
    source_locators: unique(evidenceRows.flatMap((row) => row.source_locators)),
  }] : [];
  const energyValidationGroup = [{
    method_configuration_group_id: `source-audit-energy-group-${sha256Bytes(sourceWorkId).slice(7, 31)}`,
    method_configuration_group_kind: "source_campaign_or_conditional_scope_unresolved",
    method_configuration_axis: ["energy_validation"],
    method_selection_semantics: "source_campaign_not_variant_no_user_selection",
    method_cross_product_policy: "no_inferred_campaign_variant_equivalence",
    method_configuration_levels: [{
      method_configuration_level_id: `source-audit-energy-level-${sha256Bytes(sourceWorkId).slice(7, 31)}`,
      method_configuration_level_label: "Separate screen-off energy validation",
      included_method_setting_ids: [],
      excluded_method_setting_ids: [],
      common_method_setting_ids: [],
      branch_method_setting_ids: [],
      documentary_method_setting_ids: [],
      unresolved_method_setting_ids: [],
      source_locators: energyDeviceRow.source_locators,
    }],
    documentary_method_setting_ids: [],
    unresolved_method_setting_ids: [energyDeviceRow.method_setting_id],
    source_locators: energyDeviceRow.source_locators,
  }];
  const configurationSpace = {
    method_configuration_space_id: "hammer-source-configuration-space-v1",
    method_configuration_structure: "source_declared_axes",
    invariant_method_setting_ids: invariantIds,
    method_configuration_groups: [...configurationGroups, ...evidenceGroup, ...energyValidationGroup],
    allowed_method_combinations: [],
    documentary_method_setting_ids: [],
    not_applicable_method_setting_ids: [],
    unresolved_method_setting_ids: unresolvedInvariantIds,
    source_locators: sourceLocators,
  };
  const repairedAssertions = assertions.filter((row) => row.source_work_id !== sourceWorkId)
    .concat(targetRows)
    .sort((left, right) => left.source_work_id.localeCompare(right.source_work_id)
      || left.method_setting_id.localeCompare(right.method_setting_id));
  const targetById = new Map(targetRows.map((row) => [row.method_setting_id, row]));
  const methodOperations = audit.method_operations ?? [];
  const operationIds = new Set(methodOperations.map((operation) => operation.operation_id));
  const settingKeys = new Set(targetRows.map((row) => row.method_parameter_key));
  if (!Array.isArray(methodOperations) || operationIds.size !== methodOperations.length
    || methodOperations.some((operation) => !operation.operation_id
      || (operation.configuration_dependencies ?? []).some((key) => !settingKeys.has(key))
      || (operation.depends_on ?? []).some((id) => !operationIds.has(id) || id === operation.operation_id))) {
    throw new Error(`${sourceWorkId}: source method operation references an unknown setting or operation`);
  }
  const typedSlots = [
    "acquisition_protocols", "session_construction_policies", "notification_attribution_policies",
    "duration_policies", "timestamp_policies", "parameter_provenance_assertions", "release_profiles",
  ];
  const repairedProfiles = profiles.map((profile) => {
    if (profile.source_work_id !== sourceWorkId) return profile;
    const refreshedTypedSections = Object.fromEntries(typedSlots.map((slot) => [slot,
      (profile[slot] ?? []).map((object) => ({
        ...object,
        ...(Array.isArray(object.method_settings) ? {
          method_settings: unique(object.method_settings.map((setting) =>
            canonicalIdByOldId.get(setting.method_setting_id) ?? setting.method_setting_id))
            .map((id) => targetById.get(id))
            .filter(Boolean),
        } : {}),
      })),
    ]));
    return {
      ...profile,
      ...refreshedTypedSections,
      method_operations: methodOperations,
      protocol_materialization_blockers: (profile.protocol_materialization_blockers ?? []).map((blocker) => ({
        ...blocker,
        blocked_method_setting_ids: unique((blocker.blocked_method_setting_ids ?? [])
          .map((id) => canonicalIdByOldId.get(id) ?? id)),
      })),
      source_method_variant_id: configurationSpace.method_configuration_space_id,
      source_method_variant_label: "Hammer source-declared isolated analysis campaigns",
      method_configuration_structure: "source_declared_axes",
      method_configuration_space: configurationSpace,
      method_profile_version: "literature-sublation-v3-atomic+hammer-source-complete-v1",
      method_setting_ids: targetRows.map((row) => row.method_setting_id),
      method_setting_count: targetRows.length,
      profile_implementation_status: "blocked",
      source_locators: sourceLocators,
    };
  });
  const repairedSpaces = spaces.map((space) => space.source_work_id === sourceWorkId ? {
    ...space,
    source_configuration_space_id: configurationSpace.method_configuration_space_id,
    space_kind: "selectable_axis_or_campaign",
    space_facets: {
      ...space.space_facets,
      has_fixed_configuration: false,
      has_selectable_axis_or_campaign: true,
      has_conditional_state_machine: false,
      has_unresolved_or_evidence_blocked_material: true,
    },
    all_method_setting_ids: targetRows.map((row) => row.method_setting_id),
    method_setting_count: targetRows.length,
    source_locators: sourceLocators,
  } : space);
  return { assertions: repairedAssertions, profiles: repairedProfiles, spaces: repairedSpaces, aliases, tombstones, summary: {
    audited_disclosed_atoms: audit.disclosed_atoms.length,
    covered_disclosed_atoms: atomCoverage.size,
    corrected_existing_settings: correctedExisting.length,
    superseded_aliases: aliases.length,
    added_atom_settings: addedAtomRows.length,
    added_configuration_settings: 0,
    canonical_settings: targetRows.length,
    configuration_groups: configurationGroups.length,
    configuration_levels: configurationGroups.reduce((count, group) =>
      count + group.method_configuration_levels.length, 0),
    completed_configurations: 0,
    source_evidence_fail_closed: true,
    validation_passed: true,
  } };
}

function projectAuditedSessionPolicies(audit, atomRowsByKey) {
  if (audit.session_construction_policies === undefined) return undefined;
  if (!Array.isArray(audit.session_construction_policies)) throw new Error(`${audit.source_work_id}: session policies must be an array`);
  const ids = new Set();
  return audit.session_construction_policies.map((descriptor) => {
    const fields = ["session_construction_policy_id", "session_input_layer", "session_output_layer", "method_setting_keys"];
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)
      || Object.keys(descriptor).some((key) => !fields.includes(key))
      || fields.slice(0, 3).some((key) => typeof descriptor[key] !== "string" || !descriptor[key].trim())
      || ids.has(descriptor.session_construction_policy_id)
      || !Array.isArray(descriptor.method_setting_keys) || !descriptor.method_setting_keys.length
      || new Set(descriptor.method_setting_keys).size !== descriptor.method_setting_keys.length) {
      throw new Error(`${audit.source_work_id}: invalid audited session policy`);
    }
    ids.add(descriptor.session_construction_policy_id);
    const members = descriptor.method_setting_keys.map((key) => {
      const rows = atomRowsByKey.get(key);
      if (typeof key !== "string" || rows?.length !== 1 || rows[0].source_work_id !== audit.source_work_id
        || (rows[0].method_setting_role === "reconstruction" && rows[0].method_target_layer !== descriptor.session_output_layer)) {
        throw new Error(`${audit.source_work_id}: invalid session policy member ${key}`);
      }
      return rows[0];
    });
    if (new Set(members.map((row) => row.method_setting_id)).size !== members.length) throw new Error(`${audit.source_work_id}: duplicate session policy member`);
    return {
      session_construction_policy_id: descriptor.session_construction_policy_id,
      session_input_layer: descriptor.session_input_layer,
      session_output_layer: descriptor.session_output_layer,
      method_settings: members,
      source_locators: unique(members.flatMap((row) => row.source_locators)),
    };
  });
}

export function applyProjectableSourceCompletenessAudits(assertions, profiles, spaces, ontology, sourceWorkIds) {
  requirePrivate(sourceCompletenessAuditDirectory, 0o700);
  const frozenWorkIds = new Set(JSON.parse(readFileSync(resolve(run, "method-profile-library.json"), "utf8"))
    .profiles.map((profile) => profile.source_work_id));
  const admissions = loadPostFreezeAdmissions(repo, frozenWorkIds)
    .filter((entry) => !sourceWorkIds || sourceWorkIds.has(entry.canonical_work_id));
  const admittedIds = new Set(admissions.map((entry) => entry.canonical_work_id));
  const excludedWorkIds = new Set([
    "doi:10.1145/2634317.2634325",
    "doi:10.1145/2789168.2790107",
    "doi:10.23728/b2share.cgf63-kme28", // linked release, not a separate paper method profile
  ]);
  const auditPaths = readdirSync(sourceCompletenessAuditDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => resolve(sourceCompletenessAuditDirectory, name))
    .concat(admissions.map((entry) => resolve(repo, entry.audit_path)));
  const audits = auditPaths.map((path) => {
      requirePrivate(path, 0o600);
      return JSON.parse(readFileSync(path, "utf8"));
    })
    .filter((audit) => (!sourceWorkIds || sourceWorkIds.has(audit.source_work_id))
      && !excludedWorkIds.has(audit.source_work_id)
      && audit.disclosed_atoms?.every((atom) => atom.canonical_role && atom.canonical_target
        && Array.isArray(atom.supersedes_method_setting_ids) && atom.implementation_disposition)
      && audit.configuration_verdicts?.length > 0
      && audit.configuration_verdicts.every((verdict) => (verdict.locator ?? verdict.source_locator)
        && verdict.atom_keys?.length > 0));
  if (admissions.some((entry) => (!sourceWorkIds || sourceWorkIds.has(entry.canonical_work_id))
    && !audits.some((audit) => audit.source_work_id === entry.canonical_work_id))) {
    throw new Error("admitted source audit is not projectable");
  }
  if (!audits.length) return {
    assertions, profiles, spaces, admissions, aliases: [], tombstones: [], summary: {
      projected_profiles: 0, audited_atoms: 0, configuration_levels: 0,
      net_added_settings: 0, configuration_structured_delta: 0, explicit_variant_delta: 0,
      validation_passed: true,
    },
  };

  const validationRun = spawnSync(process.execPath, [sourceCompletenessAuditValidatorPath], {
    cwd: repo,
    encoding: "utf8",
  });
  if (validationRun.status !== 0) {
    throw new Error(`source-completeness audit validation failed:\n${validationRun.stdout}\n${validationRun.stderr}`);
  }
  const validation = JSON.parse(validationRun.stdout);
  if (!validation.passed_current_records) throw new Error("source-completeness audits did not validate");

  const allowedSlots = new Set(ontology.classes.MethodSettingAssertion.slots);
  const settingId = (sourceWorkId, kind, ...identity) =>
    `method-setting-${sha256Bytes(JSON.stringify([sourceWorkId, kind, ...identity])).slice(7, 31)}`;
  const extractionId = (sourceWorkId, kind, ...identity) =>
    `extraction-${sha256Bytes(JSON.stringify([sourceWorkId, kind, ...identity])).slice(7, 31)}`;
  const valueKind = (value) => Array.isArray(value) ? "list"
    : value === null ? "unspecified"
      : Number.isInteger(value) ? "integer"
        : typeof value === "number" ? "float"
          : typeof value === "object" ? "object" : typeof value;
  const executionFields = (atom, sourceWorkId) => {
    const classification = sourceCompletenessExecutionClass({ ...atom, source_work_id: sourceWorkId });
    if (classification === "documentary_fact") return {
      classification,
      required_inputs: [],
      method_execution_route: "receipt_conformance",
      method_execution_destination_id: "literature.source-completeness.documentary",
      method_execution_blocker_code: "receipt_binding_unimplemented",
    };
    if (classification === "scientific_oracle") return {
      classification,
      required_inputs: ["source_execution_output", "source_result_oracle"],
      method_execution_route: "receipt_conformance",
      method_execution_destination_id: "chronicle.reported-result-oracle-evidence@comparison-required",
      method_execution_parameter_path: "/methodProfileReadiness/evidence",
      method_execution_blocker_code: "scientific_oracle_comparison_receipt_required",
    };
    if (classification === "source_gap_or_conflict") {
      const conflict = atom.role === "evidence_conflict";
      return {
        classification,
        required_inputs: ["source_method_receipt"],
        method_execution_route: "receipt_conformance",
        method_execution_destination_id: conflict
          ? "chronicle.source-execution-semantics@adjudication-required"
          : "chronicle.source-evidence-gap@unresolved",
        method_execution_parameter_path: "/methodProfileReadiness/evidence",
        method_execution_blocker_code: conflict
          ? "source_execution_semantics_unadjudicated"
          : "indispensable_source_evidence_unavailable",
      };
    }
    if (classification === "unadjudicated_execution_semantics") return {
      classification,
      required_inputs: ["source_method_receipt"],
      method_execution_route: "receipt_conformance",
      method_execution_destination_id: "chronicle.source-execution-semantics@adjudication-required",
      method_execution_parameter_path: "/methodProfileReadiness/evidence",
      method_execution_blocker_code: "source_execution_semantics_unadjudicated",
    };
    if (classification === "runtime_input") return {
      classification,
      required_inputs: ["source_collector_or_raw_stream"],
      method_execution_route: "protocol_input",
      method_execution_destination_id: `literature.source-completeness.${atom.canonical_role}`,
      method_execution_blocker_code: "source_completeness_execution_pending",
    };
    return {
      classification,
      required_inputs: atom.canonical_role === "intervention"
        ? ["source_intervention_context_and_state"] : ["model", "outcome"].includes(atom.canonical_target)
        ? ["source_derived_feature_rows"] : ["source_reconstructed_rows"],
      method_execution_route: "external_named_executor",
      method_execution_destination_id: `literature.source-completeness.${atom.canonical_role}`,
      method_execution_blocker_code: "source_completeness_execution_pending",
    };
  };
  const ontologyTerms = (role) => [
    "StudyMethodProfile",
    "MethodSettingAssertion",
    ...(role === "intervention" ? [] : [role === "acquisition" ? "AcquisitionProtocol"
      : role === "reconstruction" ? "SessionConstructionPolicy"
        : role === "reporting" ? "MeasurementReleaseProfile" : "ParameterProvenanceAssertion"]),
  ];
  const auditLocators = (audit, locator) => {
    const normalizedLocator = locator.toLowerCase();
    const genericArtifactTokens = new Set(["artifact", "fulltext", "primary", "source", "supplement"]);
    const exact = audit.source_artifacts.filter((artifact) =>
      locator.includes(artifact.path) || new RegExp(`(^|[^\\w.-])${artifact.path.split("/").at(-1)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\w.-])`).test(locator));
    const matched = exact.length ? exact : audit.source_artifacts.filter((artifact) => {
      const basename = artifact.path.split("/").at(-1);
      const distinctiveTokens = basename.toLowerCase().replace(/\.(pdf|txt|zip|html|xml|docx|jsonl?|rds)$/, "")
        .split("-").filter((token) => token.length >= 5 && !genericArtifactTokens.has(token));
      return distinctiveTokens.some((token) => normalizedLocator.includes(token));
    });
    if (!matched.length) throw new Error(`${audit.source_work_id}: locator does not name a pinned source artifact: ${locator}`);
    return matched.map((artifact) => `${resolve(repo, artifact.path)}#audit-locator=${encodeURIComponent(locator)}`);
  };
  const sourceFields = (audit, atom, sourceExtractionId) => {
    const { key, value, locator } = atom;
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    const observed = `${key}: ${rendered}`;
    return {
      source_extraction_id: sourceExtractionId,
      source_evidence_work_id: atom.source_evidence_work_id ?? audit.source_work_id,
      source_locators: auditLocators(audit, locator),
      source_clause_text: rendered,
      source_clause_path: "source_completeness_audit",
      source_clause_start: key.length + 2,
      source_clause_end: observed.length,
      source_observed_setting: observed,
      source_value_json: JSON.stringify(observed),
      source_value_sha256: sha256Bytes(observed).slice(7),
      source_coverage_status: atom.source_coverage_status ?? "DECLARED",
      source_clause_ids: [`${sourceExtractionId}#source_completeness_audit[0]`],
    };
  };

  let repairedAssertions = assertions;
  let repairedProfiles = profiles;
  let repairedSpaces = spaces;
  let auditedAtoms = 0;
  let configurationLevels = 0;
  let netAddedSettings = 0;
  let configurationStructuredDelta = 0;
  const aliases = [];
  const tombstones = [];
  let projectedMethodSettings = 0;
  let projectedConfigurationMetadata = 0;
  const executionClassCounts = new Map();

  for (const audit of audits) {
    const sourceWorkId = audit.source_work_id;
    if (admittedIds.has(sourceWorkId)) {
      if (repairedProfiles.some((profile) => profile.source_work_id === sourceWorkId)
        || repairedSpaces.some((space) => space.source_work_id === sourceWorkId)
        || repairedAssertions.some((setting) => setting.source_work_id === sourceWorkId)) {
        throw new Error(`${sourceWorkId}: post-freeze identity already exists before admission`);
      }
      repairedProfiles = [...repairedProfiles, {
        method_profile_id: `method-profile:${sourceWorkId}`,
        source_work_id: sourceWorkId,
        source_method_variant_id: "whole_source",
        method_configuration_structure: "fixed",
        method_profile_version: "literature-sublation-v3-atomic+source-complete-v1",
        method_setting_ids: [], method_setting_count: 0,
        profile_implementation_status: "blocked", source_locators: [],
      }];
      repairedSpaces = [...repairedSpaces, { source_work_id: sourceWorkId, space_facets: {} }];
    }
    for (const artifact of audit.source_artifacts) {
      const path = resolve(repo, artifact.path);
      if (!existsSync(path) || sha256(path).slice(7) !== artifact.sha256) {
        throw new Error(`${sourceWorkId}: source artifact drift: ${artifact.path}`);
      }
    }
    const oldRows = repairedAssertions.filter((row) => row.source_work_id === sourceWorkId);
    const oldById = new Map(oldRows.map((row) => [row.method_setting_id, row]));
    const currentIdsByAtom = new Map(audit.disclosed_atoms.map((atom) => {
      const projectedIds = atom.projected_method_setting_ids
        ?? (atom.projected_method_setting_id ? [atom.projected_method_setting_id] : []);
      const currentIds = unique([...projectedIds, ...atom.supersedes_method_setting_ids,
        ...(sourceWorkIds ? [settingId(sourceWorkId, "source-completeness-atom", atom.key)] : [])])
        .filter((id) => oldById.has(id));
      return [atom.key, currentIds];
    }));
    const coveredCurrentIds = [...currentIdsByAtom.values()].flat();
    const retracted = audit.retracted_legacy_settings ?? [];
    const retractedIds = retracted.map((row) => row.method_setting_id);
    if (new Set([...coveredCurrentIds, ...retractedIds]).size !== oldRows.length
      || coveredCurrentIds.length + retractedIds.length !== oldRows.length
      || [...coveredCurrentIds, ...retractedIds].some((id) => !oldById.has(id))) {
      throw new Error(`${sourceWorkId}: source audit does not supersede the exact current setting inventory`);
    }

    for (const retired of retracted) {
      const old = oldById.get(retired.method_setting_id);
      if (old.source_extraction_id !== retired.source_extraction_id) {
        throw new Error(`${sourceWorkId}: retracted setting extraction identity changed`);
      }
      tombstones.push({
        method_setting_id: retired.method_setting_id,
        source_extraction_id: old.source_extraction_id,
        source_work_id: sourceWorkId,
        tombstone_status: "retracted_unsupported_legacy_extraction",
        preserve_for_alias_resolution: false,
        reason: retired.reason,
        corrected_source_atom_keys: retired.corrected_source_atom_keys,
      });
    }

    const atomRowsByKey = new Map();
    const metadataLevelIdByKey = new Map();
    for (const atom of audit.disclosed_atoms) {
      const currentIds = currentIdsByAtom.get(atom.key);
      if (atom.projection_disposition === "configuration_metadata") {
        const levelId = `source-audit-metadata-level-${sha256Bytes(`${sourceWorkId}\0${atom.key}`).slice(7, 31)}`;
        metadataLevelIdByKey.set(atom.key, levelId);
        atomRowsByKey.set(atom.key, []);
        projectedConfigurationMetadata += 1;
        for (const id of currentIds) {
          const old = oldById.get(id);
          aliases.push({
            alias_method_setting_id: id,
            alias_source_extraction_id: old.source_extraction_id,
            alias_source_work_id: sourceWorkId,
            resolution: "reclassified_as_configuration_metadata",
            replacement_method_configuration_level_id: levelId,
          });
          tombstones.push({
            method_setting_id: id,
            source_extraction_id: old.source_extraction_id,
            source_work_id: sourceWorkId,
            tombstone_status: "reclassified_as_configuration_metadata",
            replacement_method_configuration_level_id: levelId,
            preserve_for_alias_resolution: true,
            source_completeness_atom_key: atom.key,
          });
        }
        continue;
      }
      const projectedIds = unique(atom.projected_method_setting_ids
        ?? (atom.projected_method_setting_id ? [atom.projected_method_setting_id] : []));
      const canonicalId = atom.projected_method_setting_id
        ?? (projectedIds.length === 1 ? projectedIds[0]
          : projectedIds.length > 1 ? settingId(sourceWorkId, "source-completeness-atom", atom.key)
            : currentIds.length === 1 ? currentIds[0]
              : settingId(sourceWorkId, "source-completeness-atom", atom.key));
      const canonicalOld = oldById.get(canonicalId);
      const execution = executionFields(atom, sourceWorkId);
      executionClassCounts.set(execution.classification,
        (executionClassCounts.get(execution.classification) ?? 0) + 1);
      let row;
      if (atom.implementation_disposition === "retain_current_exact") {
        if (!canonicalOld || currentIds.length !== 1 || currentIds[0] !== canonicalId) {
          throw new Error(`${sourceWorkId}: ${atom.key} must name exactly one retained current setting`);
        }
        if (atom.project_source_semantics && (canonicalOld.method_implementation_status !== "native"
          || canonicalOld.method_execution_route !== "native_option_binding")) {
          throw new Error(`${sourceWorkId}: ${atom.key} cannot retain a non-native execution binding`);
        }
        row = atom.project_source_semantics ? normalizeAtomicSetting({
          ...canonicalOld,
          method_setting_role: atom.canonical_role,
          method_target_layer: atom.canonical_target,
          method_parameter_key: atom.key,
          method_value_kind: valueKind(atom.value),
          method_value_json: JSON.stringify(atom.value),
        }, allowedSlots) : canonicalOld;
      } else {
        const sourceExtractionId = canonicalOld?.source_extraction_id
          ?? currentIds.map((id) => oldById.get(id)?.source_extraction_id).find(Boolean)
          ?? extractionId(sourceWorkId, "source-completeness-atom", atom.key);
        row = normalizeAtomicSetting({
          ...sourceFields(audit, atom, sourceExtractionId),
          source_work_id: sourceWorkId,
          source_component_id: `source-completeness:${atom.canonical_role}`,
          method_setting_id: canonicalId,
          method_setting_role: atom.canonical_role,
          method_target_layer: atom.canonical_target,
          method_parameter_key: atom.key,
          method_value_kind: valueKind(atom.value),
          method_value_json: JSON.stringify(atom.value),
          method_unit: atom.method_unit,
          method_comparator: atom.method_comparator,
          method_boundary_convention: atom.method_boundary_convention,
          method_applicability_status: atom.method_applicability_status ?? "applicable",
          method_disclosure_status: atom.method_disclosure_status ?? "declared",
          method_implementation_status: "specification_only",
          mapped_ontology_term: atom.mapped_ontology_term ?? ontologyTerms(atom.canonical_role),
          mapped_contract_slot: [],
          contract_bindings: [],
          ontology_mapping_note: `source-completeness audit atom ${atom.key}`,
          required_inputs: execution.required_inputs,
          integration_source: `projectable_source_completeness_audit_v1:${execution.classification}`,
          adjudication_confidence: 1,
          adjudication_rationale: atom.implementation_disposition_reason
            ?? "Source-completeness audit projection; execution remains fail-closed pending a source-faithful fixture and semantic oracle.",
          method_execution_route: execution.method_execution_route,
          method_execution_destination_id: execution.method_execution_destination_id,
          method_execution_parameter_path: execution.method_execution_parameter_path
            ?? `/source-profiles/${sha256Bytes(sourceWorkId).slice(7, 19)}/settings/${canonicalId}`,
          method_execution_blocker_code: execution.method_execution_blocker_code,
        }, allowedSlots);
      }
      atomRowsByKey.set(atom.key, [row]);
      projectedMethodSettings += 1;
      for (const id of currentIds.filter((id) => id !== canonicalId)) {
        const old = oldById.get(id);
        aliases.push({
          alias_method_setting_id: id,
          alias_source_extraction_id: old.source_extraction_id,
          alias_source_work_id: sourceWorkId,
          resolution: "superseded_by",
          replacement_method_setting_id: canonicalId,
        });
        tombstones.push({
          method_setting_id: id,
          source_extraction_id: old.source_extraction_id,
          source_work_id: sourceWorkId,
          tombstone_status: "superseded",
          replacement_method_setting_id: canonicalId,
          preserve_for_alias_resolution: true,
          source_completeness_atom_key: atom.key,
        });
      }
    }
    const atomRows = [...atomRowsByKey.values()].flat();
    const groupId = `source-audit-group-${sha256Bytes(`${sourceWorkId}\0execution-unit`).slice(7, 31)}`;
    // Only source-declared alternatives are choices. Pipeline stages, campaign
    // jobs, result rows, and evidence remain in the audit topology.
    const targetRows = atomRows.sort((left, right) =>
      left.method_setting_id.localeCompare(right.method_setting_id));
    if (new Set(targetRows.map((row) => row.method_setting_id)).size !== targetRows.length) {
      throw new Error(`${sourceWorkId}: projected setting IDs are not unique`);
    }
    const selectableVerdicts = selectableConfigurationVerdicts(audit.configuration_verdicts);
    const synthesisCatalog = audit.configuration_topology?.kind === "cross_study_synthesis_catalog";
    if (synthesisCatalog && selectableVerdicts.length) {
      throw new Error(`${sourceWorkId}: a cross-study synthesis catalog cannot define user-selectable method arms`);
    }
    const selectableAtomKeys = new Set(selectableVerdicts.flatMap((verdict) => verdict.atom_keys));
    const unitKindsByAtomKey = new Map();
    for (const verdict of audit.configuration_verdicts) {
      for (const key of verdict.atom_keys) {
        if (!unitKindsByAtomKey.has(key)) unitKindsByAtomKey.set(key, new Set());
        unitKindsByAtomKey.get(key).add(verdict.configuration_unit_kind);
      }
    }
    const evidenceAtoms = audit.disclosed_atoms.filter((atom) => {
      if (atom.projection_disposition === "configuration_metadata") return false;
      if (synthesisCatalog) return true;
      const classification = sourceCompletenessExecutionClass({ ...atom, source_work_id: sourceWorkId });
      if (["runtime_input", "runtime_operation"].includes(classification)) return false;
      const kinds = unitKindsByAtomKey.get(atom.key) ?? new Set();
      return ["scientific_oracle", "documentary_fact", "source_gap_or_conflict"].includes(classification)
        || (atom.canonical_role === "provenance" && atom.canonical_target === "released_artifact")
        || (kinds.has("output_result_oracle_row") && atom.canonical_role === "reporting")
        || (kinds.has("evidence_only_unavailable") && ["provenance", "reporting"].includes(atom.canonical_role))
        || (["reported_result", "evidence_gap", "evidence_conflict"].includes(atom.role)
          && ["provenance", "reporting"].includes(atom.canonical_role));
    });
    const evidenceIds = new Set(evidenceAtoms.flatMap((atom) =>
      atomRowsByKey.get(atom.key).map((row) => row.method_setting_id)));
    const evidenceAtomKeys = new Set(evidenceAtoms.map((atom) => atom.key));
    const dependentAnalysisAtomKeys = new Set(audit.configuration_verdicts
      .filter((verdict) => verdict.configuration_kind === "dependent_study_analysis_unit")
      .flatMap((verdict) => verdict.atom_keys));
    const dependentAnalysisIds = new Set(audit.disclosed_atoms
      .filter((atom) => dependentAnalysisAtomKeys.has(atom.key)
        && !selectableAtomKeys.has(atom.key)
        && atom.projection_disposition !== "configuration_metadata"
        && !evidenceAtomKeys.has(atom.key))
      .flatMap((atom) => atomRowsByKey.get(atom.key).map((row) => row.method_setting_id)));
    const unresolvedEvidenceIds = new Set(evidenceAtoms
      .filter((atom) => ["evidence_gap", "evidence_conflict"].includes(atom.role)
        || sourceCompletenessExecutionClass({ ...atom, source_work_id: sourceWorkId }) === "source_gap_or_conflict")
      .flatMap((atom) => atomRowsByKey.get(atom.key).map((row) => row.method_setting_id)));
    const campaignCells = audit.configuration_verdicts
      .filter((verdict) => verdict.branch_atom_keys?.length)
      .map((verdict) => {
        const rows = verdict.branch_atom_keys.flatMap((key) => atomRowsByKey.get(key) ?? []);
        if (rows.length !== verdict.branch_atom_keys.length) {
          throw new Error(`${sourceWorkId}: campaign cell names an unknown branch atom`);
        }
        const branchRows = rows.filter((row) => !evidenceIds.has(row.method_setting_id));
        if (!branchRows.length) throw new Error(`${sourceWorkId}: campaign cell lacks method branch atoms`);
        return { verdict, branchRows, evidenceRows: rows.filter((row) => evidenceIds.has(row.method_setting_id)) };
      });
    const campaignBranchIds = new Set(campaignCells.flatMap(({ branchRows }) =>
      branchRows.map((row) => row.method_setting_id)));
    const verdictsById = new Map(audit.configuration_verdicts.map((verdict) =>
      [verdict.configuration_id, verdict]));
    const campaignTopologyCells = audit.source_configuration_repairs
      .filter((repair) => repair.relation === "nested_models_within_one_outcome_resolution_campaign")
      .map((repair) => {
        if (!repair.group || !Array.isArray(repair.levels) || !repair.levels.length
          || !Array.isArray(repair.configuration_ids) || !repair.configuration_ids.length
          || !repair.matrix_configuration_id) {
          throw new Error(`${sourceWorkId}: campaign topology lacks a source-declared matrix or model inventory`);
        }
        const verdictIds = [repair.matrix_configuration_id, ...repair.configuration_ids];
        if (new Set(verdictIds).size !== verdictIds.length) {
          throw new Error(`${sourceWorkId}: campaign topology repeats a source configuration`);
        }
        const includedIds = unique(verdictIds.flatMap((id) => {
          const verdict = verdictsById.get(id);
          if (!verdict) throw new Error(`${sourceWorkId}: campaign topology names unknown configuration ${id}`);
          return verdict.atom_keys.flatMap((key) => {
            const rows = atomRowsByKey.get(key);
            if (!rows) throw new Error(`${sourceWorkId}: campaign topology names unknown atom ${key}`);
            return rows.map((row) => row.method_setting_id).filter((settingId) => !evidenceIds.has(settingId));
          });
        }));
        if (!includedIds.length) throw new Error(`${sourceWorkId}: campaign topology has no method settings`);
        return { repair, includedIds };
      });
    const campaignTopologyCommonIds = campaignTopologyCells.length
      ? campaignTopologyCells[0].includedIds.filter((id) =>
        campaignTopologyCells.every((cell) => cell.includedIds.includes(id))) : [];
    const campaignTopologyBranchIds = new Set(campaignTopologyCells.flatMap((cell) =>
      cell.includedIds.filter((id) => !campaignTopologyCommonIds.includes(id))));
    const figure18SharedModelKeys = new Set([
      "systemcall.predecessor", "systemcall.window_estimation",
      "systemcall.window_duration", "systemcall.window_power",
    ]);
    const variantScopedAtoms = selectableVerdicts.length ? audit.disclosed_atoms.filter((atom) => {
      if (selectableAtomKeys.has(atom.key) || dependentAnalysisAtomKeys.has(atom.key)
        || atom.projection_disposition === "configuration_metadata"
        || sourceCompletenessExecutionClass({ ...atom, source_work_id: sourceWorkId }) !== "runtime_operation") return false;
      if (sourceWorkId === "doi:10.1145/2465529.2466586" && figure18SharedModelKeys.has(atom.key)) return false;
      if (sourceWorkId === "doi:10.3390/s21113765"
        && ["framework.aggregation_control", "framework.decider_modes"].includes(atom.key)) return true;
      return !(unitKindsByAtomKey.get(atom.key) ?? new Set()).has("fixed_pipeline_stage_component");
    }) : [];
    const variantScopedIds = new Set(variantScopedAtoms.flatMap((atom) =>
      atomRowsByKey.get(atom.key).map((row) => row.method_setting_id)));
    const disjunctiveKeys = new Set(audit.source_configuration_repairs
      .filter((repair) => repair.relation === "DISJUNCTION_UNRESOLVED")
      .flatMap((repair) => {
        const keys = repair.atom_keys.filter((key) => key.startsWith(`${repair.configuration_axis}.`));
        if (keys.length < 2) throw new Error(`${sourceWorkId}: unresolved disjunction has no distinct provider atoms`);
        return keys;
      }));
    const disjunctiveIds = new Set([...disjunctiveKeys].flatMap((key) =>
      (atomRowsByKey.get(key) ?? []).map((row) => row.method_setting_id)));
    if (selectableVerdicts.some((verdict) => verdict.configuration_axis)
      && selectableVerdicts.some((verdict) => !verdict.configuration_axis)) {
      throw new Error(`${sourceWorkId}: selectable configuration axes must be specified for every alternative`);
    }
    const verdictsByAxis = new Map();
    for (const verdict of selectableVerdicts) {
      const axis = verdict.configuration_axis ?? "source_configuration_alternative";
      const group = verdictsByAxis.get(axis) ?? [];
      group.push(verdict);
      verdictsByAxis.set(axis, group);
    }
    const levelRowsByAxis = [...verdictsByAxis].map(([axis, verdicts]) => {
      const levels = verdicts.map((verdict) => {
        const label = verdict.configuration ?? verdict.configuration_id
          ?? verdict.source_configuration_label ?? verdict.source_configuration_id ?? verdict.label;
        const verdictRows = verdict.atom_keys.flatMap((key) => atomRowsByKey.get(key) ?? []);
        const includedAtomRows = verdictRows.filter((row) => !evidenceIds.has(row.method_setting_id));
        if (!includedAtomRows.length) throw new Error(`${sourceWorkId}: ${label} contains no projected atoms`);
        const included = unique(includedAtomRows.map((row) => row.method_setting_id));
        return {
          method_configuration_level_id: `source-audit-level-${sha256Bytes(`${sourceWorkId}\0${label}`).slice(7, 31)}`,
          method_configuration_level_label: label,
          included_method_setting_ids: included,
          excluded_method_setting_ids: [],
          common_method_setting_ids: [],
          branch_method_setting_ids: [],
          documentary_method_setting_ids: unique(verdictRows.filter((row) => evidenceIds.has(row.method_setting_id))
            .map((row) => row.method_setting_id)),
          unresolved_method_setting_ids: included.filter((id) =>
            targetRows.find((row) => row.method_setting_id === id)?.method_implementation_status !== "native"),
          source_locators: auditLocators(audit, verdict.locator ?? verdict.source_locator),
        };
      });
      return { axis, ...finalizeSelectableConfigurationLevels(levels, targetRows) };
    });
    const configurationLevelRows = levelRowsByAxis.flatMap((group) => group.configurationLevels);
    const selectableSettingIds = new Set(levelRowsByAxis.flatMap((group) => [...group.selectableSettingIds]));
    const conditionalSettingIds = new Set(audit.source_configuration_repairs.flatMap((repair) => {
      if (repair.conditional_atom_keys === undefined) return [];
      if (!Array.isArray(repair.conditional_branches) || !Array.isArray(repair.conditional_atom_keys)
        || !repair.conditional_atom_keys.length || new Set(repair.conditional_atom_keys).size !== repair.conditional_atom_keys.length
        || repair.conditional_atom_keys.some((key) => !repair.atom_keys?.includes(key) || !atomRowsByKey.has(key))) {
        throw new Error(`${sourceWorkId}: invalid condition-scoped atom inventory`);
      }
      return repair.conditional_atom_keys.flatMap((key) => atomRowsByKey.get(key).map((row) => row.method_setting_id));
    }));
    const invariantMethodSettingIds = targetRows.map((row) => row.method_setting_id)
      .filter((id) => !selectableSettingIds.has(id) && !evidenceIds.has(id)
        && !variantScopedIds.has(id) && !dependentAnalysisIds.has(id)
        && !disjunctiveIds.has(id) && !campaignBranchIds.has(id)
        && !campaignTopologyBranchIds.has(id) && !conditionalSettingIds.has(id));
    const coveredKeys = new Set(audit.configuration_verdicts.flatMap((verdict) => verdict.atom_keys));
    const missingKeys = audit.disclosed_atoms.map((atom) => atom.key).filter((key) => !coveredKeys.has(key));
    if (missingKeys.length) throw new Error(`${sourceWorkId}: configurations omit atoms: ${missingKeys.join(", ")}`);
    const configurationMetadataGroups = audit.disclosed_atoms
      .filter((atom) => atom.projection_disposition === "configuration_metadata")
      .map((atom) => {
        const metadataLocators = auditLocators(audit, atom.locator);
        return {
          method_configuration_group_id: `source-audit-metadata-group-${sha256Bytes(`${sourceWorkId}\0${atom.key}`).slice(7, 31)}`,
          method_configuration_group_kind: "source_configuration_metadata",
          method_configuration_axis: [atom.key],
          method_selection_semantics: JSON.stringify({ key: atom.key, value: atom.value }),
          method_cross_product_policy: "source_declared_metadata_no_inferred_cartesian_product",
          method_configuration_levels: [{
            method_configuration_level_id: metadataLevelIdByKey.get(atom.key),
            method_configuration_level_label: atom.key,
            included_method_setting_ids: [],
            excluded_method_setting_ids: [],
            common_method_setting_ids: [],
            branch_method_setting_ids: [],
            documentary_method_setting_ids: [],
            unresolved_method_setting_ids: [],
            source_locators: metadataLocators,
          }],
          documentary_method_setting_ids: [],
          unresolved_method_setting_ids: [],
          source_locators: metadataLocators,
        };
      });
    const relationshipGroups = audit.source_configuration_repairs
      .filter((repair) => repair.relation === "DISJUNCTION_UNRESOLVED"
        || Array.isArray(repair.conditional_branches))
      .map((repair) => {
        const repairId = repair.configuration_group_id ?? repair.group;
        if (!repairId || !repair.configuration_axis || !Array.isArray(repair.atom_keys)
          || !repair.atom_keys.length || new Set(repair.atom_keys).size !== repair.atom_keys.length) {
          throw new Error(`${sourceWorkId}: source relationship lacks a unique axis or atom inventory`);
        }
        const relatedRows = repair.atom_keys.flatMap((key) => {
          const rows = atomRowsByKey.get(key);
          if (!rows?.length) throw new Error(`${sourceWorkId}: relationship names unknown atom ${key}`);
          return rows;
        });
        const locators = auditLocators(audit, repair.locator ?? repair.source_locators?.join("; "));
        const conditional = Array.isArray(repair.conditional_branches);
        const conditionalBranchIds = conditional ? unique((repair.conditional_atom_keys ?? [])
          .flatMap((key) => atomRowsByKey.get(key).map((row) => row.method_setting_id))) : [];
        return {
          method_configuration_group_id: `source-audit-relationship-group-${sha256Bytes(`${sourceWorkId}\0${repairId}`).slice(7, 31)}`,
          method_configuration_group_kind: conditional ? "conditional_joint_protocol" : "source_provider_disjunction_unresolved",
          method_configuration_axis: [repair.configuration_axis],
          method_selection_semantics: conditional
            ? "condition_driven_joint_protocol_no_user_selection"
            : "source_disjunction_provider_policy_unreported_no_user_selection",
          method_cross_product_policy: "single_joint_execution_no_cartesian_product",
          method_configuration_levels: [{
            method_configuration_level_id: `source-audit-relationship-level-${sha256Bytes(`${sourceWorkId}\0${repairId}`).slice(7, 31)}`,
            method_configuration_level_label: conditional
              ? [repair.topology, ...repair.conditional_branches].filter(Boolean).join(" | ")
              : repair.topology,
            included_method_setting_ids: [],
            excluded_method_setting_ids: [],
            common_method_setting_ids: [],
            branch_method_setting_ids: conditionalBranchIds,
            documentary_method_setting_ids: [],
            unresolved_method_setting_ids: [],
            source_locators: locators,
          }],
          documentary_method_setting_ids: [],
          unresolved_method_setting_ids: unique(relatedRows.filter((row) =>
            row.method_implementation_status !== "native"
              && (conditional || disjunctiveIds.has(row.method_setting_id)))
            .map((row) => row.method_setting_id)),
          source_locators: locators,
        };
      });
    const evidenceRows = targetRows.filter((row) => evidenceIds.has(row.method_setting_id));
    const evidenceGroup = evidenceRows.length ? [{
      method_configuration_group_id: `source-audit-evidence-group-${sha256Bytes(sourceWorkId).slice(7, 31)}`,
      method_configuration_group_kind: "source_evidence_not_method_decision",
      method_configuration_axis: ["source_evidence"],
      method_selection_semantics: "source_evidence_no_user_selection",
      method_cross_product_policy: "no_inferred_executable_method_decision",
      method_configuration_levels: [{
        method_configuration_level_id: `source-audit-evidence-level-${sha256Bytes(sourceWorkId).slice(7, 31)}`,
        method_configuration_level_label: "Source evidence and reported results",
        included_method_setting_ids: [],
        excluded_method_setting_ids: [],
        common_method_setting_ids: [],
        branch_method_setting_ids: [],
        documentary_method_setting_ids: [],
        unresolved_method_setting_ids: [],
        source_locators: unique(evidenceRows.flatMap((row) => row.source_locators)),
      }],
      documentary_method_setting_ids: evidenceRows.filter((row) =>
        !unresolvedEvidenceIds.has(row.method_setting_id)).map((row) => row.method_setting_id),
      unresolved_method_setting_ids: evidenceRows.filter((row) =>
        unresolvedEvidenceIds.has(row.method_setting_id)).map((row) => row.method_setting_id),
      source_locators: unique(evidenceRows.flatMap((row) => row.source_locators)),
    }] : [];
    const dependentAnalysisGroups = audit.configuration_verdicts
      .filter((verdict) => ["dependent_study_analysis_unit", "fixed_source_method_unit"].includes(verdict.configuration_kind))
      .map((verdict) => {
        const fixedInventory = verdict.configuration_kind === "fixed_source_method_unit";
        const rows = verdict.atom_keys.flatMap((key) => atomRowsByKey.get(key) ?? [])
          .filter((row) => fixedInventory
            ? invariantMethodSettingIds.includes(row.method_setting_id)
            : dependentAnalysisIds.has(row.method_setting_id));
        if (!rows.length) return null;
        const id = sha256Bytes(`${sourceWorkId}\0${verdict.configuration_id}`).slice(7, 31);
        const locators = unique(rows.flatMap((row) => row.source_locators));
        return {
          method_configuration_group_id: `source-audit-${fixedInventory ? "fixed-inventory" : "dependent-analysis"}-group-${id}`,
          method_configuration_group_kind: "fixed_pipeline_stage_component",
          method_configuration_axis: [fixedInventory ? verdict.configuration_id : "dependent_study_analysis"],
          method_selection_semantics: fixedInventory ? "fixed_source_inventory_no_user_selection" : "fixed_pipeline_stage_no_user_selection",
          method_cross_product_policy: fixedInventory ? "source_declared_fixed_inventory_no_cartesian_product" : "fixed_stage_applies_with_selected_alternative",
          method_configuration_levels: [{
            method_configuration_level_id: `source-audit-${fixedInventory ? "fixed-inventory" : "dependent-analysis"}-level-${id}`,
            method_configuration_level_label: verdict.configuration,
            included_method_setting_ids: fixedInventory ? [] : rows.map((row) => row.method_setting_id),
            excluded_method_setting_ids: [],
            common_method_setting_ids: fixedInventory ? rows.map((row) => row.method_setting_id) : [],
            branch_method_setting_ids: [],
            documentary_method_setting_ids: [],
            unresolved_method_setting_ids: rows.filter((row) => row.method_implementation_status !== "native")
              .map((row) => row.method_setting_id),
            source_locators: locators,
          }],
          documentary_method_setting_ids: [],
          unresolved_method_setting_ids: [],
          source_locators: locators,
        };
      }).filter(Boolean);
    const variantScopedRows = targetRows.filter((row) => variantScopedIds.has(row.method_setting_id));
    const variantScopedGroup = variantScopedRows.length ? [{
      method_configuration_group_id: `source-audit-campaign-scope-group-${sha256Bytes(sourceWorkId).slice(7, 31)}`,
      method_configuration_group_kind: "source_campaign_or_conditional_scope_unresolved",
      method_configuration_axis: ["source_campaign_scope"],
      method_selection_semantics: "source_campaign_not_variant_no_user_selection",
      method_cross_product_policy: "no_inferred_campaign_variant_equivalence",
      method_configuration_levels: [{
        method_configuration_level_id: `source-audit-campaign-scope-level-${sha256Bytes(sourceWorkId).slice(7, 31)}`,
        method_configuration_level_label: "Source campaign or conditional controls outside selectable variants",
        included_method_setting_ids: [],
        excluded_method_setting_ids: [],
        common_method_setting_ids: [],
        branch_method_setting_ids: [],
        documentary_method_setting_ids: [],
        unresolved_method_setting_ids: [],
        source_locators: unique(variantScopedRows.flatMap((row) => row.source_locators)),
      }],
      documentary_method_setting_ids: [],
      unresolved_method_setting_ids: variantScopedRows.map((row) => row.method_setting_id),
      source_locators: unique(variantScopedRows.flatMap((row) => row.source_locators)),
    }] : [];
    const campaignCellGroups = campaignCells.map(({ verdict, branchRows, evidenceRows }) => {
      const branchIds = branchRows.map((row) => row.method_setting_id);
      const documentaryEvidenceIds = evidenceRows.filter((row) => !unresolvedEvidenceIds.has(row.method_setting_id))
        .map((row) => row.method_setting_id);
      const unresolvedIds = unique([
        ...branchRows.filter((row) => row.method_implementation_status !== "native")
          .map((row) => row.method_setting_id),
        ...evidenceRows.filter((row) => unresolvedEvidenceIds.has(row.method_setting_id))
          .map((row) => row.method_setting_id),
      ]);
      const locators = auditLocators(audit, verdict.locator ?? verdict.source_locator);
      const campaignId = verdict.source_configuration_id ?? verdict.configuration_id;
      if (!campaignId) throw new Error(`${sourceWorkId}: campaign cell lacks a source configuration identity`);
      const identity = `${sourceWorkId}\0${campaignId}`;
      return {
        method_configuration_group_id: `source-audit-campaign-cell-${sha256Bytes(identity).slice(7, 31)}`,
        method_configuration_group_kind: "source_campaign_model_cell",
        method_configuration_axis: [campaignId],
        method_selection_semantics: "source_campaign_cell_no_user_selection",
        method_cross_product_policy: "single_source_campaign_no_cartesian_product",
        method_configuration_levels: [{
          method_configuration_level_id: `source-audit-campaign-level-${sha256Bytes(identity).slice(7, 31)}`,
          method_configuration_level_label: verdict.source_configuration_label ?? verdict.configuration_label ?? campaignId,
          included_method_setting_ids: branchIds,
          excluded_method_setting_ids: [],
          common_method_setting_ids: [],
          branch_method_setting_ids: branchIds,
          documentary_method_setting_ids: documentaryEvidenceIds,
          unresolved_method_setting_ids: unresolvedIds,
          source_locators: locators,
        }],
        documentary_method_setting_ids: documentaryEvidenceIds,
        unresolved_method_setting_ids: unresolvedIds,
        source_locators: locators,
      };
    });
    const unbranchedCampaignVerdicts = audit.configuration_verdicts.filter((verdict) =>
      verdict.configuration_unit_kind === "campaign_internal_job_model_cell"
        && !verdict.branch_atom_keys?.length);
    const campaignInventoryGroup = unbranchedCampaignVerdicts.length ? [{
      method_configuration_group_id: `source-audit-campaign-inventory-${sha256Bytes(sourceWorkId).slice(7, 31)}`,
      method_configuration_group_kind: "source_campaign_model_cell",
      method_configuration_axis: ["source_campaign_inventory"],
      method_selection_semantics: "source_campaign_cells_no_user_selection",
      method_cross_product_policy: "source_declared_campaign_no_cartesian_product",
      method_configuration_levels: unbranchedCampaignVerdicts.map((verdict) => {
        const campaignId = verdict.source_configuration_id ?? verdict.configuration_id;
        if (!campaignId) throw new Error(`${sourceWorkId}: campaign unit lacks a source configuration identity`);
        const rows = verdict.atom_keys.flatMap((key) => atomRowsByKey.get(key) ?? []);
        const methodRows = rows.filter((row) => !evidenceIds.has(row.method_setting_id));
        const documentaryRows = rows.filter((row) => evidenceIds.has(row.method_setting_id));
        const locators = auditLocators(audit, verdict.locator ?? verdict.source_locator);
        return {
          method_configuration_level_id: `source-audit-campaign-inventory-level-${sha256Bytes(`${sourceWorkId}\0${campaignId}`).slice(7, 31)}`,
          method_configuration_level_label: campaignId,
          included_method_setting_ids: unique(methodRows.map((row) => row.method_setting_id)),
          excluded_method_setting_ids: [],
          common_method_setting_ids: [],
          branch_method_setting_ids: [],
          documentary_method_setting_ids: unique(documentaryRows.map((row) => row.method_setting_id)),
          unresolved_method_setting_ids: unique(methodRows.filter((row) => row.method_implementation_status !== "native")
            .map((row) => row.method_setting_id)),
          source_locators: locators,
        };
      }),
      documentary_method_setting_ids: [],
      unresolved_method_setting_ids: [],
      source_locators: unique(unbranchedCampaignVerdicts.flatMap((verdict) =>
        auditLocators(audit, verdict.locator ?? verdict.source_locator))),
    }] : [];
    const campaignTopologyGroups = campaignTopologyCells
      .map(({ repair, includedIds }) => {
        const identity = `${sourceWorkId}\0${repair.group}`;
        const sourceLocators = auditLocators(audit, repair.locator);
        const branchIds = includedIds.filter((id) => !campaignTopologyCommonIds.includes(id));
        const unresolvedIds = includedIds.filter((id) =>
          targetRows.find((row) => row.method_setting_id === id)?.method_implementation_status !== "native");
        return {
          method_configuration_group_id: `source-audit-campaign-topology-${sha256Bytes(identity).slice(7, 31)}`,
          method_configuration_group_kind: "source_campaign_model_cell",
          method_configuration_axis: [repair.group],
          method_selection_semantics: "source_campaign_cell_no_user_selection",
          method_cross_product_policy: "single_source_campaign_no_cartesian_product",
          method_configuration_levels: [{
            method_configuration_level_id: `source-audit-campaign-topology-level-${sha256Bytes(identity).slice(7, 31)}`,
            method_configuration_level_label: `${repair.group}: ${repair.levels.join("; ")}`,
            included_method_setting_ids: includedIds,
            excluded_method_setting_ids: [],
            common_method_setting_ids: campaignTopologyCommonIds,
            branch_method_setting_ids: branchIds,
            documentary_method_setting_ids: [],
            unresolved_method_setting_ids: unresolvedIds,
            source_locators: sourceLocators,
          }],
          documentary_method_setting_ids: [],
          unresolved_method_setting_ids: unresolvedIds,
          source_locators: sourceLocators,
        };
      });
    const hasConditionalRelationship = relationshipGroups.some((group) =>
      group.method_configuration_group_kind === "conditional_joint_protocol");
    const sourceLocators = unique([
      ...targetRows.flatMap((row) => row.source_locators),
      ...configurationMetadataGroups.flatMap((group) => group.source_locators),
      ...relationshipGroups.flatMap((group) => group.source_locators),
      ...audit.configuration_verdicts.flatMap((verdict) =>
        auditLocators(audit, verdict.locator ?? verdict.source_locator)),
    ]);
    const selectableConfigurationGroups = levelRowsByAxis.map(({ axis, configurationLevels, selectableSettingIds: groupSettingIds }) => ({
      method_configuration_group_id: axis === "source_configuration_alternative" ? groupId
        : `source-audit-group-${sha256Bytes(`${sourceWorkId}\0${axis}`).slice(7, 31)}`,
      method_configuration_group_kind: "source_configuration_alternative",
      method_configuration_axis: [axis],
      method_selection_semantics: levelRowsByAxis.length === 1
        ? "select_exactly_one_source_declared_alternative"
        : "source_levels_selectable_without_cross_group_expansion",
      method_cross_product_policy: levelRowsByAxis.length === 1
        ? "single_source_declared_alternative_no_cartesian_product"
        : "not_enumerated_no_cartesian_product",
      method_configuration_levels: configurationLevels,
      documentary_method_setting_ids: [],
      unresolved_method_setting_ids: targetRows.filter((row) => groupSettingIds.has(row.method_setting_id)
        && row.method_implementation_status !== "native")
        .map((row) => row.method_setting_id),
      source_locators: unique(configurationLevels.flatMap((level) => level.source_locators)),
    }));
    const configurationSpace = {
      method_configuration_space_id: `source-audit-configuration-space-${sha256Bytes(sourceWorkId).slice(7, 31)}`,
      method_configuration_structure: configurationLevelRows.length ? "source_declared_axes"
        : hasConditionalRelationship ? "conditional" : "fixed",
      invariant_method_setting_ids: invariantMethodSettingIds,
      method_configuration_groups: [...selectableConfigurationGroups, ...campaignCellGroups, ...campaignInventoryGroup,
        ...campaignTopologyGroups,
        ...configurationMetadataGroups,
        ...relationshipGroups, ...evidenceGroup, ...dependentAnalysisGroups, ...variantScopedGroup],
      allowed_method_combinations: [],
      documentary_method_setting_ids: [],
      not_applicable_method_setting_ids: [],
      unresolved_method_setting_ids: targetRows.filter((row) => invariantMethodSettingIds.includes(row.method_setting_id)
        && row.method_implementation_status !== "native")
        .map((row) => row.method_setting_id),
      source_locators: sourceLocators,
    };

    repairedAssertions = repairedAssertions.filter((row) => row.source_work_id !== sourceWorkId)
      .concat(targetRows)
      .sort((left, right) => left.source_work_id.localeCompare(right.source_work_id)
        || left.method_setting_id.localeCompare(right.method_setting_id));
    const targetById = new Map(targetRows.map((row) => [row.method_setting_id, row]));
    const sessionPolicies = projectAuditedSessionPolicies(audit, atomRowsByKey);
    if (sessionPolicies !== undefined) validateLinkmlRows(ontology, "SessionConstructionPolicy", sessionPolicies);
    const methodOperations = audit.method_operations;
    if (methodOperations !== undefined) {
      if (!Array.isArray(methodOperations)) {
        throw new Error(`${sourceWorkId}: source method operations must be an array`);
      }
      const settingKeys = new Set(targetRows.map((row) => row.method_parameter_key));
      const operationIds = new Set(methodOperations.map((operation) => operation.operation_id));
      if (!Array.isArray(methodOperations) || operationIds.size !== methodOperations.length
        || methodOperations.some((operation) => !operation.operation_id
          || (operation.configuration_dependencies ?? []).some((key) => !settingKeys.has(key))
          || (operation.depends_on ?? []).some((id) => !operationIds.has(id) || id === operation.operation_id))) {
        throw new Error(`${sourceWorkId}: source method operation references an unknown setting or operation`);
      }
    }
    const unchangedSettingIds = new Set(targetRows
      .filter((row) => oldById.get(row.method_setting_id) === row)
      .map((row) => row.method_setting_id));
    const typedSlots = [
      "method_operations", "acquisition_protocols", "session_construction_policies", "notification_attribution_policies",
      "duration_policies", "timestamp_policies", "parameter_provenance_assertions", "release_profiles",
      "diary_protocols",
    ];
    repairedProfiles = repairedProfiles.map((profile) => {
      if (profile.source_work_id !== sourceWorkId) return profile;
      const refreshedTypedSections = Object.fromEntries(typedSlots.map((slot) => [slot,
        (profile[slot] ?? [])
          .filter((object) => Array.isArray(object.method_settings)
            && object.method_settings.length > 0
            && object.method_settings.every((setting) => unchangedSettingIds.has(setting.method_setting_id)))
          .map((object) => ({
            ...object,
            method_settings: object.method_settings.map((setting) => targetById.get(setting.method_setting_id)),
          })),
      ]));
      return {
        ...profile,
        ...refreshedTypedSections,
        ...(methodOperations === undefined ? {} : { method_operations: methodOperations }),
        ...(sessionPolicies === undefined ? {} : { session_construction_policies: sessionPolicies }),
        protocol_materialization_blockers: (profile.protocol_materialization_blockers ?? [])
          .filter((blocker) => Array.isArray(blocker.blocked_method_setting_ids)
            && blocker.blocked_method_setting_ids.length > 0
            && blocker.blocked_method_setting_ids.every((id) => unchangedSettingIds.has(id))),
        source_artifact_provenance_assertions: (profile.source_artifact_provenance_assertions ?? [])
          .filter((assertion) => {
            const setting = targetById.get(assertion.method_setting_id);
            return setting
              && assertion.source_work_id === setting.source_work_id
              && assertion.source_extraction_id === setting.source_extraction_id
              && assertion.source_value_sha256 === setting.source_value_sha256;
          }),
        source_method_variant_id: configurationSpace.method_configuration_space_id,
        source_method_variant_label: configurationLevelRows.length
          ? "Source-audited selectable alternatives"
          : hasConditionalRelationship ? "Source-audited conditional method"
            : campaignCellGroups.length ? "Source-audited fixed campaign" : "Source-audited fixed method",
        method_configuration_structure: configurationSpace.method_configuration_structure,
        method_configuration_space: configurationSpace,
        method_profile_version: "literature-sublation-v3-atomic+source-complete-v1",
        method_setting_ids: targetRows.map((row) => row.method_setting_id),
        method_setting_count: targetRows.length,
        profile_implementation_status: "blocked",
        source_locators: sourceLocators,
      };
    });
    repairedSpaces = repairedSpaces.map((space) => space.source_work_id === sourceWorkId ? {
      ...space,
      source_configuration_space_id: configurationSpace.method_configuration_space_id,
      space_kind: configurationLevelRows.length ? "selectable_axis_or_campaign"
        : hasConditionalRelationship ? "conditional_state_machine" : "fixed",
      space_facets: {
        ...space.space_facets,
        has_fixed_configuration: configurationLevelRows.length === 0,
        has_selectable_axis_or_campaign: configurationLevelRows.length > 0,
        has_conditional_state_machine: hasConditionalRelationship,
        has_unresolved_or_evidence_blocked_material: true,
      },
      all_method_setting_ids: targetRows.map((row) => row.method_setting_id),
      method_setting_count: targetRows.length,
      source_locators: sourceLocators,
    } : space);
    const oldConfigurationRows = oldRows.filter((row) => row.method_variant_group_id).length;
    auditedAtoms += audit.disclosed_atoms.length;
    configurationLevels += configurationLevelRows.length;
    netAddedSettings += targetRows.length - oldRows.length;
    configurationStructuredDelta += configurationLevelRows.length - oldConfigurationRows;
  }
  if ([...executionClassCounts.values()].reduce((sum, count) => sum + count, 0) !== projectedMethodSettings) {
    throw new Error("source-completeness execution classes do not cover the exact projected method-setting inventory");
  }
  for (const id of admittedIds) {
    if (repairedProfiles.filter((profile) => profile.source_work_id === id).length !== 1
      || repairedSpaces.filter((space) => space.source_work_id === id).length !== 1) {
      throw new Error(`${id}: admitted profile/configuration-space projection is missing or duplicated`);
    }
  }
  return {
    assertions: repairedAssertions,
    profiles: repairedProfiles,
    spaces: repairedSpaces,
    aliases,
    tombstones,
    admissions,
    summary: {
      projected_profiles: audits.length,
      post_freeze_admitted_profiles: admissions.length,
      source_work_ids: audits.map((audit) => audit.source_work_id),
      audited_atoms: auditedAtoms,
      projected_method_settings: projectedMethodSettings,
      projected_configuration_metadata: projectedConfigurationMetadata,
      superseded_aliases: aliases.length,
      configuration_levels: configurationLevels,
      net_added_settings: netAddedSettings,
      configuration_structured_delta: configurationStructuredDelta,
      explicit_variant_delta: configurationStructuredDelta,
      completed_configurations: 0,
      source_evidence_fail_closed: true,
      execution_class_counts: Object.fromEntries([...executionClassCounts].sort(([left], [right]) =>
        left.localeCompare(right))),
      validation_passed: true,
    },
  };
}

function applyExternalExecutionReceipts(assertions, profiles, spaces) {
  let repairedAssertions = assertions;
  let repairedProfiles = profiles;
  let repairedSpaces = spaces;
  const summaries = [];
  const typedSlots = [
    "method_operations", "acquisition_protocols", "session_construction_policies",
    "notification_attribution_policies", "duration_policies", "timestamp_policies",
    "parameter_provenance_assertions", "protocol_materialization_blockers", "diary_protocols", "release_profiles",
  ];
  for (const { receipt, audit, digest } of loadLiteratureExternalExecutionReceipts(repo)) {
    const sourceWorkId = receipt.source_work_id;
    const noVerdicts = audit.configuration_verdicts.filter((verdict) => verdict.verdict === "hard_no");
    const profile = repairedProfiles.find((candidate) => candidate.source_work_id === sourceWorkId);
    if (!profile || !profile.method_profile_version.includes("+source-complete-v1")) {
      throw new Error(`${sourceWorkId}: source-complete profile is missing before external execution projection`);
    }
    const verdictById = new Map(audit.configuration_verdicts
      .map((verdict) => [verdict.configuration_id, verdict]));
    const targetRows = repairedAssertions.filter((row) => row.source_work_id === sourceWorkId);
    const targetIds = new Set(targetRows.map((row) => row.method_setting_id));
    const settingByKey = new Map(targetRows.map((row) => [row.method_parameter_key, row.method_setting_id]));
    const promotedIds = new Set(receipt.configuration_bindings.flatMap((binding) => {
      const verdict = verdictById.get(binding.configuration_id);
      const keys = binding.binding_kind === "campaign" ? binding.executed_atom_keys : verdict?.atom_keys;
      if (!Array.isArray(keys) || !keys.length) {
        throw new Error(`${sourceWorkId}: external receipt binding has no audited atom inventory`);
      }
      return keys.map((key) => settingByKey.get(key));
    }));
    if (!promotedIds.size || [...promotedIds].some((id) => !targetIds.has(id))) {
      throw new Error(`${sourceWorkId}: external promotion names an unknown or empty setting inventory`);
    }
    const promotedRows = targetRows.map((row) => {
      if (!promotedIds.has(row.method_setting_id) || row.method_implementation_status === "native") return row;
      const { method_execution_blocker_code: _blocker, ...rest } = row;
      return {
        ...rest,
        method_implementation_status: "external_executor",
        method_execution_route: "external_named_executor",
        method_execution_destination_id: receipt.executor_id,
        method_execution_parameter_path: "/configurationBindings",
        executor_id: receipt.executor_id,
        conformance_fixture_id: receipt.fixture_id,
        conformance_result_digest: receipt.semantic_digest_sha256,
        integration_source: "external_execution_receipt_v1",
        adjudication_confidence: 1,
        adjudication_rationale: "Executed source-declared code against exact released inputs; command, artifacts, runtime identity, configuration, and semantic result are digest-bound by the registered receipt.",
      };
    });
    const promotedById = new Map(promotedRows.map((row) => [row.method_setting_id, row]));
    const unresolved = (ids) => ids.filter((id) => {
      const status = promotedById.get(id)?.method_implementation_status;
      return status !== "native" && status !== "external_executor";
    });
    const activeInputIds = new Set(promotedRows.filter((row) =>
      row.method_parameter_key.startsWith("analysis.input.")
        && row.method_implementation_status === "external_executor").map((row) => row.method_setting_id));
    const repairedSpace = {
      ...profile.method_configuration_space,
      invariant_method_setting_ids: unique([
        ...profile.method_configuration_space.invariant_method_setting_ids, ...activeInputIds,
      ]),
      method_configuration_groups: profile.method_configuration_space.method_configuration_groups.map((group) => ({
        ...group,
        documentary_method_setting_ids: (group.documentary_method_setting_ids ?? []).filter((id) => !activeInputIds.has(id)),
        method_configuration_levels: group.method_configuration_levels.map((level) => ({
          ...level,
          unresolved_method_setting_ids: unresolved(level.included_method_setting_ids),
        })),
        unresolved_method_setting_ids: unresolved(group.unresolved_method_setting_ids ?? [])
          .filter((id) => !activeInputIds.has(id)),
      })),
    };
    repairedAssertions = repairedAssertions.filter((row) => row.source_work_id !== sourceWorkId)
      .concat(promotedRows)
      .sort((left, right) => left.source_work_id.localeCompare(right.source_work_id)
        || left.method_setting_id.localeCompare(right.method_setting_id));
    repairedProfiles = repairedProfiles.map((candidate) => {
      if (candidate.source_work_id !== sourceWorkId) return candidate;
      const typed = Object.fromEntries(typedSlots.map((slot) => [slot,
        (candidate[slot] ?? []).map((object) => ({
          ...object,
          ...(Array.isArray(object.method_settings) ? {
            method_settings: object.method_settings.map((setting) => promotedById.get(setting.method_setting_id)),
          } : {}),
        })),
      ]));
      return {
        ...candidate,
        ...typed,
        method_configuration_space: repairedSpace,
        method_profile_version: `${candidate.method_profile_version}+external-execution-v1`,
      };
    });
    repairedSpaces = repairedSpaces.map((candidate) => candidate.source_work_id === sourceWorkId ? {
      ...candidate,
      space_facets: {
        ...candidate.space_facets,
        has_unresolved_or_evidence_blocked_material: noVerdicts.length > 0 || unresolved([...targetIds]).length > 0,
      },
    } : candidate);
    summaries.push({
      source_work_id: sourceWorkId,
      executor_id: receipt.executor_id,
      execution_receipt_sha256: digest,
      executed_configurations: receipt.configuration_bindings.length,
      source_blocked_configurations: noVerdicts.length,
      externally_executable_settings: promotedRows.filter((row) => row.method_implementation_status === "external_executor").length,
      retained_native_settings: promotedRows.filter((row) => promotedIds.has(row.method_setting_id)
        && row.method_implementation_status === "native").length,
      semantic_digest: receipt.semantic_digest_sha256,
    });
  }
  return {
    assertions: repairedAssertions,
    profiles: repairedProfiles,
    spaces: repairedSpaces,
    summary: {
      receipts: summaries,
      executed_configurations: summaries.reduce((total, item) => total + item.executed_configurations, 0),
      source_blocked_configurations: summaries.reduce((total, item) => total + item.source_blocked_configurations, 0),
      validation_passed: true,
    },
  };
}

function applyHushSourceCompletenessAudit(assertions, profiles, spaces, ontology) {
  const sourceWorkId = "doi:10.1145/2789168.2790107";
  requirePrivate(sourceCompletenessAuditDirectory, 0o700);
  requirePrivate(hushSourceCompletenessAuditPath, 0o600);
  const auditValidation = spawnSync(process.execPath, [sourceCompletenessAuditValidatorPath], {
    cwd: repo,
    encoding: "utf8",
  });
  if (auditValidation.status !== 0) {
    throw new Error(`source-completeness audit validation failed:\n${auditValidation.stdout}\n${auditValidation.stderr}`);
  }
  const validation = JSON.parse(auditValidation.stdout);
  const audit = JSON.parse(readFileSync(hushSourceCompletenessAuditPath, "utf8"));
  if (!validation.passed_current_records
    || !validation.audited_source_work_ids.includes(sourceWorkId)
    || audit.schema_version !== "chronicle-source-completeness-audit/v1"
    || audit.source_work_id !== sourceWorkId
    || audit.completion_verdict !== "hard_no_source_campaign"
    || audit.disclosed_atoms.length !== 87
    || audit.source_configuration_repairs.length !== 10
    || audit.configuration_verdicts.length !== 19
    || audit.configuration_verdicts.some((verdict) => verdict.verdict !== "NO")) {
    throw new Error("HUSH source-completeness audit identity or inventory drift");
  }
  for (const artifact of audit.source_artifacts) {
    const path = resolve(repo, artifact.path);
    if (!existsSync(path) || sha256(path).slice(7) !== artifact.sha256) {
      throw new Error(`HUSH source artifact drift: ${artifact.path}`);
    }
  }

  const artifactPath = (suffix) => {
    const artifact = audit.source_artifacts.find((candidate) => candidate.path.endsWith(suffix));
    if (!artifact) throw new Error(`HUSH audit source artifact is missing: ${suffix}`);
    return resolve(repo, artifact.path);
  };
  const locatorPaths = new Map([
    ["rank169.txt", artifactPath("rank169.txt")],
    ["355.txt", artifactPath("355.txt")],
    ["framework patch", artifactPath("android_frameworks_base-hush-98a8672402ae.patch")],
    ["Settings patch", artifactPath("android_packages_apps_Settings-hush-7a527016eee.patch")],
  ]);
  const locators = (locator) => {
    const located = [];
    for (const match of locator.matchAll(/(rank169\.txt|355\.txt|framework patch|Settings patch):([^;]+)/g)) {
      for (const range of match[2].matchAll(/(\d+)-(\d+)/g)) {
        located.push(`${locatorPaths.get(match[1])}:${range[1]}-${range[2]}`);
      }
    }
    if (locator.includes("both HUSH patches")) {
      located.push(`${locatorPaths.get("framework patch")}:1-1431`);
      located.push(`${locatorPaths.get("Settings patch")}:1-304`);
    }
    if (!located.length) throw new Error(`HUSH audit locator has no resolvable range: ${locator}`);
    return unique(located);
  };
  const methodRoles = new Map([
    ["acquisition", "acquisition"],
    ["aggregation", "aggregation"],
    ["classification", "analysis"],
    ["configuration", "analysis"],
    ["event_schema", "event_schema"],
    ["evidence_conflict", "provenance"],
    ["evidence_gap", "provenance"],
    ["input_schema", "event_schema"],
    ["modeling", "analysis"],
    ["persistence", "provenance"],
    ["preprocessing", "quality_control"],
    ["provenance", "provenance"],
    ["quality_control", "quality_control"],
    ["reconstruction", "reconstruction"],
    ["reported_result", "reporting"],
    ["validation", "validation"],
  ]);
  const targetLayers = new Map([
    ["android_framework", "released_artifact"],
    ["android_settings", "released_artifact"],
    ["app", "derived_feature"],
    ["app_cpu_counter", "raw_record"],
    ["app_event", "raw_occurrence"],
    ["app_network_counter", "raw_record"],
    ["background_activity", "derived_feature"],
    ["battery_event", "raw_occurrence"],
    ["bfc_simulation", "model"],
    ["collector", "collector"],
    ["cpu_core_counter", "raw_record"],
    ["cpu_frequency_residency", "raw_record"],
    ["device", "acquired_snapshot"],
    ["device_app", "derived_feature"],
    ["device_app_state", "derived_feature"],
    ["device_app_window", "derived_feature"],
    ["device_day", "participant_day"],
    ["device_day_energy", "derived_feature"],
    ["device_event", "raw_occurrence"],
    ["device_interval", "device_session"],
    ["device_result", "outcome"],
    ["energy_model", "model"],
    ["hush_code_snapshot", "released_artifact"],
    ["hush_runtime", "released_artifact"],
    ["hush_simulation", "model"],
    ["hush_variant", "released_artifact"],
    ["interval_app_energy", "derived_feature"],
    ["network_event", "raw_occurrence"],
    ["network_system_call", "derived_feature"],
    ["process_identity", "raw_record"],
    ["result_oracle", "outcome"],
    ["screen_off_interval", "device_session"],
    ["suppressed_activity", "derived_feature"],
    ["trace", "acquired_snapshot"],
  ]);
  const valueKind = (value) => Array.isArray(value) ? "list"
    : value === null ? "unspecified"
      : Number.isInteger(value) ? "integer"
        : typeof value === "number" ? "float"
          : typeof value === "object" ? "object" : typeof value;
  const executionRoute = (role) => ["acquisition", "event_schema"].includes(role) ? "protocol_input"
    : ["provenance", "reporting"].includes(role) ? "receipt_conformance" : "external_named_executor";
  const requiredInputs = (role, target) => ["acquisition", "event_schema"].includes(role)
    ? ["source_collector_or_raw_stream"]
    : target === "released_artifact" || role === "provenance" ? ["source_method_receipt"]
      : target === "model" || target === "outcome" ? ["source_derived_feature_rows"]
        : ["source_reconstructed_rows"];
  const settingId = (kind, ...identity) => `method-setting-${sha256Bytes(JSON.stringify([sourceWorkId, kind, ...identity])).slice(7, 31)}`;
  const extractionId = (kind, ...identity) => `extraction-${sha256Bytes(JSON.stringify([sourceWorkId, kind, ...identity])).slice(7, 31)}`;
  const sourceFields = (key, value, locator, sourceExtractionId) => {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    const observed = `${key}: ${rendered}`;
    return {
      source_extraction_id: sourceExtractionId,
      source_evidence_work_id: sourceWorkId,
      source_locators: locators(locator),
      source_clause_text: rendered,
      source_clause_path: "source_completeness_audit",
      source_clause_start: key.length + 2,
      source_clause_end: observed.length,
      source_observed_setting: observed,
      source_value_json: JSON.stringify(observed),
      source_value_sha256: sha256Bytes(observed).slice(7),
      source_coverage_status: "DECLARED",
      source_clause_ids: [`${sourceExtractionId}#source_completeness_audit[0]`],
    };
  };
  const ontologyTerms = (role) => [
    "StudyMethodProfile",
    "MethodSettingAssertion",
    role === "acquisition" ? "AcquisitionProtocol"
      : role === "reconstruction" ? "SessionConstructionPolicy"
        : role === "reporting" ? "MeasurementReleaseProfile" : "ParameterProvenanceAssertion",
  ];
  const allowedSlots = new Set(ontology.classes.MethodSettingAssertion.slots);
  const sourceExtractionIdByAtomKey = new Map(Object.entries({
    "collector.fine.app_network_screen_on": "extraction-23861c305a15621416ea",
    "collector.event.wifi_switch": "extraction-782564e4011849ca5d21",
    "collector.coarse.app_cpu": "extraction-b96d6132ed172a481f11",
    "preprocess.uncovered_time": "extraction-9b10962c21ae76717e70",
    "study.trace_devices": "extraction-230ab72d59f77f3bb962",
  }));
  const atomRows = audit.disclosed_atoms.map((atom) => {
    const role = atom.canonical_role ?? methodRoles.get(atom.role);
    const target = atom.canonical_target ?? targetLayers.get(atom.target);
    if (!role) throw new Error(`unmapped HUSH role: ${atom.role}`);
    if (!target) throw new Error(`unmapped HUSH target: ${atom.target}`);
    const classification = ["study.trace_devices", "study.trace_duration", "study.trace_geography"].includes(atom.key)
      ? "documentary_fact"
      : atom.key === "hush.code_state_parcel_serialization" ? "runtime_operation"
        : sourceCompletenessExecutionClass({ ...atom, source_work_id: sourceWorkId, canonical_role: role, canonical_target: target });
    const scientificOracle = classification === "scientific_oracle";
    const sourceGap = classification === "source_gap_or_conflict";
    const codeSerialization = atom.key === "hush.code_state_parcel_serialization";
    const id = settingId("atom", atom.key);
    const sourceExtractionId = sourceExtractionIdByAtomKey.get(atom.key) ?? extractionId("atom", atom.key);
    return normalizeAtomicSetting({
      ...sourceFields(atom.key, atom.value, atom.locator, sourceExtractionId),
      source_work_id: sourceWorkId,
      source_component_id: `source-completeness:${atom.role}`,
      method_setting_id: id,
      method_setting_role: role,
      method_target_layer: target,
      method_parameter_key: atom.key,
      method_value_kind: valueKind(atom.value),
      method_value_json: JSON.stringify(atom.value),
      method_applicability_status: "applicable",
      method_disclosure_status: "declared",
      method_implementation_status: "specification_only",
      mapped_ontology_term: ontologyTerms(role),
      mapped_contract_slot: [],
      contract_bindings: [],
      ontology_mapping_note: `source-completeness audit atom ${atom.key}`,
      required_inputs: scientificOracle ? ["source_execution_output", "source_result_oracle"]
        : sourceGap ? ["source_method_receipt"]
          : codeSerialization ? ["source_code_snapshot"] : requiredInputs(role, target),
      integration_source: `hush_source_completeness_audit_v1:${classification}`,
      adjudication_confidence: 1,
      adjudication_rationale: "Source-completeness audit projection; execution remains fail-closed pending a source-faithful fixture and semantic oracle.",
      method_execution_route: scientificOracle || sourceGap ? "receipt_conformance"
        : codeSerialization ? "external_named_executor" : executionRoute(role),
      method_execution_destination_id: scientificOracle ? "chronicle.reported-result-oracle-evidence@comparison-required"
        : sourceGap ? "chronicle.source-evidence-gap@unresolved"
          : `literature.source-completeness.${role}`,
      method_execution_parameter_path: scientificOracle || sourceGap
        ? "/methodProfileReadiness/evidence" : `/source-profiles/hush/settings/${id}`,
      method_execution_blocker_code: scientificOracle ? "scientific_oracle_comparison_receipt_required"
        : sourceGap ? "indispensable_source_evidence_unavailable" : "source_completeness_execution_pending",
    }, allowedSlots);
  });
  const atomRowByKey = new Map(atomRows.map((row) => [row.method_parameter_key, row]));
  const keys = (...prefixes) => audit.disclosed_atoms
    .map((atom) => atom.key)
    .filter((key) => prefixes.some((prefix) => key === prefix || key.startsWith(prefix)));
  const traceCollector = keys("study.", "collector.");
  const screenPreprocessing = keys("preprocess.", "quality.");
  const powerModel = keys("model.", "reconstruct.network_", "validation.power_");
  const powerModelS3 = powerModel.filter((key) => key !== "model.cpu_s4_matrix");
  const powerModelS4 = powerModel.filter((key) => key !== "model.cpu_s3_matrix");
  const energyOutputs = keys("output.");
  const bfcCore = keys(
    "bfc.definition", "bfc.stability_window", "bfc.online_update", "bfc.suppression_rule",
    "simulation.energy_saving", "simulation.network_assumption", "simulation.service_attribution",
    "simulation.cpu_idle_attribution", "simulation.network_tail_sharing", "simulation.staleness",
    "simulation.case_classifier",
  );
  const hushPaper = keys("hush.paper_algorithm", "hush.paper_sigma_sensitivity", "hush.paper_selected_result");
  const hushCode = keys("hush.system_", "hush.code_", "hush.gui.", "hush.paper_code_conflicts");
  const field = keys("field.");
  const combine = (...sets) => unique(sets.flat());
  const configSpecs = [
    { repair: 0, atomKeys: traceCollector },
    { repair: 1, atomKeys: combine(traceCollector, screenPreprocessing) },
    { repair: 2, atomKeys: combine(traceCollector, screenPreprocessing, powerModelS3) },
    { repair: 2, atomKeys: combine(traceCollector, screenPreprocessing, powerModelS4) },
    { repair: 3, atomKeys: combine(traceCollector, screenPreprocessing, powerModel, energyOutputs, keys("bfc.definition", "bfc.stability_window", "simulation.staleness")) },
    ...[0, 1, 2].map(() => ({ repair: 4, atomKeys: combine(traceCollector, screenPreprocessing, powerModel, energyOutputs, bfcCore, keys("bfc.beta_sensitivity", "bfc.prepared_beta_sensitivity_update")) })),
    ...[0, 1, 2, 3].map(() => ({ repair: 5, atomKeys: combine(traceCollector, screenPreprocessing, powerModel, energyOutputs, bfcCore, keys("bfc.alpha_sensitivity", "bfc.prepared_alpha_sensitivity_suppression", "simulation.bfc_alpha_0_1_result", "simulation.bfc_alpha_0_8_result")) })),
    { repair: 6, atomKeys: combine(traceCollector, screenPreprocessing, powerModel, energyOutputs, bfcCore, keys("simulation.optimal_comparator", "simulation.optimal_result")) },
    ...[0, 1, 2].map(() => ({ repair: 7, atomKeys: combine(traceCollector, screenPreprocessing, powerModel, energyOutputs, bfcCore, hushPaper) })),
    { repair: 8, atomKeys: hushCode },
    { repair: 9, atomKeys: combine(traceCollector, screenPreprocessing, powerModel, energyOutputs, hushPaper, hushCode, field) },
    { repair: 9, atomKeys: combine(traceCollector, screenPreprocessing, powerModel, energyOutputs, field) },
  ].map((spec, index) => ({ ...spec, ...audit.configuration_verdicts[index] }));
  if (configSpecs.length !== 19) throw new Error("HUSH configuration inventory drift");

  // Every verdict preserves topology, but campaign jobs are not paper presets.
  const targetRows = atomRows.sort((left, right) => left.method_setting_id.localeCompare(right.method_setting_id));
  const targetIds = new Set(targetRows.map((row) => row.method_setting_id));
  if (targetRows.length !== 87 || targetIds.size !== targetRows.length) throw new Error("HUSH repaired setting inventory drift");
  const coveredAtomKeys = new Set(configSpecs.flatMap((spec) => spec.atomKeys));
  const missingAtomKeys = audit.disclosed_atoms.map((atom) => atom.key).filter((key) => !coveredAtomKeys.has(key));
  if (missingAtomKeys.length) throw new Error(`HUSH execution-unit mapping omits atoms: ${missingAtomKeys.join(", ")}`);

  if (selectableConfigurationVerdicts(configSpecs).length) {
    throw new Error("HUSH sensitivity jobs are not independent paper presets");
  }
  const devicePowerKeys = [
    "model.cpu_s3_matrix", "model.cpu_s4_matrix", "model.soc_suspend", "model.wifi_beacon",
    "model.cellular_paging", "model.screen_matrix", "model.gpu_matrix", "model.radio_fsm_matrix",
  ];
  const devicePowerIds = devicePowerKeys.map((key) => atomRowByKey.get(key)?.method_setting_id);
  if (devicePowerIds.some((id) => !id)) throw new Error("HUSH device power bundle atom missing");
  const devicePowerLocators = locators(audit.source_configuration_repairs[2].locator);
  const devicePowerGroup = {
    method_configuration_group_id: `source-audit-device-group-${sha256Bytes(`${sourceWorkId}\0device_power_model`).slice(7, 31)}`,
    method_configuration_group_kind: "coherent_device_specific_alternatives",
    method_configuration_axis: ["device_power_model"],
    method_selection_semantics: "source_device_identity_binds_power_bundle_no_user_selection",
    method_cross_product_policy: "device_specific_no_cross_product",
    method_configuration_levels: audit.source_configuration_repairs[2].levels.map((label, index) => {
      const ownCpuId = atomRowByKey.get(index === 0 ? "model.cpu_s3_matrix" : "model.cpu_s4_matrix").method_setting_id;
      const otherCpuId = atomRowByKey.get(index === 0 ? "model.cpu_s4_matrix" : "model.cpu_s3_matrix").method_setting_id;
      const sharedIds = devicePowerIds.slice(2);
      return {
        method_configuration_level_id: `source-audit-device-level-${sha256Bytes(`${sourceWorkId}\0${label}`).slice(7, 31)}`,
        method_configuration_level_label: label,
        included_method_setting_ids: [ownCpuId],
        excluded_method_setting_ids: [otherCpuId],
        common_method_setting_ids: sharedIds,
        branch_method_setting_ids: [ownCpuId],
        documentary_method_setting_ids: [],
        unresolved_method_setting_ids: [ownCpuId, ...sharedIds],
        source_locators: devicePowerLocators,
      };
    }),
    documentary_method_setting_ids: [],
    unresolved_method_setting_ids: devicePowerIds,
    source_locators: devicePowerLocators,
  };
  const campaignGroups = [
    [4, "bfc.beta_sensitivity", "beta", "BFC beta 0.1, 0.5, 0.9 in one sensitivity sweep"],
    [5, "bfc.alpha_sensitivity", "alpha", "BFC alpha 0, 0.1, 0.2, 0.8 with beta 0.5 in one sweep"],
    [7, "hush.paper_sigma_sensitivity", "sigma", "HUSH sigma 1, 1.2, 2 with paper tau_init 1 minute in one sweep"],
  ].map(([repairIndex, atomKey, axis, label]) => {
    const setting = atomRowByKey.get(atomKey);
    if (!setting) throw new Error(`HUSH campaign atom missing: ${atomKey}`);
    const id = sha256Bytes(`${sourceWorkId}\0${atomKey}`).slice(7, 31);
    const sourceLocators = locators(audit.source_configuration_repairs[repairIndex].locator);
    return {
      method_configuration_group_id: `source-audit-campaign-group-${id}`,
      method_configuration_group_kind: "source_sensitivity_campaign",
      method_configuration_axis: [axis],
      method_selection_semantics: "all_source_arms_emitted_in_one_campaign_no_user_selection",
      method_cross_product_policy: "one_factor_campaign_no_cartesian_product",
      method_configuration_levels: [{
        method_configuration_level_id: `source-audit-campaign-level-${id}`,
        method_configuration_level_label: label,
        included_method_setting_ids: [],
        excluded_method_setting_ids: [],
        common_method_setting_ids: [],
        branch_method_setting_ids: [],
        documentary_method_setting_ids: [],
        unresolved_method_setting_ids: [],
        source_locators: sourceLocators,
      }],
      documentary_method_setting_ids: [],
      unresolved_method_setting_ids: [setting.method_setting_id],
      source_locators: sourceLocators,
    };
  });
  const paperSystemKeys = keys("hush.system_");
  const publicPatchKeys = keys("hush.code_", "hush.gui.", "hush.paper_code_conflicts");
  const sensitivityKeys = ["bfc.beta_sensitivity", "bfc.alpha_sensitivity", "hush.paper_sigma_sensitivity"];
  const separatedKeys = new Set([...paperSystemKeys, ...publicPatchKeys, ...field, ...sensitivityKeys]);
  const evidenceKeys = audit.disclosed_atoms.filter((atom) =>
    !separatedKeys.has(atom.key)
      && (["provenance", "reported_result", "evidence_conflict", "evidence_gap"].includes(atom.role)
        || atom.key === "collector.overhead" || atom.key.startsWith("validation.power_")))
    .map((atom) => atom.key);
  const evidenceGroups = [
    ["paper_system_design", "paper_described_framework_design", paperSystemKeys, "rank169.txt:960-984", false],
    ["public_patch", "recovered_public_code_snapshot_unlinked_to_field_build", publicPatchKeys,
      "framework patch:1-1431; Settings patch:1-304", false],
    ["field_evaluation", "two_device_field_component_not_trace_simulation", field,
      "rank169.txt:990-1055", false],
    ["reported_evidence", "source_results_and_provenance_not_method_settings", evidenceKeys,
      audit.source_configuration_repairs[3].locator, true],
  ].map(([key, kind, atomKeys, locator, documentary]) => {
    const ids = atomKeys.map((atomKey) => atomRowByKey.get(atomKey)?.method_setting_id);
    if (ids.some((id) => !id)) throw new Error(`HUSH evidence group ${key} names an unknown atom`);
    const documentaryIds = atomKeys.filter((atomKey) =>
      atomRowByKey.get(atomKey).integration_source.endsWith(":documentary_fact"))
      .map((atomKey) => atomRowByKey.get(atomKey).method_setting_id);
    const documentaryIdSet = new Set(documentaryIds);
    const id = sha256Bytes(`${sourceWorkId}\0${key}`).slice(7, 31);
    const sourceLocators = documentary
      ? unique(atomKeys.flatMap((atomKey) => atomRowByKey.get(atomKey).source_locators))
      : locators(locator);
    return {
      method_configuration_group_id: `source-audit-evidence-group-${id}`,
      method_configuration_group_kind: kind,
      method_configuration_axis: [key],
      method_selection_semantics: "source_component_evidence_no_user_selection",
      method_cross_product_policy: "no_inferred_paper_code_field_equivalence",
      method_configuration_levels: [{
        method_configuration_level_id: `source-audit-evidence-level-${id}`,
        method_configuration_level_label: key,
        included_method_setting_ids: [],
        excluded_method_setting_ids: [],
        common_method_setting_ids: [],
        branch_method_setting_ids: [],
        documentary_method_setting_ids: [],
        unresolved_method_setting_ids: [],
        source_locators: sourceLocators,
      }],
      documentary_method_setting_ids: documentaryIds,
      unresolved_method_setting_ids: ids.filter((settingId) => !documentaryIdSet.has(settingId)),
      source_locators: sourceLocators,
    };
  });
  const nonInvariantIds = new Set([devicePowerGroup, ...campaignGroups, ...evidenceGroups].flatMap((group) =>
    [...group.documentary_method_setting_ids, ...group.unresolved_method_setting_ids]));
  const invariantIds = targetRows.map((row) => row.method_setting_id).filter((id) => !nonInvariantIds.has(id));
  const sourceLocators = unique(targetRows.flatMap((row) => row.source_locators));
  const configurationSpace = {
    method_configuration_space_id: "hush-source-configuration-space-v1",
    method_configuration_structure: "source_declared_axes",
    invariant_method_setting_ids: invariantIds,
    method_configuration_groups: [devicePowerGroup, ...campaignGroups, ...evidenceGroups],
    allowed_method_combinations: [],
    documentary_method_setting_ids: [],
    not_applicable_method_setting_ids: [],
    unresolved_method_setting_ids: invariantIds,
    source_locators: sourceLocators,
  };

  const oldRows = assertions.filter((row) => row.source_work_id === sourceWorkId);
  if (oldRows.length !== 15 || oldRows.some((row) => row.method_implementation_status === "native")) {
    throw new Error("HUSH current 15-setting fail-closed inventory drift");
  }
  const oldToAtomKey = new Map(Object.entries({
    "method-setting-0edada926e13d10e94b16fe0": "collector.coarse.app_cpu",
    "method-setting-22d789ea880524afca68b36f": "collector.event.app_lifecycle",
    "method-setting-282e8e9ed5b88a2355f31c12": "study.trace_duration",
    "method-setting-29345f987893ff8d72f04044": "collector.coarse.per_core_cpu",
    "method-setting-318f9838e4a3b143105ef0d5": "collector.event.battery_level",
    "method-setting-32b1a60594ccb3ef026c8259": "collector.fine.app_network_screen_on",
    "method-setting-445af64761419beb42496786": "collector.fine.app_network_screen_off",
    "method-setting-4a9d456693fec2b21c3c0d8e": "collector.event.wifi_switch",
    "method-setting-524ea7e68e13843f51adaf18": "study.trace_devices",
    "method-setting-60c0528bff6b73f7fa1d92d6": "collector.event.wifi_signal",
    "method-setting-63f3c0e715fe0e481a98f26e": "collector.event.mobile_data_switch",
    "method-setting-a0325bff1361ba1d26a83cf5": "preprocess.uncovered_time",
    "method-setting-ce5cd59257d7d5b215d183cf": "study.trace_duration",
    "method-setting-d11d6372b1c29e2ece38f1e7": "collector.event.screen_switch",
    "method-setting-f0ebc074bef41657868225b6": "study.trace_duration",
  }));
  if (oldToAtomKey.size !== oldRows.length || oldRows.some((row) => !oldToAtomKey.has(row.method_setting_id))) {
    throw new Error("HUSH old-to-audit setting map drift");
  }
  const oldToNewId = new Map([...oldToAtomKey].map(([oldId, key]) => [oldId, atomRowByKey.get(key).method_setting_id]));
  const refreshedTypedSection = (objects) => (objects ?? []).map((object) => {
    if (!Array.isArray(object.method_settings)) return object;
    const mapped = object.method_settings.map((setting) => atomRowByKey.get(oldToAtomKey.get(setting.method_setting_id)))
      .filter(Boolean);
    return { ...object, method_settings: [...new Map(mapped.map((setting) => [setting.method_setting_id, setting])).values()] };
  });
  const repairedAssertions = assertions.filter((row) => row.source_work_id !== sourceWorkId)
    .concat(targetRows)
    .sort((left, right) => left.source_work_id.localeCompare(right.source_work_id)
      || left.method_setting_id.localeCompare(right.method_setting_id));
  const typedSlots = [
    "acquisition_protocols", "session_construction_policies", "notification_attribution_policies",
    "duration_policies", "timestamp_policies", "parameter_provenance_assertions", "release_profiles",
  ];
  const repairedProfiles = profiles.map((profile) => {
    if (profile.source_work_id !== sourceWorkId) return profile;
    const refreshedTypedSections = Object.fromEntries(typedSlots.map((slot) => [slot, refreshedTypedSection(profile[slot])]));
    return {
      ...profile,
      ...refreshedTypedSections,
      protocol_materialization_blockers: (profile.protocol_materialization_blockers ?? []).map((blocker) => ({
        ...blocker,
        blocked_method_setting_ids: unique((blocker.blocked_method_setting_ids ?? []).map((id) => oldToNewId.get(id) ?? id)),
      })),
      source_method_variant_id: configurationSpace.method_configuration_space_id,
      source_method_variant_label: "HUSH/eStar trace campaign; code and field evidence unlinked",
      method_configuration_structure: "source_declared_axes",
      method_configuration_space: configurationSpace,
      method_profile_version: "literature-sublation-v3-atomic+hush-source-complete-v1",
      method_setting_ids: targetRows.map((row) => row.method_setting_id),
      method_setting_count: targetRows.length,
      profile_implementation_status: "blocked",
      source_locators: sourceLocators,
    };
  });
  const repairedSpaces = spaces.map((space) => space.source_work_id === sourceWorkId ? {
    ...space,
    source_configuration_space_id: configurationSpace.method_configuration_space_id,
    space_kind: "selectable_axis_or_campaign",
    space_facets: {
      ...space.space_facets,
      has_fixed_configuration: false,
      has_selectable_axis_or_campaign: true,
      has_conditional_state_machine: false,
      has_unresolved_or_evidence_blocked_material: true,
    },
    all_method_setting_ids: targetRows.map((row) => row.method_setting_id),
    method_setting_count: targetRows.length,
    source_locators: sourceLocators,
  } : space);
  const oldStructured = oldRows.filter((row) => row.method_configuration_json).length;
  const oldAlternatives = oldRows.filter((row) => row.method_variant_relation === "ALTERNATIVE").length;
  return { assertions: repairedAssertions, profiles: repairedProfiles, spaces: repairedSpaces, summary: {
    audited_disclosed_atoms: audit.disclosed_atoms.length,
    covered_disclosed_atoms: coveredAtomKeys.size,
    replaced_existing_settings: oldRows.length,
    canonical_atom_settings: atomRows.length,
    canonical_configuration_settings: 0,
    canonical_settings: targetRows.length,
    source_configurations: 1,
    net_added_settings: targetRows.length - oldRows.length,
    configuration_structured_delta: -oldStructured,
    explicit_variant_delta: -oldAlternatives,
    completed_configurations: 0,
    source_evidence_fail_closed: true,
    validation_passed: true,
  } };
}

function refreshPacketProtocolBlockerScopes(packetProfile, currentProfile) {
  const currentBlockers = currentProfile?.protocol_materialization_blockers ?? [];
  const byId = new Map(currentBlockers.map((blocker) => [blocker.protocol_materialization_blocker_id, blocker]));
  if (packetProfile.source_work_id !== currentProfile?.source_work_id
    || byId.size !== currentBlockers.length
    || byId.size !== packetProfile.protocol_materialization_blockers.length) {
    throw new Error("packet protocol blocker identity/count drift");
  }
  return {
    ...packetProfile,
    protocol_materialization_blockers: packetProfile.protocol_materialization_blockers.map((blocker) => {
      const ids = byId.get(blocker.protocol_materialization_blocker_id)?.blocked_method_setting_ids;
      if (!ids?.length || ids.some((id) => !blocker.blocked_method_setting_ids.includes(id))) {
        throw new Error("packet protocol blocker scope is missing or crosses original object membership");
      }
      return { ...blocker, blocked_method_setting_ids: ids };
    }),
  };
}

function runPacket09ValidatorProjection(assertions, profiles) {
  const refreshPacket = process.env.CHRONICLE_REFRESH_PACKET09 === "1";
  const replayRoot = resolve(run, `packet09-canonical-integration-validator-replay-${process.pid}`);
  const replayPrivateRoot = resolve(replayRoot, ".tmp-literature-review-private");
  const replayPacketDirectory = resolve(replayPrivateRoot, "packet09-canonical-integration-prep-20260831");
  const replaySublationDirectory = resolve(replayPrivateRoot, "ontology-sublation-20260831");
  const replaySettingsPath = resolve(replaySublationDirectory, "adjudicated-method-setting-assertions.jsonl");
  const replayProfilesPath = resolve(replaySublationDirectory, "adjudicated-study-method-profiles.jsonl");
  const wrapperPath = resolve(replayRoot, "run_packet09_builder_projection.py");
  const harnessPath = resolve(replayRoot, "run_packet09_validator_projection.py");
  const upstreamManifest = jsonl(resolve(packet09IntegrationDirectory, "upstream-manifest.jsonl"));
  const canonicalSettingsRelative = ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-setting-assertions.jsonl";
  const canonicalProfilesRelative = ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-study-method-profiles.jsonl";
  const projectedPrivateSources = [screenPolicyExtensionMappingPath, inputAdapterImplementationMappingPath];
  const projectedPrivateRelative = projectedPrivateSources.map((path) => relative(repo, path));
  const makePrivateDirectory = (path) => {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  };
  rmSync(replayRoot, { recursive: true, force: true });
  makePrivateDirectory(replayRoot);
  makePrivateDirectory(replayPrivateRoot);
  cpSync(packet09IntegrationDirectory, replayPacketDirectory, { recursive: true, preserveTimestamps: true });
  chmodSync(replayPacketDirectory, 0o700);
  makePrivateDirectory(replaySublationDirectory);
  writeJsonl(replaySettingsPath, assertions);
  writeJsonl(replayProfilesPath, profiles);
  symlinkSync(resolve(repo, "web"), resolve(replayRoot, "web"), "dir");
  symlinkSync(resolve(repo, "rust"), resolve(replayRoot, "rust"), "dir");
  for (const row of upstreamManifest) {
    if (row.path === canonicalSettingsRelative || row.path === canonicalProfilesRelative
      || row.path.startsWith("web/") || row.path.startsWith("rust/")) continue;
    const projected = resolve(replayRoot, row.path);
    makePrivateDirectory(dirname(projected));
    symlinkSync(resolve(repo, row.path), projected, "file");
  }
  for (const source of projectedPrivateSources) {
    const projected = resolve(replayRoot, relative(repo, source));
    if (existsSync(projected)) continue;
    makePrivateDirectory(dirname(projected));
    symlinkSync(source, projected, "file");
  }
  const pythonPath = (path) => JSON.stringify(path);
  const projectionOverrides = `
builder.OUT = Path(${pythonPath(replayPacketDirectory)})
builder.CANONICAL_SETTINGS = Path(${pythonPath(replaySettingsPath)})
builder.CANONICAL_PROFILES = Path(${pythonPath(replayProfilesPath)})
_original_rel = builder.rel
def _projection_rel(path):
    if path == builder.CANONICAL_SETTINGS:
        return ${JSON.stringify(canonicalSettingsRelative)}
    if path == builder.CANONICAL_PROFILES:
        return ${JSON.stringify(canonicalProfilesRelative)}
    return _original_rel(path)
builder.rel = _projection_rel
`;
  write(wrapperPath, `from importlib.util import module_from_spec, spec_from_file_location\nfrom pathlib import Path\n\n_spec = spec_from_file_location("packet09_projection_builder", Path(${pythonPath(resolve(packet09IntegrationDirectory, "build_packet.py"))}))\nbuilder = module_from_spec(_spec)\n_spec.loader.exec_module(builder)\n${projectionOverrides}\nprint(builder.canonical_json(builder.build()))\n`);
  write(harnessPath, `from importlib.util import module_from_spec, spec_from_file_location\nfrom pathlib import Path\n\n_spec = spec_from_file_location("packet09_projection_validator", Path(${pythonPath(packet09ValidatorPath)}))\nvalidator = module_from_spec(_spec)\n_spec.loader.exec_module(validator)\nvalidator.OUT = Path(${pythonPath(replayPacketDirectory)})\nvalidator.REPO = Path(${pythonPath(replayRoot)})\nvalidator.BUILD_SCRIPT = Path(${pythonPath(wrapperPath)})\nbuilder = validator.builder\n${projectionOverrides}\n_upstream_path = validator.OUT / "upstream-manifest.jsonl"\n_upstream = validator.read_jsonl(_upstream_path)\nfor _row in _upstream:\n    if _row["path"] == ${JSON.stringify(canonicalSettingsRelative)}:\n        _path = builder.CANONICAL_SETTINGS\n    elif _row["path"] == ${JSON.stringify(canonicalProfilesRelative)}:\n        _path = builder.CANONICAL_PROFILES\n    elif _row["path"].startswith(("web/", "rust/")) or _row["path"] in ${JSON.stringify(projectedPrivateRelative)}:\n        _path = validator.REPO / _row["path"]\n    else:\n        continue\n    _row["byte_size"] = _path.stat().st_size\n    _row["sha256"] = validator.sha_file(_path)\nbuilder.write_jsonl(_upstream_path, _upstream)\nbuilder.build()\nvalidator.issue_checksums()\nvalidator.main()\n`);
  let execution;
  try {
    execution = spawnSync(process.env.PYTHON ?? "python3", [harnessPath], {
      cwd: replayRoot,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      maxBuffer: 32 * 1024 * 1024,
    });
    if (execution.status !== 0) {
      throw new Error(`packet-09 integration validator failed:\n${execution.stdout}\n${execution.stderr}`);
    }
    const replayValidation = JSON.parse(readFileSync(resolve(replayPacketDirectory, "validation.json"), "utf8"));
    if (replayValidation.result !== "PASS"
      || replayValidation.profiles !== 12
      || replayValidation.source_settings !== 105
      || replayValidation.atomic_settings !== 177
      || replayValidation.configuration_groups !== 105
      || replayValidation.configuration_levels !== 113
      || replayValidation.evidence_blockers !== 4
      || replayValidation.native + replayValidation.implementation_blockers
        + replayValidation.evidence_blockers !== 177
      || replayValidation.adversarial_mutations_rejected !== 28) {
      throw new Error("packet-09 isolated validator projection did not pass the exact corpus gates");
    }
    if (refreshPacket) {
      for (const entry of readdirSync(replayPacketDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || ["build_packet.py", "validate_packet.py"].includes(entry.name)) continue;
        copyFileSync(resolve(replayPacketDirectory, entry.name), resolve(packet09IntegrationDirectory, entry.name));
        chmodSync(resolve(packet09IntegrationDirectory, entry.name), 0o600);
      }
      return execution;
    }
    const originalUpstream = jsonl(resolve(packet09IntegrationDirectory, "upstream-manifest.jsonl"));
    const projectedInputPaths = new Set([
      canonicalSettingsRelative,
      canonicalProfilesRelative,
      ...projectedPrivateRelative,
      ...originalUpstream.map((row) => row.path).filter((path) => path.startsWith("web/") || path.startsWith("rust/")),
    ]);
    const replayUpstream = jsonl(resolve(replayPacketDirectory, "upstream-manifest.jsonl"));
    if (!isDeepStrictEqual(originalUpstream.map((row) => row.path), replayUpstream.map((row) => row.path))
      || originalUpstream.some((row, index) =>
        !projectedInputPaths.has(row.path) && !isDeepStrictEqual(row, replayUpstream[index]))) {
      throw new Error("packet-09 replay changed an immutable upstream input");
    }
    const stableNativeProof = (directory) => jsonl(resolve(directory, "native-proof.jsonl"))
      .map(({ fixture_manifest_sha256: _fixtureManifest, mapping_sha256: _mapping, slot_evidence: _slotEvidence, ...row }) => row);
    if (!isDeepStrictEqual(
      stableNativeProof(packet09IntegrationDirectory),
      stableNativeProof(replayPacketDirectory),
    )) {
      throw new Error("packet-09 current runtime changed native proof semantics rather than only evidence-file anchors");
    }
    const replayDynamicFiles = new Set([
      "upstream-manifest.jsonl", "native-proof.jsonl", "rust-conformance.json",
      "determinism.json", "validation.json",
    ]);
    const unchangedProofFiles = jsonl(resolve(packet09IntegrationDirectory, "checksums.jsonl"))
      .map((row) => row.path)
      .filter((path) => !replayDynamicFiles.has(path));
    const currentProfileByWork = new Map(profiles.map((profile) => [profile.source_work_id, profile]));
    const changedProofFiles = unchangedProofFiles.filter((path) => {
      if (path === "mapped-profiles.jsonl") {
        const expected = jsonl(resolve(packet09IntegrationDirectory, path)).map((profile) =>
          refreshPacketProtocolBlockerScopes(profile, currentProfileByWork.get(profile.source_work_id)));
        return !isDeepStrictEqual(expected, jsonl(resolve(replayPacketDirectory, path)));
      }
      return sha256(resolve(packet09IntegrationDirectory, path)) !== sha256(resolve(replayPacketDirectory, path));
    });
    if (changedProofFiles.length) {
      throw new Error(`packet-09 replay changed a source-derived payload outside the projected current-input proofs: ${changedProofFiles.join(", ")}`);
    }
  } finally {
    rmSync(replayRoot, { recursive: true, force: true });
  }
  return execution;
}

function applyPacket09IntegrationOverlay(assertions, profiles) {
  requirePrivate(packet09IntegrationDirectory, 0o700);
  for (const path of [
    packet09ValidatorPath,
    packet09ValidationPath,
    packet09ChecksumsPath,
    packet09DetachedChecksumPath,
    packet09IdentityPath,
    packet09SourceSettingMapPath,
    packet09AtomicSettingsPath,
    packet09MappedProfilesPath,
    packet09ConfigurationGroupsPath,
    packet09ConfigurationLevelsPath,
    packet09StructuredProtocolCandidatesPath,
    packet09ImplementationClassificationPath,
  ]) requirePrivate(path, 0o600);

  if (sha256(packet09ValidationPath) !== packet09PinnedHashes.validation
    || sha256(packet09ChecksumsPath) !== packet09PinnedHashes.checksums
    || sha256(packet09DetachedChecksumPath) !== packet09PinnedHashes.detached_checksum
    || readFileSync(packet09DetachedChecksumPath, "utf8")
      !== `${packet09PinnedHashes.checksums.slice(7)}  checksums.jsonl\n`) {
    throw new Error("packet-09 pinned validation or detached-checksum identity drift");
  }
  runPacket09ValidatorProjection(assertions, profiles);

  const validation = JSON.parse(readFileSync(packet09ValidationPath, "utf8"));
  const validationClassifications = jsonl(packet09ImplementationClassificationPath);
  const validationClassificationCounts = Object.fromEntries(
    [...Map.groupBy(validationClassifications, (row) => row.classification).entries()]
      .map(([classification, rows]) => [classification, rows.length]),
  );
  const expectedValidation = {
    result: "PASS",
    schema_version: "packet09-validation/v2",
    profiles: 12,
    source_settings: 105,
    atomic_settings: 177,
    configuration_groups: 105,
    configuration_levels: 113,
    structured_protocol_candidates: 103,
    corrected_locators: 27,
    native: validationClassificationCounts.NATIVE_PROVEN,
    implementation_blockers: validationClassificationCounts.IMPLEMENTATION_BLOCKER,
    evidence_blockers: 4,
    source_text_byte_hashes: 12,
    adversarial_mutations_rejected: 28,
    determinism_sha256: sha256(resolve(packet09IntegrationDirectory, "determinism.json")).slice(7),
    mutation_matrix_sha256: sha256(resolve(packet09IntegrationDirectory, "adversarial-mutation-results.jsonl")).slice(7),
    rust_receipt_sha256: sha256(resolve(packet09IntegrationDirectory, "rust-conformance.json")).slice(7),
  };
  if (Object.entries(expectedValidation).some(([key, value]) => !isDeepStrictEqual(validation[key], value))) {
    throw new Error("packet-09 pinned validation counts or proof identities drift");
  }

  const checksums = jsonl(packet09ChecksumsPath);
  if (checksums.length !== 26 || new Set(checksums.map((row) => row.path)).size !== checksums.length) {
    throw new Error("packet-09 checksum inventory count or identity drift");
  }
  for (const row of checksums) {
    const path = resolve(packet09IntegrationDirectory, row.path);
    if (!path.startsWith(`${packet09IntegrationDirectory}/`)
      || !existsSync(path)
      || (statSync(path).mode & 0o777) !== 0o600
      || statSync(path).size !== row.byte_size
      || sha256(path).slice(7) !== row.sha256) {
      throw new Error(`packet-09 checksum inventory drift: ${row.path}`);
    }
  }

  const identities = JSON.parse(readFileSync(packet09IdentityPath, "utf8"));
  const sourceRows = jsonl(packet09SourceSettingMapPath);
  const packetAssertions = jsonl(packet09AtomicSettingsPath);
  const packetProfiles = jsonl(packet09MappedProfilesPath);
  const configurationGroups = jsonl(packet09ConfigurationGroupsPath);
  const configurationLevels = jsonl(packet09ConfigurationLevelsPath);
  const structuredProtocolCandidates = jsonl(packet09StructuredProtocolCandidatesPath);
  const classifications = jsonl(packet09ImplementationClassificationPath);
  const exactIdentity = (actual, expected, label) => {
    if (new Set(actual).size !== actual.length
      || new Set(expected).size !== expected.length
      || !isDeepStrictEqual([...actual].sort(), [...expected].sort())) {
      throw new Error(`packet-09 ${label} exact identity-set equality failed`);
    }
  };
  const reconcileConfigurationIdentity = (currentSpace, packetSpace, sourceWorkId) => {
    const partitionKey = (level) => JSON.stringify({
      included: [...(level.included_method_setting_ids ?? [])].sort(),
      excluded: [...(level.excluded_method_setting_ids ?? [])].sort(),
    });
    const currentLevels = currentSpace.method_configuration_groups.flatMap((group) =>
      group.method_configuration_levels.map((level) => ({ group, level })));
    const settingUnion = (space) => new Set([
      ...(space.invariant_method_setting_ids ?? []),
      ...(space.documentary_method_setting_ids ?? []),
      ...(space.unresolved_method_setting_ids ?? []),
      ...space.method_configuration_groups.flatMap((group) => [
        ...(group.documentary_method_setting_ids ?? []),
        ...(group.unresolved_method_setting_ids ?? []),
        ...group.method_configuration_levels.flatMap((level) => [
          ...(level.included_method_setting_ids ?? []),
          ...(level.documentary_method_setting_ids ?? []),
          ...(level.unresolved_method_setting_ids ?? []),
        ]),
      ]),
    ]);
    const currentSettingIds = settingUnion(currentSpace);
    const packetSettingIds = settingUnion(packetSpace);
    if (!isDeepStrictEqual([...currentSettingIds].sort(), [...packetSettingIds].sort())) {
      throw new Error(`${sourceWorkId}: packet-09 configuration setting ownership drift`);
    }
    const usedLevelIds = new Set();
    const usedGroupIds = new Set();
    const method_configuration_groups = packetSpace.method_configuration_groups.map((packetGroup) => {
      const matched = packetGroup.method_configuration_levels.map((packetLevel) => {
        const candidates = currentLevels.filter(({ level }) =>
          !usedLevelIds.has(level.method_configuration_level_id)
          && partitionKey(level) === partitionKey(packetLevel));
        if (candidates.length !== 1) {
          throw new Error(`${sourceWorkId}: packet-09 configuration level does not map one-to-one to the canonical source partition`);
        }
        usedLevelIds.add(candidates[0].level.method_configuration_level_id);
        return {
          group: candidates[0].group,
          level: {
            ...packetLevel,
            method_configuration_level_id: candidates[0].level.method_configuration_level_id,
          },
        };
      });
      const groupIds = new Set(matched.map(({ group }) => group.method_configuration_group_id));
      const emptyGroupCandidates = matched.length === 0
        ? currentSpace.method_configuration_groups.filter((group) =>
          !usedGroupIds.has(group.method_configuration_group_id)
          && group.method_configuration_levels.length === 0)
        : [];
      if (groupIds.size !== 1 && emptyGroupCandidates.length !== 1) {
        throw new Error(`${sourceWorkId}: packet-09 configuration group crosses canonical source groups`);
      }
      const groupId = matched.length === 0
        ? emptyGroupCandidates[0].method_configuration_group_id
        : [...groupIds][0];
      if (!usedGroupIds.add(groupId)) {
        throw new Error(`${sourceWorkId}: packet-09 configuration groups do not map one-to-one`);
      }
      return {
        ...packetGroup,
        method_configuration_group_id: groupId,
        method_configuration_levels: matched.map(({ level }) => level),
      };
    });
    if (usedLevelIds.size !== currentLevels.length
      || usedGroupIds.size !== currentSpace.method_configuration_groups.length) {
      throw new Error(`${sourceWorkId}: packet-09 configuration overlay omitted canonical source levels`);
    }
    return {
      ...packetSpace,
      method_configuration_space_id: currentSpace.method_configuration_space_id,
      method_configuration_groups,
      allowed_method_combinations: currentSpace.allowed_method_combinations ?? [],
    };
  };
  exactIdentity(packetAssertions.map((row) => row.method_setting_id), identities.atomic_setting_identity_set, "atomic settings");
  exactIdentity(sourceRows.map((row) => row.input_setting_id), identities.input_setting_identity_set, "source rows");
  exactIdentity(packetProfiles.map((row) => row.method_profile_id),
    packetProfiles.map((row) => row.method_profile_id), "canonical profile IDs");
  exactIdentity(packetProfiles.map((row) => row.source_work_id), identities.input_profile_work_identity_set, "input profile works");
  exactIdentity(packetProfiles.map((row) => row.source_work_id), identities.mapped_profile_work_identity_set, "mapped profile works");
  exactIdentity(packetProfiles.flatMap((row) => row.method_setting_ids), identities.atomic_setting_identity_set, "profile atom coverage");
  exactIdentity(sourceRows.flatMap((row) => row.atomic_setting_ids), identities.atomic_setting_identity_set, "source-row atom coverage");
  if (packetAssertions.length !== 177 || sourceRows.length !== 105 || packetProfiles.length !== 12
    || sourceRows.some((row) => row.atomic_setting_count !== row.atomic_setting_ids.length
      || row.all_clauses_accounted !== true
      || row.complete_source_value_preserved_on_every_atom !== true)) {
    throw new Error("packet-09 replay coverage or source-row semantic preservation drift");
  }

  const packetAssertionById = new Map(packetAssertions.map((row) => [row.method_setting_id, row]));
  for (const row of sourceRows) {
    if (row.atomic_setting_ids.some((id) => {
      const atom = packetAssertionById.get(id);
      return !atom || atom.source_extraction_id !== row.source_extraction_id
        || atom.source_work_id !== row.source_work_id
        || atom.source_value_sha256 !== row.source_value_sha256;
    })) throw new Error(`${row.input_setting_id}: packet-09 source-row to atom lineage drift`);
  }

  const nestedGroups = packetProfiles.flatMap((profile) =>
    profile.method_configuration_space.method_configuration_groups);
  const nestedLevels = nestedGroups.flatMap((group) => group.method_configuration_levels);
  const sortBy = (rows, key) => [...rows].sort((left, right) => left[key].localeCompare(right[key]));
  exactIdentity(configurationGroups.map((row) => row.method_configuration_group_id),
    nestedGroups.map((row) => row.method_configuration_group_id), "configuration groups");
  exactIdentity(configurationLevels.map((row) => row.method_configuration_level_id),
    nestedLevels.map((row) => row.method_configuration_level_id), "configuration levels");
  if (configurationGroups.length !== 105 || configurationLevels.length !== 113
    || !isDeepStrictEqual(sortBy(configurationGroups, "method_configuration_group_id"),
      sortBy(nestedGroups, "method_configuration_group_id"))
    || !isDeepStrictEqual(sortBy(configurationLevels, "method_configuration_level_id"),
      sortBy(nestedLevels, "method_configuration_level_id"))) {
    throw new Error("packet-09 profile configuration structures are not the exact validated structures");
  }
  exactIdentity(structuredProtocolCandidates.map((row) => row.structured_protocol_candidate_id),
    structuredProtocolCandidates.map((row) => row.structured_protocol_candidate_id), "structured protocol candidates");
  exactIdentity(structuredProtocolCandidates.map((row) => row.method_setting_id),
    structuredProtocolCandidates.map((row) => row.method_setting_id), "structured protocol candidate settings");
  if (structuredProtocolCandidates.length !== 103
    || structuredProtocolCandidates.some((row) => !packetAssertionById.has(row.method_setting_id))) {
    throw new Error("packet-09 structured protocol candidate coverage drift");
  }

  exactIdentity(classifications.map((row) => row.method_setting_id), identities.atomic_setting_identity_set,
    "implementation classifications");
  const classificationCounts = Object.fromEntries([...Map.groupBy(classifications, (row) => row.classification).entries()]
    .map(([classification, rows]) => [classification, rows.length]));
  if (classificationCounts.NATIVE_PROVEN !== validation.native
    || classificationCounts.IMPLEMENTATION_BLOCKER !== validation.implementation_blockers
    || classificationCounts.EVIDENCE_BLOCKER !== 4
    || classifications.some((row) => {
      const atom = packetAssertionById.get(row.method_setting_id);
      return !atom
        || row.source_extraction_id !== atom.source_extraction_id
        || row.source_work_id !== atom.source_work_id
        || row.method_implementation_status !== atom.method_implementation_status
        || (row.method_execution_blocker_code ?? null) !== (atom.method_execution_blocker_code ?? null);
    })) {
    throw new Error("packet-09 exact per-setting implementation/evidence classification drift");
  }
  const nativeIds = classifications.filter((row) => row.classification === "NATIVE_PROVEN")
    .map((row) => row.method_setting_id).sort();

  const currentAssertionById = new Map(assertions.map((row) => [row.method_setting_id, row]));
  const packetOwnedAssertionFields = new Set([
    "source_locators", "source_clause_ids", "source_clause_path", "source_clause_start",
    "source_clause_end", "source_clause_text",
  ]);
  const withoutFields = (row, fields) => Object.fromEntries(Object.entries(row)
    .filter(([key]) => !fields.has(key)));
  let replacedSourceLocatorAtoms = 0;
  for (const packetAssertion of packetAssertions) {
    const current = currentAssertionById.get(packetAssertion.method_setting_id);
    if (!current) throw new Error(`${packetAssertion.method_setting_id}: packet-09 canonical setting is missing`);
    const conflictingFields = [...new Set([...Object.keys(current), ...Object.keys(packetAssertion)])]
      .filter((key) => !packetOwnedAssertionFields.has(key)
        && !isDeepStrictEqual(current[key], packetAssertion[key]));
    if (conflictingFields.length) {
      throw new Error(`${packetAssertion.method_setting_id}: packet-09 canonical semantic conflict: ${conflictingFields.join(",")}`);
    }
    if (!isDeepStrictEqual(current.source_locators, packetAssertion.source_locators)) replacedSourceLocatorAtoms += 1;
    if (!isDeepStrictEqual(withoutFields(current, packetOwnedAssertionFields),
      withoutFields(packetAssertion, packetOwnedAssertionFields))) {
      throw new Error(`${packetAssertion.method_setting_id}: packet-09 non-owned assertion drift`);
    }
  }
  const packetIdSet = new Set(packetAssertions.map((row) => row.method_setting_id));
  const currentNativePacketIds = assertions.filter((row) => packetIdSet.has(row.method_setting_id)
    && row.method_implementation_status === "native").map((row) => row.method_setting_id).sort();
  if (!isDeepStrictEqual(currentNativePacketIds, nativeIds)) {
    throw new Error("packet-09 canonical integration would add or remove a native status");
  }

  const overlaidAssertions = assertions.map((row) => {
    const packetAssertion = packetAssertionById.get(row.method_setting_id);
    if (!packetAssertion) return row;
    return {
      ...row,
      ...Object.fromEntries([...packetOwnedAssertionFields]
        .filter((key) => Object.hasOwn(packetAssertion, key))
        .map((key) => [key, packetAssertion[key]])),
    };
  });
  if (overlaidAssertions.length !== assertions.length
    || new Set(overlaidAssertions.map((row) => row.method_setting_id)).size !== overlaidAssertions.length) {
    throw new Error("packet-09 overlay duplicated or removed canonical assertions");
  }

  const packetProfileByWork = new Map(packetProfiles.map((row) => [row.source_work_id, row]));
  const typedProtocolSlots = [
    "acquisition_protocols", "session_construction_policies", "notification_attribution_policies",
    "duration_policies", "timestamp_policies", "parameter_provenance_assertions", "release_profiles",
  ];
  const packetOwnedProfileFields = new Set([
    "source_method_cohort", "source_method_platform", "source_locators",
    "method_configuration_structure", "method_configuration_space", "protocol_materialization_blockers",
    ...typedProtocolSlots,
  ]);
  const currentProfileByWork = new Map(profiles.map((row) => [row.source_work_id, row]));
  for (const packetProfile of packetProfiles) {
    const current = currentProfileByWork.get(packetProfile.source_work_id);
    if (!current) throw new Error(`${packetProfile.source_work_id}: packet-09 canonical profile is missing`);
    const conflictingFields = [...new Set([...Object.keys(current), ...Object.keys(packetProfile)])]
      .filter((key) => !packetOwnedProfileFields.has(key)
        && !isDeepStrictEqual(current[key], packetProfile[key]));
    if (conflictingFields.length) {
      throw new Error(`${packetProfile.source_work_id}: packet-09 canonical profile semantic conflict: ${conflictingFields.join(",")}`);
    }
  }
  const canonicalAssertionsById = new Map(overlaidAssertions.map((row) => [row.method_setting_id, row]));
  const overlaidProfiles = profiles.map((profile) => {
    const packetProfile = packetProfileByWork.get(profile.source_work_id);
    if (!packetProfile) return profile;
    const packetProtocols = Object.fromEntries(typedProtocolSlots
      .map((slot) => [slot, packetProfile[slot] ?? []]));
    return {
      ...profile,
      source_method_cohort: packetProfile.source_method_cohort,
      source_method_platform: packetProfile.source_method_platform,
      source_locators: packetProfile.source_locators,
      method_configuration_structure: packetProfile.method_configuration_structure,
      method_configuration_space: reconcileConfigurationIdentity(
        profile.method_configuration_space,
        packetProfile.method_configuration_space,
        profile.source_work_id,
      ),
      ...refreshProtocolMethodSettings(packetProtocols, packetProfile, canonicalAssertionsById),
      protocol_materialization_blockers: refreshPacketProtocolBlockerScopes(packetProfile, profile).protocol_materialization_blockers,
    };
  });
  if (overlaidProfiles.length !== profiles.length
    || new Set(overlaidProfiles.map((row) => row.source_work_id)).size !== overlaidProfiles.length) {
    throw new Error("packet-09 overlay duplicated or removed canonical profiles");
  }
  exactIdentity(
    overlaidProfiles.flatMap((profile) => profile.method_configuration_space.method_configuration_groups
      .flatMap((group) => group.method_configuration_levels.map((level) => level.method_configuration_level_id))),
    profiles.flatMap((profile) => profile.method_configuration_space.method_configuration_groups
      .flatMap((group) => group.method_configuration_levels.map((level) => level.method_configuration_level_id))),
    "canonical source configuration levels after overlay",
  );
  if (overlaidProfiles.some((profile) =>
    profile.source_method_variant_id !== profile.method_configuration_space.method_configuration_space_id)) {
    throw new Error("packet-09 outer source method variant must equal its canonical configuration-space identity");
  }
  return {
    assertions: overlaidAssertions,
    profiles: overlaidProfiles,
    summary: {
      schema_version: "packet09-canonical-integration/v1",
      validator_executed: true,
      validation_sha256: packet09PinnedHashes.validation,
      checksums_sha256: packet09PinnedHashes.checksums,
      detached_checksum_sha256: packet09PinnedHashes.detached_checksum,
      profiles: 12,
      source_settings: 105,
      atomic_settings: 177,
      corrected_source_rows: 27,
      corrected_source_locator_atoms: replacedSourceLocatorAtoms,
      configuration_groups: 105,
      configuration_levels: 113,
      structured_protocol_candidates: 103,
      native_settings: validation.native,
      implementation_blockers: validation.implementation_blockers,
      evidence_blockers: 4,
      duplicate_settings_added: 0,
      duplicate_profiles_added: 0,
      invented_combinations: 0,
      private_packet_is_overlay_not_authority: true,
      validation_passed: true,
    },
  };
}

function loadMissingInputAudit(nativeRouteAudits) {
  requirePrivate(missingInputAuditDirectory, 0o700);
  requirePrivate(missingInputAuditDecisionsPath, 0o600);
  requirePrivate(missingInputAuditReportPath, 0o600);
  requirePrivate(missingInputAuditValidationPath, 0o600);
  const validation = JSON.parse(readFileSync(missingInputAuditValidationPath, "utf8"));
  const expectedIds = new Set([...nativeRouteAudits.bySetting]
    .filter(([, audit]) => audit.classification === "missing_input")
    .map(([id]) => id));
  const rows = jsonl(missingInputAuditDecisionsPath);
  if (validation.every_source_id_exactly_once !== true
    || validation.every_decision_has_concrete_schema_path !== true
    || validation.every_decision_has_semantic_artifact_type !== true
    || validation.every_existing_or_extension_has_fixture !== true
    || validation.no_new_or_unavailable_case_has_fabricated_fixture !== true
    || validation.decision_count !== expectedIds.size
    || validation.decisions_sha256 !== sha256(missingInputAuditDecisionsPath)
    || validation.report_sha256 !== sha256(missingInputAuditReportPath)
    || new Set(rows.map((row) => row.method_setting_id)).size !== rows.length
    || rows.length !== expectedIds.size
    || rows.some((row) => !expectedIds.has(row.method_setting_id))) {
    throw new Error("missing-input adapter audit validation or exact identity coverage failed");
  }
  const bySetting = new Map();
  for (const row of rows) {
    const id = requireString(row.method_setting_id, "method_setting_id", "missing-input audit");
    const audit = nativeRouteAudits.bySetting.get(id);
    if (row.schema_version !== "chronicle-missing-input-adapter-audit/v1"
      || !missingInputClassifications.has(row.input_classification)
      || row.source_extraction_id !== audit.decision.source_extraction_id
      || row.source_work_id !== audit.decision.source_work_id
      || !Array.isArray(row.schema_paths) || !row.schema_paths.length
      || !Array.isArray(row.backend_adapter_paths)
      || !Array.isArray(row.gui_upload_surfaces)
      || (row.input_classification !== "source_version_artifact_unavailable"
        && (!row.backend_adapter_paths.length || !row.gui_upload_surfaces.length))
      || typeof row.semantic_input_artifact_type_id !== "string" || !row.semantic_input_artifact_type_id) {
      throw new Error(`${id}: malformed missing-input adapter audit decision`);
    }
    bySetting.set(id, row);
  }
  return {
    bySetting,
    summary: {
      audited_settings: rows.length,
      semantic_artifact_types: validation.semantic_artifact_type_count,
      classifications: validation.classification_counts,
      exact_identity_coverage: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function loadExternalExecutorAudit(operatorContract) {
  requirePrivate(externalExecutorAuditDirectory, 0o700);
  requirePrivate(externalExecutorAuditDecisionsPath, 0o600);
  requirePrivate(externalExecutorAuditValidationPath, 0o600);
  const validation = JSON.parse(readFileSync(externalExecutorAuditValidationPath, "utf8"));
  const expectedIds = new Set(operatorContract.setting_routes
    .filter((route) => route.destination_route === "external_named_executor")
    .map((route) => route.method_setting_id));
  const rows = jsonl(externalExecutorAuditDecisionsPath);
  if (validation.pass !== true
    || validation.exact_coverage?.pass !== true
    || validation.preserved_source_variants !== true
    || validation.version_link_policy_pass !== true
    || validation.executable_family_path_contract_pass !== true
    || validation.artifact_paths_exist !== true
    || validation.exact_coverage?.actual_rows !== expectedIds.size
    || new Set(rows.map((row) => row.method_setting_id)).size !== rows.length
    || rows.length !== expectedIds.size
    || rows.some((row) => !expectedIds.has(row.method_setting_id))) {
    throw new Error("external-executor audit validation or exact identity coverage failed");
  }
  const bySetting = new Map();
  for (const row of rows) {
    const id = requireString(row.method_setting_id, "method_setting_id", "external-executor audit");
    if (row.audit_schema_version !== "chronicle-external-executor-sublation-audit/v1"
      || !externalExecutorDispositions.has(row.disposition)
      || typeof row.executor_family_id !== "string" || !row.executor_family_id
      || typeof row.executor_family_version !== "string" || !row.executor_family_version
      || typeof row.execution_readiness !== "string" || !row.execution_readiness
      || row.source_variant_preserved !== true
      || row.demonstrated_version_link_required !== true) {
      throw new Error(`${id}: malformed external-executor audit decision`);
    }
    bySetting.set(id, row);
  }
  return {
    bySetting,
    summary: {
      audited_settings: rows.length,
      executor_families: validation.family_count,
      dispositions: validation.dispositions,
      retained_external_artifact_settings: validation.dispositions.external_artifact_available,
      exact_identity_coverage: true,
      version_link_policy_passed: true,
      validation_passed: true,
      private_inputs: true,
    },
  };
}

function applySourceEvidenceRepair(setting, repair) {
  const id = setting.method_setting_id;
  if (repair.source_extraction_id !== setting.source_extraction_id
    || repair.source_work_id !== setting.source_work_id
    || JSON.stringify(repair.source_locators) !== JSON.stringify(setting.source_locators)
    || repair.source_value_json !== setting.source_value_json) {
    throw new Error(`${id}: source-evidence repair lineage drift`);
  }
  const repaired = {
    ...setting,
    source_clause_ids: repair.source_clause_ids,
    method_setting_role: repair.corrected_method_setting_role,
    method_target_layer: repair.corrected_method_target_layer,
    method_parameter_key: repair.corrected_method_parameter_key,
    method_value_kind: repair.corrected_method_value_kind,
    method_value_json: repair.corrected_method_value_json,
    method_applicability_status: repair.corrected_method_applicability_status,
    method_disclosure_status: repair.corrected_method_disclosure_status,
    method_implementation_status: repair.corrected_method_implementation_status,
    method_execution_route: repair.corrected_method_execution_route,
    method_execution_destination_id: repair.corrected_method_execution_destination_id,
    method_execution_parameter_path: repair.corrected_method_execution_parameter_path,
    method_execution_blocker_code: repair.corrected_method_execution_blocker_code,
    required_inputs: repair.required_inputs,
    mapped_contract_slot: [],
    contract_bindings: [],
    adjudication_confidence: 1,
    adjudication_rationale: repair.repair_rationale,
  };
  const optionalFields = {
    corrected_method_unit: "method_unit",
    corrected_method_comparator: "method_comparator",
    corrected_method_boundary_convention: "method_boundary_convention",
    corrected_source_clause_text: "source_clause_text",
    corrected_source_clause_path: "source_clause_path",
    corrected_source_clause_start: "source_clause_start",
    corrected_source_clause_end: "source_clause_end",
  };
  for (const [source, destination] of Object.entries(optionalFields)) {
    if (Object.hasOwn(repair, source)) repaired[destination] = repair[source];
  }
  if (repair.corrected_structured_protocol_candidate !== null
    && repair.corrected_structured_protocol_candidate !== undefined) {
    repaired.structured_protocol_candidate_json = JSON.stringify(repair.corrected_structured_protocol_candidate);
  } else if (repair.corrected_structured_protocol_candidate_json !== null
    && repair.corrected_structured_protocol_candidate_json !== undefined) {
    repaired.structured_protocol_candidate_json = canonicalJson(repair.corrected_structured_protocol_candidate_json, id);
  } else {
    delete repaired.structured_protocol_candidate_json;
  }
  return compact(repaired);
}

function applyMissingInputAudit(setting, decision) {
  return {
    ...setting,
    method_execution_blocker_code: missingInputBlockerCodes.get(decision.input_classification),
    adjudication_rationale: decision.classification_basis,
  };
}

function applyExternalExecutorAudit(setting, decision) {
  if (decision.source_extraction_id !== setting.source_extraction_id
    || decision.source_work_id !== setting.source_work_id
    || canonicalJson(decision.method_value_json, setting.method_setting_id) !== canonicalJson(setting.method_value_json, setting.method_setting_id)) {
    throw new Error(`${setting.method_setting_id}: external-executor audit lineage drift`);
  }
  const unavailableCode = decision.executor_family_id.startsWith("noncomputational.")
    ? "noncomputational_route_correction_required"
    : "source_version_executor_unavailable";
  const blockerCode = ({
    already_present_repo_or_dependency: "external_executor_binding_conformance_pending",
    extend_existing_downstream_operator: "downstream_operator_extension_required",
    external_artifact_available: "external_artifact_registration_required",
    unavailable_or_underdetermined_source_version: unavailableCode,
  })[decision.disposition];
  return {
    ...setting,
    method_execution_destination_id: `${decision.executor_family_id}@${decision.executor_family_version}`,
    method_execution_blocker_code: blockerCode,
    adjudication_rationale: decision.rationale,
  };
}

function exactContractSlots(document) {
  const slots = document.classes?.BrowserProcessingOptions?.slots;
  if (!Array.isArray(slots) || slots.some((slot) => typeof slot !== "string")) {
    throw new Error("BrowserProcessingOptions slots are missing from the local contract");
  }
  return new Set(slots);
}

function validateLinkmlRows(document, className, rows) {
  const classSlots = document.classes?.[className]?.slots;
  if (!Array.isArray(classSlots)) throw new Error(`LinkML class is missing: ${className}`);
  const allowed = new Set(classSlots);
  for (const [index, row] of rows.entries()) {
    const unknown = Object.keys(row).filter((key) => !allowed.has(key));
    if (unknown.length) throw new Error(`${className}[${index}] has undeclared slots: ${unknown.join(", ")}`);
    for (const slotName of classSlots) {
      const slot = document.slots?.[slotName] ?? {};
      const value = row[slotName];
      if ((slot.required || slot.identifier) && (value === undefined || value === null)) {
        throw new Error(`${className}[${index}] is missing required slot ${slotName}`);
      }
      if (value === undefined || value === null) continue;
      if (slot.multivalued && !Array.isArray(value)) throw new Error(`${className}[${index}].${slotName} must be an array`);
      if (!slot.multivalued && Array.isArray(value)) throw new Error(`${className}[${index}].${slotName} must not be an array`);
      const values = slot.multivalued ? value : [value];
      for (const item of values) {
        if (slot.range === "string" && typeof item !== "string") throw new Error(`${className}[${index}].${slotName} must be a string`);
        if (slot.range === "boolean" && typeof item !== "boolean") throw new Error(`${className}[${index}].${slotName} must be a boolean`);
        if (slot.range === "integer" && !Number.isInteger(item)) throw new Error(`${className}[${index}].${slotName} must be an integer`);
        if (slot.range === "float" && (typeof item !== "number" || !Number.isFinite(item))) throw new Error(`${className}[${index}].${slotName} must be a finite number`);
        if (typeof item === "number" && slot.minimum_value !== undefined && item < slot.minimum_value) throw new Error(`${className}[${index}].${slotName} is below ${slot.minimum_value}`);
        if (typeof item === "number" && slot.maximum_value !== undefined && item > slot.maximum_value) throw new Error(`${className}[${index}].${slotName} is above ${slot.maximum_value}`);
      }
      const permissible = document.enums?.[slot.range]?.permissible_values;
      if (permissible && values.some((item) => !Object.hasOwn(permissible, item))) {
        throw new Error(`${className}[${index}].${slotName} has unknown enum value`);
      }
    }
  }
}

function validateOperationReferences(profile, settingsById = new Map((profile.method_settings ?? []).map((setting) => [setting.method_setting_id, setting]))) {
  const operations = new Map((profile.method_operations ?? []).map((operation) => [operation.operation_id, operation]));
  const settingIds = new Set(profile.method_setting_ids);
  const upstream = new Map();
  const visiting = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`${profile.source_work_id}: operation dependency cycle at ${id}`);
    if (upstream.has(id)) return;
    if (!operations.has(id)) throw new Error(`${profile.source_work_id}: unknown operation dependency ${id}`);
    visiting.add(id);
    const ancestors = new Set();
    for (const dependency of operations.get(id).depends_on ?? []) {
      visit(dependency);
      ancestors.add(dependency);
      for (const ancestor of upstream.get(dependency)) ancestors.add(ancestor);
    }
    upstream.set(id, ancestors);
    visiting.delete(id);
  };
  for (const id of operations.keys()) visit(id);
  for (const operation of operations.values()) {
    const sequenceFields = ["sequence_encoding_rule", "sequence_scope_operation_ids", "sequence_identity_setting_ids",
      "sequence_first_symbol_setting_id", "sequence_repeat_symbol_setting_id"];
    if (sequenceFields.some((key) => Object.hasOwn(operation, key))) {
      const scopes = operation.sequence_scope_operation_ids;
      const identities = operation.sequence_identity_setting_ids;
      const first = operation.sequence_first_symbol_setting_id;
      const repeat = operation.sequence_repeat_symbol_setting_id;
      if (operation.sequence_encoding_rule !== "first_vs_previously_seen_in_partition"
        || !Array.isArray(scopes) || !scopes.length || new Set(scopes).size !== scopes.length
        || scopes.some((id) => !upstream.get(operation.operation_id).has(id))
        || !Array.isArray(identities) || !identities.length || new Set(identities).size !== identities.length
        || identities.some((id) => !settingIds.has(id))
        || !settingIds.has(first) || !settingIds.has(repeat) || first === repeat
        || ["group_scope_operation_ids", "grouping_basis", "equality_key_setting_ids", "concatenated_key_setting_ids",
          "empty_if_absent_key_setting_ids", "selection_rule"].some((key) => Object.hasOwn(operation, key))) {
        throw new Error(`${profile.source_work_id}: invalid partition-local sequence references for ${operation.operation_id}`);
      }
      let firstSymbol;
      let repeatSymbol;
      try {
        firstSymbol = JSON.parse(settingsById.get(first)?.method_value_json);
        repeatSymbol = JSON.parse(settingsById.get(repeat)?.method_value_json);
      } catch {
        throw new Error(`${profile.source_work_id}: invalid literal sequence symbols`);
      }
      if (typeof firstSymbol !== "string" || !firstSymbol.length || typeof repeatSymbol !== "string"
        || !repeatSymbol.length || firstSymbol === repeatSymbol) {
        throw new Error(`${profile.source_work_id}: invalid literal sequence symbols`);
      }
    }
    for (const key of ["grouping_basis", "selection_rule", "event_payload_association"]) {
      if (operation[key] === null) throw new Error(`${profile.source_work_id}: ${key} must not be null`);
    }
    const requiredPayloads = operation.required_event_payload_roles ?? [];
    const optionalPayloads = operation.optional_event_payload_roles ?? [];
    for (const [key, roles] of [["required_event_payload_roles", requiredPayloads], ["optional_event_payload_roles", optionalPayloads]]) {
      if (new Set(roles).size !== roles.length || roles.some((role) => !["screenshot", "view_hierarchy", "gesture"].includes(role))) {
        throw new Error(`${profile.source_work_id}: ${key} contains duplicate or unknown payload roles`);
      }
    }
    if (optionalPayloads.some((role) => requiredPayloads.includes(role))) {
      throw new Error(`${profile.source_work_id}: optional_event_payload_roles overlaps required event payloads`);
    }
    if (operation.event_payload_association !== undefined &&
      (!["screenshot", "view_hierarchy"].every((role) => requiredPayloads.includes(role)) ||
        ![...requiredPayloads, ...optionalPayloads].includes("gesture"))) {
      throw new Error(`${profile.source_work_id}: event_payload_association requires paired screenshot/hierarchy and gesture roles`);
    }
    if (!["group_scope_operation_ids", "grouping_basis", "equality_key_setting_ids", "concatenated_key_setting_ids", "empty_if_absent_key_setting_ids", "selection_rule"]
      .some((key) => operation[key] != null)) continue;
    const scopes = operation.group_scope_operation_ids ?? [];
    const keys = operation.equality_key_setting_ids ?? [];
    const operands = operation.concatenated_key_setting_ids ?? [];
    const defaults = operation.empty_if_absent_key_setting_ids ?? [];
    if (!operation.grouping_basis || !operation.selection_rule || !scopes.length
      || scopes.some((id) => !upstream.get(operation.operation_id).has(id))
      || keys.some((id) => !settingIds.has(id))
      || (operation.grouping_basis === "field_equality" && !keys.length)
      || (operation.grouping_basis === "declared_group_membership" && keys.length)
      || (operation.grouping_basis === "raw_string_concatenation"
        ? keys.length || operands.length < 2 || operands.some((id) => !settingIds.has(id))
          || new Set(defaults).size !== defaults.length || defaults.some((id) => !operands.includes(id))
        : operands.length || defaults.length)) {
      throw new Error(`${profile.source_work_id}: invalid grouped subset references for ${operation.operation_id}`);
    }
  }
}

function resolutionRoute(setting) {
  if (setting.method_implementation_status === "external_executor") return "integrate_external_executor";
  if (setting.method_implementation_status === "refused_missing_signal") return "add_or_bind_required_signal";
  if (setting.method_implementation_status === "unresolved") return "recover_or_adjudicate_exact_method";
  if (setting.method_setting_role === "provenance") return "bind_runtime_provenance_receipt";
  if (["analysis", "aggregation", "feature_engineering", "validation", "reporting"].includes(setting.method_setting_role)) {
    return "implement_downstream_executor_and_gui_control";
  }
  if (["acquisition", "diary_schema", "participant_schema"].includes(setting.method_setting_role)) {
    return "implement_protocol_authoring_and_input_adapter";
  }
  return "implement_backend_executor_and_gui_control";
}

function indexDecisions(decisions, expectedIds, contractSlots) {
  const indexed = new Map();
  for (const decision of decisions) {
    const id = requireString(decision.method_setting_id, "method_setting_id", "decision");
    if (indexed.has(id)) throw new Error(`duplicate adjudication: ${id}`);
    if (!expectedIds.has(id)) throw new Error(`unexpected adjudication: ${id}`);
    const status = requireString(decision.implementation_status, "implementation_status", id);
    if (!allowedStatuses.has(status)) throw new Error(`${id}: unknown implementation_status ${status}`);
    const valueJson = canonicalJson(decision.value_json, id);
    const candidateSlots = decision.mapped_contract_slots ?? [];
    if (!Array.isArray(candidateSlots) || candidateSlots.some((slot) => typeof slot !== "string")) {
      throw new Error(`${id}: mapped_contract_slots must be a string array`);
    }
    if (status === "native") {
      const slot = requireString(decision.canonical_parameter_key, "canonical_parameter_key", id);
      if (!candidateSlots.includes(slot)) throw new Error(`${id}: native slot is not explicitly mapped: ${slot}`);
      for (const candidateSlot of candidateSlots) {
        if (!contractSlots.has(candidateSlot)) throw new Error(`${id}: native slot is absent from BrowserProcessingOptions: ${candidateSlot}`);
      }
      if (!nativeExecutorAliases.has(decision.executor_id)) throw new Error(`${id}: unknown native executor: ${decision.executor_id}`);
      if (candidateSlots.length > 1) {
        const parsed = JSON.parse(valueJson);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error(`${id}: multi-slot native value must be an object`);
        }
        const valueSlots = Object.keys(parsed).sort();
        const mappedSlots = [...candidateSlots].sort();
        if (JSON.stringify(valueSlots) !== JSON.stringify(mappedSlots)) {
          throw new Error(`${id}: multi-slot native value keys do not exactly match mapped_contract_slots`);
        }
      }
    } else if (status === "external_executor") {
      requireString(decision.executor_id, "executor_id", id);
    } else if (status === "refused_missing_signal" && decision.executor_id !== null && decision.executor_id !== undefined) {
      if (!knownRefusalExecutors.has(decision.executor_id)) throw new Error(`${id}: unknown refusal executor: ${decision.executor_id}`);
    } else if (decision.executor_id !== null && decision.executor_id !== undefined) {
      throw new Error(`${id}: non-executed adjudication cannot name an executor`);
    }
    indexed.set(id, {
      ...decision,
      value_json: valueJson,
      executor_id: status === "native" ? nativeExecutor : decision.executor_id,
    });
  }
  const missing = [...expectedIds].filter((id) => !indexed.has(id));
  if (missing.length) throw new Error(`missing ${missing.length} adjudications; first: ${missing[0]}`);
  return indexed;
}

function merge(assertions, profiles, decisions, contractSlots) {
  const expected = assertions.filter((row) => applicableDisclosures.has(row.method_disclosure_status));
  const indexed = indexDecisions(decisions, new Set(expected.map((row) => row.method_setting_id)), contractSlots);
  const mergedAssertions = assertions.flatMap((assertion) => {
    const decision = indexed.get(assertion.method_setting_id);
    if (!decision) return [{ ...assertion, contract_bindings: [] }];
    const status = decision.implementation_status;
    const base = compact({
      ...assertion,
      method_setting_role: decision.method_role ?? assertion.method_setting_role,
      method_target_layer: decision.method_target_layer ?? assertion.method_target_layer,
      method_parameter_key: decision.canonical_parameter_key,
      method_value_kind: decision.value_kind,
      method_value_json: decision.value_json,
      method_unit: decision.unit,
      method_comparator: decision.comparator,
      method_boundary_convention: decision.boundary_convention,
      mapped_ontology_term: decision.mapped_ontology_terms,
      mapped_contract_slot: decision.mapped_contract_slots,
      contract_bindings: [],
      method_implementation_status: status,
      executor_id: decision.executor_id,
      required_inputs: decision.required_inputs,
      adjudication_confidence: decision.confidence,
      adjudication_rationale: decision.rationale,
    });
    if (status !== "native") return [base];
    if (decision.mapped_contract_slots.length === 1) {
      return [{
        ...base,
        contract_bindings: [{
          contract_slot: decision.canonical_parameter_key,
          contract_value_json: decision.value_json,
        }],
      }];
    }
    const values = JSON.parse(decision.value_json);
    return decision.mapped_contract_slots.map((slot) => ({
      ...base,
      method_setting_id: `${assertion.method_setting_id}#${slot}`,
      method_parameter_key: slot,
      method_value_kind: Array.isArray(values[slot]) ? "list"
        : values[slot] === null ? "unspecified"
          : typeof values[slot] === "number" ? (Number.isInteger(values[slot]) ? "integer" : "float")
            : typeof values[slot],
      method_value_json: JSON.stringify(values[slot]),
      mapped_contract_slot: [slot],
      contract_bindings: [{ contract_slot: slot, contract_value_json: JSON.stringify(values[slot]) }],
    }));
  });
  const byWork = Map.groupBy(mergedAssertions, (row) => row.source_work_id);
  const mergedProfiles = profiles.map((profile) => {
    const settings = byWork.get(profile.source_work_id) ?? [];
    const applicable = settings.filter((setting) => setting.method_applicability_status !== "not_applicable");
    const variantPartitioned = profile.source_method_variant_id !== "whole_source";
    return {
      ...profile,
      method_profile_version: "literature-sublation-v2-adjudicated",
      method_setting_ids: settings.map((setting) => setting.method_setting_id),
      method_setting_count: settings.length,
      profile_implementation_status: applicable.length === 0 ? "specification_only"
        : variantPartitioned && applicable.every((setting) =>
          setting.method_implementation_status === "native"
          && typeof setting.conformance_fixture_id === "string" && setting.conformance_fixture_id
          && /^sha256:[0-9a-f]{64}$/.test(setting.conformance_result_digest)) ? "executable"
          : "blocked",
    };
  });
  return { mergedAssertions, mergedProfiles };
}

function normalizeAtomicSetting(row, allowedSlots) {
  const configuration = row.configuration_structure;
  const clauseIds = row.source_clause_ids ?? row.atomic_clause_ids ?? (row.source_clause_id ? [row.source_clause_id] : undefined) ?? (
    Number.isInteger(row.clause_index)
      ? [`${row.source_extraction_id}:clause:${String(row.clause_index).padStart(2, "0")}`]
      : undefined
  );
  const candidate = {
    ...row,
    source_evidence_work_id: row.source_evidence_work_id ?? row.source_work_id,
    source_value_json: row.source_value_json ?? (
      typeof row.source_observed_setting === "string" ? JSON.stringify(row.source_observed_setting) : undefined
    ),
    source_coverage_status: row.source_coverage_status ?? row.method_disclosure_status?.toUpperCase(),
    executor_id: row.method_implementation_status === "native" && nativeExecutorAliases.has(row.executor_id)
      ? nativeExecutor
      : row.executor_id,
    source_clause_ids: clauseIds,
    source_clause_label: row.source_clause_label ?? row.clause_label,
    method_variant_group_id: row.method_variant_group_id ?? row.variant_group_id ?? row.configuration_group_id ?? configuration?.source_group_id,
    method_variant_relation: row.method_variant_relation ?? row.variant_group_relation ?? row.configuration_relation ?? configuration?.source_group_operator,
    method_variant_branch_id: row.method_variant_branch_id ?? row.configuration_branch_id ?? (
      Number.isInteger(configuration?.branch_index) ? `${configuration.source_group_id}:branch:${configuration.branch_index}` : undefined
    ),
    method_variant_branch_label: row.method_variant_branch_label ?? row.variant_branch_label ?? row.configuration_branch_id ?? (
      Number.isInteger(configuration?.branch_index) ? configuration.axis_values_in_source_order?.[configuration.branch_index] : undefined
    ),
    method_configuration_json: configuration ? JSON.stringify(configuration) : row.method_configuration_json,
    structured_protocol_candidate_json: row.structured_protocol_candidate
      ? JSON.stringify(row.structured_protocol_candidate)
      : row.structured_protocol_candidate_json,
  };
  return compact(Object.fromEntries(Object.entries(candidate).filter(([key]) => allowedSlots.has(key))));
}

function methodConfiguration(setting) {
  return setting.method_configuration_json ? JSON.parse(setting.method_configuration_json) : null;
}

function isExplicitVariantOrMultiverse(setting) {
  const kind = methodConfiguration(setting)?.kind ?? "";
  const relation = setting.method_variant_relation?.toLowerCase() ?? "";
  return ["variant_branch", "multiverse_branch", "multiverse_combination"].includes(kind)
    || relation.includes("alternative") || relation.includes("sensitivity") || relation.includes("cross_study");
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

function selectableConfigurationVerdicts(verdicts) {
  if (verdicts.some((verdict) => !configurationUnitKinds.has(verdict.configuration_unit_kind))) {
    throw new Error("configuration verdict has missing or invalid configuration_unit_kind");
  }
  return verdicts.filter((verdict) => verdict.configuration_unit_kind === "user_selectable_alternative");
}

function finalizeSelectableConfigurationLevels(levels, targetRows) {
  const selectableSettingIds = new Set(levels.flatMap((level) => level.included_method_setting_ids));
  const invariantMethodSettingIds = targetRows.map((row) => row.method_setting_id)
    .filter((id) => !selectableSettingIds.has(id));
  const commonSettingIds = new Set([...selectableSettingIds].filter((id) =>
    levels.every((level) => level.included_method_setting_ids.includes(id))));
  return {
    configurationLevels: levels.map((level) => {
      const included = new Set(level.included_method_setting_ids);
      return {
        ...level,
        excluded_method_setting_ids: [...selectableSettingIds].filter((id) => !included.has(id)),
        common_method_setting_ids: level.included_method_setting_ids.filter((id) => commonSettingIds.has(id)),
        branch_method_setting_ids: level.included_method_setting_ids.filter((id) => !commonSettingIds.has(id)),
      };
    }),
    selectableSettingIds,
    invariantMethodSettingIds,
  };
}

function sourceSpaceStructure(space) {
  return ({
    fixed: "fixed",
    selectable_axis_or_campaign: "source_declared_axes",
    conditional_state_machine: "conditional",
    documentary_only: "documentary_only",
    evidence_blocked: "evidence_blocked",
  })[space.space_kind] ?? "evidence_blocked";
}

function ontologyConfigurationSpace(space) {
  const membership = space.method_setting_membership;
  return {
    method_configuration_space_id: space.source_configuration_space_id,
    method_configuration_structure: sourceSpaceStructure(space),
    invariant_method_setting_ids: membership.invariant_method_setting_ids,
    method_configuration_groups: space.configuration_groups.map((group) => {
      const levels = group.allowed_source_declared_levels_or_combinations.map((level) => ({
        method_configuration_level_id: level.source_method_variant_id,
        method_configuration_level_label: level.variant_label,
        included_method_setting_ids: level.included_method_setting_ids,
        excluded_method_setting_ids: level.excluded_method_setting_ids,
        common_method_setting_ids: level.common_method_setting_ids,
        branch_method_setting_ids: level.branch_method_setting_ids,
        documentary_method_setting_ids: level.documentary_method_setting_ids,
        unresolved_method_setting_ids: level.unresolved_method_setting_ids,
        source_locators: level.source_locators,
      }));
      return compact({
        method_configuration_group_id: group.source_configuration_group_id,
        method_configuration_group_kind: group.partition_decision?.disposition ?? group.group_role,
        method_configuration_axis: group.source_group_backlog_record?.axes ?? [],
        method_selection_semantics: group.group_selectability_status,
        method_cross_product_policy: group.cross_group_combination_policy,
        method_configuration_levels: levels,
        documentary_method_setting_ids: unique(levels.flatMap((level) => level.documentary_method_setting_ids ?? [])),
        unresolved_method_setting_ids: unique(levels.flatMap((level) => level.unresolved_method_setting_ids ?? [])),
        source_locators: group.source_locators,
      });
    }),
    allowed_method_combinations: [],
    documentary_method_setting_ids: membership.documentary_only_method_setting_ids,
    not_applicable_method_setting_ids: membership.not_applicable_method_setting_ids,
    unresolved_method_setting_ids: membership.unresolved_or_evidence_blocked_method_setting_ids,
    source_locators: space.source_locators,
  };
}

function protocolMaterializationBlockers(attachment) {
  return attachment.attachment_blockers.flatMap((object, objectIndex) => {
    const blockers = [...object.object_blockers, ...(object.attachment_blocker ? [object.attachment_blocker] : [])];
    return blockers.map((blocker, blockerIndex) => compact({
      protocol_materialization_blocker_id: `${object.materialization_id}:blocker:${objectIndex}:${blockerIndex}`,
      protocol_materialization_id: object.materialization_id,
      protocol_ontology_class: object.ontology_class,
      protocol_profile_slot: object.typed_profile_slot,
      protocol_object_attached: object.attached,
      protocol_blocker_code: blocker.code,
      protocol_blocker_field: blocker.field,
      protocol_blocker_reason: blocker.reason,
      blocked_method_setting_ids: blocker.code === "missing_release_context"
        ? object.candidate_member_setting_ids
        : blocker.method_setting_ids ?? object.candidate_member_setting_ids,
      partial_protocol_object_json: !object.attached && blockerIndex === 0
        ? JSON.stringify(object.unattached_protocol_object)
        : undefined,
      source_locators: object.unattached_protocol_object?.source_locators ?? attachment.study_method_profile.source_locators,
    }));
  });
}

function applyNativeRouteAudit(setting, audit, conformance) {
  const decision = audit.decision;
  if (decision.source_extraction_id !== setting.source_extraction_id || decision.source_work_id !== setting.source_work_id) {
    throw new Error(`${setting.method_setting_id}: native route audit source identity drift`);
  }
  const audited = {
    ...setting,
    required_inputs: unique([...(setting.required_inputs ?? []), ...audit.requiredInputs]),
    adjudication_rationale: audit.rationale,
    method_execution_blocker_code: audit.classification,
  };
  if (audit.classification !== "exact_existing_binding") return audited;
  const { conformance_fixture_id: _fixture, conformance_result_digest: _digest, ...conformancePending } = audited;
  if (conformance) {
    const { method_execution_blocker_code: _blocker, ...proven } = conformancePending;
    return {
      ...proven,
      mapped_contract_slot: audit.bindings.map((binding) => binding.contract_slot),
      contract_bindings: audit.bindings,
      method_implementation_status: "native",
      method_execution_route: "native_option_binding",
      method_execution_destination_id: nativeExecutor,
      method_execution_parameter_path: "/browser-processing-options",
      executor_id: nativeExecutor,
      conformance_fixture_id: conformance.fixture_id,
      conformance_result_digest: conformance.conformance_result_digest,
    };
  }
  return {
    ...conformancePending,
    mapped_contract_slot: audit.bindings.map((binding) => binding.contract_slot),
    contract_bindings: audit.bindings,
    method_implementation_status: "specification_only",
    method_execution_route: "native_option_binding",
    method_execution_destination_id: nativeExecutor,
    method_execution_parameter_path: "/browser-processing-options",
    method_execution_blocker_code: "native_binding_conformance_pending",
    executor_id: nativeExecutor,
  };
}

function applyExecutedNativeExtension(setting, promotion) {
  const sourceValueSha256 = setting.source_value_sha256
    ?? sha256Bytes(JSON.parse(setting.source_value_json)).slice(7);
  if (promotion.source_extraction_id !== setting.source_extraction_id
    || promotion.source_work_id !== setting.source_work_id
    || promotion.source_value_sha256 !== sourceValueSha256
    || (promotion.source_clause_text ?? null) !== (setting.source_clause_text ?? null)) {
    throw new Error(`${setting.method_setting_id}: executed native extension source identity drift`);
  }
  const { method_execution_blocker_code: _blocker, ...unblocked } = setting;
  return {
    ...unblocked,
    source_value_sha256: sourceValueSha256,
    mapped_contract_slot: promotion.contract_bindings.map((binding) => binding.contract_slot),
    contract_bindings: promotion.contract_bindings,
    method_implementation_status: "native",
    method_execution_route: "native_option_binding",
    method_execution_destination_id: nativeExecutor,
    method_execution_parameter_path: "/browser-processing-options",
    executor_id: nativeExecutor,
    conformance_fixture_id: promotion.fixture_id,
    conformance_result_digest: promotion.conformance_result_digest,
  };
}

const sourceSemanticCorrections = new Map([
  ["method-setting-21088bd2743bd3054e5fbb5b", {
    route: "native_operator_parameter",
    destination: "chronicle.screen-device-usage-row-relabeling/v1",
    blocker: "source_semantic_mismatch:screen_device_usage_row_relabeling_required",
    requiredInputs: ["screen_state_event_stream", "source_row_order"],
    rationale: "The released R code applies strict <5s binding to SCREEN-derived device-usage sessions, fills intervening sensing rows with the later usage ID, and removes the earlier usage ID. Chronicle's proven option only groups app episodes without relabeling source rows, so its comparator and gap arithmetic are reusable primitives rather than a source-exact implementation.",
  }],
  ["method-setting-26afbbff6833c88ff507ab35", {
    route: "protocol_input",
    destination: "chronicle.behapp-integer-duration-interval-adapter/v1",
    blocker: "source_semantic_mismatch:integer_duration_coercion_required",
    requiredInputs: ["source_interval_rows_with_start_time_and_duration"],
    sourceFields: {
      method_parameter_key: "interval_end_from_integer_duration_seconds",
      method_value_json: '"end_time = start_time + int(duration_seconds)"',
      source_clause_text: "end_time = recorded_naive + timedelta(seconds=int(durationN))",
      source_observed_setting: "interval_end: end_time = start_time + int(duration_seconds)",
      source_value_json: '"interval_end: end_time = start_time + int(duration_seconds)"',
      source_value_sha256: "fc2bb331f3f792e2eb5b0dd9bcadc85e75d7e27087c75c61ebcf01d97469b5da",
      source_locators: [
        "/Users/u/chronicle-android-raw-data-preprocessing-app/.tmp-literature-review-private/corrective-packet-06-ranks174-223-20260831/artifacts/rank202-code-data/Behapp Data Cleaning/Match_ESM_App.py:38-55",
      ],
    },
    rationale: "The released Python code truncates duration with int(durationN) before constructing the endpoint. Chronicle's shared raw-interval adapter preserves fractional seconds, so a 3.9-second source interval ends at +3.9s instead of the source's +3s. The separate half-open one-second expansion remains reusable, but endpoint materialization needs a source-specific integer-duration adapter.",
  }],
  ["method-setting-df7636eeeb84adfbcdcfae0e", {
    route: "protocol_input",
    destination: "chronicle.source-defined-participation-criterion/v1",
    blocker: "source_semantic_underdetermination:four_weeks_worth_of_data_operational_definition_missing",
    requiredInputs: ["source_participation_criterion_definition"],
    rationale: "The paper requires at least four weeks' worth of data but does not define whether that means elapsed observation span, covered calendar days, valid days, or another completeness measure. Chronicle's >=28-day observed-span operator is one possible operationalization, not a source-exact mapping, so exact execution remains fail-closed until the source definition is available.",
  }],
  ["atomic-15d02f9a39a91a13a11d12bf", {
    route: "protocol_input",
    destination: "chronicle.ethica-foreground-cumulative-usage-adapter/v1",
    blocker: "source_adapter_missing:ethica_collector_scope_not_executable_by_normalized_row_guard",
    replaceRequiredInputs: [
      "ethica_app_usage_stream.user_id",
      "ethica_app_usage_stream.app_name",
      "ethica_app_usage_stream.start_time",
      "ethica_app_usage_stream.fg_time_ms",
      "ethica_app_usage_stream.last_used",
    ],
    rationale: "The paper says Ethica did not record background activity. Chronicle's current source-scope adapter merely validates a synthetic activity_scope field on already-normalized rows and aborts mixed input; it cannot reproduce or prove collector non-recording. Preserve the source fact, but keep source-faithful execution blocked until the Ethica raw adapter exists.",
  }],
  ["atomic-1caaaaa3f160b5b1e55f167d", {
    route: "protocol_input",
    destination: "chronicle.ethica-foreground-cumulative-usage-adapter/v1",
    blocker: "source_adapter_missing:ethica_foreground_scope_requires_source_schema",
    replaceRequiredInputs: [
      "ethica_app_usage_stream.user_id",
      "ethica_app_usage_stream.app_name",
      "ethica_app_usage_stream.start_time",
      "ethica_app_usage_stream.fg_time_ms",
      "ethica_app_usage_stream.last_used",
    ],
    rationale: "Foreground scope is intrinsic to the Ethica App Usage Stream, not a row label supplied by the paper's raw schema. Chronicle's normalized activity_scope guard is a reusable invariant only after source adaptation; it is not an implementation of the disclosed acquisition semantics.",
  }],
  ["atomic-6d49adb03b35afe44e4345b4", {
    route: "protocol_input",
    destination: "chronicle.ethica-foreground-cumulative-usage-adapter/v1",
    blocker: "source_adapter_missing:ethica_onset_derivation_from_cumulative_foreground_time",
    replaceRequiredInputs: [
      "ethica_app_usage_stream.user_id",
      "ethica_app_usage_stream.app_name",
      "ethica_app_usage_stream.start_time",
      "ethica_app_usage_stream.fg_time_ms",
      "ethica_app_usage_stream.last_used",
    ],
    rationale: "The article describes onset time, but the released R code derives analytical start within (user_id, apk, start_time) as timezone-corrected last_used minus the first or differenced cumulative fg_time_ms value. Chronicle's current fixture invents start_timestamp directly, so it proves only a downstream normalized-interval primitive and not the paper's source boundary.",
  }],
  ["atomic-f6cdb85f788137290db633a9", {
    route: "protocol_input",
    destination: "chronicle.ethica-foreground-cumulative-usage-adapter/v1",
    blocker: "source_adapter_missing:ethica_duration_derivation_from_cumulative_foreground_time",
    replaceRequiredInputs: [
      "ethica_app_usage_stream.user_id",
      "ethica_app_usage_stream.app_name",
      "ethica_app_usage_stream.start_time",
      "ethica_app_usage_stream.fg_time_ms",
      "ethica_app_usage_stream.last_used",
    ],
    rationale: "The released R code treats fg_time_ms as cumulative within (user_id, apk, start_time) and derives segment duration as the first value or successive differences. Chronicle's current adapter accepts a ready-made duration_seconds value, so it skips the source transform even though the downstream interval primitive remains reusable.",
  }],
  ["method-setting-03ab220c09950d31938fa792", {
    route: "protocol_input",
    destination: "chronicle.ethica-foreground-cumulative-usage-adapter/v1",
    blocker: "source_semantic_mismatch:collector_nonrecording_is_not_background_row_exclusion",
    replaceRequiredInputs: [
      "ethica_app_usage_stream.user_id",
      "ethica_app_usage_stream.app_name",
      "ethica_app_usage_stream.start_time",
      "ethica_app_usage_stream.fg_time_ms",
      "ethica_app_usage_stream.last_used",
    ],
    sourceFields: {
      method_target_layer: "raw_record",
      method_parameter_key: "background_activity_recorded",
      method_value_kind: "boolean",
      method_value_json: "false",
    },
    rationale: "The source says background activity was not recorded; it does not describe filtering background-labeled rows at the study-window stage. Chronicle currently aborts mixed-scope input rather than excluding background rows. This extraction is retained as the acquisition fact and cannot count as an independently executed exclusion.",
  }],
  ["method-setting-atomic-aa4373a352b7b19662af", {
    route: "protocol_input",
    destination: "chronicle.ethica-foreground-cumulative-usage-adapter/v1",
    blocker: "source_semantic_mismatch:ethica_nonpositive_filters_precede_normalized_episode_cleanup",
    replaceRequiredInputs: [
      "ethica_app_usage_stream.fg_time_ms",
      "ethica_reconstructed_segment.duration",
    ],
    rationale: "The article's zero-duration statement is narrow, while the released code applies fg_time_ms > 0 before cumulative differencing and duration > 0 after reconstruction. Chronicle's later exact-zero episode cleanup acts on a different object and stage and refuses negative raw intervals, so it is only a downstream reusable primitive, not the paper's source-exact implementation.",
  }],
  ["method-setting-atomic-e6a18c971fa9d67c7091", {
    route: "protocol_input",
    destination: "chronicle.ethica-foreground-cumulative-usage-adapter/v1",
    blocker: "source_semantic_mismatch:zero_threshold_stage_and_object_do_not_match_released_code",
    replaceRequiredInputs: [
      "ethica_app_usage_stream.fg_time_ms",
      "ethica_reconstructed_segment.duration",
    ],
    rationale: "A threshold of exactly zero matches the article prose only. The released code uses strict >0 retention at both the raw cumulative value and reconstructed segment stages; Chronicle's proven predicate runs later on normalized app episodes. Preserve these as distinct assertions rather than collapsing them into one native option.",
  }],
  ["method-setting-babb6e75bd145e48c3384c7e", {
    route: "protocol_input",
    destination: "chronicle.ethica-foreground-cumulative-usage-adapter/v1",
    blocker: "source_semantic_mismatch:coarse_zero_duration_exclusion_has_wrong_stage",
    replaceRequiredInputs: [
      "ethica_app_usage_stream.fg_time_ms",
      "ethica_reconstructed_segment.duration",
    ],
    sourceFields: {
      method_target_layer: "app_episode",
    },
    rationale: "The coarse zero-duration exclusion is staged incorrectly as a study-window rule. The released code filters nonpositive cumulative foreground values before differencing and nonpositive derived durations afterward. Those source-backed stage-specific atoms must drive the adapter; this coarse assertion cannot claim a second independent execution.",
  }],
]);

function applySourceSemanticCorrection(setting) {
  const correction = sourceSemanticCorrections.get(setting.method_setting_id);
  if (!correction) return setting;
  const {
    executor_id: _executor,
    conformance_fixture_id: _fixture,
    conformance_result_digest: _digest,
    ...unproven
  } = setting;
  return {
    ...unproven,
    ...(correction.sourceFields ?? {}),
    mapped_contract_slot: [],
    contract_bindings: [],
    method_implementation_status: "specification_only",
    method_execution_route: correction.route,
    method_execution_destination_id: correction.destination,
    method_execution_parameter_path: `/source-exact-operators/${setting.method_setting_id}`,
    method_execution_blocker_code: correction.blocker,
    gap_assessment: "new_source_exact_operator_required",
    required_inputs: correction.replaceRequiredInputs ?? unique([
      ...(setting.required_inputs ?? []),
      ...correction.requiredInputs,
    ]),
    adjudication_rationale: correction.rationale,
  };
}

// Source-completeness audits supersede earlier protocol materializations. These
// corrections are deliberately applied after that projection so stale native
// proofs and broad role-based ontology classes cannot be reintroduced merely
// because several unrelated methods happen to use the number five.
const fiveSecondPostProjectionCorrections = new Map([
  ["method-setting-21088bd2743bd3054e5fbb5b", {
    fields: {
      method_setting_role: "reconstruction",
      method_target_layer: "raw_record",
      mapped_ontology_term: ["StudyMethodProfile", "MethodSettingAssertion", "SessionConstructionPolicy"],
    },
    route: "native_operator_parameter",
    destination: "chronicle.screen-device-usage-row-relabeling/v1",
    blocker: "source_semantic_mismatch:screen_device_usage_row_relabeling_required",
    requiredInputs: ["screen_state_event_stream", "source_row_order"],
    rationale: "The released R code relabels SCREEN-derived device-usage rows and intervening source rows to the later usage ID. Chronicle's strict-less-than-five-second option remains a legitimate app-episode compatibility operator, but it is not a source-exact binding for this row-level reconstruction.",
  }],
  ["method-setting-da6110b25e2070673c995c2a", {
    fields: {
      method_setting_role: "quality_control",
      method_target_layer: "acquired_snapshot",
      mapped_ontology_term: ["StudyMethodProfile", "MethodSettingAssertion", "ParameterProvenanceAssertion"],
    },
    route: "native_operator_parameter",
    destination: "chronicle.sensor-inactivity-change-run-filter/v1",
    blocker: "source_semantic_underdetermination:change_predicate_and_five_second_boundary_missing",
    requiredInputs: ["ordered_accelerometer_gyroscope_stream", "source_change_predicate"],
    rationale: "The JIOT atom eliminates readings after five seconds without accelerometer or gyroscope change. It is an acquired-reading quality filter, not a MeasurementReleaseProfile, and remains fail-closed because tolerance, axes, equality, and sampling-gap behavior are undisclosed.",
  }],
  ["method-setting-d3c518f907692060b4c30b51", {
    fields: {
      method_setting_role: "acquisition",
      method_target_layer: "collector",
      mapped_ontology_term: ["StudyMethodProfile", "MethodSettingAssertion", "AcquisitionProtocol"],
    },
    route: "protocol_input",
    destination: "chronicle.regret-screenshot-acquisition/v1",
    blocker: "source_acquisition_unimplemented:screenshot_timer_after_intention_response",
    requiredInputs: ["screen_state_event_stream", "intention_response_event_stream", "source_screenshot_collector"],
    rationale: "The five-second value is a MediaProjection screenshot acquisition cadence that begins after the intention response. It is not a measurement-release transformation.",
  }],
  ["method-setting-5b16e47b354adfd836637c21", {
    fields: {
      method_setting_role: "quality_control",
      method_target_layer: "app_episode",
      mapped_ontology_term: ["StudyMethodProfile", "MethodSettingAssertion", "ParameterProvenanceAssertion"],
    },
    route: "native_operator_parameter",
    destination: "chronicle.foreground-prompt-eligibility/v1",
    blocker: "source_semantic_underdetermination:foreground_stream_and_prompt_clock_missing",
    requiredInputs: ["foreground_app_event_stream", "selected_screen_session_stream"],
    rationale: "The strict longer-than-five-seconds predicate gates an intention prompt after an app remains foreground; exactly five seconds does not trigger. It does not construct or filter app sessions, and response latency is not disclosed.",
  }],
  ["method-setting-86b76f51a297902b7617d54f", {
    fields: {
      method_setting_role: "acquisition",
      method_target_layer: "acquired_snapshot",
      mapped_ontology_term: ["StudyMethodProfile", "MethodSettingAssertion", "AcquisitionProtocol"],
    },
    route: "protocol_input",
    destination: "chronicle.ktl-phone-sensor-acquisition/v1",
    blocker: "source_acquisition_unimplemented:ktl_sensor_collector",
    requiredInputs: ["ktl_phone_sensor_collector"],
    rationale: "KTL's six phone-sensor streams have their own five-second acquisition cadence. They must not be collapsed with the separately gated screenshot collector.",
  }],
  ["method-setting-8610324205e459c643456da5", {
    fields: {
      method_setting_role: "acquisition",
      method_target_layer: "acquired_snapshot",
      mapped_ontology_term: ["StudyMethodProfile", "MethodSettingAssertion", "AcquisitionProtocol"],
    },
    route: "protocol_input",
    destination: "chronicle.ktl-screenshot-acquisition/v1",
    blocker: "source_acquisition_unimplemented:ktl_screen_on_screenshot_collector",
    requiredInputs: ["ktl_screenshot_collector", "screen_state_event_stream"],
    rationale: "KTL screenshots use a distinct five-second acquisition cadence and are captured only while the screen is on. The sensor cadence is not evidence for this gate.",
  }],
  ["method-setting-fcb375381848232e388775c7", {
    fields: {
      method_setting_role: "acquisition",
      method_target_layer: "collector",
      mapped_ontology_term: ["StudyMethodProfile", "MethodSettingAssertion", "AcquisitionProtocol"],
    },
    route: "protocol_input",
    destination: "chronicle.screenlife-screenshot-acquisition/v1",
    blocker: "source_acquisition_unimplemented:screenlife_collector_lifecycle",
    requiredInputs: ["screenlife_screenshot_collector", "screen_state_event_stream"],
    rationale: "The JMIR five-second value is screen-active screenshot acquisition, not a MeasurementReleaseProfile.",
  }],
  ["method-setting-e9aed8ee932679e0ca4c8b53", {
    fields: {
      method_setting_role: "acquisition",
      method_target_layer: "acquired_snapshot",
      mapped_ontology_term: ["StudyMethodProfile", "MethodSettingAssertion", "AcquisitionProtocol"],
    },
    route: "protocol_input",
    destination: "chronicle.estar-network-counter-acquisition/v1",
    blocker: "source_conflict:screen_off_network_cadence_5s_vs_1s",
    requiredInputs: ["estar_per_uid_counter_stream", "screen_state_event_stream", "source_cadence_resolution"],
    rationale: "eStar Table 2 states five-second screen-off network acquisition, while later printed prose states one second. The conflict is genuine and acquisition remains fail-closed.",
  }],
  ["method-setting-8ac8b46e1a34b8e12bfce8d5", {
    fields: {
      method_setting_role: "reconstruction",
      method_target_layer: "derived_feature",
      mapped_ontology_term: ["StudyMethodProfile", "MethodSettingAssertion", "ParameterProvenanceAssertion"],
    },
    route: "native_operator_parameter",
    destination: "chronicle.estar-network-call-reconstruction-compatibility/v1",
    blocker: "source_semantic_mismatch:already_windowed_input_and_rng_substitution",
    requiredInputs: ["estar_raw_per_uid_counter_stream", "screen_state_event_stream", "source_rng_and_seed"],
    rationale: "Chronicle's retained eStar operator checks already-windowed one/five-second rows and substitutes deterministic pseudorandom placement. It is useful compatibility behavior, but it does not reproduce acquisition or the undisclosed source RNG and therefore cannot claim source-exact end-to-end coverage.",
  }],
]);

function applyFiveSecondPostProjectionCorrections(assertions, profiles, spaces) {
  let corrected = 0;
  const correctedAssertions = assertions.map((setting) => {
    const correction = fiveSecondPostProjectionCorrections.get(setting.method_setting_id);
    if (!correction) return setting;
    corrected += 1;
    const {
      executor_id: _executor,
      conformance_fixture_id: _fixture,
      conformance_result_digest: _digest,
      ...unproven
    } = setting;
    return {
      ...unproven,
      ...correction.fields,
      mapped_contract_slot: [],
      contract_bindings: [],
      method_implementation_status: "specification_only",
      method_execution_route: correction.route,
      method_execution_destination_id: correction.destination,
      method_execution_parameter_path: `/source-exact-operators/${setting.method_setting_id}`,
      method_execution_blocker_code: correction.blocker,
      gap_assessment: "new_source_exact_operator_required",
      required_inputs: correction.requiredInputs,
      adjudication_rationale: correction.rationale,
    };
  });
  if (corrected !== fiveSecondPostProjectionCorrections.size) {
    throw new Error(`five-second post-projection corrections applied ${corrected}, expected ${fiveSecondPostProjectionCorrections.size}`);
  }
  return {
    assertions: correctedAssertions,
    profiles,
    spaces,
    summary: {
      corrected_settings: corrected,
      false_native_claims_remaining: 0,
      source_comparator_conflicts_fail_closed: true,
      validation_passed: true,
    },
  };
}

function inputAdapterMethodValueMatches(setting, value) {
  try {
    return isDeepStrictEqual(JSON.parse(setting?.method_value_json), value);
  } catch {
    return false;
  }
}

function currentSourceSchemaEvidenceMatches(setting, schema) {
  if (!schema) return true;
  try {
    return schema.sourceExact !== false
      && schema.sourceWorkId === setting?.source_work_id
      && inputAdapterMethodValueMatches(setting, schema.sourceValue)
      && schema.sourceValueSha256 === sha256Bytes(JSON.parse(setting.source_value_json)).slice(7);
  } catch {
    return false;
  }
}

function postAuditInputComponentPromotionFailures(setting, profile, ownershipCount, promotion) {
  const {
    mapping, contract, fixture, sourceMethodVariantId,
  } = promotion ?? {};
  const component = contract?.componentExecution;
  const sourceSchema = contract?.sourceSchemas?.find((registration) =>
    registration.methodSettingId === setting?.method_setting_id);
  return [
    ["canonical_setting", Boolean(setting?.method_setting_id)],
    ["single_profile_owner", ownershipCount === 1],
    ["profile_owns_setting", profile?.method_setting_ids?.includes(setting?.method_setting_id)],
    ["profile_source", profile?.source_work_id === setting?.source_work_id],
    ["contract_owns_setting", contract?.methodSettingIds?.filter((id) =>
      id === setting?.method_setting_id).length === 1],
    ["mapping_schema", mapping?.schema_version === "chronicle-literature-input-conformance-mapping/v1"],
    ["mapping_assertions", mapping?.assertions_passed === true],
    ["mapping_source", mapping?.source_work_id === setting?.source_work_id],
    ["fixture_source", fixture?.sourceWorkId === setting?.source_work_id],
    ["canonical_source_value", inputAdapterMethodValueMatches(setting, mapping?.source_value)],
    ["fixture_source_value", isDeepStrictEqual(mapping?.source_value, fixture?.sourceValue)],
    ["fixture_identity", mapping?.fixture_id === fixture?.fixtureId],
    ["fixture_adapter", mapping?.adapter_id === fixture?.adapterId],
    ["contract_adapter", mapping?.adapter_id === `${contract?.adapterId}/${contract?.adapterVersion}`],
    ["source_schema_evidence", currentSourceSchemaEvidenceMatches(setting, sourceSchema)],
    ["fixture_digest", /^sha256:[0-9a-f]{64}$/.test(mapping?.fixture_source_digest ?? "")],
    ["adapted_digest", /^sha256:[0-9a-f]{64}$/.test(mapping?.adapted_output_digest ?? "")],
    ["result_digest", /^sha256:[0-9a-f]{64}$/.test(mapping?.conformance_result_digest ?? "")],
    ["source_variant", sourceMethodVariantId === profile?.source_method_variant_id],
    ["component_parent", !component
      || component.parentMethodProfileId === profile?.method_profile_id],
    ["component_source", !component
      || component.sourceWorkId === profile?.source_work_id],
    ["component_variant", !component
      || component.sourceMethodVariantId === profile?.source_method_variant_id],
    ["component_version", !component
      || component.methodProfileVersion === profile?.method_profile_version],
  ].filter(([, passed]) => !passed).map(([name]) => name);
}

export function applyPostAuditInputAdapterImplementations(assertions, profiles, spaces, candidates) {
  const settingsById = new Map(assertions.map((setting) => [setting.method_setting_id, setting]));
  const ownersById = new Map();
  for (const profile of profiles) {
    for (const id of profile.method_setting_ids ?? []) {
      const owners = ownersById.get(id) ?? [];
      owners.push(profile);
      ownersById.set(id, owners);
    }
  }
  const promotable = new Map();
  const blocked = new Map();
  let skipped = 0;
  for (const [id, promotion] of candidates) {
    const setting = settingsById.get(id);
    if (setting?.method_execution_blocker_code !== "source_completeness_execution_pending") {
      skipped += 1;
      continue;
    }
    const owners = ownersById.get(id) ?? [];
    const failures = postAuditInputComponentPromotionFailures(
      setting, owners[0], owners.length, promotion,
    );
    if (failures.length) {
      blocked.set(id, failures);
    } else {
      promotable.set(id, {
        ...promotion,
        sourceSchemaEvidenceVerified: currentSourceSchemaEvidenceMatches(setting,
          promotion.contract.sourceSchemas?.find((schema) => schema.methodSettingId === id)),
      });
    }
  }
  let promoted = 0;
  const promotedAssertions = assertions.map((setting) => {
    const candidate = candidates.get(setting.method_setting_id);
    const sourceSchema = candidate?.contract?.sourceSchemas?.find((schema) =>
      schema.methodSettingId === setting.method_setting_id);
    if (sourceSchema?.sourceExact === false) {
      const { conformance_fixture_id: _fixture, conformance_result_digest: _result,
        executor_id: _executor, ...unproven } = setting;
      return {
        ...unproven,
        method_implementation_status: "specification_only",
        method_execution_blocker_code: "source_schema_unverified_raw_mapping",
        mapped_contract_slot: [],
        contract_bindings: [],
      };
    }
    const promotion = promotable.get(setting.method_setting_id);
    if (!promotion) return setting;
    promoted += 1;
    return applyInputAdapterImplementation(setting, promotion);
  });
  if (promoted !== promotable.size) {
    throw new Error(`post-audit input/component promotion applied ${promoted}, expected ${promotable.size}`);
  }
  const failClosedByReason = {};
  for (const failures of blocked.values()) {
    for (const failure of failures) {
      failClosedByReason[failure] = (failClosedByReason[failure] ?? 0) + 1;
    }
  }
  return {
    assertions: promotedAssertions,
    profiles,
    spaces,
    summary: {
      candidate_settings: candidates.size,
      eligible_pending_settings: candidates.size - skipped,
      promoted_settings: promoted,
      fail_closed_settings: blocked.size,
      skipped_settings: skipped,
      fail_closed_by_reason: Object.fromEntries(Object.entries(failClosedByReason)
        .sort(([left], [right]) => left.localeCompare(right))),
      exact_canonical_profile_and_conformance_gate: true,
    },
  };
}

function applyInputAdapterImplementation(setting, promotion) {
  const { mapping, contract, sourceSchemaEvidenceVerified } = promotion;
  if (mapping.source_work_id !== setting.source_work_id
    || !inputAdapterMethodValueMatches(setting, mapping.source_value)) {
    throw new Error(`${setting.method_setting_id}: input-adapter source work or value drift`);
  }
  const sourceSchema = contract.sourceSchemas?.find((registration) => registration.methodSettingId === setting.method_setting_id);
  if (sourceSchema && (
    sourceSchema.sourceWorkId !== setting.source_work_id
    || !isDeepStrictEqual(sourceSchema.sourceValue, mapping.source_value)
    || sourceSchemaEvidenceVerified !== true
  )) {
    throw new Error(`${setting.method_setting_id}: source-schema evidence identity or digest drift`);
  }
  const optionBindings = Object.entries(contract.optionBindings ?? {}).map(([contract_slot, value]) => ({
    contract_slot,
    contract_value_json: JSON.stringify(value),
  }));
  const { method_execution_blocker_code: _blocker, ...unblocked } = setting;
  return {
    ...unblocked,
    ...(sourceSchema ? { source_value_sha256: sourceSchema.sourceValueSha256 } : {}),
    mapped_contract_slot: optionBindings.map((binding) => binding.contract_slot),
    contract_bindings: optionBindings,
    method_implementation_status: "native",
    method_execution_route: contract.routeKind,
    method_execution_destination_id: mapping.adapter_id,
    method_execution_parameter_path: `/input-adapters/${contract.schemaId}`,
    executor_id: nativeExecutor,
    conformance_fixture_id: mapping.fixture_id,
    conformance_result_digest: mapping.conformance_result_digest,
  };
}

function applyLateSourceCompletenessInputAdapterImplementations(assertions, profiles, spaces, promotions) {
  let promoted = 0;
  const sourceValueDriftSettings = [];
  const routedAssertions = assertions.map((setting) => {
    const promotion = promotions.get(setting.method_setting_id);
    if (!promotion) return setting;
    const { mapping } = promotion;
    const adapter = lateSourceCompletenessInputAdapterBySetting.get(setting.method_setting_id);
    if (!adapter
      || setting.source_work_id !== adapter.sourceWorkId
      || mapping.source_work_id !== setting.source_work_id) {
      throw new Error(`${setting.method_setting_id}: late source-completeness adapter identity drift`);
    }
    if (!isDeepStrictEqual(mapping.source_value, JSON.parse(setting.method_value_json))) {
      sourceValueDriftSettings.push(setting.method_setting_id);
      return applyInputAdapterRouteCorrection(setting, {
        disposition: "blocked_source_value_changed_since_conformance",
        reason: "The current source interpretation differs from the historical adapter proof; preserve the corrected source value without authorizing execution from that proof.",
      });
    }
    promoted += 1;
    return applyInputAdapterImplementation(setting, promotion);
  });
  if (promoted + sourceValueDriftSettings.length !== lateSourceCompletenessInputAdapterIds.size
    || promotions.size !== lateSourceCompletenessInputAdapterIds.size) {
    throw new Error(`late source-completeness adapters promoted ${promoted}, expected ${lateSourceCompletenessInputAdapterIds.size}`);
  }
  return { assertions: routedAssertions, profiles, spaces, promoted, sourceValueDriftSettings };
}

function applyInputAdapterRouteCorrection(setting, correction) {
  const {
    executor_id: _executor,
    conformance_fixture_id: _fixture,
    conformance_result_digest: _digest,
    ...blocked
  } = setting;
  return {
    ...blocked,
    mapped_contract_slot: [],
    contract_bindings: [],
    method_implementation_status: "specification_only",
    method_execution_blocker_code: `input_route_correction:${correction.disposition}`,
    adjudication_rationale: correction.reason,
  };
}

function applyCorrectedNewOperatorPartition(setting, partition) {
  const id = setting.method_setting_id;
  const { tranche, semantic } = partition;
  if (!tranche.method_setting_ids.includes(id)
    || semantic.source_work_id !== setting.source_work_id) {
    throw new Error(`${id}: corrected new-operator partition lineage drift during merge`);
  }
  const preservedValueJson = canonicalJson(setting.method_value_json, id);
  const {
    executor_id: _executor,
    conformance_fixture_id: _fixture,
    conformance_result_digest: _digest,
    ...nonExecutable
  } = setting;
  const corrected = {
    ...nonExecutable,
    method_value_json: preservedValueJson,
    mapped_contract_slot: [],
    contract_bindings: [],
    method_implementation_status: "specification_only",
    method_execution_route: correctedNewOperatorPublicRoutes.get(tranche.corrected_route),
    method_execution_destination_id: `${tranche.tranche_id}@${tranche.corrected_route}`,
    method_execution_parameter_path: `/new-operator-tranches/${tranche.tranche_id}/${tranche.corrected_route}/settings/${id}`,
    method_execution_blocker_code: `corrected_new_operator:${tranche.corrected_route}:${tranche.implementation_status}`,
    adjudication_rationale: `${tranche.rationale} Corrected implementation classification: ${tranche.corrected_route}.`,
  };
  if (corrected.method_implementation_status === "native"
    || corrected.executor_id
    || corrected.contract_bindings.length
    || corrected.conformance_fixture_id
    || corrected.conformance_result_digest
    || corrected.method_value_json !== preservedValueJson) {
    throw new Error(`${id}: corrected new-operator partition attempted to claim execution or alter the source value`);
  }
  return corrected;
}

export function refreshProtocolMethodSettings(protocols, profile, canonicalAssertionsById) {
  return Object.fromEntries(Object.entries(protocols).map(([slot, objects]) => [slot, objects.map((object) => {
    if (object.method_settings === undefined) return object;
    if (!Array.isArray(object.method_settings)) {
      throw new Error(`${profile.source_work_id}:${slot}: typed protocol object has no method_settings array`);
    }
    return {
      ...object,
      method_settings: object.method_settings.map((nested) => {
        const canonical = canonicalAssertionsById.get(nested.method_setting_id);
        const sourceLineageMatches = canonical
          && canonical.source_extraction_id === nested.source_extraction_id
          && canonical.source_work_id === nested.source_work_id
          && nested.source_work_id === profile.source_work_id
          && canonical.source_value_sha256 === nested.source_value_sha256
          && canonical.source_value_json === nested.source_value_json
          && canonical.source_observed_setting === nested.source_observed_setting;
        if (!sourceLineageMatches) {
          throw new Error(`${profile.source_work_id}:${slot}:${nested.method_setting_id}: nested protocol setting lineage does not match the canonical assertion`);
        }
        return canonical;
      }),
    };
  })]));
}

function assembleProfileStructures(profiles, assertions, contractSlots) {
  const spaces = jsonl(sourceSpacesPath);
  const attachments = jsonl(protocolAttachmentsPath);
  const operatorContract = JSON.parse(readFileSync(operatorContractPath, "utf8"));
  const nativeRouteAudits = loadNativeRouteAudits(operatorContract, contractSlots);
  const correctedNewOperatorPartition = loadCorrectedNewOperatorPartition(nativeRouteAudits);
  const nativeConformance = loadNativeConformance(nativeRouteAudits);
  const strictGapExtension = loadStrictGapExtension(nativeRouteAudits, contractSlots);
  const strictScreenGateExtension = loadStrictScreenGateExtension(nativeRouteAudits, contractSlots);
  const directUnlockExtension = loadDirectUnlockExtension(nativeRouteAudits, contractSlots);
  const sourceOrderExtension = loadSourceOrderExtension(nativeRouteAudits, contractSlots);
  const screenPolicyExtension = loadScreenPolicyExtension(nativeRouteAudits, contractSlots);
  const behappIntervalExtension = loadBehappIntervalExtension(
    nativeRouteAudits, correctedNewOperatorPartition, contractSlots,
  );
  const topAppSelectionExtension = loadTopAppSelectionExtension();
  const screenDurationParticipantExclusion = loadScreenDurationParticipantExclusion(
    nativeRouteAudits, correctedNewOperatorPartition, contractSlots,
  );
  const sourceEvidenceRepairs = loadSourceEvidenceRepairs(nativeRouteAudits);
  const appOpeningIterationExtension = loadAppOpeningIterationExtension(
    nativeRouteAudits, sourceEvidenceRepairs, contractSlots,
  );
  const applicationLabelExtension = loadApplicationLabelExtension(nativeRouteAudits, contractSlots);
  const missingInputAudit = loadMissingInputAudit(nativeRouteAudits);
  const inputAdapterImplementations = loadInputAdapterImplementations(
    nativeRouteAudits, missingInputAudit, correctedNewOperatorPartition, sourceEvidenceRepairs,
    assertions,
  );
  const externalExecutorAudit = loadExternalExecutorAudit(operatorContract);
  const spacesByWork = new Map(spaces.map((space) => [space.source_work_id, space]));
  const attachmentsByWork = new Map(attachments.map((attachment) => [attachment.source_work_id, attachment]));
  const routes = new Map(operatorContract.setting_routes.map((route) => [route.method_setting_id, route]));
  if (spacesByWork.size !== profiles.length || attachmentsByWork.size !== profiles.length || routes.size !== operatorContract.setting_routes.length) {
    throw new Error("source-space, protocol-attachment, or execution-route identity collision");
  }
  const preAuditRoutedIds = new Set(assertions.filter((setting) =>
    applicableDisclosures.has(setting.method_disclosure_status) && setting.method_implementation_status !== "native")
    .map((setting) => setting.method_setting_id));
  const sourceAuditReplacementIds = new Set(readdirSync(sourceCompletenessAuditDirectory)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => JSON.parse(readFileSync(resolve(sourceCompletenessAuditDirectory, name), "utf8"))
      .disclosed_atoms.flatMap((atom) => atom.implementation_disposition === "specification_only"
        ? atom.projected_method_setting_ids ?? [] : [])));
  if ([...routes.keys()].some((id) => !preAuditRoutedIds.has(id))
    || [...preAuditRoutedIds].some((id) => !routes.has(id) && !sourceAuditReplacementIds.has(id))) {
    throw new Error("execution-route setting identity set has an unaccounted pre-audit blocker");
  }
  const routedAssertions = assertions.map((setting) => {
    const route = routes.get(setting.method_setting_id);
    const routed = route ? {
      ...setting,
      method_execution_route: route.destination_route,
      method_execution_destination_id: route.destination_node_template_id,
      method_execution_parameter_path: route.destination_parameter_path,
      method_execution_blocker_code: route.blocker_code,
    } : setting.method_implementation_status === "native" ? {
      ...setting,
      method_execution_route: "native_option_binding",
      method_execution_destination_id: nativeExecutor,
      method_execution_parameter_path: `/browser-processing-options/${setting.contract_bindings[0].contract_slot}`,
    } : setting;
    const audit = nativeRouteAudits.bySetting.get(setting.method_setting_id);
    const audited = audit ? applyNativeRouteAudit(routed, audit, nativeConformance.bySetting.get(setting.method_setting_id)) : routed;
    const correctedPartition = correctedNewOperatorPartition.bySetting.get(setting.method_setting_id);
    const partitioned = correctedPartition ? applyCorrectedNewOperatorPartition(audited, correctedPartition) : audited;
    const repair = sourceEvidenceRepairs.bySetting.get(setting.method_setting_id);
    const repaired = repair ? applySourceEvidenceRepair(partitioned, repair) : partitioned;
    const appOpeningPromotion = appOpeningIterationExtension.bySetting.get(setting.method_setting_id);
    const appOpeningExtended = appOpeningPromotion
      ? applyExecutedNativeExtension(repaired, appOpeningPromotion)
      : repaired;
    const strictGapPromotion = strictGapExtension.bySetting.get(setting.method_setting_id);
    const extended = strictGapPromotion
      ? applyExecutedNativeExtension(appOpeningExtended, strictGapPromotion)
      : appOpeningExtended;
    const strictScreenGatePromotion = strictScreenGateExtension.bySetting.get(setting.method_setting_id);
    const screenExtended = strictScreenGatePromotion
      ? applyExecutedNativeExtension(extended, strictScreenGatePromotion)
      : extended;
    const directUnlockPromotion = directUnlockExtension.bySetting.get(setting.method_setting_id);
    const directUnlockExtended = directUnlockPromotion
      ? applyExecutedNativeExtension(screenExtended, directUnlockPromotion)
      : screenExtended;
    const sourceOrderPromotion = sourceOrderExtension.bySetting.get(setting.method_setting_id);
    const sourceOrderExtended = sourceOrderPromotion
      ? applyExecutedNativeExtension(directUnlockExtended, sourceOrderPromotion)
      : directUnlockExtended;
    const screenPolicyPromotion = screenPolicyExtension.bySetting.get(setting.method_setting_id);
    const screenPolicyExtended = screenPolicyPromotion
      ? applyExecutedNativeExtension(sourceOrderExtended, screenPolicyPromotion)
      : sourceOrderExtended;
    const behappPromotion = behappIntervalExtension.bySetting.get(setting.method_setting_id);
    const operatorExtended = behappPromotion
      ? applyExecutedNativeExtension(screenPolicyExtended, behappPromotion)
      : screenPolicyExtended;
    const topAppPromotion = topAppSelectionExtension.bySetting.get(setting.method_setting_id);
    const aggregateExtended = topAppPromotion
      ? applyExecutedNativeExtension(operatorExtended, topAppPromotion)
      : operatorExtended;
    const screenDurationPromotion = screenDurationParticipantExclusion.bySetting
      .get(setting.method_setting_id);
    const qualityExtended = screenDurationPromotion
      ? applyExecutedNativeExtension(aggregateExtended, screenDurationPromotion)
      : aggregateExtended;
    const applicationLabelPromotion = applicationLabelExtension.bySetting.get(setting.method_setting_id);
    const labelExtended = applicationLabelPromotion
      ? applyExecutedNativeExtension(qualityExtended, applicationLabelPromotion)
      : qualityExtended;
    const inputDecision = missingInputAudit.bySetting.get(setting.method_setting_id);
    const inputAudited = inputDecision ? applyMissingInputAudit(labelExtended, inputDecision) : labelExtended;
    const inputRouteCorrection = inputAdapterImplementations.blockedBySetting.get(setting.method_setting_id);
    const correctedInput = inputRouteCorrection
      ? applyInputAdapterRouteCorrection(inputAudited, inputRouteCorrection)
      : inputAudited;
    const inputPromotion = inputAdapterImplementations.bySetting.get(setting.method_setting_id);
    const inputImplemented = inputPromotion ? applyInputAdapterImplementation(correctedInput, inputPromotion) : correctedInput;
    const externalDecision = externalExecutorAudit.bySetting.get(setting.method_setting_id);
    const executorAudited = externalDecision ? applyExternalExecutorAudit(inputImplemented, externalDecision) : inputImplemented;
    return applySourceSemanticCorrection(executorAudited);
  });
  const typedProtocolSlots = [
    "acquisition_protocols", "session_construction_policies", "notification_attribution_policies",
    "duration_policies", "timestamp_policies", "parameter_provenance_assertions", "release_profiles",
  ];
  const canonicalAssertionsById = new Map(routedAssertions.map((setting) => [setting.method_setting_id, setting]));
  if (canonicalAssertionsById.size !== routedAssertions.length) {
    throw new Error("canonical routed assertions contain duplicate method_setting_id values");
  }
  const assembledProfiles = profiles.map((profile) => {
    const space = spacesByWork.get(profile.source_work_id);
    const attachment = attachmentsByWork.get(profile.source_work_id);
    if (!space || !attachment) throw new Error(`${profile.source_work_id}: missing source space or protocol attachment`);
    if (JSON.stringify(profile.method_setting_ids) !== JSON.stringify(space.all_method_setting_ids)) {
      throw new Error(`${profile.source_work_id}: source configuration-space setting inventory drift`);
    }
    const attachedProtocols = Object.fromEntries(typedProtocolSlots.map((slot) => [slot, attachment.study_method_profile[slot] ?? []]));
    const protocols = refreshProtocolMethodSettings(attachedProtocols, profile, canonicalAssertionsById);
    return {
      ...profile,
      source_method_variant_id: space.source_configuration_space_id,
      source_method_variant_label: `Source configuration space (${space.space_kind.replaceAll("_", " ")})`,
      method_configuration_structure: sourceSpaceStructure(space),
      method_configuration_space: ontologyConfigurationSpace(space),
      ...protocols,
      protocol_materialization_blockers: protocolMaterializationBlockers(attachment),
      profile_implementation_status: "blocked",
    };
  });
  const pendingBindings = routedAssertions.filter((setting) =>
    setting.method_execution_blocker_code === "native_binding_conformance_pending");
  const correctedProvenBindingIds = new Set([...sourceSemanticCorrections.keys()]
    .filter((id) => nativeConformance.bySetting.has(id)));
  const provenBindings = routedAssertions.filter((setting) =>
    nativeConformance.bySetting.has(setting.method_setting_id)
      && !correctedProvenBindingIds.has(setting.method_setting_id));
  const correctedNewOperatorSettings = routedAssertions.filter((setting) =>
    correctedNewOperatorPartition.bySetting.has(setting.method_setting_id));
  const strictGapSettings = routedAssertions.filter((setting) =>
    strictGapExtension.bySetting.has(setting.method_setting_id)
      && setting.method_implementation_status === "native");
  const sourceSemanticsCorrectedSettings = routedAssertions.filter((setting) =>
    sourceSemanticCorrections.has(setting.method_setting_id));
  const strictScreenGateSettings = routedAssertions.filter((setting) =>
    strictScreenGateExtension.bySetting.has(setting.method_setting_id));
  const directUnlockSettings = routedAssertions.filter((setting) =>
    directUnlockExtension.bySetting.has(setting.method_setting_id));
  const sourceOrderSettings = routedAssertions.filter((setting) =>
    sourceOrderExtension.bySetting.has(setting.method_setting_id));
  const screenPolicySettings = routedAssertions.filter((setting) =>
    screenPolicyExtension.bySetting.has(setting.method_setting_id));
  const behappIntervalSettings = routedAssertions.filter((setting) =>
    behappIntervalExtension.bySetting.has(setting.method_setting_id));
  const topAppSelectionSettings = routedAssertions.filter((setting) =>
    topAppSelectionExtension.bySetting.has(setting.method_setting_id));
  const screenDurationParticipantExclusionSettings = routedAssertions.filter((setting) =>
    screenDurationParticipantExclusion.bySetting.has(setting.method_setting_id));
  const appOpeningIterationSettings = routedAssertions.filter((setting) =>
    appOpeningIterationExtension.bySetting.has(setting.method_setting_id));
  const applicationLabelSettings = routedAssertions.filter((setting) =>
    applicationLabelExtension.bySetting.has(setting.method_setting_id));
  const implementedInputSettings = routedAssertions.filter((setting) =>
    inputAdapterImplementations.bySetting.has(setting.method_setting_id)
      && setting.method_implementation_status === "native");
  const sourceCorrectedInputAdapterCount = sourceSemanticsCorrectedSettings.filter((setting) =>
    inputAdapterImplementations.bySetting.has(setting.method_setting_id)).length;
  const blockedInputCorrections = routedAssertions.filter((setting) =>
    inputAdapterImplementations.blockedBySetting.has(setting.method_setting_id));
  if (pendingBindings.length !== 0
    || provenBindings.length !== nativeRouteAudits.summary.classifications.exact_existing_binding
      - correctedProvenBindingIds.size
    || provenBindings.some((setting) => setting.method_implementation_status !== "native")) {
    throw new Error("audited exact bindings were not promoted exactly from executed conformance proofs");
  }
  if (correctedNewOperatorSettings.length !== correctedNewOperatorPartition.summary.corrected_settings
    || correctedNewOperatorSettings.some((setting) => !behappIntervalExtension.bySetting.has(setting.method_setting_id)
      && !topAppSelectionExtension.bySetting.has(setting.method_setting_id)
      && !screenDurationParticipantExclusion.bySetting.has(setting.method_setting_id)
      && !inputAdapterImplementations.bySetting.has(setting.method_setting_id)
      && (setting.method_implementation_status === "native"
      || setting.executor_id
      || (setting.contract_bindings?.length ?? 0) !== 0
      || setting.conformance_fixture_id
      || setting.conformance_result_digest))) {
    throw new Error("corrected new-operator partition was not applied exactly or claimed execution");
  }
  if (screenDurationParticipantExclusionSettings.length
      !== screenDurationParticipantExclusion.summary.promoted_settings
    || screenDurationParticipantExclusionSettings.some((setting) =>
      setting.method_implementation_status !== "native"
      || setting.method_execution_route !== "native_option_binding"
      || setting.method_execution_blocker_code
      || !setting.conformance_fixture_id
      || !setting.conformance_result_digest)) {
    throw new Error("screen-duration participant exclusion was not promoted exactly from its executed proof");
  }
  if (appOpeningIterationSettings.length !== appOpeningIterationExtension.summary.promoted_settings
    || appOpeningIterationSettings.some((setting) => setting.method_implementation_status !== "native"
      || setting.method_execution_route !== "native_option_binding"
      || setting.method_execution_blocker_code
      || !setting.conformance_fixture_id
      || !setting.conformance_result_digest)) {
    throw new Error("each-app-opening-event setting was not promoted exactly from its executed proof");
  }
  if (strictGapSettings.length !== 0
    || sourceSemanticsCorrectedSettings.length !== sourceSemanticCorrections.size
    || sourceSemanticsCorrectedSettings.some((setting) => {
      const correction = sourceSemanticCorrections.get(setting.method_setting_id);
      return setting.method_implementation_status !== "specification_only"
        || setting.method_execution_route !== correction.route
        || setting.method_execution_destination_id !== correction.destination
        || setting.method_execution_blocker_code !== correction.blocker
        || setting.executor_id
        || setting.contract_bindings.length
        || setting.conformance_fixture_id
        || setting.conformance_result_digest;
    })) {
    throw new Error("source-inexact strict-gap mapping was not kept fail-closed");
  }
  if (strictScreenGateSettings.length !== strictScreenGateExtension.summary.promoted_settings
    || strictScreenGateSettings.some((setting) => setting.method_implementation_status !== "native"
      || setting.method_execution_route !== "native_option_binding"
      || setting.method_execution_blocker_code
      || !setting.conformance_fixture_id
      || !setting.conformance_result_digest)) {
    throw new Error("strict-screen-gate extension was not promoted exactly from its executed conformance proof");
  }
  if (directUnlockSettings.length !== directUnlockExtension.summary.promoted_settings
    || directUnlockSettings.some((setting) => setting.method_implementation_status !== "native"
      || setting.method_execution_route !== "native_option_binding"
      || setting.method_execution_blocker_code
      || !setting.conformance_fixture_id
      || !setting.conformance_result_digest)) {
    throw new Error("direct-unlock extension was not promoted exactly from its executed conformance proof");
  }
  if (sourceOrderSettings.length !== sourceOrderExtension.summary.promoted_settings
    || sourceOrderSettings.some((setting) => setting.method_implementation_status !== "native"
      || setting.method_execution_route !== "native_option_binding"
      || setting.method_execution_blocker_code
      || !setting.conformance_fixture_id
      || !setting.conformance_result_digest)) {
    throw new Error("source-order extension was not promoted exactly from its executed conformance proof");
  }
  if (screenPolicySettings.length !== screenPolicyExtension.summary.promoted_settings
    || screenPolicySettings.some((setting) => setting.method_implementation_status !== "native"
      || setting.method_execution_route !== "native_option_binding"
      || setting.method_execution_blocker_code
      || !setting.conformance_fixture_id
      || !setting.conformance_result_digest)) {
    throw new Error("screen-policy extension was not promoted exactly from its executed conformance proof");
  }
  if (behappIntervalSettings.length !== behappIntervalExtension.summary.promoted_settings
    || behappIntervalSettings.some((setting) => setting.method_implementation_status !== "native"
      || setting.method_execution_route !== "native_option_binding"
      || setting.method_execution_blocker_code
      || !setting.conformance_fixture_id
      || !setting.conformance_result_digest)) {
    throw new Error("Behapp interval extension was not promoted exactly from its executed conformance proof");
  }
  if (topAppSelectionSettings.length !== topAppSelectionExtension.summary.promoted_settings
    || topAppSelectionSettings.some((setting) => setting.method_implementation_status !== "native"
      || setting.method_execution_route !== "native_option_binding"
      || setting.method_execution_blocker_code
      || !setting.conformance_fixture_id
      || !setting.conformance_result_digest)) {
    throw new Error("top-app selection extension was not promoted exactly from its executed conformance proof");
  }
  if (applicationLabelSettings.length !== applicationLabelExtension.summary.promoted_settings
    || applicationLabelSettings.some((setting) => setting.method_implementation_status !== "native"
      || setting.method_execution_route !== "native_option_binding"
      || setting.method_execution_blocker_code
      || !setting.conformance_fixture_id
      || !setting.conformance_result_digest)) {
    throw new Error("application-label extension was not promoted exactly from its closed executed proof");
  }
  if (implementedInputSettings.length !== inputAdapterImplementations.summary.promoted_settings
      - sourceCorrectedInputAdapterCount
    || implementedInputSettings.some((setting) => setting.method_implementation_status !== "native"
      || setting.method_execution_blocker_code
      || !setting.conformance_fixture_id
      || !setting.conformance_result_digest)) {
    throw new Error("input-adapter implementations were not promoted exactly from source-specific executed proofs");
  }
  if (blockedInputCorrections.length !== inputAdapterImplementations.summary.blocked_false_promotions
    || blockedInputCorrections.some((setting) => {
      const correctedBlocker = sourceSemanticCorrections.get(setting.method_setting_id)?.blocker;
      return setting.method_implementation_status === "native"
        || setting.executor_id
        || setting.conformance_fixture_id
        || setting.conformance_result_digest
        || (correctedBlocker
          ? setting.method_execution_blocker_code !== correctedBlocker
          : !setting.method_execution_blocker_code?.startsWith("input_route_correction:blocked_"));
    })) {
    throw new Error("input-adapter false promotions were not kept explicitly fail-closed");
  }
  return {
    routedAssertions,
    assembledProfiles,
    spaces,
    nativeRouteAuditSummary: nativeRouteAudits.summary,
    correctedNewOperatorPartitionSummary: correctedNewOperatorPartition.summary,
    nativeConformanceSummary: nativeConformance.summary,
    strictGapExtensionSummary: {
      ...strictGapExtension.summary,
      promoted_settings: strictGapSettings.length,
      corrected_source_semantic_mismatches: sourceSemanticsCorrectedSettings.length,
    },
    strictScreenGateExtensionSummary: strictScreenGateExtension.summary,
    directUnlockExtensionSummary: directUnlockExtension.summary,
    sourceOrderExtensionSummary: sourceOrderExtension.summary,
    screenPolicyExtensionSummary: screenPolicyExtension.summary,
    behappIntervalExtensionSummary: behappIntervalExtension.summary,
    topAppSelectionExtensionSummary: topAppSelectionExtension.summary,
    screenDurationParticipantExclusionSummary: screenDurationParticipantExclusion.summary,
    appOpeningIterationExtensionSummary: appOpeningIterationExtension.summary,
    applicationLabelExtensionSummary: applicationLabelExtension.summary,
    sourceEvidenceRepairSummary: sourceEvidenceRepairs.summary,
    missingInputAuditSummary: missingInputAudit.summary,
    inputAdapterImplementationSummary: inputAdapterImplementations.summary,
    postAuditInputAdapterCandidates: inputAdapterImplementations.postAuditBySetting,
    lateSourceCompletenessInputAdapterPromotions: inputAdapterImplementations.lateBySetting,
    externalExecutorAuditSummary: externalExecutorAudit.summary,
  };
}

function mergeAtomic(assertions, profiles, atomicRows, decisions, contractSlots, ontology) {
  const applicable = assertions.filter((row) => row.method_applicability_status === "applicable");
  const expectedIds = new Set(applicable.map((row) => row.method_setting_id));
  indexDecisions(decisions, expectedIds, contractSlots);
  const expectedExtractions = new Map(applicable.map((row) => [row.source_extraction_id, row]));
  const allowedSlots = new Set(ontology.classes.MethodSettingAssertion.slots);
  const atoms = atomicRows.map((row) => normalizeAtomicSetting(row, allowedSlots));
  if (new Set(atoms.map((row) => row.method_setting_id)).size !== atoms.length) {
    throw new Error("atomic corpus contains duplicate method_setting_id values");
  }
  const atomExtractionIds = new Set(atoms.map((row) => row.source_extraction_id));
  const missing = [...expectedExtractions.keys()].filter((id) => !atomExtractionIds.has(id));
  const extra = [...atomExtractionIds].filter((id) => !expectedExtractions.has(id));
  if (missing.length || extra.length) {
    throw new Error(`atomic source-extraction mismatch: missing=${missing.length}, extra=${extra.length}`);
  }
  for (const atom of atoms) {
    const source = expectedExtractions.get(atom.source_extraction_id);
    if (source.source_work_id !== atom.source_work_id) throw new Error(`${atom.method_setting_id}: source work drift`);
    if (!Array.isArray(atom.source_locators) || !atom.source_locators.length) throw new Error(`${atom.method_setting_id}: source locator missing`);
    if (typeof atom.source_value_json !== "string" || !atom.source_value_json) throw new Error(`${atom.method_setting_id}: reversible source value missing`);
    if (atom.method_implementation_status === "native") {
      if (atom.executor_id !== nativeExecutor || atom.contract_bindings?.length !== 1) throw new Error(`${atom.method_setting_id}: native atom is not one exact runtime binding`);
      const binding = atom.contract_bindings[0];
      if (!contractSlots.has(binding.contract_slot) || canonicalJson(binding.contract_value_json, atom.method_setting_id) !== canonicalJson(atom.method_value_json, atom.method_setting_id)) {
        throw new Error(`${atom.method_setting_id}: native atom binding is not exact`);
      }
    } else if ((atom.contract_bindings?.length ?? 0) !== 0) {
      throw new Error(`${atom.method_setting_id}: non-native atom has an executable binding`);
    }
  }
  const unavailable = assertions.filter((row) => row.method_applicability_status !== "applicable");
  const mergedAssertions = [...atoms, ...unavailable].sort((left, right) =>
    left.source_work_id.localeCompare(right.source_work_id) || left.method_setting_id.localeCompare(right.method_setting_id));
  const byWork = Map.groupBy(mergedAssertions, (row) => row.source_work_id);
  const mergedProfiles = profiles.map((profile) => {
    const settings = byWork.get(profile.source_work_id) ?? [];
    return {
      ...profile,
      method_profile_version: "literature-sublation-v3-atomic",
      method_setting_ids: settings.map((setting) => setting.method_setting_id),
      method_setting_count: settings.length,
      profile_implementation_status: "blocked",
    };
  });
  return {
    mergedAssertions,
    mergedProfiles,
    atomicValidation: {
      source_extraction_rows: applicable.length,
      atomic_setting_rows: atoms.length,
      every_applicable_source_extraction_atomized: missing.length === 0 && extra.length === 0,
      unique_atomic_setting_ids: true,
      configuration_structured_atomic_settings: atoms.filter((row) => row.method_variant_group_id).length,
      explicit_variant_or_multiverse_atomic_settings: atoms.filter(isExplicitVariantOrMultiverse).length,
    },
  };
}

function selfTest() {
  // Late promotions must rebind copies only after the final canonical routes exist.
  const staleNested = ["mathur-merge", "pulse-off", "pulse-entry", "unchanged"].map((id) => ({
    method_setting_id: id, source_extraction_id: `extraction-${id}`,
    source_work_id: "synthetic:late-promotion", source_value_sha256: `source-${id}`,
    source_value_json: JSON.stringify(id), source_observed_setting: id,
    method_value_json: JSON.stringify(id), method_implementation_status: "specification_only",
  }));
  const finalNested = staleNested.map((row, index) => index < 3
    ? { ...row, method_implementation_status: "native", method_execution_route: "protocol_input" }
    : row);
  const finalNestedById = new Map(finalNested.map((row) => [row.method_setting_id, row]));
  const nestedProfile = { source_work_id: "synthetic:late-promotion" };
  const nestedProtocols = { session_construction_policies: [{ method_settings: staleNested }] };
  assert.notDeepEqual(staleNested, finalNested);
  const refreshedNested = refreshProtocolMethodSettings(nestedProtocols, nestedProfile, finalNestedById);
  assert.deepEqual(refreshedNested.session_construction_policies[0].method_settings, finalNested);
  assert.equal(refreshedNested.session_construction_policies[0].method_settings[3], staleNested[3]);
  for (const changed of [{ source_value_sha256: "foreign" }, { source_value_json: '"foreign"' },
    { source_extraction_id: "foreign" }, { source_work_id: "foreign" }, { source_observed_setting: "foreign" }]) {
    const invalid = new Map(finalNestedById);
    invalid.set("mathur-merge", { ...finalNested[0], ...changed });
    assert.throws(() => refreshProtocolMethodSettings(nestedProtocols, nestedProfile, invalid), /lineage does not match/);
  }
  const constructor = { method_setting_id: "boundary", source_work_id: "synthetic:screen", method_setting_role: "reconstruction", method_target_layer: "screen_bout", source_locators: ["primary:1"] };
  const sessionAudit = { source_work_id: constructor.source_work_id, session_construction_policies: [{ session_construction_policy_id: "screen-policy", session_input_layer: "raw_record", session_output_layer: "screen_bout", method_setting_keys: ["boundary"] }] };
  const atomRows = new Map([["boundary", [constructor]]]);
  assert.deepEqual(projectAuditedSessionPolicies(sessionAudit, atomRows)[0].method_settings, [constructor]);
  assert.equal(projectAuditedSessionPolicies({ source_work_id: constructor.source_work_id }, atomRows), undefined);
  for (const change of [{ method_setting_keys: [] }, { method_setting_keys: ["foreign"] }, { method_setting_keys: ["boundary", "boundary"] }, { session_output_layer: "device_session" }, { reconstruction_strategy: "invented" }]) {
    const invalid = globalThis.structuredClone(sessionAudit);
    Object.assign(invalid.session_construction_policies[0], change);
    assert.throws(() => projectAuditedSessionPolicies(invalid, atomRows), /invalid.*session policy/);
  }
  assert.throws(() => projectAuditedSessionPolicies(sessionAudit, new Map([["boundary", [{ ...constructor, source_work_id: "foreign" }]]])), /invalid session policy member/);
  assert.throws(() => projectAuditedSessionPolicies({ ...sessionAudit, session_construction_policies: [...sessionAudit.session_construction_policies, ...sessionAudit.session_construction_policies] }, atomRows), /invalid audited session policy/);
  const sequenceProfile = { source_work_id: "synthetic:sequence", method_setting_ids: ["identity", "first", "repeat"],
    method_settings: [{ method_setting_id: "first", method_value_json: '"F"' }, { method_setting_id: "repeat", method_value_json: '"B"' }],
    method_operations: [{ operation_id: "partition" }, { operation_id: "encode", depends_on: ["partition"],
      sequence_encoding_rule: "first_vs_previously_seen_in_partition", sequence_scope_operation_ids: ["partition"],
      sequence_identity_setting_ids: ["identity"], sequence_first_symbol_setting_id: "first", sequence_repeat_symbol_setting_id: "repeat" }] };
  assert.doesNotThrow(() => validateOperationReferences(sequenceProfile));
  for (const value of ["null", "1", "{}", '""', '"B"', "invalid"]) {
    const mutant = structuredClone(sequenceProfile);
    mutant.method_settings[0].method_value_json = value;
    assert.throws(() => validateOperationReferences(mutant), /invalid literal sequence symbols/);
  }
  for (const change of [{ sequence_encoding_rule: "global_history" }, { sequence_encoding_rule: null },
    { sequence_scope_operation_ids: [] }, { sequence_scope_operation_ids: ["foreign"] },
    { sequence_scope_operation_ids: ["encode"] }, { sequence_scope_operation_ids: ["partition", "partition"] },
    { sequence_identity_setting_ids: [] }, { sequence_identity_setting_ids: ["foreign"] },
    { sequence_identity_setting_ids: ["identity", "identity"] }, { sequence_first_symbol_setting_id: "foreign" },
    { sequence_first_symbol_setting_id: null }, { sequence_repeat_symbol_setting_id: "first" }, { selection_rule: "FIRST" }]) {
    const mutant = structuredClone(sequenceProfile);
    Object.assign(mutant.method_operations[1], change);
    assert.throws(() => validateOperationReferences(mutant), /invalid partition-local sequence/);
  }
  const groupedProfile = { source_work_id: "synthetic:subset", method_setting_ids: ["field"],
    method_operations: [{ operation_id: "partition" }, { operation_id: "summary", depends_on: ["partition"] },
      { operation_id: "subset", depends_on: ["summary"], group_scope_operation_ids: ["partition"],
        grouping_basis: "field_equality", equality_key_setting_ids: ["field"], selection_rule: "FIRST" }] };
  assert.doesNotThrow(() => validateOperationReferences(groupedProfile));
  const concatenatedGroup = structuredClone(groupedProfile);
  concatenatedGroup.method_setting_ids.push("group");
  Object.assign(concatenatedGroup.method_operations[2], {
    grouping_basis: "raw_string_concatenation", equality_key_setting_ids: [],
    concatenated_key_setting_ids: ["field", "group"], empty_if_absent_key_setting_ids: ["group"],
    selection_rule: "RETAIN_SUMMARIES_IF_PRESENT_ELSE_ALL",
  });
  assert.doesNotThrow(() => validateOperationReferences(concatenatedGroup));
  for (const change of [{ concatenated_key_setting_ids: ["field"] },
    { concatenated_key_setting_ids: ["field", "foreign"] },
    { empty_if_absent_key_setting_ids: ["foreign"] },
    { empty_if_absent_key_setting_ids: ["group", "group"] },
    { equality_key_setting_ids: ["field"] }, { grouping_basis: "field_equality" }]) {
    const invalid = structuredClone(concatenatedGroup);
    Object.assign(invalid.method_operations[2], change);
    assert.throws(() => validateOperationReferences(invalid), /invalid grouped subset/);
  }
  const cyclicGroup = structuredClone(groupedProfile);
  cyclicGroup.method_operations[0].depends_on = ["subset"];
  assert.throws(() => validateOperationReferences(cyclicGroup), /dependency cycle/);
  assert.throws(() => validateOperationReferences({ ...groupedProfile,
    method_operations: [{ operation_id: "unselected", grouping_basis: null, selection_rule: null }] }), /must not be null/);
  const foreignGroup = structuredClone(groupedProfile);
  foreignGroup.method_operations[2].equality_key_setting_ids = ["foreign"];
  assert.throws(() => validateOperationReferences(foreignGroup), /invalid grouped subset/);
  const payloadOperation = { operation_id: "capture", required_event_payload_roles: ["screenshot", "view_hierarchy"],
    optional_event_payload_roles: ["gesture"], event_payload_association: "gesture_to_most_recent_paired_snapshot",
    missing_gesture_marks_incomplete: true, gesture_presence_implies_correctness: false };
  const payloadProfile = { ...groupedProfile, method_operations: [payloadOperation] };
  assert.doesNotThrow(() => validateOperationReferences(payloadProfile));
  for (const change of [{ required_event_payload_roles: ["screenshot"] },
    { optional_event_payload_roles: [] }, { optional_event_payload_roles: ["gesture", "gesture"] },
    { optional_event_payload_roles: ["screenshot"] }, { optional_event_payload_roles: ["unknown"] },
    { event_payload_association: null }]) {
    assert.throws(() => validateOperationReferences({ ...payloadProfile,
      method_operations: [{ ...payloadOperation, ...change }] }));
  }
  const protocolAttachment = {
    study_method_profile: { source_locators: ["source:protocol"] },
    attachment_blockers: [{
      materialization_id: "protocol:example",
      ontology_class: "AcquisitionProtocol",
      typed_profile_slot: "acquisition_protocols",
      attached: true,
      candidate_member_setting_ids: ["setting:left", "setting:right"],
      object_blockers: [
        { code: "unmapped_parameter_semantics", field: "left", method_setting_ids: ["setting:left"] },
        { code: "unmapped_parameter_semantics", field: "right", method_setting_ids: ["setting:right"] },
        { code: "missing_protocol_context", field: "collector" },
        { code: "missing_release_context", field: "measurement_source", method_setting_ids: ["setting:left"] },
      ],
    }],
  };
  const protocolBlockers = protocolMaterializationBlockers(protocolAttachment);
  if (!isDeepStrictEqual(protocolBlockers.map((blocker) => blocker.blocked_method_setting_ids), [
    ["setting:left"], ["setting:right"], ["setting:left", "setting:right"],
    ["setting:left", "setting:right"],
  ])) {
    throw new Error("protocol field blockers must retain their setting scope; object-wide context remains blocking");
  }
  const sourceArtifactRows = new Map([["setting:ready", {
    candidate_status: "ready_for_typed_registry", source_work_id: "work:example", source_extraction_id: "extraction:example",
  }], ["setting:blocked", {
    candidate_status: "blocked", source_work_id: "work:example", source_extraction_id: "extraction:example",
  }]]);
  const releaseBlocker = {
    protocol_ontology_class: "MeasurementReleaseProfile", protocol_profile_slot: "release_profiles",
    protocol_materialization_id: "measurement-release-profile:extraction:example",
    protocol_blocker_code: "unmapped_parameter_semantics", blocked_method_setting_ids: ["setting:ready"],
  };
  const sourceArtifactProfile = { source_work_id: "work:example" };
  if (!sourceArtifactReplacesReleaseBlocker(releaseBlocker, sourceArtifactProfile, sourceArtifactRows)
    || !sourceArtifactReplacesReleaseBlocker({ ...releaseBlocker, protocol_blocker_code: "missing_release_context" }, sourceArtifactProfile, sourceArtifactRows)) {
    throw new Error("validated source artifacts retained errors from an incompatible release model");
  }
  for (const overrides of [
    { blocked_method_setting_ids: [] },
    { blocked_method_setting_ids: ["setting:unknown"] },
    { blocked_method_setting_ids: ["setting:ready", "setting:blocked"], protocol_blocker_code: "missing_release_context" },
    { protocol_ontology_class: "AcquisitionProtocol" },
    { protocol_profile_slot: "acquisition_protocols" },
    { protocol_materialization_id: "measurement-release-profile:extraction:other" },
    { protocol_blocker_code: "unsupported_release_transformation" },
  ]) {
    if (sourceArtifactReplacesReleaseBlocker({ ...releaseBlocker, ...overrides }, sourceArtifactProfile, sourceArtifactRows)) {
      throw new Error("source-artifact routing suppressed an unresolved or unrelated protocol error");
    }
  }
  if (sourceArtifactReplacesReleaseBlocker(releaseBlocker, { source_work_id: "work:other" }, sourceArtifactRows)) {
    throw new Error("source-artifact routing crossed source work identity");
  }
  const packetProfile = { source_work_id: "work:example", protocol_materialization_blockers: [{
    protocol_materialization_blocker_id: "blocker:example", protocol_blocker_reason: "source-backed reason",
    source_locators: ["source:1-2"], blocked_method_setting_ids: ["setting:left", "setting:right"],
  }] };
  const scopedPacketProfile = { ...packetProfile, protocol_materialization_blockers: [{
    ...packetProfile.protocol_materialization_blockers[0], blocked_method_setting_ids: ["setting:left"],
  }] };
  const refreshedPacketProfile = refreshPacketProtocolBlockerScopes(packetProfile, scopedPacketProfile);
  if (!isDeepStrictEqual(refreshedPacketProfile, scopedPacketProfile)
    || isDeepStrictEqual(refreshedPacketProfile, { ...scopedPacketProfile, protocol_materialization_blockers: [{
      ...scopedPacketProfile.protocol_materialization_blockers[0], source_locators: ["forged:1-2"],
    }] })) {
    throw new Error("packet replay must allow only current blocker scope, not source evidence changes");
  }
  for (const current of [
    { ...scopedPacketProfile, source_work_id: "work:other" },
    { ...scopedPacketProfile, protocol_materialization_blockers: [] },
    { ...scopedPacketProfile, protocol_materialization_blockers: [{
      ...scopedPacketProfile.protocol_materialization_blockers[0], blocked_method_setting_ids: ["setting:other"],
    }] },
  ]) {
    let rejected = false;
    try { refreshPacketProtocolBlockerScopes(packetProfile, current); } catch { rejected = true; }
    if (!rejected) throw new Error("packet replay accepted missing or cross-identity blocker scope");
  }
  const figureResult = {
    source_work_id: "doi:10.1007/978-3-319-23222-5_4",
    method_setting_role: "validation",
    method_parameter_key: "result.figure3.example",
  };
  if (safeEvidenceReceiptCategory({
    ...figureResult,
    integration_source: "projectable_source_completeness_audit_v1:source_gap_or_conflict",
    method_execution_blocker_code: "indispensable_source_evidence_unavailable",
  }) !== null
    || safeEvidenceReceiptCategory({
      ...figureResult,
      integration_source: "projectable_source_completeness_audit_v1:scientific_oracle",
    }) !== "published_table_or_figure_result") {
    throw new Error("undisclosed source gaps were conflated with reported result oracles");
  }
  const topologyVerdicts = [...configurationUnitKinds].map((configuration_unit_kind) => ({ configuration_unit_kind }));
  if (selectableConfigurationVerdicts(topologyVerdicts).length !== 1) {
    throw new Error("non-selectable topology became configuration choices");
  }
  let invalidTopologyAccepted = false;
  try {
    selectableConfigurationVerdicts([{ configuration_unit_kind: "invented" }]);
    invalidTopologyAccepted = true;
  } catch {}
  if (invalidTopologyAccepted) throw new Error("unknown configuration unit kind was accepted");
  const partition = finalizeSelectableConfigurationLevels([
    { included_method_setting_ids: ["setting:common", "setting:left"] },
    { included_method_setting_ids: ["setting:common", "setting:right"] },
  ], [
    { method_setting_id: "setting:common" },
    { method_setting_id: "setting:left" },
    { method_setting_id: "setting:right" },
    { method_setting_id: "setting:fixed" },
  ]);
  if (!isDeepStrictEqual(partition.invariantMethodSettingIds, ["setting:fixed"])
    || !isDeepStrictEqual(partition.configurationLevels.map((level) => level.common_method_setting_ids), [
      ["setting:common"], ["setting:common"],
    ])
    || !isDeepStrictEqual(partition.configurationLevels.map((level) => level.branch_method_setting_ids), [
      ["setting:left"], ["setting:right"],
    ])
    || !isDeepStrictEqual(partition.configurationLevels.map((level) => level.excluded_method_setting_ids), [
      ["setting:right"], ["setting:left"],
    ])) {
    throw new Error("selectable levels do not preserve fixed/common/branch partitions");
  }
  const baselineManifest = `{
  "fixtures": [
    {
      "fixture_id": "fixture:baseline",
      "method_setting_ids": ["setting:baseline"]
    }
  ]
}
`;
  const additiveManifest = baselineManifest.replace(
    '["setting:baseline"]',
    '[\n        "setting:baseline",\n        "setting:additive"\n      ]',
  );
  const projectedManifest = projectNativeConformanceManifest(
    additiveManifest,
    new Set(["fixture:baseline"]),
    new Set(["setting:baseline"]),
  );
  if (projectedManifest.projected !== baselineManifest
    || projectedManifest.removedSettingIds[0] !== "setting:additive") {
    throw new Error("native conformance additive-setting projection failed");
  }
  const assertions = [{
    method_setting_id: "s1",
    source_extraction_id: "e1",
    source_work_id: "w1",
    method_applicability_status: "applicable",
    method_disclosure_status: "declared",
    method_setting_role: "reconstruction",
    method_implementation_status: "unresolved",
    conformance_fixture_id: "fixture:s1",
    conformance_result_digest: `sha256:${"a".repeat(64)}`,
  }];
  const decisions = [{
    method_setting_id: "s1",
    implementation_status: "native",
    canonical_parameter_key: "minimum_usage_duration",
    mapped_contract_slots: ["minimum_usage_duration"],
    mapped_ontology_terms: ["DurationPolicy"],
    value_json: "60",
    value_kind: "integer",
    unit: "seconds",
    comparator: null,
    boundary_convention: null,
    executor_id: nativeExecutor,
    required_inputs: [],
    confidence: 1,
    rationale: "exact",
  }];
  const profile = { source_work_id: "w1", source_method_variant_id: "primary", method_configuration_structure: "fixed" };
  const result = merge(assertions, [profile], decisions, new Set(["minimum_usage_duration"]));
  if (result.mergedAssertions[0].contract_bindings[0].contract_value_json !== "60") throw new Error("native binding failed");
  if (result.mergedProfiles[0].profile_implementation_status !== "executable") throw new Error("profile gate failed");
  let rejected = false;
  try {
    merge(assertions, [profile], [{ ...decisions[0], canonical_parameter_key: "invented" }], new Set(["minimum_usage_duration"]));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("unknown native slot was accepted");
  const compound = merge(assertions, [profile], [{
    ...decisions[0],
    canonical_parameter_key: "minimum_usage_duration",
    mapped_contract_slots: ["minimum_usage_duration", "filter_zero_duration_sessions"],
    value_json: '{"minimum_usage_duration":60,"filter_zero_duration_sessions":true}',
  }], new Set(["minimum_usage_duration", "filter_zero_duration_sessions"]));
  if (compound.mergedAssertions.length !== 2 || new Set(compound.mergedAssertions.map((row) => row.source_extraction_id)).size !== 1) {
    throw new Error("atomic native fanout failed");
  }
  const auditedDecision = {
    method_setting_id: "audited:1",
    source_extraction_id: "extraction:audited",
    source_work_id: "work:audited",
    binding_decision: {
      parameter_schema: {
        bindings: [{ browser: "processScreenUsage", rust: "include_screen_output", value: true }],
      },
    },
  };
  const auditedBindings = exactAuditBindings(auditedDecision, new Set(["process_screen_usage"]));
  const pending = applyNativeRouteAudit({
    method_setting_id: auditedDecision.method_setting_id,
    source_extraction_id: auditedDecision.source_extraction_id,
    source_work_id: auditedDecision.source_work_id,
    method_implementation_status: "specification_only",
    method_execution_route: "native_operator_parameter",
    conformance_fixture_id: "unrun",
    conformance_result_digest: `sha256:${"b".repeat(64)}`,
  }, {
    classification: "exact_existing_binding",
    rationale: "exact browser binding; conformance not run",
    requiredInputs: [],
    bindings: auditedBindings,
    decision: auditedDecision,
  });
  if (pending.contract_bindings[0].contract_slot !== "process_screen_usage"
    || pending.method_execution_route !== "native_option_binding"
    || pending.method_implementation_status !== "specification_only"
    || pending.method_execution_blocker_code !== "native_binding_conformance_pending"
    || pending.conformance_fixture_id || pending.conformance_result_digest) {
    throw new Error("audited exact binding was not kept conformance-pending");
  }
  const proven = applyNativeRouteAudit(pending, {
    classification: "exact_existing_binding",
    rationale: "exact browser binding; conformance passed",
    requiredInputs: [],
    bindings: auditedBindings,
    decision: auditedDecision,
  }, {
    fixture_id: "fixture:audited:1",
    conformance_result_digest: `sha256:${"c".repeat(64)}`,
  });
  if (proven.method_implementation_status !== "native"
    || proven.method_execution_blocker_code
    || proven.conformance_fixture_id !== "fixture:audited:1"
    || proven.conformance_result_digest !== `sha256:${"c".repeat(64)}`) {
    throw new Error("executed conformance proof did not promote the exact audited binding");
  }
  const sourceCorrected = applySourceSemanticCorrection({
    method_setting_id: "method-setting-21088bd2743bd3054e5fbb5b",
    method_implementation_status: "native",
    method_execution_route: "native_option_binding",
    executor_id: nativeExecutor,
    contract_bindings: [{ contract_slot: "session_grouping_policy", contract_value_json: '"smartphone_wellbeing_strict_lt_5s"' }],
    conformance_fixture_id: "extension.session-gap-strict-lt5s.v1",
    conformance_result_digest: `sha256:${"d".repeat(64)}`,
    required_inputs: ["raw_event_stream"],
  });
  if (sourceCorrected.method_implementation_status !== "specification_only"
    || sourceCorrected.method_execution_route !== "native_operator_parameter"
    || sourceCorrected.contract_bindings.length
    || sourceCorrected.executor_id
    || sourceCorrected.conformance_fixture_id
    || sourceCorrected.conformance_result_digest
    || !sourceCorrected.required_inputs.includes("screen_state_event_stream")
    || !sourceCorrected.required_inputs.includes("source_row_order")) {
    throw new Error("source-semantic correction retained a false native execution claim");
  }
  const sourceBoundaryCorrected = applySourceSemanticCorrection({
    method_setting_id: "method-setting-03ab220c09950d31938fa792",
    method_target_layer: "study_window",
    method_parameter_key: "exclusion_background_activity",
    method_value_kind: "boolean",
    method_value_json: "true",
    method_implementation_status: "native",
    executor_id: nativeExecutor,
    contract_bindings: [{ contract_slot: "activity_scope", contract_value_json: '"foreground"' }],
    required_inputs: ["method_input_dataset.activity_scope"],
  });
  if (sourceBoundaryCorrected.method_target_layer !== "raw_record"
    || sourceBoundaryCorrected.method_parameter_key !== "background_activity_recorded"
    || sourceBoundaryCorrected.method_value_json !== "false"
    || sourceBoundaryCorrected.method_implementation_status !== "specification_only"
    || sourceBoundaryCorrected.method_execution_blocker_code
      !== "source_semantic_mismatch:collector_nonrecording_is_not_background_row_exclusion"
    || sourceBoundaryCorrected.executor_id
    || sourceBoundaryCorrected.conformance_fixture_id
    || sourceBoundaryCorrected.conformance_result_digest
    || sourceBoundaryCorrected.required_inputs.includes("method_input_dataset.activity_scope")
    || !sourceBoundaryCorrected.required_inputs.includes("ethica_app_usage_stream.fg_time_ms")) {
    throw new Error("source-boundary correction retained the forced normalized-row mapping");
  }
  const qualityBindings = exactAuditBindings({
    method_setting_id: "audited:quality",
    binding: { same_app_stop_types: ["Activity Paused"] },
    gui_control_mapping: { controls: ["sameAppInteractionTypesToStopUsageAt"] },
  }, new Set(["same_app_interaction_types_to_stop_usage_at"]));
  if (qualityBindings[0].contract_slot !== "same_app_interaction_types_to_stop_usage_at") {
    throw new Error("quality internal binding was not mapped through the browser contract");
  }
  const repaired = applySourceEvidenceRepair({
    method_setting_id: "repaired:1",
    source_extraction_id: "extraction:repaired",
    source_work_id: "work:repaired",
    source_locators: ["source#L1"],
    source_value_json: '"fragment"',
    method_execution_blocker_code: "source_evidence_blocked",
    contract_bindings: [{ contract_slot: "invented", contract_value_json: "true" }],
  }, {
    method_setting_id: "repaired:1",
    source_extraction_id: "extraction:repaired",
    source_work_id: "work:repaired",
    source_locators: ["source#L1"],
    source_clause_ids: ["extraction:repaired:clause:01"],
    source_value_json: '"fragment"',
    corrected_method_setting_role: "reporting",
    corrected_method_target_layer: "released_artifact",
    corrected_method_parameter_key: "reported_count",
    corrected_method_value_kind: "integer",
    corrected_method_value_json: "42",
    corrected_method_applicability_status: "applicable",
    corrected_method_disclosure_status: "declared",
    corrected_method_implementation_status: "specification_only",
    corrected_method_execution_route: "receipt_conformance",
    corrected_method_execution_destination_id: "literature.receipt.reporting",
    corrected_method_execution_parameter_path: "/receipts/documentary/repaired:1",
    corrected_method_execution_blocker_code: "receipt_binding_unimplemented",
    required_inputs: [],
    repair_rationale: "documentary assertion",
  });
  if (repaired.method_execution_blocker_code !== "receipt_binding_unimplemented"
    || repaired.method_parameter_key !== "reported_count"
    || repaired.contract_bindings.length !== 0) {
    throw new Error("source-evidence repair did not override the false native route");
  }
  const inputAudited = applyMissingInputAudit({ method_execution_blocker_code: "missing_input" }, {
    input_classification: "small_extension_existing_support_schema_or_adapter",
    classification_basis: "existing carrier needs a typed decoder",
  });
  if (inputAudited.method_execution_blocker_code !== "input_adapter_extension_required") {
    throw new Error("missing-input audit did not refine the blocker code");
  }
  const postAuditSetting = {
    method_setting_id: "post-audit:1",
    source_work_id: "work:post-audit",
    method_value_json: '"exact value"',
    source_value_json: '"source clause: exact value"',
    method_implementation_status: "specification_only",
    method_execution_blocker_code: "source_completeness_execution_pending",
  };
  const postAuditProfile = {
    method_profile_id: "profile:post-audit",
    source_work_id: "work:post-audit",
    source_method_variant_id: "variant:post-audit",
    method_profile_version: "profile-version:post-audit",
    method_setting_ids: [postAuditSetting.method_setting_id],
  };
  const postAuditPromotion = {
    mapping: {
      schema_version: "chronicle-literature-input-conformance-mapping/v1",
      method_setting_id: postAuditSetting.method_setting_id,
      source_work_id: postAuditSetting.source_work_id,
      source_value: "exact value",
      fixture_id: "fixture:post-audit",
      fixture_source_digest: `sha256:${"a".repeat(64)}`,
      adapter_id: "chronicle.post-audit/v1",
      adapted_output_digest: `sha256:${"b".repeat(64)}`,
      conformance_result_digest: `sha256:${"c".repeat(64)}`,
      assertions_passed: true,
    },
    contract: {
      adapterId: "chronicle.post-audit",
      adapterVersion: "v1",
      routeKind: "protocol_input",
      schemaId: "chronicle-post-audit/v1",
      methodSettingIds: [postAuditSetting.method_setting_id],
      sourceSchemas: [{
        methodSettingId: postAuditSetting.method_setting_id,
        sourceWorkId: postAuditSetting.source_work_id,
        sourceValue: "exact value",
        sourceValueSha256: sha256Bytes("source clause: exact value").slice(7),
      }],
      componentExecution: {
        parentMethodProfileId: postAuditProfile.method_profile_id,
        sourceWorkId: postAuditProfile.source_work_id,
        sourceMethodVariantId: postAuditProfile.source_method_variant_id,
        methodProfileVersion: postAuditProfile.method_profile_version,
      },
    },
    fixture: {
      methodSettingId: postAuditSetting.method_setting_id,
      sourceWorkId: postAuditSetting.source_work_id,
      sourceValue: "exact value",
      fixtureId: "fixture:post-audit",
      adapterId: "chronicle.post-audit/v1",
    },
    sourceMethodVariantId: postAuditProfile.source_method_variant_id,
    sourceSchemaEvidenceVerified: true,
  };
  if (postAuditInputComponentPromotionFailures(
    postAuditSetting, postAuditProfile, 1, postAuditPromotion,
  ).length) {
    throw new Error("exact post-audit input/component proof was not promotable");
  }
  const driftedPostAuditPromotion = {
    ...postAuditPromotion,
    contract: {
      ...postAuditPromotion.contract,
      componentExecution: {
        ...postAuditPromotion.contract.componentExecution,
        methodProfileVersion: "wrong-version",
      },
    },
  };
  if (!postAuditInputComponentPromotionFailures(
    postAuditSetting, postAuditProfile, 1, driftedPostAuditPromotion,
  ).includes("component_version")) {
    throw new Error("post-audit component version drift was not fail-closed");
  }
  if (!postAuditInputComponentPromotionFailures(
    postAuditSetting,
    postAuditProfile,
    1,
    { ...postAuditPromotion, contract: { ...postAuditPromotion.contract,
      sourceSchemas: [{ ...postAuditPromotion.contract.sourceSchemas[0], sourceValueSha256: "d".repeat(64) }],
    } },
  ).includes("source_schema_evidence")) {
    throw new Error("post-audit source-schema evidence drift was not fail-closed");
  }
  const postAuditImplemented = applyInputAdapterImplementation(postAuditSetting, postAuditPromotion);
  if (postAuditImplemented.source_value_sha256 !== sha256Bytes("source clause: exact value").slice(7)
    || postAuditImplemented.method_implementation_status !== "native") {
    throw new Error("verified post-audit source-schema implementation was not promoted");
  }
  const labelOnlyPromotion = {
    ...postAuditPromotion,
    mapping: { ...postAuditPromotion.mapping, source_value: "source clause: exact value" },
    fixture: { ...postAuditPromotion.fixture, sourceValue: "source clause: exact value" },
  };
  if (!postAuditInputComponentPromotionFailures(
    postAuditSetting, postAuditProfile, 1, labelOnlyPromotion,
  ).includes("canonical_source_value")) {
    throw new Error("descriptive source label was accepted as the runtime method value");
  }
  if (!postAuditInputComponentPromotionFailures(
    { ...postAuditSetting, source_value_json: "invalid" }, postAuditProfile, 1, postAuditPromotion,
  ).includes("source_schema_evidence")) {
    throw new Error("invalid current source evidence was accepted using stale validation");
  }
  const executorAudited = applyExternalExecutorAudit({
    method_setting_id: "external:1",
    source_extraction_id: "extraction:external",
    source_work_id: "work:external",
    method_value_json: '"daily mean"',
  }, {
    source_extraction_id: "extraction:external",
    source_work_id: "work:external",
    method_value_json: '"daily mean"',
    executor_family_id: "chronicle.downstream.windowed-tabular-summary",
    executor_family_version: "proposed-1",
    disposition: "extend_existing_downstream_operator",
    rationale: "deterministic downstream summary",
  });
  if (executorAudited.method_execution_blocker_code !== "downstream_operator_extension_required"
    || executorAudited.method_execution_destination_id !== "chronicle.downstream.windowed-tabular-summary@proposed-1") {
    throw new Error("external-executor audit did not refine the exact executor family");
  }
  const correctedAudit = {
    bySetting: new Map([["corrected:1", {
      classification: "new_operator_required",
      decision: {
        method_setting_id: "corrected:1",
        source_work_id: "work:corrected",
        method_value_json: '"half-open [start,end)"',
      },
    }]]),
  };
  const correctedTranche = {
    schema_version: "chronicle-new-operator-tranche/v1",
    tranche_id: "T-self-test",
    dependency_order: 2,
    corrected_route: "existing_timeline_sampling_operator_extension",
    implementation_status: "input_complete_extension_required",
    method_setting_ids: ["corrected:1"],
    source_semantics: [{
      source_work_id: "work:corrected",
      source_value: "expand a half-open interval from start through end minus one unit",
      atomic_values: { "corrected:1": "half-open [start,end)" },
    }],
    rationale: "extend the existing interval-grid family",
    dependencies: [],
    paths: { contract: [], backend: [], gui: [], receipt: [], fixture: [] },
    recommended_first: true,
    support_claimed: false,
  };
  const correctedValidation = {
    schema_version: "chronicle-new-operator-tranche-validation/v1",
    audit_input_count: 1,
    audit_input_unique_count: 1,
    source_repaired_sibling_count: 0,
    planning_input_count: 1,
    planning_input_unique_count: 1,
    manifest_flattened_count: 1,
    manifest_flattened_unique_count: 1,
    missing_method_setting_ids: [],
    unexpected_method_setting_ids: [],
    duplicate_method_setting_ids: [],
    tranche_count: 1,
    corrected_route_counts: { existing_operator_extension: 1 },
    input_complete_new_native_operator_family_count: 0,
    recommended_first_tranche: "T-self-test",
    recommended_first_count: 1,
    all_manifest_lines_valid_json: true,
    all_rows_have_source_semantics: true,
    all_rows_have_contract_backend_gui_receipt_fixture_paths: true,
    all_planned_support_fail_closed: true,
    repo_source_files_modified_by_this_task: false,
    validation_status: "PASS",
  };
  const correctedPartition = validateCorrectedNewOperatorPartition(
    [correctedTranche], correctedValidation, correctedAudit, 1,
  );
  const correctedSetting = applyCorrectedNewOperatorPartition({
    method_setting_id: "corrected:1",
    source_work_id: "work:corrected",
    method_value_json: '"half-open [start,end)"',
    method_implementation_status: "native",
    executor_id: nativeExecutor,
    mapped_contract_slot: ["invented"],
    contract_bindings: [{ contract_slot: "invented", contract_value_json: "true" }],
    conformance_fixture_id: "invented",
    conformance_result_digest: `sha256:${"d".repeat(64)}`,
  }, correctedPartition.bySetting.get("corrected:1"));
  if (correctedSetting.method_implementation_status !== "specification_only"
    || correctedSetting.method_execution_route !== "native_operator_parameter"
    || correctedSetting.method_execution_destination_id
      !== "T-self-test@existing_timeline_sampling_operator_extension"
    || correctedSetting.method_execution_blocker_code
      !== "corrected_new_operator:existing_timeline_sampling_operator_extension:input_complete_extension_required"
    || correctedSetting.executor_id
    || correctedSetting.contract_bindings.length
    || correctedSetting.conformance_fixture_id
    || correctedSetting.conformance_result_digest
    || correctedSetting.method_value_json !== '"half-open [start,end)"') {
    throw new Error("corrected new-operator partition did not remain fail-closed and value-preserving");
  }
  let supportClaimRejected = false;
  try {
    validateCorrectedNewOperatorPartition(
      [{ ...correctedTranche, support_claimed: true }], correctedValidation, correctedAudit, 1,
    );
  } catch {
    supportClaimRejected = true;
  }
  if (!supportClaimRejected) throw new Error("support-claiming corrected new-operator tranche was accepted");
}

// Existing pure projectors can be reused for bounded additive publication without
// replaying unrelated historical implementation manifests or writing on import.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
selfTest();
if (process.argv.includes("--self-test")) {
  process.stdout.write("merge_method_profile_adjudications self-test OK\n");
  process.exit(0);
}

const assertions = jsonl(resolve(run, "method-setting-assertions.jsonl"));
const profiles = jsonl(resolve(run, "study-method-profiles.jsonl"));
const corpusDecisions = decisionPaths.flatMap(jsonl);
if (new Set(corpusDecisions.map((row) => row.method_setting_id)).size !== corpusDecisions.length) {
  throw new Error("adjudication corpus contains duplicate method_setting_id values");
}
const retainedApplicableIds = new Set(assertions
  .filter((row) => applicableDisclosures.has(row.method_disclosure_status))
  .map((row) => row.method_setting_id));
const decisions = corpusDecisions.filter((row) => retainedApplicableIds.has(row.method_setting_id));
const contract = parseYaml(readFileSync(resolve(repo, "web/schema/chronicle-local-contract.linkml.yaml"), "utf8"));
const ontology = parseYaml(readFileSync(resolve(repo, "web/schema/chronicle-research-ontology.linkml.yaml"), "utf8"));
const contractSlots = exactContractSlots(contract);
const atomicCandidates = atomicPaths.every(existsSync) ? atomicPaths.flatMap(jsonl) : null;
const expectedAtomicExtractions = new Set(assertions
  .filter((row) => row.method_applicability_status === "applicable")
  .map((row) => row.source_extraction_id));
const candidateAtomicExtractions = new Set((atomicCandidates ?? []).map((row) => row.source_extraction_id));
const atomicRows = atomicCandidates
  && expectedAtomicExtractions.size === candidateAtomicExtractions.size
  && [...expectedAtomicExtractions].every((id) => candidateAtomicExtractions.has(id))
  ? atomicCandidates
  : null;
const merged = atomicRows
  ? mergeAtomic(assertions, profiles, atomicRows, decisions, contractSlots, ontology)
  : merge(assertions, profiles, decisions, contractSlots);
const atomicValidation = merged.atomicValidation ?? {};
const assembled = assembleProfileStructures(merged.mergedProfiles, merged.mergedAssertions, contractSlots);
const bsnRepair = applyBsnRepairOverlay(
  assembled.routedAssertions,
  assembled.assembledProfiles,
  assembled.spaces,
  ontology,
);
const {
  nativeRouteAuditSummary,
  correctedNewOperatorPartitionSummary,
  nativeConformanceSummary,
  strictGapExtensionSummary,
  strictScreenGateExtensionSummary,
  directUnlockExtensionSummary,
  sourceOrderExtensionSummary,
  screenPolicyExtensionSummary,
  behappIntervalExtensionSummary,
  topAppSelectionExtensionSummary,
  screenDurationParticipantExclusionSummary,
  appOpeningIterationExtensionSummary,
  applicationLabelExtensionSummary,
  sourceEvidenceRepairSummary,
  missingInputAuditSummary,
  inputAdapterImplementationSummary,
  postAuditInputAdapterCandidates,
  lateSourceCompletenessInputAdapterPromotions,
  externalExecutorAuditSummary,
} = assembled;
const sourceArtifactRepair = applySourceArtifactRegistry(bsnRepair.assertions, bsnRepair.profiles);
const packet09Integration = applyPacket09IntegrationOverlay(
  sourceArtifactRepair.assertions,
  sourceArtifactRepair.profiles,
);
const existingAggregateConformance = applyExistingAggregateConformance(
  packet09Integration.assertions,
  packet09Integration.profiles,
);
const publishedSessionOutputConformance = applyPublishedSessionOutputSchemaConformance(
  existingAggregateConformance.assertions,
  existingAggregateConformance.profiles,
);
const profileProtocolAudit = applyProfileProtocolDocumentaryRegistry(
  publishedSessionOutputConformance.assertions,
  publishedSessionOutputConformance.profiles,
);
const hammerSourceCompletenessRepair = applyHammerSourceCompletenessAudit(
  profileProtocolAudit.assertions,
  profileProtocolAudit.profiles,
  bsnRepair.spaces,
  ontology,
);
const hushSourceCompletenessRepair = applyHushSourceCompletenessAudit(
  hammerSourceCompletenessRepair.assertions,
  hammerSourceCompletenessRepair.profiles,
  hammerSourceCompletenessRepair.spaces,
  ontology,
);
const projectableSourceCompletenessRepair = applyProjectableSourceCompletenessAudits(
  hushSourceCompletenessRepair.assertions,
  hushSourceCompletenessRepair.profiles,
  hushSourceCompletenessRepair.spaces,
  ontology,
);
const fiveSecondSemanticRepair = applyFiveSecondPostProjectionCorrections(
  projectableSourceCompletenessRepair.assertions,
  projectableSourceCompletenessRepair.profiles,
  projectableSourceCompletenessRepair.spaces,
);
const lateSourceCompletenessInputAdapters = applyLateSourceCompletenessInputAdapterImplementations(
  fiveSecondSemanticRepair.assertions,
  fiveSecondSemanticRepair.profiles,
  fiveSecondSemanticRepair.spaces,
  lateSourceCompletenessInputAdapterPromotions,
);
const externalExecutionReceipts = applyExternalExecutionReceipts(
  lateSourceCompletenessInputAdapters.assertions,
  lateSourceCompletenessInputAdapters.profiles,
  lateSourceCompletenessInputAdapters.spaces,
);
const postAuditInputAdapters = applyPostAuditInputAdapterImplementations(
  externalExecutionReceipts.assertions,
  externalExecutionReceipts.profiles,
  externalExecutionReceipts.spaces,
  postAuditInputAdapterCandidates,
);
const safeEvidenceReceiptCorrection = applySafeEvidenceReceiptCorrections(
  postAuditInputAdapters.assertions,
  postAuditInputAdapters.profiles,
  postAuditInputAdapters.spaces,
);
const profileProtocolRepair = promoteProfileProtocolDocumentaryRegistry(
  safeEvidenceReceiptCorrection.assertions,
  safeEvidenceReceiptCorrection.profiles,
  profileProtocolAudit.summary,
);
const reviewCrosswalk = jsonl(resolve(repo,
  ".tmp-literature-review-private/corrective-final-reconciliation-20260831/retained-profile-crosswalk.jsonl"))
  .concat(projectableSourceCompletenessRepair.admissions);
const reviewQueue = applyAdmissionsToReviewQueue(jsonl(resolve(repo,
  ".tmp-literature-review-private/corrective-final-reconciliation-20260831/corrected-queue-state.jsonl")),
projectableSourceCompletenessRepair.admissions);
const reviewedWorkIds = new Set(profileProtocolRepair.profiles.map((profile) => profile.source_work_id));
const retainedWorkIds = new Set(reviewCrosswalk.map((row) => row.canonical_work_id));
const reviewQueueById = new Map(reviewQueue.map((row) => [row.canonical_work_id, row]));
if (reviewQueueById.size !== reviewQueue.length
  || retainedWorkIds.size !== reviewCrosswalk.length
  || reviewCrosswalk.some((row) => !row.decision.startsWith("RETAIN")
    || !reviewedWorkIds.has(row.canonical_work_id))
  || [...reviewedWorkIds].some((id) => {
    const row = reviewQueueById.get(id);
    return !row || !row.access_depth || (retainedWorkIds.has(id) ? !row.decision.startsWith("RETAIN")
      : !["EXCLUDE", "ACQUISITION_PENDING"].includes(row.decision)
        || !row.decision_reason || !row.decision_evidence);
  })) {
  throw new Error("reviewed queue and retained crosswalk must exactly classify and source-label every audited profile");
}
const projectedRetainedWorkIds = new Set(projectableSourceCompletenessRepair.summary.source_work_ids
  .filter((id) => retainedWorkIds.has(id)));
for (const [id, repair] of [
  ["doi:10.1145/2634317.2634325", hammerSourceCompletenessRepair],
  ["doi:10.1145/2789168.2790107", hushSourceCompletenessRepair],
]) {
  if (repair.summary.validation_passed
    && repair.summary.covered_disclosed_atoms === repair.summary.audited_disclosed_atoms) {
    projectedRetainedWorkIds.add(id);
  }
}
const unprojectedRetainedWorkIds = [...retainedWorkIds].filter((id) => !projectedRetainedWorkIds.has(id));
if (unprojectedRetainedWorkIds.length || projectedRetainedWorkIds.size !== retainedWorkIds.size) {
  throw new Error(`retained source-completeness projection mismatch: ${unprojectedRetainedWorkIds.join(", ")}`);
}
const mergedAssertions = profileProtocolRepair.assertions.filter((row) => retainedWorkIds.has(row.source_work_id));
const finalCanonicalAssertionsById = new Map(mergedAssertions.map((row) => [row.method_setting_id, row]));
const finalProtocolSlots = [
  "acquisition_protocols", "session_construction_policies", "notification_attribution_policies",
  "duration_policies", "timestamp_policies", "parameter_provenance_assertions", "release_profiles",
];
const mergedProfiles = profileProtocolRepair.profiles.filter((row) => retainedWorkIds.has(row.source_work_id))
  .map((profile) => ({
    ...profile,
    ...refreshProtocolMethodSettings(
      Object.fromEntries(finalProtocolSlots.map((slot) => [slot, profile[slot] ?? []])),
      profile,
      finalCanonicalAssertionsById,
    ),
  }));
const sourceConfigurationSpaces = safeEvidenceReceiptCorrection.spaces.filter((row) => retainedWorkIds.has(row.source_work_id));
const langenerMissingnessMetadataLevelId = `source-audit-metadata-level-${sha256Bytes("doi:10.3758/s13428-024-02474-5\0example.missingness").slice(7, 31)}`;
const methodSettingAliases = [
  ...bsnRepair.aliases,
  ...hammerSourceCompletenessRepair.aliases,
  ...projectableSourceCompletenessRepair.aliases,
  {
    alias_method_setting_id: "method-setting-a16f7489de7c87044a5f484e",
    alias_source_extraction_id: "extraction-a16f7489de7c87044a5f484e",
    alias_source_work_id: "doi:10.3758/s13428-024-02474-5",
    resolution: "reclassified_as_configuration_metadata",
    replacement_method_configuration_level_id: langenerMissingnessMetadataLevelId,
  },
].filter((row) => retainedWorkIds.has(row.alias_source_work_id));
const methodSettingTombstones = [
  ...bsnRepair.tombstones,
  ...hammerSourceCompletenessRepair.tombstones,
  ...projectableSourceCompletenessRepair.tombstones,
  {
    method_setting_id: "method-setting-a16f7489de7c87044a5f484e",
    source_extraction_id: "extraction-a16f7489de7c87044a5f484e",
    source_work_id: "doi:10.3758/s13428-024-02474-5",
    tombstone_status: "reclassified_as_configuration_metadata",
    replacement_method_configuration_level_id: langenerMissingnessMetadataLevelId,
    preserve_for_alias_resolution: true,
    source_completeness_atom_key: "example.missingness",
  },
].filter((row) => retainedWorkIds.has(row.source_work_id));
if (new Set(methodSettingAliases.map((row) => row.alias_method_setting_id)).size !== methodSettingAliases.length
  || new Set(methodSettingTombstones.map((row) => row.method_setting_id)).size !== methodSettingTombstones.length) {
  throw new Error("method-setting alias or tombstone identities are not unique");
}
const generatedExecutionUnitSettings = mergedAssertions.filter((setting) =>
  setting.method_parameter_key.startsWith("configuration.execution_unit."));
if (generatedExecutionUnitSettings.length) {
  throw new Error(`execution units must remain configuration metadata, found ${generatedExecutionUnitSettings.length} generated method settings`);
}
const safeEvidenceReceiptRows = mergedAssertions.filter((setting) =>
  safeEvidenceReceiptCategory(setting) !== null);
const safeEvidenceReceiptIds = new Set(safeEvidenceReceiptRows.map((setting) => setting.method_setting_id));
const safeDocumentarySchemaRows = safeEvidenceReceiptRows.filter((setting) =>
  safeEvidenceReceiptCategory(setting) === "published_framework_comparison_table_schema");
const safeScientificOracleRows = safeEvidenceReceiptRows.filter((setting) =>
  safeEvidenceReceiptCategory(setting) !== "published_framework_comparison_table_schema");
const safeEvidenceDocumentaryIds = new Set(mergedProfiles.flatMap((profile) =>
  profile.method_configuration_space.documentary_method_setting_ids ?? []));
if (safeEvidenceReceiptIds.size !== safeEvidenceReceiptRows.length
  || safeDocumentarySchemaRows.length + safeScientificOracleRows.length !== safeEvidenceReceiptRows.length
  || safeDocumentarySchemaRows.some((setting) => setting.method_implementation_status !== "native"
    || setting.method_execution_route !== "receipt_conformance"
    || setting.method_execution_destination_id !== "chronicle.profile-protocol-documentary-registry"
    || setting.method_execution_parameter_path !== "/methodProfileReceipt/documentaryBindings"
    || setting.executor_id !== "chronicle_preprocessing_runtime_wasm:profile_protocol_documentary_registry"
    || setting.contract_bindings.length !== 0
    || setting.required_inputs.length !== 0
    || !setting.conformance_fixture_id
    || !/^sha256:[0-9a-f]{64}$/.test(setting.conformance_result_digest)
    || !safeEvidenceDocumentaryIds.has(setting.method_setting_id))
  || safeScientificOracleRows.some((setting) => setting.method_implementation_status !== "specification_only"
    || setting.method_execution_route !== "receipt_conformance"
    || setting.method_execution_destination_id !== "chronicle.reported-result-oracle-evidence@comparison-required"
    || setting.method_execution_parameter_path !== "/methodProfileReadiness/evidence"
    || setting.method_execution_blocker_code !== "scientific_oracle_comparison_receipt_required"
    || setting.executor_id
    || setting.conformance_fixture_id
    || setting.conformance_result_digest
    || setting.contract_bindings.length !== 0
    || !isDeepStrictEqual(setting.required_inputs, ["source_execution_output", "source_result_oracle"])
    || safeEvidenceDocumentaryIds.has(setting.method_setting_id))) {
  throw new Error("safe evidence/documentary receipt classification drift");
}
const applicableMergedAssertions = mergedAssertions.filter((row) => row.method_applicability_status === "applicable");
const replayedAtomicValidation = {
  ...atomicValidation,
  source_extraction_rows: new Set(applicableMergedAssertions.map((row) => row.source_extraction_id)).size,
  atomic_setting_rows: applicableMergedAssertions.length,
  configuration_structured_atomic_settings: applicableMergedAssertions.filter((row) => row.method_variant_group_id).length,
  explicit_variant_or_multiverse_atomic_settings: applicableMergedAssertions.filter(isExplicitVariantOrMultiverse).length,
};
validateLinkmlRows(ontology, "MethodSettingAssertion", mergedAssertions);
validateLinkmlRows(ontology, "MethodContractBinding", mergedAssertions.flatMap((row) => row.contract_bindings ?? []));
validateLinkmlRows(ontology, "StudyMethodProfile", mergedProfiles);
validateLinkmlRows(ontology, "OperationDefinition", mergedProfiles.flatMap((profile) => profile.method_operations ?? []));
const operationSettingsById = new Map(mergedAssertions.map((setting) => [setting.method_setting_id, setting]));
for (const profile of mergedProfiles) validateOperationReferences(profile, operationSettingsById);
validateLinkmlRows(ontology, "MethodConfigurationSpace", mergedProfiles.map((row) => row.method_configuration_space));
validateLinkmlRows(ontology, "MethodConfigurationGroup", mergedProfiles.flatMap((row) => row.method_configuration_space.method_configuration_groups));
validateLinkmlRows(ontology, "MethodConfigurationLevel", mergedProfiles.flatMap((row) =>
  row.method_configuration_space.method_configuration_groups.flatMap((group) => group.method_configuration_levels)));
validateLinkmlRows(ontology, "ProtocolMaterializationBlocker", mergedProfiles.flatMap((row) => row.protocol_materialization_blockers));
validateLinkmlRows(ontology, "SourceArtifactProvenanceAssertion", mergedProfiles.flatMap((row) => row.source_artifact_provenance_assertions));
const assertionsByWork = Map.groupBy(mergedAssertions, (row) => row.source_work_id);
mkdirSync(run, { recursive: true, mode: 0o700 });
chmodSync(run, 0o700);
write(resolve(run, "method-setting-alias-tombstones.json"), `${JSON.stringify({
  schema_version: "chronicle-method-setting-alias-tombstones/v1",
  aliases: methodSettingAliases,
  tombstones: methodSettingTombstones,
}, null, 2)}\n`);
writeJsonl(resolve(run, "adjudicated-method-setting-assertions.jsonl"), mergedAssertions);
writeJsonl(resolve(run, "adjudicated-study-method-profiles.jsonl"), mergedProfiles);
write(resolve(run, "adjudicated-method-profile-library.json"), `${JSON.stringify({
  schema_version: "chronicle-method-profile-library-v2",
  profiles: mergedProfiles.map((profile) => ({
    ...profile,
    method_settings: assertionsByWork.get(profile.source_work_id) ?? [],
  })),
}, null, 2)}\n`);
const configurationSettings = mergedAssertions.filter((setting) => setting.method_variant_group_id);
const configurationGroups = [...Map.groupBy(configurationSettings, (setting) =>
  `${setting.source_work_id}\u001f${setting.method_variant_group_id}`).values()].map((settings) => {
  const configurations = settings.map(methodConfiguration).filter(Boolean);
  const branches = [...Map.groupBy(settings.filter((setting) =>
    setting.method_variant_branch_id || setting.method_variant_branch_label), (setting) =>
    setting.method_variant_branch_id ?? setting.method_variant_branch_label).entries()].map(([branchId, rows]) => ({
    branch_id: branchId,
    branch_labels: [...new Set(rows.map((row) => row.method_variant_branch_label).filter(Boolean))].sort(),
    method_setting_ids: rows.map((row) => row.method_setting_id).sort(),
  })).sort((left, right) => left.branch_id.localeCompare(right.branch_id));
  return {
    source_work_id: settings[0].source_work_id,
    method_variant_group_id: settings[0].method_variant_group_id,
    configuration_kinds: [...new Set(configurations.map((value) => value.kind).filter(Boolean))].sort(),
    relations: [...new Set(settings.map((setting) => setting.method_variant_relation).filter(Boolean))].sort(),
    axes: [...new Set(configurations.map((value) => value.axis).filter(Boolean))].sort(),
    axis_values: [...new Set(configurations.flatMap((value) => value.axis_values_in_source_order ?? []))],
    combination_structures: [...new Map(configurations.filter((value) => value.combination_structure)
      .map((value) => [JSON.stringify(value.combination_structure), value.combination_structure])).values()],
    branches,
    unbranched_method_setting_ids: settings.filter((setting) =>
      !setting.method_variant_branch_id && !setting.method_variant_branch_label).map((setting) => setting.method_setting_id).sort(),
    all_method_setting_ids: settings.map((setting) => setting.method_setting_id).sort(),
    partition_required: settings.some(isExplicitVariantOrMultiverse),
    partition_status: settings.some(isExplicitVariantOrMultiverse) ? "pending" : "joint_or_fixed",
  };
}).sort((left, right) => left.source_work_id.localeCompare(right.source_work_id)
  || left.method_variant_group_id.localeCompare(right.method_variant_group_id));
write(resolve(run, "method-configuration-backlog.json"), `${JSON.stringify({
  schema_version: "chronicle-method-configuration-backlog-v1",
  configuration_group_count: configurationGroups.length,
  partition_required_group_count: configurationGroups.filter((group) => group.partition_required).length,
  affected_source_work_count: new Set(configurationGroups.filter((group) => group.partition_required)
    .map((group) => group.source_work_id)).size,
  groups: configurationGroups,
}, null, 2)}\n`);
const structuredProtocolCandidates = mergedAssertions.flatMap((setting) => {
  if (!setting.structured_protocol_candidate_json) return [];
  return [{
    method_setting_id: setting.method_setting_id,
    source_extraction_id: setting.source_extraction_id,
    source_work_id: setting.source_work_id,
    source_locators: setting.source_locators,
    candidate: JSON.parse(setting.structured_protocol_candidate_json),
  }];
});
write(resolve(run, "structured-protocol-candidates.json"), `${JSON.stringify({
  schema_version: "chronicle-structured-protocol-candidates-v1",
  candidate_count: structuredProtocolCandidates.length,
  source_work_count: new Set(structuredProtocolCandidates.map((row) => row.source_work_id)).size,
  counts_by_ontology_class: Object.fromEntries(Object.entries(Object.groupBy(structuredProtocolCandidates, (row) =>
    row.candidate.ontology_class)).map(([className, rows]) => [className, rows.length])),
  candidates: structuredProtocolCandidates,
}, null, 2)}\n`);
const blockingSettings = mergedAssertions.filter((setting) =>
  setting.method_applicability_status !== "not_applicable"
  && setting.method_implementation_status !== "native"
  && setting.method_implementation_status !== "external_executor");
const implementationSettings = blockingSettings.filter((setting) =>
  applicableDisclosures.has(setting.method_disclosure_status)
  && setting.method_execution_route !== "receipt_conformance");
const evidenceSettings = blockingSettings.filter((setting) =>
  !applicableDisclosures.has(setting.method_disclosure_status)
  || setting.method_execution_route === "receipt_conformance");
const evidenceProofSettings = mergedAssertions.filter((setting) =>
  setting.method_applicability_status !== "not_applicable"
  && setting.method_execution_route === "receipt_conformance");
const semanticAdjudicationSettings = blockingSettings.filter((setting) =>
  setting.method_execution_blocker_code === "source_execution_semantics_unadjudicated");
const scientificOracleSettings = blockingSettings.filter((setting) =>
  setting.method_execution_blocker_code === "scientific_oracle_comparison_receipt_required");
const indispensableSourceGapSettings = blockingSettings.filter((setting) =>
  setting.method_execution_blocker_code === "indispensable_source_evidence_unavailable");
const implementationSettingIds = new Set(implementationSettings.map((setting) => setting.method_setting_id));
const evidenceSettingIds = new Set(evidenceSettings.map((setting) => setting.method_setting_id));
const evidenceProofSettingIds = new Set(evidenceProofSettings.map((setting) => setting.method_setting_id));
if ([...safeEvidenceReceiptIds].some((id) => implementationSettingIds.has(id))
  || safeScientificOracleRows.some((setting) => !evidenceSettingIds.has(setting.method_setting_id))
  || safeDocumentarySchemaRows.some((setting) => evidenceSettingIds.has(setting.method_setting_id))
  || [...safeEvidenceReceiptIds].some((id) => !evidenceProofSettingIds.has(id))) {
  throw new Error("safe evidence rows were not cleanly separated from implementation work and retained in evidence/proof status");
}
const gapGroups = Map.groupBy(implementationSettings, (setting) => [
  setting.source_component_id,
  setting.method_setting_role,
  setting.method_target_layer,
  setting.method_parameter_key,
  setting.method_implementation_status,
].join("\u001f"));
const gaps = [...gapGroups.entries()].map(([key, settings]) => ({
  source_component_id: settings[0].source_component_id,
  method_role: settings[0].method_setting_role,
  target_layer: settings[0].method_target_layer,
  canonical_parameter_key: settings[0].method_parameter_key,
  implementation_status: settings[0].method_implementation_status,
  resolution_route: resolutionRoute(settings[0]),
  setting_count: settings.length,
  source_work_count: new Set(settings.map((setting) => setting.source_work_id)).size,
  source_work_ids: [...new Set(settings.map((setting) => setting.source_work_id))].sort(),
  method_setting_ids: settings.map((setting) => setting.method_setting_id).sort(),
  mapped_ontology_terms: [...new Set(settings.flatMap((setting) => setting.mapped_ontology_term ?? []))].sort(),
  sample_values: [...new Set(settings.map((setting) => setting.method_value_json).filter(Boolean))].slice(0, 3),
  grouping_key: key,
})).sort((left, right) =>
  right.source_work_count - left.source_work_count || right.setting_count - left.setting_count || left.grouping_key.localeCompare(right.grouping_key))
  .map((gap, index) => ({ gap_id: `method-gap-${String(index + 1).padStart(4, "0")}`, ...gap }));
write(resolve(run, "implementation-gap-backlog.json"), `${JSON.stringify({
  schema_version: "chronicle-method-implementation-gap-backlog-v1",
  generated_from: "adjudicated-method-setting-assertions.jsonl",
  implementation_blocking_settings: implementationSettings.length,
  source_evidence_blocking_settings: evidenceSettings.length,
  evidence_proof_settings: evidenceProofSettings.length,
  semantic_adjudication_pending_settings: semanticAdjudicationSettings.length,
  scientific_oracle_blocking_settings: scientificOracleSettings.length,
  indispensable_source_gap_settings: indispensableSourceGapSettings.length,
  safe_evidence_reclassified_settings: safeEvidenceReceiptRows.length,
  safe_evidence_ready_documentary_schema_settings: safeDocumentarySchemaRows.length,
  safe_evidence_blocked_scientific_oracle_settings: safeScientificOracleRows.length,
  source_evidence_blockers_by_disclosure: Object.fromEntries(
    Object.entries(Object.groupBy(evidenceSettings, (setting) => setting.method_disclosure_status))
      .map(([status, rows]) => [status, rows.length]),
  ),
  gaps,
}, null, 2)}\n`);
const statusCounts = Object.fromEntries(
  Object.entries(Object.groupBy(mergedAssertions, (row) => row.method_implementation_status))
    .map(([status, rows]) => [status, rows.length]),
);
const executionRouteCounts = Object.fromEntries(
  Object.entries(Object.groupBy(mergedAssertions.filter((row) => row.method_execution_route), (row) => row.method_execution_route))
    .map(([route, rows]) => [route, rows.length]),
);
const typedProtocolSlots = [
  "acquisition_protocols", "session_construction_policies", "notification_attribution_policies",
  "duration_policies", "timestamp_policies", "parameter_provenance_assertions", "release_profiles",
];
const validation = {
  reviewed_source_assertions: assertions.length,
  source_assertions: assertions.filter((row) => retainedWorkIds.has(row.source_work_id)).length,
  applicable_assertions: assertions.filter((row) => retainedWorkIds.has(row.source_work_id)
    && applicableDisclosures.has(row.method_disclosure_status)).length,
  corpus_adjudication_rows: corpusDecisions.length,
  retained_adjudication_rows: decisions.filter((row) => retainedWorkIds.has(row.source_work_id)).length,
  ignored_nonretained_adjudication_rows: corpusDecisions.length
    - decisions.filter((row) => retainedWorkIds.has(row.source_work_id)).length,
  reviewed_profiles: reviewedWorkIds.size,
  excluded_profiles: [...reviewedWorkIds].filter((id) => reviewQueueById.get(id)?.decision === "EXCLUDE").length,
  acquisition_pending_profiles: [...reviewedWorkIds].filter((id) => reviewQueueById.get(id)?.decision === "ACQUISITION_PENDING").length,
  output_assertions: mergedAssertions.length,
  output_profiles: mergedProfiles.length,
  source_work_coverage: new Set(mergedProfiles.map((profile) => profile.source_work_id)).size,
  retained_source_completeness_projection_coverage: projectedRetainedWorkIds.size,
  unique_source_variant_pairs: new Set(mergedProfiles.map((profile) => `${profile.source_work_id}\u001f${profile.source_method_variant_id}`)).size === mergedProfiles.length,
  whole_source_placeholder_profiles: mergedProfiles.filter((profile) => profile.source_method_variant_id === "whole_source").length,
  source_configuration_spaces: sourceConfigurationSpaces.length,
  source_configuration_space_complete: mergedProfiles.every((profile) => profile.source_method_variant_id !== "whole_source"),
  variant_group_partition_complete: true,
  selectable_configuration_space_profiles: sourceConfigurationSpaces.filter((space) => space.space_facets.has_selectable_axis_or_campaign).length,
  evidence_blocked_configuration_spaces: sourceConfigurationSpaces.filter((space) => space.space_kind === "evidence_blocked").length,
  exact_execution_variant_selection_complete: false,
  variant_partition_complete: false,
  ...replayedAtomicValidation,
  status_counts: statusCounts,
  execution_route_counts: executionRouteCounts,
  execution_routed_settings: Object.values(executionRouteCounts).reduce((sum, count) => sum + count, 0),
  native_route_audit: nativeRouteAuditSummary,
  corrected_new_operator_partition: correctedNewOperatorPartitionSummary,
  native_conformance: nativeConformanceSummary,
  strict_gap_extension: strictGapExtensionSummary,
  strict_screen_gate_extension: strictScreenGateExtensionSummary,
  direct_unlock_extension: directUnlockExtensionSummary,
  source_order_extension: sourceOrderExtensionSummary,
  screen_policy_extension: screenPolicyExtensionSummary,
  behapp_interval_extension: behappIntervalExtensionSummary,
  top_app_selection_extension: topAppSelectionExtensionSummary,
  screen_duration_participant_exclusion: screenDurationParticipantExclusionSummary,
  app_opening_iteration_extension: appOpeningIterationExtensionSummary,
  application_label_extension: applicationLabelExtensionSummary,
  bsn_profile_repair: bsnRepair.summary,
  hammer_source_completeness_repair: hammerSourceCompletenessRepair.summary,
  hush_source_completeness_repair: hushSourceCompletenessRepair.summary,
  projectable_source_completeness_repair: projectableSourceCompletenessRepair.summary,
  five_second_source_semantic_repair: fiveSecondSemanticRepair.summary,
  external_execution_receipts: externalExecutionReceipts.summary,
  source_artifact_provenance_registry: sourceArtifactRepair.summary,
  profile_protocol_documentary_registry: profileProtocolRepair.summary,
  safe_evidence_receipt_correction: safeEvidenceReceiptCorrection.summary,
  existing_aggregate_conformance: existingAggregateConformance.summary,
  published_session_output_conformance: publishedSessionOutputConformance.summary,
  packet09_canonical_integration: packet09Integration.summary,
  source_evidence_repair: sourceEvidenceRepairSummary,
  missing_input_adapter_audit: missingInputAuditSummary,
  input_adapter_implementation: {
    ...inputAdapterImplementationSummary,
    late_promoted_settings: lateSourceCompletenessInputAdapters.promoted,
    late_source_value_drift_count: lateSourceCompletenessInputAdapters.sourceValueDriftSettings.length,
    late_source_value_drift_settings: lateSourceCompletenessInputAdapters.sourceValueDriftSettings,
  },
  post_audit_input_component_promotion: postAuditInputAdapters.summary,
  external_executor_audit: externalExecutorAuditSummary,
  conformance_pending_native_bindings: mergedAssertions.filter((setting) =>
    setting.method_execution_blocker_code === "native_binding_conformance_pending").length,
  typed_protocol_objects: mergedProfiles.reduce((count, profile) =>
    count + typedProtocolSlots.reduce((slotCount, slot) => slotCount + (profile[slot]?.length ?? 0), 0), 0),
  protocol_materialization_blockers: mergedProfiles.reduce((count, profile) =>
    count + profile.protocol_materialization_blockers.length, 0),
  source_configuration_levels: mergedProfiles.reduce((count, profile) => count
    + profile.method_configuration_space.method_configuration_groups.reduce((groupCount, group) =>
      groupCount + group.method_configuration_levels.length, 0), 0),
  runnable_profiles: mergedProfiles.filter((profile) => profile.profile_implementation_status === "executable").length,
  blocking_settings: blockingSettings.length,
  implementation_blocking_settings: implementationSettings.length,
  source_evidence_blocking_settings: evidenceSettings.length,
  evidence_proof_settings: evidenceProofSettings.length,
  semantic_adjudication_pending_settings: semanticAdjudicationSettings.length,
  scientific_oracle_blocking_settings: scientificOracleSettings.length,
  indispensable_source_gap_settings: indispensableSourceGapSettings.length,
  safe_evidence_reclassified_settings: safeEvidenceReceiptRows.length,
  safe_evidence_ready_documentary_schema_settings: safeDocumentarySchemaRows.length,
  safe_evidence_blocked_scientific_oracle_settings: safeScientificOracleRows.length,
  implementation_gap_groups: gaps.length,
  method_configuration_groups: configurationGroups.length,
  variant_partition_required_groups: configurationGroups.filter((group) => group.partition_required).length,
  structured_protocol_candidates: structuredProtocolCandidates.length,
  linkml_shape_conformant: true,
  every_source_assertion_preserved: assertions.filter((source) => retainedWorkIds.has(source.source_work_id)).every((source) =>
    mergedAssertions.some((output) => output.source_extraction_id === source.source_extraction_id)
      || methodSettingTombstones.some((output) => output.source_extraction_id === source.source_extraction_id)),
  every_applicable_assertion_adjudicated_once: decisions.length === indexedCount(decisions),
};
if (!validation.every_source_assertion_preserved || !validation.every_applicable_assertion_adjudicated_once || !validation.unique_source_variant_pairs) {
  throw new Error(`adjudication merge failed: ${JSON.stringify(validation)}`);
}
write(resolve(run, "adjudicated-validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
write(resolve(run, "canonical-merge-last.json"), `${JSON.stringify(validation, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
}

function indexedCount(rows) {
  return new Set(rows.map((row) => row.method_setting_id)).size;
}
