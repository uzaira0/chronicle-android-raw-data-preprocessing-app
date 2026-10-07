#!/usr/bin/env node
// @ts-nocheck -- executable Node generator; its self-test and lossless row-count gate are authoritative.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const input = resolve(repo, ".tmp-literature-review-private/normalized/study-method-extractions-combined.jsonl");
const profileInput = resolve(repo, ".tmp-literature-review-private/normalized/study-method-profiles-combined.jsonl");
const retainedInput = resolve(repo, ".tmp-literature-review-private/corrective-final-reconciliation-20260831/retained-profile-crosswalk.jsonl");
const sourceRechecksInput = resolve(repo, ".tmp-literature-review-private/corrective-final-reconciliation-20260831/source-recheck-adjudications.jsonl");
const crosswalkInput = resolve(repo, "docs/paper/component-crosswalk.yaml");
const output = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");

const disclosure = {
  DECLARED: "declared",
  DECLARED_PARTIAL: "declared_partial",
  DELEGATED: "delegated",
  ABSENT: "absent",
  "N/A": "not_applicable",
  NOT_APPLICABLE: "not_applicable",
  UNDET: "undetermined",
};

const componentSemantics = {
  C01: ["event_schema", "raw_record"],
  C02: ["reconstruction", "app_episode"],
  C03: ["reconstruction", "app_episode"],
  C04: ["reconstruction", "app_episode"],
  C05: ["reconstruction", "app_episode"],
  C06: ["reconstruction", "app_episode"],
  C07: ["quality_control", "raw_record"],
  C08: ["reconstruction", "app_episode"],
  C09: ["reconstruction", "app_episode"],
  C10: ["reconstruction", "app_episode"],
  C11: ["reconstruction", "screen_bout"],
  C12: ["reconstruction", "device_session"],
  C13: ["quality_control", "study_window"],
  C14: ["quality_control", "participant_day"],
  C15: ["quality_control", "app_episode"],
  C16: ["quality_control", "app_episode"],
  C17: ["reconstruction", "app_session"],
  C18: ["quality_control", "raw_record"],
  C19: ["reconstruction", "app_episode"],
  C20: ["quality_control", "participant_day"],
  C21: ["provenance", null],
};

const rolePatterns = [
  ["diary_schema", /(^|_)(diary|esm|ema|prompt|self_report|daily_recall|app_question|emotion_prompt|time_prompt)(_|$)/],
  ["acquisition", /(^|_)(acquisition|collector|sampling|sensor|platform|permission|upload|storage|event_api|event_source|deployment)(_|$)/],
  ["event_schema", /(^|_)(schema|event_fields|event_stream|ontology|taxonomy|categorization|classification)(_|$)/],
  ["reconstruction", /(^|_)(reconstruction|session|screen_session|foreground|app_switch|notification_attribution|sequence)(_|$)/],
  ["quality_control", /(^|_)(missing|missingness|exclusion|eligibility|filter|outlier|quality|accuracy|deduplication|equal_timestamp|threshold)(_|$)/],
  ["aggregation", /(^|_)(aggregation|temporal_aggregation|usage_aggregation|time_bins|window)(_|$)/],
  ["feature_engineering", /(^|_)(feature|features|fusion|normalization|derived_metric|temporal_features|statistics_vector)(_|$)/],
  ["validation", /(^|_)(validation|evaluation|reliability|robustness|ablation|error_metric|ground_truth)(_|$)/],
  ["analysis", /(^|_)(analysis|model|prediction|multiverse|multiple_testing|synthesis|network|clustering)(_|$)/],
  ["provenance", /(^|_)(provenance|artifact|linked_materials|audit|privacy|source_family|candidate_source|review)(_|$)/],
];

function parseJsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${error.message}`);
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

function auxiliaryName(componentId) {
  return componentId.replace(/^(aux|auxiliary):/, "").toLowerCase();
}

function classifyAuxiliary(componentId) {
  const name = auxiliaryName(componentId);
  const role = rolePatterns.find(([, pattern]) => pattern.test(name))?.[0] ?? "provenance";
  const target = role === "acquisition" ? "collector"
    : role === "event_schema" ? "raw_record"
      : role === "diary_schema" ? "diary_response"
        : role === "reconstruction" ? "derived_feature"
          : role === "quality_control" ? "study_window"
            : role === "aggregation" ? "participant_day"
              : role === "feature_engineering" ? "derived_feature"
                : role === "analysis" || role === "validation" ? "model"
                  : "released_artifact";
  return [role, target];
}

function ontologyClasses(componentId, role) {
  const classes = ["StudyMethodProfile", "MethodSettingAssertion"];
  const name = auxiliaryName(componentId);
  if (role === "acquisition") classes.push("AcquisitionProtocol");
  if (role === "diary_schema") classes.push("DiaryProtocol");
  if (role === "provenance") classes.push("ParameterProvenanceAssertion");
  if (/release|artifact|granularity|aggregation/.test(name)) classes.push("MeasurementReleaseProfile");
  if (/timestamp|tie|order|dedup/.test(name)) classes.push("TimestampPolicy");
  if (/duration|threshold|cap/.test(name)) classes.push("DurationPolicy");
  if (/notification.*attribution/.test(name)) classes.push("NotificationAttributionPolicy");
  if (/session|screen_session/.test(name)) classes.push("SessionConstructionPolicy");
  return [...new Set(classes)];
}

function declaredPair(text) {
  const match = /^([a-z][a-z0-9_]{1,79}):\s*(.+)$/i.exec(text.trim());
  return match ? [match[1], match[2]] : [null, text];
}

function assertion(row, crosswalk) {
  const componentMatch = /^component:(C\d{2})$/.exec(row.component_id);
  const [role, target] = componentMatch
    ? componentSemantics[componentMatch[1]]
    : classifyAuxiliary(row.component_id);
  const mapping = componentMatch ? crosswalk.get(row.component_id) : null;
  const normalizedDisclosure = disclosure[row.coverage_status];
  if (!normalizedDisclosure) throw new Error(`Unknown coverage status: ${row.coverage_status}`);
  const [parameterKey, value] = declaredPair(String(row.observed_setting ?? ""));
  const mappedTerms = [
    ...ontologyClasses(row.component_id, role),
    ...(mapping?.ontology_terms ?? []),
  ];
  return compact({
    method_setting_id: row.extraction_id,
    source_extraction_id: row.extraction_id,
    source_work_id: row.work_id,
    rubric_component_id: componentMatch ? row.component_id : null,
    source_component_id: row.component_id,
    method_setting_role: role,
    method_target_layer: target,
    method_parameter_key: parameterKey,
    method_value_kind: value ? "string" : "unspecified",
    method_value_json: value ? JSON.stringify(value) : null,
    method_applicability_status: normalizedDisclosure === "not_applicable" ? "not_applicable"
      : ["absent", "undetermined"].includes(normalizedDisclosure) ? "undetermined"
        : "applicable",
    method_disclosure_status: normalizedDisclosure,
    mapped_ontology_term: [...new Set(mappedTerms)],
    mapped_contract_slot: mapping?.contract_slots ?? [],
    method_implementation_status: ["absent", "not_applicable", "undetermined"].includes(normalizedDisclosure)
      ? "specification_only"
      : "unresolved",
    source_locators: row.source_locator ? [row.source_locator] : [],
    evidence_layer: row.evidence_layer ?? null,
    ontology_mapping_note: row.ontology_mapping ?? null,
    gap_assessment: row.gap_assessment ?? null,
    integration_source: row.integration_source ?? null,
  });
}

function build(rows, profiles, crosswalk) {
  const assertions = rows.map((row) => assertion(row, crosswalk));
  const byWork = Map.groupBy(assertions, (row) => row.source_work_id);
  const sourceProfiles = new Map(profiles.map((profile) => [profile.work_id, profile]));
  const methodProfiles = [...sourceProfiles.keys()].sort().map((workId) => {
    const settings = byWork.get(workId) ?? [];
    return {
      method_profile_id: `method-profile:${workId}`,
      source_work_id: workId,
      source_method_variant_id: "whole_source",
      source_method_variant_label: "Whole source pending atomic variant partition",
      method_configuration_structure: "fixed",
      method_profile_version: "literature-sublation-v1",
      method_setting_ids: settings.map((setting) => setting.method_setting_id),
      method_setting_count: settings.length,
      profile_implementation_status: "blocked",
      source_locators: sourceProfiles.get(workId)?.source_locators ?? [],
    };
  });
  return { assertions, methodProfiles };
}

function sourceRechecksExcludeRetained(sourceRechecks, retainedWorkIds) {
  const latest = new Map(sourceRechecks.map((row) => [row.canonical_work_id, row]));
  return [...latest.values()].some((row) => row.decision.startsWith("EXCLUDE")
    && retainedWorkIds.has(row.canonical_work_id));
}

function selfTest() {
  const crosswalk = new Map([["component:C17", { ontology_terms: ["UsageSessionAssertion"], contract_slots: ["session_grouping_policy"] }]]);
  const rows = [
    { extraction_id: "a", work_id: "w", component_id: "component:C17", coverage_status: "DECLARED", observed_setting: "gap_seconds: 60", source_locator: "x" },
    { extraction_id: "b", work_id: "w", component_id: "auxiliary:daily_recall", coverage_status: "DECLARED", observed_setting: "bedtime prompt", source_locator: "y" },
  ];
  const result = build(rows, [{ work_id: "w" }], crosswalk);
  if (result.assertions.length !== 2 || result.methodProfiles[0].method_setting_count !== 2) throw new Error("row preservation failed");
  if (result.assertions[0].method_parameter_key !== "gap_seconds") throw new Error("declared pair parsing failed");
  if (result.assertions[1].method_setting_role !== "diary_schema") throw new Error("diary classification failed");
  if (!result.assertions[0].mapped_contract_slot.includes("session_grouping_policy")) throw new Error("crosswalk reuse failed");
  const history = [
    { canonical_work_id: "w", decision: "EXCLUDE_AGGREGATES_ONLY" },
    { canonical_work_id: "w", decision: "RETAIN" },
  ];
  if (sourceRechecksExcludeRetained(history, new Set(["w"]))) throw new Error("historical exclusion overrode retention reversal");
  if (!sourceRechecksExcludeRetained([...history].reverse(), new Set(["w"]))) throw new Error("latest exclusion did not reject retained work");
  if (sourceRechecksExcludeRetained(history, new Set())) throw new Error("unretained history changed retained coverage");
}

selfTest();
if (process.argv.includes("--self-test")) {
  console.log("build_literature_method_profiles self-test OK");
  process.exit(0);
}

const crosswalkDocument = parseYaml(readFileSync(crosswalkInput, "utf8"));
const crosswalk = new Map(crosswalkDocument.components.map((row) => [row.id, row]));
const retained = parseJsonl(retainedInput);
const retainedWorkIds = new Set(retained.map((row) => row.canonical_work_id));
const sourceRechecks = parseJsonl(sourceRechecksInput);
const reviewedWorkIds = new Set([...retainedWorkIds, ...sourceRechecks.map((row) => row.canonical_work_id)]);
const corpusRows = parseJsonl(input);
const corpusProfiles = parseJsonl(profileInput);
const rows = corpusRows.filter((row) => reviewedWorkIds.has(row.work_id));
const profiles = corpusProfiles.filter((profile) => reviewedWorkIds.has(profile.work_id));
if (retainedWorkIds.size !== retained.length
  || reviewedWorkIds.size !== profiles.length
  || sourceRechecksExcludeRetained(sourceRechecks, retainedWorkIds)) {
  throw new Error("reviewed work identities are duplicated or missing from the normalized profile corpus");
}
const { assertions, methodProfiles } = build(rows, profiles, crosswalk);
mkdirSync(output, { recursive: true, mode: 0o700 });
chmodSync(output, 0o700);
writeJsonl(resolve(output, "method-setting-assertions.jsonl"), assertions);
writeJsonl(resolve(output, "study-method-profiles.jsonl"), methodProfiles);
const assertionsByWork = Map.groupBy(assertions, (row) => row.source_work_id);
write(resolve(output, "method-profile-library.json"), `${JSON.stringify({
  schema_version: "chronicle-method-profile-library-v1",
  profiles: methodProfiles.map((profile) => ({
    ...profile,
    method_settings: assertionsByWork.get(profile.source_work_id) ?? [],
  })),
}, null, 2)}\n`);

const ids = new Set(assertions.map((row) => row.method_setting_id));
const profileIds = new Set(methodProfiles.flatMap((profile) => profile.method_setting_ids));
const validation = {
  reviewed_corpus_profiles: corpusProfiles.length,
  reviewed_corpus_extraction_rows: corpusRows.length,
  retained_work_ids: retainedWorkIds.size,
  reviewed_work_ids: reviewedWorkIds.size,
  reviewed_source_extraction_rows: rows.length,
  output_assertion_rows: assertions.length,
  reviewed_source_profiles: profiles.length,
  output_profiles: methodProfiles.length,
  source_work_coverage: new Set(methodProfiles.map((profile) => profile.source_work_id)).size,
  unique_source_variant_pairs: new Set(methodProfiles.map((profile) => `${profile.source_work_id}\u001f${profile.source_method_variant_id}`)).size === methodProfiles.length,
  whole_source_placeholder_profiles: methodProfiles.filter((profile) => profile.source_method_variant_id === "whole_source").length,
  variant_partition_complete: methodProfiles.every((profile) => profile.source_method_variant_id !== "whole_source"),
  unique_assertion_ids: ids.size === assertions.length,
  every_source_row_preserved_once: rows.length === assertions.length && ids.size === rows.length,
  every_assertion_referenced_by_profile: assertions.every((row) => profileIds.has(row.method_setting_id)),
  unresolved_applicable_settings: assertions.filter((row) => row.method_implementation_status === "unresolved").length,
};
if (!validation.unique_assertion_ids || !validation.every_source_row_preserved_once || !validation.every_assertion_referenced_by_profile) {
  throw new Error(`Sublation validation failed: ${JSON.stringify(validation)}`);
}
write(resolve(output, "validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify(validation, null, 2));
