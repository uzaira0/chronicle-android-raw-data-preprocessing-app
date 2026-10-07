// Analyst-normalized processing-definition example, not a literal dataset export
// or the complete Clear All method profile. No callbacks or paper results implied.
const work = "doi:10.1145/3340764.3340765";
const locator = "paper-linked release 30c40282f57c3c57b5d906997426b23147b87277; shared.py:15-38; SHA256 ad1057116365d0aac16cc585d567c8a70814916035b3f4d9038841df0d346a16";

export function clearAllGroupingExample() {
  return { profiles: [{
    method_profile_id: `example:grouping:${work}`, source_work_id: work,
    source_method_variant_id: "release-grouping-definition-example",
    method_configuration_structure: "fixed", method_profile_version: "normalized-example-v1",
    profile_implementation_status: "blocked", source_locators: [locator],
    method_settings: ["packageName", "groupKeyCompat", "isGroupSummaryCompat"].map((field) => ({
      method_setting_id: `example:field:${field}`, source_extraction_id: `example:release-field:${field}`,
      source_work_id: work, method_parameter_key: `release.field.${field}`,
      method_setting_role: "event_schema", method_target_layer: "raw_record",
      method_value_json: JSON.stringify(field), method_value_kind: "string",
      method_applicability_status: "applicable", method_disclosure_status: "declared",
      method_implementation_status: "specification_only", contract_bindings: [], source_locators: [locator],
    })),
    method_operations: [
      { operation_id: "clear_all.snapshot_partition", verb: "Partition candidate members by their supplied device snapshot",
        consumes: ["supplied snapshot Active array"], produces: ["members within one snapshot"],
        configuration_dependencies: [], data_effects: ["preserve"] },
      { operation_id: "clear_all.visual_group_selection", verb: "Retain all summaries if any exist, otherwise all members, in relative input order",
        depends_on: ["clear_all.snapshot_partition"], group_scope_operation_ids: ["clear_all.snapshot_partition"],
        grouping_basis: "raw_string_concatenation", equality_key_setting_ids: [],
        concatenated_key_setting_ids: ["example:field:packageName", "example:field:groupKeyCompat"],
        empty_if_absent_key_setting_ids: ["example:field:groupKeyCompat"],
        selection_rule: "RETAIN_SUMMARIES_IF_PRESENT_ELSE_ALL",
        configuration_dependencies: ["release.field.packageName", "release.field.groupKeyCompat", "release.field.isGroupSummaryCompat"],
        consumes: ["members within one snapshot"], produces: ["visually grouped candidate members"],
        data_effects: ["select"] },
    ],
  }] };
}

// Supplied normalized relations exercise source distinctions, not original rows,
// a verified serializer, collection cadence, notification lifetimes or callbacks.
export function clearAllSnapshotExample() {
  const library = clearAllGroupingExample();
  const paperLocator = "Clear All PDF pp.4-5, snapshot metadata and item identity; p.10, unobserved interactions; SHA256 feb1ad9898385b4345dd5dcd8cf862aba4a7e330b847cab9c52d8d3cca3a493f";
  const codeLocator = "03_notification_counts.ipynb, get_notification_identifiers/worker_count_individual; commit 30c40282f57c3c57b5d906997426b23147b87277; SHA256 c1e2fc446db7c746c68ec2bb30ef8b6a227686ba0b59bfd5e4f1ed08731ee813";
  const item = (id: string, position: number) => ({
    appearance_record_id: id, notification_item_id: "item-1", item_identity_basis: "paper_four_field_combination",
    app_package_name: "example.app", notification_id_json: "7", notification_tag_json: "null",
    creation_instant: "2026-01-01T08:00:00Z", drawer_position: position, source_locators: [paperLocator],
  });
  const snapshot = (id: string, device: string, instant: string, items: Array<Record<string, unknown>>) => ({
    snapshot_record_id: id, method_profile_id: library.profiles[0]!.method_profile_id, source_work_id: work,
    device_id: device, snapshot_record_origin: "analyst_constructed_example", snapshot_instant: instant,
    timezone: "UTC", pending_item_appearances: items, source_locators: [paperLocator],
  });
  return { ...library, notification_snapshots: [
    { ...snapshot("S1", "D1", "2026-01-01T09:00:00Z", [{ ...item("a1", 2),
      priority_value_json: "-2", clearability_value_json: "false", group_key_compat_absent: true,
      group_summary_compat_value_json: "false", source_locators: [paperLocator, locator],
    }]), android_version: "9.0", device_model: "Example Model", device_product: "example_product",
      device_manufacturer: "Example Manufacturer", snapshot_transmission_id_token: "9007199254740993" },
    { ...snapshot("S2", "D1", "2026-01-01T09:17:00Z", [{ ...item("a2", 1),
      priority_value_json: "2", clearability_value_json: "true", group_key_compat_value_json: '""',
      group_key_compat_absent: false, group_summary_compat_value_json: '"false"', source_locators: [paperLocator, locator],
    }]), android_version: "10.0", device_model: "", device_product: null,
      snapshot_transmission_id_token: "9007199254740994" },
    snapshot("S3", "D1", "2026-01-01T09:34:00Z", []),
    snapshot("S4", "D2", "2026-01-01T09:17:00Z", [{ ...item("a4", 4),
      priority_value_json: "0", clearability_value_json: "0", group_key_compat_value_json: "null",
      group_summary_compat_value_json: "null", source_locators: [paperLocator, locator],
    }]),
    snapshot("S5", "D1", "2026-01-01T09:51:00Z", [{
      appearance_record_id: "a5", notification_item_id: "item-1", item_identity_basis: "linked_code_key_posttime",
      app_package_name: "example.app", notification_key_token: "opaque-key", post_time_identity_token: "12345",
      drawer_position: null, source_locators: [codeLocator],
    }]),
  ] };
}
