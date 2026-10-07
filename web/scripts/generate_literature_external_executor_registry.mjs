// @ts-nocheck -- generated registry gate reads private JSON authorities.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLiteratureExternalExecutionReceipts } from "./literature_external_execution_receipts.mjs";

const repo = resolve(import.meta.dirname, "../..");
const libraryPath = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json");
const outputPath = resolve(repo, "web/src/generated/literature-external-executor-registry.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jcs = (value) => Array.isArray(value)
  ? `[${value.map(jcs).join(",")}]`
  : value !== null && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`
    : JSON.stringify(value);

const libraryBytes = readFileSync(libraryPath);
const library = JSON.parse(libraryBytes);
const receipts = loadLiteratureExternalExecutionReceipts(repo);
const configurationUnitKinds = new Set([
  "user_selectable_alternative",
  "fixed_pipeline_stage_component",
  "campaign_internal_job_model_cell",
  "output_result_oracle_row",
  "evidence_only_unavailable",
]);
const selectableConfigurationKind = "user_selectable_alternative";
const executors = receipts.map(({ receipt, audit, digest }) => {
  const profile = library.profiles.find((candidate) => candidate.source_work_id === receipt.source_work_id);
  if (!profile || !profile.method_profile_version.endsWith("+external-execution-v1")) {
    throw new Error(`${receipt.source_work_id}: external executor profile identity drift`);
  }
  const groups = profile.method_configuration_space.method_configuration_groups;
  const levels = groups.flatMap((group) => group.method_configuration_levels
    .map((level) => ({ group, level })));
  const levelByLabel = new Map(levels.map((entry) => [entry.level.method_configuration_level_label, entry]));
  const settingById = new Map(profile.method_settings.map((setting) => [setting.method_setting_id, setting]));
  const settingByKey = new Map(profile.method_settings.map((setting) => [setting.method_parameter_key, setting]));
  const verdictById = new Map(audit.configuration_verdicts
    .map((verdict) => [verdict.configuration_id, verdict]));
  const configurations = receipt.configuration_bindings.map((binding) => {
    const verdict = verdictById.get(binding.configuration_id);
    if (!verdict) throw new Error(`${receipt.source_work_id}: missing audited external execution unit ${binding.configuration_id}`);
    if (!configurationUnitKinds.has(verdict.configuration_unit_kind)) {
      throw new Error(`${receipt.source_work_id}: unknown external execution unit kind ${binding.configuration_id}`);
    }
    const selectable = verdict.configuration_unit_kind === selectableConfigurationKind;
    const selectableEntry = selectable ? levelByLabel.get(binding.configuration_id) : undefined;
    if (selectable && !selectableEntry) {
      throw new Error(`${receipt.source_work_id}: missing selectable external execution level ${binding.configuration_id}`);
    }
    const atomKeys = binding.binding_kind === "campaign" ? binding.executed_atom_keys : verdict.atom_keys;
    if (!Array.isArray(atomKeys) || !atomKeys.length) {
      throw new Error(`${receipt.source_work_id}: external execution unit has no audited atom inventory ${binding.configuration_id}`);
    }
    const settings = atomKeys.map((key) => settingByKey.get(key));
    if (settings.some((setting) => !setting || !["native", "external_executor"].includes(setting.method_implementation_status))) {
      throw new Error(`${receipt.source_work_id}: unresolved external execution setting ${binding.configuration_id}`);
    }
    const externalSettingIds = settings.filter((setting) => setting.method_implementation_status === "external_executor")
      .map((setting) => setting.method_setting_id).sort();
    if (!externalSettingIds.length || externalSettingIds.some((id) => {
      const setting = settingById.get(id);
      return setting.method_execution_route !== "external_named_executor"
        || setting.method_execution_destination_id !== receipt.executor_id
        || setting.executor_id !== receipt.executor_id
        || setting.conformance_fixture_id !== receipt.fixture_id
        || setting.conformance_result_digest !== receipt.semantic_digest_sha256;
    })) throw new Error(`${receipt.source_work_id}: invalid external setting registration ${binding.configuration_id}`);
    return {
      source_configuration_id: binding.configuration_id,
      configuration_unit_kind: verdict.configuration_unit_kind,
      binding_kind: binding.binding_kind ?? "model",
      ...(selectable ? {
        selection: {
          [selectableEntry.group.method_configuration_group_id]: selectableEntry.level.method_configuration_level_id,
        },
        selected_level_ids: [selectableEntry.level.method_configuration_level_id],
      } : {}),
      external_setting_ids: externalSettingIds,
      executable_setting_ids: settings.map((setting) => setting.method_setting_id).sort(),
      receipt_id: binding.receipt_id,
      ...((binding.binding_kind ?? "model") === "campaign" ? {
        aggregate_evidence: binding.aggregate_evidence,
        executed_method_parameter_keys: binding.executed_atom_keys,
      } : {
        model_name: binding.model_name,
        formula: binding.formula,
        observations: binding.observations,
      }),
      conformance_fixture_id: receipt.fixture_id,
      conformance_result_digest: receipt.semantic_digest_sha256,
      execution_receipt_sha256: digest,
    };
  });
  return {
    executor_id: receipt.executor_id,
    executor_version: receipt.executor_version,
    runtime: receipt.runtime,
    container_image_digest: receipt.container_image_digest,
    method_profile_id: profile.method_profile_id,
    source_work_id: receipt.source_work_id,
    source_method_variant_id: profile.source_method_variant_id,
    method_profile_version: profile.method_profile_version,
    semantic_digest: receipt.semantic_digest_sha256,
    configurations,
  };
});
const receiptIndex = receipts.map(({ receipt, digest }) => ({ source_work_id: receipt.source_work_id, digest }));
const payload = {
  schema_version: "chronicle-literature-external-executor-registry/v1",
  source_library_sha256: `sha256:${sha256(libraryBytes)}`,
  execution_receipt_sha256: `sha256:${sha256(jcs(receiptIndex))}`,
  executors,
};
const generated = `${JSON.stringify({ ...payload, content_digest: `sha256:${sha256(jcs(payload))}` }, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== generated) throw new Error("literature external executor registry is stale");
  console.log("Literature external executor registry is current");
} else {
  writeFileSync(outputPath, generated);
  console.log(`Literature external executor registry: ${executors.length} executors, ${executors.reduce((total, executor) => total + executor.configurations.length, 0)} configurations`);
}
