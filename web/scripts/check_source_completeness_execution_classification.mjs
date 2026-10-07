// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sourceCompletenessExecutionClass } from "./source_completeness_execution_classification.mjs";
import { loadPostFreezeAdmissions } from "./literature_post_freeze_admissions.mjs";

test("keeps evidence semantics separate from runtime ownership", () => {
  assert.equal(sourceCompletenessExecutionClass({ role: "reported_result", canonical_role: "reporting", canonical_target: "outcome", key: "result.table" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ role: "evidence_gap", canonical_role: "provenance", canonical_target: "released_artifact", key: "validation.procedure_gap" }), "source_gap_or_conflict");
  assert.equal(sourceCompletenessExecutionClass({ role: "validation", canonical_role: "validation", canonical_target: "outcome", key: "gpa.performance_oracle" }), "unadjudicated_execution_semantics");
  assert.equal(sourceCompletenessExecutionClass({ role: "reporting", canonical_role: "reporting", canonical_target: "outcome", key: "result.table" }), "unadjudicated_execution_semantics");
  assert.equal(sourceCompletenessExecutionClass({ role: "provenance", canonical_role: "provenance", canonical_target: "released_artifact", key: "software.version" }), "unadjudicated_execution_semantics");
  assert.equal(sourceCompletenessExecutionClass({ role: "released_artifact", canonical_role: "provenance", canonical_target: "released_artifact", key: "software.release" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ role: "event_schema", canonical_role: "event_schema", canonical_target: "raw_record", key: "input.fields" }), "runtime_input");
  assert.equal(sourceCompletenessExecutionClass({ role: "input_schema", canonical_role: "participant_schema", canonical_target: "participant_record", key: "input.demographics" }), "runtime_input");
  assert.equal(sourceCompletenessExecutionClass({ role: "evidence_gap", canonical_role: "provenance", canonical_target: "raw_record", key: "android.raw_event_disclosure" }), "source_gap_or_conflict");
  assert.equal(sourceCompletenessExecutionClass({ role: "analysis", canonical_role: "analysis", canonical_target: "model", key: "model.formula" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ role: "intervention", canonical_role: "intervention", canonical_target: "notification_delivery", key: "notification.trigger" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ role: "intervention", canonical_role: "intervention", canonical_target: "device_setting_actuation", key: "intervention.shake_threshold_and_mute" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ role: "intervention", canonical_role: "intervention", canonical_target: "call_handling", key: "field.postpone_timer" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.procs.2019.08.027", role: "analysis", canonical_role: "analysis", canonical_target: "model", key: "unavailable.model_optimizer" }), "source_gap_or_conflict");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1037/emo0001485", role: "validation", canonical_role: "validation", canonical_target: "model", key: "provenance.rendered_analysis_oracle" }), "scientific_oracle");
  // Released caller invokes both sensitivity thresholds; they are operations,
  // not a reported robustness result or permission to relabel all validation.
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1037/emo0001485", role: "validation", canonical_role: "validation", canonical_target: "participant_day", key: "quality.whole_day_gap_sensitivity_12_24h" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:unreviewed", role: "validation", canonical_role: "validation", canonical_target: "participant_day", key: "quality.whole_day_gap_sensitivity_12_24h" }), "unadjudicated_execution_semantics");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2023.107977", role: "acquisition", canonical_role: "acquisition", canonical_target: "collector", key: "profile.collector" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2024.108281", role: "quality_control", canonical_role: "quality_control", canonical_target: "raw_occurrence", key: "quality.missing_gap_le_60_equal_bounds" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2024.108281", role: "acquisition", canonical_role: "acquisition", canonical_target: "collector", key: "acquisition.screen_sampling_interval" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2024.108281", role: "acquisition", canonical_role: "acquisition", canonical_target: "collector", key: "acquisition.screen_status_states" }), "runtime_input");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2024.108281", role: "reporting", canonical_role: "reporting", canonical_target: "outcome", key: "reporting.threshold_sample_sizes_40" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2024.108281", role: "quality_control", canonical_role: "quality_control", canonical_target: "study_window", key: "quality.within_person_minimum_days" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2024.108281", key: "quality.five_day_benchmark_considered" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2024.108281", key: "reporting.five_day_complete_n" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1007/978-3-642-38541-4_4", key: "logcat.filter" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1007/978-3-642-38541-4_4", key: "logcat.reported_taxonomy" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2465529.2466586", key: "whatif.flow_start" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2465529.2466586", key: "whatif.result.wifi" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2465529.2466586", key: "whatif.result.3g" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2465529.2466586", role: "reporting", canonical_role: "reporting", canonical_target: "outcome", key: "wifi.table3" }), "unadjudicated_execution_semantics");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2465529.2466586", role: "reporting", canonical_role: "reporting", canonical_target: "outcome", key: "validation.table5" }), "unadjudicated_execution_semantics");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1109/percomw.2015.7134065", key: "selection.minimum_duration" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1109/percomw.2015.7134065", key: "feedback.proposed_cycle" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.psychres.2023.115298", key: "recruitment.window" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.psychres.2023.115298", key: "cohort.preprocessing_excluded" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2647868.2654933", key: "collector.bluetooth_scan_cadence" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2647868.2654933", key: "result.selected_feature.personality_conscientiousness" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2647868.2654933", key: "result.subset.personality_only" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2647868.2654933", role: "analysis", canonical_role: "analysis", canonical_target: "model", key: "analysis.subset.personality_only" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1007/978-3-319-51394-2_2", key: "quality.target_daily_sensing_hours" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1007/978-3-319-51394-2_2", key: "activity.reported_accuracy_percent" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1007/978-3-319-51394-2_2", key: "collector.inferred_streams" }), "unadjudicated_execution_semantics");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/3131901", key: "notification_seen.unlock_proxy" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/3131901", key: "oracle.location_type.app_usage.context_effect" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/3131901", role: "evidence_conflict", canonical_role: "provenance", canonical_target: "outcome", key: "source.location_type_app_usage_factor_label_conflict" }), "source_gap_or_conflict");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1080/15213269.2020.1768122", key: "reactibility.original.definition" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1080/15213269.2020.1768122", key: "reactibility.final.definition" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2023.107977", role: "acquisition", canonical_role: "acquisition", canonical_target: "collector", key: "profile.collector_platform" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2023.107977", role: "reconstruction", canonical_role: "reconstruction", canonical_target: "screen_bout", key: "profile.join_threshold_declared_prose" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1016/j.chb.2023.107977", role: "reconstruction", canonical_role: "reconstruction", canonical_target: "app_episode", key: "profile.reconstruction_input_dependency" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1002/per.2309", role: "reporting", canonical_role: "reporting", canonical_target: "study_window", key: "cohort.final_participants" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2745844.2745875", role: "evidence_conflict", canonical_role: "provenance", canonical_target: "released_artifact", key: "source.screen_off_cadence_conflict" }), "source_gap_or_conflict");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2745844.2745875", role: "reported_result", canonical_role: "reporting", canonical_target: "outcome", key: "result.component_s4_similarity" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2745844.2745875", role: "release_provenance", canonical_role: "provenance", canonical_target: "released_artifact", key: "provenance.component_validation_figure_coverage" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1109/bsn.2012.3", role: "reporting", canonical_role: "reporting", canonical_target: "released_artifact", key: "result.tensity.accuracy" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1002/per.2309", role: "reporting", canonical_role: "reporting", canonical_target: "outcome", key: "report.stability_frequency" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1007/978-3-642-37210-0_6", key: "result.neuroticism_figure_prose_conflict" }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2968219.2968302", key: "procedure.final_feedback" }), "runtime_input");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2968219.2968302", key: "procedure.final_export" }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.1145/2968219.2968302", key: "hrv.quality" }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ role: "release_provenance", canonical_role: "provenance", canonical_target: "released_artifact", key: "collector.framework_fallback_schedule" }), "documentary_fact");
});

test("keeps PREPP observations separate from intervention settings and scopes the six-user cost", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1145-2493432.2493490.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.equal(atoms.get("input.app_sequence").canonical_target, "derived_feature");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("android.raw_event_schema_unreported"),
    source_work_id: audit.source_work_id }), "source_gap_or_conflict");
  assert.match(atoms.get("model.appm.order_weights").value, /top-2 case is an example/);
  assert.deepEqual(atoms.get("controlled.intervention").value.cost_C,
    { n6_stratum: 2, n16_stratum: "not stated" });
  assert.equal(atoms.get("controlled.cohort").value.stratum_1.minimum_total_days, 14);
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("android.foreground_duration"),
    source_work_id: audit.source_work_id }), "runtime_operation");
  for (const key of ["result.android_foreground_duration", "result.appkicker_analysis_clicks",
    "benchmark.data_overhead", "appkicker.deployment"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key),
      source_work_id: audit.source_work_id }), "scientific_oracle");
  }
  assert.match(atoms.get("livelab.prefetch_metric").value, /NOOP comparator instead estimates/);
  assert.ok(audit.configuration_verdicts.some((row) =>
    row.configuration_id === "shin2013:android-controlled:n16-3plus4day:active-cost-unreported-prefetch"));
  assert.ok(!audit.configuration_verdicts.some((row) =>
    row.configuration_id === "shin2013:android-controlled:n16-3plus4day:active-C2-prefetch"));
});

test("classifies the audited source-atom corpus", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits");
  const excluded = new Set([
    "doi:10.1145/2634317.2634325",
    "doi:10.1145/2789168.2790107",
    "doi:10.23728/b2share.cgf63-kme28", // linked release, not a paper-method projection
  ]);
  const allAudits = readdirSync(directory).filter((name) => name.endsWith(".json")).sort()
    .map((name) => JSON.parse(readFileSync(resolve(directory, name), "utf8")));
  const audits = allAudits.filter((audit) => !excluded.has(audit.source_work_id)
      && audit.disclosed_atoms?.every((atom) => atom.canonical_role && atom.canonical_target
        && Array.isArray(atom.supersedes_method_setting_ids) && atom.implementation_disposition)
      && audit.configuration_verdicts?.length > 0
      && audit.configuration_verdicts.every((verdict) => (verdict.locator ?? verdict.source_locator)
        && verdict.atom_keys?.length > 0));
  const atoms = audits.flatMap((audit) => audit.disclosed_atoms
    .map((atom) => ({ ...atom, source_work_id: audit.source_work_id })));
  const admittedAudits = loadPostFreezeAdmissions(repo, new Set(allAudits.map((audit) => audit.source_work_id)))
    .map((entry) => JSON.parse(readFileSync(resolve(repo, entry.audit_path), "utf8")));
  const atomByIdentity = new Map([...allAudits, ...admittedAudits].flatMap((audit) => audit.disclosed_atoms
    .map((atom) => [`${audit.source_work_id}\0${atom.key}`, { ...atom, source_work_id: audit.source_work_id }])));
  const overrides = JSON.parse(readFileSync(resolve(repo, "web/scripts/source_completeness_execution_overrides.json"), "utf8"));
  const metadataAtoms = atoms.filter((atom) => atom.projection_disposition === "configuration_metadata");
  const counts = Object.fromEntries([...atoms.reduce((result, atom) => {
    const classification = sourceCompletenessExecutionClass(atom);
    result.set(classification, (result.get(classification) ?? 0) + 1);
    return result;
  }, new Map())].sort());
  assert.equal(audits.length, 91);
  // Digital Nightlife adds two missingness rules and a category designation;
  // classroom Kim adds course-information input and an unanalyzed diary battery.
  // Corona Health adds an optional submission-location acquisition definition
  // and its released GPS input schema, not a new corpus member or collector.
  assert.equal(atoms.length, 9_816);
  assert.deepEqual(Object.fromEntries(Object.entries(overrides).map(([classification, identities]) =>
    [classification, identities.length])), {
    documentary_fact: 674,
    runtime_input: 366,
    runtime_operation: 916,
    scientific_oracle: 1_348,
    source_gap_or_conflict: 381,
    unadjudicated_execution_semantics: 9,
  });
  for (const [classification, identities] of Object.entries(overrides)) {
    for (const [sourceWorkId, key] of identities) {
      const atom = atomByIdentity.get(`${sourceWorkId}\0${key}`);
      assert.ok(atom, `missing explicit override atom ${sourceWorkId} :: ${key}`);
      assert.equal(sourceCompletenessExecutionClass(atom), classification);
    }
  }
  assert.equal(metadataAtoms.length, 16);
  assert.deepEqual(metadataAtoms.map((atom) => `${atom.source_work_id}\0${atom.key}`).sort(), [
    "doi:10.1016/j.compedu.2019.103611\0rq5.block_dependency",
    "doi:10.1177/00936502241276793\0feature.app_scope_interaction_designation",
    "doi:10.1007/s41347-024-00443-5\0configuration.joint_four_category_two_feature_campaign",
    "doi:10.1145/2465529.2466586\0whatif.delay_levels",
    "doi:10.1145/2465529.2466586\0whatif.rtt",
    "doi:10.1145/2465529.2466586\0whatif.thresholds",
    "doi:10.1016/j.pmcj.2017.01.007\0benchmark.no_cartesian",
    "doi:10.1109/tifs.2015.2506542\0authentication.verifiers",
    "doi:10.2196/13209\0temporal.full_grid_topology",
    "doi:10.2196/13209\0analysis.resolution_branches",
    "doi:10.3389/fpsyg.2016.01252\0matrix.schema.unit",
    "doi:10.3758/s13428-024-02474-5\0example.missingness",
    "doi:10.3758/s13428-024-02474-5\0example.missingness.sensitivity_absence_hours_12",
    "doi:10.3758/s13428-024-02474-5\0example.missingness.sensitivity_absence_hours_24",
    "doi:10.3758/s13428-024-02474-5\0example.robustness_topology",
    "source-ref:e2014b2268ac2833bb8e\0studentlife.release.deidentified_passive_outputs",
  ].sort());
  assert.deepEqual(counts, {
    documentary_fact: 746,
    runtime_input: 1_266,
    runtime_operation: 4_205,
    scientific_oracle: 1_572,
    source_gap_or_conflict: 459,
    unadjudicated_execution_semantics: 1_568,
  });
  for (const [key, role, target] of [
    ["schema.course_information", "event_schema", "raw_record"],
    ["diary.unanalyzed_psychological_battery", "diary_schema", "diary_item"],
  ]) {
    const atom = atomByIdentity.get(`doi:10.1016/j.compedu.2019.103611\0${key}`);
    assert.ok(atom, `missing classroom input ${key}`);
    assert.equal(atom.role, role);
    assert.equal(atom.canonical_target, target);
    assert.equal(sourceCompletenessExecutionClass(atom), "runtime_input");
  }
  assert.deepEqual(atomByIdentity.get("doi:10.1016/j.compedu.2019.103611\0schema.course_information").value,
    ["time", "location", "enrolled students", "credits"]);
  assert.deepEqual(atomByIdentity.get("doi:10.1016/j.compedu.2019.103611\0diary.unanalyzed_psychological_battery").value,
    { topics: ["personality", "stress", "self-esteem"], analyzed: false, instrument_versions_and_items: null });
  for (const [key, target] of [["weekly.missing_outgoing_sms_self_report", "diary_response"], ["weekly.other_variables_complete", "participant_record"]]) {
    const atom = atomByIdentity.get(`doi:10.3390/bs5040434\0${key}`);
    assert.equal(atom.role, "reported_result");
    assert.equal(atom.canonical_target, target);
    assert.equal(sourceCompletenessExecutionClass(atom), "scientific_oracle");
  }
  for (const key of ["collector.framework_fallback_schedule", "schema.usage_event_query", "schema.dataset_json"]) {
    const atom = atomByIdentity.get(`doi:10.2196/26540\0${key}`);
    assert.equal(sourceCompletenessExecutionClass(atom), "documentary_fact");
    assert.match(atom.value, /adjacent/);
  }
  const clockReference = atomByIdentity.get("doi:10.1145/2638728.2641700\0collector.clock_reference");
  assert.equal(sourceCompletenessExecutionClass(clockReference), "documentary_fact");
  assert.match(clockReference.value, /study-version link/);
});

