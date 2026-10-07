// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.
const documentaryRoles = new Set([
  "availability boundary",
  "evidence_artifact",
  "execution_environment",
  "release_provenance",
  "released_artifact",
  "measurement_limitation",
]);
const scientificOracleRoles = new Set([
  "app-level result oracle",
  "feasibility and observation-volume outcomes",
  "participant/day visualization",
  "reported_result",
  "three-level category result oracle",
]);
const runtimeOperationTargets = new Map([
  ["acquisition", new Set(["participant_measure", "participant_record"])],
  ["aggregation", new Set(["derived_feature", "participant_day", "participant_hour"])],
  ["analysis", new Set(["model"])],
  ["intervention", new Set(["model", "notification_delivery", "intervention_content_state", "device_setting_actuation", "call_handling"])],
  ["feature_engineering", new Set(["derived_feature", "diary_response", "model", "raw_record"])],
  ["quality_control", new Set(["acquired_snapshot", "app_episode", "collector", "derived_feature", "participant_day", "participant_hour", "participant_record", "raw_record"])],
  ["reconstruction", new Set(["acquired_snapshot", "app_episode", "app_session", "device_session", "pickup_activation", "raw_record", "screen_bout"])],
]);

export function sourceCompletenessExecutionClass(atom) {
  const role = String(atom.role ?? "").trim().toLowerCase();
  const explicitOverride = overrideByIdentity.get(`${atom.source_work_id ?? ""}\0${atom.key ?? ""}`);
  if (explicitOverride) return explicitOverride;
  const canonicalRole = String(atom.canonical_role ?? "").trim().toLowerCase();
  const canonicalTarget = String(atom.canonical_target ?? "").trim().toLowerCase();
  if (["evidence_gap", "evidence_conflict"].includes(role)) return "source_gap_or_conflict";
  if (scientificOracleRoles.has(role)) return "scientific_oracle";
  if (canonicalRole === "provenance" && documentaryRoles.has(role)) return "documentary_fact";
  if (["event_schema", "diary_schema"].includes(canonicalRole) && role === canonicalRole) return "runtime_input";
  if (canonicalRole === "participant_schema" && role === "input_schema") return "runtime_input";
  if (runtimeOperationTargets.get(canonicalRole)?.has(canonicalTarget) && role === canonicalRole) {
    return "runtime_operation";
  }
  if (canonicalRole === "validation" && role === "validation"
    && ["derived_feature", "model"].includes(canonicalTarget)) {
    return "runtime_operation";
  }
  return "unadjudicated_execution_semantics";
}
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const overrideRows = JSON.parse(readFileSync(new URL("./source_completeness_execution_overrides.json", import.meta.url), "utf8"));
const allowedExecutionClasses = new Set([
  "documentary_fact", "runtime_input", "runtime_operation", "scientific_oracle",
  "source_gap_or_conflict", "unadjudicated_execution_semantics",
]);
if (Object.keys(overrideRows).some((classification) => !allowedExecutionClasses.has(classification))) {
  throw new Error("unknown source-completeness execution override class");
}
const overrideByIdentity = new Map(Object.entries(overrideRows).flatMap(([classification, identities]) =>
  identities.map(([sourceWorkId, key]) => [`${sourceWorkId}\0${key}`, classification])));
if (overrideByIdentity.size !== Object.values(overrideRows).reduce((count, identities) => count + identities.length, 0)) {
  throw new Error("duplicate source-completeness execution override identity");
}
