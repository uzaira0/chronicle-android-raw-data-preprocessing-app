// Akpinar et al., DOI 10.1145/3577013, physical pp12-13 Fig.4/Section4.2.
// Fig.4 supplies an action, not the original trial ID or membership.
const owner = { method_profile_id: "profile:typing-constructed-example", source_work_id: "doi:10.1145/3577013", participant_id: "constructed-participant", device_id: "constructed-device", record_origin: "analyst_constructed_example" };
const setting = (id: string, role: string, target: string, value: unknown, locator = "physical pp12-13 Fig.4/Section4.2") => ({
  method_setting_id: id, source_extraction_id: `source:${id}`, method_setting_role: role, method_target_layer: target,
  method_value_json: JSON.stringify(value), method_applicability_status: "applicable", method_disclosure_status: "declared",
  method_implementation_status: "specification_only", contract_bindings: [], source_locators: [locator],
});
export const typingTransactionExample = {
  profiles: [{ method_profile_id: owner.method_profile_id, source_work_id: owner.source_work_id,
    source_method_variant_id: "reported-study-method", method_configuration_structure: "fixed", method_profile_version: "constructed-example-v1", profile_implementation_status: "blocked",
    method_settings: [
      setting("setting:keyboard", "event_schema", "raw_record", { record_trigger: "keyboard interaction inserting or removing character", fields: ["event timestamp", "interacting user/device ID", "application package name", "before text", "current/after text", "is password", "is deleted"] }),
      setting("setting:partition", "reconstruction", "text_entry_trial", { partition: "participant", order: "ascending keyboard timestamp", input: "keyboard data list", timestamp_tie_rule: null }),
      setting("setting:app-switch", "reconstruction", "text_entry_trial", { predicate: "different application package between consecutive keyboard records", disposition: "new trial" }),
      setting("setting:reset", "reconstruction", "text_entry_trial", { predicate: "non-empty current text followed by empty before text", disposition: "new trial; submission versus clearing unresolved" }),
      setting("setting:pauses", "reconstruction", "text_entry_trial", { estimator: "mean inter-key interval plus three SD, computed on48-participant dataset", types: [{ transition: "same non-backspace or same backspace", mean_ms: 285, segmentation_ms: 2346 }, { transition: "non-backspace after backspace", mean_ms: 742, segmentation_ms: 9867 }, { transition: "backspace after non-backspace", mean_ms: 899, segmentation_ms: 23189 }], comparison_operator: null, per_person_recalibration: false, reported_input_events: 938431, reported_trials_before_validation: 42018 }),
      setting("setting:sensor-inventory", "event_schema", "raw_record", { sensors: ["accelerometer"] }),
      setting("setting:initial-verdict", "analysis", "derived_feature", { definition: { initial_case_definition: "removed versus reentered text distinguishes intentional edit from correction", exact_prefeedback_rule_list: null }, source_facing_role: "analysis", source_facing_target: "text_change" }, "physical pp17-20 Sections4.3-4.4"),
      setting("setting:revised-verdict", "analysis", "derived_feature", { definition: { changes: ["remove assumption both valid words implies edit"], fully_specified_implementation: false }, source_facing_role: "analysis", source_facing_target: "text_change" }, "physical pp19-20 Section4.4.4/Table7; partial illustration, not complete rules"),
      setting("setting:word-verdict", "analysis", "derived_feature", { definition: { first_pass: "Hunspell language instance", offline_hit: "correct token", resource_versions_or_query_snapshot: null }, source_facing_role: "analysis", source_facing_target: "token" }, "physical pp14-15 Section4.3/Algorithm1; initial/revised placement unbound"),
      setting("setting:case-followup", "validation", "derived_feature", { definition: { per_person_first_task: "10 system-correct +10 system-error words", per_person_second_task: "10 system-edit +10 system-correction cases", participant_label_tokens: ["F", "T"], participant_label_meanings_by_task: { "Uncorrected Error Detection Task": { F: "participant thinks they made a typo", T: "otherwise" }, "Edits & Error Correction Detection Task": { F: "participant thinks they corrected an error", T: "otherwise" } }, participant_free_to_remove_text: true }, source_facing_role: "validation", source_facing_target: "validation_cohort" }, "physical pp18-19 Sections4.4.1-4.4.2"),
      setting("setting:trial-context", "diary_schema", "diary_item", { definition: { questions: [{ wording: "Which one of these best describes your current location?", options: ["Indoors", "Outdoors", "Stairs", "In vehicle", "Crosswalk", "Other"] }] }, source_facing_role: "protocol", source_facing_target: "questionnaire" }, "physical pp8,32-33 Section3.3/AppendixB.1; one-question illustration"),
      setting("setting:subjective-error", "diary_schema", "diary_item", { definition: { question: "Did you just make a typing error?", answers: ["Yes", "No", "Maybe"], followup: "What do you think caused this typing error?" }, source_facing_role: "protocol", source_facing_target: "questionnaire" }, "physical p33 AppendixB.2; no branch execution"),
    ],
  }],
  keyboard_transactions: [
    { ...owner, keyboard_transaction_id: "figure-4b-deletion", keyboard_schema_setting_reference: "setting:keyboard", keyboard_timestamp: "1595852197213", app_package_name: "com.whatsapp", before_text: "Cony", current_text: "Con", is_deleted: true, is_password: false, source_locators: ["physical p12 Fig.4(b); normalized booleans from printed 1/0"] },
    { ...owner, keyboard_transaction_id: "constructed-partial", keyboard_schema_setting_reference: "setting:keyboard", keyboard_timestamp: "1595852197213", before_text: null, current_text: "", is_deleted: null, source_locators: ["analyst-constructed partial-value contrast; no claimed source row"] },
  ],
  typing_trials: [{ ...owner, typing_trial_id: "constructed-trial-1", trial_partition_setting_reference: "setting:partition", trial_app_switch_setting_reference: "setting:app-switch", trial_reset_setting_reference: "setting:reset", trial_pause_setting_reference: "setting:pauses", keyboard_transaction_references: ["figure-4b-deletion", "constructed-partial"], source_locators: ["physical p13 Section4.2; membership constructed, not original source trial"] }],
};

