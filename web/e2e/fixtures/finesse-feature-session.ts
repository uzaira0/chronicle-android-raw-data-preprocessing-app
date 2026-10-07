// Analyst-constructed normalized examples, NOT participant rows or recovered
// Finesse serialization. No session/feature timing or regret label is inferred.
export function finesseFeatureSessionExample() {
  const work = "doi:10.1145/3479600";
  const locator = "Finesse author-hosted published-layout PDF p8 Section3.3, Figure1 p3; SHA256:a176dc1cb83b1a31b57bbbd0663207a6152ca9f33a0fa578e00b9fba5337bc8a";
  const profileId = "example:finesse-feature-occurrences";
  const profiles = [{
    method_profile_id: profileId, source_work_id: work,
    source_method_variant_id: "example:normalized-feature-selection-not-deployed-build",
    method_profile_version: "normalized-example-v1", method_configuration_structure: "fixed",
    profile_implementation_status: "specification_only", source_locators: [locator],
    method_settings: [{
      method_setting_id: "example:finesse:instance-selection", source_extraction_id: "example:finesse:section3.3",
      source_work_id: work, method_parameter_key: "esm.response_semantics",
      method_setting_role: "diary_schema", method_target_layer: "diary_response", method_value_kind: "object",
      method_value_json: JSON.stringify({ selected_unit: "individual feature-use instance within owning app session", raw_serialization: null }),
      method_applicability_status: "applicable", method_disclosure_status: "declared_partial",
      method_implementation_status: "specification_only", contract_bindings: [], source_locators: [locator],
    }],
  }];
  const app_feature_sessions = [{
    feature_session_id: "example-session-1", method_profile_id: profileId, source_work_id: work,
    participant_id: "example-participant", app_name: "Instagram",
    session_record_origin: "analyst_constructed_example", source_locators: [locator],
    denotes_interval: { start_instant: "example:session-start-not-a-clock", duration_seconds: 120 },
    feature_occurrences: [
      { feature_occurrence_id: "first-search", feature_name: "SEARCH", source_locators: [locator],
        denotes_interval: { start_instant: "example:search-start-1", end_instant: "example:search-end-1" } },
      { feature_occurrence_id: "later-search", feature_name: "SEARCH", source_locators: [locator],
        denotes_interval: { start_instant: "example:search-start-2", end_instant: "example:search-end-2" } },
    ],
    // These are independent constructed response variants, not repeated prompts
    // claimed for one deployed session or satisfaction of the sampling policy.
    session_feature_selections: [
      { questionnaire_response_id: "select-later", questionnaire_item_label: "Select all parts of Instagram that you regret using.",
        selection_response_status: "submitted", selected_feature_occurrence_references: ["later-search"], source_locators: [locator] },
      { questionnaire_response_id: "submitted-empty", questionnaire_item_label: "Select all parts of Instagram that you regret using.",
        selection_response_status: "submitted", selected_feature_occurrence_references: [], source_locators: [locator] },
      { questionnaire_response_id: "expired", questionnaire_item_label: "Select all parts of Instagram that you regret using.",
        selection_response_status: "expired", source_locators: [locator] },
      { questionnaire_response_id: "skipped", questionnaire_item_label: "Select all parts of Instagram that you regret using.",
        selection_response_status: "skipped", selected_feature_occurrence_references: null, source_locators: [locator] },
    ],
  }];
  return { profiles, app_feature_sessions };
}
