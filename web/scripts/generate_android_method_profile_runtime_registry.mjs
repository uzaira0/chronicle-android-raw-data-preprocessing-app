// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { projectRegisteredComponents } from "./android_method_profile_component_projection.mjs";

const repo = resolve(import.meta.dirname, "../..");
const source = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json");
const executionSpec = resolve(repo, ".tmp-literature-review-private/profile-runs/android-profile-execution-spec.json");
const executionValidator = resolve(repo, "scripts/validate-android-profile-execution-spec.py");
const inputAdapterContract = resolve(repo, "web/schema/literature-input-adapter-contract.json");
const nativeConformanceFixture = resolve(repo, "rust/chronicle_preprocessing_runtime_wasm/tests/fixtures/literature_native_conformance.json");
const output = resolve(repo, "web/src/generated/android-method-profile-runtime-registry.json");
const rustRegistry = resolve(repo, "rust/chronicle_preprocessing_runtime_wasm/src/android_method_profile_registry.rs");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jcs = (value) => Array.isArray(value)
  ? `[${value.map(jcs).join(",")}]`
  : value !== null && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const unique = (values, label) => {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
};
const typedSectionNames = [
  "method_operations", "acquisition_protocols", "session_construction_policies",
  "notification_attribution_policies", "duration_policies", "timestamp_policies",
  "parameter_provenance_assertions", "protocol_materialization_blockers", "diary_protocols", "release_profiles",
];
const typedSectionProjection = (profile, section) => {
  const value = profile[section];
  if ((!Array.isArray(value) || value.length === 0)
    && (value === null || typeof value !== "object" || Object.keys(value).length === 0)) return null;
  const canonicalSettings = new Map(profile.method_settings.map((setting) => [setting.method_setting_id, setting]));
  const project = (candidate) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const projected = { ...candidate };
    if (Array.isArray(projected.source_locators)) {
      projected.source_locators = projected.source_locators.map(publicSourceLocator);
    }
    if (projected.method_settings !== undefined) {
      if (!Array.isArray(projected.method_settings) || projected.method_settings.some((setting) =>
        typeof setting?.method_setting_id !== "string"
        || jcs(setting) !== jcs(canonicalSettings.get(setting.method_setting_id)))) {
        throw new Error(`${profile.source_work_id}: ${section} contains a stale or foreign nested method setting`);
      }
      projected.method_settings = projected.method_settings.map((setting) => setting.method_setting_id);
    }
    return projected;
  };
  // ponytail: exact strings keep synchronous compilation dependency-free; use a vetted sync digest only if registry size is measured as a problem.
  return jcs(Array.isArray(value) ? value.map(project) : project(value));
};
const publicSourceLocator = (locator) => {
  if (typeof locator !== "string" || locator.length === 0) throw new Error("invalid source locator");
  const repoPrefix = `${repo}/`;
  const normalized = locator.replaceAll(repoPrefix, "");
  if ((locator.startsWith("/") && normalized === locator) || normalized.includes("/Users/")) {
    throw new Error(`source locator is outside the repository: ${locator}`);
  }
  return normalized;
};
const protocolDocumentaryBinding = (profile, setting) => {
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
    source_locators: (setting.source_locators ?? []).map(publicSourceLocator),
    source_clause_ids: setting.source_clause_ids ?? [],
  };
  const fixtureId = `profile-protocol-documentary.${setting.method_setting_id}.v1`;
  const registryInputSha256 = `sha256:${sha256(jcs(registryInput))}`;
  const result = {
    schema_version: "chronicle-profile-protocol-documentary-result/v1",
    accepted: true,
    fixture_id: fixtureId,
    registry_input_sha256: registryInputSha256,
    execution_eligible: false,
  };
  return {
    setting_id: setting.method_setting_id,
    registry_input: registryInput,
    registry_input_sha256: registryInputSha256,
    conformance_fixture_id: fixtureId,
    conformance_result_digest: `sha256:${sha256(jcs(result))}`,
    execution_eligible: false,
  };
};
const outputBinding = (setting) => {
  const fields = [
    setting.chronicle_output_kind,
    setting.chronicle_output_column,
    setting.source_output_position,
  ];
  if (fields.every((value) => value === undefined)) return null;
  if (fields.some((value) => value === undefined)) {
    throw new Error(`${setting.method_setting_id}: partial output binding`);
  }
  let sourceField;
  try {
    sourceField = JSON.parse(setting.method_value_json);
  } catch (error) {
    throw new Error(`${setting.method_setting_id}: output source field is invalid JSON`, { cause: error });
  }
  if ((setting.chronicle_output_kind !== "app-csv" && setting.chronicle_output_kind !== "screen-csv")
    || typeof setting.chronicle_output_column !== "string" || !setting.chronicle_output_column
    || !Number.isSafeInteger(setting.source_output_position) || setting.source_output_position < 0
    || typeof sourceField !== "string" || !sourceField
    || setting.method_implementation_status !== "native"
    || setting.method_execution_route !== "native_option_binding"
    || typeof setting.conformance_fixture_id !== "string" || !setting.conformance_fixture_id
    || typeof setting.conformance_result_digest !== "string"
    || !/^sha256:[0-9a-f]{64}$/.test(setting.conformance_result_digest)) {
    throw new Error(`${setting.method_setting_id}: invalid executable output binding`);
  }
  return {
    setting_id: setting.method_setting_id,
    output_kind: setting.chronicle_output_kind,
    source_field: sourceField,
    source_position: setting.source_output_position,
    canonical_field: setting.chronicle_output_column,
    conformance_fixture_id: setting.conformance_fixture_id,
    conformance_result_digest: setting.conformance_result_digest,
  };
};