test("projects every nonselectable campaign unit as source-located inventory", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const audits = new Map(readdirSync(resolve(directory, "source-completeness-audits"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(resolve(directory, "source-completeness-audits", name), "utf8")))
    .map((audit) => [audit.source_work_id, audit]));
  const admissions = loadPostFreezeAdmissions(repo, new Set(audits.keys()));
  const admittedIds = new Set(admissions.map((entry) => entry.canonical_work_id));
  for (const entry of admissions) {
    const audit = JSON.parse(readFileSync(resolve(repo, entry.audit_path), "utf8"));
    audits.set(audit.source_work_id, audit);
  }
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  const projected = { frozen: 0, admitted: 0 };
  const frozenCorpus = JSON.parse(readFileSync(resolve(repo, "docs/paper/android-143-corpus.json"), "utf8"));
  assert.equal(frozenCorpus.paper_count, 143);
  assert.equal(new Set(frozenCorpus.source_work_ids).size, 143);
  assert.deepEqual(library.profiles.map((profile) => profile.source_work_id).sort(), [...frozenCorpus.source_work_ids].sort());
  for (const profile of library.profiles) {
    if (["doi:10.1145/2634317.2634325", "doi:10.1145/2789168.2790107"]
      .includes(profile.source_work_id)) continue; // These use source-specific configuration projections.
    const audit = audits.get(profile.source_work_id);
    assert.ok(audit, `${profile.source_work_id}: missing source-completeness audit`);
    const verdicts = (audit.configuration_verdicts ?? []).filter((verdict) =>
      verdict.configuration_unit_kind === "campaign_internal_job_model_cell" && !verdict.branch_atom_keys?.length);
    const inventory = profile.method_configuration_space.method_configuration_groups.find((group) =>
      group.method_selection_semantics === "source_campaign_cells_no_user_selection");
    assert.equal(inventory?.method_configuration_levels.length ?? 0, verdicts.length, profile.source_work_id);
    const settingIds = new Set(profile.method_settings.map((setting) => setting.method_setting_id));
    const levelsByLabel = new Map(inventory?.method_configuration_levels.map((level) =>
      [level.method_configuration_level_label, level]) ?? []);
    for (const verdict of verdicts) {
      const level = levelsByLabel.get(verdict.source_configuration_id ?? verdict.configuration_id);
      assert.ok(level?.source_locators.length, `${profile.source_work_id}: missing campaign source locator`);
      assert.ok([...level.included_method_setting_ids, ...level.documentary_method_setting_ids]
        .every((id) => settingIds.has(id)), `${profile.source_work_id}: invalid campaign setting reference`);
      projected[admittedIds.has(profile.source_work_id) ? "admitted" : "frozen"] += 1;
    }
  }
  // Includes 93 units from the 13 reviewed exclusion reversals already in the fixed143 corpus.
  assert.equal(projected.frozen, 1791);
  assert.equal(projected.admitted, admissions.reduce((count, entry) => count
    + audits.get(entry.canonical_work_id).configuration_verdicts.filter((verdict) =>
      verdict.configuration_unit_kind === "campaign_internal_job_model_cell" && !verdict.branch_atom_keys?.length).length, 0));
});

test("keeps source-specific settings on their actual target layers", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  for (const [workId, key, role, target] of [
    ["doi:10.1145/2634317.2634325", "label.forward_fill", "quality_control", "outcome"],
    ["doi:10.1145/2789168.2790107", "preprocess.remove_linger", "quality_control", "screen_bout"],
    ["doi:10.1145/3313831.3376163", "collector.emotion_boundaries", "acquisition", "collector"],
    ["doi:10.1145/3313831.3376163", "ccm.hourly_aggregation", "aggregation", "participant_hour"],
    ["doi:10.1145/3313831.3376163", "ccm.emotions_independent", "aggregation", "participant_hour"],
    ["doi:10.1145/3313831.3376163", "descriptive.app_launch_hour", "aggregation", "derived_feature"],
    ["doi:10.1145/3313831.3376163", "descriptive.app_duration_hour", "aggregation", "derived_feature"],
    ["doi:10.1145/3313831.3376163", "descriptive.weekday_emotions", "aggregation", "derived_feature"],
    ["doi:10.1007/s41347-024-00443-5", "quality.valid_minute_any_active_sensor", "quality_control", "participant_hour"],
    ["doi:10.2196/13209", "survey.instrument", "participant_schema", "participant_measure"],
    ["doi:10.2196/13209", "campaign.reported_best_results", "reporting", "outcome"],
  ]) {
    const profile = library.profiles.find((row) => row.source_work_id === workId);
    const setting = profile?.method_settings.find((row) => row.method_parameter_key === key);
    assert.deepEqual([setting?.method_setting_role, setting?.method_target_layer], [role, target], `${workId} :: ${key}`);
    if (target === "participant_hour") {
      assert.equal(sourceCompletenessExecutionClass({ key, source_work_id: workId, role, canonical_role: role, canonical_target: target }), "runtime_operation");
      assert.equal(setting.method_implementation_status, "specification_only");
    }
  }
});

test("preserves all printed Screenomics package memberships and the unresolved count discrepancy", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.1007/s41347-024-00443-5");
  const value = key => JSON.parse(profile.method_settings.find(s => s.method_parameter_key === key).method_value_json);
  const codebook = value("category.package_membership_codebook");
  const baseline = value("baseline.demographics_and_subjective_status");
  assert.deepEqual(baseline.scale_endpoints, [{ value: 1, label: "worse off" }, { value: 10, label: "best off" }]);
  assert.deepEqual(baseline.comparison_groups, ["society", "others in their school"]);
  assert.equal(baseline.presentation, "visual ladder with ten rungs");
  const rows = codebook.positive_memberships;
  assert.equal(rows.length, 44);
  assert.equal(new Set(rows.map(r => r.package_name)).size, 44);
  assert.deepEqual(rows.reduce((counts, row) => {
    assert.equal(new Set(row.categories).size, row.categories.length);
    for (const category of row.categories) counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {}), { SNS: 20, Broad: 41, "Google Play": 27, "Popular SM": 7 });
  assert.deepEqual(rows.find(r => r.app_label === "YouTube").categories, ["SNS", "Broad", "Popular SM"]);
  assert.equal(rows.find(r => r.app_label === "Steam").package_name, "com.valvesoftware.android.steam.community");
  assert.equal(rows.find(r => r.app_label === "Plink").package_name, "tech.plink.PlinkApp");
  assert.equal(value("category.google_play_social").reported_app_count, 26);
  assert.match(codebook.table_prose_discrepancy, /27.*26/);
});

test("does not convert HUSH's remaining-duration value into an absolute alarm time", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1145-2789168.2790107.json"), "utf8"));
  const atom = audit.disclosed_atoms.find((row) => row.key === "hush.code_alarm_behavior");
  assert.match(atom.value, /remaining duration/);
  assert.match(atom.value, /without converting the duration to an absolute alarm time/);
});

test("records four loneliness campaigns without a 121st subset", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.2196-13209.json"), "utf8"));
  const campaigns = audit.source_configuration_repairs.filter((repair) =>
    repair.relation === "nested_models_within_one_outcome_resolution_campaign");
  const atom = (key) => audit.disclosed_atoms.find((row) => row.key === key);
  assert.equal(atom("survey.instrument").value.items.length, 20);
  assert.deepEqual(atom("survey.reverse_scoring").value.reverse_scored_one_based_item_numbers,
    [1, 5, 6, 9, 10, 15, 16, 19, 20]);
  assert.equal(atom("campus.label_space").value.appendix_feature_codebook.place_008,
    "academic buildings");
  assert.deepEqual(atom("campaign.reported_best_results").value.post_semester.best_set,
    ["Bluetooth", "location", "screen", "steps"]);
  assert.deepEqual([atom("evaluation.baseline").value.postloneliness_prose_percent,
    atom("evaluation.baseline").value.postloneliness_table_5_percent], [56.9, 58.5]);
  assert.equal(campaigns.length, 4);
  assert.ok(campaigns.every((repair) => repair.levels.some((label) =>
    label.includes("120 non-singleton subset ensembles including all-seven"))));
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  const space = profile.method_configuration_space;
  const groups = space.method_configuration_groups.filter((group) =>
    group.method_selection_semantics === "source_campaign_cell_no_user_selection");
  assert.equal(space.method_configuration_structure, "fixed");
  assert.deepEqual(space.allowed_method_combinations, []);
  assert.deepEqual(groups.map((group) => group.method_configuration_axis[0]).sort(),
    campaigns.map((repair) => repair.group).sort());
  const settingIdByKey = new Map(profile.method_settings.map((setting) =>
    [setting.method_parameter_key, setting.method_setting_id]));
  const evidenceGroup = space.method_configuration_groups.find((group) =>
    group.method_configuration_group_kind === "source_evidence_not_method_decision");
  const evidenceIds = new Set([
    ...evidenceGroup.documentary_method_setting_ids,
    ...evidenceGroup.unresolved_method_setting_ids,
  ]);
  for (const repair of campaigns) {
    const group = groups.find((row) => row.method_configuration_axis[0] === repair.group);
    assert.equal(group.method_selection_semantics, "source_campaign_cell_no_user_selection");
    assert.equal(group.method_configuration_levels.length, 1);
    const level = group.method_configuration_levels[0];
    assert.equal(level.method_configuration_level_label,
      `${repair.group}: ${repair.levels.join("; ")}`);
    const verdictIds = [repair.matrix_configuration_id, ...repair.configuration_ids];
    const expectedIds = [...new Set(verdictIds.flatMap((id) =>
      audit.configuration_verdicts.find((verdict) => verdict.configuration_id === id).atom_keys)
      .map((key) => settingIdByKey.get(key)).filter((id) => id && !evidenceIds.has(id)))];
    assert.deepEqual(new Set(level.included_method_setting_ids), new Set(expectedIds));
    assert.deepEqual(new Set(level.included_method_setting_ids),
      new Set([...level.common_method_setting_ids, ...level.branch_method_setting_ids]));
    assert.ok(level.branch_method_setting_ids.every((id) =>
      !space.invariant_method_setting_ids.includes(id)));
    const isPost = repair.group.startsWith("post_");
    const isAllEpochs = repair.group.endsWith("all_epochs");
    assert.ok(level.branch_method_setting_ids.includes(settingIdByKey.get(isPost
      ? "outcome.binary_loneliness" : "outcome.level_change")));
    assert.ok(!level.included_method_setting_ids.includes(settingIdByKey.get(isPost
      ? "outcome.level_change" : "outcome.binary_loneliness")));
    assert.ok(level.branch_method_setting_ids.includes(settingIdByKey.get(isAllEpochs
      ? "analysis.resolution_all_epochs" : "analysis.resolution_semester_only")));
    assert.ok(!level.included_method_setting_ids.includes(settingIdByKey.get(isAllEpochs
      ? "analysis.resolution_semester_only" : "analysis.resolution_all_epochs")));
    assert.equal(level.included_method_setting_ids.includes(settingIdByKey.get("temporal.epochs")),
      isAllEpochs);
    assert.ok(!level.included_method_setting_ids.includes(settingIdByKey.get("campaign.reported_best_results")));
    assert.ok(group.source_locators.some((locator) => locator.includes("59-loneliness.txt")));
  }
  assert.ok(!space.method_configuration_groups.some((group) =>
    group.method_configuration_group_kind === "source_configuration_alternative"));
  const result = profile.method_settings.find((row) => row.method_parameter_key === "campaign.reported_best_results");
  assert.ok(!space.invariant_method_setting_ids.includes(result.method_setting_id));
  assert.ok(space.method_configuration_groups.some((group) =>
    group.method_configuration_group_kind === "source_evidence_not_method_decision"
    && group.documentary_method_setting_ids.includes(result.method_setting_id)));
});

test("keeps Lin's psychiatrist assessment separate from phone processing and proposed criteria", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.4088-jcp.15m10310.json"), "utf8"));
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  const candidate = atoms.get("protocol.diagnostic_candidate_structure");
  assert.deepEqual(candidate.value.candidate_items.map((item) => item.id),
    Array.from({ length: 12 }, (_, index) => `A${index + 1}`));
  for (const key of ["protocol.diagnostic_candidate_structure", "outcome.app_incorporated_diagnosis",
    "outcome.standard_diagnosis"]) {
    const atom = atoms.get(key);
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.deepEqual([atom.canonical_role, atom.canonical_target,
      sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id })],
    ["participant_schema", "participant_measure", "runtime_input"]);
    assert.deepEqual([setting.method_setting_role, setting.method_target_layer],
      ["participant_schema", "participant_measure"]);
  }
  for (const key of ["analysis.emd_method_dependency", "event_schema.raw_contract_unreported"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }),
      "source_gap_or_conflict");
  }
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("protocol.excessive_use_threshold"),
    source_work_id: audit.source_work_id }), "runtime_operation");
  assert.match(atoms.get("protocol.excessive_use_threshold").value.source_conflict, /Table 1/);
  assert.match(atoms.get("protocol.excessive_use_threshold").value.source_conflict, /operational rule/);
  assert.deepEqual(atoms.get("event_schema.screen_state_events").value.raw_android_event_codes, "unreported");
  for (const key of ["reconstruction.screen_state_basis", "reconstruction.device_screen_not_package"]) {
    assert.equal(atoms.get(key).canonical_target, "screen_bout", key);
  }
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("reporting.proposed_criteria"),
    source_work_id: audit.source_work_id }), "scientific_oracle");
  assert.equal(atoms.get("reporting.proposed_criteria").value.A.window, "same 3-month period");
  assert.ok(atoms.get("aggregation.monthly_mean_features").value.outputs.includes("mean daily epoch length"));
  assert.ok(!atoms.get("aggregation.monthly_mean_features").value.outputs.some((output) =>
    output.includes("total duration")));
  assert.equal(atoms.get("aggregation.daily_total_duration").value.operation, "sum epoch durations");
  assert.match(atoms.get("aggregation.daily_total_duration").value.name, /distinct from the diagnostic duration parameter/);
  assert.match(atoms.get("analysis.emd_trend_outputs").value.M_trend, /8\.7 seconds\/day/);
  const monthly = profile.method_settings.find((row) => row.method_parameter_key === "aggregation.monthly_mean_features");
  assert.ok(JSON.parse(monthly.method_value_json).outputs.includes("mean daily epoch length"));
  assert.ok(!JSON.stringify(JSON.parse(monthly.method_value_json)).includes("length/total duration"));
});

test("keeps AppSensor's sampled transitions, source gaps, and reported chain counts distinct", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1145-2037373.2037383.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.match(atoms.get("episode.changed_state_transition").value, /either state can be no app/);
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("episode.screen_off_closer"),
    source_work_id: audit.source_work_id }), "source_gap_or_conflict");
  assert.equal(atoms.get("category.launcher_exclusion").canonical_target, "outcome");
  assert.equal(atoms.get("collector.background_non_gui_excluded").canonical_target, "collector");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("collector.background_non_gui_excluded"),
    source_work_id: audit.source_work_id }), "runtime_operation");
  assert.ok(!atoms.has("unknown.notification_attribution"));
  assert.ok(!atoms.has("unknown.unmatched_opener_policy"));
  assert.equal(audit.retracted_legacy_settings.length, 5);
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("quality.visible_idle_overcount"),
    source_work_id: audit.source_work_id }), "documentary_fact");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("result.basic_descriptives"),
    source_work_id: audit.source_work_id }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("study.reported_day_count_conflict"),
    source_work_id: audit.source_work_id }), "source_gap_or_conflict");
  for (const key of ["study.final_dataset_counts", "session.application_chain_count",
    "session.application_chain_cardinality_limits"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key),
      source_work_id: audit.source_work_id }), "scientific_oracle", key);
  }
  for (const atom of audit.disclosed_atoms.filter((row) => row.key.startsWith("unknown."))) {
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }),
      "source_gap_or_conflict", atom.key);
  }
  assert.match(atoms.get("episode.application_session_definition").value, /endpoint timestamp assignment is not disclosed/);
  assert.ok(!atoms.get("episode.application_session_definition").value.includes("71.56"));
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  for (const key of ["session.application_chain_count", "episode.screen_off_closer"]) {
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.ok(!profile.method_configuration_space.invariant_method_setting_ids.includes(setting.method_setting_id), key);
  }
  assert.equal(profile.method_settings.find((row) => row.method_parameter_key === "episode.screen_off_closer")
    .method_execution_blocker_code, "indispensable_source_evidence_unavailable");
});

