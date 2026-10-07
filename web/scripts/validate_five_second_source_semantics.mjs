#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const run = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
const assertions = readFileSync(resolve(run, "adjudicated-method-setting-assertions.jsonl"), "utf8")
  .trim().split("\n").map(JSON.parse);
const library = JSON.parse(readFileSync(resolve(run, "adjudicated-method-profile-library.json"), "utf8"));
const schoedelAudit = JSON.parse(readFileSync(resolve(
  run,
  "source-completeness-audits/doi-10.1016-j.chb.2023.107977.json",
), "utf8"));

const expected = new Map([
  ["method-setting-da6110b25e2070673c995c2a", ["quality_control", "acquired_snapshot", "chronicle.sensor-inactivity-change-run-filter/v1", "source_semantic_underdetermination:change_predicate_and_five_second_boundary_missing"]],
  ["method-setting-d3c518f907692060b4c30b51", ["acquisition", "collector", "chronicle.regret-screenshot-acquisition/v1", "source_acquisition_unimplemented:screenshot_timer_after_intention_response"]],
  ["method-setting-5b16e47b354adfd836637c21", ["quality_control", "app_episode", "chronicle.foreground-prompt-eligibility/v1", "source_semantic_underdetermination:foreground_stream_and_prompt_clock_missing"]],
  ["method-setting-86b76f51a297902b7617d54f", ["acquisition", "acquired_snapshot", "chronicle.ktl-phone-sensor-acquisition/v1", "source_acquisition_unimplemented:ktl_sensor_collector"]],
  ["method-setting-8610324205e459c643456da5", ["acquisition", "acquired_snapshot", "chronicle.ktl-screenshot-acquisition/v1", "source_acquisition_unimplemented:ktl_screen_on_screenshot_collector"]],
  ["method-setting-fcb375381848232e388775c7", ["acquisition", "collector", "chronicle.screenlife-screenshot-acquisition/v1", "source_acquisition_unimplemented:screenlife_collector_lifecycle"]],
  ["method-setting-e9aed8ee932679e0ca4c8b53", ["acquisition", "acquired_snapshot", "chronicle.estar-network-counter-acquisition/v1", "source_conflict:screen_off_network_cadence_5s_vs_1s"]],
  ["method-setting-8ac8b46e1a34b8e12bfce8d5", ["reconstruction", "derived_feature", "chronicle.estar-network-call-reconstruction-compatibility/v1", "source_semantic_mismatch:already_windowed_input_and_rng_substitution"]],
]);

const byId = new Map(assertions.map((row) => [row.method_setting_id, row]));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const reviewQueue = readFileSync(resolve(repo,
  ".tmp-literature-review-private/corrective-final-reconciliation-20260831/corrected-queue-state.jsonl"), "utf8")
  .trim().split("\n").map(JSON.parse);
check(reviewQueue.some((row) => row.canonical_work_id === "doi:10.2196/55999"
  && row.decision === "RETAIN" && row.decision_evidence
  && row.decision_history.some((prior) => prior.normalized_decision === "EXCLUDE" && prior.evidence)),
"ScreenLife sampled-screen retention reversal lost its current or historical source evidence");

function blockedSettingFailures(id, row, [role, target, destination, blocker]) {
  if (!row) return [`${id}: missing canonical assertion`];
  const checks = [
    [row.method_setting_role === role, "role"],
    [row.method_target_layer === target, "target"],
    [row.method_implementation_status === "specification_only", "executable status"],
    [row.method_execution_destination_id === destination, "destination"],
    [row.method_execution_blocker_code === blocker, "blocker"],
    [(row.mapped_contract_slot ?? []).length === 0, "mapped contract slot"],
    [(row.contract_bindings ?? []).length === 0, "contract binding"],
    [!row.executor_id, "executor"],
    [!row.conformance_fixture_id, "conformance fixture"],
    [!row.conformance_result_digest, "conformance digest"],
  ];
  return checks.filter(([passed]) => !passed).map(([, field]) => `${id}: invalid ${field}`);
}

if (process.argv.includes("--self-test")) {
  const id = "method-setting-fcb375381848232e388775c7";
  const tuple = expected.get(id);
  const good = { method_setting_role: tuple[0], method_target_layer: tuple[1],
    method_execution_destination_id: tuple[2], method_execution_blocker_code: tuple[3],
    method_implementation_status: "specification_only" };
  if (blockedSettingFailures(id, good, tuple).length) throw new Error("blocked cadence rejected");
  const forgeries = [
    { method_implementation_status: "native" }, { method_target_layer: "app_session" },
    { mapped_contract_slot: ["minimum_usage_duration"] }, { contract_bindings: [{}] },
    { executor_id: "forged" }, { conformance_fixture_id: "forged" },
    { conformance_result_digest: `sha256:${"0".repeat(64)}` },
  ];
  for (const forged of forgeries) {
    if (!blockedSettingFailures(id, { ...good, ...forged }, tuple).length) throw new Error("forged cadence accepted");
  }
  console.log("five-second source semantic self-test OK (blocked acquisition plus seven forgeries; no writes)");
  process.exit(0);
}

