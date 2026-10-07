// Rodrigues et al., DOI10.1145/3491102.3501908, p5§3.1.2 and released CSV.
// Synthetic cells/identities; no participant row or recovered source trial key.
const owner = { method_profile_id: "profile:derived-typing-example", source_work_id: "doi:10.1145/3491102.3501908", participant_id: "constructed-participant", record_origin: "analyst_constructed_example" };
const columns = ["P", "Task", "Index", "written-characters", "words-per-minute", "total-error-rate", "corrected-error-rate", "uncorrected-error-rate", "avg_flight_time", "avg_holdtime", "select-suggestions", "auto-correct", "action-count", "correction-action-count", "entry-action-count", "timeSpent", "timeofDay", "TaskType"];
const setting = (id: string, role: string, target: string, value: unknown) => ({ method_setting_id: id, source_extraction_id: `source:${id}`, method_setting_role: role, method_target_layer: target, method_value_json: JSON.stringify(value), method_applicability_status: "applicable", method_disclosure_status: "declared_partial", method_implementation_status: "specification_only", contract_bindings: [], source_locators: ["physicalp5§3.1.2; released CSV header"] });
export const derivedTypingTrialExample = {
  profiles: [{ method_profile_id: owner.method_profile_id, source_work_id: owner.source_work_id, source_method_variant_id: "passive-derived-records", method_configuration_structure: "fixed", method_profile_version: "constructed-example-v1", profile_implementation_status: "blocked", method_settings: [
    setting("setting:trial-lifecycle", "reconstruction", "text_entry_trial", { start: "first letter typed after keyboard opening", end: "keyboard closure", pause_split: null }),
    setting("setting:released-columns", "event_schema", "analysis_record_set", { columns }),
  ] }],
  typing_trials: [1, 2].map(ordinal => ({ ...owner, typing_trial_id: `constructed-record-${ordinal}`, trial_representation: "derived_metrics", trial_lifecycle_setting_reference: "setting:trial-lifecycle", trial_schema_setting_reference: "setting:released-columns", released_values_json: JSON.stringify(Object.fromEntries(columns.map(column => [column, column === "P" ? "constructed-participant" : column === "Task" ? "implicit" : column === "Index" ? "0" : column === "timeSpent" ? `${ordinal}.00` : "0"]))), source_locators: [`constructed data-record ordinal ${ordinal}; no original row claimed`] })),
};