test("keeps Fukazawa's example app names and repeated window labels source-faithful", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1016-j.jbi.2019.103151.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.equal(atoms.get("feature.app_categories").value.listed_apps_are_examples, true);
  assert.equal(atoms.get("reporting.label_counts").value.count_unit, "labeled_feature_window");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("reporting.label_counts"),
    source_work_id: audit.source_work_id }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("validation.within_person_zscore"),
    source_work_id: audit.source_work_id }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("quality.missing_log_causes"),
    source_work_id: audit.source_work_id }), "documentary_fact");
  assert.match(atoms.get("quality.missing_log_disposition").value, /zero-fill handling is not stated/);
  const primaryResultKeys = [...atoms.keys()].filter((key) => key.startsWith("reporting.primary_"));
  assert.equal(primaryResultKeys.length, 12);
  for (const key of primaryResultKeys) {
    const atom = atoms.get(key);
    assert.equal(atom.canonical_target, "outcome", key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }),
      "scientific_oracle", key);
  }
  assert.deepEqual(atoms.get("reporting.primary_rf_environment").value.sensitivity_significance_vs,
    ["real_world_acceleration"]);
  assert.deepEqual(atoms.get("reporting.primary_rf_real_world_orientation").value.f_score_significance_vs,
    ["real_world_acceleration"]);
  assert.deepEqual(atoms.get("reporting.primary_xgboost_all_2").value.f_score_significance_vs,
    ["environment", "real_world_acceleration", "real_world_orientation", "online_app", "all_1"]);
  assert.deepEqual(atoms.get("reporting.primary_xgboost_all_2").value.sensitivity_significance_vs,
    ["environment", "real_world_acceleration", "real_world_orientation", "online_app"]);
  const supplement = atoms.get("validation.supplement_t_tests");
  assert.equal(sourceCompletenessExecutionClass({ ...supplement, source_work_id: audit.source_work_id }),
    "source_gap_or_conflict");
  assert.deepEqual(supplement.value.unresolved_printed_p_value_tokens, ["2.950", "2.341", "2.373"]);
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  const label = profile.method_settings.find((row) => row.method_parameter_key === "reporting.label_counts");
  assert.ok(!profile.method_configuration_space.invariant_method_setting_ids.includes(label.method_setting_id));
  for (const key of [...primaryResultKeys, "validation.supplement_t_tests"]) {
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.ok(!profile.method_configuration_space.invariant_method_setting_ids.includes(setting.method_setting_id), key);
  }
  assert.equal(profile.method_settings.find((row) => row.method_parameter_key === "validation.within_person_zscore")
    .method_setting_role, "feature_engineering");
});

test("keeps Bjerre participant filters separate from published counts and panel statistics", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1177-0956797620956613.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  for (const key of ["quality.exclusion_no_grade",
    "quality.exclusion_missing_background", "quality.exclusion_one_graded_course",
    "quality.exclusion_course_without_peer"]) {
    const atom = atoms.get(key);
    assert.equal(atom.canonical_target, "participant_record", key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "runtime_operation", key);
  }
  for (const key of ["reconstruction.attendance_inference", "reconstruction.course_id_strip_semester"]) {
    const atom = atoms.get(key);
    assert.equal(atom.canonical_role, "feature_engineering", key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "runtime_operation", key);
  }
  for (const key of ["quality.iterative_sparse_group_filter", "quality.filter_missing_background_enabled",
    "quality.exclusion_attendance_lt_10h", "quality.exclusion_pass_fail_only_course"]) {
    const atom = atoms.get(key);
    assert.equal(atom.canonical_target, "participant_measure", key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "runtime_operation", key);
  }
  for (const key of ["acquisition.initial_cohort", "reporting.analysis_cohort",
    "reporting.exclusion_no_grade_count", "reporting.exclusion_attendance_count",
    "reporting.exclusion_missing_background_count", "reporting.exclusion_one_graded_course_count",
    "reporting.exclusion_course_without_peer_count", "reporting.panel_observations",
    "reporting.course_count", "reporting.unbalanced_panel", "reporting.grade_use_correlation",
    "provenance.screen_timeout_mode_10s", "provenance.screen_timeout_mode_30s",
    "reporting.sessions_over_35s"]) {
    const atom = atoms.get(key);
    assert.equal(atom.canonical_target, "outcome", key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "scientific_oracle", key);
  }
  const analysisInput = atoms.get("analysis.selected_input_schema");
  assert.equal(analysisInput.canonical_role, "participant_schema");
  assert.equal(analysisInput.canonical_target, "participant_measure");
  assert.equal(sourceCompletenessExecutionClass({ ...analysisInput, source_work_id: audit.source_work_id }), "runtime_input");
  for (const key of ["analysis.input_analysis_csv", "provenance.restricted_analysis_dataset",
    "provenance.package_versions_unpinned",
    "provenance.main_models_duplicate"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key),
      source_work_id: audit.source_work_id }), "source_gap_or_conflict", key);
  }
  for (const key of ["provenance.code_archive", "acquisition.study_period", "provenance.som_publisher_web_text_only"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key),
      source_work_id: audit.source_work_id }), "documentary_fact", key);
  }
  assert.equal(atoms.get("provenance.som_publisher_web_text_only").value.local_pdf_bytes_pinned, false);
  assert.equal(atoms.get("quality.implied_screen_on_gt_3h_missing").value.comparator, "greater_than");
  assert.equal(atoms.get("feature.long_screen_session_ge_35s").value.equality_included, true);
  for (const key of ["quality.consecutive_equal_screen_states_missing", "quality.implied_screen_on_gt_3h_missing",
    "feature.long_screen_session_ge_35s"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }), "runtime_operation", key);
  }
});

test("keeps DemonicSalmon's pinned prompt schedule and released schemas distinct from study history", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1016-j.smhl-2018-07-005.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  const classify = (key) => sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id });
  assert.equal(classify("study.semesters"), "documentary_fact");
  for (const key of ["collector.communication_streams", "schedule.rt_windows",
    "schedule.rt_randomization", "schedule.eod", "schedule.after_call",
    "schedule.after_call_runtime"]) assert.equal(classify(key), "runtime_operation", key);
  for (const key of ["ema.rt_schema", "ema.eod_schema", "ema.after_call_schema",
    "input.call_release_schema"]) assert.equal(classify(key), "runtime_input", key);
  for (const key of ["input.rt_release_schema", "input.eod_release_schema",
    "input.after_call_release_schema"]) {
    assert.equal(atoms.get(key).canonical_role, "diary_schema", key);
    assert.equal(atoms.get(key).canonical_target, "diary_response", key);
    assert.equal(classify(key), "runtime_input", key);
  }
  for (const key of ["input.sms_release_schema", "input.accelerometer_release_schema"]) {
    assert.equal(atoms.get(key).canonical_target, "raw_record", key);
    assert.equal(classify(key), "runtime_input", key);
  }
  assert.match(atoms.get("schedule.rt_randomization").value, /programmed in each of six two-hour windows/);
  assert.doesNotMatch(atoms.get("schedule.rt_randomization").value, /up to six/);
  assert.equal(classify("study.monitoring_duration"), "unadjudicated_execution_semantics");
  assert.equal(classify("collector.protocol_version"), "source_gap_or_conflict");
  assert.equal(classify("privacy.sms_content"), "runtime_operation");
  assert.match(atoms.get("privacy.sms_content").value, /not recorded/);
  assert.equal(atoms.get("privacy.sms_content").canonical_target, "collector");
  assert.equal(classify("privacy.phone_number"), "source_gap_or_conflict");
  assert.equal(atoms.get("privacy.phone_number").value.anonymization_algorithm, "unreported");
});

test("represents outbound Healthy Mind delivery and tool state without pretending they are observed event rows", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1371-journal.pone.0169162.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  for (const key of ["intelligent.daily_maximum", "intelligent.default_delivery_window",
    "random.default_window", "daily.frequency", "occasional.frequency",
    "intelligent.trigger_gate", "notification.teaser_length", "notification.tool_selection"]) {
    const atom = atoms.get(key);
    assert.equal(atom.canonical_role, "intervention", key);
    assert.equal(atom.canonical_target, "notification_delivery", key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "runtime_operation", key);
  }
  for (const key of ["intervention.starter_tools", "intervention.unlock_signal",
    "intervention.unlocked_access"]) {
    const atom = atoms.get(key);
    assert.equal(atom.canonical_target, "intervention_content_state", key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "runtime_operation", key);
  }
  const tools = atoms.get("intervention.unlockable_tools");
  assert.equal(tools.canonical_target, "intervention_content_state");
  assert.deepEqual([tools.value.starter_tools, tools.value.unlockable_tools, tools.value.total_tools], [4, 5, 9]);
  assert.equal(atoms.get("intervention.tool_inventory").value.starter.length, 4);
  assert.equal(atoms.get("intervention.tool_inventory").value.unlockable.length, 5);
  assert.equal(sourceCompletenessExecutionClass({ ...tools,
    source_work_id: audit.source_work_id }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("analysis.interview_schedule"),
    source_work_id: audit.source_work_id }), "runtime_operation");
  for (const key of ["intelligent.sensor_inputs", "intelligent.context_sampling_period", "usage.collection_runtime"]) {
    assert.deepEqual([atoms.get(key).canonical_role, atoms.get(key).canonical_target],
      ["acquisition", "collector"], key);
  }
  assert.match(atoms.get("intelligent.learning_update").value.sequence, /first two notifications/);
  assert.match(atoms.get("intelligent.context_sampling_period").value.phase, /after.*trained/);
  assert.equal(atoms.get("usage.days_used").canonical_target, "derived_feature");
  assert.equal(atoms.get("usage.ceased_use").canonical_role, "aggregation");
  assert.equal(atoms.get("analysis.quantitative_window").canonical_target, "study_window");
  assert.equal(atoms.get("analysis.qualitative_audit_trail").canonical_target, "model");
  for (const key of ["cohort.baseline_noncompletion", "cohort.technical_error_affected", "cohort.usable_total"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }),
      "scientific_oracle", key);
  }
  for (const key of ["usage.notifications_action_link_gap", "usage.login_session_boundary_gap",
    "usage.ceased_use_criterion_gap", "input.event_field_schema_gap", "cohort.ceased_use_percent_conflict"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }),
      "source_gap_or_conflict", key);
  }
});

test("keeps Tkaczyk raw screen states, repaired units, and available-day traces distinct", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1016-j.chb.2024.108281.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.equal(atoms.get("event_schema.screen_second_unit").value.variable, "binary screen status");
  const repaired = atoms.get("event_schema.repaired_screen_states");
  assert.deepEqual([repaired.canonical_role, repaired.canonical_target], ["quality_control", "acquired_snapshot"]);
  assert.deepEqual(repaired.value.per_second_states, ["screen-on", "screen-off", "screen-unknown"]);
  assert.equal(atoms.get("reconstruction.short_off_bridge").canonical_target, "acquired_snapshot");
  assert.match(atoms.get("reconstruction.short_off_bridge").value.output, /before constructing/);
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("reconstruction.notification_differentiation_intent"),
    source_work_id: audit.source_work_id }), "documentary_fact");
  assert.match(atoms.get("aggregation.single_time_trace_window").value.summary, /available data/);
  const adapter = JSON.parse(readFileSync(resolve(repo,
    "web/schema/literature-input-adapter-contract.json"), "utf8"));
  const notificationFields = adapter.groups.flatMap((group) => group.sourceSchemas ?? [])
    .filter((schema) => schema.sourceWorkId === audit.source_work_id);
  assert.deepEqual(notificationFields.map(({ kind, sourceField, canonicalField }) =>
    [kind, sourceField, canonicalField ?? null]).sort(), [
    ["field_passthrough", "notification_database_timestamp", null],
    ["field_passthrough", "notification_generating_app", null],
  ]);
});

test("keeps the Corona Health descriptor's missing source details and reported counts out of executable methods", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1038-s41597-026-07015-7.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  for (const key of ["quality.duration_unit_undisclosed", "quality.raw_usageevents_absent"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }), "source_gap_or_conflict");
  }
  for (const key of ["reporting.response_counts", "reporting.permission_population"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }), "scientific_oracle");
    assert.equal(atoms.get(key).canonical_target, "outcome");
  }
  for (const key of ["schema.app_header_28_fields", "schema.user_id_join_key",
    "schema.apps_container", "schema.top5_repeated_blocks", "schema.package_identifier",
    "reporting.total_daily_screen_on_field", "reporting.selected_app_foreground_duration_field",
    "reporting.foreground_service_duration_field"]) {
    const atom = atoms.get(key);
    assert.equal(atom.canonical_target, "released_artifact", key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }),
      "runtime_input", key);
  }
  assert.match(atoms.get("schema.apps_container").value, /all apps used on the submission day/);
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const article = library.profiles.find((profile) => profile.source_work_id === audit.source_work_id);
  assert.equal(article?.method_setting_count, 63);
  for (const [key, role, target, classification] of [
    ["acquisition.submission_location", "acquisition", "acquired_snapshot", "unadjudicated_execution_semantics"],
    ["schema.submission_location", "event_schema", "released_artifact", "runtime_input"],
  ]) {
    const atom = atoms.get(key);
    assert.deepEqual([atom.role, atom.canonical_role, atom.canonical_target], [role, role, target], key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), classification, key);
    const setting = article.method_settings.find((row) => row.method_parameter_key === key);
    assert.deepEqual([setting.method_setting_role, setting.method_target_layer], [role, target], key);
  }
  assert.deepEqual(atoms.get("acquisition.submission_location").value, {
    source: "device native location services", platforms: ["Android", "iOS"], permission: "explicit location permission",
    collection: "once per questionnaire submission; no continuous tracking", privacy_resolution_km: 11.1,
    independent_of_app_usage_permission: true,
  });
  assert.deepEqual(atoms.get("schema.submission_location").value, {
    files: ["GPS_Baseline.csv", "GPS_EMA.csv"],
    fields: {
      user_id: "anonymous participant identifier; can match corresponding questionnaire entries",
      sensordata_collected_at: "GPS recording timestamp, typically matching EMA submission time; exact equality not asserted",
      sensordata_altitude: { unit: "meters above sea level", optional: true },
      sensordata_longitude: { unit: "decimal degrees", rounded_to_degrees: 0.1 },
      sensordata_latitude: { unit: "decimal degrees", rounded_to_degrees: 0.1 },
    },
  });
  for (const key of ["schema.app_header_28_fields", "schema.apps_container",
    "reporting.total_daily_screen_on_field", "reporting.foreground_service_duration_field"]) {
    const setting = article.method_settings.find((row) => row.method_parameter_key === key);
    assert.deepEqual([setting.method_setting_role, setting.method_target_layer],
      ["event_schema", "released_artifact"], key);
  }
  assert.ok(!library.profiles.some((profile) => profile.source_work_id === "doi:10.23728/b2share.cgf63-kme28"));
  assert.ok(article.method_settings.every((setting) => setting.method_implementation_status === "specification_only"));
  assert.equal(atoms.get("reconstruction.activity_inactivity").canonical_target, "derived_feature");
  assert.match(atoms.get("reconstruction.tracked_top5").value, /submission day/);
  assert.deepEqual(atoms.get("diary.question_types").value.codebook_questiontype_examples,
    ["SingleChoice", "MultipleChoice", "Scale", "Knob"]);
  for (const key of ["diary.baseline_duration", "diary.ema_duration"]) {
    assert.equal(atoms.get(key).role, "reported_burden");
    assert.equal(atoms.get(key).value.enforced_timer, "not reported");
  }
  for (const key of ["schema.appdata_serialization_conflict", "schema.appdata_day_window_conflict",
    "aggregation.per_app_first_last_release_gap"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }),
      "source_gap_or_conflict", key);
  }
  assert.equal(atoms.get("schema.appdata_day_window_conflict").value.pinned_release_example.span_seconds, 604800);
  const dayConflictLocators = article.method_settings.find((row) =>
    row.method_parameter_key === "schema.appdata_day_window_conflict").source_locators;
  assert.ok(dayConflictLocators.some((locator) => locator.includes("/APP_Baseline.csv#")));
  assert.ok(!dayConflictLocators.some((locator) => locator.includes("/Baseline.csv#")));
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("report.postexport_time_and_duplicates"),
    source_work_id: audit.source_work_id }), "scientific_oracle");
  assert.equal(atoms.get("validation.missingness_warning").canonical_target, "outcome");
  const retired = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/method-setting-alias-tombstones.json"), "utf8"));
  assert.equal(retired.tombstones.filter((row) => row.source_work_id === audit.source_work_id
    && row.tombstone_status === "retracted_unsupported_legacy_extraction").length, 4);
});