const sourceBytes = readFileSync(source);
const executionSpecBytes = readFileSync(executionSpec);
const inputAdapterContractDocument = JSON.parse(readFileSync(inputAdapterContract));
const executionSpecDocument = JSON.parse(executionSpecBytes);
const executionValidation = JSON.parse(execFileSync("python3", [executionValidator, "--manifest", executionSpec], {
  cwd: repo,
  encoding: "utf8",
}));
const library = JSON.parse(sourceBytes);
if (library.schema_version !== "chronicle-method-profile-library-v2" || !library.profiles.length) {
  throw new Error("canonical Android method-profile library identity changed");
}
const nonretainedSourceWorkIds = new Set(readFileSync(resolve(repo,
  ".tmp-literature-review-private/corrective-final-reconciliation-20260831/corrected-queue-state.jsonl"), "utf8")
  .split("\n").filter(Boolean).map(JSON.parse)
  .filter((row) => ["EXCLUDE", "ACQUISITION_PENDING"].includes(row.decision))
  .map((row) => row.canonical_work_id));
const registeredComponentsByProfile = projectRegisteredComponents(
  library.profiles,
  inputAdapterContractDocument,
  nonretainedSourceWorkIds,
);
if (executionValidation.assertionsPassed !== true
  || executionValidation.profiles !== library.profiles.length
  || executionValidation.configurations < 1
  || executionValidation.completedConfigurations + executionValidation.blocked !== executionValidation.configurations
  || !Array.isArray(executionValidation.profileCompletions)
  || executionValidation.profileCompletions.length !== library.profiles.length) {
  throw new Error("validated Android execution-spec summary changed");
}
unique(executionValidation.profileCompletions.map((profile) => profile.methodProfileId), "execution-spec profile ID");
const completionByProfile = new Map(executionValidation.profileCompletions.map((profile) => [profile.methodProfileId, profile]));
const executionEntryByProfile = new Map(executionSpecDocument.profiles.map((profile) => [profile.methodProfileId, profile]));

