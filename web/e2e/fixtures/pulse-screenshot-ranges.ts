// Constructed normalized examples, NOT recovered PULSE rows/serialization.
// Endpoints do not imply inclusive membership or complete captured sessions.
export function pulseScreenshotRangeExample() {
  const work = "doi:10.1145/3714394.3754395";
  const locator = "PULSE published PDF physical p3 / printed202 §2.2; Figure1b/c physical p4 / printed203; SHA256:c64d0dac3fa9595a80bfa03796e3d28ab8250a97be6a3092d550b4eae2519465";
  const profileId = "example:pulse-screenshot-ranges";
  const profiles = [{
    method_profile_id: profileId, source_work_id: work,
    source_method_variant_id: "example:normalized-ranges-not-deployed-build",
    method_profile_version: "normalized-example-v1", method_configuration_structure: "fixed",
    profile_implementation_status: "specification_only", source_locators: [locator],
    method_settings: [{
      method_setting_id: "example:pulse:range-selection", source_extraction_id: "example:pulse:section2.2",
      source_work_id: work, method_parameter_key: "labeling.range_selection",
      method_setting_role: "diary_schema", method_target_layer: "diary_response", method_value_kind: "object",
      method_value_json: JSON.stringify({ selected_unit: "first/last screenshot range within phone-use session", endpoint_inclusion: null, raw_serialization: null }),
      method_applicability_status: "applicable", method_disclosure_status: "declared_partial",
      method_implementation_status: "specification_only", contract_bindings: [], source_locators: [locator],
    }],
  }];
  const screenshot_sessions = [{
    screenshot_session_id: "example-session", method_profile_id: profileId, source_work_id: work,
    participant_id: "example-participant", device_id: "example-device",
    session_record_origin: "analyst_constructed_example", source_locators: [locator],
    denotes_interval: { start_instant: "opaque:session-start", end_instant: null },
    screenshots: Array.from({ length: 6 }, (_, index) => ({
      screenshot_record_id: `screen-${index + 1}`, screenshot_sequence_position: index + 10,
      screenshot_instant: `opaque:capture-${index}`, source_locators: [locator],
    })),
    screenshot_range_annotations: [
      { range_annotation_id: "information-range", first_screenshot_reference: "screen-1", last_screenshot_reference: "screen-2",
        range_label_values_json: ' { "usage_intent": "Information", "time_evaluation": "Good" } ', source_locators: [locator] },
      { range_annotation_id: "entertainment-range", first_screenshot_reference: "screen-5", last_screenshot_reference: "screen-6",
        range_label_values_json: '{"usage_intent":"Entertainment","perceived_urgency":null}', source_locators: [locator] },
    ],
  }];
  return { profiles, screenshot_sessions };
}

export function humanScreenomeExample(profile: StudyMethodProfile) {
  const locator = "Human Screenome DOI10.1016/j.chb.2020.106570 §§3.3.2–3.3.4, primary096:174–192; constructed capture annotations, not recovered screenshots or classifier output";
  return { profiles: [profile], screenshot_sessions: [{
    screenshot_session_id: "screenome-example-session", method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example-participant", session_record_origin: "analyst_constructed_example", source_locators: [locator],
    screenshots: ["capture-A", "capture-B"].map((screenshot_record_id, screenshot_sequence_position) => ({
      screenshot_record_id, screenshot_sequence_position, screenshot_instant: "opaque-supplied-time", source_locators: [locator],
    })),
    screenshot_range_annotations: [
      { range_annotation_id: "human-app-A", first_screenshot_reference: "capture-A", last_screenshot_reference: "capture-A",
        range_label_values_json: '{"app_name":"constructed-app-A","application_type":"Social","app_name_assignment_basis":"human label","application_type_assignment_basis":"developer-specified Google Play category"}',
        source_locators: [locator, "method-setting-fb459f3cd7008215ee3ef9a5; method-setting-ba0d683c6aa365ec83a9e4c5"] },
      { range_annotation_id: "predicted-app-B", first_screenshot_reference: "capture-B", last_screenshot_reference: "capture-B",
        range_label_values_json: '{"app_name":"constructed-app-B","application_type":"Communication","app_name_assignment_basis":"classifier label","application_type_assignment_basis":"developer-specified Google Play category"}',
        source_locators: [locator, "app classifier; method-setting-ba0d683c6aa365ec83a9e4c5"] },
      { range_annotation_id: "topic-A", first_screenshot_reference: "capture-A", last_screenshot_reference: "capture-A",
        range_label_values_json: '{"topic_presence":{"nutrition":true,"public affairs":false,"purchasing":null}}',
        source_locators: [locator, "method-setting-3491848febcd73f0dd61edd2; method-setting-8bfa4df1f8203f6af3503053"] },
      ...["capture-A", "capture-B"].map(capture => ({ range_annotation_id: `features-${capture}`,
        first_screenshot_reference: capture, last_screenshot_reference: capture,
        range_label_values_json: ' {"word_count":150,"word_velocity":0,"image_complexity":4.20,"image_velocity":0.10} ',
        source_locators: [locator, "method-setting-bf6ca24692b61dd0cd6dd3a6; method-setting-b373c03dd8d6d927b2a4c5f1; §§3.3.2–3.3.3"] })),
    ],
  }] };
}
import type { StudyMethodProfile } from "../../src/lib/methodProfiles";