test("keeps Albayram's observed field-study totals out of executable window controls", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1186-s13673-016-0072-3.json"), "utf8"));
  const observation = audit.disclosed_atoms.find((atom) => atom.key === "field.observation");
  assert.deepEqual(observation.value, {
    period_days: 30,
    valid_responses: 7672,
    one_withdrawal_after_weeks: 2,
  });
  assert.equal(sourceCompletenessExecutionClass({ ...observation, source_work_id: audit.source_work_id }), "scientific_oracle");
});

test("separates Stachl's planned collector cadence from Table 2 observed intervals", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1002-per.2309.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  for (const sensor of ["accelerometer", "bluetooth", "location", "microphone"]) {
    const planned = atoms.get(`collector.${sensor}`);
    const observed = atoms.get(`collector.${sensor}.observed_interval`);
    assert.ok(Number.isInteger(planned.value.interval_minutes));
    assert.equal(planned.value.modal_actual_minutes, undefined);
    assert.equal(planned.value.actual_range, undefined);
    assert.equal(observed.role, "reported_result");
    assert.equal(observed.canonical_target, "outcome");
    assert.equal(sourceCompletenessExecutionClass({ ...observed, source_work_id: audit.source_work_id }), "scientific_oracle");
  }
  assert.equal(atoms.get("cohort.initial_installed_sample").canonical_role, "reporting");
});

test("keeps classroom model settings separate from printed fit and test statistics", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1016-j.compedu.2019.103611.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  for (const key of ["apps.group_test", "rq5.block_1", "rq5.block_2", "rq5.block_3"]) {
    const method = atoms.get(key);
    const result = atoms.get(`${key}.reported_result`);
    assert.equal(sourceCompletenessExecutionClass({ ...method, source_work_id: audit.source_work_id }), "runtime_operation");
    assert.equal(sourceCompletenessExecutionClass({ ...result, source_work_id: audit.source_work_id }), "scientific_oracle");
    assert.ok(!JSON.stringify(method.value).includes("adjusted_R2"));
    assert.ok(!JSON.stringify(method.value).includes("chi_square"));
  }
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("apps.top_five"), source_work_id: audit.source_work_id }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("apps.ringer_modes"), source_work_id: audit.source_work_id }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("apps.ringer_modes.reported_result"), source_work_id: audit.source_work_id }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("rq5.app_predictor_set"), source_work_id: audit.source_work_id }), "runtime_operation");
  for (const key of ["rq1.class_prevalence", "rq1.class_session_results",
    "apps.top_five_share", "apps.main_results", "apps.multitasking", "apps.notifications",
    "rhythm.reported_shape", "rq4.duration_coefficients", "rq4.frequency_coefficients",
    "rq5.reported_coefficients"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }),
      "scientific_oracle", key);
    assert.equal(atoms.get(key).canonical_target, "outcome", key);
  }
  for (const key of ["protocol.demographics", "protocol.study_scale"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key),
      source_work_id: audit.source_work_id }), "documentary_fact", key);
  }
  for (const key of ["attendance.wifi_primary", "attendance.wifi_spatial_locality",
    "attendance.gps_fallback", "attendance.gps_indoor_transition",
    "attendance.manual_building_circles", "arrival.activity_transition",
    "arrival.stationary_threshold"]) {
    const atom = atoms.get(key);
    assert.deepEqual([atom.canonical_role, atom.canonical_target],
      ["feature_engineering", "derived_feature"], key);
  }
  for (const key of ["session.screen_on_start", "session.screen_off_end", "session.multiple_apps"]) {
    assert.equal(atoms.get(key).canonical_target, "device_session", key);
  }
  assert.ok(!atoms.get("schema.interaction_events").value.includes("ringer mode"));
  assert.equal(atoms.get("storage.dropsync").canonical_target, "collector");
  assert.match(atoms.get("arrival.stationary_threshold").value, /consecutiveness rule is not stated/);
  assert.equal(atoms.get("apps.top_five_share").value.denominator, "overall usage duration");
  assert.equal(sourceCompletenessExecutionClass({ ...atoms.get("validation.attendance_reference"),
    source_work_id: audit.source_work_id }), "scientific_oracle");
  assert.equal(atoms.get("rq5.reported_coefficients").value.block3.daily_Facebook_duration, 0.293);
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  const result = profile.method_settings.find((row) => row.method_parameter_key === "rq5.reported_coefficients");
  assert.ok(!profile.method_configuration_space.invariant_method_setting_ids.includes(result.method_setting_id));
  assert.equal(JSON.parse(result.method_value_json).block3.daily_Facebook_duration, 0.293);
  assert.equal(profile.method_settings.find((row) => row.method_parameter_key === "session.screen_on_start")
    .method_target_layer, "device_session");
  assert.equal(JSON.parse(profile.method_settings.find((row) => row.method_parameter_key === "apps.top_five_share")
    .method_value_json).denominator, "overall usage duration");
  const space = profile.method_configuration_space;
  assert.equal(space.method_configuration_structure, "conditional");
  assert.deepEqual(space.allowed_method_combinations, []);
  assert.ok(!profile.method_settings.some((row) => row.method_parameter_key === "rq5.block_dependency"));
  assert.ok(space.method_configuration_groups.some((group) =>
    group.method_configuration_group_kind === "source_configuration_metadata"
    && group.method_configuration_axis.includes("rq5.block_dependency")));
  const attendance = space.method_configuration_groups.find((group) =>
    group.method_configuration_axis.includes("attendance_signal_availability"));
  assert.equal(attendance.method_configuration_group_kind, "conditional_joint_protocol");
  assert.match(attendance.method_configuration_levels[0].method_configuration_level_label,
    /neither Wi-Fi nor GPS evidence available: exclude/);
});

test("keeps Hamilton's reported half-hour rule separate from unbound RAPIDS code", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1007-s41347-024-00443-5.json"), "utf8"));
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  const admission = atoms.get("quality.valid_hour_zero_na");
  assert.equal(admission.value.paper_valid_comparator, ">=");
  assert.equal(admission.value.paper_valid_minutes, 30);
  assert.equal(admission.value.code_conflict, undefined);
  assert.deepEqual([admission.canonical_role, admission.canonical_target], ["quality_control", "derived_feature"]);
  assert.match(atoms.get("provenance.rapids_version_conflict").value.unbound_public_code_threshold,
    /no source-version link/);
  for (const key of ["reconstruction.rapids_app_episodes", "feature.countepisode_not_any_use"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }),
      "source_gap_or_conflict", key);
  }
  assert.equal(atoms.get("feature.countepisode_not_any_use").value.executed_in_reported_analyses, false);
  assert.ok(!atoms.get("aggregation.daily_calendar_rollup").value.includes("local calendar days"));
  for (const measure of ["duration", "checking"]) {
    for (const [prefix, expectedClass] of [
      ["analysis", "runtime_operation"],
      ["report", "scientific_oracle"],
      ["gap", "source_gap_or_conflict"],
    ]) {
      const key = prefix === "gap" ? `gap.rmcorr_daily_${measure}_details`
        : `${prefix}.rmcorr_daily_${measure}_categories`;
      const atom = atoms.get(key);
      const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
      assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }),
        expectedClass, key);
      assert.deepEqual(JSON.parse(setting.method_value_json), atom.value, key);
      assert.equal(setting.method_setting_role, atom.canonical_role, key);
      assert.equal(setting.method_target_layer, atom.canonical_target, key);
    }
  }
  assert.equal(atoms.get("analysis.rmcorr_daily_duration_categories").value.software, "rmcorr package in R");
  assert.deepEqual(atoms.get("report.rmcorr_daily_checking_categories").value.google_play_pair_range_r,
    [0.9, 0.93]);
});

test("keeps observed Android outcomes separate from their analysis procedures", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits");
  const cases = [
    ["doi-10.1016-j.smhl.2020.100137.json", {
      "cohort.total_participants": "documentary_fact",
      "cohort.android_filtered": "scientific_oracle",
      "result.android_category_correlations": "scientific_oracle",
      "result.android_regression_selected_features": "scientific_oracle",
      "analysis.correlation_method": "runtime_operation",
      "analysis.regression_feature_selection": "runtime_operation",
    }],
    ["doi-10.1016-j.psychres.2023.115298.json", {
      "hypothesis.h1_objective_subjective": "documentary_fact",
      "hypothesis.h4_interaction": "documentary_fact",
      "cohort.sdq_missing_excluded": "scientific_oracle",
      "analysis.model_sample_size": "documentary_fact",
      "reporting.table2.whatsapp_text": "scientific_oracle",
      "reporting.table2.posting": "scientific_oracle",
      "analysis.h1_spearman_design": "runtime_operation",
      "quality.sdq_prefer_not_answer": "runtime_operation",
    }],
    ["doi-10.1145-3429360.3468192.json", {
      "cohort.boundary_ambiguity": "source_gap_or_conflict",
      "dataset.events_all": "scientific_oracle",
      "total_sessions.morning_omission": "documentary_fact",
      "sessions.lock_events_absent": "runtime_input",
      "sessions.gap": "runtime_operation",
    }],
  ];
  for (const [file, expected] of cases) {
    const audit = JSON.parse(readFileSync(resolve(directory, file), "utf8"));
    const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
    for (const [key, classification] of Object.entries(expected)) {
      assert.ok(atoms.has(key), `${audit.source_work_id}: missing ${key}`);
      assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }),
        classification, `${audit.source_work_id}: ${key}`);
    }
    if (audit.source_work_id === "doi:10.1016/j.psychres.2023.115298") {
      assert.match(atoms.get("cohort.flowchart_ordering_ambiguity").value, /H1 r\(449\).*N=421/);
      assert.match(atoms.get("reporting.table2.posting").value.activity, /TikTok\/Instagram/);
    }
    if (audit.source_work_id === "doi:10.1145/3429360.3468192") {
      assert.ok(atoms.get("total_sessions.axes").value.time_ranges_analyzed.includes("morning"));
      assert.equal(atoms.get("total_sessions.axes").value.morning_omitted, undefined);
    }
  }
});

test("keeps PathFinder's reported evaluation population out of quality-control settings", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1109-thms-2018-2868806.json"), "utf8"));
  const count = audit.disclosed_atoms.find((atom) => atom.key === "evaluation.app_count");
  assert.equal(count.value, 100);
  assert.equal(count.canonical_role, "reporting");
  assert.equal(count.canonical_target, "outcome");
  assert.equal(sourceCompletenessExecutionClass({ ...count, source_work_id: audit.source_work_id }), "scientific_oracle");
});

test("keeps three papers' source observations apart from executable operations", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits");
  const cases = [
    ["doi-10.1109-jiot.2020.2975779.json", { "metric.roc": "runtime_operation" }],
    ["doi-10.1080-15213269.2024.2334025.json", {
      "notification.input.lab": "runtime_input",
      "notification.input.lab_observed_dimensions": "documentary_fact",
      "notification.union_release": "runtime_operation",
    }],
    ["doi-10.1080-15213269-2020-1768122.json", {
      "cohort.duplicate_prompt_exclusion": "runtime_operation",
      "cohort.duplicate_prompt_observation": "scientific_oracle",
      "procedure.esm.actual_prompt_count": "scientific_oracle",
      "monitoring.original.disposition_reason": "documentary_fact",
      "model.interaction.supplemental_robustness": "scientific_oracle",
      "exploratory.mediated_face_model.oracle": "scientific_oracle",
    }],
  ];
  for (const [filename, expected] of cases) {
    const audit = JSON.parse(readFileSync(resolve(directory, filename), "utf8"));
    const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
    for (const [key, classification] of Object.entries(expected)) {
      assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }), classification, `${audit.source_work_id} :: ${key}`);
    }
  }
});

test("keeps applied rules and source contradictions separate from observations", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits");
  const tkaczyk = JSON.parse(readFileSync(resolve(directory, "doi-10.1016-j.chb.2024.108281.json"), "utf8"));
  const tkaczykAtoms = new Map(tkaczyk.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.deepEqual(tkaczykAtoms.get("quality.within_person_minimum_days").value, { minimum_days: 3 });
  assert.equal(tkaczykAtoms.get("quality.five_day_benchmark_considered").value.minimum_days_considered, 5);
  assert.equal(tkaczykAtoms.get("reporting.five_day_complete_n").value.complete_participants, 77);
  for (const key of ["quality.within_person_minimum_days", "quality.five_day_benchmark_considered", "reporting.five_day_complete_n"]) {
    assert.ok(tkaczyk.configuration_verdicts.some((verdict) => verdict.atom_keys.includes(key)));
  }
  const mehrotra = JSON.parse(readFileSync(resolve(directory, "doi-10.1145-3131901.json"), "utf8"));
  const mehrotraAtoms = new Map(mehrotra.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.deepEqual(mehrotraAtoms.get("oracle.location_type.app_usage.context_effect").value, { F: 6.85, p: "<0.05" });
  assert.equal(mehrotraAtoms.get("source.location_type_app_usage_factor_label_conflict").value.reported_label, "daily activity");
  assert.ok(mehrotra.configuration_verdicts.some((verdict) =>
    verdict.atom_keys.includes("source.location_type_app_usage_factor_label_conflict")));
});

test("a cross-study survey has no selector and reported threshold outputs never become method arms", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const survey = library.profiles.find((row) => row.source_work_id === "doi:10.1016/j.pmcj.2017.01.007");
  assert.equal(survey.method_configuration_space.invariant_method_setting_ids.length, 0);
  assert.ok(survey.method_configuration_space.method_configuration_groups.every((group) =>
    !group.method_selection_semantics.includes("select_exactly_one")));
  const tkaczyk = library.profiles.find((row) => row.source_work_id === "doi:10.1016/j.chb.2024.108281");
  const byId = new Map(tkaczyk.method_settings.map((row) => [row.method_setting_id, row]));
  const levels = tkaczyk.method_configuration_space.method_configuration_groups.find((group) =>
    group.method_configuration_levels.length === 6).method_configuration_levels;
  assert.ok(levels.every((level) => level.included_method_setting_ids.every((id) =>
    byId.get(id)?.method_target_layer !== "outcome")));
  assert.ok(levels.some((level) => level.documentary_method_setting_ids.some((id) =>
    byId.get(id)?.method_parameter_key.startsWith("reporting.threshold_"))));
});

test("illustrative source-schema fixtures cannot promote raw mappings", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const contract = JSON.parse(readFileSync(resolve(repo,
    "web/schema/literature-input-adapter-contract.json"), "utf8"));
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const settings = new Map(library.profiles.flatMap((profile) => profile.method_settings)
    .map((setting) => [setting.method_setting_id, setting]));
  const unverified = contract.groups.flatMap((group) => group.sourceSchemas ?? [])
    .filter((schema) => schema.sourceExact === false);
  assert.equal(unverified.length, 16);
  for (const schema of unverified) {
    const setting = settings.get(schema.methodSettingId);
    if (setting) {
      assert.equal(setting.method_implementation_status, "specification_only", schema.methodSettingId);
      assert.equal(setting.method_execution_blocker_code, "source_schema_unverified_raw_mapping", schema.methodSettingId);
    }
  }
  for (const id of ["atomic-1e7bf6d8ac522afc747f8b2e", "atomic-e586edd61a9329c4008c4290",
    "method-setting-02fd2df1a0a48299029783ac"]) {
    assert.equal(unverified.find((schema) => schema.methodSettingId === id)?.kind, "field_passthrough");
  }
});