const profiles = library.profiles.map((profile) => {
  const completion = completionByProfile.get(profile.method_profile_id);
  const executionEntry = executionEntryByProfile.get(profile.method_profile_id);
  if (!completion
    || !executionEntry
    || completion.configurationCount < 0
    || completion.completedConfigurationCount + completion.blockedConfigurationCount !== completion.configurationCount
    || completion.status !== (completion.configurationCount > 0
      && completion.completedConfigurationCount === completion.configurationCount ? "executable" : "blocked")) {
    throw new Error(`${profile.source_work_id}: invalid validated execution completion`);
  }
  const space = profile.method_configuration_space;
  if (profile.source_method_variant_id !== space.method_configuration_space_id) {
    throw new Error(`${profile.source_work_id}: outer source-method identity drift`);
  }
  const settingIds = profile.method_settings.map((setting) => setting.method_setting_id);
  const settingSet = new Set(settingIds);
  const outputBindings = profile.method_settings.map(outputBinding).filter((binding) => binding !== null);
  const typedSections = Object.fromEntries(typedSectionNames
    .map((section) => [section, typedSectionProjection(profile, section)])
    .filter(([, projection]) => projection !== null));
  unique(settingIds, `${profile.source_work_id} setting ID`);
  unique(outputBindings.map((binding) => `${binding.output_kind}\0${binding.source_position}`), `${profile.source_work_id} output position`);
  const assertSettings = (ids, label) => {
    if (!Array.isArray(ids) || ids.some((id) => !settingSet.has(id))) {
      throw new Error(`${profile.source_work_id}: ${label} references a foreign setting`);
    }
  };
  const groups = space.method_configuration_groups.map((group) => ({
    group_id: group.method_configuration_group_id,
    axis_isolated: ["source_levels_selectable_without_cross_group_expansion", "independently_selectable"]
      .includes(group.method_selection_semantics)
      && group.method_cross_product_policy === "not_enumerated_no_cartesian_product",
    documentary_setting_ids: group.documentary_method_setting_ids ?? [],
    unresolved_setting_ids: group.unresolved_method_setting_ids ?? [],
    levels: group.method_configuration_levels.map((level) => ({
      level_id: level.method_configuration_level_id,
      included_setting_ids: level.included_method_setting_ids ?? [],
      excluded_setting_ids: level.excluded_method_setting_ids ?? [],
      documentary_setting_ids: level.documentary_method_setting_ids ?? [],
      unresolved_setting_ids: level.unresolved_method_setting_ids ?? [],
    })),
  }));
  const combinations = (space.allowed_method_combinations ?? []).map((combination) => ({
    combination_id: combination.method_configuration_combination_id,
    selected_level_ids: combination.selected_method_configuration_level_ids ?? [],
    included_setting_ids: combination.included_method_setting_ids ?? [],
  }));
  const completedConfigurations = [
    ...executionEntry.runs.map((run) => ({ ...run, execution_eligible: true })),
  ].map((run) => {
    const selectedLevelIds = groups.flatMap((group) => {
      const selected = run.selection[group.group_id];
      return selected === undefined ? [] : [selected];
    });
    if (selectedLevelIds.length !== Object.keys(run.selection).length) {
      throw new Error(`${profile.source_work_id}: completed configuration names an unknown group`);
    }
    const selectedSet = new Set(selectedLevelIds);
    const selectedCombination = combinations.find((combination) =>
      combination.selected_level_ids.length === selectedSet.size
      && combination.selected_level_ids.every((levelId) => selectedSet.has(levelId)));
    return {
      selected_level_ids: selectedLevelIds,
      ...(selectedCombination ? { selected_combination_id: selectedCombination.combination_id } : {}),
      execution_eligible: run.execution_eligible,
    };
  });
  unique(completedConfigurations.map((configuration) => JSON.stringify([
    [...configuration.selected_level_ids].sort(),
    configuration.selected_combination_id ?? null,
  ])), `${profile.source_work_id} completed configuration`);
  if (completedConfigurations.length !== completion.completedConfigurationCount) {
    throw new Error(`${profile.source_work_id}: completed configuration inventory disagrees with validation`);
  }
  for (const [label, ids] of [
    ["invariant settings", space.invariant_method_setting_ids ?? []],
    ["documentary settings", space.documentary_method_setting_ids ?? []],
    ["not-applicable settings", space.not_applicable_method_setting_ids ?? []],
    ["unresolved settings", space.unresolved_method_setting_ids ?? []],
  ]) assertSettings(ids, label);
  for (const group of groups) {
    assertSettings(group.documentary_setting_ids, `${group.group_id} documentary settings`);
    assertSettings(group.unresolved_setting_ids, `${group.group_id} unresolved settings`);
    for (const level of group.levels) {
      for (const [label, ids] of Object.entries(level).filter(([key]) => key.endsWith("setting_ids"))) {
        assertSettings(ids, `${level.level_id} ${label}`);
      }
    }
  }
  return {
    method_profile_id: profile.method_profile_id,
    source_work_id: profile.source_work_id,
    source_method_variant_id: profile.source_method_variant_id,
    method_profile_version: profile.method_profile_version,
    profile_implementation_status: completion.status,
    configuration_count: completion.configurationCount,
    completed_configuration_count: completion.completedConfigurationCount,
    blocked_configuration_count: completion.blockedConfigurationCount,
    full_profile_blocked_reason: completion.configurationCount === 0
      ? "No complete source-declared configuration can be selected; profile remains blocked"
      : completion.configurationCount === 1
      && executionEntry.blocked.length === 1
      && Object.keys(executionEntry.blocked[0].selection).length === 0
      ? executionEntry.blocked[0].detail : null,
    completed_configurations: completedConfigurations,
    applicable_setting_ids: profile.method_settings
      .filter((setting) => setting.method_applicability_status !== "not_applicable")
      .map((setting) => setting.method_setting_id),
    runtime_setting_ids: profile.method_settings
      .filter((setting) => (setting.method_implementation_status === "native"
        && ["native_option_binding", "protocol_input", "native_operator_parameter", "receipt_conformance"].includes(setting.method_execution_route))
        || (setting.method_implementation_status === "external_executor"
          && setting.method_execution_route === "external_named_executor"))
      .map((setting) => setting.method_setting_id),
    registered_components: registeredComponentsByProfile.get(profile.method_profile_id),
    protocol_documentary_bindings: profile.method_settings
      .filter((setting) => setting.method_implementation_status === "native"
        && setting.method_execution_route === "receipt_conformance"
      && setting.method_execution_destination_id === "chronicle.profile-protocol-documentary-registry")
      .map((setting) => protocolDocumentaryBinding(profile, setting)),
    typed_sections: typedSections,
    output_bindings: outputBindings,
    not_applicable_setting_ids: profile.method_settings
      .filter((setting) => setting.method_applicability_status === "not_applicable")
      .map((setting) => setting.method_setting_id),
    invariant_setting_ids: space.invariant_method_setting_ids ?? [],
    documentary_setting_ids: space.documentary_method_setting_ids ?? [],
    unresolved_setting_ids: space.unresolved_method_setting_ids ?? [],
    groups,
    combinations,
  };
});