// All child identities, memberships and verdict/answer values below are constructed,
// not participant rows or recovered ESM joins. Overall text may have been withheld.
const caseLocator = ["analyst-constructed supplied case; physical pp18-20 Section4.4; no recovered original case/trial join"];
export const typingCaseExample = {
  ...typingTransactionExample,
  typing_trials: typingTransactionExample.typing_trials.map(trial => ({ ...trial,
    token_evaluation_cases: [{ token_evaluation_case_id: "constructed-word-1", token_text: "teh", overall_text: null,
      system_verdicts: [{ label_record_id: "supplied-word-verdict", label_setting_reference: "setting:word-verdict", observed_property: "supplied_token_correctness", label_value_json: '"typing error"', questionnaire_response_references: ["word-answer"], source_locators: caseLocator }],
      followup_responses: [{ questionnaire_response_id: "word-answer", questionnaire_setting_reference: "setting:case-followup", observed_property: "participant_reported_typo", questionnaire_item_label: "F if participant thinks they made a typo; T otherwise", response_value_json: '"F"', source_locators: caseLocator }],
      source_locators: caseLocator,
    }],
    text_change_cases: [{ text_change_case_id: "constructed-case-1", overall_text: null, removed_text: "tommorow", reentered_text: "tomorrow",
      support_keyboard_transaction_references: ["figure-4b-deletion"],
      system_verdicts: [
        { label_record_id: "initial-verdict", label_setting_reference: "setting:initial-verdict", observed_property: "supplied_edit_or_error_correction_verdict", label_value_json: '"EDIT"', source_locators: caseLocator },
        { label_record_id: "revised-verdict", label_setting_reference: "setting:revised-verdict", observed_property: "supplied_edit_or_error_correction_verdict", label_value_json: '"CORRECTION"', questionnaire_response_references: ["case-feedback"], source_locators: caseLocator },
      ],
      followup_responses: [{ questionnaire_response_id: "case-feedback", questionnaire_setting_reference: "setting:case-followup", observed_property: "participant_reported_edit_or_correction", questionnaire_item_label: "F if participant thinks they corrected an error; T otherwise", response_value_json: '"F"', source_locators: caseLocator }],
      source_locators: caseLocator,
    }],
    trial_questionnaire_responses: [
      { questionnaire_response_id: "trial-location", questionnaire_setting_reference: "setting:trial-context", observed_property: "environment", questionnaire_item_label: "Which one of these best describes your current location?", response_value_json: '"Outdoors"', source_locators: ["constructed trial association; physical pp8,32-33; original ESM join unrecovered"] },
      { questionnaire_response_id: "trial-subjective-error", questionnaire_setting_reference: "setting:subjective-error", observed_property: "participant_reported_typing_error", response_value_json: '"Maybe"', source_locators: ["constructed trial association; physical p33 AppendixB.2; not classifier truth"] },
    ],
  })),
};