for (const [id, tuple] of expected) {
  failures.push(...blockedSettingFailures(id, byId.get(id), tuple));
}

const schoedelAtom = schoedelAudit.disclosed_atoms.find((atom) => atom.key === "profile.join_threshold");
check(schoedelAtom?.implementation_disposition === "specification_only", "Schoedel source audit still claims retain_current_exact/native");
check(schoedelAtom?.source_implementation_status === "specification_only", "Schoedel source audit still records native implementation");
check(schoedelAtom?.canonical_target === "screen_bout", "Schoedel five-second merge must target labeled screen-usage bouts");
const schoedelCode = byId.get("method-setting-21088bd2743bd3054e5fbb5b");
check(schoedelCode?.method_setting_role === "reconstruction"
  && schoedelCode?.method_target_layer === "raw_record"
  && schoedelCode?.method_implementation_status === "native"
  && schoedelCode?.method_execution_route === "protocol_input"
  && schoedelCode?.method_execution_destination_id === "chronicle.schoedel-screen-preprocessing/v1"
  && schoedelCode?.conformance_fixture_id === "literature-input.schoedel-screen-strict-less-than-five-relabel.v1",
"Schoedel released-R row relabeling lost its source-exact component binding");
const schoedelProse = byId.get("method-setting-fb6f6a598d30f304909ffb88");
check(schoedelProse?.method_implementation_status === "native"
  && schoedelProse?.method_execution_route === "receipt_conformance"
  && schoedelProse?.method_execution_destination_id === "chronicle.profile-protocol-documentary-registry"
  && (schoedelProse?.contract_bindings ?? []).length === 0,
"Schoedel supplement prose is not preserved as separate execution-ineligible evidence");

const ktlSensor = byId.get("method-setting-86b76f51a297902b7617d54f");
const ktlScreenshot = byId.get("method-setting-8610324205e459c643456da5");
check(ktlSensor?.method_execution_destination_id !== ktlScreenshot?.method_execution_destination_id, "KTL sensor and screenshot cadences remain collapsed");
check(ktlScreenshot?.required_inputs?.includes("screen_state_event_stream"), "KTL screenshot cadence lost its screen-on gate input");
check(!ktlSensor?.required_inputs?.includes("screen_state_event_stream"), "KTL sensor cadence incorrectly inherited screenshot screen gate");

for (const oldId of ["method-setting-80cfd9952a2b67749b7e8605", "method-setting-201a4b453a73b9045748a9b2"]) {
  check(!byId.has(oldId), `${oldId}: superseded eStar branch still appears as canonical source-exact assertion`);
}
const eStarConflict = byId.get("method-setting-e8ad69124f728712b1d1138d");
check(eStarConflict?.method_implementation_status === "specification_only"
  && eStarConflict?.method_execution_route === "receipt_conformance"
  && eStarConflict?.method_execution_blocker_code === "source_execution_semantics_unadjudicated",
"eStar printed 5-second/1-second contradiction no longer fails closed");

const profileMembership = (workId, slot) => {
  const profile = library.profiles.find((row) => row.source_work_id === workId);
  return (profile?.[slot] ?? []).flatMap((object) =>
    (object.method_settings ?? []).map((setting) => setting.method_setting_id));
};
const forbiddenMemberships = [
  ["doi:10.2196/55999", "release_profiles", "method-setting-fcb375381848232e388775c7"],
  ["doi:10.1109/jiot.2020.2975779", "release_profiles", "method-setting-da6110b25e2070673c995c2a"],
  ["doi:10.1145/3706598.3713724", "release_profiles", "method-setting-d3c518f907692060b4c30b51"],
  ["doi:10.1145/3706598.3713724", "session_construction_policies", "method-setting-5b16e47b354adfd836637c21"],
  ["doi:10.1145/3706598.3713724", "duration_policies", "method-setting-5b16e47b354adfd836637c21"],
  ["doi:10.1145/2745844.2745875", "session_construction_policies", "method-setting-8ac8b46e1a34b8e12bfce8d5"],
  ["doi:10.1016/j.chb.2023.107977", "duration_policies", "method-setting-21088bd2743bd3054e5fbb5b"],
];
for (const [workId, slot, id] of forbiddenMemberships) {
  check(!profileMembership(workId, slot).includes(id), `${id}: remains in stale ${slot}`);
}

const result = {
  schema_version: "chronicle-five-second-source-semantic-validation/v1",
  passed: failures.length === 0,
  corrected_setting_count: expected.size,
  source_profiles_checked: new Set([...expected].map(([id]) => byId.get(id)?.source_work_id)).size,
  superseded_estar_exact_claims_absent: !byId.has("method-setting-80cfd9952a2b67749b7e8605")
    && !byId.has("method-setting-201a4b453a73b9045748a9b2"),
  unresolved_estar_cadence_conflict_retained: eStarConflict?.method_implementation_status === "specification_only",
  forbidden_typed_protocol_memberships_checked: forbiddenMemberships.length,
  failures,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exit(1);