unique(profiles.map((profile) => profile.method_profile_id), "profile ID");
unique(profiles.map((profile) => profile.source_work_id), "source work ID");
const groups = profiles.flatMap((profile) => profile.groups);
const levels = groups.flatMap((group) => group.levels);
unique(groups.map((group) => group.group_id), "configuration group ID");
unique(levels.map((level) => level.level_id), "configuration level ID");
const explicitVariants = levels.filter((level) => level.level_id.startsWith("source-method-variant-"));
const summary = {
  profile_count: profiles.length,
  configuration_count: profiles.reduce((count, profile) => count + profile.configuration_count, 0),
  completed_configuration_count: profiles.reduce((count, profile) => count + profile.completed_configuration_count, 0),
  blocked_configuration_count: profiles.reduce((count, profile) => count + profile.blocked_configuration_count, 0),
  setting_count: library.profiles.reduce((count, profile) => count + profile.method_settings.length, 0),
  applicable_setting_count: profiles.reduce((count, profile) => count + profile.applicable_setting_ids.length, 0),
  group_count: groups.length,
  level_count: levels.length,
  explicit_source_variant_count: explicitVariants.length,
  executable_profile_count: profiles.filter((profile) => profile.profile_implementation_status === "executable").length,
  protocol_documentary_binding_count: profiles.reduce((count, profile) => count + profile.protocol_documentary_bindings.length, 0),
  typed_section_count: profiles.reduce((count, profile) => count + Object.keys(profile.typed_sections).length, 0),
  output_binding_count: profiles.reduce((count, profile) => count + profile.output_bindings.length, 0),
  registered_component_count: profiles.reduce((count, profile) => count + profile.registered_components.length, 0),
  profiles_with_registered_components_count: profiles.filter((profile) => profile.registered_components.length > 0).length,
};
if (summary.profile_count !== library.profiles.length
  || summary.configuration_count !== executionValidation.configurations
  || summary.completed_configuration_count + summary.blocked_configuration_count !== summary.configuration_count
  || summary.completed_configuration_count !== executionValidation.completedConfigurations
  || summary.blocked_configuration_count !== executionValidation.blocked
  || summary.executable_profile_count !== executionValidation.executableProfiles
  || summary.setting_count !== profiles.reduce((count, profile) => count + profile.applicable_setting_ids.length
    + profile.not_applicable_setting_ids.length, 0)
  || summary.applicable_setting_count > summary.setting_count
  || summary.group_count !== groups.length
  || summary.level_count !== levels.length) throw new Error("canonical Android runtime-registry counts are inconsistent");

