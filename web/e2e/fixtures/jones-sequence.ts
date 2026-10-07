// Analyst-normalized method definition only: not source rows, callback semantics
// or an executable paper profile. Raw identity comparison and ties are unknown.
const work = "doi:10.1145/2750858.2807542";
const locator = "Jones Bath peer-reviewed manuscript, physical PDF p.6 (cover=p.1), In-session; p.8 Table 3; SHA256 7d55f75a6c99ac83983073a125b6bc2a4c7ca7f959ad2cce2b637f844ee61c15";

export function jonesSequenceExample() {
  return { profiles: [{
    method_profile_id: `example:sequence:${work}`, source_work_id: work,
    source_method_variant_id: "partition-local-encoding-definition-example",
    method_configuration_structure: "fixed", method_profile_version: "normalized-example-v1",
    profile_implementation_status: "blocked", source_locators: [locator],
    method_settings: [
      { id: "application", role: "event_schema", target: "raw_record", value: "application identity; literal F/B comparison field unspecified" },
      { id: "first", role: "feature_engineering", target: "derived_feature", value: "F" },
      { id: "repeat", role: "feature_engineering", target: "derived_feature", value: "B" },
      { id: "partition", role: "reconstruction", target: "device_session", value: "individual participant unlock-to-lock session" },
    ].map(({ id, role, target, value }) => ({
      method_setting_id: `example:sequence:${id}`, source_extraction_id: `example:jones:${id}`,
      source_work_id: work, method_parameter_key: `sequence.${id}`,
      method_setting_role: role, method_target_layer: target,
      method_value_json: JSON.stringify(value), method_value_kind: "string",
      method_applicability_status: "applicable", method_disclosure_status: "declared",
      method_implementation_status: "specification_only", contract_bindings: [], source_locators: [locator],
    })),
    method_operations: [
      { operation_id: "jones.session_partition", configuration_dependencies: ["sequence.partition"],
        consumes: ["supplied participant-local unlock/lock membership"], produces: ["ordered per-session application occurrences"],
        data_effects: ["partition"] },
      { operation_id: "jones.sequence_encoding", depends_on: ["jones.session_partition"],
        configuration_dependencies: ["sequence.application", "sequence.first", "sequence.repeat"],
        sequence_encoding_rule: "first_vs_previously_seen_in_partition",
        sequence_scope_operation_ids: ["jones.session_partition"],
        sequence_identity_setting_ids: ["example:sequence:application"],
        sequence_first_symbol_setting_id: "example:sequence:first",
        sequence_repeat_symbol_setting_id: "example:sequence:repeat",
        consumes: ["ordered per-session application occurrences"], produces: ["F/B string"],
        data_effects: ["encode every occurrence, preserving repetitions"] },
    ],
  }] };
}