test("keeps Lepri Table 6 feature arms distinct from reported metrics and selectable settings", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1145-2647868.2654933.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  const featureSources = {
    multifactorial: ["personality", "weather", "Bluetooth", "call", "SMS"],
    majority: [],
    weather_only: ["weather"],
    personality_only: ["personality"],
    mobile_only: ["Bluetooth", "call", "SMS"],
    personality_weather: ["personality", "weather"],
    personality_mobile: ["personality", "Bluetooth", "call", "SMS"],
    weather_mobile: ["weather", "Bluetooth", "call", "SMS"],
  };
  for (const [slug, sources] of Object.entries(featureSources)) {
    const method = atoms.get(`analysis.subset.${slug}`);
    const result = atoms.get(`result.subset.${slug}`);
    assert.deepEqual(method.value.feature_sources, sources);
    assert.equal(method.canonical_role, "analysis");
    assert.equal(result.value.feature_sources, undefined);
    assert.equal(result.canonical_role, "reporting");
    const jobs = audit.configuration_verdicts.filter((verdict) => verdict.atom_keys.includes(method.key));
    assert.deepEqual(jobs.map((job) => job.configuration_id), [`bogomolov2014:subset:${slug}`]);
    assert.equal(jobs[0].configuration_unit_kind, "campaign_internal_job_model_cell");
    assert.ok(jobs[0].atom_keys.includes(result.key));
  }
  assert.equal(atoms.get("analysis.subset.majority").value.prediction_rule, "always predict the majority class");
});

test("separates PASTime fitted-slope choices from statistics and preserves STDD's source boundary", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits");
  const pastime = JSON.parse(readFileSync(resolve(directory, "doi-10.1007-s10865-024-00499-x.json"), "utf8"));
  const pastimeAtoms = new Map(pastime.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.deepEqual(pastimeAtoms.get("model.steps_total.random_slope").value, { daily_screen_time: "estimated" });
  assert.deepEqual(pastimeAtoms.get("model.steps_total.random_slope_oracle").value, { p: 0.14 });
  assert.deepEqual(pastimeAtoms.get("model.sitting_total.random_slope").value, { daily_screen_time: "estimated" });
  assert.deepEqual(pastimeAtoms.get("model.sitting_total.random_slope_oracle").value, { variance: 0.11, p: 0.01 });
  const stdd = JSON.parse(readFileSync(resolve(directory, "doi-10.3390-s20051396.json"), "utf8"));
  const stddAtoms = new Map(stdd.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.match(stddAtoms.get("group.moderate.rule").value, / and satisfies /);
  assert.equal(stddAtoms.get("group.phq9_score_10_assignment_gap").role, "evidence_gap");
  assert.equal(stdd.configuration_verdicts.filter((verdict) =>
    verdict.atom_keys.includes("group.phq9_score_10_assignment_gap")).length, 1);
  assert.equal(stddAtoms.get("source.depression_train_test_split_unit_conflict").value.resolved_unit, false);
  assert.equal(stddAtoms.get("depression.validation.train_test_split").value.unit, "samples");
  for (const key of ["release.public_study_data", "release.public_study_code", "release.study_supplement"]) {
    assert.deepEqual(stddAtoms.get(key).value,
      { study_specific_link_in_paper: false, availability_beyond_paper: "unverified" });
  }
  for (const key of ["ema.weight_change_not_collected", "social.input.messages", "food.passive_sensor"]) {
    assert.equal(stddAtoms.get(key).canonical_role, "provenance");
  }
  for (const key of ["collector.local_storage", "collector.identity_protection"]) {
    assert.equal(stddAtoms.get(key).canonical_target, "collector");
  }
  assert.deepEqual(stddAtoms.get("quality.excluded_participant").value, { count: 1, group: "mild" });
  assert.equal(stddAtoms.get("quality.technical_data_loss_exclusion").canonical_role, "quality_control");
  for (const key of ["entry.first_stage_instrument", "entry.second_stage_instrument",
    "entry.additional_instruments", "exit.instruments"]) {
    const atom = stddAtoms.get(key);
    assert.equal(atom.canonical_role, "participant_schema");
    assert.equal(atom.canonical_target, "participant_measure");
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: stdd.source_work_id }), "runtime_input");
  }
  assert.deepEqual(stddAtoms.get("report.ema_response_rates").value,
    { "07:00": 0.38, "10:00": 0.6, "13:00": 0.64, "16:00": 0.61, "19:00": 0.6, "22:00": 0.58 });
  assert.match(stddAtoms.get("report.ema_response_rates").locator, /57-stdd\.pdf#page=11;Table=3/);
  assert.equal(stddAtoms.get("report.group.accuracy_sd").value.unit, null);
  assert.equal(sourceCompletenessExecutionClass({ ...stddAtoms.get("report.group.accuracy_sd"), source_work_id: stdd.source_work_id }), "scientific_oracle");
  assert.equal(sourceCompletenessExecutionClass({ ...stddAtoms.get("limitation.sleep_night_waking"), source_work_id: stdd.source_work_id }), "documentary_fact");
  assert.equal(stddAtoms.get("report.feature_importance_method").canonical_target, "model");
  assert.equal(sourceCompletenessExecutionClass({ ...stddAtoms.get("report.feature_importance_method"), source_work_id: stdd.source_work_id }), "runtime_operation");
  assert.equal(stddAtoms.get("physical.metrics").canonical_target, "model");
  assert.equal(sourceCompletenessExecutionClass({ ...stddAtoms.get("physical.metrics"), source_work_id: stdd.source_work_id }), "runtime_operation");
  assert.equal(sourceCompletenessExecutionClass({ ...stddAtoms.get("report.group_test_balance"), source_work_id: stdd.source_work_id }), "scientific_oracle");
});

test("keeps AffectPro collector and prompt behavior out of raw schema", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1145-3536221.3556603.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.equal(atoms.get("apparatus.no_alphanumeric_storage").canonical_target, "collector");
  assert.equal(atoms.get("apparatus.special_character_observation").canonical_role, "provenance");
  for (const key of ["emotion.no_response_default", "emotion.valid_response_action", "emotion.inopportune_instruction"]) {
    assert.equal(atoms.get(key).canonical_role, "acquisition");
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }), "runtime_operation");
  }
});

test("preserves released-code conflicts and distinguishes example thresholds from applied rules", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits");
  const snapshots = JSON.parse(readFileSync(resolve(directory, "doi-10.1037-pspp0000469.json"), "utf8"));
  const atoms = new Map(snapshots.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.deepEqual(atoms.get("quality.es_spacing_filter").value,
    { close_pair_threshold_minutes: 60, comparison: "strictly less than" });
  assert.equal(atoms.get("source.es_spacing_filter_direction_conflict").value.resolved_direction, false);
  assert.deepEqual(atoms.get("quality.manual_phone_changers").value.excluded_user_ids, [256, 1147, 1341]);
  assert.equal(atoms.get("provenance.phone_changer_helper_unused").value.used_by_exclusion, false);
  assert.equal(atoms.get("acquisition.study_window").value.analyzed_participants, undefined);
  assert.equal(atoms.get("quality.es_extraction_window_padding").value.start_comparison, ">=");
  const security = JSON.parse(readFileSync(resolve(directory, "doi-10.1186-s13673-016-0072-3.json"), "utf8"));
  const securityAtoms = new Map(security.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.equal(securityAtoms.get("location.epsilon").value.exact_study_value, "undetermined");
  assert.equal(securityAtoms.get("location.score").value.boundary, "distance <= 75 meters is not failed");
  assert.equal(sourceCompletenessExecutionClass({ ...securityAtoms.get("location.epsilon"), source_work_id: security.source_work_id }), "documentary_fact");
});

test("keeps paper methods distinct from campaign cells, examples, and source gaps", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits");
  const audit = (name) => JSON.parse(readFileSync(resolve(directory, name), "utf8"));
  const classified = (record, key) => sourceCompletenessExecutionClass({
    ...record.disclosed_atoms.find((atom) => atom.key === key), source_work_id: record.source_work_id,
  });
  const recommender = audit("doi-10.1007-s00530-018-0601-1.json");
  assert.equal(recommender.configuration_topology.user_selectable_configuration_count, 0);
  assert.deepEqual(recommender.configuration_verdicts.reduce((counts, verdict) => {
    counts[verdict.configuration_unit_kind] = (counts[verdict.configuration_unit_kind] ?? 0) + 1;
    return counts;
  }, {}), { fixed_pipeline_stage_component: 6, campaign_internal_job_model_cell: 47 });
  const snapshots = audit("doi-10.1037-pspp0000469.json");
  assert.equal(classified(snapshots, "analysis.target.adversity"), "runtime_operation");
  assert.equal(classified(snapshots, "analysis.grouped_subset.full"), "runtime_operation");
  const autosen = audit("doi-10.1109-jiot.2020.2975779.json");
  assert.equal(classified(autosen, "normalization.window_seconds"), "runtime_operation");
  assert.equal(classified(autosen, "missing.leading_boundary"), "source_gap_or_conflict");
  assert.equal(classified(autosen, "operation.retraining_triggers"), "documentary_fact");
  const dekker = audit("doi-10.1080-15213269.2024.2334025.json");
  assert.equal(classified(dekker, "clean.unlock_inputs"), "runtime_input");
  assert.equal(classified(dekker, "notification.union_release"), "runtime_operation");
  const srep = audit("doi-10.1038-s41598-019-47493-x.json");
  assert.equal(classified(srep, "app.launch_duration_threshold"), "runtime_input");
  assert.equal(classified(srep, "gps.stop_boundary_evidence_conflict"), "source_gap_or_conflict");
  assert.equal(classified(srep, "gps.source_quality"), "source_gap_or_conflict");
  assert.equal(classified(srep, "result.capacity_conservation_summary"), "source_gap_or_conflict");
  assert.match(srep.disclosed_atoms.find((atom) => atom.key === "metric.persistence").value, /weeks an app is kept/);
  assert.equal(srep.disclosed_atoms.find((atom) => atom.key === "result.capacity_conservation_summary")
    .value.figure_caption_app_conserved_percent, 97.5);
  const keyboard = audit("doi-10.1109-acii.2019.8925518.json");
  assert.equal(classified(keyboard, "corpus.session_count_conflict"), "source_gap_or_conflict");
  assert.equal(classified(keyboard, "corpus.minimum_touches"), "runtime_operation");
  assert.equal(classified(keyboard, "comparison.findings"), "scientific_oracle");
  const nightlife = audit("doi-10.1177-00936502241276793.json");
  const nightlifeAtoms = new Map(nightlife.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.equal(classified(nightlife, "diary.realized_compliance"), "scientific_oracle");
  assert.equal(classified(nightlife, "quality.outlier_percentile"), "runtime_input");
  assert.equal(classified(nightlife, "quality.outlier_boundary_source_conflict"), "source_gap_or_conflict");
  assert.equal(nightlifeAtoms.get("quality.outlier_boundary_source_conflict").value.scope_conflict, false);
  assert.match(nightlifeAtoms.get("event_schema.duration").value.raw_semantics, /cumulative/);
  for (const key of ["event_schema.duration", "quality.zero_duration_disposition",
    "quality.zero_duration_threshold", "quality.zero_duration_enabled", "quality.background_activity_exclusion"]) {
    assert.equal(nightlifeAtoms.get(key).implementation_disposition, "specification_only");
  }
  const sleepminer = audit("doi-10.5555-2442691.2442720.json");
  assert.deepEqual(sleepminer.configuration_verdicts.reduce((counts, verdict) => {
    counts[verdict.configuration_unit_kind] = (counts[verdict.configuration_unit_kind] ?? 0) + 1;
    return counts;
  }, {}), { fixed_pipeline_stage_component: 7, campaign_internal_job_model_cell: 4 });
  assert.equal(classified(sleepminer, "quality.questionnaire_careful_rate"), "scientific_oracle");
  assert.equal(classified(sleepminer, "quality.abnormal_record_rule"), "source_gap_or_conflict");
  assert.equal(classified(sleepminer, "model.initialization"), "unadjudicated_execution_semantics");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  assert.equal(library.profiles.some((profile) => profile.source_work_id === "doi:10.3389/fpsyg.2016.01252"), false);
});

test("keeps UbiqLog transfer and archiveability choices on separate source axes", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === "doi:10.1007/s00779-012-0511-8");
  const space = profile.method_configuration_space;
  const selectableGroups = space.method_configuration_groups.filter((group) =>
    group.method_configuration_group_kind === "source_configuration_alternative");
  assert.deepEqual(selectableGroups.map((group) => group.method_configuration_axis), [
    ["rsm_transfer_trigger"], ["archiveability_handling"],
  ]);
  assert.deepEqual(selectableGroups.map((group) => group.method_configuration_levels.length), [2, 2]);
  assert.deepEqual(space.allowed_method_combinations, []);
  const settings = new Map(profile.method_settings.map((row) => [row.method_setting_id, row]));
  for (const group of selectableGroups) {
    const forbidden = group.method_configuration_axis[0] === "rsm_transfer_trigger"
      ? /^archiveability\./ : /^(transfer|storage)\./;
    for (const level of group.method_configuration_levels) {
      assert.equal(level.excluded_method_setting_ids.some((id) =>
        forbidden.test(settings.get(id)?.method_parameter_key ?? "")), false);
    }
  }
  const registry = JSON.parse(readFileSync(resolve(repo,
    "web/src/generated/android-method-profile-runtime-registry.json"), "utf8"));
  const runtimeProfile = registry.profiles.find((row) => row.source_work_id === profile.source_work_id);
  assert.equal(runtimeProfile.configuration_count, 4);
  assert.equal(runtimeProfile.profile_implementation_status, "blocked");
  const matrix = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/profile-runs/android-profile-matrix-20260904-source-scope.json"), "utf8"));
  const variants = matrix.variantDetails.filter((row) => row.sourceWorkId === profile.source_work_id);
  assert.equal(variants.length, 4);
  for (const variant of variants) {
    assert.equal(variant.selectedLevelIds.filter((id) => selectableGroups.some((group) =>
      group.method_configuration_levels.some((level) => level.method_configuration_level_id === id))).length, 1);
    const otherGroup = selectableGroups.find((group) =>
      !group.method_configuration_levels.some((level) =>
        variant.selectedLevelIds.includes(level.method_configuration_level_id)));
    const otherBranchIds = new Set(otherGroup.method_configuration_levels.flatMap((level) =>
      level.branch_method_setting_ids));
    assert.equal(variant.effectiveSettingIds.some((id) => otherBranchIds.has(id)), false);
  }
});

test("keeps provider disjunctions and screen-state branches inside one paper method", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const bsn = library.profiles.find((row) => row.source_work_id === "doi:10.1109/bsn.2012.3");
  const provider = bsn.method_configuration_space.method_configuration_groups.find((group) =>
    group.method_configuration_axis.includes("location_signal_source"));
  assert.equal(bsn.method_configuration_structure, "fixed");
  assert.equal(provider.method_configuration_group_kind, "source_provider_disjunction_unresolved");
  assert.equal(provider.method_configuration_levels.length, 1);
  assert.match(provider.method_selection_semantics, /no_user_selection/);
  assert.match(provider.method_configuration_levels[0].method_configuration_level_label, /policy.*unreported/);
  const bsnIds = new Map(bsn.method_settings.map((setting) => [setting.method_parameter_key, setting.method_setting_id]));
  const bsnInvariants = new Set(bsn.method_configuration_space.invariant_method_setting_ids);
  for (const key of ["location_signal_source.gps", "location_signal_source.wifi"]) {
    assert.equal(bsnInvariants.has(bsnIds.get(key)), false);
    assert.ok(provider.unresolved_method_setting_ids.includes(bsnIds.get(key)));
  }
  assert.ok(bsnInvariants.has(bsnIds.get("location_sampling_gate")));
  assert.ok(bsnInvariants.has(bsnIds.get("location_moving_state_signal")));
  const bsnAudit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1109-bsn.2012.3.json"), "utf8"));
  const bsnAtoms = new Map(bsnAudit.disclosed_atoms.map((atom) => [atom.key, atom]));
  for (const key of ["accelerometer_sampling_mode", "location_signal_source.gps", "location_signal_source.wifi",
    "location_sampling_gate", "communication_statistics_collection_timing", "sensor_local_storage_format",
    "upload_network_gate"]) {
    const atom = bsnAtoms.get(key);
    const setting = bsn.method_settings.find((row) => row.method_parameter_key === key);
    assert.deepEqual([atom.canonical_role, atom.canonical_target,
      sourceCompletenessExecutionClass({ ...atom, source_work_id: bsnAudit.source_work_id })],
    ["acquisition", "collector", "runtime_operation"]);
    assert.deepEqual([setting.method_setting_role, setting.method_target_layer], ["acquisition", "collector"]);
  }
  for (const key of ["call_log_source", "sms_log_source"]) {
    const atom = bsnAtoms.get(key);
    assert.deepEqual([atom.canonical_role, atom.canonical_target,
      sourceCompletenessExecutionClass({ ...atom, source_work_id: bsnAudit.source_work_id })],
    ["event_schema", "raw_record", "runtime_input"]);
  }
  for (const [key, classification] of [["deployment_participant_count", "documentary_fact"],
    ["observed_client_data_volume_per_day", "scientific_oracle"]]) {
    const atom = bsnAtoms.get(key);
    const id = bsnIds.get(key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: bsnAudit.source_work_id }), classification);
    assert.equal(bsnInvariants.has(id), false);
  }

  const estar = library.profiles.find((row) => row.source_work_id === "doi:10.1145/2745844.2745875");
  const conditions = estar.method_configuration_space.method_configuration_groups.filter((group) =>
    group.method_configuration_group_kind === "conditional_joint_protocol");
  assert.equal(estar.method_configuration_structure, "conditional");
  assert.equal(conditions.length, 2);
  assert.ok(conditions.every((group) => group.method_configuration_levels.length === 1
    && group.method_selection_semantics.endsWith("no_user_selection")));
  assert.ok(estar.method_settings.some((setting) => setting.method_parameter_key === "source.screen_off_cadence_conflict"));
});