const sourceLibrarySha256 = sha256(sourceBytes);
const sourceExecutionSpecSha256 = sha256(executionSpecBytes);
const payload = {
  schema_version: "chronicle-android-method-profile-runtime-registry/v1",
  source_library_sha256: sourceLibrarySha256,
  source_execution_spec_sha256: sourceExecutionSpecSha256,
  summary,
  profiles,
};
const contentDigest = `sha256:${sha256(jcs(payload))}`;
const generated = `${JSON.stringify({ ...payload, content_digest: contentDigest }, null, 2)}\n`;
if (generated.includes(`${repo}/`) || generated.includes("/Users/")) {
  const marker = generated.includes(`${repo}/`) ? `${repo}/` : "/Users/";
  const index = generated.indexOf(marker);
  throw new Error(`Android runtime registry contains a private absolute path near ${generated.slice(Math.max(0, index - 120), index + 240)}`);
}
const replaceRustPin = (contents, name, value) => {
  const pattern = new RegExp(`(const ${name}: &str\\s*=\\s*)"[^"]+";`, "g");
  if ((contents.match(pattern) ?? []).length !== 1) throw new Error(`Rust registry must contain exactly one ${name}`);
  return contents.replace(pattern, `$1"${value}";`);
};
const rustCurrent = readFileSync(rustRegistry, "utf8");
const rustGenerated = [
  ["SOURCE_LIBRARY_SHA256", sourceLibrarySha256],
  ["SOURCE_EXECUTION_SPEC_SHA256", sourceExecutionSpecSha256],
  ["REGISTRY_CONTENT_DIGEST", contentDigest],
  ["CONFORMANCE_SHA256", sha256(readFileSync(nativeConformanceFixture))],
].reduce((contents, [name, value]) => replaceRustPin(contents, name, value), rustCurrent);
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== generated) throw new Error("Android method-profile runtime registry is stale");
  if (rustCurrent !== rustGenerated) throw new Error("Android method-profile Rust registry digests are stale");
  console.log("Android method-profile runtime registry is current");
} else {
  writeFileSync(output, generated);
  writeFileSync(rustRegistry, rustGenerated);
  console.log(`Android method-profile runtime registry: ${summary.profile_count} profiles, ${summary.level_count} exact levels, ${summary.executable_profile_count} executable`);
}
