// Analyst-constructed normalized examples, not participant rows, raw source
// codes, a collector replay or an executed response classifier.
import type { NotificationEvidenceRecord, NotificationHistoryRecord } from "../../src/lib/methodProfiles";

export function notificationResponseExample() {
  const work = "doi:10.1016/j.pmcj.2017.01.011";
  const locator = "Reachable published PDF pp3-4/printed482-483 Sections3.1-3.2.1/Figure1; p6/printed485 Sections4.2-4.4; SHA25686e8d65f890e6fec6007a186f09adf2fb8040abfffd891711d4a76f51279b209";
  const profileId = "example:reachable-response-records";
  const profiles = [{
    method_profile_id: profileId, source_work_id: work,
    source_method_variant_id: "example:normalized-response-definition-not-deployed-build",
    method_profile_version: "normalized-example-v1", method_configuration_structure: "fixed",
    profile_implementation_status: "specification_only", source_locators: [locator],
    method_settings: [{
      method_setting_id: "example:response-stage-distinction", source_extraction_id: "example:reachable:response-model",
      source_work_id: work, method_parameter_key: "response.stage-observability-endpoint-objectives",
      method_setting_role: "reconstruction", method_target_layer: "notification_attendance",
      method_value_kind: "object", method_value_json: JSON.stringify({
        stage_count: "variable; stages may merge", observation_availability_is_not_response: true,
        endpoints: ["null", "partial", "complete"], objectives: ["reachability", "engageability", "receptivity"],
        complete_response_engageability_truth_table: null, import_computes_labels: false,
      }), method_applicability_status: "applicable", method_disclosure_status: "declared_partial",
      method_implementation_status: "specification_only", contract_bindings: [], source_locators: [locator],
    }],
  }];
  const owner = { method_profile_id: profileId, source_work_id: work, participant_id: "example-participant",
    device_id: "example-device", history_record_origin: "analyst_constructed_example" as const, source_locators: [locator] };
  const evidence = (id: string, kind: NotificationEvidenceRecord["evidence_kind"], fields: Partial<NotificationEvidenceRecord>): NotificationEvidenceRecord => ({
    evidence_record_id: id, evidence_kind: kind, evidence_role: "inferred", ...fields, source_locators: [locator],
  });
  const stage = (id: string, availability: "observable" | "unobservable", value?: string | null) => evidence(id,
    "response_stage", { response_stage_id: id, response_observability: availability,
      ...(value !== undefined ? { evidence_value_json: value === null ? null : JSON.stringify(value) } : {}) });
  const context = (value: boolean) => evidence("device-use", "context", {
    observed_property: "device_in_use_at_interruption", context_sampling_boundary: "interruption",
    evidence_value_json: JSON.stringify(value),
    evidence_basis: "closest screen reading within +/-0.5s; boundary inclusivity and ties undisclosed",
  });
  const endpoint = (value: string, refs: string[]) => evidence("endpoint", "response_endpoint", {
    evidence_value_json: JSON.stringify(value), evidence_references: refs,
  });
  const objective = (name: string, value: boolean) => evidence(name, "response_objective_label", {
    observed_property: name, evidence_value_json: JSON.stringify(value), evidence_references: ["endpoint"],
  });
  const notification_histories: NotificationHistoryRecord[] = [
    { ...owner, notification_history_id: "example-A", notification_item_id: "example-item-A",
      notification_evidence: [stage("D1", "observable", "passed"), stage("D2", "observable", "passed"),
        context(false), evidence("expiry", "removal", { evidence_role: "recorded", evidence_basis: "supplied unconsumed expiry" }),
        endpoint("partial", ["D1", "D2", "expiry"]), objective("reachability", true),
        objective("engageability", true), objective("receptivity", false)] },
    { ...owner, notification_history_id: "example-B", notification_item_id: "example-item-B",
      notification_evidence: [stage("D1", "unobservable"), stage("D2", "unobservable", null),
        context(true), stage("D3", "observable", "consumed"), endpoint("complete", ["D3"]),
        objective("receptivity", true)] }, // Rc/Eg not supplied, not false or computed from the endpoint.
    { ...owner, notification_history_id: "example-C", notification_item_id: "example-item-C",
      notification_evidence: [stage("D1", "observable", "no_observable_response"), context(false),
        endpoint("null", ["D1"]), objective("reachability", false)] },
  ];
  return { profiles, notification_histories };
}