test("Figure 18 choices encode their own RTT, threshold, and delay values", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.1145-2465529.2466586.json"), "utf8"));
  for (const key of ["whatif.flow_size", "whatif.flow_start", "whatif.rtt"]) {
    const atom = audit.disclosed_atoms.find((row) => row.key === key);
    assert.equal(atom?.canonical_role, "analysis");
    assert.equal(atom?.canonical_target, "model");
  }
  assert.equal(audit.disclosed_atoms.find((row) => row.key === "whatif.rtt")?.projection_disposition,
    "configuration_metadata");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === "doi:10.1145/2465529.2466586");
  const settings = new Map(profile.method_settings.map((row) => [row.method_setting_id, row]));
  const levels = profile.method_configuration_space.method_configuration_groups.find((group) =>
    group.method_configuration_levels.length === 4).method_configuration_levels;
  assert.deepEqual(levels.map((level) => level.method_configuration_level_label), [
    "Wi-Fi delay scheduling, two-hour maximum delay",
    "Wi-Fi delay scheduling, twelve-hour maximum delay",
    "3G delay scheduling, two-hour maximum delay",
    "3G delay scheduling, twelve-hour maximum delay",
  ]);
  const branchKeys = levels.map((level) => level.included_method_setting_ids
    .map((id) => settings.get(id)?.method_parameter_key)
    .filter((key) => /^(whatif\.rtt\.|whatif\.threshold\.|whatif\.max_delay\.)/.test(key))
    .sort());
  assert.deepEqual(branchKeys, [
    ["whatif.max_delay.2h", "whatif.rtt.wifi", "whatif.threshold.wifi"],
    ["whatif.max_delay.12h", "whatif.rtt.wifi", "whatif.threshold.wifi"],
    ["whatif.max_delay.2h", "whatif.rtt.3g", "whatif.threshold.3g"],
    ["whatif.max_delay.12h", "whatif.rtt.3g", "whatif.threshold.3g"],
  ]);
  assert.equal(new Set(branchKeys.map((keys) => keys.join("|"))).size, 4);
  for (const level of levels) {
    assert.ok(level.included_method_setting_ids.every((id) =>
      settings.get(id)?.method_target_layer !== "outcome"));
  }
  for (const key of ["whatif.result.wifi", "whatif.result.3g"]) {
    const id = profile.method_settings.find((row) => row.method_parameter_key === key)?.method_setting_id;
    assert.ok(levels.some((level) => level.documentary_method_setting_ids.includes(id)));
    assert.ok(levels.every((level) => !level.included_method_setting_ids.includes(id)));
  }
});

test("HUSH campaigns and versioned evidence are not duplicate whole-paper selectors", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const hush = library.profiles.find((row) => row.source_work_id === "doi:10.1145/2789168.2790107");
  const groups = hush.method_configuration_space.method_configuration_groups;
  assert.deepEqual(groups.map((group) => group.method_configuration_axis), [
    ["device_power_model"], ["beta"], ["alpha"], ["sigma"], ["paper_system_design"], ["public_patch"],
    ["field_evaluation"], ["reported_evidence"],
  ]);
  assert.ok(groups.every((group) => group.method_configuration_levels.length === (group.method_configuration_axis[0] === "device_power_model" ? 2 : 1)
    && group.method_selection_semantics.endsWith("no_user_selection")));
  const keys = new Set(hush.method_settings.map((setting) => setting.method_parameter_key));
  assert.ok(["bfc.beta_sensitivity", "bfc.alpha_sensitivity", "hush.paper_sigma_sensitivity"]
    .every((key) => keys.has(key)));
  const idsByKey = new Map(hush.method_settings.map((setting) => [setting.method_parameter_key, setting.method_setting_id]));
  const invariants = new Set(hush.method_configuration_space.invariant_method_setting_ids);
  const indexed = groups.flatMap((group) => [
    ...group.documentary_method_setting_ids, ...group.unresolved_method_setting_ids,
  ]);
  assert.equal(new Set([...invariants, ...indexed]).size, hush.method_settings.length);
  assert.equal(invariants.size + indexed.length, hush.method_settings.length);
  assert.ok(invariants.has(idsByKey.get("hush.paper_algorithm")));
  assert.ok(["hush.code_constants", "hush.code_state_parcel_serialization", "hush.gui.live_state_conflict",
    "field.protocol", "field.table4", "hush.paper_selected_result", "study.trace_devices"]
    .every((key) => indexed.includes(idsByKey.get(key)) && !invariants.has(idsByKey.get(key))));
  const fieldGroup = groups.find((group) => group.method_configuration_axis[0] === "field_evaluation");
  assert.ok(fieldGroup.unresolved_method_setting_ids.includes(idsByKey.get("field.protocol")));
  assert.ok(fieldGroup.unresolved_method_setting_ids.includes(idsByKey.get("field.table4")));

  for (const profile of library.profiles) {
    for (const group of profile.method_configuration_space.method_configuration_groups) {
      if (group.method_configuration_levels.length < 2
        || group.method_selection_semantics === "all_source_outputs_emitted_in_parallel_no_selection"
        || group.method_selection_semantics.endsWith("no_user_selection")) continue;
      const inventories = group.method_configuration_levels.map((level) => JSON.stringify([
        level.included_method_setting_ids, level.excluded_method_setting_ids,
      ]));
      assert.equal(new Set(inventories).size, inventories.length,
        `${profile.source_work_id}: duplicate selectable setting inventories`);
    }
  }
});

test("reported results leave method invariants without removing real feature operations", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const check = (workId, key, expectedInvariant) => {
    const profile = library.profiles.find((row) => row.source_work_id === workId);
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.ok(setting, `${workId}: ${key} missing`);
    assert.equal(profile.method_configuration_space.invariant_method_setting_ids.includes(setting.method_setting_id),
      expectedInvariant);
    if (!expectedInvariant) {
      assert.ok(profile.method_configuration_space.method_configuration_groups.some((group) =>
        [...group.documentary_method_setting_ids, ...group.unresolved_method_setting_ids]
          .includes(setting.method_setting_id)));
    }
  };
  check("doi:10.1109/mprv.2015.54", "state_recognition.table1.p0101.fusion", false);
  check("doi:10.1007/978-3-642-37210-0_6", "feature.metric.home_regularity", true);
  // Warm-start run choices remain method operations; numeric cells are evidence.
  check("doi:10.1007/s00530-018-0601-1", "warm.run.mfu.slots-1-5-test-6", true);
  check("doi:10.1007/s00530-018-0601-1", "warm.result.mfu.slots-1-5-test-6", false);
  check("doi:10.1016/j.pmcj.2017.01.007", "input.context.gps", false);
  check("doi:10.1016/j.chb.2023.107977", "analysis.input.micro_a_60", true);
  check("doi:10.1002/per.2309", "cohort.final_participants", false);
  check("doi:10.1145/2745844.2745875", "cohort.device_total", false);
  check("doi:10.1145/3410530.3414441", "aggregate.table1.usage_duration", false);
  check("doi:10.1145/3410530.3414441", "metrics.usage_duration", true);
  check("doi:10.1145/2745844.2745875", "cohort.mobile_operator_conflict", false);
  check("doi:10.5555/2442691.2442720", "observation.light_result_not_presented", false);
  check("doi:10.1109/bsn.2012.3", "result.tensity.accuracy", false);
  check("doi:10.1007/978-3-319-23222-5_4", "result.other_numeric_results_omitted", false);
  check("doi:10.1007/978-3-319-23222-5_4", "analysis.result_disclosure_boundary", false);
  check("doi:10.1109/mprv.2015.54", "calls.table3_ocr_ambiguity", false);
  check("doi:10.1145/2037373.2037383", "result.application_chain_longest_duration_source_anomaly", false);
  check("doi:10.1002/per.2309", "report.stability_frequency", true);
  for (const profile of library.profiles) {
    const evidenceIds = profile.method_configuration_space.method_configuration_groups
      .filter((group) => group.method_configuration_group_kind === "source_evidence_not_method_decision")
      .flatMap((group) => [...group.documentary_method_setting_ids, ...group.unresolved_method_setting_ids]);
    const invariants = new Set(profile.method_configuration_space.invariant_method_setting_ids);
    assert.ok(evidenceIds.every((id) => !invariants.has(id)), `${profile.source_work_id}: evidence is invariant`);
  }
});

test("campaign-only operations do not leak into selectable variants", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const check = (workId, key, invariant) => {
    const profile = library.profiles.find((row) => row.source_work_id === workId);
    const id = profile.method_settings.find((row) => row.method_parameter_key === key)?.method_setting_id;
    assert.ok(id, `${workId}: ${key} missing`);
    assert.equal(profile.method_configuration_space.invariant_method_setting_ids.includes(id), invariant);
    if (!invariant) assert.ok(profile.method_configuration_space.method_configuration_groups.some((group) =>
      group.method_configuration_group_kind === "source_campaign_or_conditional_scope_unresolved"
        && group.unresolved_method_setting_ids.includes(id)));
  };
  check("doi:10.1007/s00779-012-0511-8", "storage.no_file_when_off", false);
  assert.equal(library.profiles.some((profile) => profile.source_work_id === "doi:10.1109/apnoms.2011.6077030"), true);
  check("doi:10.1145/2465529.2466586", "systemcall.predecessor", true);
  check("doi:10.1145/2465529.2466586", "validation.threshold.wifi", false);
  const s3 = library.profiles.find((profile) => profile.source_work_id === "doi:10.3390/s21113765");
  assert.ok(s3);
  const s3Alternatives = s3.method_configuration_space.method_configuration_groups
    .filter((group) => group.method_configuration_group_kind === "source_configuration_alternative");
  assert.equal(s3Alternatives.length, 1);
  assert.equal(s3Alternatives[0].method_selection_semantics, "select_exactly_one_source_declared_alternative");
  assert.equal(s3Alternatives[0].method_configuration_levels.length, 3);
  for (const profile of library.profiles) {
    const invariants = new Set(profile.method_configuration_space.invariant_method_setting_ids);
    for (const group of profile.method_configuration_space.method_configuration_groups
      .filter((group) => group.method_configuration_group_kind === "source_campaign_or_conditional_scope_unresolved")) {
      assert.equal(group.method_configuration_levels.length, 1);
      assert.ok(group.unresolved_method_setting_ids.every((id) => !invariants.has(id)));
    }
  }
});

test("keeps PathFinder click sequences distinct from app episodes and released artifacts", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === "doi:10.1109/thms.2018.2868806");
  for (const key of ["collector.output_representation", "collector.purpose"]) {
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.equal(setting.method_target_layer, "derived_feature");
    assert.equal(setting.method_implementation_status, "specification_only");
  }
  assert.equal(profile.profile_implementation_status, "blocked");
});

test("retains Langener's methodology without inventing selectable empirical presets", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const audit = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/doi-10.3758-s13428-024-02474-5.json"), "utf8"));
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  assert.equal(atoms.get("example.missingness.primary_absence_hours")?.value, 18);
  assert.equal(atoms.get("example.missingness.sensitivity_absence_hours_12")?.value, 12);
  assert.equal(atoms.get("example.missingness.sensitivity_absence_hours_24")?.value, 24);
  assert.equal(atoms.get("example.robustness_topology")?.value.cross_product,
    "not stated and must not be invented");
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  assert.ok(profile);
  const groups = profile.method_configuration_space.method_configuration_groups;
  assert.equal(groups.filter((group) => group.method_configuration_group_kind === "source_configuration_metadata").length, 4);
  assert.equal(groups.filter((group) => group.method_configuration_group_kind === "source_configuration_alternative").length, 0);
  assert.equal(groups.find((group) => group.method_selection_semantics === "source_campaign_cells_no_user_selection").method_configuration_levels.length, 8);
  const primary = profile.method_settings.find((setting) => setting.method_parameter_key === "example.missingness.primary_absence_hours");
  assert.ok(profile.method_configuration_space.invariant_method_setting_ids.includes(primary.method_setting_id));
});

test("keeps touch features and keyboard protocols distinct from documentary receipts", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  for (const [workId, auditName, keys] of [
    ["doi:10.1145/3490100.3516456", "doi-10.1145-3490100.3516456.json", [
      "features.touch_event_time", "features.displacement_magnitude"]],
    ["doi:10.1145/2406367.2406384", "doi-10.1145-2406367.2406384.json", [
      "study.design", "usability.entry_time", "shoulder.attempt_limit"]],
  ]) {
    const audit = JSON.parse(readFileSync(resolve(directory, "source-completeness-audits", auditName), "utf8"));
    const profile = library.profiles.find((row) => row.source_work_id === workId);
    assert.ok(profile);
    for (const key of keys) {
      const atom = audit.disclosed_atoms.find((row) => row.key === key);
      assert.ok(atom);
      const setting = profile.method_settings.find((row) => row.method_setting_id === atom.projected_method_setting_id);
      assert.ok(setting, `${workId} ${key}`);
      assert.equal(setting.method_parameter_key, key);
      assert.equal(setting.method_setting_role, atom.canonical_role);
      assert.equal(setting.method_target_layer, atom.canonical_target);
      assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
      assert.equal(setting.method_implementation_status, "specification_only");
    }
  }
  const touch = library.profiles.find((row) => row.source_work_id === "doi:10.1145/3490100.3516456");
  const unit = touch.method_settings.find((row) => row.method_setting_id === "method-setting-8d5e625457005a75de903856");
  assert.equal(unit.method_parameter_key, "touch_time_unit");
  assert.equal(JSON.parse(unit.method_value_json), "milliseconds");
  const touchAudit = JSON.parse(readFileSync(resolve(directory, "source-completeness-audits",
    "doi-10.1145-3490100.3516456.json"), "utf8"));
  const touchAtoms = new Map(touchAudit.disclosed_atoms.map((atom) => [atom.key, atom]));
  const questionnaireResult = touchAtoms.get("result.questionnaire_item_means");
  assert.equal(sourceCompletenessExecutionClass(questionnaireResult), "scientific_oracle");
  for (const key of ["study.questionnaire", "result.questionnaire_item_means"]) {
    const atom = touchAtoms.get(key);
    const setting = touch.method_settings.find((row) => row.method_parameter_key === key);
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
    assert.equal(setting.method_implementation_status, "specification_only");
  }
  assert.equal(touchAtoms.get("study.questionnaire").value.items.length, 10);
  assert.deepEqual(questionnaireResult.value.items.map((item) => item.average_score),
    ["3.0", "3.0", "4.0", "3.0", "3.0", "3.0", "3.5", "3.0", "3.0", "4.0"]);
  for (const key of ["features.count", "features.device_acceleration", "features.motion_axes"]) {
    assert.deepEqual([touchAtoms.get(key).canonical_role, touchAtoms.get(key).canonical_target],
      ["feature_engineering", "derived_feature"], key);
  }
  for (const key of ["features.velocity_time_unit", "features.touch_event_definition_missing",
    "unsupervised.status"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...touchAtoms.get(key),
      source_work_id: touchAudit.source_work_id }), "source_gap_or_conflict", key);
  }
  assert.match(touchAtoms.get("features.velocity_time_unit").value, /does not specify a velocity-magnitude unit/);
  assert.equal(touchAtoms.get("shapes.composite").canonical_target, "collector");
  for (const [key, target] of [["shapes.count", "collector"], ["features.motion_axes", "derived_feature"]]) {
    const atom = touchAtoms.get(key);
    const projected = touch.method_settings.find((row) => row.method_setting_id === atom.projected_method_setting_id);
    assert.equal(projected.method_parameter_key, key);
    assert.equal(projected.method_target_layer, target);
    assert.equal(projected.method_implementation_status, "specification_only");
  }
});

test("preserves native bindings while projecting source-typed session rules", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  for (const [workId, auditName, key] of [
    ["doi:10.1016/j.smhl.2020.100137", "doi-10.1016-j.smhl.2020.100137.json", "reconstruction.screen_interval_cap"],
    ["doi:10.1016/j.psychres.2023.115298", "doi-10.1016-j.psychres.2023.115298.json", "schema.screen_time_period"],
    ["doi:10.1186/s13104-015-1280-z", "doi-10.1186-s13104-015-1280-z.json", "quality.app_session"],
    ["doi:10.30773/pi.2020.0197", "doi-10.30773-pi.2020.0197.json", "objective.drop"],
  ]) {
    const audit = JSON.parse(readFileSync(resolve(directory, "source-completeness-audits", auditName), "utf8"));
    const atom = audit.disclosed_atoms.find((row) => row.key === key);
    const profile = library.profiles.find((row) => row.source_work_id === workId);
    const setting = profile.method_settings.find((row) => row.method_setting_id === atom.projected_method_setting_id);
    assert.equal(atom.project_source_semantics, true);
    assert.equal(setting.method_parameter_key, key);
    assert.equal(setting.method_setting_role, atom.canonical_role);
    assert.equal(setting.method_target_layer, atom.canonical_target);
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
    assert.equal(setting.method_implementation_status, "native");
    assert.equal(setting.method_execution_route, "native_option_binding");
    assert.ok(setting.contract_bindings.length);
  }
});

test("does not promote an unresolved mounted repository route as documentary proof", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === "doi:10.1177/00936502241276793");
  const route = profile.method_settings.find((row) =>
    row.method_setting_id === "method-setting-ba42e53a2bb684a034aa67e0");
  assert.equal(route.method_implementation_status, "specification_only");
  assert.equal(route.method_execution_blocker_code, "receipt_binding_unimplemented");
});

test("preserves source meaning when a legacy execution receipt was not equivalent", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const library = JSON.parse(readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8"));
  const setting = (workId, id) => library.profiles.find((row) => row.source_work_id === workId)
    .method_settings.find((row) => row.method_setting_id === id);
  const eligibility = setting("doi:10.4000/questionsdecommunication.9851", "method-setting-9da3ee68fd7b55a6c9ef5472");
  assert.deepEqual(JSON.parse(eligibility.method_value_json), { probe_running_days: ">14", questionnaire_required: true });
  assert.equal(eligibility.method_implementation_status, "specification_only");
  for (const id of ["method-setting-396050a5f160c010634e9bbd", "method-setting-27297b60be01dc56a7fdb4a0"]) {
    const event = setting("doi:10.4000/questionsdecommunication.9851", id);
    assert.equal(event.method_target_layer, "raw_occurrence");
    assert.equal(event.method_implementation_status, "specification_only");
  }
  const collectorLimit = setting("doi:10.30773/pi.2020.0197", "method-setting-1277d5c9136a68de683cce1e");
  assert.equal(collectorLimit.method_target_layer, "collector");
  assert.equal(collectorLimit.method_execution_route, "receipt_conformance");
  assert.equal(collectorLimit.method_execution_destination_id, "chronicle.profile-protocol-documentary-registry");
  assert.deepEqual(collectorLimit.contract_bindings, []);
  const crossAppClosure = setting("doi:10.30773/pi.2020.0197", "method-setting-fd648b88ec7bfcbbdfeaed7a");
  assert.equal(crossAppClosure.method_parameter_key, "objective.duration");
  assert.equal(crossAppClosure.method_implementation_status, "specification_only");
  assert.deepEqual(crossAppClosure.contract_bindings, []);
  const shortIntervalExclusion = setting("doi:10.30773/pi.2020.0197", "method-setting-049dd0939adfb6d6fea7b4ff");
  assert.equal(shortIntervalExclusion.method_parameter_key, "objective.drop");
  assert.equal(shortIntervalExclusion.method_implementation_status, "native");
  assert.equal(sourceCompletenessExecutionClass({ source_work_id: "doi:10.30773/pi.2020.0197",
    key: "objective.drop" }), "runtime_operation");
  const classroom = library.profiles.find((row) => row.source_work_id === "doi:10.30773/pi.2020.0197");
  for (const [key, role, target] of [
    ["collection.foreground_definition", "acquisition", "collector"],
    ["collection.storage", "acquisition", "collector"],
    ["collection.upload", "acquisition", "collector"],
    ["objective.weekly", "aggregation", "derived_feature"],
    ["selfreport.fields", "participant_schema", "participant_measure"],
    ["selfreport.weekly_formula", "aggregation", "derived_feature"],
    ["analysis.attribution_limit", "provenance", "participant_measure"],
  ]) {
    const row = classroom.method_settings.find((item) => item.method_parameter_key === key);
    assert.deepEqual([row?.method_setting_role, row?.method_target_layer], [role, target], key);
  }
  assert.match(JSON.parse(classroom.method_settings.find((row) =>
    row.method_parameter_key === "collection.events").method_value_json).record_kind, /not a disclosed native Android UsageEvents/);
  assert.match(JSON.parse(classroom.method_settings.find((row) =>
    row.method_parameter_key === "analysis.zero_web").method_value_json).observed, /not proof of zero actual browsing/);
  const observedResult = setting("doi:10.30773/pi.2020.0197", "method-setting-91af19272f25e651a2bd88f7");
  assert.equal(observedResult.method_target_layer, "outcome");
  assert.equal(observedResult.method_implementation_status, "specification_only");
  const expansion = setting("doi:10.1037/emo0001485", "method-setting-66b78a5d5b22a7c6e3d3668c");
  assert.equal(expansion.method_target_layer, "derived_feature");
  assert.equal(expansion.method_implementation_status, "native");
  const notifications = library.profiles.find((row) => row.source_work_id === "doi:10.1145/3131901");
  assert.ok(!notifications.method_settings.some((row) => row.method_setting_id === "method-setting-96a4a59aa8407a3520cfa1a7"));
  for (const key of ["schema.app.launch_foreground_time", "schema.app.background_time", "schema.phone.lock_unlock_time"]) {
    const event = notifications.method_settings.find((row) => row.method_parameter_key === key);
    assert.equal(event.method_target_layer, "raw_occurrence");
    assert.equal(event.method_implementation_status, "specification_only");
  }
  const phoneOutcomes = setting("doi:10.1037/pspp0000469", "method-setting-da2ee60471ce180dbf10dc33");
  assert.deepEqual(JSON.parse(phoneOutcomes.method_value_json).reported_call_outcomes,
    ["outgoing", "incoming", "missed", "rejected"]);
  assert.equal(phoneOutcomes.method_implementation_status, "specification_only");
  const phoneJoin = setting("doi:10.1037/pspp0000469", "method-setting-faf89bac61ad22df438c751c");
  assert.equal(phoneJoin.method_setting_role, "reconstruction");
  assert.equal(phoneJoin.method_target_layer, "raw_record");
  assert.equal(phoneJoin.conformance_fixture_id, "literature-input.phonestudy-ps-communication-id-left-join-boundary.v1");
});

test("keeps prefetch energy benchmarks out of Android event schemas", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const audit = JSON.parse(readFileSync(resolve(directory,
    "source-completeness-audits/doi-10.1145-2493432.2493490.json"), "utf8"));
  const library = JSON.parse(readFileSync(resolve(directory,
    "adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  assert.ok(profile);
  for (const [key, role, target] of [
    ["benchmark.live_feed_apps", "validation", "model"],
    ["benchmark.baseline_power", "feature_engineering", "derived_feature"],
  ]) {
    const atom = audit.disclosed_atoms.find((row) => row.key === key);
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.equal(atom.canonical_role, role);
    assert.equal(atom.canonical_target, target);
    assert.equal(setting.method_setting_role, role);
    assert.equal(setting.method_target_layer, target);
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
    assert.equal(setting.method_implementation_status, "specification_only");
  }
});

test("preserves prompt and time-feature boundaries in retained profiles", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  const audit = (name) => JSON.parse(readFileSync(resolve(directory, "source-completeness-audits", name), "utf8"));
  const schedules = audit("doi-10.1016-j.smhl-2018-07-005.json");
  const scheduleProfile = library.profiles.find((row) => row.source_work_id === schedules.source_work_id);
  for (const atom of schedules.disclosed_atoms.filter((row) => row.target === "ema_prompt")) {
    const setting = scheduleProfile.method_settings.find((row) => row.method_parameter_key === atom.key);
    assert.equal(atom.canonical_target, "collector");
    assert.equal(setting.method_target_layer, "collector");
    assert.equal(setting.method_implementation_status, "specification_only");
  }
  assert.deepEqual(schedules.external_full_text.unverified_sensor_cadence_claim.gps_seconds, 150);
  assert.deepEqual(schedules.external_full_text.unverified_sensor_cadence_claim.accelerometer_hz, 1);
  for (const key of ["collector.gps_cadence", "collector.accelerometer_cadence"]) {
    const atom = schedules.disclosed_atoms.find((row) => row.key === key);
    const setting = scheduleProfile.method_settings.find((row) => row.method_parameter_key === key);
    assert.equal(atom.role, "evidence_gap");
    assert.equal(atom.canonical_role, "provenance");
    assert.equal(setting.method_setting_role, "provenance");
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
    assert.match(atom.value.cadence, /not established by pinned codebook/);
    assert.equal(setting.method_implementation_status, "specification_only");
  }
  const monitoring = schedules.disclosed_atoms.find((row) => row.key === "study.monitoring_duration");
  const monitoringSetting = scheduleProfile.method_settings.find((row) => row.method_parameter_key === monitoring.key);
  assert.deepEqual(JSON.parse(monitoringSetting.method_value_json), monitoring.value);
  assert.equal(monitoring.value.app_monitoring_instruction_days, 14);
  assert.equal(schedules.external_full_text.unverified_monitoring_duration_claim.observed_mean_days, 16.41);
  for (const key of ["study.participant_id", "input.demographics_schema", "input.lab_schema", "measure.sias", "measure.dass_depression", "measure.panas"]) {
    const atom = schedules.disclosed_atoms.find((row) => row.key === key);
    const setting = scheduleProfile.method_settings.find((row) => row.method_parameter_key === key);
    assert.equal(atom.canonical_role, "participant_schema");
    assert.equal(setting.method_setting_role, "participant_schema");
    assert.equal(setting.method_target_layer, key.startsWith("measure.") ? "participant_measure" : "participant_record");
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
    assert.equal(setting.method_implementation_status, "specification_only");
  }
  const labHeader = readFileSync(resolve(repo,
    ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/artifacts/doi-10.1016-j.smhl-2018-07-005/Lab_measures.csv"), "utf8").split(/\r?\n/)[0];
  assert.deepEqual(schedules.disclosed_atoms.find((row) => row.key === "input.lab_schema").value, labHeader.split(","));
  assert.equal(schedules.external_full_text.unverified_lab_measure_detail_claims.sias.items, 20);
  const nextApp = audit("doi-10.1007-s42486-020-00045-z.json");
  const nextAppProfile = library.profiles.find((row) => row.source_work_id === nextApp.source_work_id);
  for (const key of ["time.day_bins", "time.bin_encoding"]) {
    const atom = nextApp.disclosed_atoms.find((row) => row.key === key);
    const setting = nextAppProfile.method_settings.find((row) => row.method_parameter_key === key);
    assert.equal(setting.method_target_layer, "derived_feature");
    assert.deepEqual(atom.source_execution_unit_ids.slice().sort(), nextApp.configuration_verdicts
      .filter((row) => row.atom_keys.includes(key)).map((row) => row.source_configuration_id).sort());
    assert.ok(!atom.source_execution_unit_ids.includes("next-app:delta:context:none"));
    assert.ok(!atom.source_execution_unit_ids.includes("next-app:topk:k1"));
    assert.ok(!nextAppProfile.method_configuration_space.invariant_method_setting_ids.includes(setting.method_setting_id));
  }
  const campaignCells = nextAppProfile.method_configuration_space.method_configuration_groups
    .filter((group) => group.method_configuration_group_kind === "source_campaign_model_cell");
  assert.equal(campaignCells.length, 19);
  for (const key of ["observation.app_count.statistics", "observation.temporal.output",
    "observation.spatial.output", "topk.all_user_outputs"]) {
    const atom = nextApp.disclosed_atoms.find((row) => row.key === key);
    const setting = nextAppProfile.method_settings.find((row) => row.method_parameter_key === key);
    assert.equal(atom.role, "reporting");
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: nextApp.source_work_id }), "runtime_operation");
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
  }
  assert.match(nextApp.disclosed_atoms.find((row) => row.key === "observation.app_count.statistics").value, /green mean marker/);
  assert.match(nextApp.disclosed_atoms.find((row) => row.key === "topk.all_user_outputs").value,
    /medians with red dotted lines, means with diamonds, and outliers with red dots/);
  for (const key of ["observation.app_count.mean", "observation.temporal.pattern_result",
    "observation.spatial.pattern_result"]) {
    const atom = nextApp.disclosed_atoms.find((row) => row.key === key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: nextApp.source_work_id }), "scientific_oracle");
    assert.ok(nextApp.configuration_verdicts.some((row) => row.atom_keys.includes(key)
      && !row.branch_atom_keys?.includes(key)));
  }
  assert.equal(sourceCompletenessExecutionClass({
    ...nextApp.disclosed_atoms.find((row) => row.key === "topk.label"), source_work_id: nextApp.source_work_id,
  }), "runtime_operation");
  for (const key of ["topk.across_k.accuracy_trend", "topk.across_k.dispersion_trend"]) {
    const atom = nextApp.disclosed_atoms.find((row) => row.key === key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: nextApp.source_work_id }), "scientific_oracle");
    assert.equal(nextApp.configuration_verdicts.filter((row) => row.atom_keys.includes(key)).length, 5);
    assert.ok(nextApp.configuration_verdicts.every((row) => !row.branch_atom_keys?.includes(key)));
  }
  for (const verdict of nextApp.configuration_verdicts.filter((row) => row.branch_atom_keys)) {
    const cell = campaignCells.find((group) => group.method_configuration_axis.includes(verdict.source_configuration_id));
    assert.ok(cell);
    const declared = new Set(verdict.branch_atom_keys.map((key) => nextAppProfile.method_settings
      .find((setting) => setting.method_parameter_key === key).method_setting_id));
    const level = cell.method_configuration_levels[0];
    const methodIds = new Set(level.branch_method_setting_ids);
    assert.ok([...methodIds].every((id) => declared.has(id)));
    assert.deepEqual(new Set([...methodIds, ...level.documentary_method_setting_ids,
      ...level.unresolved_method_setting_ids]), declared);
  }
  for (const key of ["feature.pca_method", "metric.multilabel.f1"]) {
    const atom = nextApp.disclosed_atoms.find((row) => row.key === key);
    const setting = nextAppProfile.method_settings.find((row) => row.method_parameter_key === key);
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
    assert.equal(setting.method_implementation_status, "specification_only");
  }
});

test("keeps participant demographics and one-time instruments out of event and diary schemas", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  for (const [file, keys] of [
    ["doi-10.1038-s41598-019-47493-x.json", ["input.demographic_stream"]],
    ["doi-10.1186-s13104-015-1280-z.json", ["input.demographics", "input.personality_instrument", "input.personality_items"]],
  ]) {
    const audit = JSON.parse(readFileSync(resolve(directory, "source-completeness-audits", file), "utf8"));
    const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
    assert.ok(profile);
    for (const key of keys) {
      const atom = audit.disclosed_atoms.find((row) => row.key === key);
      const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
      assert.equal(atom.canonical_role, "participant_schema");
      assert.equal(setting.method_setting_role, "participant_schema");
      assert.equal(setting.method_target_layer, key.includes("personality") ? "participant_measure" : "participant_record");
      assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
      assert.equal(setting.method_implementation_status, "specification_only");
    }
    if (audit.non_projected_demographic_observation) {
      assert.equal(audit.non_projected_demographic_observation.age_coverage_percent, 92.6);
      assert.deepEqual(audit.disclosed_atoms.find((row) => row.key === "input.demographic_stream").value,
        { fields: ["ID", "self-reported age"] });
    }
  }
});

test("keeps Moodable's one-time survey and PHQ-9 apart from Android event rows", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const audit = JSON.parse(readFileSync(resolve(directory,
    "source-completeness-audits/doi-10.1016-j.smhl-2020-100118.json"), "utf8"));
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  assert.ok(profile);
  for (const key of ["study1.demographics", "study1.response_scale", "study1.modalities",
    "study1.robot_check", "study1.feedback", "ground_truth.PHQ9"]) {
    const atom = audit.disclosed_atoms.find((row) => row.key === key);
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.equal(atom.canonical_role, "participant_schema");
    assert.equal(setting.method_setting_role, "participant_schema");
    assert.equal(setting.method_target_layer, key === "study1.demographics" ? "participant_record" : "participant_measure");
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
    assert.equal(setting.method_implementation_status, "specification_only");
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "runtime_input");
  }
  const robotCheck = audit.disclosed_atoms.find((row) => row.key === "study1.robot_check");
  assert.equal(robotCheck.value, "repeat age question at survey end");
  const eligibility = audit.disclosed_atoms.find((row) => row.key === "study1.eligibility");
  assert.equal(eligibility.canonical_target, "participant_record");
  assert.equal(eligibility.value.operational_boundary, "not otherwise specified");
  assert.equal(sourceCompletenessExecutionClass({ ...eligibility, source_work_id: audit.source_work_id }), "runtime_operation");
  const source = new Map(audit.disclosed_atoms.map((row) => [row.key, row]));
  assert.equal(source.get("study1.modalities").value.complete_questionnaire_inventory, "unreported");
  assert.match(source.get("study2.permission_workflow").value, /interactively/);
  assert.equal(source.get("collector.local_sources").value.raw_event_schema, "unreported");
  assert.equal(source.get("collector.local_sources").canonical_target, "collector");
  for (const key of ["collector.local_sources", "feature.call_frequency", "feature.text_sentiment", "feature.text_frequency"]) {
    const atom = source.get(key);
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.equal(setting.method_target_layer, atom.canonical_target);
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
  }
  assert.equal(source.get("feature.text_frequency").value.output_unit, "one participant-level prediction vector");
  assert.equal(audit.configuration_verdicts.find((row) => row.configuration_id === "moodable:study1-willingness-chi-square")
    .configuration_unit_kind, "campaign_internal_job_model_cell");
});

test("keeps AWARE's baseline questionnaire on participant records, not Android event rows", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const audit = JSON.parse(readFileSync(resolve(directory,
    "source-completeness-audits/doi-10.1007-s41347-024-00443-5.json"), "utf8"));
  const atom = audit.disclosed_atoms.find((row) => row.key === "baseline.demographics_and_subjective_status");
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  const setting = profile.method_settings.find((row) => row.method_parameter_key === atom.key);
  assert.equal(atom.locator, "61-adolescent-social-media-aware.txt:189-225");
  assert.equal(atom.role, "input_schema");
  assert.equal(atom.canonical_role, "participant_schema");
  assert.equal(atom.canonical_target, "participant_record");
  assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "runtime_input");
  assert.equal(setting.method_setting_role, "participant_schema");
  assert.equal(setting.method_target_layer, "participant_record");
  assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
  assert.equal(setting.method_implementation_status, "specification_only");
});

test("keeps StudentLife pre/post assessments separate from repeated phone EMA", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const audit = JSON.parse(readFileSync(resolve(directory,
    "source-completeness-audits/doi-10.1007-978-3-319-51394-2_2.json"), "utf8"));
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  const expected = new Map([
    ["study.pre_post_design", ["acquisition", "participant_record", "runtime_operation"]],
    ["study.survey_platform", ["acquisition", "participant_measure", "runtime_operation"]],
    ["survey.timing", ["acquisition", "participant_measure", "runtime_operation"]],
    ...["survey.instruments", "survey.phq9_scale", "survey.pss_scale",
      "survey.flourishing_scale", "survey.loneliness_scale"].map((key) =>
      [key, ["participant_schema", "participant_measure", "runtime_input"]]),
  ]);
  for (const [key, [role, target, executionClass]] of expected) {
    const atom = audit.disclosed_atoms.find((row) => row.key === key);
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.ok(atom.locator.includes("rank280-primary.txt:"));
    assert.equal(atom.canonical_role, role);
    assert.equal(atom.canonical_target, target);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), executionClass);
    assert.equal(setting.method_setting_role, role);
    assert.equal(setting.method_target_layer, target);
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
    assert.equal(setting.method_implementation_status, "specification_only");
  }
  for (const key of ["ema.schedule_basis", "ema.state_content", "ema.instruments"]) {
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.equal(setting.method_setting_role, "diary_schema");
    assert.equal(setting.method_target_layer, "diary_item");
  }
});

test("keeps Carat's PHQ-8 and demographics on participant records and measures", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const audit = JSON.parse(readFileSync(resolve(directory,
    "source-completeness-audits/doi-10.2196-26540.json"), "utf8"));
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  const expected = new Map([
    ["schema.demographics", ["participant_schema", "participant_record", "runtime_input"]],
    ["phq8.cadence", ["acquisition", "participant_measure", "runtime_operation"]],
    ...["phq8.recall_window", "phq8.item_scale", "phq8.total_range"].map((key) =>
      [key, ["participant_schema", "participant_measure", "runtime_input"]]),
  ]);
  for (const [key, [role, target, executionClass]] of expected) {
    const atom = audit.disclosed_atoms.find((row) => row.key === key);
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.ok(atom.locator.includes("text/100.txt:"));
    assert.equal(atom.canonical_role, role);
    assert.equal(atom.canonical_target, target);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), executionClass);
    assert.equal(setting.method_setting_role, role);
    assert.equal(setting.method_target_layer, target);
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
    assert.equal(setting.method_implementation_status, "specification_only");
  }
  assert.equal(profile.method_settings.find((row) => row.method_parameter_key === "phq8.binary_threshold")
    .method_setting_role, "analysis");
});

test("keeps one-time online-vigilance intake and exit surveys apart from daily ESM", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const audit = JSON.parse(readFileSync(resolve(directory,
    "source-completeness-audits/doi-10.1080-15213269-2020-1768122.json"), "utf8"));
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  for (const key of ["procedure.intake_survey", "procedure.exit_survey"]) {
    const atom = audit.disclosed_atoms.find((row) => row.key === key);
    const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
    assert.ok(atom.locator.includes("#lines="));
    assert.equal(atom.canonical_role, "acquisition");
    assert.equal(atom.canonical_target, "participant_record");
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "runtime_operation");
    assert.equal(setting.method_setting_role, "acquisition");
    assert.equal(setting.method_target_layer, "participant_record");
    assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
  }
  const dailySurvey = profile.method_settings.find((row) => row.method_parameter_key === "procedure.esm.schedule");
  assert.equal(dailySurvey.method_setting_role, "diary_schema");
  assert.equal(dailySurvey.method_target_layer, "diary_response");
});

test("separates one-time participant measures and observed case data from diary methods", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  const cases = [
    ["doi-10.1016-j.compedu.2019.103611.json", [
      ...["diary.post_study_self_report", "diary.post_study_sas_grades"].map((key) =>
        [key, "participant_schema", "participant_measure", "runtime_input"]),
    ], ["diary.weekly_class_report", "diary_schema", "diary_item"]],
    ["doi-10.1109-socialcom.2013.118.json", [
      ...["collection.stream.personality", "labels.big_five_items", "labels.big_five_scale"].map((key) =>
        [key, "participant_schema", "participant_measure", "runtime_input"]),
    ], ["collection.stream.daily_happiness", "diary_schema", "diary_response"]],
    ["doi-10.1109-percomw.2015.7134065.json", [
      ["questionnaire.modes", "acquisition", "participant_record", "runtime_operation"],
      ...["questionnaire.formats", "questionnaire.domains"].map((key) =>
        [key, "participant_schema", "participant_record", "runtime_input"]),
      ["questionnaire.no_routine_popup", "acquisition", "participant_measure", "runtime_operation"],
      ["selection.complete_questionnaire", "quality_control", "participant_record", "runtime_operation"],
      ...["user30.survey_context", "user1.survey_context"].map((key) =>
        [key, "reporting", "participant_record", "scientific_oracle"]),
    ], null],
  ];
  for (const [file, expectations, preserved] of cases) {
    const audit = JSON.parse(readFileSync(resolve(directory, "source-completeness-audits", file), "utf8"));
    const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
    assert.ok(profile, audit.source_work_id);
    for (const [key, role, target, executionClass] of expectations) {
      const atom = audit.disclosed_atoms.find((row) => row.key === key);
      const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
      assert.ok(atom.locator && setting.source_locators.length > 0, `${audit.source_work_id}: ${key}`);
      assert.equal(atom.canonical_role, role);
      assert.equal(atom.canonical_target, target);
      assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), executionClass);
      assert.equal(setting.method_setting_role, role);
      assert.equal(setting.method_target_layer, target);
      assert.deepEqual(JSON.parse(setting.method_value_json), atom.value);
      assert.equal(setting.method_implementation_status, "specification_only");
    }
    if (preserved) {
      const [key, role, target] = preserved;
      const setting = profile.method_settings.find((row) => row.method_parameter_key === key);
      assert.equal(setting.method_setting_role, role);
      assert.equal(setting.method_target_layer, target);
    }
  }
  const percom = library.profiles.find((row) => row.source_work_id === "doi:10.1109/percomw.2015.7134065");
  const observed = percom.method_settings.filter((row) => ["user30.survey_context", "user1.survey_context"]
    .includes(row.method_parameter_key));
  assert.ok(observed.every((row) => !percom.method_configuration_space.invariant_method_setting_ids
    .includes(row.method_setting_id)));
  assert.deepEqual(JSON.parse(observed.find((row) => row.method_parameter_key === "user1.survey_context").method_value_json),
    { gender: "female", age: 19, field: "Communication and Media studies" });
  assert.match(percom.method_settings.find((row) => row.method_parameter_key === "user1.contextual_inference")
    .method_value_json, /probably in her second year/);
});

test("keeps the 2020 phone-sensing reanalysis results, labels, and PD model arms distinct", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831");
  const audit = JSON.parse(readFileSync(resolve(directory,
    "source-completeness-audits/source-ref-e2014b2268ac2833bb8e.json"), "utf8"));
  const library = JSON.parse(readFileSync(resolve(directory, "adjudicated-method-profile-library.json"), "utf8"));
  const profile = library.profiles.find((row) => row.source_work_id === audit.source_work_id);
  assert.ok(profile);
  const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
  const settings = new Map(profile.method_settings.map((setting) => [setting.method_parameter_key, setting]));
  assert.equal(audit.title.includes("2014"), false);
  assert.equal(audit.disclosed_atoms.filter((atom) => atom.role === "reported_result").length, 14);
  for (const atom of audit.disclosed_atoms.filter((row) => row.role === "reported_result")) {
    const setting = settings.get(atom.key);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "scientific_oracle");
    assert.equal(setting.method_setting_role, "reporting");
    assert.equal(setting.method_target_layer, "outcome");
    assert.ok(!profile.method_configuration_space.invariant_method_setting_ids.includes(setting.method_setting_id));
  }
  for (const key of ["pd.us.labels", "pd.turkish.labels"]) {
    assert.equal(atoms.get(key).canonical_role, "participant_schema");
    assert.equal(atoms.get(key).canonical_target, "participant_measure");
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }), "runtime_input");
    assert.equal(settings.get(key).method_target_layer, "participant_measure");
  }
  assert.deepEqual(atoms.get("outcome.depression.phq9_threshold").value, {
    measure: "PHQ-9 score", depressed: { comparator: ">=", threshold: 10 },
    not_depressed: { comparator: "<", threshold: 10 },
  });
  for (const [key, comparator] of [["outcome.trend.worsening", ">="], ["outcome.trend.improving", "<"]]) {
    assert.equal(atoms.get(key).value.comparator, comparator);
    assert.equal(atoms.get(key).value.threshold, 0);
    assert.equal(atoms.get(key).value.difference_direction, null);
  }
  for (const [id, key] of [
    ["brain:pd:turkish:naive", "pd.turkish.naive"],
    ["brain:pd:turkish:feature-averaging", "pd.turkish.feature_averaging"],
    ["brain:pd:turkish:probability-averaging", "pd.turkish.probability_averaging"],
  ]) {
    const verdict = audit.configuration_verdicts.find((row) => row.source_configuration_id === id);
    assert.deepEqual(verdict.branch_atom_keys, [key]);
    const group = profile.method_configuration_space.method_configuration_groups.find((row) =>
      row.method_configuration_axis.includes(id));
    assert.deepEqual(group.method_configuration_levels[0].branch_method_setting_ids, [settings.get(key).method_setting_id]);
  }
  for (const [key, target] of [
    ["studentlife.cohort.analyzed_students", "participant_record"],
    ["studentlife.window.weeks", "study_window"],
    ["studentlife.platform.android_nexus", "collector"],
    ["demonicsalmon.cohort.students", "participant_record"],
    ["demonicsalmon.window.weeks", "study_window"],
    ["demonicsalmon.platform", "collector"],
    ["lsp.experiment.cohort", "participant_record"],
    ["pd.us.cohort.people", "participant_record"],
    ["pd.us.cohort.pd_people", "participant_record"],
    ["pd.us.recordings", "acquired_snapshot"],
    ["pd.us.recording_duration", "acquired_snapshot"],
    ["pd.turkish.cohort.people", "participant_record"],
    ["pd.turkish.cohort.pd_people", "participant_record"],
    ["pd.turkish.recordings", "acquired_snapshot"],
    ["pd.turkish.recording_duration", "acquired_snapshot"],
  ]) {
    const atom = atoms.get(key);
    assert.equal(atom.canonical_role, "provenance");
    assert.equal(atom.canonical_target, target);
    assert.equal(sourceCompletenessExecutionClass({ ...atom, source_work_id: audit.source_work_id }), "documentary_fact");
    assert.equal(settings.get(key).method_target_layer, target);
  }
  assert.deepEqual(atoms.get("lsp.experiment.cohort").value,
    { analyzed_students: 40, depressed_students: 17 });
  assert.deepEqual(atoms.get("lsp.experiment.leave_one_out_training").value,
    { protocol: "leave-one-out cross-validation", training_examples_per_fold: 39 });
  assert.equal(sourceCompletenessExecutionClass({
    ...atoms.get("lsp.experiment.leave_one_out_training"), source_work_id: audit.source_work_id,
  }), "runtime_operation");
  for (const key of ["ifll.refinement.software_and_seed", "studentlife.canzian.exact_code_version",
    "studentlife.wang.exact_code_version"]) {
    assert.equal(sourceCompletenessExecutionClass({ ...atoms.get(key), source_work_id: audit.source_work_id }),
      "source_gap_or_conflict");
  }
  assert.equal(atoms.get("demonicsalmon.release.deidentified_passive_outputs").value
    .complete_68_person_passive_release_verified, null);
  for (const key of ["demonicsalmon.release.completeness", "ablation.studentlife.no_cartesian_product"]) {
    assert.ok(!atoms.has(key));
    assert.ok(!settings.has(key));
  }
});
